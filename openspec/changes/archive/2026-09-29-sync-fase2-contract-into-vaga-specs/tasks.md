# Tasks

## 1. Conformidade dos cenários de `vaga-domain` com o código

- [x] 1.1 Conferir que o cenário de rejeição de chave fora do contrato corresponde ao comportamento real da validação da saída da extração, inclusive quando a chave indevida é `user_id`, `status` ou um campo arbitrário; verificar com um teste existente em `supabase/functions/ingest-vaga/` exercitando esses casos, ou anotando a lacuna se nenhum os cobrir
- [x] 1.2 Conferir que o cenário de `url` persistida ser a da requisição corresponde ao comportamento real quando a extração devolve um `url` válido e diferente do da requisição; verificar com um teste em `_shared/pipeline.test.ts` que alimenta uma saída com `url` próprio e verifica o valor persistido
- [x] 1.3 Conferir os cenários de título acima do limite e de `senioridade` ausente assumindo `Não informado` na saída da extração; verificar com os testes correspondentes em `_shared/pipeline.test.ts` ou `_shared/llm.test.ts`

## 2. Conformidade dos cenários de `vaga-persistence` com o código

- [x] 2.1 Conferir que os quatro cenários de posição de entrada no quadro — fim da coluna, primeira vaga com `0`, colunas de outros status ignoradas e isolamento por usuário — correspondem ao cálculo de `ordem` na inserção; verificar com `_shared/supabase.ts` e com os testes que exercitam a inserção
- [x] 2.2 Conferir que a afirmação de que a escrita ocorre sob a sessão do próprio usuário, com RLS aplicado, corresponde ao cliente usado pela inserção; verificar com o cliente criado para a requisição e com a política de RLS correspondente em `openspec/specs/vaga-persistence/spec.md`
- [x] 2.3 Registrar no delta qualquer cenário que o código não satisfaça, em vez de ajustar o cenário ao código; verificar que o delta só afirma o que a Fase 2 implementou
- [x] 2.4 Cobrir com `_shared/supabase.test.ts` os quatro cenários de posição de entrada no quadro, que estavam implementados sem nenhum teste, mais a propagação do erro de banco; verificar com a suíte Deno passando e com `deno check` sem erro

## 3. Consistência, validação e archive

- [x] 3.1 Confirmar que nenhum fato já especificado em `ingest-vaga`, `ingest-audit` ou `vaga-service` foi duplicado nos deltas; verificar comparando os novos requisitos com as requirements dessas três capabilities
- [x] 3.2 Confirmar que nenhum arquivo de produção foi alterado por esta change; verificar com `git status` mostrando apenas artefatos de `openspec/` e o teste novo `supabase.test.ts`, sem `supabase/functions/ingest-vaga/_shared/supabase.ts` nem qualquer arquivo de runtime
- [x] 3.3 Validar a change com `openspec validate sync-fase2-contract-into-vaga-specs --strict`, confirmando que os três requisitos novos têm ao menos um cenário cada e que nenhum usa heading diferente de quatro `#` em cenário
- [x] 3.4 Arquivar a change e reler `openspec/specs/vaga-domain/spec.md` e `openspec/specs/vaga-persistence/spec.md` após o archive, confirmando que os três requisitos foram somados às main specs e que nenhum requisito preexistente foi substituído
