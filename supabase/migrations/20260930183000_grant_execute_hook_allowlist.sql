-- =============================================================================
-- Grant de EXECUTE na função do hook Before User Created
-- =============================================================================
-- O hook `public.rejeitar_email_fora_da_allowlist` era criado sem nenhum GRANT, e a
-- migration de 20260930001500 não revoga nada dela. Mesmo assim a função chegou ao
-- projeto **sem EXECUTE para ninguém** além do dono: o projeto tem
-- `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` no schema
-- `public`, então `create function` já nasce fechada. Verificado no projeto real:
--
--   select has_function_privilege('anon', 'public.rejeitar_email_fora_da_allowlist(jsonb)', 'execute');
--   -- false  (e também false para 'authenticated' e para os papéis de servidor)
--
-- O efeito no login era o erro que o GoTrue devolve ao navegador:
--
--   Error running hook URI: pg-functions://postgres/public/rejeitar_email_fora_da_allowlist
--
-- que é indistinguível, na tela, de "e-mail fora da allowlist" — a conta é recusada
-- mesmo estando autorizada na tabela. Por isso a migration é necessária e não cosmética.
--
-- Por que os 44 testes pgTAP não pegaram isso: eles chamam a função como o dono
-- (`postgres`), que ignora privilégio. O que faltava era afirmar o privilégio em si,
-- o que esta migration vem acompanhado de teste.
--
-- Quem recebe o EXECUTE: os papéis de servidor. GoTrue executa o hook por conexão
-- própria, fora do PostgREST, então o papel efetivo é interno ao Auth e não é algo
-- que o código da aplicação possa observar. Conceder aos três cobre o executor sem
-- precisar fixar a hipótese sobre qual deles é.
--
-- Quem NÃO recebe: `anon` e `authenticated`. A função é `security definer` e devolve o
-- evento quando o e-mail está na lista, e levanta exceção quando não está. Se `anon`
-- pudesse chamá-la, qualquer pessoa poderia sondar a allowlist pelo
-- `POST /rest/v1/rpc/rejeitar_email_fora_da_allowlist` com um endereço arbitrário e
-- ler da resposta se aquele e-mail tem acesso — a mesma propriedade que o comentário
-- da função original diz preservar ao manter a mensagem genérica. A allowlist é
-- controle de acesso, não dado público.

-- O owner precisa continuar sendo o dono da função: o `security definer` só tem efeito
-- se o papel efetivo for o dono, e é o dono que tem SELECT em `allowed_emails` — a
-- tabela não tem policy nenhuma. `security definer` sem EXECUTE para o executor é
-- função morta; EXECUTE sem `security definer` seria a lista virando dado público.

-- Primeiro sai o herdado. A função nasce com EXECUTE para PUBLIC (é o default do
-- PostgreSQL para `create function`), e `revoke ... from anon` NÃO remove o que vem
-- de PUBLIC: revogar de um papel só apaga o.grant direto dele. Sem este revoke, o
-- passo seguinte volta a conceder o que o PUBLIC dava, e `anon` continua executando.
revoke execute on function public.rejeitar_email_fora_da_allowlist(jsonb) from public;

-- Agora cada papel recebe exatamente o que precisa, e o default do projeto deixa de
-- ser o que decide.
revoke execute on function public.rejeitar_email_fora_da_allowlist(jsonb) from anon, authenticated;

do $$
declare
  papel text;
begin
  foreach papel in array array['supabase_auth_admin', 'authenticator', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format(
        'grant execute on function public.rejeitar_email_fora_da_allowlist(jsonb) to %I',
        papel
      );
    else
      raise notice 'papel % não existe neste projeto; GRANT pulado', papel;
    end if;
  end loop;
end
$$;

comment on function public.rejeitar_email_fora_da_allowlist(jsonb) is
  'Hook Before User Created: recusa a criação de contas com e-mail fora de allowed_emails. '
  'EXECUTEs granted apenas a papéis de servidor — o hook roda dentro do Auth, e concedê-lo '
  'a anon/authenticated transformaria a função em oráculo da allowlist.';