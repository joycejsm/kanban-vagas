# Project Context

## Purpose

Kanban pessoal (single-user na prática) para acompanhar vagas de emprego às quais me candidatei.

O usuário cadastra uma vaga colando a URL de uma anúncio; o sistema extrai título, empresa, descrição e
campos relevantes, organiza a vaga em um quadro Kanban por status e permite arrastar Cards entre colunas,
registrar notas e acompanhar a evolução da candidatura.

## Tech Stack

- **Frontend:** Next.js (App Router), React, TypeScript strict, Tailwind CSS, @dnd-kit.
- **Backend:** Supabase (Postgres + Auth com Google OAuth + Edge Functions em Deno). Tudo que puder rodar em
  Edge Function roda lá; o Next.js cuida só de middleware, Server Actions e UI.
- **Validação:** Zod, com schemas compartilhados entre frontend e Edge Functions.
- **Extração:** Cheerio (parse de HTML) + Google Gemini (modelo configurável via env `GEMINI_MODEL`).

### Arquitetura em uma frase

Browser → Next.js (App Router, Server Actions) → Supabase (Postgres via PostgREST com RLS) e
Edge Functions (Deno) para extração de vagas, com Google Gemini e Cheerio como dependências de extração.

## Project Conventions

### Idiomas

- Textos de UI e mensagens de erro em português (pt-BR).
- Código e identificadores em inglês, exceto o domínio já definido (`Vaga`, status).

### Requisitos

- Todo requisito usa "SHALL" e tem ao menos um cenário Dado/Quando/Então.

### Code Style

- TypeScript strict: sem `any` implícito, sem `!` sem justificativa, `unknown` na fronteira de dados externos.
- Schemas Zod compartilhados entre frontend e Edge Functions (fonte única de verdade de validação).
- Componentes Next.js em Server Components por padrão; `"use client"` apenas onde há interação/estado
  (Kanban com @dnd-kit, formulários de diálogo).
- Server Actions nunca chamam a service role; usam o cliente com o JWT do usuário.

### Testing Requirements

- Cenários Dado/Quando/Então de cada requisito devem ser cobertos por testes.
- Foco obrigatório em testes de segurança: RLS, validação de `user_id`, allowlist de e-mail, tratamento de
  saída de LLM como texto não confiável e ausência de segredo exposto no bundle do cliente.

### Git Workflow

- Uma mudança = um change do OpenSpec + commits correspondentes.
- Não commitar segredos (`.env`, `.env.local`); `.infisical.json` é versionado, segredos não.

### Documentation

- Pré-requisitos manuais (criar projeto Supabase, habilitar Google OAuth, configurar secrets, `supabase link`)
  são documentados em README/docs, nunca automatizados por código.

## Infrastructure (já existente — não recriar nem reconfigurar via código)

- Projeto Supabase já criado e vazio (nenhuma tabela existente), com Google OAuth habilitado no Auth e
  conectado ao Google Cloud.
- Os proposals cobrem apenas: migrações SQL, Edge Functions, código Next.js e a documentação de
  pré-requisitos manuais.
- Deploy via Supabase CLI:
  - `supabase link`
  - `supabase db push`
  - `supabase functions deploy`
  - `supabase secrets set`

## Invariantes de segurança (todo proposal deve respeitá-las)

1. Nenhum segredo (`GEMINI_API_KEY`, service role) no frontend ou em variável `NEXT_PUBLIC_*`. Segredos ficam em
   Supabase secrets.
2. A service role key **NUNCA** é usada em fluxos disparados por usuário. Acesso a dados usa o cliente com o
   JWT do usuário, para o RLS sempre se aplicar.
3. `user_id` vem sempre do servidor (`auth.uid()` / sessão validada), nunca do input do cliente.
4. Na validação de sessão no servidor use `getUser()` ou `getClaims()`, nunca `getSession()` sozinho.
5. Toda entrada externa (body, URL, HTML raspado, saída do LLM) é não confiável e passa por schema Zod com
   limites de tamanho.
6. Saída de LLM nunca é renderizada como HTML nem usada como `href`/URL; a URL da vaga é sempre a informada
   pelo usuário.
7. Só e-mails em allowlist (`ALLOWED_EMAILS`) podem usar o app.
8. Erros retornados ao cliente são genéricos e não vazam stack traces nem detalhes internos.
9. Logs não contêm conteúdo raspado, tokens nem e-mails.
10. Toda tabela nasce com RLS habilitado e policies na mesma migração que a cria.

## Domain Context

### Conceitos

- **Vaga:** anúncio de emprego rastreado pelo usuário, com origem em uma URL informada manualmente.
- **Status:** coluna do Kanban que indica o estágio da candidatura (ex.: "Interessado", "Candidatado-se",
  "Entrevista", "Proposta", "Descartado", "Arquivado").
- **Card:** representação visual de uma Vaga dentro de uma coluna do status.

### Estados / ciclo de vida

A Vaga nasce a partir de uma URL colada pelo usuário. A extração (Edge Function: Cheerio + Gemini) preenche
título, empresa, descrição, localização, remote, salário e skills; o usuário revisa e corrige antes de
salvar. Depois disso a Vaga só muda de status (drag & drop) ou de conteúdo (edição manual).

### Termos em inglês usados no código

`job`, `application`, `status`, `column`, `card`, `notes`, `extraction`, `board`.
