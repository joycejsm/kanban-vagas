# Cabeçalhos de segurança Specification

## Purpose

Estabelecer a política de cabeçalhos de segurança servidos pelo Next.js, de modo a reduzir o impacto de XSS, de
injeção de conteúdo e de framing caso uma resposta seja interpretada de forma inesperada pelo navegador.

## Requirements

### Requirement: Content Security Policy restritiva

A aplicação SHALL servir uma Content Security Policy em que `script-src` seja limitado a `'self'` acrescido de um
nonce próprio de cada resposta e **nunca** de `'unsafe-inline'`; `'unsafe-eval'` SHALL NOT aparecer em resposta
servida em produção; `connect-src` SHALL ficar restrito ao domínio do projeto Supabase, aos endpoints de
autenticação do Google e à própria origem; `img-src` SHALL incluir `'self'`, `data:` e
`lh3.googleusercontent.com` para exibir o avatar do usuário; `object-src` SHALL ser `'none'`; `base-uri` SHALL
ser `'self'`; e `frame-ancestors` SHALL ser `'none'`. Valores necessários que dependam de build dinâmico
SHALL ser gerados a partir de configuração do servidor, nunca fixados no repositório.

O nonce existe porque o App Router emite script inline em toda resposta — o *flight payload* do RSC e
`(self.__next_f=…).push([0])` — e o valor muda a cada requisição, de modo que nem `'unsafe-inline'` nem hash
estático resolvem o bloqueio. O nonce SHALL ser gerado por requisição e **nunca reutilizado** entre respostas,
e o atributo `nonce` dos scripts da resposta SHALL receber o mesmo valor.

#### Scenario: CSP restritiva é servida em toda resposta

- **GIVEN** qualquer página da aplicação
- **WHEN** a resposta é inspecionada
- **THEN** o cabeçalho `Content-Security-Policy` SHALL estar presente com `script-src 'self'` e sem
  `unsafe-inline` nem `unsafe-eval`

#### Scenario: Respostas diferentes recebem nonces diferentes

- **GIVEN** duas requisições distintas à aplicação
- **WHEN** as duas respostas são inspecionadas
- **THEN** o valor em `'nonce-…'` de `script-src` SHALL ser diferente em cada resposta, e cada script da resposta
  SHALL carregar o mesmo valor no atributo `nonce`

#### Scenario: `unsafe-eval` não é servido em produção

- **GIVEN** uma resposta servida com `NODE_ENV=production`
- **WHEN** a CSP é inspecionada
- **THEN** `script-src` SHALL NOT conter `'unsafe-eval'`, e a ausência da diretiva SHALL NOT se acompanhar da
  reintrodução de `'unsafe-inline'`

#### Scenario: Avatar do Google é permitido

- **GIVEN** uma página que exibe o avatar vindo de `lh3.googleusercontent.com`
- **WHEN** o navegador aplica a CSP
- **THEN** a imagem SHALL ser carregada sem violar a política, e nenhuma outra origem SHALL estar autorizada
  em `img-src`

#### Scenario: Conexões fora da lista são bloqueadas

- **GIVEN** uma política com `connect-src` restrito à origem e ao domínio do Supabase
- **WHEN** a página tenta se conectar a outra origem
- **THEN** o navegador SHALL bloquear a conexão

### Requirement: Cabeçalhos de hardening

A aplicação SHALL enviar os cabeçalhos `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` e `X-Frame-Options: DENY`, este último em complemento a
`frame-ancestors 'none'`, protegendo também contra navegadores que não suportem CSP.

#### Scenario: Cabeçalhos presentes na resposta

- **GIVEN** qualquer resposta da aplicação
- **WHEN** os cabeçalhos são inspecionados
- **THEN** `X-Content-Type-Options`, `Referrer-Policy` e `X-Frame-Options` SHALL estar presentes com os valores
  definidos
