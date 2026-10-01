# ingest-audit — Spec Delta

## MODIFIED Requirements

### Requirement: Consulta de limite dentro do banco

O banco SHALL oferecer uma forma de consultar a quantidade de ingestões de um usuário em uma janela de tempo,
usada pela função para aplicar os limites por hora e por dia, sem que o usuário possa influenciar no resultado
da consulta.

A janela SHALL ser informada como **valor** aceito pelo tipo da coluna (`timestamptz` em ISO 8601), e não como
expressão SQL: a superfície de consulta não avalia SQL em filtro, de modo que texto como `now() - interval
'1 hour'` é recusado pelo banco como formato inválido, e a contagem falha. As duas janelas (hora e dia) SHALL
ser derivadas do mesmo instante, para que não discordem entre si. A consulta SHALL NOT aceitar parâmetro de
usuário vindo do chamador, e sua falha SHALL ser tratada como etapa nomeada da auditoria, e não como erro
genérico.

#### Scenario: Consulta devolve contagem da janela

- **GIVEN** um usuário com 5 registros na última hora
- **WHEN** a função consulta a contagem da janela
- **THEN** o resultado SHALL ser 5 e SHALL NOT conter dados de outros usuários

#### Scenario: A janela é enviada como valor, não como SQL

- **GIVEN** uma consulta de contagem de janela
- **WHEN** a função monta o filtro
- **THEN** o valor enviado SHALL ser um instante em ISO 8601 e SHALL NOT conter `now()` nem `interval`, que o
  banco rejeita como formato inválido de `timestamptz`

#### Scenario: As duas janelas saem do mesmo instante

- **GIVEN** uma contagem de hora e de dia
- **WHEN** a função monta os dois filtros
- **THEN** os dois valores SHALL ser derivados de um único instante, e a janela do dia SHALL abranger a da hora

#### Scenario: Falha da contagem é etapa nomeada, com resposta genérica

- **GIVEN** uma contagem de janela que o banco recusa
- **WHEN** a função a executa
- **THEN** a resposta ao usuário SHALL ser genérica, sem detalhe do banco, e o log SHALL nomear a etapa da
  auditoria como causa

#### Scenario: Consulta não aceita usuário vindo do input

- **GIVEN** a superfície de consulta exposta
- **WHEN** ela é inspecionada
- **THEN** ela SHALL determinar o usuário a partir do contexto de autenticação, sem parâmetro de usuário
  fornecido pelo chamador

## ADDED Requirements

### Requirement: O desfecho é gravado na linha que a tentativa criou

A função SHALL gravar o desfecho da tentativa **no registro de auditoria que ela mesma criou**, identificado
pelo `id` devolvido no registro, e SHALL NOT inferir a linha por outra característica (host, recência ou
resultado pendente). A gravação SHALL ser verificada: uma atualização que não encontra a linha SHALL ser
distinguível de uma que gravou, e um erro devolvido pelo banco SHALL ser tratado como falha, e não descartado.

A superfície de atualização SHALL ignorar, em requisições de escrita, ordenação e limite: ordenar e limitar
não são aplicados pela API de escrita, de modo que um filtro por "linha mais recente" atualiza todas as
linhas compatíveis, e duas requisições simultâneas podem fechar a tentativa uma da outra.

#### Scenario: O desfecho vai para a linha da própria tentativa

- **GIVEN** uma tentativa registrada com o `id` `A` e outra tentativa pendente do mesmo usuário com o `id` `B`
- **WHEN** a primeira chamada grava o desfecho
- **THEN** a linha `A` SHALL ter o resultado gravado e a linha `B` SHALL continuar pendente

#### Scenario: Duas requisições simultâneas não fecham a linha uma da outra

- **GIVEN** duas requisições do mesmo usuário, cada uma registrando a sua tentativa
- **WHEN** uma delas falha e a outra tem sucesso
- **THEN** cada linha SHALL receber o desfecho da sua própria requisição

#### Scenario: Falha ao gravar o desfecho é registrada, não engole

- **GIVEN** uma resposta de erro do banco ao gravar o desfecho
- **WHEN** a função a recebe
- **THEN** a falha SHALL constar no log com a etapa da auditoria e o código do banco, e a resposta ao usuário
  SHALL NOT depender dela

#### Scenario: Atualização que não encontrou a linha é distinguível

- **GIVEN** uma gravação de desfecho que não encontra o registro
- **WHEN** a API de escrita devolve sucesso sem linhas afetadas
- **THEN** a função SHALL poder distinguir esse caso de uma gravação efetiva
