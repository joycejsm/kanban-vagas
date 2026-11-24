# Design

## Context

O quadro Kanban atual (implementado na Fase 4) renderiza 5 colunas estáticas e projeta cada vaga em um card Client Component. A movimentação é realizada disparando a Server Action `atualizarStatus({ vagaId, novoStatus, ordem })` via um formulário com `<select>`.
O serviço de dados (`vagaService.ts`) e o schema de banco de dados (`vagas.sql`) já persistem a coluna `ordem` e ordenam por `status, ordem, created_at`. Portanto, o backend já está 100% preparado para receber ordenação e novas colunas, necessitando apenas da camada de interação visual de drag-and-drop no frontend.

## Goals / Non-Goals

**Goals:**
- Permitir arrastar e soltar cards entre colunas com feedback visual imediato (hover na coluna e preview flutuante `DragOverlay`).
- Permitir reordenação de cards dentro da mesma coluna.
- Preservar o seletor `<select>` para acessibilidade completa via teclado e leitores de tela.
- Manter o comportamento otimista e reversão em caso de erro sem recarregar a página.
- Não introduzir regressões nos testes existentes (`render.test.ts`, `estado.test.ts`).

**Non-Goals:**
- Alterar schemas do banco de dados PostgreSQL ou migrations.
- Alterar as assinaturas das Server Actions existentes (`atualizarStatus`).
- Implementar transições complexas de animação baseadas em bibliotecas pesadas de animação (Framer Motion).

## Decisions

### D1 — Biblioteca de Drag and Drop: `@dnd-kit`
* **Escolha:** `@dnd-kit/core`, `@dnd-kit/sortable` e `@dnd-kit/utilities`.
* **Racional:** Biblioteca moderna, modular, acessível por padrão, com excelente suporte a touch/pointer em dispositivos móveis e desktop, e compatível com React 19 (`peerDependencies >= 16.8.0`).
* **Alternativas rejeitadas:**
  - *HTML5 Drag and Drop nativo:* Péssimo suporte em dispositivos móveis/telas sensíveis ao toque e controle limitado sobre o clone visual arrastado.
  - *`react-beautiful-dnd`:* Descontinuada e não compatível nativamente com versões recentes do React (React 18/19).

### D2 — Preservação do `<select>` como canal acessível
* **Decisão:** Manter o `<select>` de movimentação em cada card.
* **Racional:** O drag-and-drop adiciona uma camada de conveniência gestual, mas o controle `<select>` fornece um método determinístico e acessível para tecnologias assistivas. Além disso, mantém compatibilidade total com os testes unitários de renderização existentes em `tests/quadro/render.test.ts`.

### D3 — Sensores com restrição de ativação por distância
* **Decisão:** Configurar `PointerSensor` com ativação restrita por distância mínima de 8px:
  ```ts
  useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8,
    },
  })
  ```
* **Racional:** Evita que cliques rápidos no link do anúncio ("Ver anúncio →") ou no botão "Remover" sejam interceptados ou bloqueados como tentativas de arraste.

### D4 — Arquitetura de Componentes e DragOverlay
* **Decisão:**
  - `DndContext` envolve a grade de colunas em `Quadro.tsx`.
  - Cada `Coluna` atua como área de drop (`useDroppable`) identificada pelo `status`.
  - Cada `Cartao` utiliza `useDraggable` (ou `useSortable`) com o `id` da vaga.
  - Um componente `DragOverlay` renderiza o card ativo em trânsito com elevação e sombra destacada (`shadow-lg`).

### D5 — Unificação do fluxo de atualização otimista
* **Decisão:** O evento `onDragEnd` calcula o novo status e a nova ordem do card e aciona a mesma função interna `moverPara` já existente.
* **Racional:** Toda a lógica de estado otimista, reversão em caso de falha de rede e chamada da Server Action `atualizarStatus` permanece centralizada em um único ponto testado.

## Risks / Trade-offs

- **[Conflito de clique com início de arraste]** → Mitigado pela restrição de distância de 8 pixels no sensor de ponteiro.
- **[Hidratação / SSR]** → Componentes que usam sensores do `@dnd-kit` só são instanciados no cliente (`'use client'` já presente em `Quadro.tsx`). O render inicial no servidor continua entregando o HTML puro das colunas e cards sem erros.
