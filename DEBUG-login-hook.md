# Debug do login por Google — causa raiz encontrada em 2026-09-30

Documento de transferência. A Fase 4 está commitada (`0aa4e03`) e o archive das specs
também (`84d5c41`); este arquivo é só o estado do debug do login.

**A causa raiz foi encontrada e corrigida** (`19fc3d7`). A função lia o e-mail em
`event->'data'->>'email'`; o GoTrue não manda `data`. O payload real tem duas chaves de
topo, `metadata` e `user`, e o e-mail está em `event->'user'->>'email'`. A função recebia
`null` e levantava `conta nao autorizada` — que o GoTrue reporta como falha de
infraestrutura, indistinguível na tela de e-mail fora da allowlist.

Havia um segundo defeito, independente: o e-mail que logava **não estava** em
`public.allowed_emails`. Corrigir a função sozinha não bastaria.

**Falta um passo manual** — repontar o hook para a função de produção. Ver "O que falta".

## Resumo

O login por Google **funciona** com o hook apontado para uma função de teste que aprova
tudo, e **falha** com a função de produção `public.rejeitar_email_fora_da_allowlist`. Isso
prova que o GoTrue chama funções sem problema: o defeito está dentro da função de produção.
A causa raiz foi o caminho de leitura do e-mail no payload — e, junto, um dado faltando na
tabela.

## O que falta (passo manual, ~1 minuto)

O URI do hook **não fica no banco** — é configuração do GoTrue, mudada pelo dashboard ou
pela Management API. O `supabase db push` também está bloqueado neste projeto (o papel
`postgres` não tem `CREATEROLE`), então as migrations foram aplicadas por `psql` e
registradas à mão em `supabase_migrations.schema_migrations`.

1. No dashboard, **Authentication → Hooks → Before User Created**, apontar para:

   ```
   pg-functions://postgres/public/rejeitar_email_fora_da_allowlist
   ```

2. Testar o login. O payload real que o `hook_debug` gravou **já passa** pela função
   corrigida — verificado em SQL antes de qualquer coisa:

   ```
   ACEITO: o payload real do login passa pela função corrigida
   ```

3. Só depois dropar os objetos de debug (ver abaixo). **Não dropar antes**: o hook ainda
   aponta para `teste_hook_passa`, e remover a função agora quebraria o login.

## Estado de segurança no projeto real

| O quê | Estado | Ação |
|---|---|---|
| Hook Before User Created | **ainda** apontando para `teste_hook_passa` | repontar (passo 1 acima) |
| `grant execute ... to public` | **fechado** nesta sessão | feito |
| `anon`/`authenticated` com EXECUTE | **fechado** nesta sessão | feito |
| `allowed_emails` com o e-mail que loga | **corrigido** nesta sessão | feito |
| `public.hook_debug` + `teste_hook_passa` | existem, inertes | dropar após o passo 1 |

O passo 1 do handoff anterior, sozinho, **não** fechava o oráculo: além do `public`
herdado, `anon` e `authenticated` tinham grant direto, sobra do passo 4 do diagnóstico, e
`revoke ... from public` não remove grant direto de papel. Os três papéis de servidor
recebem EXECUTE; `anon` e `authenticated` não.

Enquanto o hook apontar para `teste_hook_passa`, a camada que impede criação de contas
continua desligada — conta lixo em `auth.users`, não acesso indevido, porque o callback
continua exigindo o e-mail em `ALLOWED_EMAILS`.

## Cadeia do diagnóstico, com as evidências

Cada passo descartou uma hipótese. Vale ler para não repetir.

1. **`Unable to exchange external code: 4/0A`** — falha na troca do código com o Google.
   Causa: client secret do Google_provider divergente. Corrigida pela usuária; a partir daí
   o código passou a voltar e o erro mudou.
2. **`Error running hook URI: .../rejeitar_email_fora_da_allowlist`** — o hook é chamado e
   falha. Para com o diagnose, porque o GoTrue devolve **a mesma mensagem** tanto para
   recusa legítima da allowlist quanto para falha de infraestrutura.
3. **`has_function_privilege` retornou `false`** para `anon` e `authenticated` na função do
   hook: ela nasceu sem `EXECUTE` para ninguém além do dono. O projeto tem
   `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` no schema `public`,
   então `create function` já nasce fechada. **Corrigido** com grant para
   `supabase_auth_admin`, `authenticator` e `service_role`.
