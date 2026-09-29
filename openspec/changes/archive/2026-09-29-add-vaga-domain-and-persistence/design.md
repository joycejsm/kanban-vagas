# Design

## Context

O projeto Supabase já existe, está vazio (nenhuma tabela) e tem Google OAuth habilitado — mas essa change não
lida com autenticação. Ela precisa entregar, na mesma migração, a tabela de vagas com RLS completo, o modelo de
d	validado compartilhado e o serviço de aplicação. Ver `proposal.md` para a motivação e os specs para o
comportamento observável; aqui ficam apenas as decisões de implementação.

Restrições que pesam nas decisões (de `openspec/project.md`):

- RLS habilitado e policies **na mesma migração** que cria a tabela (invariante 10).
- `user_id` sempre do servidor, nunca do input do cliente (invariante 3).
- Nenhum fluxo de usuário toca a service role key (invariante 2); o RLS precisa valer de verdade.
- Toda entrada externa passa por Zod com limites de tamanho (invariante 5).
- Erros genéricos ao cliente, sem stack trace (invariante 8).

## Goals / Non-Goals

**Goals:**

- Um arquivo de migração autocontido e idempotente no estilo `supabase db push`.
- Isolamento entre contas garantido pelo banco, não pela camada de aplicação.
- Um schema Zod como fonte única de verdade, importável tanto pelo Next.js quanto por Edge Functions em Deno
  (por isso: sem APIs de Node e sem libs server-only no arquivo de domínio).
- Serviço testável sem rede, com o cliente Supabase injetado.

**Non-Goals:**

- UI, Server Actions, rotas de API e drag & drop (fase seguinte).
- Extração de vaga por Cheerio/Gemini e a Edge Function correspondente.
- Login Google, allowlist `ALLOWED_EMAILS` e validação de sessão no servidor — o serviço assume um cliente
  **já** autenticado; quem garante isso é a fase de autenticação.
- Múltiplos usuários por execução: o RLS é desenhado para multiusuário, mas o produto é single-user na prática.

## Decisions

### D1 — `status` e `senioridade` como `text` com CHECK, não enums nativos

A coluna `text` com `CHECK (status IN (...))` espelha 1:1 o enum do Zod.

**Alternativas:** `CREATE TYPE ... AS ENUM` do Postgres (mais compacto, mas exige `ALTER TYPE` em cada valor
novo, o que é uma migração arriscada e fácil de esquecer) e ausência de restrição, com validação só na aplicação
(inaceitável — allowlists de DB são o que garante integridade mesmo com bug ou script avulso).

`senioridade` inclui o valor `'Não informado'`, com acento; como o tipo é `text`, não há problema de encoding,
mas a string precisa ser idêntica em todos os lugares (fonte: o schema Zod).

### D2 — `requisitos` como `text[]`

`text[]` com CHECK de cardinalidade (`cardinality(requisitos) <= 30`) e validação item a item garante os limites
por elemento. `jsonb` exigiria CHECK com expressão mais cara e perderia a tipagem; `text` simples perderia a
estrutura de lista. Array vazio é permitido e representa "sem requisitos informados".

### D3 — `url_normalizada` calculada por trigger `BEFORE INSERT OR UPDATE`

Um trigger normaliza e o cliente **nunca** envia o valor: isso elimina a possibilidade de o cliente forjar
`url_normalizada` para escapar da constraint de unicidade. A mesma trigger normaliza o `status`/`senioridade`?
Não — apenas a URL. O `status`/`senioridade` chegam como given pelo schema Zod e são barrados pelo CHECK.

**Normalização:** `lower(esquema || '://' || host)`, remoção do fragmento, remoção de query inteira se ela
contiver apenas chaves `utm_*`/tracking (mantendo parâmetros que mudam o recurso, como `?id=`), remoção de
parâmetros vazios e remoção da barra final do caminho (preservando a raiz `/`). A tabela `url` guarda a URL
**como o usuário colou** — é ela que será usada como link no Card.

**Alternativa:** normalizar só na aplicação. Descartada — a constraint de unicidade precisa ser confiável
independentemente de quem escreve.

### D4 — Impedir troca de `user_id` revogando UPDATE por coluna

A proteção é: `REVOKE UPDATE ON public.vagas FROM authenticated` seguido de
`GRANT UPDATE (url, titulo, empresa, requisitos, senioridade, status, ordem)`. Assim `user_id` fica fora do
conjunto de colunas graváveis e qualquer `UPDATE` que o cite falha com `42501` (insufficient_privilege).
`url_normalizada` também fica de fora, por ser calculada pela trigger.

**Forma testada e descartada:** `REVOKE UPDATE (user_id) ... FROM authenticated` — **não funciona**. O Supabase
concede `GRANT ALL` na tabela para `authenticated`, e revogar o privilégio de uma coluna não subtrai nada desse
grant de tabela: `has_column_privilege('authenticated', 'public.vagas', 'user_id', 'update')` continuava
retornando `t`. Reproduzido em isolamento antes de adotar esta forma.

**Alternativa descartada:** trigger `BEFORE UPDATE` que lance exceção ao detectar mudança de `user_id`. Também
funciona e é mais explícita, mas exige que todo caminho de escrita passe pela trigger; as revogações são
declaradas pelo dono da tabela e valem para qualquer papel, inclusive se alguém criar uma policy nova depois.
Os dois juntos não são necessários — fica só a revogação, mais simples de auditar com
`has_column_privilege`.

