# Proposal

## Why

O projeto já tem o provedor Google configurado no Supabase e, na fase de domínio/persistência, toda a tabela
`public.vagas` protegida por RLS que só responde a requisições com JWT de usuário. Falta a camada que une as
duas pontas: sem ela, não existe login, não existe `/` protegido, e não existe caminho para criar e mover
vagas a partir da aplicação.

Essa camada é justamente onde a segurança do projeto é decidida ou perdida. Sessão validada apenas por cookie
não verificado, redirecionamento aberto (`?next=https://evil.com`), callback que cria sessão para qualquer
conta Google e Server Actions que confiam no input do cliente são falhas clássicas que produzem tanto open
redirect quanto gravação em nome de outro usuário. Esta change implementa a proteção de rotas, o callback
PKCE, a allowlist de e-mails em duas camadas e as Server Actions que traduzem erros da Edge Function
`ingest-vaga` em mensagens em pt-BR.

## What Changes

- **`middleware.ts` com `@supabase/ssr`**: criado/renovado o cookie de sessão em **toda** requisição e sessão
  validada com `getUser()` (nunca apenas `getSession()`); usuário sem sessão em qualquer rota privada é
  redirecionado para `/login`; usuário autenticado em `/login` é redirecionado para `/`. `/login` e
  `/auth/callback` são públicas. `matcher` exclui `_next/static`, `_next/image`, `favicon.ico` e demais
  assets.
- **Rota `/auth/callback`**: troca do parâmetro `code` por sessão via `exchangeCodeForSession` (PKCE). O
  parâmetro `next` só é aceito quando for caminho relativo interno (começa com `/` e não com `//`), caso
  contrário assume `/` — impedindo open redirect. Falha na troca → `/login?erro=auth`.
- **Allowlist de acesso**: e-mail do usuário precisa constar de `ALLOWED_EMAILS`; se não constar, a sessão é
  encerrada imediatamente e o usuário cai em `/login?erro=nao_autorizado`. Como segunda camada, é especificada
  uma função Postgres para o hook **Before User Created** do Supabase Auth que rejeita, na criação da conta, e-
  mails fora da lista. A ativação do hook no painel e a exclusão de outros provedores permanecem como
  pré-requisito manual documentado.
- **Server Action `adicionarVaga(formData)`**: valida a URL com Zod no servidor, resolve o usuário com
  `getUser()`, chama a Edge Function `ingest-vaga` encaminhando a sessão do usuário (sem reimplementar
  scraping), mapeia 409/422/429/401/403/timeout para mensagens amigáveis em pt-BR e executa
  `revalidatePath('/')` no sucesso.
- **Server Action `atualizarStatus({ vagaId, novoStatus, ordem })`**: valida com Zod (`vagaId` UUID, `novoStatus`
  no enum do domínio, `ordem` opcional), persiste via `vagaService` usando o cliente do usuário autenticado e
  devolve erro genérico "Vaga não encontrada" quando nenhuma linha é afetada, sem distinguir id inexistente de
  id de outro usuário.
- **Headers de segurança em `next.config`**: CSP restritiva (`script-src 'self'`, `connect-src` limitado ao
  domínio do Supabase, `img-src` incluindo `lh3.googleusercontent.com`), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin` e `frame-ancestors 'none'`.

## Capabilities

### New Capabilities

- `auth-routing`: proteção de rotas via `middleware.ts` com sessão validada no servidor, matriz de rotas
  públicas e privadas e regra de redirecionamento.
- `auth-callback`: conclusão do login por código PKCE em `/auth/callback`, validação do parâmetro `next` e
  tratamento de falha.
- `access-allowlist`: restrição de acesso por e-mail, aplicada no callback e no hook **Before User Created**
  do Supabase Auth.
- `vaga-server-actions`: Server Actions de criação de vaga (encaminhamento para a Edge Function, mapeamento de
  erros) e de movimentação de status, com validação Zod e revalidação de cache.
- `security-headers`: política de headers de segurança da aplicação (CSP e cabeçalhos de hardening).

### Modified Capabilities

<!-- Nenhuma. As capabilities `vaga-domain`, `vaga-persistence` e `vaga-service` são consumidas, não alteradas;
     a integração aparece em Impact e nas tasks. -->

## Impact

- **Código novo:** `src/middleware.ts`, `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`,
  `src/app/actions/vagas.ts`, `next.config.ts`, migration com a função do hook **Before User Created** e
  testes unitários das Server Actions com o `vagaService` e o cliente Supabase mockados.
- **Dependências:** `@supabase/ssr` e `@supabase/supabase-js` (versões compatíveis com o SDK já usado). Nenhum
  pacote de UI nesta change.
- **Infraestrutura:** apenas pré-requisito manual documentado — ativar o hook no painel de autenticação do
  Supabase e manter apenas o Google como provedor. O provider OAuth **não** é configurado por código.
- **Segredos:** `ALLOWED_EMAILS` e a URL do projeto Supabase vêm de ambiente do servidor; nenhuma
  `NEXT_PUBLIC_*` carrega segredo e nenhuma Server Action usa a service role (invariantes 1, 2, 3, 4, 7).
- **Dependência de phases anteriores:** consome a Edge Function `ingest-vaga`
  (`add-ingest-vaga-edge-function`) e o domínio/persistência (`add-vaga-domain-and-persistence`).
- **Fora de escopo:** componentes visuais do Kanban e da tela de login (Fase 4 — `add-kanban-ui`), alterações
  no provedor Google e sinalização dos jobs de ingestão.
