# vaga-domain Specification

## Purpose
Define o contrato de domínio da entidade `Vaga`: quais campos existem, quais limites de tamanho se aplicam a
cada entrada e quais valores são aceitos para `status` e `senioridade`. Este contrato é a fonte única de
verdade compartilhada entre o frontend Next.js e as Edge Functions em Deno.

## Requirements

### Requirement: Schema de entrada da Vaga

O sistema SHALL fornecer um schema de entrada da `Vaga` (`VagaCreateInput`) que aceite apenas os campos
pertencentes ao usuário — `url`, `titulo`, `empresa`, `requisitos` e `senioridade` — e que rejeite chaves
adicionais. O schema SHALL NOT conter `id`, `user_id`, `status`, `ordem`, `created_at` ou `updated_at`, pois
esses valores são derivados do servidor ou do estado do quadro.

#### Scenario: Entrada válida é aceita

- **GIVEN** um payload com `url` `https://empresa.com/vaga/1`, `titulo` `Engenheira de Software`,
  `empresa` `Empresa X`, `requisitos` `["TypeScript", "Postgres"]` e `senioridade` `Senior`
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL resultar em sucesso e o resultado SHALL conter exatamente esses cinco campos

#### Scenario: Payload com campo de servidor é rejeitado

- **GIVEN** um payload válido acrescido de `user_id`, `id`, `status` ou `ordem`
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar informando que chaves adicionais não são permitidas

#### Scenario: `senioridade` ausente assume o valor padrão

- **GIVEN** um payload válido sem o campo `senioridade`
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** o resultado validado SHALL conter `senioridade` igual a `Não informado`

### Requirement: Limites de tamanho da entrada

O schema de entrada da `Vaga` SHALL impor limites de tamanho em todas as entradas externas, rejeitando valores
fora da faixa: `url` com no máximo 2048 caracteres e obrigatoriamente no esquema `https`; `titulo` e `empresa`
com 1 a 200 caracteres; `requisitos` como array de strings com no máximo 30 itens, cada um com 1 a 300
caracteres; `senioridade` restrita a `Junior`, `Pleno`, `Senior` ou `Não informado`.

#### Scenario: URL não-HTTPS é rejeitada

- **GIVEN** um payload com `url` `http://empresa.com/vaga/1`
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por violação do esquema de URL

#### Scenario: URL acima do limite é rejeitada

- **GIVEN** um payload com `url` `https://` seguido de 2049 caracteres
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por violação do limite de tamanho da URL

#### Scenario: Título ou empresa vazios são rejeitados

- **GIVEN** um payload com `titulo` vazio ou com `empresa` de 201 caracteres
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por violação do intervalo de tamanho

#### Scenario: Lista de requisitos fora dos limites é rejeitada

- **GIVEN** um payload com 31 itens em `requisitos`, ou com um item de 301 caracteres, ou com um item vazio
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por violação dos limites de `requisitos`

#### Scenario: Valor de senioridade desconhecido é rejeitado

- **GIVEN** um payload com `senioridade` `Estágio`
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por valor fora do conjunto permitido

### Requirement: Enum de status da candidatura

O domínio SHALL definir o enum `StatusVaga` com exatamente os valores `aplicado`, `entrevista_1`,
`fase_tecnica`, `proposta` e `rejeitado`, e nenhum outro valor SHALL ser aceito como status de uma vaga.

#### Scenario: Valores canônicos são aceitos

- **GIVEN** um valor entre `aplicado`, `entrevista_1`, `fase_tecnica`, `proposta` e `rejeitado`
- **WHEN** o valor é validado contra o enum `StatusVaga`
- **THEN** a validação SHALL resultar em sucesso

#### Scenario: Status fora do enum é rejeitado

- **GIVEN** o valor `entrevistado` ou uma string vazia
- **WHEN** o valor é validado contra o enum `StatusVaga`
- **THEN** a validação SHALL falhar

### Requirement: Schema de leitura do registro persistido

O domínio SHALL fornecer um schema `VagaRow` que descreva o registro completo da vaga no banco, incluindo `id`
(UUID), `user_id` (UUID), `url`, `url_normalizada`, `titulo`, `empresa`, `requisitos`, `senioridade`,
`status`, `ordem`, `created_at` e `updated_at`. O sistema SHALL exportar os tipos `VagaCreateInput`, `VagaRow`,
`StatusVaga` e `Senioridade` derivados do schema, para uso em TypeScript com `strict` habilitado.

#### Scenario: Registro vindo do banco é validado

- **GIVEN** uma linha retornada pelo banco com todos os campos preenchidos
- **WHEN** a linha é validada pelo schema `VagaRow`
- **THEN** a validação SHALL resultar em sucesso e o resultado SHALL ser utilizável como tipo `VagaRow`

