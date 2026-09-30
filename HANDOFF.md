# Handoff — Kanban de Vagas

Estado em 2026-09-30, ao fim da sessão que implementou a **Fase 4** (`add-kanban-ui`): a interface do quadro
com cadastro por URL, movimentação entre colunas e remoção. A change está com as 26 tasks concluídas e
**ainda não arquivada**; os specs `kanban-board` e o delta de `vaga-server-actions` só entram em
`openspec/specs/` no arquivamento.

## Onde o repositório está

Fases 1 a 4 implementadas. `main` com o código da Fase 3 em `c7d25b2`; a Fase 4 entra no commit desta
sessão, ainda sem arquivamento.

| Change | Estado |
|---|---|
| `add-vaga-domain-and-persistence` | arquivada (2026-09-29) |
| `add-ingest-vaga-edge-function` | arquivada (2026-09-29) |
| `sync-fase2-contract-into-vaga-specs` | arquivada (2026-09-29) |
| `add-nextjs-app-scaffold` | arquivada (2026-09-30), 17/17 |
| `add-nextjs-auth-and-server-actions` | arquivada (2026-09-30), 39/40 — falta a 9.4 |
| `add-kanban-ui` | **implementada**, 26/26 — aguardando arquivamento |

`openspec/specs/` tem 13 capabilities. A Fase 4 acrescenta a **`kanban-board`** e um delta de
`vaga-server-actions` (a action `removerVaga`), os dois em `openspec/changes/add-kanban-ui/specs/` até o
arquivamento.

## Verificação de referência

| Suíte | Comando | Estado |
|---|---|---|
| Tipos | `npm run typecheck` | sem erros |
| Vitest | `npm test` | **285 passed (18 arquivos)** — 178 anteriores + 107 da Fase 4 |
| Deno | `deno task --cwd supabase/functions/ingest-vaga test` | 35 passed |
| Deno tipos | `deno task --cwd supabase/functions/ingest-vaga check` | limpo |
| Specs | `openspec validate --specs` | 13 passed, 0 failed |
| RLS / allowlist (pgTAP) | `infisical run --path=/nextjs -- supabase test db --linked` | **44 passed, 0 failed**, contra o **projeto remoto** |

## O que a Fase 4 entregou

Interface do quadro, do zero, sobre as Server Actions da Fase 3 — sem depender de biblioteca de UI nova.

| Módulo | Papel |
|---|---|
| `src/quadro/colunas.ts` | as cinco colunas, agrupamento, destinos e ordem de destino. Puro, sem React. |
| `src/quadro/estado.ts` | projeção do card e transições (mover, reverter, remover, assinatura). Puro. |
| `src/quadro/formulario.ts` | traduz o **código** de erro na apresentação do formulário. Puro. |
| `src/quadro/carregarQuadro.ts` | carga das vagas no servidor, via as dependências injetadas. |
| `src/quadro/Quadro.tsx` | Client Component: colunas, cards, estado otimista. |
| `src/quadro/FormularioNovaVaga.tsx` | Client Component: campo de URL + texto colado de segunda tentativa. |

**Três decisões que valem para quem mexer nisto:**

1. **`MENSAGENS_DO_QUADRO` em `acoes/erros.ts`.** As frases de `atualizarStatus` e `removerVaga` não são
   de ingestão e nunca estiveram em `MENSAGENS`, que é o vocabulário dos status HTTP da Edge Function.
   Estavam duplicadas como literais em dois pontos; agora há um conjunto fechado, e um teste compara os
   retornos das duas actions com `toEqual` para garantir que "não encontrada" é literalmente a mesma
   resposta nos dois casos (D7, oráculo de enumeração).
2. **`paraCartoes()` é o portão de saída do banco.** Os cards são Client Components, e um Client Component
   recebe os dados pelo payload de RSC, que é HTML. Passar a `VagaRow` inteira colocaria o `user_id` da
   conta no HTML de `/`. A projeção descarta `user_id` e `url_normalizada`, e `render.test.ts` assere a
   ausência dos dois no HTML entregue.
