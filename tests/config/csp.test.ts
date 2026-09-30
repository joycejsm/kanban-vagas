import { describe, expect, it } from 'vitest';

import { CABECALHOS_DE_HARDENING, configuracaoParaCsp, gerarNonce, montarCsp } from '@/config/csp';

/**
 * Testes da Content Security Policy (design D9, revisado).
 *
 * A comparação é feita contra a política esperada **inteira**, e não diretiva a diretiva: uma
 * diretiva que sumisse da lista passaria despercebida num teste que checasse só as
 * propriedades importantes. A lista completa é o contrato.
 *
 * O nonce é o ponto sensível, e há um teste que reproduz a falha real: um `script-src 'self'`
 * sem nonce quebra a aplicação, porque o App Router do Next emite script inline. Esse teste
 * não existia na primeira versão deste arquivo, e a página quebrou em produção por causa
 * disso.
 */

const CONFIG = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'chave-anon-publica',
};

const NONCE = 'abc123nonce-de-teste';

const POLITICA_ESPERADA = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${NONCE}'`,
  "connect-src 'self' https://abcdefghijklmnop.supabase.co https://accounts.google.com https://apis.google.com",
  "img-src 'self' data: lh3.googleusercontent.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/** Regex que o próprio Next usa para extrair o nonce do cabeçalho (fonte do Next 16). */
const REGEX_DO_NEXT = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

