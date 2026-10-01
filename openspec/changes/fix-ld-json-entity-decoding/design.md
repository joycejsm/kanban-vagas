# Design

## D1 — Decodificar as entidades é o plano B, não o plano A

O bloco `ld+json` da Gupy começa com `{&quot;@context&quot;…}`. `$(script).text()` não decodifica,
porque dentro de `<script>` as entidades não são resolvidas — o conteúdo é texto, não marcação. O
`JSON.parse` lança, o `catch` engole, e `extrairLdJson` devolve `null`.

A correção é tentar o texto cru primeiro e, **só se o parse falhar**, repetir com o conteúdo
decodificado. A ordem é o que importa:

```ts
let dados: unknown;
try {
  dados = JSON.parse(bruto);           // caminho de hoje, intocado
} catch {
  try {
    dados = JSON.parse(decodificar(bruto));  // Gupy e afins
  } catch {
    return;                            // JSON-LD malformado de verdade
  }
}
```

**Alternativa:** sempre decodificar. Mais simples de ler, e é o erro: passar todo `ld+json` de todo
site por um round-trip do cheerio altera o conteúdo de quem já funciona, sem necessidade. A decodificação
tem o custo de um parse extra em cima de bloco grande, e um round-trip de HTML em cima de dados que
só às vezes são HTML. Como plano B, nenhum site que funciona hoje sente o cambio, e o conserto é
limitado ao que está quebrado.

**Margem:** um teste que só verifica "extrai a vaga da Gupy" passa com uma página de verdade e falha
com uma de hoje, e vice-versa — o que importa é o **shape** da entrada. O teste segura duas entradas
com purpose: o bloco com `&quot;` escapado, e o mesmo bloco válido, e verifica que os dois produzem a
mesma vaga. É o que impede a regressão de voltar a quebrar a Gupy em silêncio.

## D2 — `description` é HTML, e `extrairRequisitos` o trata como texto

Este é o defeito mais amplo dos dois, e não é da Gupy.

O `description` de um `JobPosting` é HTML **por definição** do schema.org, não texto. Mas
`extrairRequisitos` o entrega direto a `extrairListaDaDescricao`, que reconhece bullets, vírgulas em
frases curtas e blocos de skill — reconhecedores que operam sobre **texto**. Recebendo
`<h2>Descrição da vaga</h2><p>…`, ela devolve os tags como parte dos itens, e como o schema limita a
30 itens, a lista de lixo esgota a cardinalidade e a informação real desaparece.

O conserto é passar o `description` pelo **`extrairTexto` que já existe** antes de extrair a lista. Não
é código novo: é usar a função que a página inteira já usa, no lugar certo.

**Alternativa:** detectar tag e escolher o caminho. Mais código, e é o mesmo resultado — `extrairTexto`
já produz texto a partir de HTML e a partir de texto, porque texto não tem o que remover.

**Margem:** o teste fixa que um `description` em HTML produz a **mesma** lista que o mesmo `description`
já sem marcação. Isso segura a propriedade que importa: a extração estruturada não depende do formato
de entrada, e oRecognizer volta a receber texto.

## D3 — A Inhire fica de fora, e é uma decisão de diagnóstico

`carreiras.inhire.app` responde `200` com 12,6 KB e `extrairTexto` devolve **6 caracteres** — a string
`"InHire"`. É app renderizado no cliente, sem conteúdo no servidor, e não há JobPosting nem `__NEXT_DATA__`.

Não é bug e não é da mesma causa: aqui não há dado para extrair, em nenhum formato. A resposta `422`
pedindo o texto colado é o comportamento correto, e o fallback já existe. Incluir na change seria
tratar sintoma de limitação como se fosse defeito.

O que **merece** ficar registrado: o comportamento observável — `422` com o código certo — não é
coberto por teste de integração real, e é o mesmo tipo de costura que custou a change de origem.

## D4 — O que a medição errada custou

O handoff afirmava que a Gupy devolvia 3.905 bytes de casca de React sem `JobPosting`, e a change
`fix-ingest-audit-window-and-outcome` foi escrita com esse "defeito vizinho" como premissa. A medição
estava errada — provavelmente feita numa página de auth, e não na de vaga.

Duas lições que valem mais que o conserto, e que já estão em `DEBUG-login-hook.md`:

1. **Medir a URL que o sistema realmente processa.** A URL que a usuária cola não é a URL que se
   testa. `/candidates/auth` e `/jobs/12167723` são a mesma origem e páginas completamente diferentes.
2. **Duas fontes que discordam são um sinal, não um incômodo.** O mesmo handoff registrava "140 KB de
   conteúdo real" e "3.905 bytes" para a Gupy. A contradição estava visível no documento e ninguém
   parou para resolver antes de escrever a change.

A segunda é a que mais importa aqui: sem o `ingest_log` nomando **a etapa** da falha, a única pista era
um `resultado` genérico. É a justificativa prática do conserto de auditoria que veio antes.
