# Spec Delta

## Purpose

Registrar as ingestões aceitas por usuário em uma tabela de auditoria com RLS, de modo que os limites de uso
sejam aplicados no banco e que nenhum usuário consiga ler ou alterar o registro de outro.

## ADDED Requirements

### Requirement: Tabela de auditoria de ingestões

O banco SHALL fornecer uma tabela de auditoria que registre, por usuário e por chamada aceita, o instante da
ingestão, o host da URL e o resultado (sucesso, duplicidade ou erro). A tabela SHALL ser criada com RLS
habilitado e forçado e com policies na mesma migração que a cria. O `user_id` SHALL vir do servidor, nunca do
input da função.

#### Scenario: Registro é criado com o usuário da sessão

- **GIVEN** um usuário autenticado fazendo uma ingestão aceita
- **WHEN** o registro de auditoria é criado
- **THEN** o `user_id` gravado SHALL ser o da sessão e o host SHALL ser o da URL processada

#### Scenario: Registro de um usuário não é visível para outro

- **GIVEN** dois usuários autenticados com registros de auditoria
- **QUANDO** um deles consulta a tabela
- **ENTÃO** o resultado SHALL conter apenas os próprios registros

#### Scenario: Cliente anônimo não acessa a auditoria

- **GIVEN** uma conexão sem sessão autenticada
- **QUANDO** ela tenta ler a tabela de auditoria
- **ENTÃO** a operação SHALL ser negada

#### Scenario: Auditoria de usuário é removida com a conta

- **GIVEN** um usuário com registros de auditoria
- **QUANDO** a conta é excluída
- **ENTÃO** os registros SHALL ser excluídos por cascata

### Requirement: Consulta de limite dentro do banco

O banco SHALL oferecer uma forma de consultar a quantidade de ingestões de um usuário em uma janela de tempo,
usada pela função para aplicar os limites por hora e por dia, sem que o usuário possa influenciar no resultado
da consulta.

#### Scenario: Consulta devolve contagem da janela

- **GIVEN** um usuário com 5 registros na última hora
- **WHEN** a função consulta a contagem da janela
- **THEN** o resultado SHALL ser 5 e SHALL NOT conter dados de outros usuários

#### Scenario: Consulta não aceita usuário vindo do input

- **GIVEN** a superfície de consulta exposta
- **WHEN** ela é inspecionada
- **THEN** ela SHALL determinar o usuário a partir do contexto de autenticação, sem parâmetro de usuário
  fornecido pelo chamador
