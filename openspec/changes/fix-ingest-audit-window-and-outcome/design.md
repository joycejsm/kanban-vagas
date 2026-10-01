# Design

## D1 — A janela é um valor, não uma expressão SQL

O filtro do PostgREST é sempre um **valor**: `criado_em=gte.<algo>` é repassado como literal para o
`cast` da coluna. `now() - interval '1 hour'` é SQL, e o `cast` falha com `22007`. Não há como escrever
`now()` ali — nem com `Prefer`, nem com função.

A correção é calcular a janela no isolate e enviar ISO 8601 (`2026-10-01T03:50:47.677Z`), que é o que
`criado_em` grava e o que qualquer `timestamptz` aceita de volta. As duas janelas (hora e dia) saem do **mesmo**
instante, para que a contagem horária e a diária nunca discordem entre si por causa de dois `Date.now()`
sucessivos.

**Alternativa:** RPC `SECURITY DEFINER` com `now() - interval`. Descartada — D2 (change arquivada) escolheu o
`SELECT` com RLS para não criar superfície de privilégio, e a janela de uma hora absorve qualquer divergência
entre o relógio do isolate e o do banco.

**Margem:** o teste fixa a *forma* do valor enviado (timestamp ISO, não texto SQL). Um teste que só verifica
a contagem returning 1 passaria com a data de hoje e falharia com a de amanhã — a forma é o que quebra, e a
forma é o que o teste segura.

## D2 — O desfecho é gravado na linha que a tentativa criou

O código anterior marcava "a linha pendente mais recente do usuário":

```ts
.update({ resultado }).eq('resultado', 'pendente').order('criado_em', { ascending: false }).limit(1)
```

Isso **parece** fechar uma linha só, e não fecha. O PostgREST aceita `order` e `limit` em `PATCH` sem reclamar
e **os ignora** — verificado contra o projeto: duas linhas compatíveis foram atualizadas com
`order=id.desc&limit=1`, e ambas mudaram. Duas consequências, ambas ruins:

1. toda pendência do usuário é fechada, inclusive de tentativas antigas que talvez devessem continuar abertas;
2. com duas requisições simultâneas, o fechamento de uma pode fechar a linha da outra — a auditoria passa a
   mentir sobre qual tentativa deu o que.

A tentativa passa a carregar o `id` que o `INSERT` devolveu, e o desfecho é gravado por `eq('id', id)`. É o
único identificador que não pode ser confundido com o de outra requisição, e ele vem do banco, não do
chamador.

**Alternativa:** `eq('host', host)`. Descartada — o mesmo host pode ter duas tentativas em voo, e aí o
problema volta menor.

## D3 — Falha de auditoria é etapa nomeada, e a linha que existe é fechada

Hoje `etapaRateLimit` **lança**, e o `catch` de `executarPipeline` responde com `auditoriaAberta = false` —
porque o `true` só é atribuído *depois* do `await`. Ou seja: quando a contagem falha, o código se comporta
como se o registro não tivesse sido feito, e a linha inserida um instante antes fica aberta para sempre.

O registro e a contagem viram **duas dependências** (`registrarTentativa` e `contarJanelas`) para que o
handler consiga expressar o estado intermediário que existe de verdade: *a linha existe, a contagem não*. A
partir daí:

- registro falha → nenhuma linha existe → `auditoriaAberta = false`, e a falha nomeia a etapa `auditoria`;
- registro ok, contagem falha → a linha existe → ela é fechada como `erro` antes de responder.

A etapa `auditoria` no log é o que faltava para a próxima falha dessa família ser diagnosticável sem abrir o
isolate: hoje o mesmo `500` chega de quatro lugares diferentes e o log não distingue nenhum.

## D4 — Fechar a auditoria pode falhar, e agora isso aparece

`marcarDesfechoSilencioso` engole a exceção de propósito — decisão antiga e certa quanto ao *efeito* (a
auditoria é acessória; a resposta do usuário não pode depender dela). O que estava errado era o silêncio
inteiro: o ponto onde a informação vale mais era justamente o ponto sem rastro. E `marcarDesfecho` descartava
o `{ error }` do PostgREST sem olhar, então nem o SQLSTATE chegava ao log.

Agora a falha do fechamento vira uma linha de log — `etapa=auditoria`, código, e o resultado devolvido pelo
banco — e a resposta ao usuário continua a mesma. Silencioso no efeito, nunca no registro.

**Por que o `id` também protege aqui:** com `eq('id', id)` e `.select('id')`, uma atualização que não
encontrou a linha devolve `data` vazio em vez de sucesso mudo. Isso distingue "não havia linha para fechar"
de "a gravação foi recusada", que antes eram o mesmo silêncio.

## Fora de escopo

- **A página da Gupy é renderizada no cliente.** Medido: `carreirasomie.gupy.io/job/...` devolve 3.905 bytes
  de casca de React, sem `JobPosting` e sem texto visível. Enquanto isso não for resolvido (JSON da Gupy,
  renderização, ou o caminho de texto colado), a ingestão da Gupy vai responder `422` pedindo o texto. É outra
  change; aqui só fica o registro de que o limite de uso não era a causa do erro que a usuária viu.
- **A linha `pendente` de 01/10.** Ela conta na janela e expira sozinha em 1 hora/1 dia. Não há migração de
  limpeza: uma tentativa que ficou aberta por um defeito é informação, não lixo.
