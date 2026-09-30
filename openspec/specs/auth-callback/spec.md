# Callback de autenticação Specification

## Purpose

Concluir o login iniciado pelo provedor Google, trocando o código de autorização por uma sessão de usuário no
servidor, de forma que o destino após o login nunca possa ser controlado por terceiro e que falhas de troca de
código resultem em um caminho previsível em vez de uma tela quebrada.

## Requirements

### Requirement: Troca de código por sessão

A rota `/auth/callback` SHALL ler o parâmetro `code` da query string e trocá-lo por uma sessão Supabase via
`exchangeCodeForSession`. A sessão resultante SHALL ser propagada à resposta por meio dos cookies do
`@supabase/ssr`, para que as requisições seguintes sejam autenticadas sem novo login. Após a troca bem-sucedida,
o usuário SHALL ser redirecionado para o destino determinado pela regra do parâmetro `next`.

#### Scenario: Código válido conclui o login

- **GIVEN** uma requisição a `/auth/callback?code=<código válido>`
- **WHEN** a rota troca o código por sessão
- **THEN** os cookies de sessão SHALL ser gravados na resposta e o usuário SHALL ser redirecionado para `/`

#### Scenario: Código ausente é tratado como falha

- **GIVEN** uma requisição a `/auth/callback` sem o parâmetro `code`
- **WHEN** a rota é executada
- **THEN** nenhuma sessão SHALL ser criada e o usuário SHALL ser redirecionado para `/login?erro=auth`

#### Scenario: Código inválido ou expirado é tratado como falha

- **GIVEN** uma requisição a `/auth/callback` com um código inválido, expirado ou já utilizado
- **WHEN** a troca por sessão é executada
- **THEN** nenhuma sessão SHALL ser criada e o usuário SHALL ser redirecionado para `/login?erro=auth`, sem
  expor mensagem do Supabase ou stack trace

### Requirement: Destino pós-login restrito a caminho interno

O parâmetro `next` SHALL ser aceito apenas quando representar um caminho relativo interno, isto é, quando
começar por `/` e não por `//`. Qualquer outro valor — URL absoluta, esquema `javascript:`, string vazia ou
parâmetro ausente — SHALL ser substituído por `/`. Nenhum valor vindo do cliente SHALL ser usado como URL
completa de redirecionamento.

#### Scenario: Caminho interno é preservado

- **GIVEN** uma requisição a `/auth/callback?code=<válido>&next=/vaga/123`
- **WHEN** o login é concluído
- **THEN** o usuário SHALL ser redirecionado para `/vaga/123`

#### Scenario: URL externa é descartada

- **GIVEN** uma requisição a `/auth/callback?code=<válido>&next=https://evil.com`
- **WHEN** o login é concluído
- **THEN** o usuário SHALL ser redirecionado para `/` e nenhum redirecionamento para fora do domínio SHALL
  ocorrer

#### Scenario: Protocolo-relative URL é descartada

- **GIVEN** uma requisição a `/auth/callback?code=<válido>&next=//evil.com`
- **WHEN** o login é concluído
- **THEN** o usuário SHALL ser redirecionado para `/`

#### Scenario: Esquema perigoso é descartado

- **GIVEN** uma requisição a `/auth/callback?code=<válido>&next=javascript:alert(1)`
- **WHEN** o login é concluído
- **THEN** o usuário SHALL ser redirecionado para `/` e o valor SHALL NOT ser interpretável como URL
