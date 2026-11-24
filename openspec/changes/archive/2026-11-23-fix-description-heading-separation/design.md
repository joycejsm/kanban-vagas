# Design

## Context

A extração de vagas pelo caminho estruturado (`JobPosting` em JSON-LD) converte o campo `description` em texto via `extrairTexto()` e em seguida extrai os tópicos via `extrairListaDaDescricao()`.
Conforme identificado na investigação das páginas da Gupy (Omie e Stefanini) e registrado na conclusão da change anterior:
1. `extrairTexto` insere `\n` somente após os nós (`.after('\n')`), gerando concatenação quando um cabeçalho não tem quebra que o preceda no HTML.
2. `extrairListaDaDescricao` inclui qualquer linha com até 200 caracteres quando o texto total tem até 8 linhas, ou qualquer linha com marcador, capturando cabeçalhos de seção e frases institucionais.

## Goals / Non-Goals

**Goals:**
- Isolar completamente cabeçalhos (`h1`-`h6`) de modo que nunca se fundam ao texto anterior ou posterior.
- Filtrar títulos de seções conhecidas para que não ingressem no array `requisitos`.
- Quando houver cabeçalho delimitador de requisitos/qualificações na descrição, priorizar os itens pertencentes a essa seção específica.
- Manter o pipeline Deno 100% determinístico e sem dependências externas adicionais.

**Non-Goals:**
- Reescrever o parser de HTML ou abandonar o Cheerio.
- Tentar interpretar formatações exóticas de páginas sem marcação estruturada básica (o modelo Gemini continua sendo o fallback previsto para páginas desestruturadas).

## Decisions

### D1 — Inserção bidirecional de quebras em elementos de bloco e cabeçalho

Em `extrairTexto`:
```ts
$('h1, h2, h3, h4, h5, h6').before('\n').after('\n');
$('p, div, li, br, tr, section, article').after('\n');
```
* **Racional:** Elementos de cabeçalho definem quebras de seção por natureza. Como `normalizarEspacos()` divide por `\n`, remove espaços adjacentes e filtra linhas vazias (`linha.length > 0`), a inserção de `\n` antes e depois garante que nenhum texto corra colado ao título, sem introduzir linhas em branco extras no resultado final.
* **Alternativa rejeitada:** Inserir apenas espaços ou depender da marcação do autor da página. Páginas como as da Gupy frequentemente posicionam `<h2>` imediatamente após texto sem envolver o parágrafo anterior em `<p>`, gerando palavras unidas.

### D2 — Filtragem estrita de títulos de seção conhecidos

Em `extrairListaDaDescricao`, linhas que correspondam a cabeçalhos padrão de vagas de emprego são ignoradas:
* Termos: "descrição da vaga", "sobre a vaga", "sobre a empresa", "quem somos", "o que fazemos", "responsabilidades e atribuições", "atividades", "requisitos e qualificações", "requisitos", "qualificações", "o que esperamos de você", "o que você precisa ter", "diferenciais", "benefícios", "informações adicionais", "etapas do processo".
* **Racional:** Essas frases nunca são requisitos do candidato; são metadados estruturais do anúncio.
* **Alternativa rejeitada:** Filtrar por palavras-chave com `includes()`. Rejeitada porque um requisito legítimo poderia conter a palavra "requisitos" (ex.: "Atender aos requisitos de segurança"). A comparação é feita com a linha normalizada (sem pontuação e caixa baixa).

### D3 — Priorização da seção de requisitos quando identificada

Quando o texto da descrição contiver um cabeçalho como "requisitos e qualificações" ou "o que você precisa ter":
1. O extrator isola o segmento que começa após esse cabeçalho e termina no próximo cabeçalho de seção (ex.: "benefícios" ou "etapas do processo").
2. Se essa seção produzir 2 ou mais requisitos válidos, esses requisitos são retornados com prioridade.
3. Se a seção não produzir itens suficientes (ou não for encontrada), o extrator recorre à lista geral filtrada de cabeçalhos.
* **Racional:** Resolve o caso da Omie e vagas similares, onde parágrafos institucionais como "A Omie tem como propósito transformar o empreendedorismo..." estavam sendo capturados como requisitos antes da lista de itens reais.

## Risks / Trade-offs

- **[Risco de filtro muito agressivo eliminar requisitos legítimos]** → A correspondência de títulos é exata na linha normalizada (ex.: `^requisitos(\s+e\s+qualifica[çc][õo]es)?[:]?$`), garantindo que itens descritivos não sejam descartados.
- **[Risco de quebra de testes legados de parsing]** → A suíte existente de `parsing.test.ts` possui testes com fixtures sintéticas. A mudança será acompanhada da execução contínua de `npm run test:funcao` e `npm run verificar`.