### D5 — `FORCE ROW LEVEL SECURITY`

`FORCE` faz o RLS valer inclusive para o dono da tabela, o que garante que o teste de RLS exercite as policies
reais (o `postgres`/`service_role` no Supabase têm `BYPASSRLS`). O `service_role` continua com bypass — e por
isso ele nunca é usado em fluxo disparado por usuário (invariante 2). `REVOKE ALL ... FROM anon` fecha o resto.

Policies usam `(select auth.uid())` (forma "wrapping" do planner do Postgres, ~1 query por statement em vez de
uma por linha) e `(select auth.uid()) = user_id` como predicado, com `TO authenticated` explícito.

### D6 — Service sem `user_id` e com cliente injetado

`criarVaga` recebe só o payload de usuário; `user_id` é preenchido pelo `DEFAULT auth.uid()` no banco. Nenhuma
operação do serviço tem `user_id` na assinatura — assim o requisito é verificável por inspeção da assinatura,
não por confiança em disciplina de código.

O cliente entra no construtor (injeção), o que permite mock nos testes e garante que o serviço use exatamente o
cliente autenticado da requisição. O serviço não lê `NEXT_PUBLIC_*` nem constrói cliente próprio.

### D7 — Erros de domínio com tradução pontual

`VagaDuplicadaError` é reconhecida por SQLSTATE `23505` **e** pela presença do nome da constraint
`vagas_user_id_url_normalizada_key` no erro, para não confundir com qualquer outra violação de unicidade.
Qualquer outro erro vira um `VagaServiceError` genérico com mensagem pt-BR fixa; o erro original é registrado
em log estruturado com apenas código, constraint e operação — nunca o payload, o token ou o e-mail
(invariantes 8 e 9).

### D8 — Coluna `ordem` numérica simples

`integer not null default 0`, sem unicidade por coluna: reordenar significa gravar a nova sequência de inteiros na
operação de drag & drop (que é bulk, feita na fase de UI). Gaps são tolerados e semantically irrelevantes —
a ordenação é sempre `order by status, ordem, created_at`.

**Alternativa:** `numeric`/`decimal` para permitir inserções entre valores. Descartada — a UI grava a
sequência inteira de uma vez; precisão fracionária só adicionaria complexidade sem benefício agora.

### D9 — `updated_at` por trigger dedicated

Trigger `BEFORE UPDATE` que faz `NEW.updated_at := now()`, separado do trigger de normalização de URL, para que
cada trigger tenha uma responsabilidade só e possa ser lido independentemente.

## Risks / Trade-offs

- **[Coluna `text` com CHECK pode divergir do enum Zod]** → As duas listas são curtas e ficam lado a lado em
  `vaga-domain/spec.md` e na migração; o teste de RLS cobre `status` inválido. Adicionar um valor exige tocar
  nos dois lugares.
- **[A trigger de normalização roda num `BEFORE UPDATE`; `url_normalizada` ficou sem privilégio de UPDATE]**
  → Intencional e correto: a coluna é gerada pelo banco e nunca aceita valor do cliente. O grant por coluna de
  D4 a exclui de propósito.
- **[Normalização de query string é heurística]** → A regra só remove a query inteira quando **todos** os
  parâmetros são da família de tracking; qualquer parâmetro funcional é preservado. Casos ambíguos (links com
  token curto) podem gerar duas entradas — aceitável para uso single-user, e o usuário sempre pode remover a
  vaga duplicada manualmente.
- **[`FORCE ROW LEVEL SECURITY` pode quebrar rotinas administrativas]** → Nenhuma rotina admin depende de
  acesso direto à tabela nesta change; operações administrativas futuras devem usar o `service_role` ou
  `SECURITY DEFINER` explicitamente.
- **`senioridade` com acento em constraint** → Comparação é byte a byte em `text`; risco apenas de divergência
  de digitação entre migration e código, coberto pelo teste de RLS com valor inválido.
- **[Teste de RLS depende de `pgTAP`/`supabase test db`] → O script é escrito de forma a também rodar manualmente
  em um SQL editor com instruções de setup no topo, para não bloquear a validação caso o plugin falte.**

## Migration Plan

1. `supabase link` (apenas uma vez; o projeto já está criado e configurado manualmente).
2. `supabase db push` — aplica `supabase/migrations/<timestamp>_vagas.sql`, arquivo único com tabela, índices,
   triggers, RLS, policies e revogações, na ordem: extensões → tabela → índices → funções/triggers → RLS →
   policies → revogações.
3. `supabase test db supabase/tests/vagas_rls.sql` — valida isolamento e duplicidade.
4. Rollback: `supabase db reset` no ambiente local; em ambiente linkado, como é a primeira migração de um banco
   sem dados, o caminho de volta é `DROP TABLE IF EXISTS public.vagas cascade` seguido de remover a migration.
   Nenhum dado de produção existe para preservar.
5. Nenhuma secret nova é criada por esta change (`GEMINI_API_KEY` e allowlist vêm em fases seguintes).

## Open Questions

- A ordenação do quadro entre `ordem` e `created_at` como desempate fica confirmada na spec; se a UI precisar de
  reordenação otimista com concorrência, `ordem` pode virar `numeric` — mudança que só afeta design/tasks, não
  os cenários de aceite atuais.
