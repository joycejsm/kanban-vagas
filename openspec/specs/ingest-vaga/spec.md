# ingest-vaga Specification

## Purpose

Definir o contrato HTTP da Edge Function `ingest-vaga`: o que ela aceita na requisição, o que devolve em caso
de sucesso, quais condições recusam a chamada antes de qualquer trabalho de extração (origem não permitida,
sessão inválida, e-mail fora da allowlist, limite de uso excedido) e como cada falha é comunicada sem vazar
detalhe interno.

## Requirements

### Requirement: Contrato de entrada da ingestão

A função SHALL aceitar requisições `POST` cujo corpo seja validado por um schema Zod estrito, rejeitando
campos não previstos. O corpo SHALL conter obrigatoriamente `url` e, opcionalmente, `texto` — este último com
no máximo 30.000 caracteres, para o usuário colar o conteúdo quando o scraping não funciona. A função SHALL NOT
aceitar `user_id`, `status`, `ordem` ou qualquer outro campo de servidor.

#### Scenario: Corpo com url apenas é aceito

- **GIVEN** um corpo `POST` com `{"url": "https://empresa.com/vaga/1"}`
- **WHEN** a função valida o corpo
- **THEN** a validação SHALL passar e a extração SHALL ser executada por scraping

#### Scenario: Corpo com url e texto é aceito

- **GIVEN** um corpo `POST` com `{"url": "https://empresa.com/vaga/1", "texto": "Vaga de ..."}` com o texto
  dentro do limite
- **WHEN** a função valida o corpo
- **THEN** a validação SHALL passar e o texto SHALL ser usado como fonte, sem acesso à página

#### Scenario: Texto acima do limite é rejeitado

- **GIVEN** um corpo com `texto` de 30.001 caracteres
- **WHEN** a função valida o corpo
- **THEN** a validação SHALL falhar e a resposta SHALL ser `422` com mensagem genérica em pt-BR

#### Scenario: Campo não previsto é rejeitado

- **GIVEN** um corpo `POST` com `{"url": "...", "user_id": "..."}` ou com uma chave desconhecida
- **WHEN** a função valida o corpo
- **THEN** a validação SHALL falhar e a resposta SHALL ser `422`, sem executar nenhuma requisição de rede

#### Scenario: Método diferente de POST é recusado

- **GIVEN** uma requisição `GET`, `PUT` ou `DELETE` na rota da função
- **WHEN** a função é invocada
- **THEN** a resposta SHALL indicar método não permitido e nenhum trabalho SHALL ser executado

### Requirement: CORS restrito à origem da aplicação

A função SHALL aceitar apenas requisições cuja origem esteja em `APP_ORIGIN` e SHALL responder a preflight
`OPTIONS` com os cabeçalhos CORS correspondentes. Requisições de origem diferente SHALL ser recusadas sem
executar o pipeline.

#### Scenario: Preflight da origem da aplicação é atendido

- **GIVEN** uma requisição `OPTIONS` com `Origin` igual a `APP_ORIGIN`
- **WHEN** a função é invocada
- **THEN** a resposta SHALL incluir o cabeçalho `Access-Control-Allow-Origin` com esse valor e o método `POST`

#### Scenario: Origem desconhecida é recusada

- **GIVEN** uma requisição com `Origin` fora de `APP_ORIGIN`
- **WHEN** a função é invocada
- **THEN** a função SHALL recusar a chamada sem executar extração nem gravar dados

### Requirement: Autenticação e allowlist de e-mail

A função SHALL exigir um token de sessão válido, validando o usuário com o token recebido, e SHALL recusar
chamadas sem sessão com `401`. Quando o e-mail do usuário não estiver na allowlist `ALLOWED_EMAILS`, a função
SHALL encerrar o acesso e responder `403`. Nenhuma das duas verificações pode ser contornada por parâmetro
do corpo ou da query string.

#### Scenario: Sem Authorization é recusado

