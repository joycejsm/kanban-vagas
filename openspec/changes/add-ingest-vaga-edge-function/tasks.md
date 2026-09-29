# Tasks

## 1. Configuração da função e da migração de auditoria

- [x] 1.1 Criar `supabase/migrations/<timestamp>_ingest_log.sql` com a tabela de auditoria (`user_id` com `default auth.uid()` e `on delete cascade`, instante, host, resultado), `ENABLE` + `FORCE ROW LEVEL SECURITY`, policies `TO authenticated` para SELECT/INSERT com `(select auth.uid()) = user_id` e `REVOKE ALL ... FROM anon`; verificar com `supabase db push` aplicando sem erro e `pg_policies` listando as policies
- [x] 1.2 Criar `supabase/functions/ingest-vaga/deno.json` com as dependências (`@supabase/supabase-js`, `zod`, `cheerio`, `@google/genai`) e o import map para o módulo compartilhado `src/domain/vaga.ts`; verificar com `deno check` resolvendo todos os imports
- [x] 1.3 Criar `supabase/functions/ingest-vaga/index.ts` com o esqueleto do handler (CORS a partir de `APP_ORIGIN`, leitura do corpo, resposta JSON) e o `verify_jwt` habilitado; verificar respondendo `405` a `GET` e `200`/`422` a um `POST` com corpo inválido
- [x] 1.4 Criar `supabase/functions/ingest-vaga/_shared/env.ts` lendo `GEMINI_API_KEY`, `GEMINI_MODEL`, `ALLOWED_EMAILS` e `APP_ORIGIN` de `Deno.env`, com erro genérico quando algum faltar; verificar com teste unitário da função de leitura

## 2. Validação de URL anti-SSRF

