# Tasks

## 1. A decodificação do bloco `ld+json`, como plano B

- [ ] 1.1 Em `extrairLdJson`, manter o `JSON.parse` do texto cru como primeiro caminho e, só no `catch`,
  repetir o parse com o conteúdo decodificado das entidades — sem alterar o caminho que já funciona
- [ ] 1.2 Verificar com `npm run test:funcao` que a suíte existente de `parsing` continua verde, e
  confirmar pelo diff que nenhum site que já parseava mudou de caminho
- [ ] 1.3 Acrescentar os testes que travam a **forma** da entrada: o mesmo `JobPosting` servido com o
  bloco escapado (`&quot;`) e servido como JSON válido, produzindo o mesmo resultado, e um bloco que não é
  JSON nem depois de decodificado sendo ignorado sem lançar

## 2. O `description` é HTML, e a lista de requisitos é texto

- [ ] 2.1 Em `extrairRequisitos`, passar o `description` pelo `extrairTexto` antes de
  `extrairListaDaDescricao`, preservando a preferência pela lista estruturada (`requirements` /
  `qualifications`) quando ela existir
- [ ] 2.2 Testes: `description` com marcação não produz requisito contendo `<h2>`, `<p>`, `<span>` nem
  `</li>`; e o `description` em HTML gera a mesma lista que o mesmo conteúdo sem marcação
- [ ] 2.3 Verificar com `npm run test:funcao` e `npm run typecheck`

## 3. Reprodução e verificação do resultado real

- [ ] 3.1 Reproduzir localmente, sem rede e sem chamar o modelo, a extração estruturada de uma página
  real da Gupy, e registrar no handoff que ela devolve título, empresa e requisitos — contra os
  30 itens com marcação que saem hoje
- [ ] 3.2 Confirmar que a vaga da Stefanini, que falhou com `503 high demand`, é extraída pelo caminho
  estruturado e sem chamada ao modelo — é a prova de que a dependência do Gemini saiu da Gupy
- [ ] 3.3 Rodar `npm run verificar` e confirmar typecheck, vitest, pgTAP e testes da função verdes

## 4. Registro

- [ ] 4.1 Corrigir no `HANDOFF-ingest.md` a afirmação de que a Gupy devolve 3.905 bytes de casca de
  React sem `JobPosting`, que é falsa e foi a premissa da change anterior
- [ ] 4.2 Registrar em `DEBUG-login-hook.md` a lição da medição: testar a URL que o sistema processa, e
  tratar duas medições que se contradizem como sinal para resolver antes de escrever a change
- [ ] 4.3 Anotar a limpeza de `extrairListaDaDescricao` — que separa mal o cabeçalho `<h2>` do texto
  seguinte — como **próxima change**, sem misturar as duas causas

## Fora do escopo

- A limpeza de `extrairListaDaDescricao` diante de HTML de verdade (decisão da usuária: change própria).
- `carreiras.inhire.app`, que é app renderizado por JavaScript: `extrairTexto` devolve 6 caracteres e
  não há dado a extrair. O `422` pedindo o texto colado é o comportamento correto.
