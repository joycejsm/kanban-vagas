# Proposal

## Why

Hoje não existe caminho para transformar um link de anúncio em uma vaga no quadro: o usuário teria que abrir
cada site e digitar título, empresa e requisitos à mão. A extração automatizada precisa nascer **dentro** do
mesmo processo que já define o domínio e a persistência (`add-vaga-domain-and-persistence`), porque a Edge
Function é o componente que vai escrever em `public.vagas` — e é exatamente aí que erros de segurança têm
consequência real: buscar uma URL arbitrária fornecida pelo usuário é uma superfície SSRF clássica, e alimentar
HTML externo em um LLM é uma superfície de prompt injection.

Esta change implementa a Edge Function `ingest-vaga` (Deno): recebe a URL, extrai os dados, valida com os
schemas Zod já definidos na fase de domínio e insere a vaga com o JWT do próprio usuário. O pipeline é
estritamente sequencial e aborta na primeira falha, e cada etapa tem resposta HTTP e motivo de recusa
definidos.

## What Changes

- **Nova Edge Function `ingest-vaga`** (`supabase/functions/ingest-vaga/index.ts`) com contrato
  `POST { url }` e fallback opcional `{ url, texto }` (`texto` ≤ 30.000 caracteres, colado pelo usuário para
  pular o scraping). Schema Zod estrito rejeitando campos extras. Resposta `201 { vaga: VagaRow }` ou erro
  `{ code, message }` genérico em pt-BR.
- **CORS restrito**: só a origem de `APP_ORIGIN` é aceita, com resposta ao preflight `OPTIONS`.
- **Autenticação dupla**: `verify_jwt` do Supabase e, dentro da função, validação do usuário com
  `supabase.auth.getUser(jwt)`; e-mail precisa estar em `ALLOWED_EMAILS` (401 / 403).
- **Rate limit por usuário**: 20 ingestões/hora e 100/dia, registrado em nova tabela `ingest_log` criada com
  RLS habilitado na mesma migração.
- **Validação anti-SSRF da URL**: https obrigatório, sem credenciais, porta vazia ou 443, ≤ 2048 caracteres,
  rejeição de IP literal, `localhost`, `.local` e `.internal`; resolução DNS (A e AAAA) com rejeição de
  qualquer endereço em faixa não pública; `fetch` com `redirect: 'manual'`, no máximo 3 saltos, revalidando
  cada destino.
- **Fetch limitado**: timeout de 8 s, apenas `content-type: text/html`, stream abortado acima de 1,5 MB,
  User-Agent identificável.
- **Parsing com Cheerio**: remoção de `script`, `style`, `noscript`, `iframe`, comentários e elementos
  ocultos; tentativa de `application/ld+json` (`@type: JobPosting`) antes do LLM; senão texto visível
  normalizado e truncado em 12.000 caracteres.
- **Extração via Gemini**: `system_instruction` fixa, conteúdo raspado apenas na mensagem do usuário e
  envolvido em `<conteudo_vaga_{nonce}>` com nonce aleatório por requisição, saída estruturada com
  `responseMimeType: application/json` + `responseSchema`, temperatura baixa, `maxOutputTokens` limitado, sem
  tools. O LLM devolve apenas `titulo`, `empresa`, `requisitos`, `senioridade` — **nunca** a URL.
- **Validação da saída com `VagaCreateInput.safeParse`**, combinando com os campos do usuário; falha → 422
  genérico sem repassar a saída bruta.
- **Persistência** com cliente Supabase criado a partir do JWT do usuário (nunca service role), `status`
  `'aplicado'`, `ordem` no fim da coluna; violação de unicidade (`23505`) → 409 "Você já cadastrou esta vaga".
- **Logging restrito**: host da URL, duração, etapa que falhou e user id truncado. Sem conteúdo raspado, token
  ou e-mail.
- **Nova migração** criando `ingest_log` com RLS habilitado e policies na mesma migração (invariante 10).

## Capabilities

### New Capabilities

- `ingest-vaga`: contrato HTTP da Edge Function de ingestão — validação de entrada, CORS, autenticação e
  allowlist, rate limit, resposta de sucesso e erros.
- `url-safety`: regras de validação anti-SSRF aplicadas à URL antes e a cada redirect do fetch.
- `vaga-extraction`: extração dos dados da vaga a partir do HTML — parsing com Cheerio, caminho
  `ld+json` sem LLM e extração via Gemini com isolamento de prompt injection e saída estruturada.
- `ingest-audit`: tabela de auditoria das ingestões com RLS, usada para aplicar os limites de uso por
  usuário.

### Modified Capabilities

- `vaga-persistence`: a tabela `public.vagas` passa a ser escrita também pela Edge Function, o que fixa que a
  escrita ocorre com o JWT do usuário (RLS ativo), com `status` `'aplicado'` e `ordem` no fim da coluna, e que
  `23505` é traduzido em erro de duplicidade. A tabela `ingest_log` é adicionada com o mesmo padrão de RLS.
- `vaga-domain`: `VagaCreateInput` passa a ser também o contrato de **saída** do LLM (validado com
  `safeParse`), e a fonte da URL persistida passa a ser a URL informada/validada pelo usuário, nunca a
  devolvida pelo modelo.

## Impact

- **Código novo:** `supabase/functions/ingest-vaga/index.ts` e módulos auxiliares dentro de
  `supabase/functions/ingest-vaga/_shared/` (validação de URL, SSRF, parsing, LLM, rate limit).
- **Banco:** nova migração em `supabase/migrations/` criando `ingest_log` com RLS e policies. Depende da
  change `add-vaga-domain-and-persistence` (tabela `public.vagas`, schema Zod e `VagaDuplicadaError`).
- **Deploy:** `supabase functions deploy ingest-vaga` e `supabase secrets set GEMINI_API_KEY GEMINI_MODEL
  ALLOWED_EMAILS APP_ORIGIN` — pré-requisitos manuais, já documentados fora de código.
- **Segredos:** `GEMINI_API_KEY`, `GEMINI_MODEL`, `ALLOWED_EMAILS` e `APP_ORIGIN` são lidos via
  `Deno.env` dentro da Edge Function; nenhum valor `NEXT_PUBLIC_*` é criado (invariantes 1, 3, 4, 6, 7, 9).
- **Riscos:** SSRF por DNS rebinding é risco residual documentado em `design.md`; prompt injection é tratada
  como não resolvível por completo e reduzida por nonce, `responseSchema` e validação Zod.
- **Fora de escopo:** renderização de páginas com JS (headless browser), scraping de sites que exigem login,
  interface do Kanban e drag & drop.
