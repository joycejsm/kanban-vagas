# Spec Delta

## MODIFIED Requirements

### Requirement: Autenticação e allowlist de e-mail

A função SHALL exigir um token de sessão válido, validando o usuário com o token recebido, e SHALL recusar chamadas sem sessão com `401`. Quando `ALLOWED_EMAILS` contiver o caractere curinga `*`, a conferência de allowlist SHALL aceitar qualquer usuário autenticado com sessão válida. Quando o e-mail do usuário não estiver na allowlist e a lista não contiver `*`, a função SHALL encerrar o acesso e responder `403`. Nenhuma das duas verificações pode ser contornada por parâmetro do corpo ou da query string.

#### Scenario: Sem Authorization é recusado

- **GIVEN** uma requisição sem cabeçalho `Authorization` ou com token inválido
- **WHEN** a função é invocada
- **THEN** a resposta SHALL ser `401` e nenhuma extração SHALL ser executada

#### Scenario: E-mail fora da allowlist é recusado

- **GIVEN** um usuário autenticado cujo e-mail não está em `ALLOWED_EMAILS` e a lista não contém `*`
- **WHEN** ele chama a função
- **THEN** a resposta SHALL ser `403` com mensagem genérica em pt-BR

#### Scenario: E-mail autorizado tem a chamada aceita

- **GIVEN** um usuário autenticado cujo e-mail está em `ALLOWED_EMAILS`
- **WHEN** ele chama a função com uma URL válida
- **THEN** a validação de acesso SHALL passar e o pipeline SHALL prosseguir

#### Scenario: Curinga '*' aceita qualquer usuário autenticado

- **GIVEN** `ALLOWED_EMAILS` configurado com `*` e uma requisição com token de usuário autenticado válido
- **WHEN** a função é invocada
- **THEN** a conferência de allowlist SHALL passar e o pipeline SHALL prosseguir até a extração
