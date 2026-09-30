# Spec Delta

## ADDED Requirements

### Requirement: Remoção de vaga pela interface

A Server Action `removerVaga(vagaId)` SHALL validar `vagaId` como UUID com schema Zod antes de qualquer
efeito colateral, e SHALL resolver o usuário chamando `getUser()` no servidor. A ação SHALL NOT aceitar
`user_id` da entrada e SHALL remover a linha pelo serviço de vagas usando o cliente do usuário autenticado,
de modo que a remoção ocorra sob as políticas de Row Level Security. Em caso de sucesso, a ação SHALL
revalidar o caminho `/` para que o quadro deixe de exibir a vaga. Quando a operação não afetar nenhuma
linha, a ação SHALL retornar um erro genérico informando que a vaga não foi encontrada, **sem distinguir**
entre identificador inexistente e identificador pertencente a outro usuário. Falha inesperada do serviço
SHALL virar mensagem genérica em pt-BR, sem stack trace, SQL ou detalhe interno.

#### Scenario: Remoção válida é persistida e revalida o quadro

- **GIVEN** uma vaga pertencente ao usuário autenticado
- **WHEN** a ação é chamada com o `vagaId` dessa vaga
- **THEN** a linha SHALL ser removida, a ação SHALL indicar sucesso e a revalidação de `/` SHALL ter sido
  executada

#### Scenario: `vagaId` inválido é rejeitado antes de qualquer escrita

- **GIVEN** um `vagaId` que não é UUID
- **WHEN** a Server Action é chamada
- **THEN** a validação SHALL falhar e nenhuma remoção SHALL ocorrer

#### Scenario: Entrada com `user_id` é rejeitada

- **GIVEN** uma chamada cujo payload inclui `user_id`
- **WHEN** a Server Action é chamada
- **THEN** a validação SHALL falhar e nenhuma remoção SHALL ocorrer

#### Scenario: Vaga de outro usuário não é removida

- **GIVEN** um `vagaId` que pertence a outra conta
- **WHEN** a Server Action é chamada
- **THEN** nenhuma linha SHALL ser removida e o retorno SHALL ser um erro genérico informando que a vaga não
  foi encontrada, sem confirmar que o identificador existe

#### Scenario: Identificador inexistente produz a mesma resposta

- **GIVEN** um `vagaId` que não existe no banco
- **WHEN** a Server Action é chamada
- **THEN** o código e a mensagem do retorno SHALL ser idênticos aos de uma vaga pertencente a outra conta

#### Scenario: Sessão ausente não executa a ação

- **GIVEN** uma chamada de Server Action sem sessão válida
- **WHEN** a ação é executada
- **THEN** a ação SHALL abortar sem remover nada e SHALL retornar erro de sessão expirada

#### Scenario: Falha do serviço vira mensagem genérica

- **GIVEN** uma falha inesperada na remoção
- **WHEN** a Server Action é executada
- **THEN** o retorno SHALL ser uma mensagem genérica em pt-BR com sugestão de tentar novamente, e SHALL NOT
  conter stack trace, SQL ou mensagem do banco
