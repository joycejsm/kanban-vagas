# Quadro Kanban Specification

## Purpose

Descrever a interface do quadro Kanban: como as vagas do usuário autenticado são carregadas e agrupadas nas
cinco colunas do enum de status, o que cada card mostra, como a movimentação entre colunas é disparada e
confirmada pelo usuário, e como a remoção é oferecida. Esta capability cobre a apresentação e a interação do
quadro; a persistência das vagas e o contrato das Server Actions que ele consome vivem em
`vaga-persistence` e `vaga-server-actions`.

## Requirements

### Requirement: Cadastro de vaga pela URL

A rota `/` SHALL oferecer um formulário com um campo para a URL da vaga e um botão de cadastro. O envio
SHALL criar a vaga pelo caminho de extração já existente no servidor, e o quadro SHALL passar a exibir a vaga
resultante sem que a pessoa recarregue a página. A mensagem exibida após cada envio SHALL ser derivada do
**código** de erro devolvido pelo servidor e não do texto da mensagem, e o formulário SHALL oferecer desde o
início uma opção para colar o texto completo do anúncio. O formulário SHALL tentar ler o texto da área de
transferência após ação explícita da pessoa usuária e SHALL manter um campo para colagem manual quando essa
leitura não estiver disponível. O campo de texto SHALL ser reencaminhado ao servidor junto com a URL quando
preenchido, sem buscar a página da URL. Nenhum segredo SHALL ser exibido no formulário ou em suas mensagens.

#### Scenario: URL válida cria o card no quadro

- **GIVEN** um usuário autenticado e uma URL `https` válida no formulário
- **WHEN** o envio é confirmado e a criação é bem-sucedida
- **THEN** a vaga SHALL aparecer no quadro, na coluna de status em que o servidor a persistiu, e o campo de URL
  SHALL estar limpo para o próximo cadastro

#### Scenario: Texto da vaga pode ser colado antes da extração por URL

- **GIVEN** uma URL válida e o texto do anúncio copiado ou disponível para colagem manual
- **WHEN** a pessoa usuária aciona a opção de colar texto
- **THEN** o formulário SHALL disponibilizar o campo de texto e SHALL tentar preenchê-lo pela área de
  transferência, sem impedir a colagem manual se o navegador negar acesso

#### Scenario: Texto colado é usado sem acessar a página do anúncio

- **GIVEN** uma URL válida e o campo de texto preenchido
- **WHEN** o formulário é enviado
- **THEN** o texto e a URL SHALL ser enviados juntos ao servidor, e a extração SHALL usar o texto sem validar
  o DNS nem buscar a página da URL

#### Scenario: Vaga já cadastrada vira aviso, não erro

- **GIVEN** uma URL que já está cadastrada para o usuário
- **WHEN** o envio é confirmado
- **THEN** o formulário SHALL informar em pt-BR que a vaga já foi cadastrada, e a apresentação SHALL ser de
  aviso e não de falha

#### Scenario: Limite de uso vira aviso

- **GIVEN** um envio cujo resultado é limite de uso
- **WHEN** a tela é atualizada com o resultado
- **THEN** o formulário SHALL informar que o limite foi atingido e que vale tentar mais tarde

#### Scenario: Sessão expirada pede novo login

- **GIVEN** um envio cujo resultado é sessão expirada
- **WHEN** a tela é atualizada com o resultado
- **THEN** o formulário SHALL informar que a sessão expirou e que é preciso entrar novamente

#### Scenario: URL recusada pelo servidor não cria nada

- **GIVEN** uma URL que não usa `https`, ou um campo vazio
- **WHEN** o envio é confirmado
- **THEN** o servidor SHALL recusar a entrada, nenhuma vaga SHALL ser criada e o formulário SHALL exibir a
  mensagem de entrada inválida

#### Scenario: Envio em andamento não pode ser repetido

- **GIVEN** um envio em curso
- **WHEN** a pessoa tenta confirmar novamente
- **THEN** o botão de envio SHALL estar desabilitado e nenhum segundo envio SHALL ser disparado

