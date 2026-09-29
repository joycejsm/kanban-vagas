# Spec Delta

## Purpose

Estabelecer a política de cabeçalhos de segurança servidos pelo Next.js, de modo a reduzir o impacto de XSS, de
injeção de conteúdo e de framing caso uma resposta seja interpretada de forma inesperada pelo navegador.

## ADDED Requirements

### Requirement: Content Security Policy restritiva

A aplicação SHALL servir uma Content Security Policy em que `script-src` seja limitado a `'self'`, sem
`'unsafe-inline'` nem `'unsafe-eval'`; `connect-src` SHALL ficar restrito ao domínio do projeto Supabase, aos
endpoints de autenticação do Google e à própria origem; `img-src` SHALL incluir `'self'`, `data:` e
`lh3.googleusercontent.com` para exibir o avatar do usuário; `object-src` SHALL ser `'none'`; `base-uri` SHALL
ser `'self'`; e `frame-ancestors` SHALL ser `'none'`. Valores necessários que dependam de build dinâmico
SHALL ser gerados a partir de configuração do servidor, nunca fixados no repositório.

#### Scenario: CSP restritiva é servida em toda resposta

- **GIVEN** qualquer página da aplicação
- **WHEN** a resposta é inspecionada
- **THEN** o cabeçalho `Content-Security-Policy` SHALL estar presente com `script-src 'self'` e sem
  `unsafe-inline` ou `unsafe-eval`

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
