# ingest-vaga Specification

## Purpose

Definir o contrato HTTP da Edge Function `ingest-vaga`: o que ela aceita na requisição, o que devolve em caso
de sucesso, quais condições recusam a chamada antes de qualquer trabalho de extração (origem não permitida,
sessão inválida, e-mail fora da allowlist, limite de uso excedido) e como cada falha é comunicada sem vazar
detalhe interno.

## Requirements

### Requirement: Contrato de entrada da ingestão

A função SHALL aceitar requisições `POST` cujo corpo seja validado por um schema Zod estrito, rejeitando
campos não previstos. O corpo SHALL conter obrigatoriamente `url` e, opcionalmente, `texto` — este último com
no máximo 30.000 caracteres, para o usuário colar o conteúdo quando o scraping não funciona. A função SHALL NOT
aceitar `user_id`, `status`, `ordem` ou qualquer outro campo de servidor.

#### Scenario: Corpo com url apenas é aceito

- **GIVEN** um corpo `POST` com `{"url": "https://empresa.com/vaga/1"}`
- **WHEN** a função valida o corpo
- **THEN** a validação SHALL passar e a extração SHALL ser executada por scraping

#### Scenario: Corpo com url e texto é aceito

- **GIVEN** um corpo `POST` com `{"url": "https://empresa.com/vaga/1", "texto": "Vaga de ..."}` com o texto
  dentro do limite
- **WHEN** a função valida o corpo
- **THEN** a validação SHALL passar e o texto SHALL ser usado como fonte, sem acesso à página

#### Scenario: Texto acima do limite é rejeitado

- **GIVEN** um corpo com `texto` de 30.001 caracteres
- **WHEN** a função valida o corpo
- **THEN** a validação SHALL falhar e a resposta SHALL ser `422` com mensagem genérica em pt-BR

#### Scenario: Campo não previsto é rejeitado

- **GIVEN** um corpo `POST` com `{"url": "...", "user_id": "..."}` ou com uma chave desconhecida
- **WHEN** a função valida o corpo
- **THEN** a validação SHALL falhar e a resposta SHALL ser `422`, sem executar nenhuma requisição de rede

#### Scenario: Método diferente de POST é recusado

- **GIVEN** uma requisição `GET`, `PUT` ou `DELETE` na rota da função
- **WHEN** a função é invocada
- **THEN** a resposta SHALL indicar método não permitido e nenhum trabalho SHALL ser executado

### Requirement: CORS restrito à origem da aplicação

A função SHALL aceitar requisições cujo cabeçalho `Origin`, quando presente, seja exatamente igual a
`APP_ORIGIN`, e SHALL responder a preflight `OPTIONS` com os cabeçalhos CORS correspondentes. Requisições com
origem presente e diferente de `APP_ORIGIN` SHALL ser recusadas sem executar o pipeline. Requisição **sem**
cabeçalho `Origin` SHALL ser tratada como chamada de cliente não-navegador e aceita, por não haver origem a
conferir: nenhum navegador deixa de enviar `Origin` em requisição cross-origin, de modo que a ausência do
cabeçalho não pode ser produzida por uma página alheia, e a conferência estrita continua valendo exatamente
para o caminho do navegador, que é o que ela protege.

O requisito de autenticação permanece independente desta etapa: uma requisição sem `Origin` aceita pela
origem SHALL ainda ser recusada com `401` se não tiver sessão válida, e com `403` se o e-mail não estiver na
allowlist.

#### Scenario: Preflight da origem da aplicação é atendido

- **GIVEN** uma requisição `OPTIONS` com `Origin` igual a `APP_ORIGIN`
- **WHEN** a função é invocada
- **THEN** a resposta SHALL incluir o cabeçalho `Access-Control-Allow-Origin` com esse valor e o método `POST`

#### Scenario: Origem desconhecida é recusada

- **GIVEN** uma requisição com `Origin` fora de `APP_ORIGIN`
- **WHEN** a função é invocada
- **THEN** a função SHALL recusar a chamada sem executar extração nem gravar dados

#### Scenario: Requisição sem Origin é aceita como cliente não-navegador

