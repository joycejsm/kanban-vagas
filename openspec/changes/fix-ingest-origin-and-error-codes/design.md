# Design

## Context

O que molda a abordagem está em `proposal.md — Why`. Três fatos do código, que restringem as
escolhas:

- A chamada é feita em `src/app/actions/dependencias.ts` por `fetch` dentro de uma Server Action. O
  cabeçalho `Origin` é emitido pelo *user agent*; um `fetch` de Node não o produz. Não há como o
  servidor mandar um `Origin` que signifique algo honesto — qualquer valor enviado seria uma afirmação do
  chamador sobre a própria origem.
- A função já responde erros com `{"code": ..., "message": ...}`, e `openspec/specs/ingest-vaga/spec.md`
  ("Resposta de sucesso e de erro") já exige que o `code` "identifique a categoria do erro para o cliente
  agir". O contrato existe; o cliente é que não o usa. `src/app/actions/erros.ts` já extrai o campo e só o
  escreve no log.
- A distinção que o status não carrega é real: `403` cobre tanto `origem_nao_permitida` quanto
  `nao_autenticado` (allowlist). São causas sem ação comum — uma se resolve mudando onde a função é chamada,
  a outra se resolve com a conta na lista.

## Goals / Non-Goals

**Goals:**

- Fazer a ingestão por URL funcionar ponta a ponta com a arquitetura atual (Server Action chamando a Edge
  Function), sem exigir que o Next possua `APP_ORIGIN`.
- Impedir que duas causas diferentes voltem a aparecer na tela como a mesma mensagem.
- Deixar um rastro em log que permita diagnosticar a próxima falha de origem sem abrir o isolate.

**Non-Goals:**

- Não redesenhar a divisão entre Next e Edge Function. A chamada servidor-para-servidor é a arquitetura
  escolhida e ela se mantém.
- Não reprovar o modelo de verificação por token. Os três portões (sessão, allowlist, limite de uso) não
  são tocados.
- Não transformar o log em canal de diagnóstico para o usuário. Ele é interno e continua sem e-mail, sem
  token e sem conteúdo de página.

## Decisions

### D1 — A função aceita requisição sem `Origin`; o app não forja o cabeçalho

**Escolha**: `origemPermitida` passa a aceitar origem ausente (`origem === null || origem === appOrigin`).

**Alternativa A (descartada)**: o app envia `Origin: APP_ORIGIN`. Exigiria replicar `APP_ORIGIN` no ambiente
do Next — que é secret da função — e, mais grave, faria a função validar um cabeçalho escolhido pelo
chamador. O check passaria a ser tautológico: continuaria no código dando aparência de proteção, sem
proteger. É a opção que produz a pior de todas: falso senso de segurança com custo de configuração.

**Alternativa B (descartada)**: remover a conferência de origem por completo. Perde a proteção real do
caminho do navegador, que é o único que ela existe para proteger.

**Por que A original não é aceitável como está**: ela é estrita demais para o chamador real, e a rigidez
está no lado errado. O objetivo do requisito é "impedir que um navegador de origem indevida chame a função".
Uma requisição sem `Origin` não é um navegador de origem indevida — não há origem para estar indevida. O
requisito passa a dizer o que quer dizer.

### D2 — A tradução usa o `code` do corpo, com o status como fallback

**Escolha**: `mapearErroIngestao` passa a derivar o código de decisão do `code` quando ele for reconhecido, e
cai no mapeamento por status quando não for. O vocabulário `CodigoErroIngestao` ganha
`nao_autorizado` e `origem_nao_permitida`.

**Alternativa A (descartada)**: manter o mapeamento por status e adicionar status novos para as duas
categorias. Muda o contrato HTTP da função em nome de uma limitação do tradutor, e a função já foi
especificada para devolver `code` justamente para que o cliente não precise adivinhar.

**Alternativa B (descartada)**: manter `sessao_expirada` para os dois `403` e apenas melhorar a mensagem
genérica. Não separa as causas, que é o problema.

