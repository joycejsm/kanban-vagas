# Spec Delta

## Purpose

Descrever como a vaga é persistida no Postgres do Supabase: a estrutura da tabela `public.vagas`, a
normalização da URL usada como chave de unicidade, os invariantes de integridade mantidos por CHECK
constraints e triggers, e as políticas de Row Level Security que garantem que um usuário só enxergue e modifique
as próprias vagas. Esta é a primeira migração do projeto; tabela, RLS e policies nascem no mesmo arquivo.

## ADDED Requirements

### Requirement: Tabela `public.vagas`

O banco SHALL fornecer a tabela `public.vagas` com as colunas `id` (UUID, chave primária, gerada), `user_id`
(UUID, `not null`, `default auth.uid()`, `references auth.users(id) on delete cascade`), `url`, `url_normalizada`,
`titulo`, `empresa`, `requisitos`, `senioridade`, `status`, `ordem`, `created_at` e `updated_at`. A tabela
SHALL NOT aceitar linhas sem `user_id` e SHALL SHALL remover as vagas do usuário quando a conta for excluída.

#### Scenario: Inserção sem `user_id` explícito atribui o usuário da sessão

- **GIVEN** um usuário autenticado inserindo uma vaga sem informar `user_id`
- **WHEN** a inserção é concluída
- **THEN** a coluna `user_id` SHALL conter o `auth.uid()` da sessão corrente

#### Scenario: Inserção sem `user_id` explícito em sessão anônima é rejeitada

- **GIVEN** uma inserção sem `user_id` explícito em uma conexão sem usuário autenticado
- **WHEN** a inserção é tentada
- **THEN** a operação SHALL falhar, pois `auth.uid()` é nulo e a coluna é `not null`

#### Scenario: Exclusão da conta remove as vagas

- **GIVEN** um usuário autenticado com ao menos uma vaga
- **WHEN** o registro correspondente em `auth.users` é excluído
- **THEN** as vagas desse usuário SHALL ser excluídas por cascata

### Requirement: Integridade de domínio no banco

A tabela SHALL impor, via CHECK constraints, que `status` pertença ao conjunto `aplicado`, `entrevista_1`,
`fase_tecnica`, `proposta`, `rejeitado` e que `senioridade` pertença ao conjunto `Junior`, `Pleno`, `Senior`,
`Não informado`, refletindo exatamente os enums do domínio. O campo `requisitos` SHALL ser armazenado com CHECK
que limite a no máximo 30 itens, cada um com no máximo 300 caracteres e não vazio. `titulo` e `empresa` SHALL
ser `not null` com CHECK de tamanho entre 1 e 200 caracteres, e `url` SHALL ter no máximo 2048 caracteres.

#### Scenario: Status fora do enum é rejeitado pelo banco

- **GIVEN** uma inserção ou atualização com `status` igual a `arquivado`
- **WHEN** a operação é executada
- **THEN** o banco SHALL rejeitar a operação por violação de CHECK constraint

#### Scenario: Lista de requisitos grande demais é rejeitada

- **GIVEN** uma inserção com 31 requisitos, ou com um requisito de 301 caracteres
- **WHEN** a operação é executada
- **THEN** o banco SHALL rejeitar a operação por violação de CHECK constraint

### Requirement: Normalização de URL e unicidade por usuário

O banco SHALL calcular `url_normalizada` a partir de `url` de forma determinística: esquema e host em
minúsculas, remoção do fragmento (`#...`), remoção dos parâmetros de rastreamento `utm_*` (e demais parâmetros
da família de tracking plataforma), remoção de parâmetros vazios e remoção da barra final do caminho. A
constraint `UNIQUE (user_id, url_normalizada)` SHALL impedir que o mesmo usuário cadastre duas vezes a mesma
anúncio; a mesma URL para usuários diferentes SHALL ser permitida.

#### Scenario: URLs equivalentes colidem na mesma conta

- **GIVEN** o usuário A com a vaga `https://x.com/job/1?utm_source=a` cadastrada
- **WHEN** o mesmo usuário tenta cadastrar `https://x.com/job/1`
- **THEN** o banco SHALL rejeitar a inserção com SQLSTATE `23505`

#### Scenario: Mesma URL para contas diferentes é aceita

- **GIVEN** o usuário A com a vaga `https://x.com/job/1` cadastrada
- **WHEN** o usuário B cadastra `https://x.com/job/1`
- **THEN** a inserção SHALL ser concluída com sucesso

#### Scenario: Variações de escrita são normalizadas para o mesmo valor

- **GIVEN** uma URL com host maiúsculo, barra final, fragmento e parâmetros `utm_*`
- **WHEN** a inserção é executada
- **THEN** `url_normalizada` SHALL ser idêntica à forma canônica da mesma URL sem esses elementos

### Requirement: Posição no quadro e timestamps

A tabela SHALL fornecer a coluna `ordem` para posicionar a vaga dentro da coluna de status, com valor padrão
zero, e as colunas `created_at` e `updated_at` com preenchimento automático. Um trigger SHALL atualizar
`updated_at` a cada `UPDATE`. Um índice composto em `(user_id, status, ordem)` SHALL existir para sustentar a
leitura do quadro Kanban.

