-- =============================================================================
-- Allowlist de e-mails e hook Before User Created (Fase 3, decisão D4/D11)
-- =============================================================================
-- A lista de e-mails autorizados vive em `public.allowed_emails`, que é a fonte de verdade do
-- hook. O espelho dela no servidor Next é a variável `ALLOWED_EMAILS`, usada pela camada do
-- callback. As duas precisam ser mantidas em sincronia pelo mesmo dono.
--
-- A tabela **não** tem policy: RLS habilitado e nenhuma policy significa que `anon` e
-- `authenticated` não leem nada diretamente. A leitura acontece só dentro da função
-- `security definer` do hook, que roda com o privilégio do dono da tabela. Ninguém lê a lista
-- pela aplicação, e administrá-la é um job explícito com service role — nunca uma requisição
-- de usuário (invariante 2).
--
-- Se as duas listas divergirem, o comportamento é conservador e determinístico: e-mail que está
-- na tabela e não no `ALLOWED_EMAILS` é barrado no callback (o banco nunca amplia o acesso), e
-- e-mail que está no `ALLOWED_EMAILS` e não na tabela só passa a valer para contas que já
-- existem, porque o hook não roda retroativamente.

-- -----------------------------------------------------------------------------
-- 1. Tabela de e-mails autorizados
-- -----------------------------------------------------------------------------

create table if not exists public.allowed_emails (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint allowed_emails_formato check (email = lower(trim(email))),
  constraint allowed_emails_nao_vazio check (email <> '')
);

comment on table public.allowed_emails is
  'E-mails autorizados a usar o aplicativo. Espelhada em ALLOWED_EMAILS no servidor Next. '
  'Sem policy de leitura: só a função do hook Before User Created consulta esta tabela.';

alter table public.allowed_emails enable row level security;

-- Nenhuma policy é criada de propósito: com RLS habilitado e zero policies, todo acesso
-- direto de anon/authenticated é negado. A leitura do hook acontece no contexto
-- `security definer` da função abaixo.

-- -----------------------------------------------------------------------------
-- 2. Hook Before User Created
-- -----------------------------------------------------------------------------
-- O hook do Supabase Auth segue a assinatura `(event jsonb) returns jsonb`: recebe o evento
-- serializado e devolve o evento inalterado para permitir a criação, ou lança exceção para
-- recusar. O e-mail do novo usuário está em `event->'data'->>'email'`.
--
-- `security definer` com `search_path` fixado: sem isso, quem tiver direito de criar objetos no
-- schema `public` poderia sequestrar a resolução de nomes e executar código no lugar desta
-- função, que roda dentro do Auth. A função **não** tem parâmetro de ambiente, então o
-- `search_path` é a única superfície.

create or replace function public.rejeitar_email_fora_da_allowlist(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  email_recebido text;
  email_normalizado text;
begin
  email_recebido := event -> 'data' ->> 'email';

  if email_recebido is null or btrim(email_recebido) = '' then
    raise exception 'conta nao autorizada'
      using errcode = '42501',
            hint = 'A conta precisa de um endereco de e-mail autorizado.';
  end if;

  email_normalizado := lower(btrim(email_recebido));

  if not exists (
    select 1
    from public.allowed_emails autorizado
    where autorizado.email = email_normalizado
  ) then
    -- Mensagem genérica de propósito: dizer qual e-mail foi recusado transformaria a criação
    -- de conta em oráculo sobre a allowlist.
    raise exception 'conta nao autorizada'
      using errcode = '42501',
            hint = 'Este endereco de e-mail nao tem acesso ao aplicativo.';
  end if;

  -- Devolve o evento inalterado: a criação segue, com o Auth aplicando seus próprios defaults.
  return event;
end;
$$;

comment on function public.rejeitar_email_fora_da_allowlist(jsonb) is
  'Hook Before User Created: recusa a criação de contas com e-mail fora de allowed_emails.';

-- 3. Consumo do valor pelo servidor
-- -----------------------------------------------------------------------------
-- A lista completa para o espelho `ALLOWED_EMAILS` sai daqui, para que a sincronia entre as
-- duas pontas seja um comando explícito e auditável, e não uma digitação no painel:
--
--   select string_agg(email, ',' order by email) from public.allowed_emails;
