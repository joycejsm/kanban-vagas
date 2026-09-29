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
| 3 | Auth + Server Actions | ⏳ proposal + specs + design |
| 4 | Interface Kanban | ⏳ change criada, vazia |

## Estrutura

```
src/domain/vaga.ts                    Schemas Zod (VagaCreateInput, VagaRow, StatusVaga)
src/services/vagaService.ts           Acesso às vagas, cliente Supabase por injeção
src/services/vagaService.errors.ts    VagaDuplicadaError, VagaServiceError

supabase/migrations/                  Migrações SQL (tabelas, RLS, triggers)
supabase/tests/vagas_rls.sql          Testes pgTAP de RLS e integridade

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

### Rodar os testes

```bash
npm install
npm run typecheck          # tsc --noEmit
npm test                   # vitest: domínio + serviço (34 testes)
npx supabase test db supabase/tests/vagas_rls.sql   # 26 asserções de RLS no Postgres

# Edge Function (Deno) — a partir da pasta da função, o import map de deno.json é aplicado
deno task --cwd supabase/functions/ingest-vaga check
deno task --cwd supabase/functions/ingest-vaga test    # 34 testes
```

O script de RLS roda dentro de uma transação com `ROLLBACK` no fim — os usuários e vagas de teste não
persistem.

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

Definidas com `supabase secrets set` — nunca no frontend e nunca em `NEXT_PUBLIC_*`:

| Secret | Valor |
|--------|-------|
| `GEMINI_API_KEY` | chave da API do Google Gemini |
| `GEMINI_MODEL` | ex. `gemini-2.5-flash` |
| `ALLOWED_EMAILS` | lista separada por vírgula |
| `APP_ORIGIN` | origem do app, ex. `http://localhost:3000` |

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

- **Secrets**: `supabase secrets set GEMINI_API_KEY GEMINI_MODEL ALLOWED_EMAILS APP_ORIGIN`
  (a tabela acima diz o que cada uma recebe).
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
supabase link                        # uma vez, associa o projeto
supabase db push                     # aplica as migrações
supabase functions deploy ingest-vaga
supabase secrets set GEMINI_API_KEY GEMINI_MODEL ALLOWED_EMAILS APP_ORIGIN
```

O provedor Google OAuth já está configurado no projeto Supabase. Nada disso é feito por código.

## Segurança

Regras que valem para todo o código deste projeto (detalhes em `openspec/project.md`):

- Nenhum segredo em `NEXT_PUBLIC_*`. A service role key **nunca** é usada em fluxo disparado por usuário.
- `user_id` vem sempre do servidor (`auth.uid()`), nunca do input do cliente.
- Sessão validada no servidor com `getUser()` ou `getClaims()`, nunca `getSession()` sozinha.
- Toda entrada externa passa por schema Zod com limites de tamanho.
- Saída do LLM nunca é renderizada como HTML nem usada como URL.
- Só e-mails em `ALLOWED_EMAILS` usam o app.
- Erros ao cliente são genéricos; logs não contêm conteúdo raspado, tokens ou e-mails.
- Toda tabela nasce com RLS habilitado e policies na mesma migração que a cria.

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha. Nunca versione `.env.local` — o `.gitignore` já cobre.

| Variável | Onde | Segredo |
|----------|------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js | não |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Next.js | não (protegida por RLS) |
| `ALLOWED_EMAILS` | Next.js + Supabase secrets | sim |
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
