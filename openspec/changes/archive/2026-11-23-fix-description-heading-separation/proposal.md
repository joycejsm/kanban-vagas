# Proposal

## Why

Ao extrair requisitos a partir do campo `description` de um `JobPosting` (ou de fragmentos HTML na ingestão estruturada), o processamento textual sofre com dois problemas de poluição e concatenação:

1. **Concatenação de cabeçalhos com o texto corrido:** A função `extrairTexto` insere quebra de linha apenas após (`after`) elementos semânticos (`h1`-`h6`, `p`, etc.). Quando um cabeçalho surge precedido ou sucedido por texto corrido sem elemento de bloco envolvente, o título da seção fica colado ao texto adjacente (por exemplo, `"Descrição da vagaA Omie tem como propósito..."` ou `"...empreendedorismo.Requisitos e qualificações"`).
2. **Títulos de seções capturados como itens de requisito:** A função `extrairListaDaDescricao` não distingue cabeçalhos estruturais de requisitos de fato. Títulos como `"Descrição da vaga"`, `"Sobre a empresa"`, `"Requisitos e qualificações"` e frases de apresentação institucional acabam sendo coletados como requisitos no array `vaga.requisitos`, poluindo os dados exibidos no quadro Kanban e consumindo o limite de 30 itens.

Essa correção foi isolada em change própria ao final da `fix-ld-json-entity-decoding` para manter o escopo focado.

## What Changes

- **Separação estrita de cabeçalhos em `extrairTexto`:** Garantir que elementos de cabeçalho (`h1` a `h6`) e blocos semânticos recebam quebras de linha antes e depois, impedindo que títulos de seção fiquem colados ao texto vizinho.
- **Filtragem de cabeçalhos e termos de seção em `extrairListaDaDescricao`:** Descartar linhas que correspondam a títulos de seção (ex.: "Descrição da vaga", "Requisitos e qualificações", "Sobre a vaga", "Responsabilidades", etc.) para que não ingressem no array de requisitos.
- **Segmentação da seção de requisitos:** Quando a descrição textual contiver cabeçalho identificador de requisitos/qualificações, priorizar os tópicos listados sob essa seção em vez de capturar o texto introdutório da empresa.

## Capabilities

### Modified Capabilities
- `ingest-vaga`: O requirement de tratamento estruturado de `description` passa a exigir que cabeçalhos sejam isolados do texto corrido por quebras de linha e que títulos de seção sejam filtrados da lista de requisitos extraída.

## Impact

- Afeta `supabase/functions/ingest-vaga/_shared/parsing.ts` (`extrairTexto` e `extrairListaDaDescricao`).
- Afeta `supabase/functions/ingest-vaga/_shared/parsing.test.ts` com novas asserções e fixtures de páginas reais.
- Não introduz dependências externas novas nem altera esquemas de banco de dados.
