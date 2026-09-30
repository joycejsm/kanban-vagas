# Handoff — Kanban de Vagas

Estado em 2026-09-30, ao fim da sessão que arquivou as changes do scaffold do app e da autenticação
(Server Actions), promovendo 6 specs a `openspec/specs/`.

## Onde o repositório está

Fases 1, 2 e 3 implementadas. `main` com o código da Fase 3 em `c7d25b2`; o archive das changes e a
promoção das specs entram no commit desta sessão.

| Change | Estado |
|---|---|
| `add-vaga-domain-and-persistence` | arquivada (2026-09-29) |
| `add-ingest-vaga-edge-function` | arquivada (2026-09-29) |
| `sync-fase2-contract-into-vaga-specs` | arquivada (2026-09-29) |
| `add-nextjs-app-scaffold` | arquivada (2026-09-30), 17/17 |
| `add-nextjs-auth-and-server-actions` | arquivada (2026-09-30), 39/40 — falta a 9.4 |
| `add-kanban-ui` | ativa e **vazia**: nenhum artefato |

`openspec/specs/` tem 13 capabilities. As 6 promovidas nesta sessão: `app-scaffold`, `auth-routing`,
`auth-callback`, `access-allowlist`, `security-headers` e `vaga-server-actions`.

## Verificação de referência

| Suíte | Comando | Estado |
|---|---|---|
| Tipos | `npm run typecheck` | sem erros |
| Vitest | `npm test` | 178 passed (13 arquivos) |
| Deno | `deno task --cwd supabase/functions/ingest-vaga test` | 35 passed |
| Deno tipos | `deno task --cwd supabase/functions/ingest-vaga check` | limpo |
| Specs | `openspec validate --specs` | 13 passed, 0 failed |
| RLS / allowlist (pgTAP) | `supabase test db` | **44 passed, 0 failed** (rodado contra o stack local) |

## Bloqueio atual: o estado real do banco é desconhecido

O `supabase` CLI foi instalado nesta sessão (2.118.0, via `npm i -g supabase`), mas **não há
credencial para falar com o projeto**: `supabase/.temp/` não tem `project-ref` e não existe
`SUPABASE_ACCESS_TOKEN` no ambiente. O workspace do Infisical apontado por `.infisical.json`
(`58744729-…`) contém **uma única chave, `OPENROUTER_API_KEY`** — nenhuma das chaves do Supabase,
apesar de a task 1.5 afirmar que as credenciais vieram de lá.

Consequência: **nenhuma migração foi comprovadamente aplicada no projeto real.** As três migrações
(`vagas.sql`, `ingest_log.sql`, `allowed_emails.sql`) e os dois arquivos pgTAP
(`vagas_rls.sql`, `auth_allowlist.sql`) nunca foram exercitados contra um banco. As tasks 4.1–4.3
declaram verificação por `supabase db push` e `supabase test db` que **não chegou a acontecer**.

Isso é o que torna a 9.4 enganosa se ela for lida sozinha: o callback do Next aplica a allowlist no
login e pode passar, **sem que a segunda camada (hook do banco) exista**. Para considerar a barreira
completa, rode `supabase db push` e `supabase test db` antes.

### O que o stack local já provou (e o que ele não prova)

Um stack Supabase **local** estava de pé nesta sessão (`supabase_db_kanban-vagas` e mais nove
containers). Ele tem as 3 migrações aplicadas, as 4 policies de `public.vagas` e a tabela
`public.allowed_emails`. `supabase test db` contra ele passou com **44 asserções, 0 falhas**
(`vagas_rls.sql` e `auth_allowlist.sql`).

O que isso fecha: os SQLs aplicam limpo, o RLS isola como a spec exige e o hook da allowlist rejeita
e-mail fora da lista — as tasks 4.1–4.3 têm evidência. O que **não** fecha: nada disso diz respeito ao
projeto em `https://lpibbdvxpsqqujmnqydk.supabase.co`, que segue sem banco. O `project-ref` está
disponível (é público, sai da `NEXT_PUBLIC_SUPABASE_URL`); falta apenas a credencial de API.

**Como destravar** (nunca colar token no chat — regra do projeto):

1. `supabase login` em um terminal interativo do próprio usuário, ou
2. gravar `SUPABASE_ACCESS_TOKEN` e a senha do banco em um arquivo ignorado pelo git e apontar o
   `supabase link` para ele.

