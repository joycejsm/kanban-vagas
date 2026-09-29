# Tasks

## 1. Scaffold do projeto

- [x] 1.1 Criar `package.json` com TypeScript strict, `zod`, `@supabase/supabase-js`, script de typecheck (`tsc --noEmit`) e runner de testes; verificar com `npm install` concluindo sem erro
- [x] 1.2 Criar `tsconfig.json` com `strict: true`, `moduleResolution: bundler` e path alias `@/*` → `src/*`; verificar com `npx tsc --noEmit` rodando sem erro em projeto vazio
- [x] 1.3 Criar `supabase/config.toml` mínimo com o schema `public` exposto e `pgTAP` habilitado para `supabase test db`; verificar com `supabase start` reconhecendo o arquivo
- [x] 1.4 Criar `.env.example` documentando `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e a nota de que nenhuma service role key é usada em fluxo de usuário; verificar que nenhum valor real está no arquivo

## 2. Domínio — `src/domain/vaga.ts`

- [x] 2.1 Definir `statusVagaSchema` (enum `aplicado`, `entrevista_1`, `fase_tecnica`, `proposta`, `rejeitado`) e `senioridadeSchema` (`Junior`, `Pleno`, `Senior`, `Não informado` com default), exportando os tipos com `z.infer`; verificar com teste cobrindo aceitação dos 5 status, rejeição de `arquivado` e default de `senioridade`
- [x] 2.2 Definir `vagaCreateInputSchema` estrito (`url` https ≤2048, `titulo` e `empresa` 1–200, `requisitos` array ≤30 itens de 1–300, `senioridade` com default) sem `id`/`user_id`/`status`/`ordem`; verificar com teste rejeitando chave extra, URL `http://`, URL de 2049 chars, título vazio, empresa de 201 chars, 31 requisitos, item de 301 chars e `senioridade: 'Estágio'`
- [x] 2.3 Definir `vagaRowSchema` (id/user_id uuid, url, url_normalizada, titulo, empresa, requisitos, senioridade, status, ordem, created_at, updated_at) e exportar `VagaRow`, `VagaCreateInput`, `StatusVaga` e `Senioridade`; verificar com teste validando uma linha completa e rejeitando status inválido e `requisitos` nulo
- [x] 2.4 Cobrir os limites de tamanho com testes unitários e verificar que todos passam

## 3. Migração — `supabase/migrations/<timestamp>_vagas.sql`

- [x] 3.1 Criar `public.vagas` com `id uuid primary key default gen_random_uuid()`, `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade`, `url`, `url_normalizada`, `titulo`, `empresa`, `requisitos text[]`, `senioridade`, `status`, `ordem integer not null default 0`, `created_at` e `updated_at`; verificar com `supabase db push` aplicando sem erro
- [x] 3.2 Adicionar CHECK constraints espelhando os enums Zod em `status` e `senioridade`, mais tamanho de `url` (≤2048), `titulo`/`empresa` (1–200) e `requisitos` (≤30 itens, cada um 1–300); verificar com teste inserindo `status` inválido, 31 requisitos e item de 301 chars e confirmando rejeição
- [x] 3.3 Criar função `normalizar_url_vaga(text) returns text` (host minúsculo, sem fragmento, sem query quando só houver parâmetros de tracking, sem parâmetros vazios, sem barra final preservando `/`) e a trigger `BEFORE INSERT OR UPDATE` que preenche `url_normalizada`; verificar com `supabase db push` e consulta comparando `https://x.com/job/1?utm_source=a` com `https://x.com/job/1`
- [x] 3.4 Adicionar `UNIQUE (user_id, url_normalizada)`, índice `(user_id, status, ordem)` e trigger `BEFORE UPDATE` de `updated_at`; verificar consultando `pg_indexes` para as duas entradas esperadas
- [x] 3.5 Habilitar `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, criar as policies `TO authenticated` de SELECT/INSERT/UPDATE/DELETE com `(select auth.uid()) = user_id` e `WITH CHECK` em INSERT e UPDATE, aplicar `REVOKE ALL ON public.vagas FROM anon` e `REVOKE UPDATE (user_id) ON public.vagas FROM authenticated`; verificar com `pg_policies` listando 4 policies e com `has_table_privilege` confirmando a revogação

## 4. Testes de RLS — `supabase/tests/vagas_rls.sql`

- [x] 4.1 Escrever setup do script com `begin`/`rollback`, limpeza das tabelas de teste, criação de dois usuários em `auth.users` e criação de uma vaga para cada via `set role authenticated` + `set request.jwt.claims`; verificar que o script roda até o primeiro `plan`
- [x] 4.2 Cobrir isolamento de leitura (A só vê A), `INSERT` com `user_id` de B rejeitado, `UPDATE` de `user_id` rejeitado, `UPDATE` e `DELETE` de vaga alheia afetando 0 linhas; verificar com `supabase test db supabase/tests/vagas_rls.sql` passando
- [x] 4.3 Cobrir negação para o papel `anon` em SELECT/INSERT/UPDATE/DELETE e o caso de duplicidade por normalização (`https://x.com/job/1?utm_source=a` vs `https://x.com/job/1` falhando com 23505); verificar com o mesmo comando passando

## 5. Serviço — `src/services/vagaService.ts`

- [x] 5.1 Implementar o construtor recebendo o cliente Supabase por injeção e `listarVagas()` retornando as vagas do usuário autenticado ordenadas por `status` e `ordem`, validadas com `vagaRowSchema`; verificar com teste usando cliente mockado
- [x] 5.2 Implementar `criarVaga(input)` validando com `vagaCreateInputSchema`, inserindo sem enviar `user_id` e retornando a linha validada; verificar com teste garantindo que o payload enviado ao banco não contém `user_id` e que entrada inválida não gera requisição
- [x] 5.3 Implementar `atualizarStatus(id, status, ordem?)` e `removerVaga(id)`, ambos sem `user_id` na assinatura e retornando indicação explícita quando nenhuma linha é afetada; verificar com testes de mock para linha afetada e para zero linhas
- [x] 5.4 Traduzir erro `23505` da constraint `vagas_user_id_url_normalizada_key` para `VagaDuplicadaError` e qualquer outro erro para `VagaServiceError` com mensagem pt-BR genérica, logando apenas código, constraint e operação; verificar com testes cobrindo os dois casos e com o teste de log garantindo ausência de conteúdo do usuário

## 6. Verificação de integração

- [x] 6.1 Rodar `npm run typecheck` e a suíte de testes e confirmar que tudo passa; registrar a saída
- [x] 6.2 Adicionar ao README a seção de deploy manual (`supabase link`, `supabase db push`, `supabase functions deploy`, `supabase secrets set`) e os pré-requisitos de teste local (`supabase start`, `supabase test db`); verificar que os comandos citados constam na documentação
