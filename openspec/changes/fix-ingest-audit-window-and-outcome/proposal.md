# Proposal

## Why

A ingestão por URL **nunca passou da etapa de limite de uso**. A auditoria registrou a tentativa — a linha
existe, com `resultado = 'pendente'` — e a requisição morreu ali, sem fetch, sem Gemini e sem insertion.

A causa é um contrato entre a função e o PostgREST que nenhuma suíte enxerga: `contarDesde` enviava
`now() - interval '1 hour'` como **valor** de filtro (`criado_em=gte.now() - interval '1 hour'`). O
PostgREST não avalia SQL em filtro: ele tenta converter o texto para `timestamptz` e devolve

```
400 {"code":"22007","message":"invalid input syntax for type timestamp with time zone:
     \"now() - interval '1 hour'\""}
```

Como a contagem usa `head: true`, a requisição é um `HEAD` — que não tem corpo — então o `supabase-js`
devolve um erro com **mensagem vazia**. `contarDesde` transforma isso em `auditoria-indisponivel`,
`etapaRateLimit` lança, e o `catch` de `executarPipeline` responde `500` genérico com
`auditoriaAberta = false`: a linha inserida um instante antes nunca é fechada.

O que torna isso pior do que um erro 500 é que ele é **indistinguível de um 500 qualquer**. O log dizia
`codigo=erro_interno`, sem nomear a etapa, e a linha `pendente` era a única pista — que só aparece depois
de olhar o banco. A tentativa consome cota (a contagem inclui o próprio registro) e, como nada a libera,
o usuário se aproxima do `429` sem nunca ter feito 20 ingestões.

### O que a auditoria sozinha não dizia

`resultado = 'pendente'` tem duas leituras possíveis — a função morreu no meio, ou o fechamento falhou — e o
handoff estava certo em não escolher sem o log. O log não foi preciso: a resposta do PostgREST, reproduzida
aqui com a mesma query e a mesma coluna, decide entre as duas, e aponta uma terceira via que o handoff não
listava: **a contagem falha com a linha já inserida**, e o `catch` do pipeline a trata como se a auditoria
nunca tivesse começado.

## What Changes

- **BREAKING** (comportamento observável): a consulta de janela passa a enviar um **timestamp literal** em
  ISO 8601, calculado no isolate, em vez de texto SQL. É a correção do defeito: sem ela, nenhuma requisição
  passa do limite de uso.
- **BREAKING** (contrato interno): `registrarTentativa` devolve o `id` da linha criada, e o desfecho passa a
  ser gravado **nessa linha**, por `id`, em vez de "a linha pendente mais recente do usuário". O PostgREST
  **ignora `order` e `limit` em `PATCH`** (verificado: dois registros compatíveis são atualizados mesmo com
  `order=id.desc&limit=1`), então o código anterior fechava todas as pendências do usuário — e, com duas
  requisições simultâneas, uma fechava a tentativa da outra.
- **BREAKING** (contrato interno): o registro da tentativa e a contagem de janela viram duas etapas
  separadas. Falha na contagem é uma etapa nomeada (`auditoria`), com resposta genérica para o usuário e
  **a linha que já existe fechada como `erro`** — o oposto de hoje, em que a linha ficava aberta para sempre.
- Falha ao gravar o desfecho deixa de ser totalmente silenciosa: a linha de log passa a dizer `etapa=auditoria`
  e o SQLSTATE, sem derrubar a resposta que o usuário recebe.
- Nenhuma mudança em tabela, migration, secrets ou limites (20/hora, 100/dia).

### O que NÃO muda, e por quê

A linha pendente **não vaza cota para sempre**: a contagem é por janela de 1 hora e de 1 dia, então a linha
órfã de 01/10 sai da contagem sozinha. O defeito é real, mas limitado — o que torna a correção urgentemente
necessária é outra coisa: enquanto a contagem falhar, **nenhuma ingestão funciona**, e o `429` que ninguém
explicaria deixa de ser hipótese.

E o conserto **não** passa a ser um RPC no Postgres com `SECURITY DEFINER`, que é a alternativa obvious
para "a janela é SQL". D2 (arquivada) escolheu o `SELECT` protegido por RLS justamente para não criar
superfície de privilégio; trocar isso por um cálculo de janela no isolate seria trocar um bug por um risco
maior. O relógio do isolate e o do banco divergem em milissegundos, o que é irrelevante para uma janela de
uma hora.

### Defeito vizinho, fora deste escopo

Medido enquanto se reproduzia: a página de vaga da Gupy responde `200` com ~**117 KB** e traz `JobPosting`
completo em `ld+json` — o bloco, porém, vem com o JSON escapado como HTML, e a extração engolindo isso devolve
campos vazios e joga a vaga no LLM. **Isto é outra change**, a `fix-ld-json-entity-decoding`.

> **Correção (2026-10-01).** Este texto originalmente afirmava que a Gupy respondia `200` com **3.905 bytes** de
> casca de React (`<div id="candidates-root">`, `<noscript>You need to enable JavaScript to run this
> app.</noscript>`) e que não havia `JobPosting` algum. **A premissa estava errada.** Os 3.905 bytes são a
> página de autenticação — mesma origem, página diferente — e a página de vaga real responde com 117 KB e o
> `JobPosting` inteiro. O documento já registrava "140 KB de conteúdo real" e "3.905 bytes" lado a lado, e
> ninguém resolveu a contradição antes de escrever a change. Consequência: a expectativa de `422` com URL da
> Gupy, que constava deste proposal e da task 4.4, está errada — a Gupy **não** deve pedir texto colado.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `ingest-audit`: a consulta de janela passa a exigir que o filtro seja um **valor** aceito pelo tipo da
  coluna, e não uma expressão SQL; e o desfecho passa a ser gravado na linha que a própria tentativa criou,
  com verificação de que a gravação de fato ocorreu.
- `ingest-vaga`: o requisito de limite de uso ganha a obrigação de que **toda** tentativa registrada termine
  com desfecho gravado, inclusive quando a própria auditoria falha depois do registro.

## Impact

- **Edge Function**:
  - `_shared/supabase.ts`: `registrarTentativa` (devolve `id`), `contarDesde` (timestamp literal),
    `marcarDesfecho` (por `id`, com erro verificado em vez de descartado).
  - `_shared/pipeline.ts`: `Dependencias` ganha `contarJanelas` e `marcarDesfecho` passa a receber o `id`;
    `etapaRateLimit` deixa de lançar; `executarPipeline` passa a fechar a linha pelo `id` e a nomear a etapa
    de auditoria no log.
  - `_shared/index.ts`: composição das dependências.
  - Testes: `supabase.test.ts` (hoje só cobre `inserirVaga`) e `pipeline.test.ts`.
- **Next**: nenhum arquivo. O `500` genérico que o usuário saw continua genérico — o que muda é existir um
  caminho que chegue lá em vez de a auditoria estar sempre falhando.
- **Migração de dados**: nenhuma. **Secrets**: nenhuma. **Limites**: inalterados.
- **Segurança**: a superfície não aumenta. A contagem continua sendo um `SELECT` com RLS, sem parâmetro de
  usuário vindo do chamador; a linha gravada é a da própria sessão, por `id` que a função acabou de receber
  do banco.
- **Verificação de ponta a ponta**: a task 3.3 da change `fix-ingest-origin-and-error-codes` (colar uma URL
  no navegador) só passa a ser possível depois desta. Ela continua sendo da usuária, e o resultado esperado
  muda: a vaga precisa **entrar no quadro**. Não é `422` pedindo o texto colado — essa expectativa veio da
  medição falsa da Gupy corrigida acima.
