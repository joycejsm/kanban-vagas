# Proposal

## Why

Toda vaga da Gupy é extraída por um LLM quando não precisa — e some quando o LLM está indisponível.

O `ld+json` da Gupy vem com o JSON **escapado como HTML**: o bloco começa com `{&quot;@context&quot;…}`, e
não com `{"@context"…}`. Dentro de `<script>` as entidades HTML não são decodificadas, então
`$(script).text()` devolve o texto com `&quot;` intacto, `JSON.parse` lança, e o `catch` de
`extrairLdJson` engole e devolve `null`. O pipeline recorre ao modelo — com uma página de 117 KB que
**contém o dado estruturado completo da vaga**.

Duas consequências, e a segunda é pior que a primeira:

1. **Toda vaga da Gupy paga uma chamada ao Gemini** que não precisava, com o texto inteiro da página.
2. **Quando o Gemini falha, a vaga se perde mesmo com o dado perfeito na página.** Foi o que aconteceu
   em 2026-10-01: a Stefanini (5.680 chars de texto, mais rico que a Omie) deu erro, e a causa foi
   `503 high demand` — transitório, e irrelevante, porque nenhuma chamada ao modelo era necessária.

O sintoma que a usuária viu foi o terceiro: a vaga da Omie **entrou sem requisitos**, com título e
empresa preenchidos. Não era limitação do modelo. A descrição da vaga tem 11 requisitos limpos esperando
na página, e o Gemini simplesmente não os devolveu. O caminho estruturado entrega mais, e de graça.

### O segundo defeito não é da Gupy

Corrigir só as entidades não basta, e o motivo não é da Gupy: **o `description` de um `JobPosting` é
HTML por definição**, e `extrairRequisitos` o entrega cru a `extrairListaDaDescricao`, que espera
texto. Hoje isso já quebra em qualquer site cujo `ld+json` **parse** — a Gupy só é visível porque
nunca chega lá. Medido, depois de decodificar as entidades:

| | hoje | com o conserto |
|---|---|---|
| itens de requisito | 30, com `<h2>`, `</span></li>` dentro | **11, limpos** |

Com `requisitos` no limite de 30 do schema, uma lista de 30 lixos não é só feia: ela esgota a
cardinalidade e esconde a informação que a usuária quer.

### O que a medição desmentiu

Antes desta change, o handoff registrava que "a Gupy responde 200 com 3.905 bytes de casca de React
(`<div id="candidates-root">`), não há `JobPosting`, e a extração devolve campos vazios". **Isso é falso,
e a premissa inteira daquela change estava errada.** A página de vaga da Gupy responde `200` com 117 KB
e traz `JobPosting` completo em `ld+json`. A medição dos 3.905 bytes veio de outra página — a de
autenticação, provavelmente — e foi generalizada.

Duas tenants da mesma Gupy se comportaram de formas diferentes na mesma sessão (`carreirasomie` duas
sucessos, `stefanini` um erro), o que é a assinatura de "depende de serviço externo", e não de "o site
não funciona".

## What Changes

- **BREAKING** (qualidade observável): `extrairLdJson` passa a decodificar as entidades HTML do bloco
  `ld+json` quando o `JSON.parse` do texto cru falha. Efeito: as vagas da Gupy passam a ser extraídas
  do dado estruturado, e não do modelo.
- **BREAKING** (qualidade observável): o `description` de um `JobPosting` passa a ser limpo como HTML
  antes de virar lista de requisitos. Efeito: os requisitos deixam de vir com marcação dentro e passam a
  ser os que a página realmente lista.
- Nenhuma mudança em tabela, migration, secrets, limites, modelo ou prompt.

## O que NÃO muda, e por quê

**A limpeza de `extrairListaDaDescricao` fica para outra change.** Depois do conserto, o primeiro
requisito da Omie continua sendo `"Descrição da vagaA Omie tem como propósito trazer prosperidade…"`:
o limpador não separa o cabeçalho `<h2>` do texto que o segue. Isso é defeito do reconhecedor de
listas diante de **HTML de verdade** — que ele nunca viu, porque até hoje recebia texto já limpo e,
quando recebia HTML, era o HTML escapado que agora nem chega lá. Decisão da usuária: change própria,
para não misturar duas causas num conserto só.

**A Inhire não é bug.** `extrairTexto` devolve 6 caracteres — a string `"InHire"`. É app renderizado
por JavaScript, sem conteúdo no servidor, e não há o que extrair. O fallback de texto colado já cobre,
e a resposta `422` pedindo o texto é o comportamento certo. Não entra nesta change.

**Não há mudança no prompt nem no modelo.** O caminho estruturado é anterior ao modelo por design
(D7); o defeito era ele nunca ser alcançado, não ser insuficiente.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `ingest-vaga`: a extração estruturada passa a ser exigida como caminho preferencial que **tolera o
  `JSON-LD` escapado como HTML** e trata o `description` como o HTML que ele é.

## Impact

- **Edge Function**:
  - `_shared/parsing.ts`: `extrairLdJson` (decodificação com reserva) e `extrairRequisitos` (limpeza do
    `description`).
  - `_shared/parsing.test.ts`: testes que travam a **forma** do dado de entrada — bloco com
    `&quot;`, e `description` com tag — e não só o resultado.
- **Next**: nenhum arquivo. `201 { vaga }` e os `422` ficam como estão.
- **Migração de dados**: nenhuma. **Secrets**: nenhuma. **Limites**: inalterados.
- **Custo**: diminui. Vagas da Gupy deixam de chamar o Gemini, e a chamada que existia era a mais
  cara do pipeline (texto inteiro, ~5 mil caracteres).
- **Como verificar sem produção**: a extração estruturada é determinística e não toca rede. Reproduzir
  com o HTML de uma página real de vaga da Gupy basta, e o teste guarda esse HTML como fixture.

### Risco

Baixo, e delimitado por desenho: a decodificação só é tentada **depois** que o parse do texto cru
falha, então todo site que funciona hoje continua no caminho de hoje. O segundo conserto muda a
qualidade da lista de requisitos — para melhor, e verificável por inspection do HTML de entrada.
