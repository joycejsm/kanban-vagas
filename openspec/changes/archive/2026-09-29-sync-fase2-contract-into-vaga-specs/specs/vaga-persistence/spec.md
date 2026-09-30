# Spec Delta

## ADDED Requirements

### Requirement: Posição de entrada da vaga no quadro

Uma vaga criada por ingestão automatizada SHALL ser persistida na coluna de status inicial `aplicado`, e o seu
`ordem` SHALL ser calculado no servidor como o valor imediatamente superior ao maior `ordem` existente naquela
mesma coluna para o mesmo usuário — isto é, a vaga nova SHALL entrar no fim da coluna de destino. Esse cálculo
SHALL ser distinto do valor padrão `0` da coluna `ordem`, que se aplica a uma inserção que não informe `ordem`
por nenhum caminho. Uma coluna sem vagas SHALL receber `ordem` igual a `0`.

O cálculo SHALL ocorrer no servidor e SHALL considerar somente as vagas do usuário autenticado que realiza a
inserção, de modo que a posição de uma vaga no quadro não dependa da movimentação de outro usuário. A escrita
SHALL ocorrer sob a sessão do próprio usuário, de modo que as políticas de Row Level Security se apliquem a esta
inserção como a qualquer outra.

#### Scenario: Vaga ingerida entra no fim da coluna `aplicado`

- **GIVEN** um usuário com vagas em `aplicado` com `ordem` `0`, `1` e `2`
- **WHEN** uma nova vaga é ingerida para esse usuário
- **THEN** a vaga persistida SHALL ter `status` `aplicado` e `ordem` `3`

#### Scenario: Primeira vaga da coluna recebe ordem zero

- **GIVEN** um usuário sem nenhuma vaga em `aplicado`
- **WHEN** uma nova vaga é ingerida para esse usuário
- **THEN** a vaga persistida SHALL ter `status` `aplicado` e `ordem` `0`

#### Scenario: Colunas de outros status não afetam a posição

- **GIVEN** um usuário com uma vaga em `entrevista_1` com `ordem` `99` e nenhuma vaga em `aplicado`
- **WHEN** uma nova vaga é ingerida para esse usuário
- **THEN** a vaga persistida SHALL ter `ordem` `0`, pois o maior `ordem` de `entrevista_1` não é considerado

#### Scenario: Movimentação de outro usuário não altera a posição

- **GIVEN** o usuário A com uma vaga em `aplicado` com `ordem` `0`
- **WHEN** o usuário B, que tem uma vaga em `aplicado` com `ordem` `50`, ingere uma nova vaga
- **THEN** a vaga do usuário B persistida SHALL ter `ordem` `51`, e a vaga do usuário A SHALL continuar com
  `ordem` `0`