#### Scenario: Registro com status fora do enum é rejeitado

- **GIVEN** uma linha cujo campo `status` contém um valor não previsto no enum
- **WHEN** a linha é validada pelo schema `VagaRow`
- **THEN** a validação SHALL falhar, sinalizing dado inconsistente no banco

#### Scenario: `requisitos` ausente ou nulo é rejeitado

- **GIVEN** uma linha sem o campo `requisitos` ou com `requisitos` nulo
- **WHEN** a linha é validada pelo schema `VagaRow`
- **THEN** a validação SHALL falhar

### Requirement: `VagaCreateInput` como contrato de saída da extração

O schema `VagaCreateInput` SHALL ser o contrato de validação da **saída** da extração de uma vaga, e não
apenas da entrada de criação. A saída produzida por extração automatizada — por exemplo a devolvida por um modelo
de linguagem a partir do HTML de um anúncio — SHALL passar pela mesma validação que uma entrada de usuário, e
SHALL ser aceita somente quando contiver exclusivamente `url`, `titulo`, `empresa`, `requisitos` e
`senioridade`, com `senioridade` ausente assumindo `Não informado`.

A validação da saída SHALL ser estrita: qualquer chave fora desse conjunto — inclusive `id`, `user_id`, `status`,
`ordem`, `created_at`, `updated_at` ou qualquer campo arbitrário produzido pelo modelo — SHALL fazer a validação
falhar, e o resultado SHALL ser rejeitado por inteiro em vez de ser aproveitado parcialmente.

#### Scenario: Saída válida da extração é aceita

- **GIVEN** uma saída de extração com `titulo` `Engenheira de Software`, `empresa` `Empresa X`,
  `requisitos` `["TypeScript"]` e `senioridade` `Senior`
- **WHEN** ela é validada pelo schema `VagaCreateInput`
- **THEN** a validação SHALL resultar em sucesso e o resultado SHALL conter exatamente os cinco campos do
  contrato

#### Scenario: Saída com chave fora do contrato é rejeitada

- **GIVEN** uma saída de extração que, além dos campos válidos, contém `user_id`, `status` ou um campo
  arbitrário não previsto
- **WHEN** ela é validada pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar, e nenhum campo da saída SHALL ser aproveitado

#### Scenario: Saída com título acima do limite é rejeitada

- **GIVEN** uma saída de extração com `titulo` de 201 caracteres
- **WHEN** ela é validada pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por violação do limite de tamanho

#### Scenario: Saída com `senioridade` ausente assume o valor padrão

- **GIVEN** uma saída de extração válida sem o campo `senioridade`
- **WHEN** ela é validada pelo schema `VagaCreateInput`
- **THEN** o resultado validado SHALL conter `senioridade` igual a `Não informado`

### Requirement: Procedência do campo `url` no registro da vaga

O campo `url` do registro da vaga SHALL ter procedência distinta de todos os demais: ele SHALL ser o valor
informado na requisição do usuário e já validado pelas regras de URL, e nunca o valor devolvido pela extração
automatizada. Quando a extração produzir um campo `url`, esse valor SHALL ser descartado e substituído pelo da
requisição, inclusive quando ambos forem válidos e diferentes. Os demais campos do registro — `titulo`, `empresa`,
`requisitos` e `senioridade` — SHALL poder ter origem na extração automatizada.

#### Scenario: URL persistida é a da requisição, não a do modelo

- **GIVEN** uma requisição com a URL `https://empresa.com/vaga/1` e uma extração que devolve
  `url` `https://site-malicioso.example/vaga/1`
- **WHEN** a vaga é criada a partir dessa extração
- **THEN** o campo `url` do registro persistido SHALL ser `https://empresa.com/vaga/1`

#### Scenario: URL do modelo é ignorada mesmo quando parece legítima

- **GIVEN** uma requisição com a URL `https://empresa.com/vaga/1` e uma extração que devolve
  `url` `https://empresa.com/vaga/2`
- **WHEN** a vaga é criada a partir dessa extração
- **THEN** o campo `url` do registro persistido SHALL ser `https://empresa.com/vaga/1`, e a URL devolvida pela
  extração SHALL ter sido descartada

#### Scenario: Ausência de URL na extração não impede a criação

- **GIVEN** uma requisição com a URL `https://empresa.com/vaga/1` e uma extração que não devolve campo `url`
- **WHEN** a vaga é criada a partir dessa extração
- **THEN** a criação SHALL ser concluída com sucesso e o campo `url` persistido SHALL ser
  `https://empresa.com/vaga/1`
