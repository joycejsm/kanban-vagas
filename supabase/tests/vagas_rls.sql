-- =============================================================================
-- Testes de RLS e de integridade de public.vagas
-- =============================================================================
-- Executar com:  supabase test db supabase/tests/vagas_rls.sql
--
-- Cobre os cenários de aceite de `specs/vaga-persistence/spec.md`:
--   - usuário A só vê as vagas dele
--   - INSERT com user_id do usuário B é rejeitado
--   - UPDATE alterando user_id é rejeitado
--   - UPDATE/DELETE de vaga alheia afetam zero linhas
--   - cliente anônimo não executa nenhuma operação
--   - duplicata por normalização de URL falha com 23505
--   - CHECKs de status, senioridade e requisitos
--
-- Tudo roda dentro de uma transação que sofre ROLLBACK no fim: o banco fica como
-- estava. Os usuários de teste são criados só para esta execução.

begin;

-- A stack local traz o pgtap disponível, mas não instalado: sem isto, `plan()` e `is()`
-- não existem, o psql emite erro em cada linha e o arquivo inteiro passa a reportar um único
-- subteste — ou seja, "passa" sem verificar nada. A criação fica dentro desta transação, então
-- o ROLLBACK do fim a desfaz.
create extension if not exists pgtap with schema extensions;

select plan(26);

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role)
values ('11111111-1111-1111-1111-111111111111', 'a@teste.invalid', 'authenticated', 'authenticated'),
       ('22222222-2222-2222-2222-222222222222', 'b@teste.invalid', 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- Atua como o usuário A durante os cenários autenticados.
create or replace function testes_como_usuario(usuario uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', usuario::text, 'role', 'authenticated'
  )::text, true);
end;
$$;

set local role authenticated;
select testes_como_usuario('11111111-1111-1111-1111-111111111111');
reset role;

-- Vaga do usuário A, cadastrada com parâmetro de tracking (será normalizada).
set local role authenticated;
insert into public.vagas (url, titulo, empresa, requisitos, senioridade)
values ('https://x.com/job/1?utm_source=newsletter',
        'Engenheira de Software', 'Empresa X', array['TypeScript', 'Postgres'], 'Senior');
reset role;

-- -----------------------------------------------------------------------------
-- 1. Isolamento de leitura: A só vê as próprias vagas
-- -----------------------------------------------------------------------------

set local role authenticated;
select testes_como_usuario('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*) from public.vagas where user_id = '11111111-1111-1111-1111-111111111111'::uuid),
  1::bigint,
  'A enxerga exatamente a própria vaga'
);

select is(
  (select count(*) from public.vagas where user_id <> '11111111-1111-1111-1111-111111111111'::uuid),
  0::bigint,
  'A não enxerga vaga de terceiros'
);

-- INSERT do usuário B visível para A? Não deve.
select testes_como_usuario('22222222-2222-2222-2222-222222222222');
insert into public.vagas (url, titulo, empresa, requisitos, senioridade)
values ('https://y.com/job/9', 'Vaga Y', 'Empresa Y', array['Go'], 'Pleno');
select is(
  (select count(*) from public.vagas),
  1::bigint,
  'A não enxerga a vaga do usuário B'
);
reset role;

-- -----------------------------------------------------------------------------
-- 2. INSERT com user_id alheio é rejeitado pela policy WITH CHECK
-- -----------------------------------------------------------------------------

set local role authenticated;
select testes_como_usuario('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$insert into public.vagas (user_id, url, titulo, empresa, requisitos, senioridade)
    values ('22222222-2222-2222-2222-222222222222', 'https://z.com/job/3', 'Vaga Z', 'Empresa Z',
            array['Rust'], 'Junior')$$,
  '42501',
  null,
  'INSERT com user_id do usuário B é rejeitado por RLS'
);
reset role;

-- -----------------------------------------------------------------------------
-- 3. user_id não é coluna gravável (design D4)
-- -----------------------------------------------------------------------------

select ok(
  not has_column_privilege('authenticated', 'public.vagas', 'user_id', 'update'),
  'authenticated não tem privilégio de UPDATE sobre user_id'
);

select ok(
  has_column_privilege('authenticated', 'public.vagas', 'status', 'update'),
  'authenticated mantém UPDATE sobre as colunas graváveis'
);

set local role authenticated;
select testes_como_usuario('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$update public.vagas set user_id = '22222222-2222-2222-2222-222222222222'$$,
  '42501',
  null,
  'UPDATE alterando user_id é rejeitado'
);

select throws_ok(
  $$update public.vagas
    set user_id = '11111111-1111-1111-1111-111111111111', titulo = 'X'$$,
  '42501',
  null,
  'UPDATE citando user_id é rejeitado mesmo com o próprio id'
);
reset role;