**Por que o fallback continua existindo**: durante o deploy, o app novo pode estar falando com a função
antiga, cujo corpo de erro já tinha `code` mas com os mesmos status — e, se outra resposta inesperada
aparecer, um código desconhecido não pode virar `undefined` na tela. Fallback por status mantém o conjunto
fechado de mensagens e o comportamento atual para tudo que não for reconhecido.

### D3 — A mensagem de `nao_autorizado` não diz se o endereço está na lista

Dizer "este e-mail não tem acesso" para quem acabou de tentar entrar confirmaria o resultado de uma sondagem
sobre a allowlist por quem não tem conta. A tela é vista por alguém autenticado, mas a session pode ser de
conta compartilhada, e a informação não é necessária para agir: a ação correta é a mesma nos dois casos —
falar com quem administra a lista. A mensagem fica no mesmo nível de genericidade da de sessão, mudando
apenas o que a pessoa deve fazer a seguir. Registrado aqui porque é uma restrição que a implementação
tende a soltar aspas ao escrever a frase.

### D4 — A função registra a origem recebida e o resultado da conferência

**Escolha**: no descarte da chamada, a função escreve em log a origem recebida e se passou. Origem não é dado
sensível — é o endereço do app, não de pessoa.

**Por quê**: a falha deste ciclo custou um diagnóstico errado porque o `403` na tela e no log do Next não
davam para distinguir "origem errada" de "sessão inválida", e o log da função não dizia nada. Sem uma linha
que nomeie a origem, a próxima falha de CORS reproduz exatamente a mesma dúvida. É a resposta concreta ao
achado 1 de `DEBUG-login-hook.md` (erro indistinguível entre recusa legítima e falha de infraestrutura):
de distinguível, o log precisa existir.

## Risks / Trade-offs

**[Um cliente não-navegador passa a alcançar a etapa de autenticação]** → Ele sempre precisou alcançar: a
recusa de origem nunca substituiu token, allowlist ou limite de uso, que continuam obrigatórios e inalterados.
A superfície efetivamente utilizável não aumenta em nada; o que muda é qual erro aparece primeiro.

**[Uma requisição sem `Origin` que today é recusada passa a ser processada]** → Ela só é processada se
tiver sessão válida, e-mail na lista e estiver dentro do limite. Nenhuma escrita ocorre sem todos os três.

**[Mensagem nova expõe informação que a antiga não expunha]** → Ver D3: as duas novas mensagens dizem o
**tipo** da recusa, nunca o conteúdo da allowlist nem o endereço envolvido.

**[Divergência entre app e função durante o deploy]** → A ordem é **função primeiro, app depois**. App novo
com função antiga cai no fallback por status e degrada para a mensagem antiga, sem quebrar. App velho com
função nova funciona, porque a função nova é a única mudança de comportamento da requisição — e um app velho
que receba um `code` novo simplesmente o ignora, voltando ao mapeamento por status. Não há janela em que
falhe.

**[Regressão silenciosa se alguém reintroduzir a conferência estrita]** → O teste que fixa
"requisição sem `Origin` é aceita" fica em `pipeline.test.ts`, junto do que fixa a recusa por origem
errada. Os dois convivem.

## Migration Plan

1. Aplicar a mudança da função (`env.ts`, log em `pipeline.ts`) e seus testes.
2. Rodar a suíte da função e a do Next.
3. Deploy da função: `scripts/configurar-edge-function.sh` (ou `supabase functions deploy ingest-vaga`).
4. Só então a mudança do Next, com deploy do app.
5. Conferir manualmente: colar uma URL de verdade em `http://localhost:3002` e ver a vaga entrar.

**Rollback**: cada lado reverte sozinho. Reverter a função devolve a recusa por origem ausente — o app volta
a quebrar a ingestão, mas sem nenhum outro efeito. Reverter o app volta as mensagens antigas, com a
ingestão funcionando. Nenhum dos dois tem estado persistido para desfazer: não há migração, e a auditoria de
tentativas pode conter linhas de tentativas que agora passam.

## Open Questions

Nenhuma que afete escopo, abordagem ou quebra de tarefas.
