# Spec Delta

## Purpose

Define o contrato de domínio da entidade `Vaga`: quais campos existem, quais limites de tamanho se aplicam a
cada entrada e quais valores são aceitos para `status` e `senioridade`. Este contrato é a fonte única de
verdade compartilhada entre o frontend Next.js e as Edge Functions em Deno.

## ADDED Requirements

### Requirement: Schema de entrada da Vaga

O sistema SHALL fornecer um schema de entrada da `Vaga` (`VagaCreateInput`) que aceite apenas os campos
pertencentes ao usuário — `url`, `titulo`, `empresa`, `requisitos` e `senioridade` — e que rejeite chaves
adicionais. O schema SHALL NOT conter `id`, `user_id`, `status`, `ordem`, `created_at` ou `updated_at`, pois
esses valores são derivados do servidor ou do estado do quadro.

#### Scenario: Entrada válida é aceita

- **GIVEN** um payload com `url` `https://empresa.com/vaga/1`, `titulo` `Engenheira de Software`,
  `empresa` `Empresa X`, `requisitos` `["TypeScript", "Postgres"]` e `senioridade` `Senior`
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL resultar em sucesso e o resultado SHALL conter exatamente esses cinco campos

#### Scenario: Payload com campo de servidor é rejeitado

- **GIVEN** um payload válido acrescido de `user_id`, `id`, `status` ou `ordem`
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar informando que chaves adicionais não são permitidas

#### Scenario: `senioridade` ausente assume o valor padrão

- **GIVEN** um payload válido sem o campo `senioridade`
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** o resultado validado SHALL conter `senioridade` igual a `Não informado`

### Requirement: Limites de tamanho da entrada

O schema de entrada da `Vaga` SHALL impor limites de tamanho em todas as entradas externas, rejeitando valores
fora da faixa: `url` com no máximo 2048 caracteres e obrigatoriamente no esquema `https`; `titulo` e `empresa`
com 1 a 200 caracteres; `requisitos` como array de strings com no máximo 30 itens, cada um com 1 a 300
caracteres; `senioridade` restrita a `Junior`, `Pleno`, `Senior` ou `Não informado`.

#### Scenario: URL não-HTTPS é rejeitada

- **GIVEN** um payload com `url` `http://empresa.com/vaga/1`
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por violação do esquema de URL

#### Scenario: URL acima do limite é rejeitada

- **GIVEN** um payload com `url` `https://` seguido de 2049 caracteres
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por violação do limite de tamanho da URL

#### Scenario: Título ou empresa vazios são rejeitados

- **GIVEN** um payload com `titulo` vazio ou com `empresa` de 201 caracteres
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por violação do intervalo de tamanho

#### Scenario: Lista de requisitos fora dos limites é rejeitada

- **GIVEN** um payload com 31 itens em `requisitos`, ou com um item de 301 caracteres, ou com um item vazio
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por violação dos limites de `requisitos`

#### Scenario: Valor de senioridade desconhecido é rejeitado

- **GIVEN** um payload com `senioridade` `Estágio`
- **WHEN** o payload é validado pelo schema `VagaCreateInput`
- **THEN** a validação SHALL falhar por valor fora do conjunto permitido

### Requirement: Enum de status da candidatura

O domínio SHALL definir o enum `StatusVaga` com exatamente os valores `aplicado`, `entrevista_1`,
`fase_tecnica`, `proposta` e `rejeitado`, e nenhum outro valor SHALL ser aceito como status de uma vaga.

#### Scenario: Valores canônicos são aceitos

- **GIVEN** um valor entre `aplicado`, `entrevista_1`, `fase_tecnica`, `proposta` e `rejeitado`
- **WHEN** o valor é validado contra o enum `StatusVaga`
- **THEN** a validação SHALL resultar em sucesso

#### Scenario: Status fora do enum é rejeitado

- **GIVEN** o valor `entrevistado` ou uma string vazia
- **WHEN** o valor é validado contra o enum `StatusVaga`
- **THEN** a validação SHALL falhar

### Requirement: Schema de leitura do registro persistido

O domínio SHALL fornecer um schema `VagaRow` que descreva o registro completo da vaga no banco, incluindo `id`
(UUID), `user_id` (UUID), `url`, `url_normalizada`, `titulo`, `empresa`, `requisitos`, `senioridade`,
`status`, `ordem`, `created_at` e `updated_at`. O sistema SHALL exportar os tipos `VagaCreateInput`, `VagaRow`,
`StatusVaga` e `Senioridade` derivados do schema, para uso em TypeScript com `strict` habilitado.

#### Scenario: Registro vindo do banco é validado

- **GIVEN** uma linha retornada pelo banco com todos os campos preenchidos
- **WHEN** a linha é validada pelo schema `VagaRow`
- **THEN** a validação SHALL resultar em sucesso e o resultado SHALL ser utilizável como tipo `VagaRow`

#### Scenario: Registro com status fora do enum é rejeitado

- **GIVEN** uma linha cujo campo `status` contém um valor não previsto no enum
- **WHEN** a linha é validada pelo schema `VagaRow`
- **THEN** a validação SHALL falhar, sinalizing dado inconsistente no banco

#### Scenario: `requisitos` ausente ou nulo é rejeitado

- **GIVEN** uma linha sem o campo `requisitos` ou com `requisitos` nulo
- **WHEN** a linha é validada pelo schema `VagaRow`
- **THEN** a validação SHALL falhar