3. **`lerConfiguracaoSupabase()` continua em `page.tsx`, fora do `try/catch` do quadro.** `carregarQuadro`
   engole toda exceção de propósito, para que falha de consulta vire aviso em vez de tela quebrada. Mas a
   spec `app-scaffold` exige que a ausência de variável **interrompa** a execução com
   `ErroConfiguracaoSupabase`. Sem a chamada explícita na página, o app subiria degradado, com cinco
   colunas vazias e um aviso, e ninguém saberia que o problema era o ambiente. **Se você mexer em
   `carregarQuadro`, preserve essa separação.**

**Limite conhecido**: o quadro é renderizado no servidor e aparece inteiro sem JavaScript, mas
**mover, remover e a revelação do campo de texto colado exigem JS**. O campo de URL e o botão de cadastro
funcionam sem ele, porque são um `<form action>` de verdade. Está registrado no design como risco e na
spec como cenário.

## ⚠️ Nada está commitado

A Fase 4 inteira está **na árvore de trabalho, sem commit**. `main` continua em `8b3f6c1`, que é o
handoff da sessão anterior. 6 arquivos modificados, 2 diretórios novos (`src/quadro/`, `tests/quadro/`) e
5 artefatos de change.

Perder essa sessão sem commitar perde ~2.000 linhas. A convenção do projeto é uma change do OpenSpec por
commit, então o commit esperado seria algo como `feat(quadro): Fase 4 com cadastro por URL, movimentação e remoção`.
Nenhum arquivo de ambiente ou `.infisical.json` está no diff — o `.gitignore` cobre os dois, e o diff
confirma isso.

