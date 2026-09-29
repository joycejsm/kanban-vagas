# Spec Delta

## ADDED Requirements

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
