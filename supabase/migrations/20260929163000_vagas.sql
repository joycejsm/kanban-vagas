-- =============================================================================
-- 001 - Tabela de vagas
-- =============================================================================
-- Dependências: `auth.users` (schema auth, fornecido pelo Supabase).
--
-- Invariantes aplicadas aqui (ver openspec/project.md):
--   3. user_id vem do servidor: DEFAULT auth.uid() + RLS, nunca do input do cliente.
--  10. RLS habilitado e policies na MESMA migração que cria a tabela.

-- CHECK constraints não aceitam subquery, então a validação item a item de
-- `requisitos` mora numa função IMMUTABLE referenciada pelo CHECK.
create or replace function public.requisitos_vaga_validos(itens text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select
    coalesce(cardinality(itens), 0) <= 30
    and not exists (
      select 1
      from unnest(itens) as item
      where length(btrim(item)) not between 1 and 300
    );
$$;

comment on function public.requisitos_vaga_validos(text[]) is
  'Verifica cardinalidade (≤ 30) e tamanho (1..300) de cada requisito da vaga.';

create table if not exists public.vagas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid()
                     references auth.users (id) on delete cascade,
  url              text not null,
  url_normalizada  text not null,
  titulo           text not null,
  empresa          text not null,
  requisitos       text[] not null default '{}',
  senioridade      text not null default 'Não informado',
  status           text not null default 'aplicado',
  ordem            integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Espelham exatamente os schemas Zod de src/domain/vaga.ts.
  constraint vagas_status_check check (
    status in ('aplicado', 'entrevista_1', 'fase_tecnica', 'proposta', 'rejeitado')
  ),
  constraint vagas_senioridade_check check (
    senioridade in ('Junior', 'Pleno', 'Senior', 'Não informado')
  ),

  constraint vagas_url_check check (length(url) between 1 and 2048),
  constraint vagas_titulo_check check (length(btrim(titulo)) between 1 and 200),
  constraint vagas_empresa_check check (length(btrim(empresa)) between 1 and 200),

  -- Até 30 requisitos, cada um com 1..300 caracteres e não vazio.
  constraint vagas_requisitos_cardinalidade_check check (cardinality(requisitos) <= 30),
  constraint vagas_requisitos_itens_check check (public.requisitos_vaga_validos(requisitos)),

  -- Duas URLs equivalentes do mesmo usuário colidem; para contas diferentes, não.
  constraint vagas_user_id_url_normalizada_key unique (user_id, url_normalizada)
);

-- -----------------------------------------------------------------------------
-- Normalização de URL (design D3)
-- -----------------------------------------------------------------------------
-- Calculada no banco: o cliente nunca envia `url_normalizada`, então não há como
-- forjar o valor para escapar da constraint de unicidade.
--
-- Regras: esquema+host em minúsculas, sem fragmento, query removida quando contiver
-- apenas parâmetros de tracking, parâmetros vazios removidos, sem barra final
-- (preservando a raiz "/").

