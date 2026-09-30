# Design

## Context

Ver `proposal.md` para a motivação. O que molda a abordagem são restrições já presentes no repositório:

- **A action `atualizarStatus` já existe e não revalida.** O comentário no código registra a decisão D8 da
  Fase 3: o drop é otimista, a UI atualiza localmente e o próximo carregamento reflete o banco. A Fase 4
  precisa de estado de cliente de qualquer forma, independentemente de como o movimento é disparado.
- **A action `removerVaga` não existe.** `VagaService.removerVaga` existe, é testado e devolve `false`
  quando nada foi removido — que é exatamente a indistinguibilidade que o D7 exige. Falta a casca de
  validação e sessão.
- **Ambiente de teste.** `vitest.config.ts` está em `environment: 'node'` com `include:
  ['tests/**/*.test.ts']`. Não há jsdom, não há Testing Library e `.tsx` não é coletado. Consequência
  direta: **toda lógica testável tem de morar em módulo `.ts` puro**, e não em hook de Client Component.
- **A lista já vem na ordem certa.** `VagaService.listarVagas` aplica `status`, `ordem`, `created_at`. Não há
  necessidade de reordenar no banco nem de estado de ordenação no cliente.
- **O `middleware` já protege `/`** e `page.tsx` já é `force-dynamic`.
- **Tailwind v4** já está instalado e configurado; a CSP de produção não tem `'unsafe-eval'`.

## Goals / Non-Goals

**Goals:**

- Que a lógica de decisão do quadro (colunas, agrupamento, destino, ordem) seja verificável no ambiente de
  teste atual, sem mudar a configuração do vitest.
- Que o quadro renderize no servidor e degrade com honestidade: conteúdo legível sem JavaScript, movimento
  indisponível sem JavaScript.
- Que nenhuma decisão de UI amplie a superfície de segurança — nada de `user_id`, nada de URL derivada de
  LLM virando `href`, nenhuma mensagem de banco chegando na tela.

**Non-Goals:**

- Não redesenhar o pipeline de ingestão nem mexer em `adicionarVaga`.
- Não introduzir biblioteca de drag-and-drop (ver D1).
- Não ampliar o `vitest.config.ts` para `jsdom`/`.tsx`; se um dia for preciso, é uma change própria com
  custo de setup declarado.

## Decisions

### D1 — Movimentação por `<select>`, sem `@dnd-kit` nesta fase

O card oferece um seletor "mover para…" com as outras quatro colunas. Escolher chama `atualizarStatus`.

Alternativa considerada: **drag-and-drop com `@dnd-kit`**, que o `project.md` já cita como parte da stack mas
que nunca foi instalado. Foi rejeitada para o MVP por cinco razões concretas, não por gosto:

1. **A action já foi desenhada para um alvo e uma posição**, não para um gesto contínuo. `atualizarStatus`
   recebe `{ vagaId, novoStatus, ordem }` e trata "reordenar várias linhas durante um gesto" como o problema
   que optou por não ter.
2. **Custo de dependência e de bundle**: `DndContext`, sensores de ponteiro/teclado/toque, medição de
   droppable e a camada de acessibilidade do dnd-kit entram no bundle de um quadro que hoje precisa de um
   `<select>`.
3. **A atualização é assíncrona e sem revalidação.** Um gesto de D&D dispara vários `atualizarStatus` em
   rajada e obriga o cliente a reconciliar estado otimista com o banco. Com seletor são 1 gesto, 1
   requisição, 1 retorno previsível.
4. **Acessibilidade de graça.** `<select>` nativo é operável por teclado e por leitor de tela, com nome
   acessível. D&D precisa reconstruir "mover para a coluna X" no teclado à mão, que é onde a maioria dos
   quadros acessíveis erra.
5. **Testabilidade.** Com seletor, agrupamento, destino e ordem são funções puras em `.ts`, testáveis hoje.
   Com D&D, a mesma lógica moraria em hooks de client e **não teria como ser testada** sem antes trocar o
   ambiente do vitest. A divisão é visível no resultado: `estado.test.ts` e `formulario.test.ts` exercitam
   decisão, e `render.test.ts` exercita o HTML.

**O drag-and-drop é puramente aditivo sobre esta solução**: `ordem` já é persistida, `listarVagas` já ordena
por `status, ordem, created_at` e nenhuma action muda de assinatura. Trocar o `<select>` por um sensor depois
não toca banco nem spec de persistência. É a melhoria natural da fase seguinte.

### D2 — A posição de destino é o fim da coluna, calculada no cliente

O seletor envia `ordem` = quantidade de cards atualmente na coluna de destino. O card entra no fim.