#### Scenario: Mensagens do formulário não carregam detalhe interno

- **GIVEN** qualquer resultado de envio
- **WHEN** a mensagem é exibida
- **THEN** ela SHALL NOT conter stack trace, SQL, resposta do modelo de extração, chave de API nem
  identificador de usuário

### Requirement: Quadro exibe apenas as vagas do usuário autenticado

A rota `/` SHALL renderizar o quadro Kanban a partir das vagas pertencentes ao usuário da sessão, obtidas no
servidor com o cliente que carrega o JWT da requisição. O quadro SHALL NOT exibir, em nenhum elemento
visível ou em atributo, identificador de usuário, total global de vagas ou qualquer outra informação de conta.
A renderização do conteúdo do quadro SHALL NOT depender de JavaScript no cliente.

#### Scenario: Usuário autenticado vê suas vagas nas colunas correspondentes

- **GIVEN** um usuário autenticado com vagas em `aplicado`, `entrevista_1` e `proposta`
- **WHEN** a rota `/` é renderizada
- **THEN** cada vaga SHALL aparecer no card da coluna igual ao seu `status`, e nenhuma vaga de outra conta
  SHALL estar presente em qualquer coluna

#### Scenario: Conteúdo do quadro é entregue sem JavaScript

- **GIVEN** um navegador com JavaScript desabilitado
- **WHEN** a rota `/` é carregada
- **THEN** as colunas, os cards e o texto das vagas SHALL estar presentes no HTML entregue pelo servidor

#### Scenario: Nenhum identificador de usuário é exposto na página

- **GIVEN** o quadro renderizado para um usuário autenticado
- **WHEN** o HTML entregue é inspecionado
- **THEN** ele SHALL NOT conter o `user_id` do usuário nem o de qualquer outra conta, em texto, atributo ou
  dado embutido

### Requirement: Colunas do quadro e agrupamento

O quadro SHALL apresentar exatamente cinco colunas, uma para cada valor do enum de status de vaga, na ordem do
ciclo de vida: aplicado, entrevista_1, fase_tecnica, proposta e rejeitado. Cada coluna SHALL exibir um rótulo
em pt-BR e a contagem de vagas que contém. Coluna sem vaga SHALL continuar sendo renderizada, com contagem
zero e sem estado de erro. Dentro de cada coluna os cards SHALL preservar a ordem definida pela leitura das
vagas.

#### Scenario: Colunas sem vaga são renderizadas

- **GIVEN** um usuário autenticado sem nenhuma vaga
- **WHEN** a rota `/` é renderizada
- **THEN** as cinco colunas SHALL estar presentes, cada uma exibindo contagem `0`, e nenhuma mensagem de
  falha ou de vazio de dados SHALL aparecer no lugar do quadro

#### Scenario: Colunas seguem a ordem do ciclo de vida

- **GIVEN** um usuário autenticado com vagas em todas as colunas
- **WHEN** a rota `/` é renderizada
- **THEN** as colunas SHALL aparecer na ordem aplicado, entrevista_1, fase_tecnica, proposta e rejeitado

#### Scenario: Contagem reflete as vagas da coluna

- **GIVEN** um usuário autenticado com três vagas em `aplicado` e nenhuma em `fase_tecnica`
- **WHEN** a rota `/` é renderizada
- **THEN** a coluna `aplicado` SHALL exibir contagem `3` e a coluna `fase_tecnica` SHALL exibir contagem `0`

#### Scenario: Estado vazio convida a cadastrar a primeira vaga

- **GIVEN** um usuário autenticado sem nenhuma vaga
- **WHEN** a rota `/` é renderizada
- **THEN** o quadro SHALL apresentar, além das colunas, um convite em pt-BR a cadastrar a primeira vaga, e o
  convite SHALL apontar para o formulário de URL da própria página, que permanece disponível na tela

### Requirement: Conteúdo do card

