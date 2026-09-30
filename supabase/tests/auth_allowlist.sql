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
--   - o hook funciona com o payload REAL que o Auth envia, e não só com o inventado
--
-- Tudo roda dentro de uma transação que sofre ROLLBACK no fim: o banco fica como estava.

begin;

-- A stack local traz o pgtap disponível, mas não instalado: sem isto, `plan()` e `is()`
-- não existem, o psql emite erro em cada linha e o arquivo inteiro passa a reportar um único
-- subteste. A criação fica dentro desta transação, então o ROLLBACK do fim a desfaz.
create extension if not exists pgtap with schema extensions;

select plan(25);

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
-- 5. O payload real do Auth
-- -----------------------------------------------------------------------------
-- A seção 2 provou que a função decide certo sobre `{"data": {"email": ...}}`. Esse é o
-- formato que a função lia — e não o que o GoTrue envia. Foi por aqui que 44 testes
-- passaram verdes com um hook que recusava todo mundo no projeto real: eles mediam a lógica
-- sobre um evento que nunca chegou a existir.
--
-- O evento abaixo é a forma capturada em `public.hook_debug` num login bem-sucedido, com o
-- e-mail trocado pelo do fixture. As chaves de topo são `metadata` e `user`; `data` não
-- existe em nenhum nível. Se o Auth mudar a forma do payload, estes testes falham — que é o
-- ponto: a forma é o contrato, e contrato não testado é o que quebrou aqui.

select lives_ok(
  $$select public.rejeitar_email_fora_da_allowlist(
      '{"user":{"app_metadata":{"provider":"google","providers":["google"]},"aud":"authenticated",
        "created_at":"2026-09-30T22:16:01.000000Z","email":"ana@exemplo.com",
        "id":"00000000-0000-0000-0000-000000000000","identities":[],
        "is_anonymous":false,"phone":"","role":"authenticated",
        "updated_at":"2026-09-30T22:16:01.000000Z","user_metadata":{"name":"Ana","sub":"00000000-0000-0000-0000-000000000000"}},
        "metadata":{"ip_address":"127.0.0.1","name":"Ana","time":1759263361000000,
        "uuid":"00000000-0000-0000-0000-000000000000"}}'::jsonb)$$,
  'o hook aceita o payload real do Auth quando o e-mail está na lista'
);

-- O Auth envia o evento inteiro e usa o que a função devolver; devolver outra coisa
-- corromperia a criação da conta.
select is(
  public.rejeitar_email_fora_da_allowlist(
    '{"user":{"email":"ana@exemplo.com","id":"00000000-0000-0000-0000-000000000000","role":"authenticated",
      "aud":"authenticated","app_metadata":{"provider":"google"},"user_metadata":{},
      "identities":[],"created_at":"2026-09-30T22:16:01.000000Z",
      "updated_at":"2026-09-30T22:16:01.000000Z","is_anonymous":false,"phone":""},
      "metadata":{"uuid":"00000000-0000-0000-0000-000000000000","time":1759263361000000,
      "name":"Ana","ip_address":"127.0.0.1"}}'::jsonb),
  '{"user":{"email":"ana@exemplo.com","id":"00000000-0000-0000-0000-000000000000","role":"authenticated",
    "aud":"authenticated","app_metadata":{"provider":"google"},"user_metadata":{},
    "identities":[],"created_at":"2026-09-30T22:16:01.000000Z",
    "updated_at":"2026-09-30T22:16:01.000000Z","is_anonymous":false,"phone":""},
    "metadata":{"uuid":"00000000-0000-0000-0000-000000000000","time":1759263361000000,
    "name":"Ana","ip_address":"127.0.0.1"}}'::jsonb,
  'o hook devolve o payload real inalterado ao permitir a criação'
);

-- Fail-closed: a recusa por e-mail fora da lista vale tanto no payload real quanto no legado.
select throws_ok(
  $$select public.rejeitar_email_fora_da_allowlist(
      '{"user":{"email":"malvado@exemplo.com","id":"00000000-0000-0000-0000-000000000000"},
        "metadata":{"uuid":"00000000-0000-0000-0000-000000000000"}}'::jsonb)$$,
  '42501',
  'conta nao autorizada',
  'e-mail fora da lista é recusado no payload real'
);

-- E o caso que produziu o bug: um evento bem formado, do jeito que o Auth manda, sem e-mail
-- utilizável. Tem de recusar, e não ler `null` e deixar passar.
select throws_ok(
  $$select public.rejeitar_email_fora_da_allowlist(
      '{"user":{"id":"00000000-0000-0000-0000-000000000000","role":"authenticated"},
        "metadata":{"uuid":"00000000-0000-0000-0000-000000000000"}}'::jsonb)$$,
  '42501',
  'conta nao autorizada',
  'payload real sem e-mail é recusado — a função é fail-closed'
);

-- -----------------------------------------------------------------------------
-- 6. A tabela não é legível pela aplicação
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
-- 7. O hook é privileged da forma combinada
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
-- Privilégio de execução da função do hook
-- -----------------------------------------------------------------------------
-- Os testes acima chamam a função e provam a LÓGICA dela, mas rodam como o dono
-- (`postgres`), que ignora privilégio. Foi exatamente por isso que 44 testes passaram
-- verdes com o hook incapaz de rodar no projeto real: a função estava correta e
-- inexecutável. Estes três affirms o que os outros não enxergam.
--
-- O primeiro afirma que existe papel de servidor capaz de executar a função, sem
-- cravar qual deles é o executor real: o GoTrue roda o hook por conexão própria, fora
-- do PostgREST, e essa escolha é interna ao Auth.

select ok(
  exists (
    select 1
      from pg_roles
     where rolname = any (array['supabase_auth_admin', 'authenticator', 'service_role'])
       and has_function_privilege(
             rolname, 'public.rejeitar_email_fora_da_allowlist(jsonb)', 'execute'
           )
  ),
  'algum papel de servidor consegue executar a função do hook'
);

-- Os dois seguintes são a propriedade de segurança, e valem mais que o primeiro: sem
-- eles, `anon` chamaria a função pelo `/rest/v1/rpc/...` e a resposta diria se um
-- endereço arbitrário tem acesso, já que a função devolve o evento quando o e-mail
-- está na lista e levanta exceção quando não está. A allowlist viraria dado público.

select ok(
  not has_function_privilege('anon', 'public.rejeitar_email_fora_da_allowlist(jsonb)', 'execute'),
  'anon não consegue executar a função do hook — a allowlist não é oráculo público'
);

select ok(
  not has_function_privilege('authenticated', 'public.rejeitar_email_fora_da_allowlist(jsonb)', 'execute'),
  'authenticated não consegue executar a função do hook'
);

-- -----------------------------------------------------------------------------
-- Rollback: nada persiste
-- -----------------------------------------------------------------------------

rollback;
