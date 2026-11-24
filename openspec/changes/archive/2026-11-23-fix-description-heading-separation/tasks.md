# Tasks

## 1. Separação de cabeçalhos no HTML (`extrairTexto`)

- [x] 1.1 Em `extrairTexto`, aplicar `.before('\n')` e `.after('\n')` aos elementos de cabeçalho (`h1` a `h6`), garantindo que textos anteriores e posteriores fiquem em linhas separadas
- [x] 1.2 Adicionar testes unitários em `parsing.test.ts` verificando que cabeçalhos adjacentes a texto sem parágrafo envolvente não saem concatenados (ex.: `<h2>Descrição da vaga</h2>Texto corrido` vira duas linhas distintas)
- [x] 1.3 Rodar `npm run test:funcao` e confirmar que a suíte existente de `parsing` continua verde

## 2. Filtragem de cabeçalhos e termos de seção (`extrairListaDaDescricao`)

- [x] 2.1 Implementar normalização e lista de termos para identificação de títulos de seção de vagas ("descrição da vaga", "requisitos e qualificações", "sobre a empresa", "responsabilidades e atribuições", etc.)
- [x] 2.2 Descartar linhas que correspondam a esses títulos em `extrairListaDaDescricao`, impedindo que ingressem no array de requisitos
- [x] 2.3 Adicionar testes em `parsing.test.ts` comprovando que títulos de seção são descartados mesmo quando o texto total possui 8 ou menos linhas
- [x] 2.4 Rodar `npm run test:funcao` e verificar conformidade

## 3. Segmentação da seção de requisitos e validação integrada

- [x] 3.1 Implementar segmentação priorizada da seção de requisitos quando houver cabeçalho demarcador na descrição, ignorando texto institucional precedente
- [x] 3.2 Adicionar teste com a fixture baseada na estrutura real da vaga da Omie (apresentação institucional da empresa seguida de tópicos de requisitos), confirmando que apenas os requisitos entram no array
- [x] 3.3 Rodar `npm run verificar` e confirmar typecheck, vitest, pgTAP e testes da função verdes
