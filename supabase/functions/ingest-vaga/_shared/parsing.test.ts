import { assertEquals } from 'jsr:@std/assert@1';
import { describe, it } from 'jsr:@std/testing@1/bdd';

import {
  extrairLdJson,
  extrairListaDaDescricao,
  extrairTexto,
  LIMITE_TEXTO_MODELO,
  normalizarEspacos,
} from './parsing.ts';

const PAGINA_COM_SCRIPT = `
<html>
  <head>
    <title>Vaga</title>
    <script>var tracking = "https://segredo.com/nao-extrair"; alert('inject')</script>
    <style>.oculto { display: none }</style>
  </head>
  <body>
    <h1>Engenheira de Software</h1>
    <p>Empresa X</p>
    <div class="oculto">TEXTO QUE DEVERIA SUMIR display:none</div>
    <div style="display: none">TAMBEM ESCONDIDO</div>
    <div aria-hidden="true">HIDDEN VIA ARIA</div>
    <div hidden>ATRIBUTO HIDDEN</div>
    <noscript>ATIVE JAVASCRIPT</noscript>
    <iframe src="https://ads.com/frame">CONTEUDO DE IFRAME</iframe>
    <!-- comentario que nao deve aparecer -->
    <ul>
      <li>TypeScript</li>
      <li>Postgres</li>
      <li>React</li>
    </ul>
  </body>
</html>`;

describe('limpeza do HTML', () => {
  it('remove conteúdo de script, style, noscript e iframe', () => {
    const texto = extrairTexto(PAGINA_COM_SCRIPT);

    assertEquals(texto.includes('segredo.com'), false);
    assertEquals(texto.includes('alert'), false);
    assertEquals(texto.includes('ACTIVE JAVASCRIPT'), false);
    assertEquals(texto.includes('ads.com'), false);
    assertEquals(texto.includes('CONTEUDO DE IFRAME'), false);
  });

  it('remove comentários HTML', () => {
    assertEquals(extrairTexto(PAGINA_COM_SCRIPT).includes('comentario que nao deve'), false);
  });

  it('remove elementos ocultos por atributo e por estilo', () => {
    const texto = extrairTexto(PAGINA_COM_SCRIPT);

    assertEquals(texto.includes('TEXTO QUE DEVERIA SUMIR'), false);
    assertEquals(texto.includes('TAMBEM ESCONDIDO'), false);
    assertEquals(texto.includes('HIDDEN VIA ARIA'), false);
    assertEquals(texto.includes('ATRIBUTO HIDDEN'), false);
  });

  it('preserva o texto visível da vaga', () => {
    const texto = extrairTexto(PAGINA_COM_SCRIPT);

    assertEquals(texto.includes('Engenheira de Software'), true);
    assertEquals(texto.includes('TypeScript'), true);
    assertEquals(texto.includes('Postgres'), true);
  });
});

describe('normalização de texto', () => {
  it('colapsa espaços repetidos', () => {
    assertEquals(normalizarEspacos('a    b\t\tc'), 'a b c');
  });

  it('remove linhas vazias e espaços nas pontas', () => {
    assertEquals(normalizarEspacos('  a  \n\n\n  b  \n'), 'a\nb');
  });

  it('trunca em 12.000 caracteres', () => {
    const longo = '<div>' + 'palavra '.repeat(5_000) + '</div>';
    const texto = extrairTexto(longo);

    assertEquals(texto.length <= LIMITE_TEXTO_MODELO, true);
    assertEquals(LIMITE_TEXTO_MODELO, 12_000);
  });

  it('separa itens de listas em linhas distintas', () => {
    const texto = extrairTexto('<ul><li>TypeScript</li><li>Postgres</li></ul>');

    assertEquals(texto.includes('TypeScript'), true);
    assertEquals(texto.includes('Postgres'), true);
  });
});

