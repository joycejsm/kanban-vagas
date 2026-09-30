-- =============================================================================
-- Correção do payload lido pelo hook Before User Created
-- =============================================================================
-- `public.rejeitar_email_fora_da_allowlist` lia o e-mail em `event -> 'data' ->> 'email'`.
-- O GoTrue não manda `data`. O payload real de um hook Before User Created, capturado em
-- `public.hook_debug` durante um login bem-sucedido, tem exatamente duas chaves de topo:
--
--   event            -> { metadata, user }
--   event->'user'    -> { app_metadata, aud, created_at, email, id, identities,
--                          is_anonymous, phone, role, updated_at, user_metadata }
--   event->'metadata'-> { ip_address, name, time, uuid }
--
-- Não existe `data` em nenhum dos três níveis. A função recebia `null`, caía no primeiro
-- `raise exception 'conta nao autorizada'` e o GoTrue devolvia ao navegador
--
--   Error running hook URI: pg-functions://postgres/public/rejeitar_email_fora_da_allowlist
--
-- que é indistinguível, na tela, de e-mail fora da allowlist. Era a causa raiz do login
-- recusado mesmo com a conta corretamente cadastrada.
--
-- Por que o erro se disfarçava de "e-mail não autorizado": o `raise` por falta de e-mail e
-- o `raise` por e-mail fora da lista são propositalmente idênticos, para não transformar a
-- criação de conta em oráculo da allowlist. A indistinguibilidade é a garantia de
-- segurança funcionando — e é também o que custou o diagnóstico. A distinção agora é feita
-- em teste, não na mensagem.
--
-- Por que os 44 testes pgTAP não pegaram: todos chamavam a função com um evento construído à
-- mão no formato `{"data": {"email": ...}}`, que é o formato que a função lia e não o que o
-- Auth envia. O teste confirmava a lógica sobre o payload imaginado, nunca sobre o real.
-- Acompanham esta migration os testes com a forma capturada do payload real.
--
-- `data.email` continua sendo aceito como segundo caminho. Não porque o GoTrue mande — não
-- manda, e o comentário acima é a evidência —, mas porque a função é fail-closed por
-- construção: sem e-mail em nenhum dos dois caminhos ela recusa. Aceitar o caminho antigo
-- não abre acesso, e mantém a função funcionando se a forma do payload mudar de volta ou
-- variar entre ambientes. Se os dois caminhos divergirem, `user` vence: é o que o Auth envia.
--
-- Nada muda na postura de segurança: a função continua `security definer`, continua devolvendo
-- o evento inalterado quando autoriza, continua com a mesma mensagem genérica nas duas
-- recusas, e o privilégio de EXECUTE continua apenas nos papéis de servidor (ver
-- 20260930183000_grant_execute_hook_allowlist.sql).

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
  -- `user.email` é o caminho do payload real do Auth; `data.email` é o caminho legado.
  email_recebido := coalesce(
    event #>> '{user,email}',
    event #>> '{data,email}'
  );

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
  'Hook Before User Created: recusa a criação de contas com e-mail fora de allowed_emails. '
  'Lê o e-mail de event->user->>email (payload real do Auth); event->data->>email é aceito '
  'como caminho legado. Sem e-mail em nenhum dos dois, recusa. EXECUTE apenas em papéis de '
  'servidor — concedê-lo a anon/authenticated transformaria a função em oráculo da allowlist.';
