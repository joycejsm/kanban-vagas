# Handoff — sessão encerrada em 2026-10-01

## Resumo de encerramento

**O que deu certo.** A ingestão por URL funciona em produção. Três mudanças, três commits, uma
implantação. O que era "a funcionalidade nunca funcionou" passou a "funciona, com a extração
melhorável":

1. `22a451f` + `0e8bab0` — a chamada servidor-para-servidor não carrega `Origin`, e o `403` deixou de
   virar "sua sessão expirada". Commitados antes desta sessão.
2. `337bd12` — **a auditoria conserta e implantada (v4, 05:03:35 UTC)**. Era o bloqueio real: a
   contagem de janela mandava SQL como valor de filtro, o PostgREST recusava com `22007`, e como o
   filtro usava `head: true` o erro chegava sem mensagem. Nenhuma requisição passava do limite de uso.
3. `7e159de` — change `fix-ld-json-entity-decoding`, que remove a dependência do Gemini nas vagas da
   Gupy. **Proposta, sem código escrito.**

**A prova, fora da tela.** Doze tentativas na auditoria de produção, sete delas falhas, e **nenhuma
linha `pendente`**. Todos os desfechos foram gravados: 3 `sucesso`, 2 `duplicada`, 7 `erro`. Essa era a
promessa do conserto, e é o número que importa.

**O que ficou errado no caminho, e vale mais que o conserto.** A change anterior foi escrita sobre uma
medição falsa — a Gupy "devolve 3.905 bytes de casca de React" era a página de *autenticação*, não uma
página de vaga. A mesma página do handoff já dizia "140 KB" e "3.905 bytes" para a Gupy, lado a lado.
Ver a seção 3-bis.

## Em uma linha

A ingestão funciona. O `fix-ld-json-entity-decoding` é o próximo passo, e ele é **desacelerar**: tirar
uma chamada ao modelo do caminho principal, não adicionar capacidade.

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

⚠️ **3.3 muda de resultado esperado.** A vaga tem que entrar no quadro. **Não** se espera `422` pedindo
o texto colado com URL da Gupy — essa expectativa veio da medição falsa corrigida na seção 6.

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

## 3-bis. A Gupy funciona — e o defeito é o `ld+json` escapado

A seção anterior afirmava que a Gupy devolvia 3.905 bytes de casca de React sem `JobPosting`. **Era
falso**, e a premissa daquela change estava errada. Medido nas URLs reais:

| host | resposta | `ld+json` | `extrairTexto` | desfecho |
|---|---|---|---|---|
| `carreirasomie.gupy.io` | 200, 117 KB | `JobPosting` completo | 3.480 chars | `sucesso` ×2 |
| `stefanini.gupy.io` | 200, 118 KB | `JobPosting` completo | 5.680 chars | `sucesso` (1 de 4) |
| `carreiras.inhire.app` | 200, 12,6 KB | **nenhum** | **6 chars** (`"InHire"`) | `erro` ×3 |

O `ld+json` da Gupy começa com `{&quot;@context&quot;…}` — o JSON vem **escapado como HTML**. Dentro de
`<script>` as entidades não são decodificadas, então `JSON.parse` lança, o `catch` engole e
`extrairLdJson` devolve `null`. Toda vaga da Gupy é extraída pelo modelo quando não precisa, e some
quando o modelo está indisponível. A Stefanini falhou 3 de 4 por `503 high demand` — transitório, e
irrelevante, porque nenhuma chamada era necessária.

A Inhire é limitação, não defeito: `extrairTexto` devolve 6 caracteres e não há dado em nenhum
formato. O `422` pedindo o texto colado é o comportamento correto, e o fallback existe.

Change aberta: `fix-ld-json-entity-decoding` — 12 tasks, sem código escrito ainda. Ver
`openspec/changes/fix-ld-json-entity-decoding/`.

### A lição da medição errada

Os 3.905 bytes vieram de `/candidates/auth`, a página de autenticação — não de uma página de vaga. É a
mesma origem e uma página completamente diferente. Pior: o handoff já registrava "140 KB de conteúdo
real" **e** "3.905 bytes" para a Gupy. A contradição estava escrita no documento e ninguém parou para
resolver antes de escrever a change.

Duas regras: **teste a URL que o sistema processa**, e **duas medições que se discordam são sinal, não
incômodo**.

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

## 6. Estado da árvore e o que falta

**Limpa**, exceto pela change nova desta sessão. Commits: `337bd12` (o conserto), `222cd92` e `93d9f27`
(docs), `7e159de` (a change). Produção está na **v4**.

### Falta resolver