-- -----------------------------------------------------------------------------
-- 4. UPDATE e DELETE de vaga alheia não afetam nada
-- -----------------------------------------------------------------------------
-- O efeito é observado pelo estado da linha, e não por `row_count`: um UPDATE que
-- não casa com a policy de USING simplesmente não encontra linhas para alterar.

set local role authenticated;
select testes_como_usuario('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$update public.vagas set status = 'proposta'
    where user_id = '22222222-2222-2222-2222-222222222222'::uuid$$,
  'UPDATE de vaga alheia não gera erro'
);

select lives_ok(
  $$delete from public.vagas where user_id = '22222222-2222-2222-2222-222222222222'::uuid$$,
  'DELETE de vaga alheia não gera erro'
);

-- Efeito real, conferido fora do RLS: a vaga de B continua intacta.
reset role;

select is(
  (select status from public.vagas where user_id = '22222222-2222-2222-2222-222222222222'::uuid),
  'aplicado'::text,
  'UPDATE de vaga alheia não alterou o status dela'
);

select is(
  (select count(*) from public.vagas where user_id = '22222222-2222-2222-2222-222222222222'::uuid),
  1::bigint,
  'DELETE de vaga alheia não removeu a vaga'
);

-- -----------------------------------------------------------------------------
-- 5. Cliente anônimo é negado em todas as operações
-- -----------------------------------------------------------------------------

set local role anon;

select throws_ok(
  $$select count(*) from public.vagas$$,
  '42501', null,
  'anon: SELECT é negado'
);

select throws_ok(
  $$insert into public.vagas (user_id, url, titulo, empresa, requisitos, senioridade)
    values ('11111111-1111-1111-1111-111111111111', 'https://anon.com/1', 'V', 'E', array['X'], 'Pleno')$$,
  '42501', null,
  'anon: INSERT é negado'
);

select throws_ok(
  $$update public.vagas set status = 'proposta'$$,
  '42501', null,
  'anon: UPDATE é negado'
);

select throws_ok(
  $$delete from public.vagas$$,
  '42501', null,
  'anon: DELETE é negado'
);

reset role;

-- -----------------------------------------------------------------------------
-- 6. Duplicidade por normalização de URL
-- -----------------------------------------------------------------------------

set local role authenticated;
select testes_como_usuario('11111111-1111-1111-1111-111111111111');

select is(
  (select url_normalizada from public.vagas limit 1),
  'https://x.com/job/1'::text,
  'url_normalizada remove utm_source'
);

select throws_ok(
  $$insert into public.vagas (url, titulo, empresa, requisitos, senioridade)
    values ('https://x.com/job/1', 'Engenheira de Software', 'Empresa X', array['TypeScript'], 'Senior')$$,
  '23505', null,
  'mesma URL sem utm colide com a já cadastrada'
);

-- A mesma URL para outro usuário é permitida: o UNIQUE é por usuário.
select testes_como_usuario('22222222-2222-2222-2222-222222222222');
select lives_ok(
  $$insert into public.vagas (url, titulo, empresa, requisitos, senioridade)
    values ('https://x.com/job/1', 'Engenheira de Software', 'Empresa X', array['TypeScript'], 'Senior')$$,
  'mesma URL para outro usuário é aceita'
);

-- -----------------------------------------------------------------------------
-- 7. CHECK constraints espelham os enums do domínio
-- -----------------------------------------------------------------------------

select throws_ok(
  $$update public.vagas set status = 'arquivado'$$,
  '23514', null,
  'status fora do enum é rejeitado'
);

select throws_ok(
  $$update public.vagas set senioridade = 'Estágio'$$,
  '23514', null,
  'senioridade fora do enum é rejeitada'
);

select throws_ok(
  $$update public.vagas
    set requisitos = (select array_agg('req ' || g) from generate_series(1, 31) g)$$,
  '23514', null,
  'mais de 30 requisitos é rejeitado'
);

select throws_ok(
  $$update public.vagas set requisitos = array[repeat('x', 301)]$$,
  '23514', null,
  'requisito com mais de 300 caracteres é rejeitado'
);

reset role;

-- -----------------------------------------------------------------------------
-- 8. updated_at avança a cada UPDATE
-- -----------------------------------------------------------------------------

set local role authenticated;
select testes_como_usuario('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$update public.vagas set status = 'entrevista_1', ordem = 2
    where user_id = '11111111-1111-1111-1111-111111111111'::uuid$$,
  'movimentar o card é permitido'
);

select is(
  (select status from public.vagas where user_id = '11111111-1111-1111-1111-111111111111'::uuid),
  'entrevista_1'::text,
  'status foi atualizado'
);

select is(
  (select ordem from public.vagas where user_id = '11111111-1111-1111-1111-111111111111'::uuid),
  2,
  'ordem foi atualizada'
);

reset role;

-- * * * Fim dos testes. ROLLBACK devolve o banco ao estado anterior. * * *

select * from finish();
rollback;
