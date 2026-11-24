# Proposal

## Why

Atualmente, a movimentação de cards no quadro Kanban é realizada exclusivamente através de um elemento `<select>` presente em cada card. Embora acessível e funcional, a interação natural esperada em um quadro Kanban é arrastar e soltar (drag and drop) os cards entre as colunas e reordená-los visualmente.

A inclusão de drag and drop utilizando `@dnd-kit` proporciona uma experiência de uso ágil e fluida no desktop e no mobile, preservando o seletor `<select>` como alternativa acessível e mantendo o contrato já existente de Server Actions e persistência sem necessidade de alterações no banco de dados.

## What Changes

- **Suporte a arrastar e soltar cards (Drag and Drop):** Integração do `@dnd-kit/core` e `@dnd-kit/sortable` no componente `Quadro`, permitindo que os cards sejam arrastados diretamente entre as 5 colunas do quadro.
- **Feedback visual de arraste:** Exibição de indicador de arrastabilidade, feedback de hover na coluna de destino e `DragOverlay` com estilo do card em trânsito.
- **Sensores configurados com tolerância:** Configuração de `PointerSensor` com restrição de ativação por distância (mínimo de 8px) para evitar disparos acidentais ao clicar em links ("Ver anúncio →") ou botões ("Remover").
- **Acessibilidade preservada:** O seletor `<select>` de movimentação manual continua presente e funcional em cada card, garantindo conformidade com navegação por teclado e leitores de tela sem regressões.
- **Reordenação e persistência:** Ao soltar um card em uma coluna de destino ou reordenar na mesma coluna, o estado otimista é aplicado imediatamente e sincronizado com o servidor através da Server Action `atualizarStatus` já existente.

## Capabilities

### Modified Capabilities
- `kanban-board`: O requisito de movimentação de cards passa a contemplar arrastar e soltar (drag-and-drop) entre colunas com feedback visual e atualização otimista, mantendo o controle de seleção como via acessível.

## Impact

- **Dependências:** Adiciona `@dnd-kit/core`, `@dnd-kit/sortable` e `@dnd-kit/utilities` ao `package.json`.
- **Código Frontend:** Afeta `src/quadro/Quadro.tsx`, `src/quadro/estado.ts` e `src/quadro/colunas.ts` (funções puras de movimentação e reordenação com suporte a drop).
- **Testes:** Afeta `tests/quadro/estado.test.ts` e `tests/quadro/render.test.ts`.
- **Banco de Dados e Server Actions:** Nenhum impacto. A coluna `ordem` e a action `atualizarStatus({ vagaId, novoStatus, ordem })` já estão implementadas e preparadas para esta fase desde a Fase 4.
