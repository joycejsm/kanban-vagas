# Tasks

## 1. Dependências e configuração base

- [ ] 1.1 Adicionar `next`, `react` e `react-dom` como dependências de produção e os tipos correspondentes (`@types/react`, `@types/react-dom`) como de desenvolvimento; verificar com `npm install` concluindo sem erro e `npm run typecheck` continuando sem erro
- [ ] 1.2 Adicionar Tailwind CSS e a configuração de PostCSS sem tocar em `tsconfig.json`; verificar com os arquivos de configuração criados e com `npm run typecheck` ainda passando
- [ ] 1.3 Adicionar ao README a seção de desenvolvimento local com `npm run dev` e o build de produção, mantendo a seção de testes existente; verificar com os comandos citados constando na documentação e com a seção de testes ainda descrevendo `npm run typecheck` e `npm test`

## 2. App Router, alias e rota raiz

- [ ] 2.1 Criar `src/app/layout.tsx` e `src/app/page.tsx` como Server Components mínimos, sem UI de produto e sem boilerplate de gerador; verificar com o build de produção concluindo e com uma requisição a `/` respondendo com status de sucesso e HTML
- [ ] 2.2 Estender o `tsconfig.json` para cobrir `.tsx` e habilitar JSX, preservando `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` e o alias `@/*` → `./src/*`; verificar com `tsc --noEmit` passando e com todas as opções estritas originais ainda presentes no arquivo
- [ ] 2.3 Criar um teste que importe um módulo de domínio por `@/` a partir de `tests/`, cobrindo o caso em que o alias resolve no vitest; verificar com `npm test` passando e com a suíte pré-existente de 34 testes ainda verde
- [ ] 2.4 Confirmar que `src/domain` e `src/services` permanecem nos mesmos caminhos e que nenhuma importação existente precisou mudar; verificar comparando a arvore de `src/` com a de antes da change e com `npm run typecheck` e `npm test` passando

## 3. Configuração do Supabase no servidor

- [ ] 3.1 Implementar o módulo único de configuração do servidor, lendo `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` e validando com Zod; verificar com testes unitários cobrindo as duas variáveis presentes, uma variável ausente e valor vazio
- [ ] 3.2 Fazer a falha de configuração produzir mensagem que nomeie a variável ausente e o `.env.local` como origem esperada, sem stack trace e sem valor de segredo; verificar com teste unitário afirmando o conteúdo da mensagem e a ausência de qualquer valor de configuração no texto
- [ ] 3.3 Consumir a configuração no servidor a partir da rota raiz, de modo que a ausência de variável em desenvolvimento interrompa a inicialização em vez de degradar silenciosamente; verificar com o servidor de desenvolvimento recusando subir com a mensagem da task 3.2 e subindo normalmente com as duas variáveis definidas
- [ ] 3.4 Atualizar o `.env.example` com a URL, a chave anon e comentários de orientação, mantendo a regra de que segredos não aparecem ali; verificar com o arquivo não contendo `GEMINI_API_KEY`, service role key nem nenhum valor real de segredo

## 4. Estilos

- [ ] 4.1 Configurar a folha de estilos globais com a diretiva de importação do Tailwind, resolvendo a partir de `src/app`; verificar com uma classe utilitária sendo emitida no CSS do build e aplicada ao elemento que a usa
- [ ] 4.2 Remover da rota raiz qualquer folha de estilo externa, cor de marca e boilerplate trazido pelo gerador; verificar com a folha de estilos da aplicação não carregando recurso externo por padrão

## 5. Verificação de integração

- [ ] 5.1 Rodar `npm run typecheck` e `npm test`, confirmando que os 34 testes pré-existentes das fases 1 e 2 continuam passando junto dos novos; verificar com a suíte completa sem falhas
- [ ] 5.2 Rodar o build de produção e confirmar que ele conclui sem erro e sem warning de tipo; verificar com a saída do build e com uma requisição a `/` no artefato gerado respondendo com status de sucesso
- [ ] 5.3 Inspecionar o bundle enviado ao navegador e confirmar que ele contém a chave anon e nenhum segredo; verificar com `GEMINI_API_KEY`, service role key e demais segredos ausentes do bundle e com nenhuma variável `NEXT_PUBLIC_*` nova criada além das duas já existentes
- [ ] 5.4 Confirmar que nenhuma decisão do scaffold impede a Fase 3: sem `middleware.ts`, sem CSP e sem cabeçalhos de segurança, todos sob responsabilidade de `add-nextjs-auth-and-server-actions`; verificar com a leitura dos arquivos criados e com a lista de dependências installadas
