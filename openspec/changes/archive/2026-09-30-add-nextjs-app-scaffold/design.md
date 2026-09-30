# Design

## Context

Ver `proposal.md` para o porquê. O estado que obriga as decisões abaixo: o repositório tem `package.json` com
`type: module`, scripts próprios e dependências de domínio; tem `tsconfig.json` com `strict`,
`noUncheckedIndexedAccess`, `noImplicitOverride` e o alias `@/*` → `./src/*`; tem `vitest.config.ts` com o mesmo
alias; e tem `tests/` com 34 testes que passam. Não tem nada de Next.js.

A Fase 3 (`add-nextjs-auth-and-server-actions`) tem 11 decisões de design prontas que **presupõem** um app em
funcionamento, e a Fase 4 (`add-kanban-ui`) ainda nem foi planejada. Ver as specs desta change para o
comportamento observável; aqui está o como.

## Goals / Non-Goals

**Goals:**

- Deixar a Fase 3 decidir coisas de segurança, não consertar o app.
- Preservar byte a byte o que já funciona: os 34 testes, o alias, os módulos de domínio e serviço.
- Deixar o repositório num estado em que `npm run typecheck` e `npm test` continuam sendo os comandos de
  verificação, sem um segundo runner de teste.

**Non-Goals:**

- Não definir a Content Security Policy nem os cabeçalhos de hardening — especificados na Fase 3
  (capability `security-headers`, decisão D9). O `next.config` nasce configurável, sem a política.
- Não criar `middleware.ts` — é D1 da Fase 3 e carrega a proteção de rotas e a allowlist.
- Não criar cliente Supabase no navegador nem no servidor — a Fase 3 decide o padrão `@supabase/ssr` junto com
  o ciclo de vida do cookie de sessão.
- Não construir UI de produto. A rota `/` é um Server Component mínimo.

## Decisions

### D1 — Scaffold manual a partir do que existe, não `create-next-app` em diretório não vazio

O caminho óbvio é rodar `create-next-app` no repositório. Ele recusa diretórios com arquivos conflitantes — e
`package.json`, `tsconfig.json` e `src/` já existem. Rodar com flags para preservar o diretório ainda obece a
uma nobreza: o comando **reescreve o `tsconfig.json`**, e o `tsconfig` deste projeto tem deliberatemente mais
`strict` do que o padrão do Next (tem `noUncheckedIndexedAccess` e `noImplicitOverride`, que o Next não adiciona
sozinho). Aceitar a reescrita significa perdê-los em silêncio, e o próximo `tsc --noEmit` passa a validar um
projeto menos estricto do que o que os testes das fases 1 e 2 assumem.

Além disso, `create-next-app` em um repositório ESM com `"type": "module"` e dependências de domínio precisa de
cuidado manual, e ele traz um `eslint` próprio, um favicon e um boilerplate de imagem que este projeto não usa.

**Alternativa:** `create-next-app` em diretório temporário e cópia seletiva do que serve (`src/app`, Tailwind,
`postcss.config`). **Rejeitada** — o ganho é pequeno e ela reintroduz a reescrita do `tsconfig`, que é exatamente
o risco que se quer eliminar.

A consequência aceita: o scaffold é escrito à mão. É mais texto, mas cada arquivo é uma decisão revisável em vez
de um default de gerador.

### D2 — App Router em `src/app`, para preservar o alias `@/*`

O App Router funciona em `app/` ou `src/app/`. Este projeto usa `src/app/` porque o alias `@/*` → `./src/*` já
está em `tsconfig.json` e em `vitest.config.ts`, e `src/domain` e `src/services` já vivem sob `src/`. Com
`src/app/`, o mesmo alias serve código de produto, código de domínio e testes, sem segunda configuração.

**Alternativa:** `app/` na raiz, como o Next sugere por padrão. **Rejeitada** — passaria a exigir
`@/*` → `./*` ou um alias paralelo, e a duplicar a configuração do alias em `tsconfig`, `vitest.config` e no
resolução do runtime. Duas fontes de verdade para o mesmo alias é exatamente o tipo de coisa que quebra em
silêncio depois.

### D3 — O alias é declarado em um lugar só, mas cada ferramenta lê o seu

O alias continua declarado em `tsconfig.json` (para o typecheck e para o Next) e em `vitest.config.ts` (para os
testes, que rodam fora do Next). Isso é duplicação, e é aceito: o vitest não lê `paths` do `tsconfig` por padrão,
e configurar o resolver para fazê-lo adiciona um plugin ao projeto inteiro para poupar uma linha.

**Margem:** a duplicação é um risco real de divergência — alguém muda `tsconfig` e esquece o vitest. A mitigação
é um teste que importa por `@/` um módulo de domínio: se os dois lados divergirem, o teste falha. Custa uma
importação e cobre exatamente o erro que a duplicação permite.

### D4 — Configuração do Supabase lida por módulo único no servidor, validado com Zod

Um módulo de configuração do servidor lê as duas variáveis, valida com Zod — reutilizando a dependência e a
convenção de que toda entrada externa passa por schema com limites — e falha com mensagem nomeando a variável
ausente e o `.env.local`.

**Alternativa:** ler `process.env` inline em cada componente. **Rejeitada** — espalha a chance de `undefined`
não tratado e duplica a mensagem de erro em N lugares.