create or replace function public.normalizar_url_vaga(url text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  prefixo        text;   -- "https://host" já em minúsculas
  caminho        text;
  consulta       text;
  partes         text[];
  chave          text;
  valor          text;
  mantidas       text[] := '{}';
  consulta_final text;
  n              integer;
  i              integer;
begin
  if url is null then
    return null;
  end if;

  -- 1. Sem fragmento.
  caminho := split_part(url, '#', 1);

  -- 2. Separa query do caminho.
  consulta_final := null;
  if position('?' in caminho) > 0 then
    consulta := substring(caminho from position('?' in caminho) + 1);
    caminho  := substring(caminho from 1 for position('?' in caminho) - 1);

    partes := '{}';
    if consulta is not null and btrim(consulta) <> '' then
      partes := string_to_array(consulta, '&');
    end if;

    -- 3. Descarta parâmetros vazios e de tracking (utm_*); mantém os demais, na
    --    ordem original. Chave e valor são comparados em minúsculas apenas para
    --    reconhecer a família utm_*; o par em si é preservado como o usuário colou.
    for i in 1 .. coalesce(array_length(partes, 1), 0) loop
      if partes[i] ~ '=' then
        chave := btrim(split_part(partes[i], '=', 1));
        valor := substring(partes[i] from position('=' in partes[i]) + 1);

        if valor <> '' and chave !~* '^utm_' then
          mantidas := mantidas || partes[i];
        end if;
      elsif btrim(partes[i]) !~* '^utm_' then
        mantidas := mantidas || partes[i];
      end if;
    end loop;

    if array_length(mantidas, 1) > 0 then
      consulta_final := '?' || array_to_string(mantidas, '&');
    end if;
  end if;

  -- 5. Separa "esquema://host" do caminho. O host vai para minúsculas; o caminho
  --    tem a barra final removida, exceto quando é a raiz "/", que é preservada.
  --    O deslocamento é calculado antes do lower() porque `lower` pode alterar a
  --    largura em caracteres Unicode do host.
  if caminho ~* '^[A-Za-z][A-Za-z0-9+.-]*://' then
    n := char_length(substring(caminho from '^[A-Za-z][A-Za-z0-9+.-]*://[^/]*'));
    prefixo := lower(substring(caminho from 1 for n));
    caminho  := coalesce(substr(caminho, n + 1), '');

    if caminho = '' then
      caminho := '/';
    else
      caminho := rtrim(caminho, '/');
      if caminho = '' then
        caminho := '/';
      end if;
    end if;

    return prefixo || caminho || coalesce(consulta_final, '');
  end if;

  -- Sem esquema reconhecível: normaliza só o que der, sem inventar estrutura.
  caminho := rtrim(caminho, '/');
  if caminho = '' then
    caminho := '/';
  end if;

  return caminho || coalesce(consulta_final, '');
end;
$$;

comment on function public.normalizar_url_vaga(text) is
  'Normaliza a URL de uma vaga para deduplicação: esquema/host minúsculos, sem fragmento, sem parâmetros de tracking (utm_*), sem parâmetros vazios e sem barra final.';

create or replace function public.vagas_normalizar_url()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.url_normalizada := public.normalizar_url_vaga(new.url);
  return new;
end;
$$;

drop trigger if exists vagas_normalizar_url_trigger on public.vagas;
create trigger vagas_normalizar_url_trigger
  before insert or update of url on public.vagas
  for each row execute function public.vagas_normalizar_url();

-- -----------------------------------------------------------------------------
-- updated_at (design D9)
-- -----------------------------------------------------------------------------

create or replace function public.vagas_tocar_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vagas_tocar_updated_at_trigger on public.vagas;
create trigger vagas_tocar_updated_at_trigger
  before update on public.vagas
  for each row execute function public.vagas_tocar_updated_at();

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------

create index if not exists vagas_user_id_status_ordem_idx
  on public.vagas (user_id, status, ordem);

-- =============================================================================
-- Row Level Security (design D5)
-- =============================================================================
-- FORCE faz a política valer inclusive para o dono da tabela, de modo que o teste
-- de RLS exercite as policies reais. O service_role mantém bypass — por isso ele
-- nunca é usado em fluxo disparado por usuário.

alter table public.vagas enable row level security;
alter table public.vagas force row level security;

drop policy if exists vagas_select on public.vagas;
create policy vagas_select on public.vagas
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists vagas_insert on public.vagas;
create policy vagas_insert on public.vagas
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists vagas_update on public.vagas;
create policy vagas_update on public.vagas
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists vagas_delete on public.vagas;
create policy vagas_delete on public.vagas
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Revogações
-- -----------------------------------------------------------------------------

-- Nenhum acesso para clientes anônimos (design D5).
revoke all on public.vagas from anon;

-- Impede reatribuir a vaga a outra conta (design D4).
--
-- Atenção: `revoke update (user_id)` sozinho NÃO basta. O GRANT ALL padrão do
-- Supabase concede UPDATE na TABELA inteira, e revogar apenas a coluna não subtrai
-- nada desse grant de tabela — `user_id` continua gravável. Reproduzido com
-- has_column_privilege('authenticated', 'public.vagas', 'user_id', 'update') = t.
--
-- A forma que funciona é remover o UPDATE da tabela e readmiti-lo por coluna, com
-- `user_id` e `url_normalizada` de fora (esta última é calculada por trigger).
-- Qualquer UPDATE que cite `user_id` falha com 42501 (insufficient_privilege).
revoke update on public.vagas from authenticated;

grant update (url, titulo, empresa, requisitos, senioridade, status, ordem)
  on public.vagas to authenticated;

comment on table public.vagas is
  'Vagas de emprego acompanhadas no Kanban. RLS por usuário: user_id nunca vem do cliente.';
