# Proposal

## Why

O projeto tem duas fases implementadas e testadas — domínio/persistência e a Edge Function `ingest-vaga` — mas
**não existe aplicação Next.js**. Não há `next`, `react` ou `@supabase/ssr` em `package.json`, nem `src/app/`,
nem `next.config`, nem `middleware.ts`. As fases 3 (auth + Server Actions) e 4 (Kanban com drag & drop) partem
de um app que precisa existir antes.

Não é um detalhe de empacotamento: é o que faz o D9 da Fase 3 (CSP com `script-src 'self'` e sem
`unsafe-inline`) ser decidido no lugar errado. Se o app nascer com a configuração padrão, a Fase 3 começa
corrigindo o scaffold em vez de implementar o que lhe cabe, e a política de segurança vira um remendo em vez
de uma decisão. A mesma coisa vale para o alias `@/*`: `tsconfig` e `vitest.config` já o definem apontando para
`./src`, e um scaffold que escolha outro layout quebra os testes das fases anteriores sem aviso.

## What Changes

- **Aplicação Next.js com App Router** em `src/app`, com TypeScript strict preservando
  `noUncheckedIndexedAccess` e `noImplicitOverride` já presentes no `tsconfig.json` do projeto.
- **Tailwind CSS** configurado, conforme a stack declarada em `openspec/project.md`.
- **Dependências de runtime** `next`, `react` e `react-dom` adicionadas, mais Tailwind CSS conforme a stack
  declarada em `openspec/project.md`. `@supabase/ssr` e `@dnd-kit` **não** são adicionadas aqui: nenhuma delas
  é importada por código do scaffold, e cada change adiciona a sua no momento em que passa a usá-la.
- **Validação de ambiente com Zod**, reaproveitando a dependência e a convenção já existentes no projeto: a
  configuração do Supabase é entrada externa e passa pelo mesmo schema que o resto do projeto.
- **Alias `@/*` compartilhado** entre TypeScript, Next e vitest, resolvendo para `./src`, sem alterar o que já
  funciona em `tests/` e em `src/domain` e `src/services`.
- **Rota raiz `/` que renderiza** — um Server Component mínimo, sem UI de produto. A interface do Kanban é da
  Fase 4; aqui basta a página existir, compilar e ser servida.
- **Leitura de ambiente no servidor**: o app lê `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` e
  falha com erro explícito em desenvolvimento quando ausentes, sem expô-las em outro lugar nem criar variável
  `NEXT_PUBLIC_*` nova. Nenhuma service role key é criada.
- **`.env.example` coerente** com o que o app realmente lê, mantendo a regra de que segredos não aparecem ali.
- **Verificação de integração**: `npm run typecheck` e `npm test` continuam passando sem alteração de
  resultado, e o build de produção conclui sem erro.

**Fora de escopo, deliberadamente:** a Content Security Policy e os cabeçalhos de hardening. Já estão
especificados na change `add-nextjs-auth-and-server-actions` (capability `security-headers`, decisão D9) e
implementá-los aqui roubaria o escopo da Fase 3 e criaria dois lugares definindo a mesma política. O
`next.config` nasce existindo e configurável, sem a política — a Fase 3 a acrescenta.

## Capabilities

### New Capabilities
- `app-scaffold`: a base executável da aplicação Next.js — build, typecheck, layout de `src/app`, alias
  compartilhado, leitura de ambiente no servidor e ausência de segredo exposto ao cliente. Define o contrato
  observável sobre o qual a Fase 3 (auth) e a Fase 4 (Kanban) se apoiam.

### Modified Capabilities

Nenhuma. As capabilities existentes (`vaga-domain`, `vaga-persistence`, `vaga-service`, `ingest-vaga`,
`url-safety`, `vaga-extraction`, `ingest-audit`) descrevem comportamento que o scaffold não altera: os
schemas Zod, o RLS, o contrato HTTP da Edge Function e as regras anti-SSRF permanecem idênticos.

## Impact

- **Código novo:** `src/app/` (layout, página e arquivos de configuração do App Router), `next.config.*`,
  configuração do Tailwind e o arquivo de ambiente do servidor.
- **Dependências:** `next`, `react`, `react-dom` em produção; Tailwind e os tipos correspondentes em
  desenvolvimento. `package.json` e o lockfile mudam. `@supabase/ssr` e `@dnd-kit` ficam de fora —ver
  design.md—.
- **Arquivos existentes preservados:** `src/domain/` e `src/services/` **não** são sobrescritos. O método de
  criação do app é uma decisão de design porque `create-next-app` recusa diretórios não vazios e a coexistência
  com o código da Fase 1 precisa ser verificada, não presumida.
- **Fora do repositório:** nada. Nenhuma infraestrutura, nenhum segredo, nenhum pré-requisito manual novo.
- **Invariantes:** respeitadas as invariantes 1 e 3 de `openspec/project.md` — nenhum segredo em
  `NEXT_PUBLIC_*` além da chave anon já protegida por RLS, e nenhum `user_id` de cliente. O scaffold, por
  ser a foundation, não introduz nenhuma delas.
