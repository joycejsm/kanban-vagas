# Design

## Context

Esta change é a cola entre o Supabase (que já tem o provider Google configurado) e o app Next.js. Ela consome
duas changes anteriores: `add-vaga-domain-and-persistence` (schema Zod + tabela `public.vagas` com RLS +
`vagaService`) e `add-ingest-vaga-edge-function` (Edge Function que grava a vaga).

Ver `proposal.md` para o porquê e os specs para o comportamento observável. Aqui ficam só as decisões de
implementação, guided pelas invariantes de segurança do `project.md` — em especial: sessão validada com
`getUser()` (invariante 4), `user_id` sempre do servidor (3), nada de segredo em `NEXT_PUBLIC_*` (1) e nada de
service role em fluxo de usuário (2).

## Goals / Non-Goals

**Goals:**

- Um único lugar decide "o usuário está autenticado": o middleware, validando no servidor.
- Toda escrita passa pelo RLS real, porque o cliente usado nas Server Actions é o do usuário.
- Erros do backend traduzidos uma única vez, em pt-BR, num contrato estável para a UI.
- Open redirect impossível por construção, não por sanitização pontual.

**Non-Goals:**

- Configuração do provedor OAuth no Supabase (já feito, manual).
- Tipagem discriminated union de retorno: os testes ficam mais simples (e os snapshots mais estáveis) com
  `{ ok: true, ... }` / `{ ok: false, code, message }`.
- Refresh token / rotação de sessão além do que o `@supabase/ssr` já faz.
- Qualquer componente visual (é a change `add-kanban-ui`).

## Decisions

### D1 — Middleware protege por allowlist de rotas públicas, não por blocklist de privadas

O `matcher` cobre tudo exceto assets; dentro dele, uma constante `ROTAS_PUBLICAS = ['/login', '/auth/callback']`
define onde não há exigência de sessão. A regra é "tudo é privado salvo o que for explicitamente público".

**Alternativas:** proteger só a raiz com `matcher: ['/']`. Descartada — é exatamente o bug que o requisito
pede para evitar: uma rota nova nasce desprotegida por padrão. **Alternativa 2:** bloquear no layout/page com
`redirect()`. Descartada — roda depois do streaming e deixa o HTML vazar antes do redirect; o middleware é o
único ponto que roda antes de qualquer byte de resposta. Custo aceito: o middleware executa em cada navegação de
página, o que exige `getUser()` enxuto e edge runtime.

### D2 — Sessão validada com `getUser()`, com `getClaims()` como optimisation opcional

`createServerClient` + `auth.getUser()` é o caminho seguro (o JWT é conferido com o serviço de Auth). O cache de
sessão do Next.js é ativado (`getAll`/`setAll` no cookie adapter) para não repetir a chamada.

**Alternativa:** `getSession()` sozinha. Descartada pela invariante 4 — o cookie é assinado, mas o conteúdo não
é validado contra o servidor; um cookie forjado passaria. `getClaims()` (verificação local da assinatura) é
mais barato e também confiável; fica como otimização documentada em design, mas o default do código é
`getUser()` porque é o que a invariante nomeia.

### D3 — `next` validado por allowlist de forma positiva, não por blocklist

Função `sanearNext(valor: string | null): string` — retorna `valor` apenas se casar `^/(?!/)` e não contiver
`\`, `\r`, `\n`, nem o prefixo `//`; caso contrário `/`. Como o valor só pode começar com `/` e nunca com `//`,
não há como produzir uma URL absoluta ou trocar de esquema.

**Alternativas:** `new URL(valor, origin)` e comparar `url.origin === origin`. Funciona, mas é mais código e
depende de `origin` estar corretamente configurado; a regex é testável sem contexto. **Alternativa 2:** ignorar
`next` por completo (sempre `/`). Descartada — quebraria o retorno para deep link; o requisito pede suporte com
restrição.

### D4 — Allowlist em duas camadas: callback + hook Before User Created

A verificação no callback é a experiência imediata do usuário (encerra a sessão e manda para `/login?erro=nao_autorizado`). O hook
`before_user_created` do Auth é a barreira que age antes da conta existir.

**Por que as duas:** o hook é great único ponto de falha (é desativável no painel e não pode ser aplicado
retroativamente a contas já criadas), e a verificação no callback é great Conversely, é o único ponto que cobre
contas criadas antes do hook ou quando ele está desligado. Nenhuma das duas é suficiente sozinha.

**Privilege do hook:** `security definer` com `search_path` fixado (`auth`, `public`) e `set search_path`
explícito, retornando erro genérico.

