# Spec Delta

## MODIFIED Requirements

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
