# Spec Delta

## Purpose

Garantir que toda rota da aplicação, com exceção das explicitamente públicas, só seja acessível a partir de uma
sessão Supabase validada no servidor, e que a sessão do usuário seja mantida e renovada ao longo das
requisições sem depender de dados de cookie não verificados.

## ADDED Requirements

### Requirement: Sessão validada no servidor a cada requisição

O middleware SHALL criar um cliente Supabase server-side a cada requisição, transportar os cookies de sessão
para as chamadas ao Supabase e validar a sessão chamando `getUser()` — ou seja, confirmando o token junto ao
serviço de autenticação. O middleware SHALL NOT considerar o usuário autenticado com base apenas em
`getSession()` ou na presença de cookies. O resultado da validação SHALL ser propagado às Server Actions e às
funções de acesso a dados por meio de cookies, e a sessão SHALL ser renovada com o cookie issued pelo Supabase.

#### Scenario: Cookie de sessão válido é aceito

- **GIVEN** uma requisição com cookies de sessão válidos para um usuário existente
- **WHEN** o middleware processa a requisição
- **THEN** o usuário SHALL ser considerado autenticado e a requisição SHALL seguir para a rota de destino

#### Scenario: Cookie adulterado é rejeitado

- **GIVEN** uma requisição cujo cookie de sessão foi adulterado ou expirado
- **WHEN** o middleware chama `getUser()`
- **THEN** o usuário SHALL ser tratado como não autenticado e a rota privada SHALL redirecionar para `/login`

#### Scenario: Sessão é renovada durante a navegação

- **GIVEN** um usuário autenticado que navega por várias páginas privadas
- **WHEN** o Supabase responde à validação com um token renovado
- **THEN** o middleware SHALL gravar o novo cookie de sessão na resposta e as requisições seguintes SHALL
  seguir autenticadas

### Requirement: Rotas privadas exigem autenticação

O middleware SHALL considerar privada toda rota que não conste na lista de rotas públicas. Ao acessar rota
privada sem sessão válida, o usuário SHALL ser redirecionado para `/login`. A proteção SHALL NOT se limitar à
raiz `/` — rotas adicionais do quadro SHALL ser protegidas com o mesmo comportamento. `/login` e
`/auth/callback` SHALL ser públicas.

#### Scenario: Visitante anônimo na raiz é redirecionado

- **GIVEN** um visitante sem sessão válida
- **WHEN** ele acessa `/`
- **THEN** o middleware SHALL responder com redirecionamento para `/login`

#### Scenario: Visitante anônimo em rota privada além da raiz

- **GIVEN** um visitante sem sessão válida
- **WHEN** ele acessa qualquer rota privada que não seja a raiz
- **THEN** o middleware SHALL responder com redirecionamento para `/login`, com o mesmo comportamento da raiz

#### Scenario: Rota privada com sessão válida é servida normalmente

- **GIVEN** um usuário com sessão válida
- **WHEN** ele acessa `/`
- **THEN** a requisição SHALL seguir sem redirecionamento e a página SHALL ser renderizada

#### Scenario: Rotas públicas permanecem acessíveis

- **GIVEN** um visitante sem sessão válida
- **WHEN** ele acessa `/login` ou `/auth/callback`
- **THEN** o middleware SHALL deixar a requisição seguir, sem redirecionar

### Requirement: Usuário autenticado não permanece na tela de login

Quando um usuário com sessão válida acessar `/login`, o middleware SHALL redirecioná-lo para `/`.

#### Scenario: Sessão válida na tela de login

- **GIVEN** um usuário com sessão válida
- **WHEN** ele acessa `/login`
- **THEN** o middleware SHALL responder com redirecionamento para `/`

#### Scenario: Sessão ausente na tela de login

- **GIVEN** um visitante sem sessão válida
- **WHEN** ele acessa `/login`
- **THEN** a página de login SHALL ser renderizada normalmente

### Requirement: Escopo do matcher

O `matcher` do middleware SHALL excluir requisições de arquivos estáticos e de infraestrutura do framework —
`_next/static`, `_next/image`, `favicon.ico` e demais assets com extensão de arquivo — de modo que o
middleware não seja executado para esses recursos.

#### Scenario: Asset estático não passa pelo middleware

- **GIVEN** uma requisição para um arquivo estático em `_next/static` ou para o favicon
- **WHEN** o matcher é avaliado
- **THEN** o middleware SHALL NOT ser executado para essa requisição
