# Design

## Context

Ver `proposal.md` para o porquê. O estado que obriga as decisões abaixo: `openspec/specs/vaga-domain/spec.md` e
`openspec/specs/vaga-persistence/spec.md` descrevem o contrato da Fase 1; o contrato que a Fase 2 fixou está em
`supabase/functions/ingest-vaga/` e nos testes em Deno, mas não em lugar nenhum da especificação. A change da
Fase 2 declarara as duas capabilities como modificadas e não emitiu os deltas.

## Goals / Non-Goals

**Goals:**

- Fazer as main specs descreverem o que o código da Fase 2 já faz e já testa.
- Não exigir que quem for implementar a Fase 3 leia o código da Fase 2 para escrever a validação de entrada.
- Não criar uma segunda fonte de verdade para nenhum fato já especificado.

**Non-Goals:**

- Não alterar código de produção, migração, schema, RLS ou API. O único arquivo de código tocado é um teste
  novo; ver a seção do proposal sobre por que ele entra nesta change.
- Não reescrever `openspec/changes/archive/2026-09-29-add-ingest-vaga-edge-function/proposal.md`. Aquele
  documento conta a história do que a change pretendia fazer; corrigi-lo apagaria o registro de que o delta foi
  esquecido, que é informação útil.
- Não reescrever main specs diretamente. A modificação entra como delta e se soma no archive, para que o
  archive fique como o ponto de aplicação do contrato.

## Decisions

### D1 — Deltas `ADDED`, não `MODIFIED`

Os três fatos são exigências novas. Nenhum requisito existente muda de comportamento: `VagaCreateInput` continua
aceitando exatamente os mesmos cinco campos, a tabela `public.vagas` continua igual, e a column `ordem`
continua tendo `0` como valor padrão.

**Alternativa:** usar `MODIFIED Requirements` nos requisitos "Schema de entrada da Vaga" e "Posição no quadro e
timestamps", absorvendo os fatos novos. **Rejeitada** — o formato `MODIFIED` exige copiar o bloco inteiro do
requisito e reescrevê-lo, e o archive substitui o requisito inteiro pelo texto novo. É o mecanismo em que mais
detalhe se perde em silêncio: um cenário que seja omitido por descuido durante a cópia simplesmente desaparece
da main spec. Como aqui nada muda, não há ganho nenhum em pagar esse risco.

### D2 — A spec descreve a falha observável, não a chamada que a produz

A spec de `vaga-domain` diz que uma chave fora do conjunto faz a validação falhar, e não que a extração usa
`safeParse`. O nome da função é escolha de biblioteca, e a regra de escrita de spec é evitar isso.

Isso não empobrece o contrato: o que importa para quem consome é que a validação **falha** e que o resultado é
**descartado por inteiro** — não que exista uma função específica. O nome vive no `design.md` da Fase 2 e no
código, onde ele ajuda quem for depurar.

### D3 — Especificar contra o código, não contra a proposal da Fase 2

A proposal da Fase 2 é a declaração de *intenção*. O código é o que roda. Os três fatos deste delta foram
verificados um a um no código antes de serem escritos, e um quarto item da suposta lista de modificações —
a tabela de auditoria — foi descartado porque já tem casa em `ingest-audit`.

**Alternativa:** transcrever a seção *Modified Capabilities* da proposal da Fase 2 para os deltas. **Rejeitada**
— é exatamente assim que specs passam a descrever comportamento que não existe. A proposal declarava a tabela de
auditoria como parte de `vaga-persistence`; escrevê-la ali criaria o mesmo requisito em duas capabilities, e a
primeira a ser editada passaria a ser a errada.

### D4 — O critério de completude é a Fase 3 conseguir escrever sem ler a Fase 2

A pergunta que guiou a redação de cada cenário é: escrevendo a Server Action que valida entrada com
`VagaCreateInput`, o que eu precisaria saber e não encontraria na spec?

- Que a validação é estrita e rejeita chave extra → D1 do requisito novo de `vaga-domain`.
- Que a saída do modelo é validada pelo mesmo schema → novo requisito de `vaga-domain`.
- Que `url` não vem do modelo → requisito de procedência, que é o que impede a Fase 3 de introduzir uma
  validação que aceite `url` de origem desconhecida.
- Onde uma vaga nova entra no quadro → requisito de `vaga-persistence`, que a Fase 4 consome.

Um requisito que não responde a nenhuma dessas perguntas não entraria.

## Risks / Trade-offs

- **[A spec passa a descrever o que o código faz hoje, e o código pode mudar sem ela mudar]** → É o risco padrão
  de especificação por comportamento, e aqui é pequeno: a mudança é aditiva e cada cenário é diretamente
  verificável contra o código atual. O risco real seria o oposto, specs que divergem do código.
- **[Alguém implementa a Fase 3 lendo só as main specs, antes do archive deste change]** → As main specs só
  ganham os fatos no archive. Mitigação: fazer o archive desta change antes de aplicar
  `add-nextjs-auth-and-server-actions`, que é a ordem já planejada.
- **[O archive soma requisitos e a main spec cresce sem alguém revisar o resultado]** → O resultado do archive
  é revisável: são quatro requisitos novos, aditivos, sem alteração de requisito existente. Convém reler
  `openspec/specs/vaga-domain/spec.md` e `openspec/specs/vaga-persistence/spec.md` depois do archive.

## Migration Plan

Não há migração: nenhuma alteração de dado, de banco, de código ou de infraestrutura. O efeito acontece no
archive, que atualiza as main specs.

Rollback é reverter o commit e, se necessário, restaurar as main specs — nenhum artefato já arquivado é
reescrito por esta change, e nenhum código depende dela.

## Open Questions

Nenhuma. As três decisões de escopo acima foram tomadas com o código à vista e não há unknowns que mudem spec,
abordagem ou decomposição de tarefas.