#### Scenario: `updated_at` muda a cada atualização

- **GIVEN** uma vaga persistida com `created_at` e `updated_at` conhecidas
- **WHEN** a vaga sofre um `UPDATE`
- **THEN** `updated_at` SHALL ser maior que o valor anterior e `created_at` SHALL permanecer inalterado

#### Scenario: Ordem padrão é zero

- **GIVEN** uma inserção que não informa `ordem`
- **WHEN** a inserção é concluída
- **THEN** `ordem` SHALL ter o valor `0`

#### Scenario: Consulta do quadro usa índice por usuário, status e ordem

- **GIVEN** um usuário com várias vagas distribuídas em vários status
- **WHEN** o serviço lista as vagas desse usuário ordenadas por `status` e `ordem`
- **THEN** o resultado SHALL vir ordenado por status e, dentro dele, por ordem crescente

### Requirement: Row Level Security

A tabela SHALL ter RLS habilitado e forçado (`ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`), com
políticas `TO authenticated` para `SELECT`, `INSERT`, `UPDATE` e `DELETE` baseadas em
`(select auth.uid()) = user_id`. `INSERT` e `UPDATE` SHALL ter `WITH CHECK` além de `USING`. A tabela SHALL
ter `REVOKE ALL ... FROM anon`. O privilégio `UPDATE` SHALL ser revogado na tabela e readmitido somente por
coluna, excluindo `user_id`, de modo que nenhum `UPDATE` consiga gravar o proprietário da vaga.

#### Scenario: Usuário autenticado só vê as próprias vagas

- **DADO** o usuário A autenticado, com pelo menos uma vaga, e o usuário B autenticado, com pelo menos uma vaga
- **QUANDO** o usuário A executa um `SELECT` em `public.vagas`
- **ENTÃO** o resultado SHALL conter apenas as vagas cujo `user_id` é o do usuário A

#### Scenario: INSERT com `user_id` alheio é rejeitado

- **DADO** o usuário A autenticado
- **QUANDO** ele tenta inserir uma vaga informando `user_id` do usuário B
- **ENTÃO** a operação SHALL falhar por violação de RLS, e em nenhum caso a vaga SHALL ficar associada ao
  usuário B

#### Scenario: UPDATE alterando `user_id` é rejeitado

- **DADO** o usuário A autenticado com uma vaga própria
- **QUANDO** ele tenta atualizar essa vaga informando outro `user_id`
- **ENTÃO** a operação SHALL ser rejeitada

#### Scenario: O privilégio de UPDATE não alcança `user_id`

- **DADO** a tabela `public.vagas` com RLS habilitado
- **QUANDO** se consulta `has_column_privilege` para o papel `authenticated` sobre `user_id` e sobre `status`
- **ENTÃO** o resultado SHALL ser falso para `user_id` e verdadeiro para as colunas graváveis

#### Scenario: Gravar o próprio `user_id` também é rejeitado

- **DADO** o usuário A autenticado com uma vaga própria
- **QUANDO** ele tenta gravar `user_id` com o próprio id em um `UPDATE` de outro campo
- **ENTÃO** a operação SHALL ser rejeitada, pois `user_id` não é uma coluna gravável

#### Scenario: UPDATE fora do próprio conjunto não altera nada

- **DADO** o usuário B autenticado e uma vaga pertencente ao usuário A
- **QUANDO** o usuário B tenta `UPDATE` nessa vaga
- **ENTÃO** a operação SHALL afetar zero linhas

#### Scenario: DELETE de vaga alheia é rejeitado

- **DADO** o usuário B autenticado e uma vaga pertencente ao usuário A
- **QUANDO** o usuário B tenta `DELETE` nessa vaga
- **ENTÃO** a operação SHALL afetar zero linhas e a vaga SHALL continuar existindo

#### Scenario: Cliente anônimo não executa nenhuma operação

- **DADO** uma conexão sem claims de autenticação, no papel `anon`
- **QUANDO** executa `SELECT`, `INSERT`, `UPDATE` ou `DELETE` em `public.vagas`
- **ENTÃO** todas as operações SHALL ser negadas e a tabela SHALL permanecer inalterada

### Requirement: Cobertura automatizada das políticas

O repositório SHALL conter um script SQL de teste em `supabase/tests/vagas_rls.sql` que simula dois usuários
autenticados com `set role authenticated` e `set request.jwt.claims`, exercitando: isolamento de leitura,
`INSERT` com `user_id` alheio, `UPDATE` de `user_id`, `DELETE` de vaga alheia, negação para cliente anônimo e
duplicidade por normalização de URL.

#### Scenario: Script de teste reproduz o isolamento

- **GIVEN** o script `supabase/tests/vagas_rls.sql` executado em um banco com a migração aplicada
- **WHEN** todas as asserções são executadas
- **THEN** o script SHALL terminar sem erros de asserção, confirmando os cenários de RLS e de duplicidade