**Correção de um erro do handoff anterior**: ele afirmava que o workspace do Infisical continha apenas
`OPENROUTER_API_KEY` e que "nenhuma credencial do Supabase existe lá". Isso era leitura do **path raiz**.
O path que este projeto usa, `/nextjs`, tem quatro chaves — `ALLOWED_EMAILS`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_DB_PASSWORD` — e é por ele que o `supabase test db --linked`
consegue falar com o banco. **Não repita a investigação**: as credenciais estão lá.

Para listar chaves sem expor valor (a lição do incidente abaixo):

```
infisical export --path=/nextjs --format=json | jq -r '.[].key'
```

## O bloqueio do banco foi fechado

Na sessão anterior, `supabase/.temp/` não tinha `project-ref` e nenhuma credencial de API existia, o que
deixava RLS e hook da allowlist como código não verificado. **Isso foi resolvido**: login, `link` e
`db push` feitos, e as três migrações (`vagas.sql`, `ingest_log.sql`, `allowed_emails.sql`) estão na nuvem.

Com Infisical injetando o ambiente, o estado real do banco foi verificado pela primeira vez:

```
infisical run --path=/nextjs -- supabase test db --linked
→ Files=2, Tests=44, All tests successful. Result: PASS
```

As 44 asserções pgTAP (`vagas_rls.sql` e `auth_allowlist.sql`) passaram **contra o projeto remoto**, e não
contra o stack local. O que antes era evidência local agora é evidência do banco de produção. Os 285
testes do vitest, os 35 do Deno e o typecheck continuam verdes.

**O que ainda é passo manual**: ativar o hook *Before User Created* no painel. Sem ele, a segunda camada
da allowlist não existe, mesmo com a tabela e a função aplicadas. A task 9.4 da Fase 3 (ciclo real de login
no navegador) continua em aberto e archivada como `[ ]`.

## O que falta resolver, em ordem

1. **Arquivar a `add-kanban-ui`** — as 26 tasks estão feitas e a change valida; falta
   `/opsx-archive`, que promove `kanban-board` e o delta de `vaga-server-actions` às specs.
2. **Task 9.3** — ativar o hook *Before User Created* no painel. Passo manual, sem automação possível.
3. **Task 9.4** — ciclo real de login no navegador, com as credenciais do Infisical. E-mail em
   `ALLOWED_EMAILS` deve chegar à raiz autenticado; e-mail fora da lista, a `/login?erro=nao_autorizado`.
4. **Fase 5 (candidata)** — drag-and-drop com `@dnd-kit`. A decisão D1 do design adiuda isso de forma
   puramente aditiva: `ordem` já é persistida, `listarVagas` já ordena por `status, ordem, created_at`, e
   nenhuma Server Action muda de assinatura. Trocar o `<select>` por um sensor não toca banco nem spec.

## Correção de spec feita na sessão da Fase 3 — leia antes de mexer na CSP

O delta de `security-headers` e o título do D9 no `design.md` estavam **para trás do código**:
descreviam `script-src 'self'` sem `unsafe-eval`, enquanto `src/config/csp.ts` emite
`'self' 'nonce-<valor>'` e acrescenta `'unsafe-eval'` fora de produção.

A decisão em si já estava correta no design (D9 tem um parágrafo "Correção" explicando por que
`script-src 'self'` puro quebra o App Router) e nos testes (`tests/config/csp.test.ts` reproduz a
quebra real). O que estava desatualizado era o texto do requisito, os cenários e o bullet de risco
`['CSP sem nonce']`. As três coisas foram reescritas antes de promover a spec, e a spec promovida
agora diz: nonce por resposta, nunca reutilizado; `'unsafe-inline'` proibido sempre;
`'unsafe-eval'` ausente em produção.

**Quem mexer na CSP deve ler o cabeçalho de `src/config/csp.ts` antes do spec** — o comentário
longo ali documenta três armadilhas (o `InvariantError` do App Router, o hash estático que não serve
para *flight payload*, e o `eval()` do React de dev) que o spec não reexplica.

## Incidente de segredo na sessão da Fase 3 (ainda não rotacionado)

Ao listar o Infisical com `infisical secrets`, o CLI imprimiu o **valor** de
`OPENROUTER_API_KEY` em texto claro no terminal, e ele ficou registrado na transcrição da sessão.
O correto seria `infisical export | jq 'keys'`. **Recomenda-se rotacionar essa chave.** Nenhum valor
de token ou e-mail do projeto foi reportado.

## Armadilhas do ambiente (custaram tempo)

1. **`pkill -f "next dev"` mata o próprio shell.** Use `pkill -f "[n]ext dev"`.
2. **A porta 3000 pode estar ocupada por processo alheio**; o Next sobe na 3002 em silêncio. Use
   `PORT=` explícito ao testar.
3. **`deno fmt --check` reprova os 17 arquivos da função**, inclusive os 16 preexistentes: o projeto
   usa aspas simples e não adota o fmt do Deno. **Não "conserte"** — siga a convenção do projeto.
4. **O `next build` reinjecta `allowJs: true` no `tsconfig.json` a cada build.** É inerte (o
   `include` não cobre nenhum `.js`) e o arquivo fica estável entre builds.
5. **O vitest só coleta `tests/**/*.test.ts`** — não `.tsx`. Testes com JSX precisam ir para fora
   desse glob, ou o glob ser ampliado. **Mas o glob limita quais arquivos são *coletados*, não o que
   pode ser *importado***: um teste `.ts` pode importar um componente `.tsx` e renderizá-lo com
   `createElement` + `renderToStaticMarkup` do `react-dom/server`. É assim que `tests/quadro/render.test.ts`
   assere o HTML do quadro (colunas, contagens, card, link, rótulos, ausência de `user_id`) sem jsdom.
   Chamar o componente direto como função — `Quadro({ cartoes })` — falha com "Cannot read properties of
   null (reading 'useState')", porque o dispatcher do React não está montado fora de um render.
   O que segue fora de alcance é o que precisa de DOM: clicar, responder ao `confirm()`, observar transição.
6. **`tsc --noEmit` não cobre `supabase/functions/`** (está no `exclude`). Código Deno só é
   validado por `deno check`.
7. **A 9.4 não é verificável em CI.** É o ciclo OAuth real; os testes cobrem o comportamento por
   injeção de dublês, não o handshake com o Google.

## Regra de ouro do projeto

Specs descrevem comportamento observável e são a fonte única de verdade; código diverge de spec é
bug de spec **ou** de código, e a divergência se resolve escrevendo — nunca ajustando o teste para
caber. A 9.4 da fase 2 falhou na primeira execução porque a asserção estava errada (o Supabase
propaga o erro cru, não um `Error`), e a correção foi no teste.