- **GIVEN** uma requisição `POST` sem cabeçalho `Origin`, com token de sessão válido e e-mail na allowlist
- **WHEN** a função é invocada
- **THEN** a conferência de origem SHALL passar e o pipeline SHALL prosseguir até a extração

#### Scenario: Ausência de Origin não dispensa autenticação

- **GIVEN** uma requisição `POST` sem cabeçalho `Origin` e sem token de sessão válido
- **WHEN** a função é invocada
- **THEN** a resposta SHALL ser `401` e nenhuma extração SHALL ser executada

#### Scenario: Navegador com origem errada continua barrado

- **GIVEN** uma requisição `POST` originada de um navegador em domínio distinto de `APP_ORIGIN`, com token
  válido
- **WHEN** a função é invocada
- **THEN** a resposta SHALL ser `403` de origem não permitida, sem executar extração nem gravar dados

### Requirement: Autenticação e allowlist de e-mail

A função SHALL exigir um token de sessão válido, validando o usuário com o token recebido, e SHALL recusar
chamadas sem sessão com `401`. Quando o e-mail do usuário não estiver na allowlist `ALLOWED_EMAILS`, a função
SHALL encerrar o acesso e responder `403`. Nenhuma das duas verificações pode ser contornada por parâmetro
do corpo ou da query string.

#### Scenario: Sem Authorization é recusado

- **GIVEN** uma requisição sem cabeçalho `Authorization` ou com token inválido
- **WHEN** a função é invocada
- **THEN** a resposta SHALL ser `401` e nenhuma extração SHALL ser executada

#### Scenario: E-mail fora da allowlist é recusado

- **GIVEN** um usuário autenticado cujo e-mail não está em `ALLOWED_EMAILS`
- **WHEN** ele chama a função
- **THEN** a resposta SHALL ser `403` com mensagem genérica em pt-BR

#### Scenario: E-mail autorizado tem a chamada aceita

- **GIVEN** um usuário autenticado cujo e-mail está em `ALLOWED_EMAILS`
- **WHEN** ele chama a função com uma URL válida
- **THEN** a validação de acesso SHALL passar e o pipeline SHALL prosseguir

### Requirement: Limite de uso por usuário

O sistema SHALL aplicar no máximo 20 ingestões por hora e 100 por dia, por usuário. Cada tentativa aceita
deverá ser registrada em uma tabela de auditoria protegida por RLS, **antes** de qualquer trabalho caro, e a
contagem da janela SHALL incluir o próprio registro corrente. Ao exceder o limite, a função SHALL responder
`429` antes de qualquer requisição de rede.

Toda tentativa registrada SHALL terminar com o desfecho gravado. Isso inclui a falha no caminho da própria
auditoria: se a contagem da janela falhar **depois** do registro, a linha existente SHALL ser fechada como
`erro` antes de a resposta ser enviada, e a etapa da falha SHALL constar no log.

#### Scenario: Ingestão dentro do limite é aceita

- **GIVEN** um usuário com 19 ingestões na hora corrente
- **WHEN** ele faz uma nova chamada
- **THEN** a chamada SHALL ser processada normalmente

#### Scenario: Limite horário excedido

- **GIVEN** um usuário que já fez 20 ingestões na hora corrente
- **WHEN** ele faz uma nova chamada
- **THEN** a resposta SHALL ser `429` com mensagem em pt-BR e nenhuma requisição externa SHALL ser feita

#### Scenario: Limite diário excedido

- **GIVEN** um usuário que já fez 100 ingestões no dia corrente, mesmo com menos de 20 na hora
- **WHEN** ele faz uma nova chamada
- **THEN** a resposta SHALL ser `429`

#### Scenario: A auditoria fica isolada por usuário

- **GIVEN** dois usuários autenticados com registros de auditoria
- **QUANDO** um deles consulta a tabela de auditoria
- **ENTÃO** o resultado SHALL conter apenas os próprios registros, e o cliente anônimo não SHALL obter acesso

#### Scenario: Nenhuma tentativa fica com o desfecho pendente

- **GIVEN** uma tentativa registrada cuja contagem de janela falha
- **WHEN** a função responde
- **THEN** o registro da tentativa SHALL estar com resultado diferente de `pendente`, e o log SHALL nomear a
  etapa da auditoria

