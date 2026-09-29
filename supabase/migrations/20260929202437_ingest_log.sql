-- =============================================================================
-- 002 - Auditoria de ingestões (limite de uso por usuário)
-- =============================================================================
-- Uma linha por tentativa de ingestão aceita, usada para aplicar os limites de
-- 20/hora e 100/dia. RLS garante que cada usuário só registra e conta os
-- próprios eventos (invariante 10: RLS na mesma migração que cria a tabela).

create table if not exists public.ingest_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  host       text not null,
  resultado  text not null default 'pendente'
               check (resultado in ('pendente', 'sucesso', 'duplicada', 'erro')),
  criado_em  timestamptz not null default now()
);

create index if not exists ingest_log_user_criado_em_idx
  on public.ingest_log (user_id, criado_em desc);

alter table public.ingest_log enable row level security;
alter table public.ingest_log force row level security;

drop policy if exists ingest_log_select on public.ingest_log;
create policy ingest_log_select on public.ingest_log
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Sem WITH CHECK de user_id: a coluna simplesmente não é atualizável (abaixo),
-- então o registro sempre nasce com o auth.uid() da sessão.
drop policy if exists ingest_log_insert on public.ingest_log;
create policy ingest_log_insert on public.ingest_log
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists ingest_log_update on public.ingest_log;
create policy ingest_log_update on public.ingest_log
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists ingest_log_delete on public.ingest_log;
create policy ingest_log_delete on public.ingest_log
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.ingest_log from anon;

-- result é gravável pelo próprio usuário (a função atualiza o desfecho da
-- tentativa); user_id e id não são.
revoke update on public.ingest_log from authenticated;
grant update (resultado) on public.ingest_log to authenticated;

comment on table public.ingest_log is
  'Auditoria das ingestões por usuário, base dos limites de uso. Isolada por RLS.';
