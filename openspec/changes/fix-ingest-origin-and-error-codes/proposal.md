# Proposal

## Why

O cadastro de vaga por URL **nunca funcionou** desde a Fase 4, e o sintoma escondia a causa.

A Server Action `adicionarVaga` chama a Edge Function com `fetch` **servidor-para-servidor**, a partir de
uma Server Action. O cabeçalho `Origin` é um mecanismo de *navegador* e não existe nessa chamada. A função,
entretanto, valida a origem como primeira etapa do pipeline, e `origemPermitida` devolve `false` para origem
ausente. Resultado: **toda** requisição real do aplicativo é recusada com `403`/`origem_nao_permitida`, antes
de qualquer trabalho.

Pior, o `403` era traduzido para "Sua sessão expirou. Entre novamente." — o que mandava a pessoa refazer
login, que nunca resolveria nada, e a mim levou a diagnosticar token expirado quando a sessão estava válida.

Os dois lados estavam testados e verdes: `pipeline.test.ts` afirma corretamente que origem ausente é recusada,
e os testes das actions verificam `Authorization` e `Content-Type`. Nenhum dos dois suite enxerga o contrato
entre eles. É a mesma forma do bug do hook `Before User Created` (corrigido em `19fc3d7`): peças corretas,
contrato quebrado na costura, integração nunca exercitada.

## What Changes

- **BREAKING** (comportamento observável): a Edge Function `ingest-vaga` passa a **aceitar** requisições sem
  cabeçalho `Origin`, tratando-as como chamadas de cliente não-navegador. A recusa por origem **presente e
  diferente** de `APP_ORIGIN` permanece, e é a que protege o navegador.
- **BREAKING** (comportamento observável): a tradução de erros da Server Action passa a usar o campo `code`
  que a função já envia no corpo, em vez de deduzir a categoria pelo status HTTP. `403` deixa de significar
  indistintamente "sessão expirada": origem não permitida e e-mail fora da allowlist passam a ter mensagens
  próprias.
- O vocabulário de códigos da interface (`CodigoErroIngestao`) ganha entradas para as categorias que hoje são
  achatadas em `sessao_expirada`.
- Nenhuma mudança em modelo de dados, migração ou configuração de secrets.

### O que NÃO muda, e por quê

A proteção real do caminho do navegador não é afrouxada. Um navegador **sempre** envia `Origin` em requisição
cross-origin, então nenhum site consegue explorar a ausência do cabeçalho para chamar a função: o
`Origin` que ele manda é conferido como sempre. O que muda é apenas o caso em que **não há navegador** — o
próprio servidor do Next, `curl`, clientes móveis. Esses continuam exigindo token de sessão válido
(`verify_jwt` no gateway e `auth.getUser` na função), allowlist e limite de uso.

A alternativa descartada foi o app forjar `Origin: APP_ORIGIN`. Além de exigir duplicar `APP_ORIGIN` no
ambiente do Next (é secret da Edge Function), faria a função validar um cabeçalho **escolhido pelo próprio
chamador**: o check deixaria de verificar qualquer coisa, e a equipe acreditaria que verifica.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `ingest-vaga`: o requisito "CORS restrito à origem da aplicação" passa a cobrir explicitamente a requisição
  sem cabeçalho `Origin`, definindo-a como chamada de cliente não-navegador e preservando a recusa estrita por
  origem presente e diferente.
- `vaga-server-actions`: o requisito "Mapeamento de erros da ingestão" deixa de tratar `401` e `403` como a
  mesma coisa e passa a exigir que a tradução use o `code` do corpo da resposta quando presente, com fallback
  por status quando ausente.

## Impact

- **Edge Function**: `supabase/functions/ingest-vaga/_shared/env.ts` (`origemPermitida`) e os testes de
  `pipeline.test.ts`, que hoje fixam "ausência de Origin → 403" e precisarão ser revistos.
- **Next**: `src/app/actions/erros.ts` (`CODIGO_POR_STATUS`, `CodigoErroIngestao`, `MENSAGENS`,
  `mapearErroIngestao`) e seus testes. O log `[acoes/erros]` já imprime `code_funcao`; a tradução deixa de
  descartá-lo.
- **Não é preciso** mexer em `src/app/actions/dependencias.ts`: o `fetch` continua sem `Origin`, e é isso que
  passa a ser o caminho legítimo.
- **Migração de dados**: nenhuma. **Secrets**: nenhuma. **Deploy**: função e app precisam ir juntos, já que
  uma versão antiga da função recusa o app e uma versão nova do app sobre a função antiga veria `code`
  desconhecido — o fallback por status cobre esse intervalo.
- **Segurança**: a superfície exposta não aumenta. O caminho do navegador segue com a mesma conferida
  estrita, e os três portões (token, allowlist, limite de uso) permanecem inalterados.
