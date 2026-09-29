# Proposal

## Why

O projeto Supabase está vazio e não existe nenhum contrato de domínio para a `Vaga`, a entidade central do
Kanban. Sem um modelo único validado por Zod, uma migração com RLS e um serviço de acesso a dados, as fases
seguintes (Edge Function de extração, Server Actions e UI com @dnd-kit) teriam cada uma a sua própria noção de
"vaga", e qualquer acesso a dados seria feito sem garantia de isolamento entre usuários.

Esta change estabelece a camada de domínio e de persistência: o schema validado, o primeiro e único arquivo de
migração (tabela + RLS + policies + triggers na mesma transação) e o contrato do `vagaService` — sem
implementar UI, Edge Functions ou autenticação.

## What Changes

- **Novo módulo de domínio** `src/domain/vaga.ts` com os schemas Zod `VagaCreateInput`, `VagaRow` e
  `StatusVaga`, exportando os tipos derivados com `z.infer`. `VagaCreateInput` deliberadamente não aceita
  `id`, `user_id`, `status`, `ordem` ou `created_at`: o `user_id` vem sempre do servidor e a ordem é um
  detalhe de apresentação do quadro.
- **Primeira migração SQL** `supabase/migrations/<timestamp>_vagas.sql` criando `public.vagas` com:
  - `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade`;
  - CHECK constraints em `status` e `senioridade` espelhando exatamente os enums do Zod;
  - `requisitos` com CHECK de tamanho máximo (≤ 30 itens, cada um ≤ 300 caracteres);
  - `ordem` numérica para a posição dentro da coluna do Kanban;
  - `created_at` / `updated_at` com trigger de `updated_at`;
  - `url_normalizada` calculada por trigger/constraint (host minúsculo, sem fragmento, sem parâmetros `utm_*`,
    sem barra final) e `UNIQUE (user_id, url_normalizada)`;
  - índice composto `(user_id, status, ordem)` para a leitura do quadro.
- **RLS completo na própria migração**: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policies `TO authenticated`
  para SELECT/INSERT/UPDATE/DELETE usando `(select auth.uid()) = user_id`, com `WITH CHECK` em INSERT e UPDATE;
  `REVOKE UPDATE (user_id)` para impedir troca de proprietário; `REVOKE ALL ... FROM anon`.
- **Novo serviço** `src/services/vagaService.ts` com as assinaturas `listarVagas()`, `criarVaga(input)`,
  `atualizarStatus(id, status, ordem?)` e `removerVaga(id)`, recebendo o cliente Supabase por injeção e nunca
  aceitando `user_id`; violação de unique (SQLSTATE `23505`) é traduzida para o erro de domínio
  `VagaDuplicadaError`.
- **Novo teste de RLS** `supabase/tests/vagas_rls.sql` simulando dois usuários autenticados via `set role`
  e `set request.jwt.claims`, cobrindo isolamento em leitura, INSERT com `user_id` alheio, UPDATE de
  `user_id`, cliente anônimo e duplicata por normalização de URL.

## Capabilities

### New Capabilities

- `vaga-domain`: modelo de domínio da `Vaga` — schemas Zod de entrada e de leitura, enums de `status` e
  `senioridade`, limites de tamanho e tipos exportados via `z.infer`.
- `vaga-persistence`: esquema da tabela `public.vagas`, normalização de URL, integridade deConstraints,
  timestamps automáticos, RLS/policies e revogações de privilégio.
- `vaga-service`: contrato do `vagaService` — operações de leitura, criação, movimentação de status e
  remoção, injeção do cliente, tradução de erros de banco para erros de domínio.

### Modified Capabilities

<!-- Nenhuma: é a primeira change do projeto e ainda não existem specs. -->

## Impact

- **Código novo (planejado):** `src/domain/vaga.ts`, `src/services/vagaService.ts`.
- **Banco:** primeira migração em `supabase/migrations/`, aplicada com `supabase db push`; nenhuma tabela
  existente é tocada.
- **Testes:** `supabase/tests/vagas_rls.sql`, executado contra o banco local/linked.
- **Dependências:** `@supabase/supabase-js` e `zod` (já previstas no stack); nenhum pacote novo.
- **Segredos:** nenhum introduzido. Nenhuma variável `NEXT_PUBLIC_*`; a service role key não é usada em
  nenhum fluxo (invariantes 1 e 2 do `project.md`).
- **Fora de escopo:** UI/Kanban, Edge Function de extração (Cheerio + Gemini), login Google OAuth e
  allowlist `ALLOWED_EMAILS`, deploy.
