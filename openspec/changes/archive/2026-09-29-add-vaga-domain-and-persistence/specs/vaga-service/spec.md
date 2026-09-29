# Spec Delta

## Purpose

Definir o contrato de aplicação para acesso às vagas: as operações de listar, criar, mover de status e
remover, como o cliente Supabase chega ao serviço, e como falhas do banco são traduzidas para erros de
domínio compreensíveis. O serviço é o único caminho previsto nesta change para ler ou escrever vagas a partir
do código do aplicativo.

## ADDED Requirements

### Requirement: Operações do serviço de vagas

O serviço de vagas SHALL expor quatro operações: `listarVagas()` devolvendo todas as vagas do usuário
autenticado, `criarVaga(input: VagaCreateInput)`, `atualizarStatus(id, status, ordem?)` e
`removerVaga(id)`. O serviço SHALL validar a entrada com os schemas do domínio antes de falar com o banco e
SHALL devolver registros conformes ao schema `VagaRow`.

#### Scenario: Listagem devolve apenas as vagas do usuário autenticado

- **GIVEN** um usuário autenticado com vagas em vários status
- **WHEN** `listarVagas()` é chamado
- **THEN** o resultado SHALL conter somente as vagas desse usuário, ordenadas por `status` e `ordem`

#### Scenario: Criação persiste a vaga com status e ordem iniciais

- **GIVEN** uma entrada válida com `url`, `titulo`, `empresa`, `requisitos` e `senioridade`
- **WHEN** `criarVaga(input)` é chamado
- **THEN** uma linha SHALL ser criada com `status` inicial `aplicado`, `user_id` preenchido a partir da sessão
  e o resultado SHALL ser devolvido como `VagaRow`

#### Scenario: Entrada inválida não chega ao banco

- **GIVEN** uma entrada que viola o schema `VagaCreateInput`, como uma URL `http://` ou um título vazio
- **WHEN** `criarVaga(input)` é chamado
- **THEN** a operação SHALL falhar com erro de validação e nenhuma requisição de escrita SHALL ser enviada ao
  banco

#### Scenario: Movimentação de status atualiza posição

- **GIVEN** uma vaga pertencente ao usuário autenticado
- **WHEN** `atualizarStatus(id, 'entrevista_1', 2)` é chamado
- **THEN** o `status` e a `ordem` da vaga SHALL ser atualizados e o resultado SHALL refletir os novos valores

#### Scenario: Ordem não informada mantém a posição atual

- **GIVEN** uma vaga com `ordem` igual a `3`
- **WHEN** `atualizarStatus(id, 'proposta')` é chamado sem informar `ordem`
- **THEN** apenas o `status` SHALL ser alterado e a `ordem` SHALL permanecer `3`

#### Scenario: Remoção apaga a vaga

- **GIVEN** uma vaga pertencente ao usuário autenticado
- **WHEN** `removerVaga(id)` é chamado
- **THEN** a vaga SHALL deixar de existir e não SHALL constar em uma listagem posterior

#### Scenario: Operação sobre vaga inexistente ou alheia é sinalizada

- **GIVEN** um identificador que não pertence ao usuário autenticado, seja inexistente, seja de outro usuário
- **WHEN** `atualizarStatus` ou `removerVaga` é chamado com esse identificador
- **THEN** a operação SHALL sinalizar que nada foi alterado, sem revelar se o registro existe para outra
  conta

### Requirement: Serviço sem `user_id` vindo do cliente

O serviço SHALL receber o cliente Supabase por injeção de dependência no momento da construção e SHALL NOT
expor nenhum parâmetro de `user_id` em suas assinaturas. O `user_id` effective SHALL ser sempre o da sessão do
cliente autenticado, aplicado pelo banco, e o serviço SHALL NOT usar a service role key.

#### Scenario: Cliente é injetado na construção

- **GIVEN** um cliente Supabase autenticado com o JWT de um usuário
- **WHEN** o serviço de vagas é construído com esse cliente
- **THEN** todas as operações subsequentes SHALL ser executadas com esse cliente, sem criar cliente próprio

#### Scenario: Nenhuma operação aceita `user_id`

- **GIVEN** a assinatura pública do serviço de vagas
- **WHEN** ela é inspecionada
- **THEN** nenhuma operação SHALL declarar parâmetro de `user_id`

### Requirement: Tradução de erros do banco para o domínio

O serviço SHALL traduzir o erro de violação de unicidade (SQLSTATE `23505`) na constraint
`(user_id, url_normalizada)` para o erro de domínio `VagaDuplicadaError`, reconhecível por tipo. As demais
falhas SHALL ser convertidas em erro de domínio genérico, sem expor mensagem do banco, SQL ou stack trace ao
usuário final; o detalhe original SHALL permanecer disponível apenas para log interno que não contenha
conteúdo do usuário.

#### Scenario: URL duplicada gera erro de domínio identificável

- **GIVEN** um usuário autenticado com a vaga `https://x.com/job/1?utm_source=a` cadastrada
- **WHEN** `criarVaga` é chamado com `https://x.com/job/1`
- **THEN** a operação SHALL falhar com um erro da classe `VagaDuplicadaError`, sem mensagem de SQL

#### Scenario: Erro inesperado não vaza detalhe interno

- **DADO** uma falha de banco que não seja violação de unicidade
- **QUANDO** a operação falha
- **ENTÃO** a mensagem retornada ao chamador SHALL ser genérica e em pt-BR, sem stack trace, SQL ou conteúdo
  do usuário

#### Scenario: Log não expõe dados sensíveis

- **DADO** uma operação que falhou
- **QUANDO** o erro é registrado em log
- **ENTÃO** a entrada de log SHALL NOT conter o conteúdo enviado pelo usuário, tokens de sessão ou o e-mail do
  usuário
