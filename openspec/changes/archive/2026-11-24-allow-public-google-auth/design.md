# Design: Suporte a Modo Público via Curinga em ALLOWED_EMAILS

## Contexto

O projeto conta com autenticação via Supabase Auth + Google OAuth. Até agora, o acesso era restrito exclusivamente a endereços expressos na variável de ambiente `ALLOWED_EMAILS`. No banco, o hook `rejeitar_email_fora_da_allowlist` barrava a criação do usuário, enquanto no Next.js e na Edge Function os e-mails eram checados nominalmente.

Com o desativamento manual do hook no painel do Supabase, qualquer conta Google consegue ter um registro em `auth.users`. Para que o fluxo complete com sucesso tanto na interface web quanto nas chamadas à API de ingestão, o Next.js e a Edge Function devem aceitar o login quando configurados para modo público.

## Decisões Técnicas

### D1: Curinga explícito `*` em vez de tornar a variável opcional
Tornar `ALLOWED_EMAILS` opcional (ou degradar para "permitir todos" quando vazia) violaria a Invariante 7 do projeto ("sem fallback: sem allowlist o acesso é negado"). Um erro de digitação no nome da variável no deploy poderia abrir inadvertidamente um ambiente privado.
Exigir o valor explícito `'*'` (ex.: `ALLOWED_EMAILS=*`) torna a abertura pública uma escolha deliberada e auditável nos painéis de secrets da Vercel e do Supabase.

### D2: Preservação da checagem de e-mail existente
Mesmo com `lista.includes('*')`, o usuário deve possuir um e-mail válido retornado pelo Google (`normalizarEmail(email) !== ''`). Sessões anônimas ou tokens sem e-mail continuam sendo barrados.

### D3: Isolamento por RLS e Rate Limit mantidos intactos
Nenhuma alteração é feita no banco de dados:
- Todas as operações em `public.vagas` e `public.ingest_log` continuam protegidas por `auth.uid() = user_id`. Usuários desconhecidos só verão e manipularão suas próprias vagas.
- O rate limit de 20 requisições/hora e 100 requisições/dia por usuário continua valendo individualmente por `auth.uid()`, protegendo as cotas do Gemini.
