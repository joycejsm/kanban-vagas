# Tasks

## 1. Edge Function: origem ausente é cliente não-navegador

- [ ] 1.1 Alterar `origemPermitida` em `supabase/functions/ingest-vaga/_shared/env.ts` para aceitar origem
  ausente (`origem === null || origem === appOrigin`), preservando a igualdade estrita quando a origem está
  presente, e verificar com a suíte da função (`npm run test:funcao`) que nada mais quebra
- [ ] 1.2 Substituir em `pipeline.test.ts` o teste "recusa ausência de Origin" por um que fixa a **aceitação**,
  mantendo ao lado o que fixa a recusa por origem presente e diferente de `APP_ORIGIN`, e verificar que os dois
  convivem (`npm run test:funcao`)
- [ ] 1.3 Acrescentar em `pipeline.test.ts` o caso de requisição sem `Origin` que segue no pipeline até a
  extração, e o caso de ausência de `Origin` sem token, que precisa continuar `401`, verificando com
  `npm run test:funcao`
- [ ] 1.4 Registrar em log a origem recebida e o resultado da conferência no descarte da chamada, sem e-mail,
  token ou conteúdo de página, e verificar que a linha aparece ao exercitar os casos 1.2 e 1.3

## 2. Next: tradução por `code`, com fallback por status

- [ ] 2.1 Acrescentar `nao_autorizado` e `origem_nao_permitida` a `CodigoErroIngestao` e a `MENSAGENS` em
  `src/app/actions/erros.ts`, com frases que não revelem se um endereço consta da allowlist (D3), e verificar
  com `npm run typecheck` que o conjunto fechado continua fechando a compilação
- [ ] 2.2 Fazer `mapearErroIngestao` derivar o código de decisão do campo `code` do corpo quando reconhecido, e
  recorrer ao status apenas como fallback, mantendo o log `[acoes/erros]` com `code_funcao`, e verificar com
  `npm test` que os testes existentes de 409/422/429/401 continuam verdes
- [ ] 2.3 Acrescentar em `erros.test.ts` os casos de `403 nao_autorizado` e `403 origem_nao_permitida` com
  mensagem própria, o de `code` desconhecido caindo no status, e o de corpo sem `code` caindo no status,
  verificando com `npm test`

## 3. Verificação da integração

- [ ] 3.1 Rodar a verificação completa (`npm run verificar`) e confirmar typecheck, vitest, pgTAP e testes da
  função verdes
- [ ] 3.2 Implantar **a função primeiro** (`scripts/configurar-edge-function.sh`) e só depois subir o app, para
  que nenhuma janela tenha app novo contra função antiga; conferir com `curl` na rota da função que uma
  requisição sem `Origin` e sem token responde `401` e não `403`
- [ ] 3.3 Abrir `http://localhost:3002`, colar uma URL de vaga real e confirmar que a vaga entra no quadro — a
  única prova de que a integração inteira funciona, já que nenhuma suíte isolada cobre esta costura
- [ ] 3.4 Com um e-mail fora da allowlist, confirmar que a tela mostra a mensagem de falta de permissão e **não**
  "sua sessão expirou", e que nenhuma mensagem nova revela se o endereço está na lista

## 4. Registro do que quebrou sem teste

- [ ] 4.1 Anotar em `DEBUG-login-hook.md` que o contrato entre a Server Action e a Edge Function não era
  coberto por teste de integração, e que a suíte da função e a do Next estavam ambas verdes enquanto a
  funcionalidade não funcionava
- [ ] 4.2 Registrar no README, na seção da ingestão, que a chamada é servidor-para-servidor e por isso não
  carrega `Origin`, para que a conferência de origem não seja "corrigida" de volta