A falha é ruidosa de propósito. O comportamento observável está em `specs/app-scaffold/spec.md`, na requirement
de configuração: mensagem compreensível, sem stack trace, sem valor de segredo. Silenciar e cair num default
seria pior — a aplicação subiria sem Supabase e falharia mais tarde, em um lugar que não aponta para a causa.

### D5 — Sem dependência que nada importa

`@supabase/ssr` e `@dnd-kit` ficam de fora. Nenhum código desta change os importa; ambas são adicionadas pela
change que passa a usá-las (`add-nextjs-auth-and-server-actions` e `add-kanban-ui`).

**Alternativa:** instalá-las já. **Rejeitada** — dependência não importada é dívida sem contrapartida: entra na
superfície de atualização, aparece no `npm audit` e no bundle de produção sem uso. A vantagem real de instalar
cedo seria um lockfile com um commit a menos, o que não compensa.

O `.env.example` é atualizado nesta change porque a **leitura** é daqui; o fato de a Fase 3 consumir a mesma
configuração não muda quem a valida.

### D6 — Nenhum segredo novo, nenhuma variável `NEXT_PUBLIC_*` nova

A URL do Supabase e a chave anon são as duas variáveis que o app lê, e ambas já existem. A chave anon é pública
por definição e inofensiva sem RLS — e o RLS já está no banco, testado. `GEMINI_API_KEY` e a service role key
pertencem às secrets do Supabase e nunca aparecem no ambiente do Next.

Isso preserva as invariantes 1 e 3 de `openspec/project.md`. Vale notar a assimetria: a Fase 3 vai passar a
validar sessão e a Fase 4 a expor dados no cliente, mas nenhuma delas introduz material secreto novo — a chave
anon já era pública. O risco do scaffold não é expor segredo, é criar o precedente de que "variável do Next" é
sinônimo de "pode ser pública".

### D7 — Verificação de integração é `npm run typecheck` e `npm test`, os mesmos de antes

O scaffold não introduz um segundo runner. O vitest continua cobrindo `tests/`, e o typecheck continua
`tsc --noEmit` sobre `src/` e `tests/`. O build de produção entra como verificação **manual** do apply, não como
script novo: ele é lento e não é o caminho de verificação de todo dia.

**Consequência aceita:** o `tsc --noEmit` não conhece os tipos de JSX nem os módulos do Next, porque `types` no
`tsconfig` é `["node"]` e o include é `src/**/*.ts`, sem `.tsx`. Isso é dealt com na task de typecheck: o
include passa a cobrir `.tsx` e o typecheck deixa de ser um proxy incompleto do build. A alternativa — deixar
o `.tsx` de fora e aceitar que o typecheck não enxerga a UI — foi rejeitada porque o typecheck mentiria sobre a
metade do código que a Fase 4 vai escrever.

## Risks / Trade-offs

- **[Reescrita de arquivos existentes durante o scaffold]** → `src/domain` e `src/services` não são tocados; a
  task de verificação confirma que os 34 testes pré-existentes continuam passando (o total cresce, porque esta
  change acrescenta testes próprios, mas nenhum anterior pode sumir). O `tsconfig` ganha apenas entradas,
  nunca perde as estritas.
- **[`"type": "module"` e o Next]** → O Next suporta projetos ESM; a verificação é o build de produção na task
  final. Se falhar, o ajuste é pontual e não muda nenhuma decisão de design.
- **[CSP sem `unsafe-inline` é tensionada pela hidratação do App Router]** → O App Router injeta scripts
  inline para os dados de hidratação. Resolver isso exige nonce gerado no servidor, que é o `middleware.ts` da
  Fase 3 (D1) e a política do D9. O scaffold **não** adiciona nonce nem middleware — apenas não toma nenhuma
  decisão que impeça a Fase 3 de fazê-lo. Registrado aqui porque é o acoplamento real entre as duas changes.
- **[Tailwind removendo a identidade visual padrão]** → A página inicial traz o boilerplate do gerador
  removido, sem cor de marca. A Fase 4 define a identidade.
- **[O `.env.local` não existe no repositório]** → É um pré-requisito manual já documentado no README, e
  verificável por `npm run dev` acusando a variável ausente com mensagem explícita (D4).
- **[A Fase 3 assume um app que este change entrega]** → Se o scaffold for adiado, a Fase 3 planeja contra um
  alvo que não existe. Por isso esta change vem antes dela, e não em paralelo.

## Migration Plan

Sem migração de dados e sem mudança de infraestrutura: nada é publicado e nenhuma tabela é tocada. O rollback é
reverter o commit — o scaffold só adiciona arquivos e dependências de frontend, e o código das fases 1 e 2 é
preservado, então o repositório volta ao estado anterior sem perda.

A única observação de rollback: se o lockfile for revertido junto, as dependências de frontend saem e o
`package.json` volta a ter apenas `@supabase/supabase-js` e `zod`, que é o estado anterior conhecido e funcional.

## Open Questions

- **Versão do Tailwind:** a versão maior vigente traz a configuração via `@import` e plugin PostCSS próprio, o
  que muda a forma do arquivo de estilos. A escolha da versão pode ser feita na implementação sem alterar
  spec, abordagem ou decomposição de tasks — a spec pede que as classes utilitárias resolvam, não qual versão
  as produz.