**Fonte da lista no banco (D11, fechada antes da implementação):** tabela `public.allowed_emails`, com e-mail
normalizado (`lower(trim(...))`) como chave primária, RLS habilitado e **nenhuma policy** — ou seja, `anon` e
`authenticated` não leem nada diretamente, e a leitura acontece só dentro da função `security definer` do hook,
que roda com o privilégio do dono da tabela. Isso é mais restritivo que "RLS de leitura só para o dono" e evita
abrir uma policy que não serve a nenhum fluxo do app: ninguém lê a lista pela aplicação, e a administração da
tabela (inserir/remover e-mail) é feita por job explícito com service role, nunca por requisição de usuário
(invariante 2).

**As duas listas e a divergência.** A tabela é a fonte de verdade do hook; `ALLOWED_EMAILS` no servidor Next é
o espelho usado pela camada do callback. As duas são mantidas pelo mesmo dono e precisam ficar em sincronia —
mas, se divergirem, o comportamento é determinístico e conservador: e-mail que está na tabela e não no
`ALLOWED_EMAILS` é barrado no callback (a lista do banco **nunca** amplia o acesso), enquanto e-mail que está no
`ALLOWED_EMAILS` e não na tabela só passa a valer para contas que já existem, porque o hook não roda
retroativamente. A lista que decide o acesso de hoje é a do servidor Next.

**Normalização do e-mail:** comparação case-insensitive e com `trim`. E-mail é case-insensitive na prática em
Google; sem `lower()`, um e-mail autorizado em maiúsculas seria barrado por erro do usuário. O risco oposto
(aumentar a surface de autorização) é desprezível porque a lista é do próprio dono.

### D5 — Server Actions retornam `{ ok, ... }`, não lançam

Server Actions que lançam exibem tela de erro genérica do Next em produção e lostam o `digest`. O contrato é
discriminado por `ok`: `{ ok: true, vaga }` ou `{ ok: false, code, message }` com `code` ∈ `duplicada` |
`extracao_falhou` | `limite_uso` | `sessao_expirada` | `erro`. A UI mapeia `code` → comportamento (exibir campo
de fallback em `extracao_falhou`). O mapeamento HTTP → `code` mora em **uma** função
`mapearErroIngestao(status, corpo)` testada isoladamente, para que 409/422/429/401/403 não apareçam espalhados
pelas actions.

### D6 — `adicionarVaga` não scrapeia; apenas encaminha

A action valida a URL com Zod, chama a Edge Function via `createClient(url, { global: { headers: {
Authorization } } })` repassando o token do usuário, e mapeia a resposta. Nenhum `cheerio`, nenhum `gemini`
no Next.js.

**Por quê:** duplicar o pipeline criaria duas políticas de SSRF e duas formas de normalizar URL, e o Next.js não
tem o timeout/stream-limit da Edge Function. Além disso, `GEMINI_API_KEY` jamais entra no bundle do servidor do
Next por esse caminho.

### D7 — `atualizarStatus` distingue "não autenticado" de "não encontrado", mas nunca "não é seu"

`getUser()` primeiro (401/sessão expirada). Depois a escrita via `vagaService`, que usa o cliente do usuário: se o
RLS não casa, zero linhas são afetadas. Zero linhas → "Vaga não encontrada", indistinguível de id inexistente.
**Por que não retornar 404 detalhado:** confirmar a existência de um id alheio é um oráculo de enumeração; o
usuário legítimo não ganha nada com a diferença.

### D8 — `revalidatePath('/')` só no caminho feliz

Sucesso de `adicionarVaga` revalida `/`. `atualizarStatus` **não** revalida: o drop é otimista e a reordenação de
`ordem` pode afetar várias linhas; revalidar a cada card durante um drag burst causaria uma enxurrada de re-render. A UI
atualiza localmente e o próximo carregamento natural já reflete o estado do banco.

### D9 — CSP com nonce por resposta, sem `unsafe-inline` e sem `unsafe-eval`

A política é estática exceto pelo nonce, que é gerado por requisição. `script-src` é `'self' 'nonce-<valor>'`;
`connect-src` lista a origem do Supabase (de env, nunca hardcoded) e os endpoints do Google para o OAuth;
`img-src` traz `'self'`, `data:` e `lh3.googleusercontent.com`; `object-src 'none'`, `base-uri 'self'`,
`frame-ancestors 'none'` e `form-action 'self'`.

**Correção (esta decisão estava errada quando foi escrita).** A primeira versão dizia `script-src 'self'` e
afirmava que isso era "compatível com o build padrão do Next". Não é. O App Router sempre emite script inline
— `(self.__next_f=…).push([0])` e o *flight payload* do RSC — e `script-src 'self'` sem `'unsafe-inline'`, hash
ou nonce os bloqueia. O resultado observado foi a página sem nenhum JavaScript e o runtime do Next sem subir
(`InvariantError: Expected a request ID to be defined for the document via self.__next_r`), em dev **e** em
produção. Hash estático não é saída: o *flight payload* muda a cada requisição, então não existe um conjunto fixo
de hashes para listar. `'unsafe-inline'` resolveria, mas viola a diretiva e o spec `security-headers`.