- [x] 2.1 Implementar `validarUrl(url)` cobrindo https obrigatório, ausência de credenciais, porta vazia ou 443 e tamanho máximo de 2048; verificar com testes unitários rejeitando `http://`, `https://user:pass@host`, porta 8443 e URL de 2049 caracteres
- [x] 2.2 Implementar a rejeição de host não público literal e por sufixo (IPv4/IPv6 literais, `localhost`, `.local`, `.internal`); verificar com testes para `127.0.0.1`, `[::1]`, `localhost`, `169.254.169.254`, `servidor.local` e `api.internal`
- [x] 2.3 Implementar a resolução DNS (A e AAAA) e a verificação de faixas, tratando IPv4 mapeado em IPv6 e normalizando antes da comparação; verificar com testes usando um resolver injetado para cada faixa bloqueada (`0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `::1`, `fc00::/7`, `fe80::/10`, `::`) e com um caso aceito
- [x] 2.4 Implementar o caso "qualquer endereço não público recusa", com host resolvendo para um público e um privado; verificar com teste confirmando recusa
- [x] 2.5 Documentar no cabeçalho de `validarUrl` o risco residual de DNS rebinding e a mitigação (sem rede privada, corpo bruto nunca devolvido); verificar com leitura do arquivo

## 3. Fetch com limite, timeout e redirects revalidados

- [x] 3.1 Implementar a busca com `redirect: 'manual'`, `AbortSignal.timeout(8000)` e User-Agent identificável; verificar com testes usando `fetch` injetado confirmando as opções passadas
- [x] 3.2 Implementar a leitura do stream com teto de 1,5 MB, abortando via `AbortController` ao ultrapassar e abortando imediatamente quando o `Content-Length` já excede o teto; verificar com testes para corpo de 50 MB (abortado) e para `Content-Length` declarado acima do teto
- [x] 3.3 Verificar o `content-type` e recusar tudo que não seja `text/html`; verificar com testes para `application/pdf` e `image/png`
- [x] 3.4 Implementar o seguimento manual de no máximo 3 redirects, revalidando cada destino com `validarUrl`; verificar com testes para redirect público válido, redirect para `169.254.169.254` (bloqueado) e cadeia de 4 redirects (interrompida)

## 4. Parsing com Cheerio e extração estruturada

- [x] 4.1 Implementar a limpeza do HTML removendo `script`, `style`, `noscript`, `iframe`, comentários e elementos ocultos por `hidden`, `aria-hidden` ou estilo; verificar com testes garantindo que conteúdo de script e de bloco oculto não aparece no texto extraído
- [x] 4.2 Implementar a normalização de espaços e o truncamento em 12.000 caracteres; verificar com testes para texto longo e para texto com espaços repetidos
- [x] 4.3 Implementar a extração de `application/ld+json` com `@type: JobPosting`, tolerando campos que são string, objeto ou array; verificar com testes para o caso completo e para campos aninhados
- [x] 4.4 Implementar a regra de precedência: `ld+json` suficiente encerra o pipeline sem chamar o modelo; verificar com teste usando um cliente Gemini mockado e afirmando que ele não foi chamado

## 5. Extração via Gemini

- [x] 5.1 Implementar a montagem do prompt com nonce por requisição, remoção de `<conteudo_vaga` do texto e marcadores delimitando o conteúdo; verificar com testes conferindo que o nonce muda entre chamadas e que o padrão de marcador não aparece no texto enviado
- [x] 5.2 Implementar a `system_instruction` fixa declarando que o conteúdo é apenas dado, que instruções internas devem ser ignoradas e que a saída é somente JSON; verificar com teste conferindo o texto da instrução
- [x] 5.3 Configurar a chamada com `responseMimeType: application/json`, `responseSchema` de `titulo`/`empresa`/`requisitos`/`senioridade`, temperatura baixa, `maxOutputTokens` limitado e sem tools; verificar com teste mockado conferindo as opções passadas e confirmando que o schema não tem campo de URL
- [x] 5.4 Implementar a validação da saída com `VagaCreateInput.safeParse`, combinando com a URL da requisição; verificar com testes para saída válida, título acima de 200 caracteres, `senioridade` inválida e senioridade ausente assumindo o padrão
- [x] 5.5 Verificar que a URL persistida é a da requisição e que uma URL devolvida pelo modelo é descartada; verificar com teste onde a resposta do modelo traz `url` diferente

## 6. Autenticação, allowlist e rate limit

- [x] 6.1 Implementar a validação do usuário com `getUser(jwt)` e a resposta `401` para token ausente ou inválido; verificar com testes mockados para token válido, token inválido e ausência de cabeçalho `Authorization`
- [x] 6.2 Implementar a verificação de `ALLOWED_EMAILS` com comparação case-insensitive e `trim`, encerrando o acesso e respondendo `403`; verificar com testes para e-mail autorizado, e-mail fora da lista e e-mail com caixa/s espaços diferentes
- [x] 6.3 Implementar o registro da tentativa em `ingest_log` e a checagem dos limites de 20/hora e 100/dia antes de qualquer fetch; verificar com testes mockados para dentro do limite, no limite horário excedido e no limite diário excedido

## 7. Persistência e resposta

- [x] 7.1 Implementar a inserção com cliente Supabase criado a partir do JWT, definindo `status` `aplicado` e `ordem` no fim da coluna, calculada a partir do máximo da coluna; verificar com teste mockado conferindo o payload enviado e confirmando que nenhum segredo é usado
- [x] 7.2 Traduzir violação de unicidade para `409` e falhas inesperadas para mensagem genérica; verificar com testes para 23505 e para erro genérico, confirmando que a resposta não contém SQL nem stack trace
- [x] 7.3 Implementar o encadeamento do pipeline com falha na primeira etapa e código de erro correspondente; verificar com teste que um e-mail fora da allowlist resulta em `403` e que nenhuma etapa posterior é executada
- [x] 7.4 Implementar o log restrito a host, duração, etapa e usuário truncado; verificar com teste que uma falha e um sucesso não registram conteúdo raspado, texto colado, token, chave de API nem e-mail

## 8. Verificação de integração

- [ ] 8.1 Adicionar ao README a seção da função com os secrets necessários, o comando de deploy e o aviso de pré-requisitos manuais; verificar que os comandos citados constam na documentação
- [ ] 8.2 Rodar o typecheck do projeto e a suíte de testes, e `deno check` na função, confirmando que tudo passa; registrar a saída
- [ ] 8.3 Rodar `supabase test db` garantindo que os testes de RLS da Fase 1 continuam passando com a nova migração aplicada; verificar com a suíte completa sem falhas
