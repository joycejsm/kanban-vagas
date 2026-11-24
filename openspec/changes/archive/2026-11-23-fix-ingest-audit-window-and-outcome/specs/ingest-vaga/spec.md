# ingest-vaga — Spec Delta

## MODIFIED Requirements

### Requirement: Limite de uso por usuário

O sistema SHALL aplicar no máximo 20 ingestões por hora e 100 por dia, por usuário. Cada tentativa aceita
deverá ser registrada em uma tabela de auditoria protegida por RLS, **antes** de qualquer trabalho caro, e a
contagem da janela SHALL incluir o próprio registro corrente. Ao exceder o limite, a função SHALL responder
`429` antes de qualquer requisição de rede.

Toda tentativa registrada SHALL terminar com o desfecho gravado. Isso inclui a falha no caminho da própria
auditoria: se a contagem da janela falhar **depois** do registro, a linha existente SHALL ser fechada como
`erro` antes de a resposta ser enviada, e a etapa da falha SHALL constar no log.

#### Scenario: Ingestão dentro do limite é aceita

- **GIVEN** um usuário com 19 ingestões na hora corrente
- **WHEN** ele faz uma nova chamada
- **THEN** a chamada SHALL ser processada normalmente

#### Scenario: Limite horário excedido

- **GIVEN** um usuário que já fez 20 ingestões na hora corrente
- **WHEN** ele faz uma nova chamada
- **THEN** a resposta SHALL ser `429` com mensagem em pt-BR e nenhuma requisição externa SHALL ser feita

#### Scenario: Limite diário excedido

- **GIVEN** um usuário que já fez 100 ingestões no dia corrente, mesmo com menos de 20 na hora
- **WHEN** ele faz uma nova chamada
- **THEN** a resposta SHALL ser `429`

#### Scenario: A auditoria fica isolada por usuário

- **GIVEN** dois usuários autenticados com registros de auditoria
- **QUANDO** um deles consulta a tabela de auditoria
- **ENTÃO** o resultado SHALL conter apenas os próprios registros, e o cliente anônimo não SHALL obter acesso

#### Scenario: Nenhuma tentativa fica com o desfecho pendente

- **GIVEN** uma tentativa registrada cuja contagem de janela falha
- **WHEN** a função responde
- **THEN** o registro da tentativa SHALL estar com resultado diferente de `pendente`, e o log SHALL nomear a
  etapa da auditoria

#### Scenario: Falha no registro não tenta fechar linha que não existe

- **GIVEN** uma falha ao registrar a tentativa
- **WHEN** a função responde
- **THEN** nenhuma gravação de desfecho SHALL ser tentada e a resposta SHALL ser genérica, sem detalhe do banco
