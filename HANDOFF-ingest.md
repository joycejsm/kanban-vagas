# Handoff — sessão encerrada em 2026-10-01

Estado no fim da sessão. O erro do teste manual foi **diagnosticado e consertado** — mas o conserto
ainda **não está commitado nem implantado**. Duas coisas em aberto, nesta ordem:

1. a change `fix-ingest-audit-window-and-outcome` (código pronto e verificado, **falta o deploy**);
2. a extração da Gupy, que é a **próxima change** e só fica demonstrável depois do deploy.

## 1. O login por Google está resolvido

Nada pendente. Correção de `19fc3d7`: o hook Before User Created lia `event->'data'->>'email'`, e o
GoTrue manda `user->'email'` — não existe `data` no payload. A allowlist do banco também não tinha o
e-mail que logava. Os dois corrigidos, objetos de debug (`teste_hook_passa`, `hook_debug`) removidos do
remoto, grants fechados (só os três papéis de servidor executam a função do hook).

O app abre no quadro normalmente, inclusive depois de derrubar e subir o servidor.

## 2. Change aberta: `fix-ingest-origin-and-error-codes`

`openspec/changes/fix-ingest-origin-and-error-codes/` — **11/13 tasks**. Commits `d5245fb`, `0e8bab0`,
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

### Falta (2 tasks, ambas do navegador da usuária)

- **3.3** — abrir `http://localhost:3002`, colar uma URL de vaga, confirmar que entra no quadro.
- **3.4** — com e-mail fora da allowlist, conferir que a tela mostra a de falta de permissão e **não**
  "sua sessão expirou".

As tasks **4.1 e 4.2 estão feitas**: `DEBUG-login-hook.md` ganhou a seção "O que nenhuma suíte pegou"
e o README ganhou "A chamada é servidor-para-servidor, e por isso não leva `Origin`".

3.3 e 3.4 **não dá para automatizar**: o projeto só tem login Google e o login por senha está
desabilitado (`email logins are disabled`), então não há como obter token para chamar a função por
script.

⚠️ **3.3 muda de resultado esperado.** Com URL da Gupy a resposta passa a ser `422` pedindo o texto
colado, não `201` — ver a seção 3. Um `422` ali é o primeiro sinal de que o pipeline inteiro rodou.

## 3. O erro do teste manual — RESOLVIDO, consertado e implantado (v4)

O `resultado = 'pendente'` **não** era morte por tempo nem `marcarDesfecho` falhando — as duas
hipóteses do handoff anterior. Era uma terceira.

**Causa raiz:** `contarDesde` mandava `now() - interval '1 hour'` como **valor** de filtro
(`criado_em=gte.now() - interval '1 hour'`). O PostgREST não avalia SQL em filtro, e devolve
`400 / 22007 invalid input syntax for type timestamp with time zone`. Como a contagem usava
`head: true` (requisição HEAD, sem corpo), o `supabase-js` devolvia um erro de **mensagem vazia** →
`auditoria-indisponivel` → `etapaRateLimit` lançava → o `catch` do pipeline rodava com
`auditoriaAberta = false` e deixava a linha aberta.

Isso era pior do que o 500: **a ingestão por URL nunca passou do limite de uso** — nem fetch, nem
Gemini, nem insert. E cada tentativa consumia cota sem nunca fechar, o que tornava o `429` de 20/hora
uma hipótese sem explicação.

As duas hipóteses do handoff anterior foram descartadas na prática: a query reproduzida no PostgREST
real dá o `22007`; o `PATCH` com `order` + `limit` tem os dois **ignorados** (o código antigo
fechava todas as pendências do usuário, não uma); e o grant de `update` só na coluna funciona. A
camada de dados está saudável.

### O que o conserto faz

`openspec/changes/fix-ingest-audit-window-and-outcome/` — **12/13 tasks**: a 4.2 está implantada, e
a parte do `curl` autenticado dela **não é executável** (ver "Implantado" abaixo). Janela em ISO 8601
calculada no isolate (as duas do mesmo instante); registro e contagem viraram etapas separadas; desfecho
gravado pelo `id` criado, não por "a pendente mais recente"; etapa `auditoria` nomeada no log; falha ao
fechar a linha aparece no log em vez de sumir.

### Implantado — versão 4

Commit `337bd12`, implantado em **2026-10-01 05:03:35 UTC**. A anterior era a versão 3, de
01:48:22, que tinha o defeito. O gateway responde `401 UNAUTHORIZED_NO_AUTH_HEADER` para requisição
sem token, com e sem `Origin` — confirma que a função subiu e que `verify_jwt` continua ligado.

**O que ainda não foi provado é a correção da auditoria em si.** A etapa de auditoria vem depois de
autenticação e allowlist, e o gateway recusa antes do corpo da função rodar: **nenhum `curl` sem
token alcança a contagem**. Prová-lo exige token de produção, e não há como obter um sem login
Google pelo navegador. Na prática, a prova é a task **3.3**: colar a URL da Gupy e ver que o
resultado é `422` pedindo o texto colado, e não `500`.

O CLI desta máquina (2.118.0) **não** tem `supabase functions logs`; para o log da função, o
dashboard: `https://supabase.com/dashboard/project/lpibbdvxpsqqujmnqydk/functions/ingest-vaga`.

## 3-bis. Próxima change: a Gupy devolve casca de React, não a vaga

Medido enquanto se reproduzia o defeito da auditoria: a página da Gupy
(`carreirasomie.gupy.io/job/...`) responde `200` com **3.905 bytes** de casca de React
(`<div id="candidates-root">`, `<noscript>You need to enable JavaScript to run this app.</noscript>`).
Não há `JobPosting` em JSON-LD nem texto visível — o anúncio é montado no cliente. A extração
devolve campos vazios e a resposta vira `422` pedindo o texto colado.

**É outra change**, e ela só fica demonstrável depois do deploy acima: este conserto faz a requisição
*chegar* à extração, não faz a extração funcionar na Gupy. Colar a URL da Gupy deve dar `422` — se
voltar a dar `500`, o conserto da auditoria não chegou.

Nota de um teste local: a extração falhou uma vez com `503 high demand` do Gemini. Transitório —
`gemini-3.5-flash` responde `200`.

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

## 6. Estado da árvore

**Limpa.** Tudo foi commitado em `337bd12` e implantado em produção (v4).

O que sobrou foi a sujeira do ambiente local, e é o que a próxima sessão deve saber:

- `supabase functions serve` continua rodando em background (PID 1112171), com o env-file
  `/tmp/env-funcao-1112126.env` — modo 600, contém `GEMINI_API_KEY` real.
- `/tmp/token-local` é um token da **stack local**; foi corrigido de 664 para **600** nesta sessão.
  Não é token de produção, e não serve para provar a 4.2.
- Um usuário de teste e duas linhas de auditoria na **stack local**, não na remota.

A stack local pode ser derrubada sem perda: o deploy já foi feito e nenhuma tarefa pendente depende
dela.
