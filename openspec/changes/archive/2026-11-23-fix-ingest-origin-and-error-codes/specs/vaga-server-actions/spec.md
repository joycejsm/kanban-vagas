# Spec Delta

## MODIFIED Requirements

### Requirement: Mapeamento de erros da ingestão

A Server Action SHALL traduzir as respostas de erro da Edge Function em mensagens pt-BR estáveis. A tradução
SHALL usar, quando presente, o campo `code` do corpo da resposta, que identifica a categoria do erro de forma
mais precisa que o status HTTP, e SHALL recorrer ao status apenas como fallback quando o `code` estiver ausente
ou não for reconhecido. O mapeamento SHALL preservar, por status, os comportamentos já existentes: duplicidade
(409) como aviso de vaga já cadastrada; falha de extração (422/413) como convite a colar o texto da vaga;
limite de uso (429) como aviso de uso intenso; sessão inválida (401) como pedido de novo login; timeout ou
falha inesperada como erro genérico com sugestão de tentar de novo.

Duas categorias de `403` deixam de ser traduzidas como sessão expirada: e-mail fora da allowlist e origem não
permitida passam a ter mensagens próprias, porque mandar a pessoa refazer o login diante de uma delas não
resolve nada e desvia o diagnóstico. A mensagem retornada SHALL NOT conter stack trace, SQL, resposta do LLM
ou conteúdo interno, e as duas novas mensagens SHALL NOT revelar se um endereço de e-mail específico consta da
allowlist.

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

- **GIVEN** uma resposta de erro sem `code` reconhecível no corpo, com status `401` ou `403`
- **WHEN** a Server Action mapeia o erro
- **THEN** o retorno SHALL informar que a sessão expirou e que é preciso entrar novamente

#### Scenario: 401 vira pedido de novo login mesmo com code no corpo

- **GIVEN** uma resposta `401` cujo corpo traz `code` igual a `nao_autenticado`
- **WHEN** a Server Action mapeia o erro
- **THEN** o retorno SHALL informar que a sessão expirou e que é preciso entrar novamente

#### Scenario: 403 de e-mail fora da allowlist não vira sessão expirada

- **GIVEN** uma resposta `403` cujo corpo traz `code` igual a `nao_autorizado`
- **WHEN** a Server Action mapeia o erro
- **THEN** o retorno SHALL informar que o usuário não tem permissão, sem pedir novo login e sem revelar se um
  endereço específico consta da allowlist

#### Scenario: 403 de origem não permitida não vira sessão expirada

- **GIVEN** uma resposta `403` cujo corpo traz `code` igual a `origem_nao_permitida`
- **WHEN** a Server Action mapeia o erro
- **THEN** o retorno SHALL informar que a origem não é permitida, sem pedir novo login

#### Scenario: code desconhecido não escapa do conjunto fechado

- **GIVEN** uma resposta de erro cujo corpo traz um `code` que a interface não reconhece
- **WHEN** a Server Action mapeia o erro
- **THEN** a tradução SHALL recorrer ao status HTTP, preservando o comportamento já existente para ele, e o
  código de decisão retornado SHALL continuar pertencendo ao conjunto fechado

#### Scenario: Timeout ou erro genérico vira mensagem neutra

- **GIVEN** uma falha de rede, um timeout ou uma resposta inesperada da Edge Function
- **WHEN** a Server Action mapeia o erro
- **THEN** o retorno SHALL ser uma mensagem genérica em pt-BR com sugestão de tentar novamente, sem expor
  stack trace, status interno ou resposta do LLM