Depois: `supabase link --project-ref <ref>` → `supabase db push` → `supabase test db`.

## O que falta resolver, em ordem

1. **Estado do banco de verdade** — `supabase link`, `supabase db push`, `supabase test db`
   (item anterior). Sem isso, RLS e hook da allowlist são código não verificado.
2. **Task 9.4** — ciclo real de login no navegador, com as credenciais do Infisical. E-mail em
   `ALLOWED_EMAILS` chega à raiz autenticado com sessão persistente; e-mail fora da lista é
   encerrado no callback e cai em `/login?erro=nao_autorizado`. Remover a sessão de teste do usuário
   não autorizado ao final. É a única task em aberto da Fase 3, e ela está arquivada como `[ ]` em
   `openspec/changes/archive/2026-09-30-add-nextjs-auth-and-server-actions/tasks.md:66`.
3. **Ativar o hook no painel** — passo manual, documentado no README, não automatizável. Sem ele, a
   segunda camada da allowlist não existe mesmo com a tabela aplicada.
4. **Fase 4** — `opsx propose add-kanban-ui`. Consome a spec de "Posição de entrada da vaga no quadro"
   em `vaga-persistence`.

## Correção de spec feita nesta sessão — leia antes de mexer na CSP

O delta de `security-headers` e o título do D9 no `design.md` estavam **para trás do código**:
descreviam `script-src 'self'` sem `unsafe-eval`, enquanto `src/config/csp.ts` emite
`'self' 'nonce-<valor>'` e acrescenta `'unsafe-eval'` fora de produção.

A decisão em si já estava correta no design (D9 tem um parágrafo "Correção" explicando por que
`script-src 'self'` puro quebra o App Router) e nos testes (`tests/config/csp.test.ts` reproduz a
quebra real). O que estava desatualizado era o texto do requisito, os cenários e o bullet de risco
`['CSP sem nonce']`. As três coisas foram reescritas antes de promover a spec, e a spec promovida
agora diz: nonce por resposta, nunca reutilizado; `'unsafe-inline'` proibido sempre;
`'unsafe-eval'` ausente em produção.

**Quem for mexer na CSP deve ler o cabeçalho de `src/config/csp.ts` antes do spec** — o comentário
longo ali documenta três armadilhas (o `InvariantError` do App Router, o hash estático que não serve
para *flight payload*, e o `eval()` do React de dev) que o spec não reexplica.

## Incidente de segredo nesta sessão

Ao listar o Infisical com `infisical secrets`, o CLI imprimiu o **valor** de
`OPENROUTER_API_KEY` em texto claro no terminal, e ele ficou registrado na transcrição da sessão.
O correto seria `infisical export | jq 'keys'`. **Recomenda-se rotacionar essa chave.** Nenhum valor
de token ou e-mail do projeto foi reportado.

## Armadilhas do ambiente (custaram tempo)

1. **`pkill -f "next dev"` mata o próprio shell.** Use `pkill -f "[n]ext dev"`.
2. **A porta 3000 pode estar ocupada por processo alheio**; o Next sobe na 3002 em silêncio. Use
   `PORT=` explícito ao testar.
3. **`deno fmt --check` reprova os 17 arquivos da função**, inclusive os 16 preexistentes: o projeto
   usa aspas simples e não adota o fmt do Deno. **Não "conserte"** — siga a convenção do projeto.
4. **O `next build` reinjecta `allowJs: true` no `tsconfig.json` a cada build.** É inerte (o
   `include` não cobre nenhum `.js`) e o arquivo fica estável entre builds.
5. **O vitest só coleta `tests/**/*.test.ts`** — não `.tsx`. Testes com JSX precisam ir para fora
   desse glob, ou o glob ser ampliado.
6. **`tsc --noEmit` não cobre `supabase/functions/`** (está no `exclude`). Código Deno só é
   validado por `deno check`.
7. **A 9.4 não é verificável em CI.** É o ciclo OAuth real; os testes cobrem o comportamento por
   injeção de dublês, não o handshake com o Google.

## Regra de ouro do projeto

Specs descrevem comportamento observável e são a fonte única de verdade; código diverge de spec é
bug de spec **ou** de código, e a divergência se resolve escrevendo — nunca ajustando o teste para
caber. A 9.4 da fase 2 falhou na primeira execução porque a asserção estava errada (o Supabase
propaga o erro cru, não um `Error`), e a correção foi no teste.