1. **`fix-ld-json-entity-decoding`** — 12 tasks, proposta pronta, nenhum código escrito. É o próximo
   passo e é *desacelerar*: tira uma chamada ao Gemini do caminho principal e faz os requisitos
   aparecerem. Task 3.2 prova a retirada da dependência sem depender do Gemini estar de pé.
2. **Task 3.4** da `fix-ingest-origin-and-error-codes` — a última de código: e-mail fora da allowlist
   tem que mostrar "falta de permissão" e **não** "sua sessão expirada". Só no navegador.
3. **A limpeza de `extrairListaDaDescricao`**, por decisão da usuária: depois do conserto da change
   acima, o primeiro requisito ainda sai como `"Descrição da vagaA Omie tem como propósito…"`, porque
   o limpador não separa o cabeçalho `<h2>` do texto. Change própria, para não misturar duas causas.
4. **Limpeza do ambiente local** — o `functions serve` (PID 1112171) e o env-file
   `/tmp/env-funcao-1112126.env` (modo 600, com `GEMINI_API_KEY` real) continuam de pé, e
   `/tmp/token-local` existe (corrigido de 664 para 600). Um usuário de teste e duas linhas de
   auditoria na **stack local**, não na remota. Nada disso é produção e nada mais depende de nada
   disso: a stack pode ser derrubada à vontade.

### O que não dá para automatizar

As tasks de navegador (3.3 foi feita, 3.4 falta) porque o projeto só tem login Google e o login por
senha está desabilitado. E a verificação por `curl` autenticado da 4.2 também não é possível: a etapa de
auditoria vem depois de autenticação, e o gateway recusa antes do corpo da função rodar. Não há como
obter token de produção sem passar pelo navegador.

---

## 7. Segunda sessão do mesmo dia — a identidade visual

> As seções 1 a 6 descrevem o encerramento da **primeira** sessão de 2026-10-01. Esta seção é o
> estado do repositório depois da segunda. A seção 6 continua válida como registro do que era
> verdade naquele momento; o que mudou está aqui.

### O que foi feito

**`bd5bc1c`** — a premissa falsa da Gupy, corrigida **na change que a escreveu**. Não era o
`HANDOFF` que ainda afirmava os 3.905 bytes: era o `proposal.md` e o `design.md` da
`fix-ingest-audit-window-and-outcome`, que estava com 15/15 tasks e pronta para arquivar. A
task 4.1 da change seguinte apontava para o arquivo errado. Saiu junto a expectativa de `422` com
URL da Gupy, que aparecia em três lugares e coexistia com a própria correção no mesmo arquivo.

**`5f2673e`** — a UI. Base marrom-quase-preto em vez de branco, texto creme, nenhum azul de link,
aviso em terracota e ocre, e um tom próprio por coluna. Fontes: **Fraunces** nos títulos (o eixo
`WONK` é o traço da identidade), **IBM Plex Sans** no corpo, **IBM Plex Mono** em rótulos,
contagens e metadados. Todos os tokens em `globals.css`, nenhum componente escreve um hexadecimal.

### A verificação da CSP, medida e não suposta

O comentário antigo do `layout.tsx` dizia que uma fonte exigiria `style-src`/`font-src` e uma
decisão de segurança da Fase 3. Isso descreve `<link>` para um CDN. O `next/font` é outra coisa:
**baixa a fonte no build** e serve em `/_next/static/media/`, na própria origem, com as regras
`@font-face` numa folha servida de lá. Conferido no HTML entregue:

- `font-src 'self'` **continua valendo**, nenhuma requisição para fora;
- **zero `<style>` inline** — e é essa ausência que dispensa `style-src`, porque a diretiva cairia
  em `default-src 'self'` e bloquearia estilo inline sem nonce;
- os `@font-face` apontam para `url(media/….woff2)`, caminho relativo, mesma origem.

A CSP **não foi tocada**.

### Duas armadilhas que só apareceram ao renderizar de verdade

Nenhuma delas passa por typecheck ou por teste, e as duas estão documentadas no código.

1. **Classe montada por interpolação não existe.** A primeira versão usava
   `border-l-${corDaColuna(status)}`. O Tailwind varre o **texto** dos arquivos: uma classe
   montada em runtime não aparece em lugar nenhum do código-fonte e **não entra no CSS** — sem erro,
   sem aviso, coluna sem cor. `src/quadro/aparencia.ts` devolve classes **escritas por extenso**
   (`border-l-coluna-aplicado`), e a repetição é o preço da correção aparecendo no diff.
2. **Glifo fora do subset.** A seta `↗` (U+2197) do link saía como **caixa vazia** no meio do card:
   o subset latino do IBM Plex Mono cobre U+2191, U+2192, U+2193 e U+2195, e **não** U+2197. Virou
   `→`. O glifo precisa estar no `unicode-range`, não só existir no arquivo.

