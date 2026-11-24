# Tasks

## 1. A janela: timestamp literal, e um teste que segura a forma

- [x] 1.1 Em `supabase.ts`, trocar o texto SQL por um instante único (`Date.now()`) do qual derivar as duas
  janelas, e enviar cada uma em ISO 8601 para `gte('criado_em', ...)`
- [x] 1.2 Acrescentar em `supabase.test.ts` o teste que fixa a **forma** do valor enviado — ISO 8601, sem
  `interval`, sem `now()` — com um dublê de cliente que registra os filtros, e o teste de que as duas janelas
  saem do mesmo instante
- [x] 1.3 Verificar com `npm run test:funcao` que nada mais quebra

## 2. O desfecho: na linha que a tentativa criou

- [x] 2.1 Fazer `registrarTentativa` devolver o `id` do registro criado, e `marcarDesfecho` atualizado por
  `eq('id', id)` com `.select('id')` para distinguir "não havia linha" de "a gravação foi recusada"
- [x] 2.2 Em `marcarDesfecho`, lançar quando o banco devolver erro, em vez de descartar `{ error }` em
  silêncio — hoje nem o SQLSTATE chega ao log
- [x] 2.3 Testes em `supabase.test.ts`: o update filtra por `id` e não por `resultado = pendente`; erro do
  banco no update vira exceção; update que não encontra linha é distinguível do que gravou

## 3. O pipeline: etapa nomeada e linha sempre fechada

- [x] 3.1 Separar `registrarTentativa` (insert) de `contarJanelas` (as duas contagens) em `Dependencias`, e
  fazer `etapaRateLimit` receber as janelas já contadas em vez de lançar
- [x] 3.2 Em `executarPipeline`, atribuir a auditoria **imediatamente após** o registro, para que uma falha
  na contagem feche a linha como `erro` em vez de deixá-la `pendente`
- [x] 3.3 Fazer `marcarDesfechoSilencioso` registrar no log a etapa `auditoria` e o código do erro quando o
  fechamento falha, sem alterar a resposta ao usuário
- [x] 3.4 Testes em `pipeline.test.ts`: contagem que falha fecha a linha e nomeia a etapa no log; registro que
  falha não tenta fechar nada; o `id` criado é o que chega a `marcarDesfecho`; duas requisições simultâneas
  não fecham a linha uma da outra
- [x] 3.5 Atualizar a composição em `index.ts` e verificar com `npm run typecheck` e `npm run test:funcao`

## 4. Verificação e registro

- [x] 4.1 Rodar `npm run verificar` e confirmar typecheck, vitest, pgTAP e testes da função verdes
- [x] 4.2 Implantar a função (`supabase functions deploy ingest-vaga`)
  - Feito: **versão 4** em 2026-10-01 05:03:35 UTC (a 3, de 01:48:22, tinha o defeito). Commit `337bd12`.
  - O `curl` **autenticado** previsto nesta task **não é executável**: a etapa de auditoria vem depois
    de autenticação e allowlist, e o gateway recusa (`401 UNAUTHORIZED_NO_AUTH_HEADER`) antes do corpo
    da função rodar. Sem token de produção — que só se obtém por login Google no navegador — nenhum
    `curl` alcança a contagem. O que o `curl` sem token confirma, e foi confirmado: função no ar e
    `verify_jwt` ligado.
  - **A prova de que a auditoria parou de dar `500` é a task 3.3**, no navegador: a vaga tem que entrar
    no quadro. Não se espera `422` com URL da Gupy — essa expectativa veio de uma medição falsa, corrigida
    em 2026-10-01 e registrada no proposal desta change.
- [x] 4.3 Registrar em `DEBUG-login-hook.md` (ou no arquivo de handoff vigente) que o filtro do PostgREST é um
  valor e que `head: true` esconde o corpo do erro — a soma dos dois é o que tornou este defeito invisível
- [x] 4.4 Anotar no handoff a medição da Gupy como a **próxima** change, para que a falha de extração
    depois deste conserto não seja lida como regressão
  - **Corrigido em 2026-10-01**: a nota falava em "3.905 bytes de casca de React", que era a página de
    autenticação. A página de vaga responde `200` com ~117 KB e traz `JobPosting` — o defeito é o `ld+json`
    escapado, e a change que o conserta é a `fix-ld-json-entity-decoding`.
