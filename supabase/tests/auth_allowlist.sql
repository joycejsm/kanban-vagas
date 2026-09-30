-- =============================================================================
-- Testes da allowlist de e-mails e do hook Before User Created
-- =============================================================================
-- Executar com:  supabase test db supabase/tests/auth_allowlist.sql
--
-- Cobre os cenários de aceite de `specs/access-allowlist/spec.md`:
--   - o hook recusa e-mail fora da lista
--   - o hook recusa e-mail ausente
--   - o hook aceita e-mail da lista, com normalização de caixa e espaços
--   - a tabela guarda o e-mail normalizado e rejeita valor não normalizado
--   - a tabela não é legível por cliente anônimo nem autenticado (RLS sem policy)
--
-- Tudo roda dentro de uma transação que sofre ROLLBACK no fim: o banco fica como estava.

begin;

-- A stack local traz o pgtap disponível, mas não instalado: sem isto, `plan()` e `is()`
-- não existem, o psql emite erro em cada linha e o arquivo inteiro passa a reportar um único
-- subteste. A criação fica dentro desta transação, então o ROLLBACK do fim a desfaz.
create extension if not exists pgtap with schema extensions;

select plan(18);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into public.allowed_emails (email)
values ('ana@exemplo.com');

-- -----------------------------------------------------------------------------
-- 1. A tabela guarda o e-mail normalizado
-- -----------------------------------------------------------------------------

select is(
  (select email from public.allowed_emails where email = 'ana@exemplo.com'),
  'ana@exemplo.com'::text,
  'o e-mail autorizado está na tabela'
);

-- As duas rejeições são o mesmo tipo de evento (violação de CHECK), e é justamente o SQLSTATE
-- que não as distingue. Por isso cada caso leva duas asserções: `throws_ok` fixa o 23514, e
-- `throws_matching` — cuja segunda assinatura casa um *regex* sobre SQLERRM — fixa o nome da
-- constraint, que é o que diz qual regra disparou.
--
-- O nome vai em regex em vez da mensagem inteira de propósito: o SQLERRM real também carrega
-- o nome da relação e a pontuação varia entre versões do Postgres, e none disso é o contrato
-- testado aqui.
select throws_ok(
  $$insert into public.allowed_emails (email) values ('Bruno@Exemplo.com')$$,
  '23514', null,
  'e-mail não normalizado viola check constraint'
);

select throws_matching(
  $$insert into public.allowed_emails (email) values ('Bruno@Exemplo.com')$$,
  'violates check constraint "allowed_emails_formato"',
  'a constraint que dispara é a de formato, e não a de vazio'
);

select throws_ok(
  $$insert into public.allowed_emails (email) values ('')$$,
  '23514', null,
  'e-mail vazio viola check constraint'
);

select throws_matching(
  $$insert into public.allowed_emails (email) values ('')$$,
  'violates check constraint "allowed_emails_nao_vazio"',
  'a constraint que dispara é a de vazio, e não a de formato'
);

-- -----------------------------------------------------------------------------
-- 2. O hook recusa e-mail fora da lista
-- -----------------------------------------------------------------------------

select throws_ok(
  $$select public.rejeitar_email_fora_da_allowlist(
      '{"data": {"email": "malvado@exemplo.com"}}'::jsonb)$$,
  '42501',
  'conta nao autorizada',
  'o hook recusa e-mail fora da allowlist'
);

select throws_ok(
  $$select public.rejeitar_email_fora_da_allowlist(
      '{"data": {}}'::jsonb)$$,
  '42501',
  'conta nao autorizada',
  'o hook recusa conta sem e-mail'
);

select throws_ok(
  $$select public.rejeitar_email_fora_da_allowlist(
      '{"data": {"email": "   "}}'::jsonb)$$,
  '42501',
  'conta nao autorizada',
  'o hook recusa e-mail que é só espaços'
);

-- A mensagem não pode revelar a lista nem o e-mail recusado: seria um oráculo sobre quem tem
-- acesso ao aplicativo.
select lives_ok(
  $$select public.rejeitar_email_fora_da_allowlist(
      '{"data": {"email": "ana@exemplo.com"}}'::jsonb)$$,
  'o hook aceita e-mail da allowlist'
);

select is(
  public.rejeitar_email_fora_da_allowlist('{"data": {"email": "ana@exemplo.com"}}'::jsonb),
  '{"data": {"email": "ana@exemplo.com"}}'::jsonb,
  'o hook devolve o evento inalterado ao permitir a criação'
);

-- -----------------------------------------------------------------------------
-- 3. Normalização: a comparação é case-insensitive e ignora espaços
-- -----------------------------------------------------------------------------

select lives_ok(
  $$select public.rejeitar_email_fora_da_allowlist(
      '{"data": {"email": "  ANA@Exemplo.COM  "}}'::jsonb)$$,
  'o hook aceita e-mail da lista escrito em caixa alta e com espaços'
);

-- -----------------------------------------------------------------------------
-- 4. Allowlist vazia barra todo mundo
-- -----------------------------------------------------------------------------

select throws_ok(
  $$select public.rejeitar_email_fora_da_allowlist(
      '{"data": {"email": "qualquer@exemplo.com"}}'::jsonb)$$,
  '42501',
  'conta nao autorizada',
  'e-mail fora da lista continua barrado mesmo com outra conta autorizada'
);

-- -----------------------------------------------------------------------------
-- 5. A tabela não é legível pela aplicação
-- -----------------------------------------------------------------------------
-- RLS habilitado e nenhuma policy: `anon` e `authenticated` não leem a lista. O espelho que o
-- servidor usa é a variável `ALLOWED_EMAILS`, e a leitura do hook acontece no contexto
-- `security definer`, que não é afetado por RLS.

select is(
  (select relrowsecurity from pg_class where oid = 'public.allowed_emails'::regclass),
  true,
  'RLS está habilitado em allowed_emails'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'allowed_emails'),
  0::bigint,
  'allowed_emails não tem nenhuma policy'
);

-- RLS sem policy não gera erro: filtra. O sintoma é a lista parecer vazia, e é exatamente por
-- isso que a ausência de policy é a configuração correta — o cliente não lê nem percebe que
-- existe uma lista.
set local role anon;
select is(
  (select count(*) from public.allowed_emails),
  0::bigint,
  'cliente anônimo não enxerga nenhuma linha da lista de autorizados'
);
reset role;

set local role authenticated;
select is(
  (select count(*) from public.allowed_emails),
  0::bigint,
  'cliente autenticado também não enxerga nenhuma linha da lista de autorizados'
);
reset role;

-- -----------------------------------------------------------------------------
-- 6. O hook é privileged da forma combinada
-- -----------------------------------------------------------------------------

select is(
  (select prosecdef from pg_proc
    where oid = 'public.rejeitar_email_fora_da_allowlist(jsonb)'::regprocedure),
  true,
  'a função do hook roda como security definer'
);

select is(
  (select proconfig[1] from pg_proc
    where oid = 'public.rejeitar_email_fora_da_allowlist(jsonb)'::regprocedure),
  'search_path=auth, public'::text,
  'a função do hook fixa o search_path em auth, public'
);

-- -----------------------------------------------------------------------------
-- Rollback: nada persiste
-- -----------------------------------------------------------------------------

rollback;
