# Spec Delta

## Purpose

Estabelecer a base executável da aplicação Next.js sobre a qual as fases de autenticação e de interface são
construídas: o projeto SHALL compilar, passar em verificação de tipos estrita, servir uma rota raiz e ler a
configuração do Supabase apenas no servidor, sem expor segredo algum ao cliente.

## ADDED Requirements

### Requirement: Aplicação compila e serve a rota raiz

O projeto SHALL conter uma aplicação Next.js com App Router, capaz de compilar em produção e de servir uma
página na rota `/`. A rota SHALL responder com sucesso em requisição HTTP anônima, com status de sucesso e
corpo HTML. A interface de produto — quadro Kanban, colunas e arrastar cards — SHALL NOT fazer parte desta
capacidade.

#### Scenario: Build de produção conclui

- **GIVEN** o repositório com o scaffold aplicado
- **WHEN** o build de produção é executado
- **THEN** ele SHALL concluir sem erro, sem warning de tipo e sem falhar na etapa de geração de páginas

#### Scenario: Rota raiz é servida

- **GIVEN** a aplicação em execução
- **WHEN** uma requisição anônima é feita para `/`
- **THEN** a resposta SHALL ter status de sucesso e corpo HTML renderizado pelo servidor, sem exigir
  JavaScript para exibir o conteúdo

#### Scenario: Verificação de tipos permanece estrita

- **GIVEN** o scaffold aplicado
- **WHEN** a verificação de tipos TypeScript é executada sobre `src/` e `tests/`
- **THEN** ela SHALL concluir sem erro, preservando as opções estritas já existentes no projeto, incluindo o
  tratamento de índice possivelmente indefinido e a checagem de sobrescrita explícita

#### Scenario: Suíte de testes existente continua passando

- **GIVEN** o scaffold aplicado
- **WHEN** a suíte de testes do projeto é executada
- **THEN** os testes das fases anteriores SHALL continuar passando, sem alteração do número de testes
  executados e sem necessidade de arquivos de teste novos para esta capacidade

### Requirement: Resolução de módulos compartilhada

A aplicação SHALL resolver o alias `@/*` para o diretório `src/` de forma consistente no typecheck, no build,
na execução do servidor e na execução dos testes. O mesmo alias SHALL continuar resolvendo os módulos de
domínio e de serviço já existentes, sem realocação de arquivos e sem alteração de como são importados.

#### Scenario: Import pelo alias resolve em todas as ferramentas

- **GIVEN** um módulo do projeto importado por `@/`
- **WHEN** o typecheck, o build, o servidor e a suíte de testes são executados
- **THEN** o mesmo caminho SHALL resolver nos quatro contextos, sem exigir configuração duplicada por
  ferramenta

#### Scenario: Código existente não é realocado

- **GIVEN** o scaffold aplicado
- **WHEN** o layout do repositório é inspecionado
- **THEN** os módulos de domínio e de serviço SHALL permanecer onde estão, com os mesmos caminhos e a mesma
  forma de importação usada antes do scaffold

### Requirement: Configuração do Supabase lida no servidor

A aplicação SHALL obter a URL do projeto Supabase e a chave anon a partir de variáveis de ambiente
existentes, e SHALL falhar de forma explícita e compreensível em desenvolvimento quando qualquer uma delas
estiver ausente. A leitura SHALL ocorrer apenas em código de servidor. O projeto SHALL NOT definir nenhuma
nova variável `NEXT_PUBLIC_*`, e nenhuma service role key SHALL estar acessível ao código da aplicação.

#### Scenario: Aplicação sobe com as variáveis presentes

- **GIVEN** as variáveis de URL e chave anon definidas no ambiente
- **WHEN** a aplicação é iniciada
- **THEN** ela SHALL obter a configuração sem erro e sem imprimir o valor das chaves

#### Scenario: Variável ausente é sinalizada em desenvolvimento

- **GIVEN** uma das variáveis de configuração ausente
- **WHEN** a aplicação é iniciada em desenvolvimento
- **THEN** ela SHALL falhar com mensagem que nomeie a variável ausente e o arquivo `.env.local` como origem
  esperada, sem stack trace e sem valor de qualquer segredo

#### Scenario: Nenhum segredo é exposto ao navegador

- **GIVEN** a aplicação compilada
- **WHEN** o bundle enviado ao navegador é inspecionado
- **THEN** ele SHALL NOT conter service role key, chave da API do Gemini nem qualquer outro segredo, e
  SHALL NOT conter nenhuma variável `NEXT_PUBLIC_*` além das duas já existentes
- **AND** a chave anon MAY constar dele a partir da Fase 3, quando existir cliente Supabase no navegador —
  neste scaffold ela é lida apenas no servidor e não é embutida em bundle algum

#### Scenario: Segredos não aparecem no exemplo de ambiente

- **GIVEN** o arquivo de exemplo de variáveis de ambiente
- **WHEN** seu conteúdo é inspecionado
- **THEN** ele SHALL conter apenas a URL, a chave anon e comentários de orientação, e SHALL NOT conter
  service role key, `GEMINI_API_KEY` nem qualquer valor real de segredo

### Requirement: Estilos utilitários disponíveis para a interface

O projeto SHALL fornecer as classes utilitárias de estilo Tailwind resolvidas a partir de `src/app`, para que
componentes de interface possam ser escritos sem configuração adicional por arquivo. Esta capacidade SHALL NOT
especificar cores, espaçamentos ou qualquer identidade visual — isso pertence à fase de interface.

#### Scenario: Classe utilitária é gerada e aplicada

- **GIVEN** um componente que usa uma classe utilitária do Tailwind
- **WHEN** a página é renderizada
- **THEN** o estilo correspondente SHALL ser emitido no CSS da página e aplicado ao elemento

#### Scenario: Nenhuma folha de estilo global de terceiro

- **GIVEN** o scaffold aplicado
- **WHEN** as folhas de estilo carregadas pela aplicação são inspecionados
- **THEN** nenhuma folha de estilo externa ao projeto SHALL ser carregada por padrão, e qualquer conteúdo
  de inicialização de bibliotecas de interface SHALL ser removido antes de a fase de interface começar
