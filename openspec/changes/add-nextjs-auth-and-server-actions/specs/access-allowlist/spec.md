# Spec Delta

## Purpose

Restringir o uso do aplicativo aos e-mails explicitamente autorizados, aplicando a verificação no momento do
login e também na criação da conta no Supabase Auth, para que nem um callback manipulado nem um signup direto
consigam contornar a restrição.

## ADDED Requirements

### Requirement: E-mail precisa estar na allowlist

O acesso SHALL ser permitido somente para e-mails presentes em `ALLOWED_EMAILS`. Quando o e-mail do usuário
autenticado não estiver na lista, a sessão SHALL ser encerrada imediatamente e o navegador SHALL ser
redirecionado para `/login?erro=nao_autorizado`. A comparação SHALL ser feita sobre o valor do e-mail
fornecido pelo provedor, sem transformações implícitas que ampliem o alcance da autorização.

#### Scenario: E-mail autorizado conclui o acesso

- **GIVEN** um usuário cujo e-mail está em `ALLOWED_EMAILS`
- **WHEN** ele conclui o login
- **THEN** a sessão SHALL permanecer ativa e ele SHALL ser direcionado à aplicação

#### Scenario: E-mail não autorizado tem a sessão encerrada

- **GIVEN** um usuário Google cujo e-mail não está em `ALLOWED_EMAILS`
- **WHEN** ele conclui o login
- **THEN** a sessão SHALL ser encerrada e o usuário SHALL ser redirecionado para
  `/login?erro=nao_autorizado`

#### Scenario: Sessão encerrada não dá acesso às rotas privadas

- **GIVEN** um usuário cuja sessão foi encerrada por e-mail não autorizado
- **WHEN** ele tenta acessar `/`
- **THEN** o middleware SHALL redirecioná-lo para `/login`, sem revelar o conteúdo da rota

### Requirement: Bloqueio de e-mail não autorizado na criação da conta

O banco SHALL fornecer uma função Postgres para o hook **Before User Created** do Auth que inspecione o e-mail
do novo usuário e rejeite a criação da conta quando o e-mail não estiver na allowlist. A função SHALL ser
definida com privilégios mínimos e sem elevar privilégios de forma permanente. A ativação do hook no painel do
Supabase e a manutenção apenas do provedor Google SHALL permanecer como pré-requisito manual documentado, sem
automação por código.

#### Scenario: Hook rejeita e-mail fora da lista

- **GIVEN** a função de hook instalada e um novo usuário Google com e-mail fora da allowlist
- **WHEN** o Auth tenta criar a conta
- **THEN** a criação SHALL ser rejeitada e a conta SHALL NOT ser criada

#### Scenario: Hook permite e-mail da lista

- **GIVEN** a função de hook instalada e um novo usuário Google com e-mail presente na allowlist
- **WHEN** o Auth cria a conta
- **THEN** a criação SHALL ser concluída normalmente

#### Scenario: Ativação é passo manual documentado

- **GIVEN** o projeto Supabase com a função de hook definida
- **WHEN** a documentação de implantação é seguida
- **THEN** o texto SHALL listar, como passo manual, ativar o hook no painel e manter apenas o Google como
  provedor, sem nenhuma chamada de API feita pelo código da aplicação
