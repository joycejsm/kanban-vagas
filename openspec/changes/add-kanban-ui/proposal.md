# Proposal

## Why

As Fases 1 a 3 entregaram tudo o que existe **abaixo** da interface: domínio, persistência com RLS, ingestão
pelo LLM, autenticação com allowlist e as Server Actions `adicionarVaga` e `atualizarStatus`. Mas não existe
tela. Hoje `/` responde 200 com o texto de "aplicação inicializada", e a única forma de criar ou mover uma
vaga é chamar a Edge Function na mão. A aplicação está pronta para ser usada e ainda não é usável.

Falta também o terceiro verbo do escopo: **remover**. O `VagaService.removerVaga` existe e está testado, mas
nenhuma Server Action o expõe — ou seja, a rota de escrita existe na camada de dados e é inalcançável a
partir de uma tela.

## What Changes

- **Formulário de cadastro por URL em `/`**: campo para colar o link da vaga e um botão de cadastro. O
  envio chama a Server Action `adicionarVaga`, que já encaminha a extração para a Edge Function; o quadro
  passa a exibir a vaga criada. A mensagem após cada envio é derivada do **código** de erro devolvido pelo
  servidor, e não do texto: duplicidade e limite de uso viram aviso, e falha de extração **revela o campo de
  texto colado** como segunda tentativa, que é para isso que ele existe na action.
- **Quadro Kanban em `/`**: Server Component que carrega as vagas do usuário autenticado e renderiza as cinco
  colunas do enum de status, na ordem do ciclo de vida, com contador por coluna e colunas vazias visíveis.
- **Cards**: título, empresa, senioridade e link para o anúncio original. O link usa a `url` informada pelo
  usuário, abre em nova aba com `rel="noopener noreferrer"`, e nunca a `url_normalizada` nem qualquer valor
  derivado do LLM (invariante 6). Sem tela de detalhe, sem notas e sem edição.
- **Movimentação por seletor "mover para…"**: cada card oferece um `<select>` com as outras colunas. Escolher
  uma chama `atualizarStatus` e move o card de coluna. A atualização é otimista na interface, porque a action
  não revalida por decisão da Fase 3 (D8); a posição de destino é o fim da coluna.
- **Remoção com confirmação**: cada card oferece um botão que pede confirmação e chama a nova Server Action
  `removerVaga(vagaId)`, que revalida `/`.
- **Nova Server Action `removerVaga`**: valida o identificador, resolve a sessão com `getUser()`, remove pelo
  `VagaService` com o cliente do usuário autenticado, e devolve o mesmo erro genérico de "Vaga não encontrada"
  para identificador inexistente e para vaga de outro usuário, sem virar oráculo de enumeração (D7).
- **Estado vazio e estado de erro**: usuário sem nenhuma vaga vê um convite a cadastrar a primeira, apontando
  para o formulário; falha de leitura do banco vira um aviso na tela, nunca uma tela quebrada.

**Fora de escopo, por decisão explícita**: notas, edição de vaga, tela de detalhe, reordenação dentro da
coluna e drag-and-drop. O drag-and-drop é melhoria posterior e não exige mudança em banco, spec de
persistência nem Server Actions — ver o design.

## Capabilities

### New Capabilities

- `kanban-board`: a interface do quadro — formulário de cadastro por URL e suas respostas, carga das vagas do
  usuário, agrupamento nas cinco colunas do enum, renderização dos cards, coluna vazia com contador, seletor de
  movimentação entre colunas com estado otimista, remoção com confirmação, e as garantias de que nada de outra
  conta é revelado.

### Modified Capabilities

- `vaga-server-actions`: novo requisito para a Server Action `removerVaga` — validação de entrada, resolução
  de sessão no servidor, gravação pelo cliente do usuário e resposta indistinguível entre identificador
  inexistente e identificador alheio. Os requisitos existentes de `adicionarVaga` e `atualizarStatus` **não
  mudam**.

## Impact

- **Código alterado**: `src/app/page.tsx` (hoje é o texto de scaffold do projeto).
- **Código novo**: `src/quadro/` (colunas e carga do quadro, em módulos puros e testáveis, e a projeção do
  card), componentes de card, de coluna e o formulário de cadastro, e a Server Action `removerVaga` em
  `src/app/actions/vagas.ts`.
- **Código de teste**: `tests/quadro/` para a lógica pura de agrupamento e destino, e extensão de
  `tests/app/vagas.test.ts` para os cenários de segurança da remoção.
- **Dependências**: nenhuma nova. O `@dnd-kit` citado no `project.md` **não** é instalado nesta fase.
- **Banco**: nenhuma migração. Tabela, RLS, `ordem` e índice `(user_id, status, ordem)` já existem e já
  foram verificados contra o projeto linkado (44 asserções pgTAP verdes).
- **Invariantes**: o quadro renderiza exclusivamente vagas do JWT da requisição; nenhum `user_id` é aceito da
  interface; nenhuma URL vinda de extração vira `href`.
