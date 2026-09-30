# Proposal

## Why

A change `add-ingest-vaga-edge-function` (Fase 2) declarou, na seção *Modified Capabilities* da própria proposal,
que modificaria **`vaga-domain`** e **`vaga-persistence`** — mas nunca emitiu delta de spec para nenhuma das duas.
As main specs descrevem, portanto, apenas o contrato da Fase 1, e o contrato que a Fase 2 realmente fixou não
existe em lugar nenhum da especificação.

Isto importa agora porque a Fase 3 (`add-nextjs-auth-and-server-actions`) vai **reusar** `VagaCreateInput` como
schema de validação de entrada de uma Server Action. Quem for escrever essa Server Action vai ler
`vaga-domain/spec.md` achando que ele descreve tudo sobre o schema, e não vai encontrar: que ele é também o
**contrato de saída do LLM**; que sua estriticidade é o que rejeita chave fora do conjunto; e que o `url` tem
procedência diferente de todos os outros campos — é o da requisição, nunca o devolvido pelo modelo. São três
fatos que decidem como a validação deve ser escrita.

## What Changes

- **`vaga-domain`**: registrar que `VagaCreateInput` é contrato de **duas** direções — entrada de criação e
  **saída do LLM**, validada com `safeParse` — e que sua estriticidade (`.strict()`) é o que rejeita chave fora
  do conjunto `url`, `titulo`, `empresa`, `requisitos`, `senioridade`.
- **`vaga-domain`**: registrar a **procedência do campo `url`**: a URL validada da requisição do usuário é a
  única que entra no registro, e o valor devolvido pelo modelo é descartado mesmo quando o modelo o produz.
  Os demais campos vêm da extração.
- **`vaga-persistence`**: registrar a **posição de entrada no quadro** — a inserção pela Edge Function grava
  `status` `'aplicado'` com `ordem` no fim da coluna de destino, calculada no servidor a partir do maior `ordem`
  da coluna, e não com o valor padrão `0` da coluna.

**Nenhuma mudança de comportamento, de banco ou de API.** O código da Fase 2 já implementa os três pontos e
já os testa; o que faltava era a especificação que os descreve. A única adição de código é um arquivo de teste
novo, e o motivo está registrado abaixo.

### Escopo deliberadamente excluído

A verificação de escopo da Fase 2 encontrou comportamento que **já** está especificado em outra capability, e que
portanto não vira delta aqui — duplicá-lo criaria duas-fontes-da-verdade para o mesmo fato:

| Comportamento da Fase 2 | Onde já está especificado |
|---|---|
| `201` com `status` `aplicado`; `409` de duplicidade (`23505`) | `ingest-vaga` (contrato HTTP) e `vaga-service` (tradução para o domínio) |
| Tabela de auditoria `ingest_log` com RLS | `ingest-audit`, integralmente |
| Escrita com o JWT do usuário e RLS ativo | `vaga-persistence`, requirement de RLS |

A proposal da Fase 2 declarava a tabela de auditoria como parte da modificação de `vaga-persistence`, mas ela tem
casa própria em `ingest-audit`. Replicá-la em `vaga-persistence` seria a duplicação que a própria estrutura de
capabilities do projeto existe para evitar.

## Capabilities

### New Capabilities

Nenhuma. Esta change não introduz comportamento novo.

### Modified Capabilities

- `vaga-domain`: o schema `VagaCreateInput` passa a ser especificado também como contrato de saída do LLM
  validado com `safeParse`, com a estriticidade do schema e a procedência do campo `url` declaradas como
  contrato, não como detalhe de implementação.
- `vaga-persistence`: a inserção pela Edge Function passa a ter especificado o `status` inicial `'aplicado'` e a
  `ordem` no fim da coluna de destino, distinta do valor padrão `0` da coluna.

## Impact

- **Código:** um arquivo novo, `supabase/functions/ingest-vaga/_shared/supabase.test.ts`, com os cinco cenários
  de inserção. Nenhuma alteração em código de produção: `supabase/functions/ingest-vaga/_shared/supabase.ts`
  não é tocado.
- **Banco:** nenhuma migração, nenhuma alteração de schema ou de RLS.
- **Artefatos OpenSpec:** deltas novos em `specs/vaga-domain/spec.md` e `specs/vaga-persistence/spec.md` desta
  change, que se somam às main specs no archive.
- **Consumidores:** a Fase 3 deixa de precisar inferir da leitura do código da Fase 2 o comportamento de
  `VagaCreateInput` sob saída não confiável. A Fase 4 passa a ter especificado onde uma vaga nova entra no quadro.
- **Reversibilidade:** reverter o commit restaura as main specs ao estado anterior. Nenhum artefato de
  especificação já arquivado é reescrito — o que entra é aditivo.

### Por que há um arquivo de teste nesta change

Os três pontos desta change já estavam implementados, mas a conferência do apply mostrou que **dois deles não
tinham cobertura alguma**: `inserirVaga` não era referenciada em nenhum `.test.ts` — os testes de `pipeline`
injetam um dublê em `deps.inserir` e contornam a inserção real —, e o pgTAP exercita `ordem` por `UPDATE`, não
pelo cálculo do `insert`.

Promover esses comportamentos a contrato de main spec sem cobertura colocaria a especificação acima do que o
projeto consegue provar. O modo de falha é silencioso: remover o filtro de status da consulta faz o card novo
colar no topo da coluna, e nenhuma suíte sente. O teste entra aqui, junto do delta que ele sustenta.

O limite do que esse teste prova está declarado no próprio arquivo: ele trava a aritmética e a forma da query,
não o comportamento ponta a ponta contra o Postgres. O isolamento entre usuários continua provado pelo pgTAP.