4. **Ainda falava.** Grant liberado também para `anon` — isto é, para **todo papel** — e
   continuou falhando com a mesma mensagem. Isso **descarta privilégio como causa**.
   (Estes grants de debug são os que precisaram ser revogados no fim.)
5. **Função testada à mão** com `{"data":{"email":"..."}}`: devolveu o evento inalterado. A
   lógica está correta para aquele payload — que é justamente o payload errado.
6. **Função de teste** `teste_hook_passa`, que grava o payload em `hook_debug` e devolve o
   evento sem consultar nada: **login entrou**. O passo 6 é o divisor de águas: o GoTrue
   executa funções, a sessão é criada. O defeito está no que a função de produção faz com
   o payload real.
7. **Lido o payload de `hook_debug`** — a evidência que fechou o caso:

   ```
   event             -> { metadata, user }
   event->'user'     -> { app_metadata, aud, created_at, email, id, identities,
                          is_anonymous, phone, role, updated_at, user_metadata }
   event->'metadata' -> { ip_address, name, time, uuid }
   ```

   `data` não existe em nenhum dos três níveis. Duas hipóteses estavam **as duas** certas:
   o payload não tem `data.email` (a função lia o caminho errado) **e** o e-mail não estava
   na tabela. Ver "Achados" 5.

## Achados que viram tarefa, não só memória de debug

1. **`Error running hook URI` é indistinguível entre recusa legítima e falha de
   infraestrutura.** Quem depurar isso no futuro perde o mesmo tempo que esta sessão. A
   allowlist precisa de uma forma de diferenciar as duas, ou de um caminho de diagnóstico
   documentado.
2. **Os testes pgTAP não cobriam o payload real, e agora cobrem.** Todos montavam o evento
   à mão em `{"data": {"email": ...}}` — o formato que a função lia, não o que o Auth envia.
   Quatro asserts novos usam a forma capturada do payload real, e a prova de que pegam é
   concreta: com a função quebrada, o teste 13 falha com `conta nao autorizada` enquanto os
   12 anteriores passam. `plan(21) → plan(25)`.
3. **O grant do hook não estava em migration nenhuma.** `20260930001500` cria a função sem
   `GRANT`, e o projeto a cria fechada por default. A migration `20260930183000` cobre isso e
   foi aplicada no remoto.
4. **`scripts/verificar-allowlist.sh`** achou que o Infisical tinha 2 e-mails e o `.env.local`
   1. A divergência era pior do que contagem: eram **três endereços distintos em três
   lugares** — banco, Infisical e `.env.local` nenhum deles casando com os outros. O
   `.env.local` tinha um endereço que não estava em lugar nenhum, e o banco não tinha o
   endereço que de fato logava. **Resolvido**: as três listas batem hoje por md5.
5. **Duas causas, um sintoma.** O payload errado e o dado faltando produziam a mesma
   mensagem. Diagnosticar por hipótese única ("é o caminho ou é a tabela?") seria o erro
   natural aqui — a resposta era as duas. Vale, no futuro, suspeitar de mais de uma causa
   quando o mesmo sintoma sobrevive a uma correção parcial.

## Como testar o login

```bash
PORT=3002 npm run dev
```

- **Porta 3002, obrigatoriamente.** As portas 3000 e 3001 estão ocupadas por processo de
  outro usuário nesta máquina; cair nelas fala com o app errado e produz
  `Unable to exchange external code`. Já está fixado em `.vscode/launch.json`.
- Redirect URI `http://localhost:3002/auth/callback` — verificado aceito pelo projeto real.
- Log do servidor em `/tmp/dev3002.log`; o parâmetro `error_description` nomeia a função
  que falhou.
- `.env.local` foi reescrito nesta sessão e o servidor precisa reiniciar para pegar.

Depois do teste bem-sucedido:

```sql
drop function if exists public.teste_hook_passa(jsonb);
drop table if exists public.hook_debug;
```

## Pendência que continua aberta depois do login

**`APP_ORIGIN` da Edge Function.** O teste de `origemPermitida` é igualdade estrita, com
esquema, host e **porta**. O README exemplifica `http://localhost:3000` e é provavelmente o
valor real da secret. Com o app em 3002, colar uma URL vai ser recusado pela origem:

```bash
supabase secrets set APP_ORIGIN=http://localhost:3002
```

Nada disso afeta o login por Google — só o cadastro por URL.