Cada card SHALL exibir o título, a empresa, a senioridade, a data formatada de cadastro da vaga e tags de
requisitos extraídos (até 2 tags + contador excedente no desktop e contagem compacta no mobile), e SHALL oferecer
um link para o anúncio de origem. O link SHALL usar a URL informada pelo usuário no cadastro, SHALL abrir em nova
aba e SHALL ser acionado apenas por gesto explícito da pessoa usuária. O card SHALL NOT conter notas, campo de
edição nem link para uma página separada de detalhe. Textos vindos de extração automática SHALL ser exibidos como texto
simples e nunca interpretados como marcação.

#### Scenario: Card mostra os dados da vaga e o link de origem

- **GIVEN** uma vaga cadastrada pela URL `https://exemplo.com/vaga/7`
- **WHEN** o card dessa vaga é renderizado
- **THEN** ele SHALL exibir o título, a empresa, a senioridade e a data formatada de cadastro, e o link SHALL apontar para
  `https://exemplo.com/vaga/7`, abrindo em nova aba

#### Scenario: Card exibe tags de requisitos com limite visual

- **GIVEN** uma vaga com múltiplos requisitos extraídos
- **WHEN** o card é renderizado em desktop
- **THEN** ele SHALL exibir até 2 tags de requisitos e um contador de excedentes (+N)
- **AND** em telas mobile SHALL exibir a contagem compacta de requisitos

#### Scenario: Conteúdo extraído é tratado como texto

- **GIVEN** uma vaga cujo título, empresa ou requisito contenha tag HTML, aspas angulares ou script
- **WHEN** o card é renderizado
- **THEN** o texto SHALL aparecer literalmente na tela e nenhum elemento HTML correspondente ao conteúdo
  extraído SHALL ser interpretado

#### Scenario: Card não abre página separada de detalhe

- **GIVEN** um quadro renderizado
- **WHEN** o card de uma vaga é inspecionado
- **THEN** ele SHALL NOT conter campo de notas, controle de edição nem link (`<a>`) para uma página externa ou rota `/vaga/` desta
  vaga

### Requirement: Navegação por abas em telas mobile

Em viewports estreitos (`< md`), o quadro SHALL substituir o empilhamento vertical das cinco colunas por
uma barra de abas no topo com contadores por etapa (`[Aplicado (N) | Entrevista 1 (N) | ...]`). O quadro SHALL
exibir apenas a coluna correspondente à aba ativa no momento, reduzindo a rolagem vertical. Em telas maiores
(`md:` e superiores), a navegação por abas SHALL permanecer oculta e o grid responsivo de 3 a 5 colunas SHALL
ser exibido integralmente.

#### Scenario: Visualização mobile exibe apenas a coluna ativa

- **GIVEN** um viewport com largura inferior a 768px (`< md`)
- **WHEN** o quadro é carregado
- **THEN** uma barra de abas horizontal com os rótulos e contadores de cada status SHALL ser exibida no topo
- **AND** apenas os cards da coluna correspondente à aba selecionada SHALL ser exibidos na tela

#### Scenario: Alternância de abas troca a coluna visível

- **GIVEN** a visualização mobile ativa com a aba "Aplicado" selecionada
- **WHEN** o usuário toca na aba "Entrevista 1"
- **THEN** a aba "Entrevista 1" SHALL ser destacada como ativa e a coluna correspondente SHALL ser exibida

### Requirement: Painel de detalhes da vaga (Drawer)

Ao clicar no corpo de um card de vaga (fora dos controles interativos como link de anúncio, seletor de coluna
e botão de remoção), um painel de detalhes (Drawer) SHALL ser aberto. Em telas desktop/tablet, o painel SHALL
deslizar lateralmente à direita; em telas mobile, o painel SHALL ocupar a parte inferior como bottom sheet de
altura ampla. O Drawer SHALL exibir as informações completas da vaga, incluindo a lista numerada integral de
todos os requisitos extraídos pela LLM. Interações com link, seletor e botão de remoção no card SHALL interromper
a propagação do evento de clique (`stopPropagation`) para não disparar a abertura do Drawer acidentalmente.
O Drawer SHALL poder ser fechado por botão explícito de fechar, pela tecla Escape, pelo clique no backdrop externo
ou pelo fechamento do diálogo. O painel e o backdrop SHALL executar transição fluida de slide e fade sem conflito
de classes de translação, preservando o conteúdo visível durante a saída e restaurando a rolagem do quadro ao fechar.