#### Scenario: Falha no registro não tenta fechar linha que não existe

- **GIVEN** uma falha ao registrar a tentativa
- **WHEN** a função responde
- **THEN** nenhuma gravação de desfecho SHALL ser tentada e a resposta SHALL ser genérica, sem detalhe do banco

### Requirement: Resposta de sucesso e de erro

Em caso de sucesso, a função SHALL responder `201` com o corpo `{"vaga": <VagaRow>}`, onde o registro
corresponde ao schema de leitura do domínio e foi persistido sob o usuário da sessão. Em caso de falha, a
função SHALL responder com `{"code": ..., "message": ...}`, onde `message` é uma mensagem genérica em pt-BR e
`code` identifica a categoria do erro para o cliente agir.

#### Scenario: Sucesso devolve a vaga criada

- **GIVEN** uma chamada autenticada e autorizada, com URL acessível e dados extraídos válidos
- **WHEN** a extração e a persistência concluem
- **THEN** a resposta SHALL ser `201` e o corpo SHALL conter a vaga, com `status` `aplicado` e `user_id`
  igual ao da sessão

#### Scenario: Falha devolve código e mensagem genérica

- **GIVEN** qualquer condição de falha do pipeline
- **WHEN** a função responde com erro
- **THEN** o corpo SHALL conter `code` e `message` em pt-BR e SHALL NOT conter stack trace, consulta SQL,
  saída bruta do modelo ou trecho do conteúdo raspado

#### Scenario: Vaga já cadastrada responde conflito

- **GIVEN** um usuário que já cadastrou a mesma URL, em qualquer variação equivalente
- **WHEN** ele chama a função com essa URL
- **THEN** a resposta SHALL ser `409` informando que a vaga já está cadastrada

#### Scenario: Extração sem dados suficientes responde erro de extração

- **GIVEN** uma página acessível cujo conteúdo não produz título, empresa ou requisitos utilizáveis
- **WHEN** a extração é validada
- **THEN** a resposta SHALL ser `422`, sem repassar ao cliente a saída bruta do modelo, e o cliente SHALL ser
  convidado a colar o texto da vaga

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

Na conversão de HTML para texto, elementos de cabeçalho (`h1` a `h6`) e blocos estruturais SHALL receber
quebras de linha tanto antes quanto depois, garantindo que títulos de seção nunca fiquem colados ao texto
precedente ou subsequente. Linhas correspondentes a títulos e rótulos de seção (como "Descrição da vaga",
"Sobre a empresa", "Requisitos e qualificações", "Responsabilidades e atribuições") SHALL NOT ser
incluídas como itens no array de requisitos. Quando a descrição contiver cabeçalho indicativo de requisitos
ou qualificações, a extração SHALL priorizar os itens pertencentes a essa seção, evitando capturar parágrafos
de introdução institucional como requisitos da vaga.

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

#### Scenario: Cabeçalhos h1-h6 não concatenam com o texto adjacente

- **GIVEN** um `description` em HTML onde um cabeçalho `<h2>` não tem quebra de linha ou tag envolvente no texto
  que o antecede ou sucede (ex.: `<h2>Descrição da vaga</h2>Texto corrido…`)
- **WHEN** a função extrai o texto do HTML
- **THEN** o cabeçalho e o texto corrido SHALL estar separados por quebra de linha e SHALL NOT sair colados
  (como `"Descrição da vagaTexto corrido"`)

#### Scenario: Títulos de seção não entram como itens de requisitos

- **GIVEN** um `description` que contém seções com títulos como `<h2>Descrição da vaga</h2>` e `<h2>Requisitos e qualificações</h2>`
- **WHEN** a função extrai a lista de requisitos
- **THEN** nenhum desses títulos de seção SHALL constar como item no array de requisitos

#### Scenario: Seção de requisitos tem preferência sobre texto institucional da vaga

- **GIVEN** um `description` contendo parágrafos introdutórios da empresa seguidos por uma seção de requisitos com itens em tópicos
- **WHEN** a função extrai a lista de requisitos
- **THEN** os requisitos retornados SHALL pertencer à seção de requisitos e SHALL NOT conter os parágrafos de apresentação da empresa

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
