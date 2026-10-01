import { assertEquals } from 'jsr:@std/assert@1';
import { describe, it } from 'jsr:@std/testing@1/bdd';

import type { EnvConfig } from './env.ts';
import { EnvInvalidoError, lerEnv, normalizarEmail, origemPermitida } from './env.ts';

const COMPLETO: Record<string, string> = {
  GEMINI_API_KEY: 'chave-secreta',
  GEMINI_MODEL: 'gemini-2.5-flash',
  ALLOWED_EMAILS: 'joyce@exemplo.com, outra@exemplo.com',
  APP_ORIGIN: 'http://localhost:3000',
};

describe('lerEnv', () => {
  it('lê todas as secrets', () => {
    const config = lerEnv((nome) => COMPLETO[nome]);

    assertEquals(config.geminiApiKey, 'chave-secreta');
    assertEquals(config.geminiModel, 'gemini-2.5-flash');
    assertEquals(config.appOrigin, 'http://localhost:3000');
    assertEquals(config.allowedEmails, ['joyce@exemplo.com', 'outra@exemplo.com']);
  });

  it('normaliza a lista de e-mails', () => {
    const config = lerEnv((nome) =>
      nome === 'ALLOWED_EMAILS' ? '  Joyce@Exemplo.COM , , outra@exemplo.com ' : COMPLETO[nome]
    );

    assertEquals(config.allowedEmails, ['joyce@exemplo.com', 'outra@exemplo.com']);
  });

  it('falha quando falta uma secret', () => {
    const erro = (() => {
      try {
        lerEnv((nome) => (nome === 'GEMINI_API_KEY' ? undefined : COMPLETO[nome]));
        return null;
      } catch (e) {
        return e as EnvInvalidoError;
      }
    })();

    assertEquals(erro instanceof EnvInvalidoError, true);
    assertEquals(erro?.message.includes('GEMINI_API_KEY'), true);
  });

  it('falha quando a secret é string vazia', () => {
    const erro = (() => {
      try {
        lerEnv((nome) => (nome === 'ALLOWED_EMAILS' ? '   ' : COMPLETO[nome]));
        return null;
      } catch (e) {
        return e as EnvInvalidoError;
      }
    })();

    assertEquals(erro instanceof EnvInvalidoError, true);
  });

  it('nunca inclui valores vazios na lista de e-mails', () => {
    const config = lerEnv((nome) => (nome === 'ALLOWED_EMAILS' ? 'a@b.com,,,  ,c@d.com' : COMPLETO[nome]));

    assertEquals(config.allowedEmails, ['a@b.com', 'c@d.com']);
  });
});

describe('origemPermitida', () => {
  it('aceita somente a origem exata quando ela é informada', () => {
    const appOrigin = 'https://app.exemplo.com';

    assertEquals(origemPermitida('https://app.exemplo.com', appOrigin), true);
    assertEquals(origemPermitida('https://outro.exemplo.com', appOrigin), false);
    assertEquals(origemPermitida('http://app.exemplo.com', appOrigin), false, 'esquema diferente');
    assertEquals(origemPermitida('https://app.exemplo.com:443', appOrigin), false, 'porta explícita');
    assertEquals(origemPermitida('', appOrigin), false, 'vazia não é ausência');
  });

  it('aceita origem ausente, que é o que o chamador servidor-para-servidor produz', () => {
    const appOrigin = 'https://app.exemplo.com';

    // A chamada real vem de um `fetch` dentro de Server Action, e `fetch` de Node não emite
    // `Origin`: esse cabeçalho é do user agent. Recusar a ausência matava toda requisição do
    // aplicativo em 403, na primeira etapa do pipeline.
    assertEquals(origemPermitida(null, appOrigin), true);
  });
});

describe('normalizarEmail', () => {
  it('ignora caixa e espaços', () => {
    assertEquals(normalizarEmail('  JoYce@Exemplo.COM  '), 'joyce@exemplo.com');
  });
});

describe('EnvConfig', () => {
  it('a chave da API fica isolada em geminiApiKey, sem getter público', () => {
    const config: EnvConfig = lerEnv((nome) => COMPLETO[nome]);

    // A chave existe no objeto do servidor, mas não há campo de URL de API nem
    // qualquer outro segredo exposto junto (invariante 1).
    assertEquals(Object.keys(config).sort(), [
      'allowedEmails',
      'appOrigin',
      'geminiApiKey',
      'geminiModel',
    ]);
  });
});