describe('extrairLdJson — caminho estruturado', () => {
  it('extrai JobPosting completo e dispensa o LLM', () => {
    const html = `
      <html><body>
        <script type="application/ld+json">
          ${JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'JobPosting',
            title: 'Engenheira de Software Sênior',
            hiringOrganization: { '@type': 'Organization', name: 'Empresa X' },
            description: 'Vaga para acting em produto.',
            requirements: ['TypeScript', 'PostgreSQL', 'Testes'],
            experienceRequirements: 'Sênior',
          })}
        </script>
      </body></html>`;

    const vaga = extrairLdJson(html);

    assertEquals(vaga !== null, true);
    assertEquals(vaga?.titulo, 'Engenheira de Software Sênior');
    assertEquals(vaga?.empresa, 'Empresa X');
    assertEquals(vaga?.requisitos, ['TypeScript', 'PostgreSQL', 'Testes']);
    assertEquals(vaga?.senioridade, 'Senior');
  });

  it('tolera @graph e arrays aninhados', () => {
    const html = `
      <script type="application/ld+json">
        ${JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebSite', name: 'Site' },
            {
              '@type': 'JobPosting',
              title: 'Analista de Dados',
              hiringOrganization: { name: 'Empresa Y' },
              requirements: ['SQL', 'Python'],
            },
          ],
        })}
      </script>`;

    const vaga = extrairLdJson(html);

    assertEquals(vaga?.titulo, 'Analista de Dados');
    assertEquals(vaga?.empresa, 'Empresa Y');
  });

  it('tolera @type como array', () => {
    const html = `
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': ['JobPosting', 'Thing'],
          title: 'DevOps',
          hiringOrganization: { name: 'Empresa Z' },
          requirements: ['Kubernetes'],
        })}
      </script>`;

    assertEquals(extrairLdJson(html)?.titulo, 'DevOps');
  });

  it('infere senioridade do título quando não há campo explícito', () => {
    const html = `
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'JobPosting',
          title: 'Desenvolvedor Pleno',
          hiringOrganization: { name: 'Empresa Q' },
          requirements: ['Node'],
        })}
      </script>`;

    assertEquals(extrairLdJson(html)?.senioridade, 'Pleno');
  });

  it('assume "Não informado" quando não dá para inferir', () => {
    const html = `
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'JobPosting',
          title: 'Pessoa Genericamente Utíl',
          hiringOrganization: { name: 'Empresa R' },
          requirements: ['Comunicação'],
        })}
      </script>`;

    assertEquals(extrairLdJson(html)?.senioridade, 'Não informado');
  });

  it('extrai requisitos da descrição quando não há lista estruturada', () => {
    const html = `
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'JobPosting',
          title: 'Backend',
          hiringOrganization: { name: 'Empresa S' },
          description: '- Node.js e TypeScript\n- PostgreSQL\n- Docker',
        })}
      </script>`;

    assertEquals(extrairLdJson(html)?.requisitos, ['Node.js e TypeScript', 'PostgreSQL', 'Docker']);
  });
});

describe('extrairLdJson — quando NÃO deve usar o caminho estruturado', () => {
  it('devolve null sem JobPosting', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Article', title: 'Blog' })}</script>`;

    assertEquals(extrairLdJson(html), null);
  });

  it('devolve null quando falta título', () => {
    const html = `
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'JobPosting',
          hiringOrganization: { name: 'Empresa T' },
          requirements: ['Java'],
        })}
      </script>`;

    assertEquals(extrairLdJson(html), null);
  });

  it('devolve null quando não há requisitos', () => {
    const html = `
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'JobPosting',
          title: 'Cargo',
          hiringOrganization: { name: 'Empresa U' },
        })}
      </script>`;

    assertEquals(extrairLdJson(html), null);
  });

  it('ignora JSON-LD malformado sem quebrar', () => {
    const html = `<script type="application/ld+json">{quebrado</script>`;

    assertEquals(extrairLdJson(html), null);
  });

  it('ignora ld+json que não seja de vaga', () => {
    assertEquals(extrairLdJson('<html><body>sem nada</body></html>'), null);
  });
});

describe('extração de requisitos da descrição', () => {
  it('reconhece bullets', () => {
    const itens = extrairListaDaDescricao('- React\n- Node\n- CSS');

    assertEquals(itens, ['React', 'Node', 'CSS']);
  });

  it('reconhece bullets com símbolos alternativos', () => {
    assertEquals(extrairListaDaDescricao('• React\n* Node\n▪ CSS'), ['React', 'Node', 'CSS']);
  });

  it('cai para divisão por vírgula quando não há bullets', () => {
    const itens = extrairListaDaDescricao('React, Node, PostgreSQL');

    assertEquals(itens, ['React', 'Node', 'PostgreSQL']);
  });

  it('descarta entradas vazias e muito longas', () => {
    const itens = extrairListaDaDescricao('- React\n-\n- ' + 'x'.repeat(300) + '\n- Node');

    assertEquals(itens.includes('React'), true);
    assertEquals(itens.some((i) => i.length > 200), false);
  });

  it('limita a 30 itens', () => {
    const descricao = Array.from({ length: 50 }, (_, i) => `- skill-${i}`).join('\n');

    assertEquals(extrairListaDaDescricao(descricao).length <= 30, true);
  });
});
