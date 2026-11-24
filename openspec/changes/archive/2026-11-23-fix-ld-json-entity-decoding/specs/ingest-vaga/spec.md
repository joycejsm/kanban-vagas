# ingest-vaga — Spec Delta

## ADDED Requirements

### Requirement: A extração estruturada tolera o JSON-LD escapado e trata o description como HTML

A função SHALL tentar extrair a vaga do `ld+json` **antes** de recorrer ao modelo, e essa extração
SHALL tolerar as duas formas que a medição encontrou em páginas reais.

O conteúdo de um `script[type="application/ld+json"]` SHALL ser lido com as entidades HTML decodificadas
quando o texto não for JSON válido como veio — dentro de `<script>` as entidades não são resolvidas, de
modo que um bloco servido como `{&quot;@context&quot;…}` é recusado pelo `JSON.parse` e leva a função a
descartar dado estruturado que estava presente e íntegro na página. A decodificação SHALL ser tentada
**após** a falha do parse do texto como veio, de modo que bloco já válido siga o mesmo caminho de antes.

O campo `description` de um `JobPosting` SHALL ser tratado como o HTML que é por definição, e
convertido em texto antes de virar lista de requisitos. Enviá-lo cru ao reconhecedor de listas produz
itens que contêm marcação, e como a lista é limitada em cardinalidade, a lista de marcação esgota o
limite e oculta os requisitos reais.

Quando a extração estruturada produzir título, empresa e ao menos um requisito, a função SHALL NOT
chamar o modelo.

#### Scenario: Bloco escapado como HTML é lido

- **GIVEN** uma página cujo `ld+json` começa com `{&quot;@context&quot;:&quot;http://schema.org&quot;…}` e
  contém um `JobPosting` íntegro
- **WHEN** a função extrai a vaga estruturada
- **THEN** ela SHALL devolver título, empresa e requisitos, e SHALL NOT recorrer ao modelo

#### Scenario: Bloco já válido não muda de caminho

- **GIVEN** a mesma vaga servida com o `ld+json` como JSON válido, sem escape
- **WHEN** a função extrai a vaga estruturada
- **THEN** o resultado SHALL ser idêntico ao do bloco escapado, e o parse SHALL ter sido tentado no
  texto como veio antes de qualquer decodificação

#### Scenario: description com marcação não vaza marcação para os requisitos

- **GIVEN** um `JobPosting` cujo `description` é HTML, começando por `<h2>Descrição da vaga</h2><p>…`
- **WHEN** a função extrai os requisitos
- **THEN** nenhum requisito SHALL conter `<h2>`, `<p>`, `<span>` ou `</li>`, e a lista SHALL ter menos
  itens que o número de marcas da página

#### Scenario: O mesmo texto, com e sem marcação, dá a mesma lista

- **GIVEN** um `JobPosting` cujo `description` em HTML, e o mesmo conteúdo com a marcação removida
- **WHEN** a função extrai os requisitos dos dois
- **THEN** as duas listas SHALL ser iguais, porque o reconhecedor recebe texto nos dois casos

#### Scenario: Página sem dado estruturado ainda recorre ao modelo

- **GIVEN** uma página sem `JobPosting` utilizável, ou com `description` ausente
- **WHEN** a função extrai a vaga
- **THEN** ela SHALL recorrer ao modelo, e a resposta ao usuário SHALL NOT revelar a saída do modelo

#### Scenario: JSON-LD realmente malformado é ignorado em silêncio

- **GIVEN** uma página cujo bloco `ld+json` não é JSON válido nem depois de decodificado
- **WHEN** a função extrai a vaga estruturada
- **THEN** ela SHALL devolver ausência de dado estruturado, sem lançar, e o pipeline SHALL prosseguir
