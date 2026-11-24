# Tasks

## 1. Dependências e funções puras de ordenação

- [x] 1.1 Instalar as dependências `@dnd-kit/core`, `@dnd-kit/sortable` e `@dnd-kit/utilities` e verificar que o typecheck passa
- [x] 1.2 Em `src/quadro/estado.ts`, estender `moverCard` para suportar inserção em índice/ordem específica dentro da mesma coluna e entre colunas
- [x] 1.3 Adicionar testes unitários em `tests/quadro/estado.test.ts` cobrindo reordenação dentro da mesma coluna e movimentação para índice específico em coluna de destino
- [x] 1.4 Rodar `npm test` e confirmar que todos os testes de estado continuam verdes

## 2. Componentes e Integração do Drag-and-Drop

- [x] 2.1 Em `src/quadro/Quadro.tsx`, configurar `DndContext` com `PointerSensor` exigindo distância mínima de 8px para ativação
- [x] 2.2 Configurar `Coluna` como droppable container via `useDroppable`, aplicando destaque visual na borda quando um card for arrastado sobre ela
- [x] 2.3 Configurar `Cartao` como elemento arrastável via `useSortable` ou `useDraggable`, preservando o `<select>` de movimentação manual e botões de ação
- [x] 2.4 Adicionar `DragOverlay` no `Quadro.tsx` para exibir a réplica visual flutuante do card com elevação e sombra durante o trânsito
- [x] 2.5 No evento `onDragEnd`, calcular o destino e a nova posição e disparar a atualização otimista unificada através de `moverPara`

## 3. Validação Integrada

- [x] 3.1 Verificar e atualizar testes em `tests/quadro/render.test.ts` confirmando que os cards, o link externo e o controle `<select>` continuam renderizados sem quebra de SSR
- [x] 3.2 Rodar `npm run verificar` e comprovar 100% de sucesso em todas as suítes (typecheck, vitest, pgTAP e testes Deno)
