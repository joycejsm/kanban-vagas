# Spec Delta

## MODIFIED Requirements

### Requirement: Movimentação de card entre colunas

Cada card SHALL oferecer um controle de seleção rotulado com o destino, listando **apenas** as colunas
diferentes da coluna atual do card. Escolher um destino SHALL mover o card para a coluna escolhida e SHALL
disparar a atualização da vaga no servidor. O card movido SHALL ser reposicionado no fim da coluna de destino.
Enquanto a atualização está em curso, o controle de seleção do card SHOULD permanecer desabilitado, e a
movimentação SHALL ser refletida na tela antes da resposta do servidor.

Adicionalmente, os cards SHALL permitir movimentação direta entre as colunas através de gestos de arrastar e
soltar (drag and drop). O gesto de arraste SHALL exigir uma distância mínima de ativação (mínimo de 8px) para
impedir que cliques em links e botões sejam interpretados acidentalmente como início de arraste. Ao soltar o
card sobre uma coluna de destino válida, a vaga SHALL ser movida e o servidor SHALL ser notificado via
atualização de status com persistência de ordem. Em caso de recusa ou erro na comunicação com o servidor, o card
movido via drag and drop SHALL ser revertido imediatamente à sua posição anterior na coluna de origem.

#### Scenario: Seletor lista somente as outras colunas

- **GIVEN** um card na coluna `aplicado`
- **WHEN** a coluna de destino é aberta no seletor
- **THEN** ela SHALL listar `entrevista_1`, `fase_tecnica`, `proposta` e `rejeitado`, e SHALL NOT listar
  `aplicado` nem uma opção inativa de "movido"

#### Scenario: Escolher um destino move o card

- **GIVEN** um card na coluna `aplicado`
- **WHEN** a pessoa usuária escolhe `fase_tecnica` no seletor
- **THEN** o card SHALL passar a ser exibido na coluna `fase_tecnica` e a atualização da vaga no servidor
  SHALL ter sido disparada

#### Scenario: Card movido entra no fim da coluna de destino

- **GIVEN** a coluna `fase_tecnica` com três cards
- **WHEN** um card da coluna `aplicado` é movido para `fase_tecnica`
- **THEN** ele SHALL ser exibido após os três cards existentes, como quarto da coluna

#### Scenario: Falha na movimentação reverte o card

- **GIVEN** um card na coluna `aplicado` e uma resposta de falha do servidor ao mover
- **WHEN** a falha é recebida
- **THEN** o card SHALL retornar à coluna `aplicado` e a tela SHALL exibir a mensagem de erro devolvida pela
  operação, sem o card duplicado nas duas colunas

#### Scenario: Destino é sempre um valor do enum

- **GIVEN** um card em qualquer coluna
- **WHEN** a lista de destinos é montada ou o drop é avaliado
- **THEN** o status SHALL ser validado estritamente como um valor do enum de status de vaga, nunca aceitando
  valores arbitrários da interface

#### Scenario: Arrastar e soltar card em outra coluna atualiza a coluna do card

- **GIVEN** um card na coluna `aplicado`
- **WHEN** a pessoa usuária arrasta o card e o solta sobre a coluna `entrevista_1`
- **THEN** o card SHALL ser reposicionado imediatamente na coluna `entrevista_1` de forma otimista e a
  atualização de status com a nova ordem SHALL ser enviada ao servidor

#### Scenario: Arraste requer distância mínima para não interferir em cliques

- **GIVEN** um card no quadro contendo link externo e botões de ação
- **WHEN** a pessoa usuária clica ou pressiona com movimento inferior a 8 pixels
- **THEN** nenhum gesto de arraste SHALL ser iniciado e a ação de clique do elemento-alvo SHALL ser preservada

#### Scenario: Falha no drag-and-drop reverte o card à posição original

- **GIVEN** um card arrastado para outra coluna e uma falha retornada pelo servidor
- **WHEN** a resposta de erro é processada
- **THEN** o card SHALL retornar exatamente à sua coluna e ordem anteriores e a mensagem de erro SHALL ser
  exibida no topo do quadro