Também: o comentário da textura prometia uma vinheta radial que **nunca tinha sido escrita**, e que
escrita no `<html>` ficaria invisível sob o `background-color` opaco do `<body>`. Está agora na
regra do `body`, com `min-height: 100vh`.

### O único teste que mudou

`tests/quadro/render.test.ts` fixava a contagem como `>2<` e `>0<`; ela passa a sair como `02` e
`00`. A **intenção** do teste — um 2 e quatro 0, um por coluna — é a mesma, então a asserção foi
atualizada em vez de a notação desfeita. Nada mais da suíte foi tocado: 292 testes verdes.

### Como conferir a UI sem subir nada

O `next dev` do usuário estava de pé, mas o quadro exige sessão e o projeto só tem login Google.
O que serviu foi um **preview estático**: um teste temporário renderiza `<Quadro>` e
`<FormularioNovaVaga>` com `renderToStaticMarkup`, joga o HTML em `/tmp/preview/body.html` junto
do CSS compilado (`.next/static/chunks/*.css`, com `url(../media/` → `url(media/` e os `.woff2`
copiados para `/tmp/preview/media/`), e o Chrome headless tira a foto:

```
google-chrome --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1600,760 --screenshot=/tmp/preview/quadro.png --virtual-time-budget=6000 body.html
```

O Chrome está instalado. O teste que gerava o HTML foi removido — ele escrevia em `/tmp` sem
condição, e não pode ficar na suíte. **As classes de fonte no `<html>` são com hash** e mudam a cada
build: pegue-as do HTML servido, não as adivinhe. Adivinhar foi o que fez o Fraunces parecer ausente
na primeira foto, quando o defeito era do preview.

### ⚠️ O push não saiu

```
fatal: could not read Username for 'https://github.com'
```

Não é permissão do repositório: é credencial. O remote é HTTPS, não há `gh` instalado, não há
credential helper, e a `~/.ssh/id_ed25519.pub` **não** está registrada no GitHub
(`Permission denied (publickey)`).

**A Atenção que importa:** o `origin/main` tem **1 commit** ("feat: fases 1 e 2 parciais"). O local
tem **29**. São **28 commits a frente** — nada desde as fases 1 e 2 foi para o remoto. O primeiro
passo da sessão que vem é `! git push origin main`, e vale olhar o diff antes: são 28 commits,
não 2.

### Estado do repositório

Árvore limpa. `bd5bc1c` e `5f2673e` são desta sessão. Typecheck limpo, 292 testes verdes, build
ok. Produção continua na **v4** da função `ingest-vaga` — nada foi implantado nesta sessão, e a
**UI nova não está em produção**.

`next-env.d.ts` é rastreado e o Next 16 reescreve os `import` entre `./.next/types/` e
`./.next/dev/types/` conforme o último comando rodado. Ele suja a árvore sozinho depois de
`build` ou `dev`; foi revertido aqui. Se aparecer num `git status`, é isso.

### O que falta, em ordem

1. **`! git push origin main`** — 28 commits. Bloqueia tudo.
2. **Implantar a UI.** Commitada, não em produção. Não sei como o Next é implantado neste projeto.
3. **`fix-ld-json-entity-decoding`** — 12 tasks, 0 feitas. Continua sendo o próximo passo de
   *código*, e é desacelerar: tira uma chamada ao Gemini do caminho principal. A task 3.2 prova a
   retirada da dependência sem depender do Gemini estar de pé.
4. **Task 3.4** da `fix-ingest-origin-and-error-codes` — só no navegador: e-mail fora da allowlist
   tem que mostrar "falta de permissão" e **não** "sua sessão expirada".
5. **Arquivar** `fix-ingest-audit-window-and-outcome` — 15/15, nenhuma pendente. É a change da
   medição falsa que a sessão passada corrigiu.
6. **A limpeza de `extrairListaDaDescricao`**, por decisão da usuária: depois do conserto do item 3,
   o primeiro requisito ainda sai como `"Descrição da vagaA Omie tem como propósito…"`. Change
   própria, para não misturar duas causas.

### Ambiente local (nada disso é produção, e nada mais depende)

O `supabase functions serve` (PID 1112171) e o `edge-runtime` (PID 1214361) continuam de pé;
`/tmp/env-funcao-1112126.env` (modo 600, com a `GEMINI_API_KEY` real) e `/tmp/token-local`
(modo 600) existem; há um usuário de teste e duas linhas de auditoria na **stack local**, não na
remota. Pode ser derrubado à vontade — apagar o token local é irreversível, então preferi não mexer.

Efeito colateral desta sessão: o teste de chave SSH adicionou `github.com` ao `~/.ssh/known_hosts`.
Inofensivo, mas foi a agente.
