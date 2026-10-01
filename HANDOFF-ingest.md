# Handoff — sessão encerrada em 2026-10-01

Estado no fim da sessão. Duas coisas abertas: a change `fix-ingest-origin-and-error-codes` (9 de 13
tasks) e um erro no teste manual que **não** foi diagnosticado. Comece por aqui.

## 1. O login por Google está resolvido

Nada pendente. Correção de `19fc3d7`: o hook Before User Created lia `event->'data'->>'email'`, e o
GoTrue manda `user->'email'` — não existe `data` no payload. A allowlist do banco também não tinha o
e-mail que logava. Os dois corrigidos, objetos de debug (`teste_hook_passa`, `hook_debug`) removidos do
remoto, grants fechados (só os três papéis de servidor executam a função do hook).

O app abre no quadro normalmente, inclusive depois de derrubar e subir o servidor.

## 2. Change aberta: `fix-ingest-origin-and-error-codes`

`openspec/changes/fix-ingest-origin-and-error-codes/` — **9/13 tasks**. Commits `d5245fb`, `0e8bab0`,
`22a451f`.

O que ela conserta: o cadastro por URL **nunca funcionou**. A Server Action chama a Edge Function por
`fetch` servidor-para-servidor, que não emite `Origin`, e a função exigia `Origin == APP_ORIGIN` na
primeira etapa do pipeline. Toda requisição real morria em `403` antes de extrair qualquer coisa. E o
`403` era traduzido para "sua sessão expirou", que manda refazer login e não resolve nada.

### Feito (grupos 1 e 2, commitados)

- `origemPermitida` aceita origem ausente. Navegador sempre envia `Origin` em cross-origin, então a
  proteção do caminho do navegador não mudou: origem presente e diferente segue recusada.
- Log da função nomeia origem e veredito: `origem=ausente:aceita`, `origem=https://x:recusada`, com o
  valor limitado em 120 chars por vir do chamador.
- `CODIGO_DA_FUNCAO` mapeia os 13 `code` reais de `_shared/erros.ts`; status virou reserva para código
  ausente ou desconhecido. Teste fixa a lista inteira, para um código novo não cair no fallback em
  silêncio.
- `nao_autorizado` e `origem_nao_permitida` têm mensagem própria, e a de allowlist não diz se o endereço
  consta da lista.
- Função **já implantada** (versão 3, deploy 2026-10-01 01:48:22 UTC). O app pegou o código novo pelo
  `next dev`.

Verificação no fim: typecheck limpo, **292** vitest, pgTAP PASS, **153** passos da função.

### Falta (4 tasks)

- **3.3** — abrir `http://localhost:3002`, colar uma URL de vaga, confirmar que entra no quadro.
- **3.4** — com e-mail fora da allowlist, conferir que a tela mostra a de falta de permissão e **não**
  "sua sessão expirada".
- **4.1 e 4.2** — registrar em `DEBUG-login-hook.md` e no README que a chamada é servidor-para-servidor
  e não carrega `Origin`, para a conferência não ser "corrigida" de volta.

3.3 e 3.4 são do navegador da usuária e **não dá para automatizar**: o projeto só tem login Google e o
login por senha está desabilitado (`email logins are disabled`), então não há como obter token para
chamar a função por script. As 4.1 e 4.2 são de documentação e podem ser feitas a qualquer momento.

## 3. O erro do teste manual — em aberto

A usuária colou uma URL da Gupy (`carreirasomie.gupy.io`) e deu erro. O que se sabe:

- A auditoria registrou **uma** tentativa, em 01/10 **01:50:47**, com `resultado = 'pendente'`.
- `resultado` tem default `'pendente'`, então isso quer dizer: **o desfecho nunca foi gravado**.
- A linha só é inserida por `etapaRateLimit`, e ela vem **depois** de origem, token, allowlist e
  validação de corpo. Ou seja: a correção da origem funcionou, e a requisição avançou bastante.
- Não é o deploy que matou a requisição: o deploy foi 01:48:22, a tentativa 01:50:47, 2,5 min depois.
- Não é a Gupy bloqueando: ela responde `200` com 140 KB de conteúdo real, sem challenge de bot, num
  `curl` daqui com User-Agent de navegador.
