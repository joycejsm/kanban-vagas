# Kanban de Vagas

Kanban pessoal para acompanhar as vagas de emprego às quais me candidatei. Cole a URL de um anúncio, o sistema
extrai título, empresa e requisitos, e a vaga entra no quadro — de onde sai para `entrevista_1`,
`fase_tecnica`, `proposta` ou `rejeitado`.

## Stack

- **Frontend:** Next.js (App Router), React, TypeScript strict, Tailwind CSS, @dnd-kit
- **Backend:** Supabase (Postgres + Auth com Google OAuth + Edge Functions em Deno)
- **Validação:** Zod, schemas compartilhados entre frontend e Edge Functions
- **Extração:** Cheerio + Google Gemini

## Estado atual

| Fase | Módulo | Situação |
|------|--------|----------|
| 1 | Domínio + persistência (`vagas`, RLS, `vagaService`) | ✅ implementado e testado |
| 2 | Edge Function `ingest-vaga` | ✅ implementado e testado |
| 3 | Auth + Server Actions | ✅ implementado e testado (falta o ciclo de login real no navegador e a ativação do hook no painel) |
| 4 | Interface Kanban | ⏳ change criada, vazia |
| — | Scaffold Next.js (`src/app`, env no servidor) | ✅ implementado e testado |

## Estrutura

```
src/app/layout.tsx                   Layout raiz do App Router (Server Component)
src/app/page.tsx                     Rota / mínima, sem UI de produto
src/app/globals.css                  Folha de estilos global (@import do Tailwind v4)
src/config/serverEnv.ts              Config do Supabase lida no servidor e validada com Zod
src/config/csp.ts                    Content Security Policy montada a partir da config
src/instrumentation.ts               Recusa a subida em dev quando falta configuração
next.config.ts                       Config do Next: CSP e cabeçalhos de hardening
postcss.config.mjs                   Plugin do Tailwind v4

src/domain/vaga.ts                    Schemas Zod (VagaCreateInput, VagaRow, StatusVaga)
src/services/vagaService.ts           Acesso às vagas, cliente Supabase por injeção
src/services/vagaService.errors.ts    VagaDuplicadaError, VagaServiceError

supabase/migrations/                  Migrações SQL (tabelas, RLS, triggers)
supabase/tests/vagas_rls.sql          Testes pgTAP de RLS e integridade
supabase/tests/auth_allowlist.sql     Testes pgTAP da allowlist e do hook Before User Created

src/middleware.ts                    Protege as rotas: valida a sessão e redireciona
src/lib/supabase/server.ts           Fábrica única de cliente Supabase no servidor
src/auth/rotas.ts                    ROTAS_PUBLICAS e decidirRedirecionamento
src/auth/protegerRotas.ts            Núcleo da decisão de rota, sem tipos do Next
src/auth/next.ts                     sanearNext: o parâmetro `next` nunca vira URL externa
src/auth/origem.ts                   Deriva a origem da requisição para o redirectTo
src/auth/allowlist.ts                emailAutorizado e a leitura de ALLOWED_EMAILS
src/auth/concluirLogin.ts            Troca do código por sessão + decisão de acesso
src/app/login/page.tsx               Tela de login (Server Component)
src/app/login/actions.ts             Server Action do OAuth com PKCE
src/app/auth/callback/route.ts       Route Handler que troca o código e redireciona
src/app/actions/erros.ts             mapearErroIngestao: HTTP → code da interface
src/app/actions/dependencias.ts      Dependências injetáveis das Server Actions
src/app/actions/vagas.ts             adicionarVaga e atualizarStatus

supabase/functions/ingest-vaga/
  index.ts                            Deno.serve: composição das dependências
  deno.json                           Import map (reusa src/domain/vaga.ts)
  _shared/
    pipeline.ts                       Etapas encadeadas, primeira falha interrompe
    urlSafety.ts                      Anti-SSRF: forma, host, DNS, faixas
    buscar.ts                         Fetch com timeout, tipo, teto e redirects
    parsing.ts                        Cheerio, limpeza do HTML, ld+json
    llm.ts                            Prompt com nonce, resposta estruturada
    env.ts                            Leitura das secrets
    http.ts                           Respostas, erros e log restrito
    supabase.ts                       Auth, auditoria e inserção

tests/                                Testes unitários (vitest)
```