Isso reusa exatamente a regra que a spec `vaga-persistence` já estabelece para a entrada por ingestão ("a
vaga nova SHALL entrar no fim da coluna"), e evita introduzir ordenação intra-coluna — que está fora de
escopo e que tornaria o estado do cliente a fonte da verdade da ordem.

**Empate é inofensivo**: dois movimentos simultâneos podem gravar o mesmo `ordem`, e `listarVagas` desempata
por `created_at`. Enviar `ordem` explicitamente — em vez de omitir e deixar a posição antiga — é obrigatório:
omitir preservaria a posição de origem, e o card colidiria com outro da mesma coluna.

### D3 — Toda a lógica de decisão em módulo puro, em `.ts`

`src/quadro/colunas.ts` exporta `COLUNAS` (os cinco status com rótulo pt-BR), `agruparPorColuna(vagas)` e
`ordemDeDestino(vagas, destino)`. Nenhuma delas conhece React, `next/` ou o banco. Essa é a resposta direta à
restrição do `vitest.config.ts` described em Context: o que dá para testar é o que não mora em hook.

Os componentes ficam em `src/quadro/` e apenas consomem essas funções.

### D4 — Carga do quadro em módulo de servidor separado, com dependências injetadas

`src/quadro/carregarQuadro.ts` monta as colunas chamando `VagaService.listarVagas` pelo cliente do usuário,
através do `dependencias()` já existente na Fase 3 (D10 lá). A página não fala com o serviço diretamente: o
ponto de injeção é o mesmo que os testes de action já usam, então nenhum teste novo precisa de rede.

Falha na leitura não propaga exceção para a renderização: o módulo registra o erro no servidor e devolve o
quadro vazio com um aviso. Uma tela quebrada seria pior que um quadro honesto, e a exceção já foi logada
pelo `VagaService` com operação e código.

### D5 — `removerVaga` espelha `atualizarStatus` campo a campo

Mesma ordem de barreiras: validar entrada → resolver sessão com `getUser()` → gravar pelo serviço do
usuário. `false` do serviço vira o **mesmo** `{ ok: false, code: 'erro', mensagem: 'Vaga não encontrada.' }`
que `atualizarStatus` já devolve, e o schema de entrada é `.strict()`, de modo que um `user_id` forjado no
payload é falha de validação e não campo ignorado.

Diferença em relação a `atualizarStatus`: **remover revalida `/`**. A movimentação é otimista e a remoção
não tem por que ser — o card desaparece por conta própria, a revalidação custa uma leitura, e sem ela um
recarregamento mostraria de novo o que o usuário acabou de apagar.

### D6 — Confirmação de remoção com `confirm()` do navegador

O botão de remover chama `confirm()` antes de disparar a action. Cancelar não envia nada.

A alternativa considerada era um estado de confirmação dentro do próprio card ("Remover esta vaga? [Remover]
[Cancelar]"), que é mais acessível e mais bonito, e custa um pouco mais de markup e um estado a mais no
cliente. Foi deixada para quando houver tela de detalhe: hoje o botão de remover só convive com o seletor de
movimento, e o `confirm()` dá o mesmo resultado com zero estado. O texto do botão é visível e nomeia a ação,
o que cobre a parte de acessibilidade que importa aqui.

### D7 — Estado otimista no movimento, com reversão

Ao escolher um destino o card sai da coluna de origem imediatamente e entra no fim da de destino; a chamada
fica pendente. Se a action responder com falha, o card volta à coluna de origem e a mensagem da action
aparece.

O risco é a tela divergir do banco durante a pendência. É exatamente a troca que a Fase 3 já aceitou ao
decidir que `atualizarStatus` não revalida (D8 lá), e a reversão é o que impede que a divergência vire
permanente. Enquanto a chamada está em curso o `<select>` fica desabilitado, para não permitir um segundo
movimento concorrente sobre a mesma vaga.

### D8 — O quadro não instala `@dnd-kit`, e o `project.md` é corrigido

O `project.md` lista `@dnd-kit` na stack. Deixar isso ali durante a fase em que a dependência não existe é
a forma mais barata de o próximo leitor planejar em cima de uma decisão que ainda não foi tomada. A
correção acontece como task de documentation, o que não é código.

### D9 — O formulário fala por `code`, e a decisão é uma função pura

O formulário reage ao **código** de erro, nunca à mensagem. `src/app/actions/erros.ts` já diz que é assim que
a interface deve decidir, e a razão é que a apresentação correta depende da *origem* da falha: duplicidade e
limite de uso são avisos — a vaga não entrou, mas nada quebrou —, extração falhou é o único caso em que há o
que oferecer de fato, que é o campo de texto colado, e sessão expirada manda para o login.

Essa decisão é uma **função pura** (`visaoDoFormulario`), em `src/quadro/formulario.ts`, e não um `if`
dentro do componente. Pelo mesmo motivo de D3: o ambiente de testes não alcança `.tsx`, e "falha de extração
revela o campo de texto" é exatamente o tipo de regra que precisa de asserção.

O envio usa `useActionState` sobre um wrapper de `adicionarVaga` exportado pelo próprio módulo `'use server'`.
O wrapper existe porque o `useActionState` do React chama a ação como `(estadoAnterior, formData)`, e
`adicionarVaga` recebe só o `FormData` — sem ele, a action receberia o estado anterior no lugar do formulário e
validaria um `FormData` contra um objeto. Um wrapper exportado de `'use server'` continua sendo uma Server
Action de verdade, então a extração continua rodando no servidor.

O campo de URL e o botão funcionam sem JavaScript, porque o formulário é um `<form action>` de verdade. O que
depende de JavaScript é a revelação do campo de texto colado, o estado otimista do movimento e a remoção — a
mesma fronteira de D7, agora em três controles em vez de dois.

### D10 — O card é uma projeção, e a projeção é o que não vaza para o navegador

Os cards são Client Components, e um Client Component recebe seus dados pelo payload de RSC — que é HTML. Passar
a `VagaRow` inteira ao quadro colocaria o `user_id` da conta no HTML de `/`, o que a spec proíbe de forma
explícita e o que a task 4.4 manda verificar com `grep`.

Por isso existe `paraCartoes()`, uma projeção pura que entrega ao card só o que ele desenha: `id`, `titulo`,
`empresa`, `senioridade`, `url`, `status`, `ordem`, `created_at` e a contagem de requisitos. **Ficam de fora
`user_id` e `url_normalizada`**. O `id` continua porque é o que identifica a linha nas actions; o `created_at`
continua porque é o desempate de ordem. Nenhum dos dois é dado de conta, e o teste de `paraCartoes` verifica a
ausência dos dois por nome — uma asserção que quebra se alguém acrescentar um campo à projeção.

## Risks / Trade-offs

- **Sem JavaScript, mover e remover não funcionam.** O quadro aparece completo e legível (renderizado no
  servidor), mas os controles são inertes → aceito como limitação conhecida do MVP e registrado na spec;
  quando houver tela de detalhe, a evolução natural é `<form>` + botão de envio, que funciona sem JS.
- **Empate de `ordem` em movimentos simultâneos** → inofensivo, `listarVagas` desempata por `created_at`.
  Sem transação de reordenação porque não há reordenação.
- **Estado otimista divergindo se o usuário fechar a aba antes da resposta** → a próxima carga da página lê do
  banco e desfaz qualquer divergência; nenhum dado é perdido, no máximo um movimento não é refletido.
- **Testes de interface cobrem a renderização estática, não a interação** → o ambiente é `node` sem jsdom,
  então renderizar é possível (`renderToStaticMarkup` a partir de um `.ts`, importando o `.tsx` — o glob do
  vitest limita quais arquivos são *coletados*, não o que pode ser *importado*) mas clicar, responder ao
  `confirm()` e observar a transição não são. Mitigação: o HTML entregue é asserido em `tests/quadro/
  render.test.ts` (colunas, contagens, card, link, rótulos, ausência de `user_id`), e o comportamento da
  otimista é asserido nas funções puras de `estado.test.ts`. **Correção**: este risco foi escrito como
  "não cobrem renderização" e estava errado pela metade — havia menos cobertura do que se supunha, mas
  havia mais do que se afirmava.
- **`confirm()` é bloqueante e feio** → aceito no MVP por ser sem estado; a alternativa está descrita em D6.
- **Remoção é destrutiva e sem "lixeira"** → a exclusão é definitiva e o banco não tem Papelão. A mitigação
  é a confirmação explícita, e não uma escolha de arquitetura.
- **A URL da vaga é a única saída do quadro** → sem tela de detalhe, o card é a única forma de voltar ao
  anúncio. Aceito, já que a tela de detalhe está fora de escopo por decisão do usuário.

## Migration Plan

Não há migração. Nenhuma mudança de schema, nenhuma mudança de API pública, nenhuma mudança de
configuração. O deploy é o do app Next.js.

**Rollback**: reverter o commit. Nenhum dado é destruído no caminho, porque a única escrita nova é a remoção
de vaga — que o usuário dispara explicitamente.

**Ordem de implantação**: `removerVaga` antes do botão que a chama, e o wrapper de `adicionarVaga` antes do
formulário. Como todas estão na mesma change e cada controle só existe depois da sua action, não há janela em
que a interface invoque algo inexistente.

## Open Questions

Nenhuma. As decisões que dependeriam da pessoa usuária foram resolvidas antes de escrever este documento: o
seletor em vez de drag-and-drop, o `confirm()` em vez de confirmação no card, e o formulário de URL como o
meio de cadastrar vaga — este último confirmado depois de o plano inicial tê-lo esquecido.