#### Scenario: Clique no card abre o painel de detalhes

- **GIVEN** um card de vaga no quadro
- **WHEN** a pessoa usuária clica no corpo do card
- **THEN** o Drawer de detalhes SHALL ser exibido contendo título, empresa, senioridade, data, link completo e a lista de requisitos

#### Scenario: Controles interativos não abrem o Drawer

- **GIVEN** um card de vaga no quadro
- **WHEN** a pessoa usuária clica no link do anúncio, altera a coluna pelo seletor ou clica no botão de remover
- **THEN** a propagação do clique SHALL ser interrompida e o Drawer de detalhes SHALL NOT ser aberto

#### Scenario: Fechamento do Drawer

- **GIVEN** o Drawer de detalhes aberto
- **WHEN** a pessoa usuária clica no botão fechar, pressiona a tecla Escape ou clica no backdrop externo
- **THEN** o Drawer SHALL ser fechado com animação de saída, retornando o foco e restaurando a rolagem do quadro

#### Scenario: Transição responsiva sem colisão de posicionamento

- **GIVEN** o Drawer sendo aberto ou fechado
- **WHEN** as classes de translação são aplicadas
- **THEN** o painel SHALL deslizar a partir da borda inferior no mobile e da borda direita no desktop sem conflito de especificidade CSS e sem restrição indevida de altura máxima nativa do diálogo

### Requirement: Movimentação de card entre colunas

Cada card SHALL oferecer um controle de seleção rotulado com o destino, listando **apenas** as colunas
diferentes da coluna atual do card. Escolher um destino SHALL mover o card para a coluna escolhida e SHALL
disparar a atualização da vaga no servidor. O card movido SHALL ser reposicionado no fim da coluna de destino.
Enquanto a atualização está em curso, o controle de seleção do card SHOULD permanecer desabilitado, e a
movimentação SHALL ser refletida na tela antes da resposta do servidor.

Adicionalmente, os cards SHALL permitir movimentação direta entre as colunas através de gestos de arrastar e
soltar (drag and drop). O gesto de arraste SHALL exigir uma distância mínima de ativação (mínimo de 8px) para
impedir que cliques em links e botões sejam interpretados acidentalmente como início de arraste. Ao soltar o
card sobre uma coluna de destino válida, a vaga SHALL ser movida e o servidor SHALL ser notificado via
atualização de status com persistência de ordem. Em caso de recusa ou erro na comunicação com o servidor, o card
movido via drag and drop SHALL ser revertido imediatamente à sua posição anterior na coluna de origem.

#### Scenario: Seletor lista somente as outras colunas

- **GIVEN** um card na coluna `aplicado`
- **WHEN** a coluna de destino é aberta no seletor
- **THEN** ela SHALL listar `entrevista_1`, `fase_tecnica`, `proposta` e `rejeitado`, e SHALL NOT listar
  `aplicado` nem uma opção inativa de "movido"

#### Scenario: Escolher um destino move o card

- **GIVEN** um card na coluna `aplicado`
- **WHEN** a pessoa usuária escolhe `fase_tecnica` no seletor
- **THEN** o card SHALL passar a ser exibido na coluna `fase_tecnica` e a atualização da vaga no servidor
  SHALL ter sido disparada

#### Scenario: Card movido entra no fim da coluna de destino

- **GIVEN** a coluna `fase_tecnica` com três cards
- **WHEN** um card da coluna `aplicado` é movido para `fase_tecnica`
- **THEN** ele SHALL ser exibido após os três cards existentes, como quarto da coluna

#### Scenario: Falha na movimentação reverte o card

- **GIVEN** um card na coluna `aplicado` e uma resposta de falha do servidor ao mover
- **WHEN** a falha é recebida
- **THEN** o card SHALL retornar à coluna `aplicado` e a tela SHALL exibir a mensagem de erro devolvida pela
  operação, sem o card duplicado nas duas colunas

