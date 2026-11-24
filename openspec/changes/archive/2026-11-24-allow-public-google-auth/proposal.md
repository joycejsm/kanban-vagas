# Proposal

## Why

O projeto Kanban de Vagas foi concebido inicialmente para uso pessoal estrito, com verificação de allowlist de e-mails em três camadas: Hook no Supabase Auth (`Before User Created`), callback no Next.js (`ALLOWED_EMAILS`) e verificação na Edge Function de ingestão (`ingest-vaga`).

Para disponibilizar a aplicação publicamente como projeto de portfólio, é necessário permitir que qualquer usuário com uma conta Google consiga se autenticar e experimentar a aplicação. A arquitetura de banco de dados e backend já é multi-tenant e segura por padrão:
- O PostgreSQL isola os dados de cada usuário estritamente através de Row Level Security (RLS) baseado em `auth.uid() = user_id` tanto para `vagas` quanto para `ingest_log`.
- A Edge Function `ingest-vaga` possui rate limiting de 20 requisições/hora e 100/dia registrado e contabilizado por `auth.uid()`, impedindo abuso individual de custos de LLM.

Permitir o caractere curinga `*` na variável `ALLOWED_EMAILS` possibilita abrir o acesso público de forma explícita, controlada e reversível, sem necessidade de eliminar a lógica de controle de acesso ou quebrar a conformidade arquitetural existente.

## What Changes

- **Suporte a curinga no Next.js (`src/auth/allowlist.ts`):** A função pura `emailAutorizado` passa a aceitar qualquer usuário autenticado com e-mail válido quando a lista de e-mails autorizados contiver o caractere `'*'`.
- **Suporte a curinga na Edge Function (`supabase/functions/ingest-vaga/_shared/pipeline.ts`):** A etapa de validação `etapaAllowlist` passa a aprovar qualquer requisição autenticada quando `config.allowedEmails` contiver `'*'`.
- **Preservação de segurança e isolamento:** A ausência de e-mail (usuário anônimo/sem e-mail) continua sendo rejeitada; a variável `ALLOWED_EMAILS` continua obrigatória (evitando liberação acidental por omissão); RLS e rate limits permanecem inalterados e plenamente ativos.
- **Testes automatizados:** Novos testes unitários no Next.js (Vitest) e na Edge Function (Deno) validando a autorização de e-mails arbitrários sob `ALLOWED_EMAILS=*`.

## Capabilities

### Modified Capabilities
- `access-allowlist`: O requisito de autorização por allowlist passa a prever o curinga `*` para autorizar qualquer e-mail autenticado com sessão válida.
- `ingest-vaga`: A etapa de validação de allowlist da Edge Function passa a aceitar qualquer usuário autenticado quando `ALLOWED_EMAILS` contiver `*`.

## Impact

- **Código Next.js:** Pequena alteração em `src/auth/allowlist.ts` e novos testes em `tests/auth/allowlist.test.ts` e `tests/auth/concluirLogin.test.ts`.
- **Código Edge Function:** Pequena alteração em `supabase/functions/ingest-vaga/_shared/pipeline.ts` e novos testes em `pipeline.test.ts`.
- **Infraestrutura / Secrets:** Em produção, basta atualizar a secret `ALLOWED_EMAILS` para `*` no Supabase e na Vercel. Nenhuma alteração de schema ou migração SQL é necessária.
