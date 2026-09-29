# url-safety Specification

## Purpose

Impedir que a ingestão seja usada para alcançar a rede interna. A função busca URLs fornecidas por qualquer
usuário autenticado, então precisa validar o alvo antes de cada requisição — na URL inicial e em cada
redirecionamento — e recusar qualquer destino que não seja um host público alcançável por HTTPS.

## Requirements

### Requirement: Forma da URL antes de qualquer acesso

A função SHALL validar a URL recebida antes de resolver nomes ou abrir conexões. A URL SHALL usar o esquema
`https`, SHALL NOT conter credenciais embutidas (`usuário:senha@`), SHALL ter no máximo 2048 caracteres e sua
porta, quando presente, SHALL ser vazia ou 443. Qualquer URL que falhe nestas condições SHALL ser recusada com
`422`, sem que haja resolução de DNS ou requisição de rede.

#### Scenario: URL sem https é recusada

- **GIVEN** uma URL `http://empresa.com/vaga/1`
- **WHEN** a função valida a URL
- **THEN** a resposta SHALL ser `422` e nenhuma conexão SHALL ser aberta

#### Scenario: URL com credenciais é recusada

- **GIVEN** uma URL `https://usuario:senha@empresa.com/vaga/1`
- **WHEN** a função valida a URL
- **THEN** a resposta SHALL ser `422`

#### Scenario: Porta não padrão é recusada

- **GIVEN** uma URL `https://empresa.com:8443/vaga/1`
- **WHEN** a função valida a URL
- **THEN** a resposta SHALL ser `422`

#### Scenario: URL acima do limite é recusada

- **GIVEN** uma URL com mais de 2048 caracteres
- **WHEN** a função valida a URL
- **THEN** a resposta SHALL ser `422`

### Requirement: Hosts que não são nomes públicos são recusados

A função SHALL recusar, antes da resolução, host que seja um endereço IP literal (IPv4 ou IPv6), `localhost`, ou
qualquer nome terminando em `.local` ou `.internal`.

#### Scenario: Loopback por nome é recusado

- **GIVEN** as URLs `https://127.0.0.1/vaga`, `https://localhost/vaga` e `https://[::1]/vaga`
- **WHEN** a função valida a URL
- **THEN** cada uma SHALL ser recusada antes de qualquer fetch

#### Scenario: IP de metadados de cloud é recusado

- **GIVEN** a URL `https://169.254.169.254/latest/meta-data/`
- **WHEN** a função valida a URL
- **THEN** a resposta SHALL ser `422` e nenhuma requisição SHALL ser feita ao endereço

#### Scenario: Sufixo de rede interna é recusado

- **GIVEN** as URLs `https://servidor.local/vaga` e `https://api.internal/vaga`
- **WHEN** a função valida a URL
- **THEN** cada uma SHALL ser recusada

#### Scenario: IP privado como nome é recusado

- **GIVEN** um domínio público cujo DNS resolve para um endereço em faixa privada
- **WHEN** a função resolve e valida o destino
- **THEN** a resposta SHALL ser `422` e a conexão SHALL NOT ser estabelecida

### Requirement: Resolução DNS e bloqueio de faixas não públicas

A função SHALL resolver o host da URL, obtendo registros A e AAAA, e SHALL recusar o destino se **qualquer**
endereço resolvido pertencer a faixa não pública. As faixas bloqueadas são: `0.0.0.0/8`, `10.0.0.0/8`,
`100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`,
`fe80::/10`, o endereço não roteável `::` e endereços IPv4 mapeados em IPv6. Host que não resolve SHALL ser
recusado. Nenhum endereço resolvido SHALL ser usado como destino pelo corpo da resposta.

#### Scenario: Resolução múltipla com um endereço privado é recusada

- **GIVEN** um host que resolve para um endereço público e também para um endereço em `10.0.0.0/8`
- **WHEN** a função valida o destino
- **THEN** a resposta SHALL ser `422`, porque um único endereço não público já torna o destino inseguro

#### Scenario: IPv4 mapeado em IPv6 é bloqueado

- **GIVEN** um host que resolve para um endereço IPv6 IPv4-mapped apontando para faixa privada
- **WHEN** a função valida o destino
- **THEN** a resposta SHALL ser `422`

#### Scenario: Host sem resolução é recusado

- **GIVEN** um domínio público válido que não resolve para nenhum endereço
- **WHEN** a função tenta resolver
- **THEN** a resposta SHALL ser `422`

#### Scenario: Endereço público é aceito

- **GIVEN** uma URL de empresa real que resolve apenas para endereços públicos
- **WHEN** a função valida o destino
- **THEN** a validação SHALL passar e o fetch SHALL prosseguir

### Requirement: Redirects validados um a um

A função SHALL buscar sem seguir redirecionamentos automaticamente e, ao receber um redirecionamento, SHALL
revalidar o destino com as mesmas regras de esquema, credenciais, porta, host, tamanho e faixas de IP, até no
máximo 3 saltos. Ao exceder o limite, ou ao encontrar um destino inválido em qualquer salto, a função SHALL
interromper e responder com erro, sem recuperar o corpo de nenhum dos destinos.

#### Scenario: Redirecionamento para IP privado é bloqueado

- **GIVEN** uma URL pública que responde `302` com `Location` apontando para `https://169.254.169.254/`
- **WHEN** a função segue o redirecionamento
- **THEN** a função SHALL recusar o destino antes de abrir conexão com ele

#### Scenario: Cadeia de redirecionamentos dentro do limite é seguida

- **GIVEN** uma URL pública que redireciona até 3 vezes para destinos públicos válidos
- **WHEN** a função segue os redirecionamentos
- **THEN** a função SHALL buscar o destino final

#### Scenario: Excesso de redirecionamentos é interrompido

- **GIVEN** uma URL que redireciona mais de 3 vezes
- **WHEN** a função segue os redirecionamentos
- **THEN** a função SHALL interromper e responder com erro genérico, sem buscar o quarto destino

### Requirement: Riscos residuais documentados

A validação de URL SHALL ser documentada junto ao código, registrando explicitamente que existe janela de
DNS rebinding entre a resolução e a requisição, e que a mitigação é o ambiente de execução: a função roda fora
de qualquer rede privada, e o corpo bruto da resposta nunca é devolvido ao cliente — apenas os campos extraídos
e validados.

#### Scenario: Risco documentado no código

- **GIVEN** o código de validação de URL
- **WHEN** ele é lido
- **THEN** ele SHALL conter um comentário descrevendo o risco de DNS rebinding e a mitigação adotada
