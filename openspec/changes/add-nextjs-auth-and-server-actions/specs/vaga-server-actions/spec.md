# Spec Delta

## Purpose

Definir as Server Actions que a interface usará para criar vagas e mover cards no quadro Kanban: validação da
entrada no servidor, encaminhamento para a Edge Function de ingestão com a sessão do usuário e tradução das
falhas da Edge Function em mensagens compreensíveis em pt-BR, sem vazar detalhes internos.

## ADDED Requirements

### Requirement: Validação de entrada no servidor

Toda Server Action SHALL validar a entrada com schema Zod antes de qualquer efeito colateral, e SHALL resolver o
usuário chamando `getUser()` no servidor. Nenhuma Server Action SHALL aceitar `user_id` da entrada, e nenhuma
SHALL usar a service role key para ler ou gravar dados em nome do usuário.

#### Scenario: Entrada inválida é rejeitada antes de chamar a Edge Function

- **GIVEN** uma URL com esquema `http://` ou uma string vazia
- **WHEN** a Server Action é chamada
- **THEN** a validação SHALL falhar, nenhuma chamada à Edge Function SHALL ocorrer e o retorno SHALL ser um erro
  amigável em pt-BR

#### Scenario: Usuário ausente não executa a ação

- **GIVEN** uma chamada de Server Action sem sessão válida
- **WHEN** a ação é executada
- **THEN** a ação SHALL abortar sem gravar nada e SHALL retornar erro de sessão expirada

### Requirement: Criação de vaga por encaminhamento à Edge Function

A Server Action `adicionarVaga(formData)` SHALL ler a URL do `FormData`, validar com o schema de domínio e,
quando informado, o texto colado como fallback dentro do limite de tamanho. A ação SHALL chamar a Edge Function
`ingest-vaga` encaminhando o token de sessão do usuário autenticado e SHALL NOT reimplementar scraping ou
chamada ao LLM. Em caso de sucesso, a ação SHALL executar revalidação do caminho `/` para que o quadro reflita
a nova vaga.

#### Scenario: Criação bem-sucedida retorna a vaga e revalida

- **GIVEN** uma URL válida e um usuário autenticado
- **WHEN** a Edge Function responde `201` com a vaga
- **THEN** a ação SHALL retornar a vaga criada, em conformidade com o schema do domínio, e SHALL revalidar `/`

#### Scenario: Texto de fallback é encaminhado

- **GIVEN** uma URL válida acompanhada do texto colado da vaga dentro do limite
- **WHEN** a ação é executada
- **THEN** o texto SHALL ser encaminhado para a Edge Function junto com a URL, sem ser processado no Next.js

### Requirement: Mapeamento de erros da ingestão

A Server Action SHALL traduzir as respostas de erro da Edge Function em mensagens pt-BR estáveis: duplicidade
(409) como aviso de vaga já cadastrada; falha de extração (422) como convite a colar o texto da vaga;
limite de uso (429) como aviso de uso intenso; sessão expirada ou sem permissão (401/403) como pedido de novo
login; timeout ou falha inesperada como erro genérico com sugestão de tentar de novo. A mensagem retornada
SHALL NOT conter stack trace, SQL, resposta do LLM ou conteúdo interno.

#### Scenario: 409 vira aviso de duplicidade

- **GIVEN** uma resposta `409` da Edge Function
- **WHEN** a Server Action mapeia o erro
- **THEN** o retorno SHALL informar em pt-BR que a vaga já foi cadastrada, sem detalhe técnico

#### Scenario: 422 oferece o fallback de texto

- **GIVEN** uma resposta `422` da Edge Function
- **WHEN** a Server Action mapeia o erro
- **THEN** o retorno SHALL informar que não foi possível extrair os dados e SHALL indicar que o usuário pode
  colar o texto da vaga

#### Scenario: 429 avisa sobre limite de uso

- **GIVEN** uma resposta `429` da Edge Function
- **WHEN** a Server Action mapeia o erro
- **THEN** o retorno SHALL informar que o limite de ingestões foi atingido e que deve tentar mais tarde

#### Scenario: 401 e 403 viram pedido de novo login

- **GIVEN** respostas `401` ou `403` da Edge Function
- **WHEN** a Server Action mapeia o erro
- **THEN** o retorno SHALL informar que a sessão expirou ou que o usuário não tem permissão

#### Scenario: Timeout ou erro genérico vira mensagem neutra

- **GIVEN** uma falha de rede, um timeout ou uma resposta inesperada da Edge Function
- **WHEN** a Server Action mapeia o erro
- **THEN** o retorno SHALL ser uma mensagem genérica em pt-BR com sugestão de tentar novamente, sem expor
  stack trace, status interno ou resposta do LLM

### Requirement: Movimentação de status validada e sem vazamento de existência

A Server Action `atualizarStatus({ vagaId, novoStatus, ordem })` SHALL validar `vagaId` como UUID, `novoStatus`
pertencente ao enum de status do domínio e `ordem` como número opcional, e SHALL persistir a alteração pelo
serviço de vagas usando o cliente do usuário autenticado. Quando a operação não afetar nenhuma linha, a ação
SHALL retornar um erro genérico informando que a vaga não foi encontrada, sem distinguir entre identificador
inexistente e identificador pertencente a outro usuário.

#### Scenario: Movimentação válida é persistida

- **GIVEN** uma vaga pertencente ao usuário autenticado
- **WHEN** a ação é chamada com `vagaId` válido, `novoStatus` do enum e `ordem` numérica
- **THEN** o status e a ordem SHALL ser persistidos e a ação SHALL indicar sucesso

#### Scenario: `novoStatus` fora do enum é rejeitado

- **GIVEN** um payload com `novoStatus` igual a `foo`
- **WHEN** a Server Action é chamada
- **THEN** a validação SHALL falhar, nenhuma gravação SHALL ocorrer e o retorno SHALL ser um erro amigável

#### Scenario: `vagaId` inválido é rejeitado

- **GIVEN** um payload com `vagaId` que não é UUID
- **WHEN** a Server Action é chamada
- **THEN** a validação SHALL falhar e nenhuma gravação SHALL ocorrer

#### Scenario: Vaga de outro usuário não é alterada

- **GIVEN** um `vagaId` que pertence a outra conta
- **WHEN** a Server Action é chamada
- **THEN** nenhuma linha SHALL ser alterada e o retorno SHALL ser um erro genérico informando que a vaga não foi
  encontrada, sem confirmar que o identificador existe

#### Scenario: Ordem ausente mantém a posição

- **GIVEN** uma chamada sem o campo `ordem`
- **WHEN** a ação é executada
- **THEN** apenas o status SHALL ser alterado

### Requirement: Nenhum segredo exposto ao cliente

As Server Actions e a camada de sessão SHALL ler credenciais exclusivamente do ambiente do servidor. Nenhum
segredo, chave de API ou valor de `NEXT_PUBLIC_*` sensível SHALL ser devolvido ao navegador, e os retornos das
ações SHALL conter apenas dados já validados pelos schemas de domínio.

#### Scenario: Retorno da ação contém apenas dados de domínio

- **GIVEN** uma Server Action que conclui com sucesso
- **WHEN** o retorno é serializado para o cliente
- **THEN** o payload SHALL conter apenas os campos da vaga conforme o schema do domínio, sem credenciais ou
  cabeçalhos de autorização