#### Scenario: Destino é sempre um valor do enum

- **GIVEN** um card em qualquer coluna
- **WHEN** a lista de destinos é montada ou o drop é avaliado
- **THEN** o status SHALL ser validado estritamente como um valor do enum de status de vaga, nunca aceitando
  valores arbitrários da interface

#### Scenario: Arrastar e soltar card em outra coluna atualiza a coluna do card

- **GIVEN** um card na coluna `aplicado`
- **WHEN** a pessoa usuária arrasta o card e o solta sobre a coluna `entrevista_1`
- **THEN** o card SHALL ser reposicionado imediatamente na coluna `entrevista_1` de forma otimista e a
  atualização de status com a nova ordem SHALL ser enviada ao servidor

#### Scenario: Arraste requer distância mínima para não interferir em cliques

- **GIVEN** um card no quadro contendo link externo e botões de ação
- **WHEN** a pessoa usuária clica ou pressiona com movimento inferior a 8 pixels
- **THEN** nenhum gesto de arraste SHALL ser iniciado e a ação de clique do elemento-alvo SHALL ser preservada

#### Scenario: Falha no drag-and-drop reverte o card à posição original

- **GIVEN** um card arrastado para outra coluna e uma falha retornada pelo servidor
- **WHEN** a resposta de erro é processada
- **THEN** o card SHALL retornar exatamente à sua coluna e ordem anteriores e a mensagem de erro SHALL ser
  exibida no topo do quadro

### Requirement: Remoção de vaga a partir do card

Cada card SHALL oferecer um controle para remover a vaga, e a remoção SHALL exigir uma confirmação explícita
antes de ser executada. Confirmada a remoção, o card SHALL desaparecer do quadro e a ausência da vaga SHALL
persistir após um recarregamento da página. Cancelada a confirmação, nenhuma escrita SHALL ocorrer e o card
SHALL permanecer no quadro. O botão de remoção SHALL ser identificável por nome acessível em português.

#### Scenario: Remoção só ocorre após confirmação

- **GIVEN** um card de vaga no quadro
- **WHEN** a pessoa usuária aciona o controle de remover e desiste da confirmação
- **THEN** nenhuma remoção SHALL ser enviada ao servidor e o card SHALL permanecer no quadro

#### Scenario: Remoção confirmada esvazia a vaga

- **GIVEN** um card de vaga no quadro
- **WHEN** a remoção é confirmada
- **THEN** o card SHALL desaparecer e, após recarregar a página, a vaga SHALL NOT constar do quadro

#### Scenario: Remoção reverte e informa em caso de falha

- **GIVEN** um card de vaga e uma resposta de falha do servidor ao remover
- **WHEN** a falha é recebida
- **THEN** o card SHALL permanecer no quadro e a tela SHALL exibir a mensagem de erro devolvida pela operação

### Requirement: Falhas de leitura do quadro

Falha ao obter as vagas do usuário SHALL ser registrada no servidor com detalhe operacional e SHALL NOT
interromper a renderização da rota. Nesse caso o quadro SHALL ser renderizado com as cinco colunas vazias e
SHALL exibir um aviso em pt-BR de que não foi possível carregar as vagas, sem stack trace, consulta SQL,
identificador de usuário ou qualquer detalhe interno.

#### Scenario: Falha de banco não quebra a página

- **GIVEN** um usuário autenticado e uma falha ao ler as vagas
- **WHEN** a rota `/` é renderizada
- **THEN** a resposta SHALL ter status de sucesso, o quadro SHALL exibir as cinco colunas e um aviso
  compreensível, e o corpo SHALL NOT conter stack trace, SQL ou o identificador do usuário

#### Scenario: Aviso não afirma que o usuário não tem vagas

- **GIVEN** uma falha de leitura e um usuário que de fato possui vagas
- **WHEN** a tela é exibida
- **THEN** a mensagem SHALL distinguir a falha de carga do estado de usuário sem vagas, e SHALL NOT afirmar
  que não há vagas cadastradas
