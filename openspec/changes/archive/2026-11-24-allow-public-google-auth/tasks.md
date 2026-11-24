# Tasks

## 1. Next.js: Autorização com Curinga

- [x] 1.1 Em `src/auth/allowlist.ts`, atualizar `emailAutorizado` para retornar `true` quando a lista contiver `'*'` e o e-mail for não vazio.
- [x] 1.2 Em `tests/auth/allowlist.test.ts`, adicionar cenários testando `emailAutorizado` com `['*']` para e-mails válidos e e-mails vazios.
- [x] 1.3 Em `tests/auth/concluirLogin.test.ts`, adicionar cenário comprovando que `concluirLogin` conclui acesso com sucesso para qualquer e-mail quando a allowlist for `['*']`.
- [x] 1.4 Rodar `npm test` e verificar se a suíte do Next.js passa limpa.

## 2. Edge Function: Ingestão com Curinga

- [x] 2.1 Em `supabase/functions/ingest-vaga/_shared/pipeline.ts`, atualizar `etapaAllowlist` para retornar `null` (sucesso) quando `config.allowedEmails` contiver `'*'`.
- [x] 2.2 Em `supabase/functions/ingest-vaga/_shared/pipeline.test.ts`, adicionar cenário testando `etapaAllowlist` com `allowedEmails: ['*']` para usuário autenticado.
- [x] 2.3 Rodar `npm run test:funcao` e verificar conformidade no Deno.

## 3. Validação Integrada e Documentação

- [x] 3.1 Executar `npm run verificar` (typecheck, vitest, pgTAP, Deno) confirmando 100% de aprovação.
- [x] 3.2 Validar conformidade das especificações com `openspec validate --all`.
- [x] 3.3 Registrar orientações de configuração de secrets (`ALLOWED_EMAILS=*`) no handoff.