**Onde a CSP mora, e por que.** No `src/middleware.ts`, e não no `headers()` do `next.config.ts`. O Next só
aplica o atributo `nonce` nos scripts dele quando encontra o valor no cabeçalho CSP da **requisição**
(`headers['content-security-policy']` em `app-render.js`), e só o middleware vê os dois lados. Se os dois lugares
emitissem `Content-Security-Policy`, o navegador aplicaria a interseção dos dois cabeçalhos — a mais restritiva,
que é a que não tem nonce — e a página quebraria de novo. Os três cabeçalhos de hardening, que são estáticos,
continuam no `next.config.ts` para valerem também no que o matcher não cobre.

**Nonce por requisição, nunca reutilizado.** Reusar o valor entre respostas o deixa de ser nonce: quem lesse um
documento poderia reutilizá-lo num script injetado depois. Por isso `gerarNonce()` é chamado a cada requisição e
`montarCsp` exige o nonce como parâmetro — torná-lo opcional recriaria o bug na primeira chamada que o esquecesse,
com um modo de falha (página silenciosamente sem JS) dos mais difíceis de diagnosticar.

**O escopo do matcher (D1) não atrapalha.** O nonce só importa para documentos, e todo documento passa pelo
matcher; os assets que ele exclui (`_next/static`, imagens, favicon) não recebem CSP nenhuma, o que é o correto.

### D10 — Testes de Server Actions com dependências injetadas

`adicionarVaga` e `atualizarStatus` recebem, por módulo de dependências testável, o `criarClienteSupabase` e o
`criarVagaService` do usuário. Isso permite testar o mapeamento 409/422/429 e a rejeição de `novoStatus: 'foo'`
sem subir banco nem Edge Function. Testes de integração reais ficam para a suíte com Supabase local.

## Risks / Trade-offs

- **[Middleware executando em toda navegação]** → `getUser()` é uma ida ao Auth por navegação; aceitável para
  app single-user. Mitigação: cache de sessão do Next e matcher excluindo assets.
- **[A allowlist no callback não impede a conta de ser criada no Auth]** → Mitigado pela segunda camada (hook);
  o efeito residual é uma linha inerte em `auth.users`, sem acesso a dados.
- **[Hook desativado no painel = barreira caída silenciosamente]** → Documentado como pré-requisito manual
  destacado no README de implantação, e a camada do callback continua funcionando.
- **['CSP sem nonce']** → Aceito por compatibilidade com App Router; risco residual baixo dado o tratamento do
  LLM como texto puro. Reavaliar se algum dia entrar editor rich text ou biblioteca de terceiros que exija
  `unsafe-inline`.
- **[`img-src` com host do Google] → superfície de tracking Cookie em imagem de terceiro]** → Mitigado por
  `Referrer-Policy: strict-origin-when-cross-origin` e por `next/image` com `referrerPolicy` restrito quando
  possível.
- **[Race entre dois drops rápidos na UI]** → treated na change de UI (serialização por card); aqui só se
  garante que cada chamada é isolada e que a última escrita vence de forma determinística.
- **[`ALLOWED_EMAILS` como env do servidor Next e como valor no banco]** → Duas fontes que podem divergir.
  Mitigação: a tarefa de implementação deixa explícito que a lista é a mesma, documentando a fonte usada pela função
  do hook.

## Migration Plan

1. `supabase db push` — aplica a migration com a função do hook (**Before User Created**).
2. `supabase secrets set` — `ALLOWED_EMAILS`, `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` (URL pública, não é
   segredo) e demais variáveis já previstas.
3. Ativar manualmente o hook no painel de autenticação e confirmar que apenas o Google está habilitado.
4. `npm run build && npm start` local, `next build` em CI.
5. Rollback: remover `middleware.ts` (reabre rotas) e a função do hook via `DROP FUNCTION`; nenhuma alteração de
   dados é feita por esta change, então não há risco de perda.

## Open Questions

Nenhuma aberta. A única pergunta que existia — a fonte da lista de e-mails consumida pelo hook — foi fechada
como **D11** (tabela `public.allowed_emails`, com RLS habilitado e sem policy) ao escrever as tasks, sem
alterar nenhum cenário de aceite: o comportamento observável (bloquear e-mail fora da lista) continua sendo o
do spec.

## Ambiente de teste

As tasks de integração usam **credenciais reais**, lidas do Infisical e materializadas em `.env.local` (que
continua no `.gitignore`) — não fixtures, porque o ciclo de OAuth do Google não fecha com valor fictício. O
Next recebe apenas `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `ALLOWED_EMAILS`. A service
role key **não** entra no ambiente do Next em nenhuma hipótese, e `GEMINI_API_KEY`, `GEMINI_MODEL` e `APP_ORIGIN`
continuam secrets da Edge Function, resolvidas por `supabase secrets set`. Nenhum valor é escrito em arquivo
versionado nem reportado em log.
