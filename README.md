# Kanban de Vagas

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/kanban-vagas/ci.yml?branch=main)](https://github.com/kanban-vagas/kanban-vagas/actions)
[![Coverage](https://img.shields.io/codecov/c/github/kanban-vagas/kanban-vagas)](https://codecov.io/gh/kanban-vagas/kanban-vagas)

<!-- TODO: add screenshot or animated GIF of the Kanban UI -->

---

## Sumário

- [Visão geral](#vis%C3%A3o-geral)
- [Tecnologias](#tecnologias)
- [Estado atual do projeto](#estado-atual-do-projeto)
- [Arquitetura e estrutura de pastas](#arquitetura-e-estrutura-de-pastas)
- [Como executar localmente](#como-executar-localmente)
- [Testes](#testes)
- [Edge Function `ingest-vaga`](#edge-function-ingest-vaga)
- [Segurança e allowlist](#seguran%C3%A7a-e-allowlist)
- [Contribuindo](#contribuindo)
- [Licença](#licen%C3%A7a)

---

## Visão geral

Kanban pessoal para acompanhar as vagas de emprego às quais me candidatei. Basta colar a URL de um anúncio, o sistema extrai título, empresa e requisitos e coloca a vaga em um quadro. Cada vaga pode avançar pelos estágios:

- `entrevista_1`
- `fase_tecnica`
- `proposta`
- `rejeitado`

O fluxo permite que o candidato tenha uma visão clara do status de cada oportunidade.

---

## Tecnologias

| Camada | Tecnologia |
|--------|------------|
| **Frontend** | Next.js (App Router), React, TypeScript (strict), Tailwind CSS, @dnd-kit |
| **Backend** | Supabase (Postgres + Auth com Google OAuth + Edge Functions em Deno) |
| **Validação** | Zod (schemas compartilhados entre frontend e Edge Functions) |
| **Extração** | Cheerio + Google Gemini |

---

## Estado atual do projeto

| Fase | Módulo | Status |
|------|--------|--------|
| 1 | Domínio + persistência (`vagas`, RLS, `vagaService`) | ✅ Implementado e testado |
| 2 | Edge Function `ingest-vaga` | ✅ Implementado e testado |
| 3 | Auth + Server Actions | ✅ Implementado e testado (faltando ciclo de login real) |
| 4 | Interface Kanban | ⏳ Em desenvolvimento (change criada, UI ainda vazia) |
| – | Scaffold Next.js (`src/app`, env no servidor) | ✅ Implementado e testado |

---

## Arquitetura e estrutura de pastas

```
src/
  app/                # Pages e Server Actions do Next.js
  config/             # Configurações de servidor (Supabase, CSP)
  domain/             # Schemas Zod (VagaCreateInput, VagaRow, StatusVaga)
  services/           # camada de serviço (vagaService, erros)
  auth/               # fluxo de autenticação e allowlist
  middleware.ts       # proteção de rotas
  lib/                # utilitários de Supabase

supabase/
  migrations/         # SQL de criação de tabelas, RLS, triggers
  tests/              # pgTAP tests (RLS, allowlist)

supabase/functions/ingest-vaga/
  _shared/            # pipeline, urlSafety, buscar, parsing, llm, http, supabase
  index.ts            # entrypoint da Edge Function

tests/                # Vitest (domínio, serviços, actions, UI)
```

---

## Como executar localmente

### Pré‑requisitos

- Node.js 22+ 
- Docker (para rodar o Supabase localmente) 
- Supabase CLI (`npx supabase`)

### Subir o banco de desenvolvimento

```bash
npx supabase start          # sobe Postgres, Auth, Storage e Studio
npx supabase status -o env  # exporta API_URL e DB_URL para o .env.local
```

### Instalar dependências e iniciar a aplicação

```bash
cp .env.example .env.local   # preencha as variáveis NEXT_PUBLIC_*
npm install
npm run dev                 # http://localhost:3000
```

O endpoint `/` é apenas um placeholder; a interface do Kanban será disponibilizada na fase 4.

---

## Testes

```bash
# Verificação completa (typecheck + todas as suítes)
npm run verificar

# Apenas typecheck
npm run typecheck

# Vitest (frontend, domínio, services, actions)
npm test

# pgTAP (RLS e allowlist)
npm run test:db

# Deno tests da Edge Function
npm run test:funcao
```

> **Nota:** `npm test` roda apenas Vitest porque não depende de Docker ou Deno. As demais suites requerem o Supabase local em execução.

---

## Edge Function `ingest-vaga`

A função recebe `{ url }` ou `{ url, texto }` (texto ≤ 30 000 caracteres) e executa o pipeline abaixo:

```mermaid
flowchart TD
    A[Recebe request] --> B[Validação de sessão]
    B --> C[Allowlist]
    C --> D[Rate limit]
    D --> E[Validação de URL + DNS]
    E --> F[Fetch (8 s, 1.5 MB, 3 redirects)]
    F --> G[Limpeza do HTML]
    G --> H[Extração ld+json]
    H --> I[Gemini (fallback se necessário)]
    I --> J[Validação Zod]
    J --> K[Insert na tabela `vagas`]
    K --> L[Log de auditoria]
    L --> M[Resposta 201 { vaga }]
```

Respostas possíveis (código HTTP + `code` interno):

- `201` – vaga criada com sucesso
- `401` – sessão expirou
- `403` – origem ou e‑mail não permitido (mapeado para `sessao_expirada` na UI)
- `409` – vaga duplicada
- `422` / `413` – falha de extração (exibe campo de texto colado)
- `429` – limite de ingestão excedido
- `5xx` – erro interno do servidor

---

## Segurança e allowlist

- **Segredos** (`GEMINI_API_KEY`, `GEMINI_MODEL`, `APP_ORIGIN`, `ALLOWED_EMAILS`) nunca ficam em `NEXT_PUBLIC_*` nem são versionados. São configurados via `scripts/configurar-edge-function.sh`.
- **RLS** está habilitado em todas as tabelas; políticas garantem que apenas o usuário autenticado possa ler/escrever as suas vagas.
- **Allowlist de e‑mail** funciona em duas camadas:
  1. tabela `public.allowed_emails` + hook `Before User Created` (bloqueia criação de conta);
  2. variável de ambiente `ALLOWED_EMAILS` usada no callback de login (impede acesso a contas já existentes).
- **Origin**: a Edge Function aceita requisições sem cabeçalho `Origin` (servidor‑para‑servidor). Quando presente, valida‑a contra `APP_ORIGIN`.

---

## Contribuindo

Confira o arquivo **[CONTRIBUTING.md](CONTRIBUTING.md)** para detalhes sobre fluxo de pull‑request, linting, testes e boas práticas de commit.

---

## Licença

Distribuído sob a licença MIT. Veja o arquivo **[LICENSE](LICENSE)** para mais detalhes.