## Desenvolvimento local

### Pré-requisitos

- Node.js 22+
- Docker (para o Supabase local)
- [Supabase CLI](https://supabase.com/docs/guides/cli) — `npx supabase`

### Subir o banco local

```bash
npx supabase start          # sobe Postgres, Auth, Storage e Studio
npx supabase status -o env  # imprime API_URL e DB_URL
```

Studio: http://127.0.0.1:54323

### Rodar a aplicação

Copie `.env.example` para `.env.local` e preencha as duas variáveis `NEXT_PUBLIC_*`. Sem elas o servidor
de desenvolvimento **recusa subir** e diz exatamente qual está faltando — ele não sobe degradado.

```bash
npm install
npm run dev                  # http://localhost:3000
```

Build de produção:

```bash
npm run build                # next build
npm run start                # serve o artefato de produção
```

A rota `/` é um Server Component mínimo, sem UI de produto: a interface do quadro é da fase 4. O build não
precisa de `.env.local` — a configuração é lida em tempo de requisição, não em tempo de build.

### Rodar os testes

```bash
npm run verificar         # typecheck + as três suítes abaixo, em sequência

npm run typecheck         # tsc --noEmit
npm test                  # vitest: domínio, serviço, scaffold, auth e actions (172 testes)
npm run test:db           # pgTAP: 26 asserções de RLS + 18 da allowlist, no Postgres
npm run test:funcao       # deno test da Edge Function (35 testes, 144 passos)
```

As suítes são separadas de propósito. `npm test` é só vitest porque é o que roda sem Docker e
sem Deno; as outras duas precisam de `npx supabase start` e de Deno instalados. O script da
função usa `deno task`, que aplica o import map do `deno.json` — rodar `deno test` direto na
pasta não resolve o `@/domain/vaga`.

Os scripts de SQL rodam dentro de uma transação com `ROLLBACK` no fim — os usuários, vagas e e-mails de
teste não persistem. Cada um também cria o `pgtap` (`create extension if not exists pgtap`) dentro dessa
própria transação: a stack local traz a extensão disponível mas não instalada, e sem ela `plan()` e `is()`
não existem, o `psql` emite erro em cada linha e o arquivo reporta um único subteste — ou seja, "passa" sem
verificar nada. O mesmo cuidado vale para o `deno test`, que também sai com código 0 quando não encontra
nenhum teste: um nome de arquivo ou diretório errado produz um verde vazio, não uma falha.

### Testar a função localmente

```bash
npx supabase functions serve ingest-vaga --env-file .env.local

curl -i http://127.0.0.1:54321/functions/v1/ingest-vaga \
  -H "Origin: http://localhost:3000" \
  -H "Authorization: Bearer <token de sessão>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://empresa.com/vaga/1"}'
```

## Edge Function `ingest-vaga`

A função recebe `{ url }` (ou `{ url, texto }`, com `texto` ≤ 30.000 caracteres para quando o site bloqueia
ou renderiza por JavaScript), extrai os dados e cria a vaga com o JWT do próprio usuário.

O pipeline é sequencial e para na primeira falha:

```
CORS → autenticação → allowlist → rate limit (20/h, 100/dia) → URL + DNS
     → fetch (8 s, text/html, 1,5 MB, 3 redirects revalidados) → limpeza do HTML
     → ld+json → Gemini (só se o estruturado não bastar) → Zod → insert → log
```

Respostas: `201 { vaga }`, ou `{ code, message }` com `401` (sessão), `403` (origem ou e-mail), `409`
(duplicada), `422` (URL ou extração), `429` (limite), `502`/`413`/`500` (fetch).

### Secrets obrigatórias

Definidas com `scripts/configurar-edge-function.sh` — nunca no frontend e nunca em `NEXT_PUBLIC_*`:

| Secret | Valor |
|--------|-------|
| `GEMINI_API_KEY` | chave da API do Google Gemini |
| `GEMINI_MODEL` | ex. `gemini-3.5-flash` |
| `ALLOWED_EMAILS` | lista separada por vírgula |
| `APP_ORIGIN` | origem do app, ex. `http://localhost:3002` |

### O que a função NÃO faz

- Não renderiza JavaScript: sites que só existem após JS exigem o fallback de texto colado.
- Não acessa sites que exigem login.
- Não usa a service role key: o insert usa o JWT do usuário, e o RLS se aplica.
- Não devolve o corpo bruto da página, nem a saída do modelo.

### Risco residual conhecido

Há janela de **DNS rebinding** entre a resolução que a função aprova e o `fetch` que conecta — Edge Functions
não permitem fixar o IP resolvido. A mitigação é o ambiente de execução (sem rede privada), não o código.
O detalhe está em `_shared/urlSafety.ts`.

### Pré-requisitos manuais

Nada abaixo é feito por código — precisam ser feitos uma vez no painel ou no CLI:

- **Secrets**: `scripts/configurar-edge-function.sh` publica as quatro e implanta a função.
  Ele lê `GEMINI_API_KEY` do Infisical e deriva `ALLOWED_EMAILS` de `public.allowed_emails`,
  para que a lista não seja digitada em três lugares (ver
  [O que fica no Supabase, para a Edge Function](#o-que-fica-no-supabase-para-a-edge-function)).
- **Migração da auditoria**: `supabase db push` aplica `ingest_log` com RLS.
- **Provedor Google OAuth**: já configurado no projeto.
- **`verify_jwt`**: confirme que continua habilitado na função depois do deploy — o output de
  `supabase functions deploy` é quem diz. Sem ele, a autenticação do passo seguinte do pipeline não roda.

Deploy:

```bash
supabase functions deploy ingest-vaga
```

Rollback: `supabase functions delete ingest-vaga` e remover a tabela de auditoria. Nenhum dado de
`vagas` é tocado.

## Deploy

```bash
supabase link                              # uma vez, associa o projeto
supabase db push                           # aplica as migrações
scripts/configurar-edge-function.sh        # secrets + deploy da ingest-vaga
```

O provedor Google OAuth já está configurado no projeto Supabase. Nada disso é feito por código.

Depois do `db push`, ainda faltam dois passos manuais de acesso — ver
[Acesso por allowlist](#acesso-por-allowlist):

1. popular `public.allowed_emails` com os e-mails autorizados;
2. ativar o hook **Before User Created** em **Authentication → Hooks** no painel, apontando para
   `public.rejeitar_email_fora_da_allowlist`.

## Segurança

Regras que valem para todo o código deste projeto (detalhes em `openspec/project.md`):

- Nenhum segredo em `NEXT_PUBLIC_*`. A service role key **nunca** é usada em fluxo disparado por usuário.
- `user_id` vem sempre do servidor (`auth.uid()`), nunca do input do cliente.
- Sessão validada no servidor com `getUser()` ou `getClaims()`, nunca `getSession()` sozinha.
- Toda entrada externa passa por schema Zod com limites de tamanho.
- Saída do LLM nunca é renderizada como HTML nem usada como URL.
- Só e-mails autorizados usam o app — ver [Acesso por allowlist](#acesso-por-allowlist).
- Erros ao cliente são genéricos; logs não contêm conteúdo raspado, tokens ou e-mails.
- Toda tabela nasce com RLS habilitado e policies na mesma migração que a cria.

## Acesso por allowlist

O acesso é restrito a e-mails autorizados, e a restrição existe em **duas camadas** independentes. Nenhuma
delas consulta a outra, e nenhuma é suficiente sozinha: cada uma cobre um ponto de entrada que a outra não
alcança.

| | Onde mora | Quem decide | Cobre |
|---|---|---|---|
| `public.allowed_emails` | banco, migration `20260930001500_allowed_emails.sql` | hook Before User Created | a **criação** da conta |
| `ALLOWED_EMAILS` | variável do servidor Next | `src/auth/concluirLogin.ts` | o **acesso** a quem já tem conta |

A tabela **não tem policy**: RLS habilitado e zero policies significa que `anon` e `authenticated` não leem
a lista. Só a função `security definer` do hook a consulta, com o privilégio do dono. Nada na aplicação lê a
tabela — administrá-la é um passo manual, nunca uma requisição de usuário.

### Sincronia

As duas listas precisam ter o **mesmo conteúdo**, e o dono do app é quem mantém isso. O banco não tem
consulta de ambiente, e o Next não lê a tabela; a sincronia é um comando explícito, feito nos dois lados:

```bash
# 1. ver o que está no banco
supabase db push                                        # aplica a migration (uma vez)
psql "$DB_URL" -c "select email from public.allowed_emails order by email"

# 2. espelhar no servidor Next
#    .env.local → ALLOWED_EMAILS='a@exemplo.com,b@exemplo.com'   (vírgula, sem espaço obrigatório)
```

Para conferir que as duas pontas concordam:

```bash
psql "$DB_URL" -c "select string_agg(email, ',' order by email) from public.allowed_emails"
```

O resultado é o valor exato de `ALLOWED_EMAILS`. Nos dois lados o e-mail é normalizado com
`lower(trim(...))`, então `Bruno@Exemplo.com` e `bruno@exemplo.com` são o mesmo endereço.

### Em caso de divergência

Quem decide é a lista do servidor Next — **o banco nunca amplia o acesso**. Os dois desvios são
conservadores, e nenhum dos dois abre a porta para alguém de fora:

- **Na tabela, fora do `ALLOWED_EMAILS`** — o hook deixa a conta ser criada, mas o callback encontra o
  e-mail ausente da lista e **encerra a sessão** na hora (`/login?erro=nao_autorizado`). A conta existe e
  não entra.
- **No `ALLOWED_EMAILS`, fora da tabela** — o hook recusa a **criação** da conta. O e-mail só passa a
  valer para quem já tinha conta antes da mudança, porque o hook não roda retroativamente.

Ou seja: a tabela é a fonte do hook, `ALLOWED_EMAILS` é o espelho do callback, e uma lista só pode
restringir em relação à outra, nunca ampliar.

### Ativar o hook (passo manual)

Nada abaixo é feito por código — a API do painel não é chamada por nenhum arquivo da aplicação:

1. **Authentication → Hooks** no painel do Supabase.
2. Ligar o hook **Before User Created**, apontando para a função
   `public.rejeitar_email_fora_da_allowlist`.
3. Em **Authentication → Providers**, manter **apenas o Google** habilitado — desativar e-mail com senha e
   qualquer outro provedor, para que a única porta de entrada seja a que a allowlist cobre.
4. Popular `public.allowed_emails` com os e-mails autorizados.

## Fluxo de segredos

Duas etapas distintas, com origens distintas, e a linha que as separa é a mais importante do
setup inteiro: **a service role key nunca entra no Next.js**.

### O que vem para o `.env.local` do Next

Três variáveis, e só:

| Variável | De onde | Por quê no Next |
|----------|---------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Infisical | URL do projeto; pública por definição |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Infisical | Chave pública, protegida por RLS |
| `ALLOWED_EMAILS` | Infisical | Política de acesso do dono do app |

A materialização local é feita a partir do Infisical e o arquivo resultante é ignorado pelo
git — `.env.local` e `.infisical.json` estão no `.gitignore`, e nenhum valor real é escrito em
arquivo versionado. `.env.example` serve de base, com valores de marcador.

### O que fica no Supabase, para a Edge Function

```bash
scripts/configurar-edge-function.sh
```

Das quatro secrets, **só `GEMINI_API_KEY` precisa ser buscada fora** (aistudio.google.com), e
ela mora no Infisical. As outras três derivam, e derivar é o ponto:

| secret | de onde vem |
|---|---|
| `GEMINI_API_KEY` | Infisical, `/nextjs` (ou digitada, se não usar Infisical) |
| `GEMINI_MODEL` | nome do modelo, ex. `gemini-3.5-flash`; padrão do script |
| `APP_ORIGIN` | a origem em que o app roda, ex. `http://localhost:3002` |
| `ALLOWED_EMAILS` | `public.allowed_emails`, por `string_agg` |

O script para em vez de aceitar lista digitada se o banco estiver inacessível: seguir com uma
lista inventada é a divergência que `scripts/verificar-allowlist.sh` existe para detectar. Os
valores vão por `--env-file` num arquivo com permissão 600, nunca por argv, para não aparecerem
em `ps` nem no histórico.

`GEMINI_API_KEY` e `GEMINI_MODEL` só existem aí. A função é o único lugar do sistema que fala
com o LLM, e é por isso que a chave mora no ambiente dela: colocá-la no Next a colocaria no
bundle do servidor, onde um erro de configuração a levaria para um log.

`ALLOWED_EMAILS` aparece **nos dois lados de propósito** — a Edge Function usa a dela para
validar a URL antes de gastar uma chamada, e o Next usa a sua no callback. As duas precisam
conferir com a tabela `public.allowed_emails`; ver [Acesso por allowlist](#acesso-por-allowlist).

### Por que a service role key não entra no Next

Ela ignora o RLS. Todo o modelo de permissão deste projeto é o RLS mais `auth.uid()`, e uma
key administrativa no ambiente do Next tornaria essa propriedade invisível: qualquer handler
que a usasse escreveria em nome de qualquer usuário sem deixar rastro. Administrar o banco é
trabalho de job explícito com `supabase secrets set`, nunca de uma requisição disparada por
usuário (invariante 2).

### Popular a lista sem digitar e-mails no repositório

```bash
# 1. o banco é a fonte; leia de lá em vez de manter duas listas à mão
psql "$DB_URL" -c "select string_agg(email, ',' order by email) from public.allowed_emails"

# 2. grave o resultado no Infisical, não em arquivo versionado
infisical run --env=dev -- sh -c 'echo "ALLOWED_EMAILS=<a-lista-que-vem-acima>" >> .env.local'
```

O passo que importa é o segundo: a lista nunca passa pelo histórico do git. Para **remover**
alguém, apague a linha da tabela e regenere a variável — o banco é a fonte, e a tabela nunca é
editada por uma requisição da aplicação.

## Server Actions

As actions do quadro (`src/app/actions/vagas.ts`) seguem um contrato único, e a interface decide
o que fazer pelo `code`, não pela mensagem:

```ts
type Retorno = { ok: true; vaga: VagaRow }        // adicionarVaga
             | { ok: true }                        // atualizarStatus
             | { ok: false; code: CodigoErro; mensagem: string };
```

| `code` | Quando | O que a interface faz |
|--------|--------|----------------------|
| `duplicada` | 409 | avisa que a vaga já está no quadro |
| `extracao_falhou` | 422, 413 | oferece o campo de texto colado |
| `limite_uso` | 429 | sugere tentar mais tarde |
| `sessao_expirada` | 401, 403, ausência de sessão | manda para o login |
| `erro` | 5xx, status inesperado, falha de validação | mensagem genérica |

Duas propriedades do contrato valem para toda action:

- **nunca lançam**. Uma action que lança mostra a tela de erro genérica do Next em produção, que
  perde o `digest` e entrega uma página morta em vez de uma mensagem.
- **a mensagem nunca carrega o corpo da resposta** da Edge Function. Aquele corpo é escrito por
  código que este projeto não controla — resposta do LLM, HTML extraído, erro do Postgres — e
  devolvê-lo seria exatamente o vazamento que as invariantes 6 e 8 proíbem. O que a função
  reportou vai só para o log do servidor.

`revalidatePath('/')` roda só no caminho feliz de `adicionarVaga`. `atualizarStatus` não
revalida: o drop é otimista, e revalidar a cada card durante um arrasto causaria uma enxurrada
de re-render.

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha. Nunca versione `.env.local` — o `.gitignore` já cobre.

| Variável | Onde | Segredo |
|----------|------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js | não |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Next.js | não (protegida por RLS) |
| `ALLOWED_EMAILS` | Next.js + Supabase secrets | **sim** |
| `APP_ORIGIN` | Supabase secrets | não |
| `GEMINI_API_KEY` | Supabase secrets | sim |
| `GEMINI_MODEL` | Supabase secrets | não |

## OpenSpec

O projeto é especificado antes de ser implementado. Changes em `openspec/changes/`:

```bash
openspec list
openspec status --change <nome>
openspec validate <nome> --strict
```

Cada change tem proposal (o quê e por quê), specs (comportamento observável, em
`specs/<capability>/spec.md`), design (decisões técnicas) e tasks (passo a passo). Requisitos usam `SHALL` e
cenários Dado/Quando/Então.
