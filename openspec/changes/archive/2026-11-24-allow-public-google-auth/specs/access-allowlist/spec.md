# Spec Delta

## MODIFIED Requirements

### Requirement: E-mail precisa estar na allowlist

O acesso SHALL ser permitido somente para e-mails presentes em `ALLOWED_EMAILS`. Quando `ALLOWED_EMAILS` contiver o caractere curinga `*`, qualquer e-mail válido autenticado pelo provedor SHALL ser considerado autorizado. Quando o e-mail do usuário autenticado não estiver na lista e a lista não contiver `*`, a sessão SHALL ser encerrada imediatamente e o navegador SHALL ser redirecionado para `/login?erro=nao_autorizado`. A comparação SHALL ser feita sobre o valor do e-mail fornecido pelo provedor, sem transformações implícitas que ampliem o alcance da autorização.

#### Scenario: E-mail autorizado conclui o acesso

- **GIVEN** um usuário cujo e-mail está em `ALLOWED_EMAILS`
- **WHEN** ele conclui o login
- **THEN** a sessão SHALL permanecer ativa e ele SHALL ser direcionado à aplicação

#### Scenario: Curinga '*' autoriza qualquer e-mail autenticado

- **GIVEN** `ALLOWED_EMAILS` contendo o caractere curinga `*` e um usuário com e-mail válido não listado nominalmente
- **WHEN** ele conclui o login
- **THEN** a sessão SHALL permanecer ativa e ele SHALL ser direcionado à aplicação

#### Scenario: E-mail não autorizado tem a sessão encerrada

- **GIVEN** um usuário Google cujo e-mail não está em `ALLOWED_EMAILS` e a lista não contém `*`
- **WHEN** ele conclui o login
- **THEN** a sessão SHALL ser encerrada e o usuário SHALL ser redirecionado para
  `/login?erro=nao_autorizado`

#### Scenario: Sessão encerrada não dá acesso às rotas privadas

- **GIVEN** um usuário cuja sessão foi encerrada por e-mail não autorizado
- **WHEN** ele tenta acessar `/`
- **THEN** o middleware SHALL redirecioná-lo para `/login`, sem revelar o conteúdo da rota