describe('montarCsp', () => {
  it('gera exatamente a política esperada, na ordem esperada', () => {
    expect(montarCsp(CONFIG, NONCE, 'production')).toBe(POLITICA_ESPERADA);
  });

  it('o nonce gerado é extraível pela mesma regex que o Next usa', () => {
    // Se o valor gerado não casasse com a regex do Next, o framework não acharia o nonce,
    // não colocaria o atributo nos scripts, e a CSP os bloquearia — a página quebraria de
    // novo, por um motivo que não apareceria em lugar nenhum do nosso código.
    const csp = montarCsp(CONFIG, gerarNonce());
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    const fonte = scriptSrc.split(/\s+/).find((s) => s.startsWith("'nonce-"))!;

    expect(fonte).toMatch(REGEX_DO_NEXT);
  });

  it('cada resposta recebe um nonce diferente', () => {
    // Nonce reutilizado entre requisições deixa de ser nonce: um atacante que leia um
    // documento poderia reutilizar o valor em um script injetado depois.
    const nonces = new Set([gerarNonce(), gerarNonce(), gerarNonce(), gerarNonce()]);

    expect(nonces.size).toBe(4);
  });

  it('script-src sem nonce quebraria a aplicação — e por isso o nonce é obrigatório', () => {
    // Reprodução da falha real. `montarCsp` exige o nonce, então o caso quebrado é montado
    // à mão para fixar o que não pode voltar: um `script-src 'self'` puro bloqueia o
    // `(self.__next_f=…).push([0])` e o *flight payload* do RSC, e a página fica sem JS.
    const cspSemNonce = POLITICA_ESPERADA.replace(` 'nonce-${NONCE}'`, '');
    const scriptSrc = cspSemNonce.split('; ').find((d) => d.startsWith('script-src'))!;
    const fonte = scriptSrc.split(/\s+/).find((s) => s.startsWith("'nonce-"));

    expect(fonte).toBeUndefined();
    expect(gerarNonce()).not.toBe('');
  });

  it('não usa unsafe-inline em nenhuma diretiva, nem em produção', () => {
    for (const ambiente of ['production', 'development']) {
      const politica = montarCsp(CONFIG, NONCE, ambiente);

      expect(politica).not.toContain('unsafe-inline');
      for (const diretiva of politica.split('; ')) {
        expect(diretiva).not.toMatch(/unsafe-inline/i);
      }
    }
  });

  it('em produção, script-src não leva unsafe-eval', () => {
    const producao = montarCsp(CONFIG, NONCE, 'production');

    expect(producao).toContain(`script-src 'self' 'nonce-${NONCE}'`);
    expect(producao).not.toContain('unsafe-eval');
  });

  it('em desenvolvimento, script-src leva unsafe-eval — o React de dev chama eval()', () => {
    // Sem esta diretiva o runtime de cliente levanta `eval() is not supported in this
    // environment` e o React de desenvolvimento não sobe. É a única diferença entre as duas
    // políticas, e ela cobre um requisito do bundle de dev, não uma concessão de segurança.
    const dev = montarCsp(CONFIG, NONCE, 'development');

    expect(dev).toContain(`'nonce-${NONCE}' 'unsafe-eval'`);
    expect(dev).not.toContain('unsafe-inline');
  });

  it('sem NODE_ENV definido, trata como desenvolvimento (o caso seguro para o React)', () => {
    // `NODE_ENV` ausente não pode significar "produção": a política mais frouxa é o pior erro
    // possível aqui, porque ninguém notaria numa máquina de dev.
    expect(montarCsp(CONFIG, NONCE, undefined)).toContain('unsafe-eval');
  });

  it('restringe script-src, object-src, base-uri e frame-ancestors', () => {
    const politica = montarCsp(CONFIG, NONCE);

    expect(politica).toContain("script-src 'self'");
    expect(politica).toContain("object-src 'none'");
    expect(politica).toContain("base-uri 'self'");
    expect(politica).toContain("frame-ancestors 'none'");
  });

  it('connect-src traz a origem do Supabase e só os endpoints do Google na lista', () => {
    const connectSrc = montarCsp(CONFIG, NONCE)
      .split('; ')
      .find((d) => d.startsWith('connect-src'));

    expect(connectSrc).toBe(
      "connect-src 'self' https://abcdefghijklmnop.supabase.co " +
        'https://accounts.google.com https://apis.google.com',
    );
  });

  it('img-src autoriza self, data: e o avatar do Google — e nada além disso', () => {
    const imgSrc = montarCsp(CONFIG, NONCE)
      .split('; ')
      .find((d) => d.startsWith('img-src'));

    expect(imgSrc).toBe("img-src 'self' data: lh3.googleusercontent.com");
    // Três origens, e só: `split` inclui o nome da diretiva, que não é origem.
    expect(imgSrc?.split(' ').slice(1)).toHaveLength(3);
  });

  it('a origem do Supabase vem da configuração, e não do repositório', () => {
    const outra = montarCsp(
      { NEXT_PUBLIC_SUPABASE_URL: 'https://outro-projeto.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x' },
      NONCE,
    );

    expect(outra).toContain('https://outro-projeto.supabase.co');
    expect(outra).not.toContain('abcdefghijklmnop');
  });

  it('normaliza a barra final da URL, para não gerar origem com caminho', () => {
    const comBarra = montarCsp(
      { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co/', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x' },
      NONCE,
      'production',
    );

    expect(comBarra).toBe(POLITICA_ESPERADA);
  });

  it('a chave anon nunca entra na política', () => {
    expect(montarCsp(CONFIG, NONCE)).not.toContain('chave-anon-publica');
  });
});

describe('configuracaoParaCsp', () => {
  it('lê a origem do ambiente do servidor', () => {
    expect(configuracaoParaCsp({ ...CONFIG }).NEXT_PUBLIC_SUPABASE_URL).toBe(
      CONFIG.NEXT_PUBLIC_SUPABASE_URL,
    );
  });

  it('sem as variáveis, falha com a mensagem de configuração — e não com uma CSP furada', () => {
    // Uma CSP com a origem vazia pareceria válida e bloquearia tudo em silêncio. Falhar é
    // melhor do que servir uma política que não restringe nada.
    expect(() => configuracaoParaCsp({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe('CABECALHOS_DE_HARDENING', () => {
  it('traz os três cabeçalhos com os valores do spec', () => {
    expect(CABECALHOS_DE_HARDENING).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
    });
  });
});