- RLS de `ingest_log` está correto: `UPDATE ... using (auth.uid() = user_id)`, com `with check` igual.

### As duas hipóteses que sobraram

1. **A requisição morreu por tempo.** Passou da auditoria, foi buscar a página e chamar o Gemini, e o
   limite de wall-clock da função cortou no meio. Nesse caso o `catch` do `executarPipeline` também não
   chegou a rodar, e nada foi marcado.
2. **`marcarDesfecho` falhou em silêncio.** `marcarDesfechoSilencioso` engole a exceção de propósito, então
   uma falha ali deixa a linha em `pendente` para sempre sem deixar rastro.

A segunda é a mais séria, e vale checar mesmo se for a primeira: **`resultado = 'pendente'` significa que
a tentativa não fecha, e o rate limit conta `hora`/`dia` na hora do insert.** Se as tentativas não
fecham, o limite de 20/hora e 100/dia é consumido sem nunca ser liberado — e volta a bloquear a conta
depois de um punhado de usos, com um `429` que ninguém sabe explicar.

### O primeiro passo da próxima sessão

Ler o log da função, que é o que decide entre as duas hipóteses. O CLI desta máquina (2.118.0) **não**
tem `supabase functions logs` — só o dashboard:

```
https://supabase.com/dashboard/project/lpibbdvxpsqqujmnqydk/functions/ingest-vaga
```

Procurar a linha `[ingest-vaga]` da tentativa. Ela agora inclui `origem=` (foi o que a task 1.4
acrescentou justamente para isso) e mostra se o erro foi em `fetch`, em `extracao` ou em `persistencia`.

Complemento no terminal do `next dev`, onde a action também loga:

```
[acoes/erros] status=NNN code=... code_funcao=...
```

Os dois juntos dizem a história inteira: o `code_funcao` diz a categoria, e o log da função diz o
detalhe da etapa.

Depois: decidir se é preciso corrigir o fechamento da auditoria. Se for a hipótese 2, o conserto é
tornar o `marcarDesfecho` observável — hoje ele falha em silêncio justamente no ponto em que a
informação seria mais valiosa.

## 4. Estado do ambiente

- Dev server em `http://localhost:3002`, **obrigatoriamente 3002**: 3000 e 3001 estão ocupadas por
  processo de outro usuário nesta máquina, e cair nelas fala com o app errado.
- O log do servidor vai para o terminal onde o `npm run dev` foi iniciado. `/tmp/dev3002.log` é de uma
  execução antiga e não recebe mais nada — não procurar lá.
- Conexão com o banco remoto: `psql` pelo pooler, com `SUPABASE_DB_PASSWORD` lido do Infisical
  (`/nextjs`). A senha nunca vai para argv nem log:

  ```bash
  export PGPASSWORD="$(infisical export --path=/nextjs --format=json | \
    jq -r '.[]|select(.key=="SUPABASE_DB_PASSWORD")|.value')"
  psql -h aws-1-us-east-2.pooler.supabase.com -U postgres.lpibbdvxpsqqujmnqydk -d postgres -c '...'
  ```

- `supabase db push` **não funciona** neste projeto: o papel `postgres` não tem `CREATEROLE` e o CLI
  falha ao criar o login role. As duas migrations do hook foram aplicadas por `psql` e registradas à
  mão em `supabase_migrations.schema_migrations`. Vai continuar assim até alguém conceder a role.
- Stack local do Supabase: de pé durante esta sessão, com as 4 migrations aplicadas.

## 5. Cuidado com o log de e-mails

Vale a regra do projeto (`README.md:235`): log e terminal não recebem endereço de e-mail. Os scripts
`scripts/verificar-allowlist.sh` e `scripts/configurar-edge-function.sh` existem em parte para permitir
comparar listas por md5 sem nunca imprimir o conteúdo. A `ALLOWED_EMAILS` da Edge Function é o espelho
de `public.allowed_emails` e sai de lá por comando, nunca digitada — foi a divergência entre as três
listas que quebrou o login nesta semana.

## 6. Não commitado

```
 M next-env.d.ts                                  (gerado pelo next dev; descartar)
```

O `tasks.md` da change vai junto no próximo commit junto com 4.1 e 4.2.