- **GIVEN** uma requisição sem cabeçalho `Authorization` ou com token inválido
- **WHEN** a função é invocada
- **THEN** a resposta SHALL ser `401` e nenhuma extração SHALL ser executada

#### Scenario: E-mail fora da allowlist é recusado

- **GIVEN** um usuário autenticado cujo e-mail não está em `ALLOWED_EMAILS`
- **WHEN** ele chama a função
- **THEN** a resposta SHALL ser `403` com mensagem genérica em pt-BR

#### Scenario: E-mail autorizado tem a chamada aceita

- **GIVEN** um usuário autenticado cujo e-mail está em `ALLOWED_EMAILS`
- **WHEN** ele chama a função com uma URL válida
- **THEN** a validação de acesso SHALL passar e o pipeline SHALL prosseguir

### Requirement: Limite de uso por usuário

O sistema SHALL aplicar no máximo 20 ingestões por hora e 100 por dia, por usuário. Cada tentativa aceita
deverá ser registrada em uma tabela de auditoria protegida por RLS. Ao exceder o limite, a função SHALL
responder `429` antes de qualquer requisição de rede.

#### Scenario: Ingestão dentro do limite é aceita

- **GIVEN** um usuário com 19 ingestões na hora corrente
- **WHEN** ele faz uma nova chamada
- **THEN** a chamada SHALL ser processada normalmente

#### Scenario: Limite horário excedido

- **GIVEN** um usuário que já fez 20 ingestões na hora corrente
- **WHEN** ele faz uma nova chamada
- **THEN** a resposta SHALL ser `429` com mensagem em pt-BR e nenhuma requisição externa SHALL ser feita

#### Scenario: Limite diário excedido

- **GIVEN** um usuário que já fez 100 ingestões no dia corrente, mesmo com menos de 20 na hora
- **WHEN** ele faz uma nova chamada
- **THEN** a resposta SHALL ser `429`

#### Scenario: A auditoria fica isolada por usuário

- **GIVEN** dois usuários autenticados com registros de auditoria
- **QUANDO** um deles consulta a tabela de auditoria
- **ENTÃO** o resultado SHALL conter apenas os próprios registros, e o cliente anônimo não SHALL obter acesso

### Requirement: Resposta de sucesso e de erro

Em caso de sucesso, a função SHALL responder `201` com o corpo `{"vaga": <VagaRow>}`, onde o registro
corresponde ao schema de leitura do domínio e foi persistido sob o usuário da sessão. Em caso de falha, a
função SHALL responder com `{"code": ..., "message": ...}`, onde `message` é uma mensagem genérica em pt-BR e
`code` identifica a categoria do erro para o cliente agir.

#### Scenario: Sucesso devolve a vaga criada

- **GIVEN** uma chamada autenticada e autorizada, com URL acessível e dados extraídos válidos
- **WHEN** a extração e a persistência concluem
- **THEN** a resposta SHALL ser `201` e o corpo SHALL conter a vaga, com `status` `aplicado` e `user_id`
  igual ao da sessão

#### Scenario: Falha devolve código e mensagem genérica

- **GIVEN** qualquer condição de falha do pipeline
- **WHEN** a função responde com erro
- **THEN** o corpo SHALL conter `code` e `message` em pt-BR e SHALL NOT conter stack trace, consulta SQL,
  saída bruta do modelo ou trecho do conteúdo raspado

#### Scenario: Vaga já cadastrada responde conflito

- **GIVEN** um usuário que já cadastrou a mesma URL, em qualquer variação equivalente
- **WHEN** ele chama a função com essa URL
- **THEN** a resposta SHALL ser `409` informando que a vaga já está cadastrada

#### Scenario: Extração sem dados suficientes responde erro de extração

- **GIVEN** uma página acessível cujo conteúdo não produz título, empresa ou requisitos utilizáveis
- **WHEN** a extração é validada
- **THEN** a resposta SHALL ser `422`, sem repassar ao cliente a saída bruta do modelo, e o cliente SHALL ser
  convidado a colar o texto da vaga
