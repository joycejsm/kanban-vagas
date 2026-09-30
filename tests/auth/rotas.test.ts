import { describe, expect, it } from 'vitest';

import { ROTA_DE_LOGIN, ROTA_INICIAL, ROTAS_PUBLICAS, decidirRedirecionamento, ehRotaPublica } from '@/auth/rotas';

describe('ehRotaPublica', () => {
  it('reconhece exatamente as rotas públicas declaradas', () => {
    expect([...ROTAS_PUBLICAS]).toEqual(['/login', '/auth/callback']);

    for (const rota of ROTAS_PUBLICAS) {
      expect(ehRotaPublica(rota)).toBe(true);
    }
  });

  it('trata qualquer outra rota como privada, inclusive a raiz', () => {
    // A allowlist é o que autoriza; a raiz não está nela, e é por isso que exige sessão.
    for (const rota of ['/', '/vaga', '/vaga/123', '/config', '/login/x', '/LOGIN']) {
      expect(ehRotaPublica(rota)).toBe(false);
    }
  });
});

describe('decidirRedirecionamento — visitante anônimo', () => {
  it('redireciona da raiz para o login', () => {
    expect(decidirRedirecionamento('/', false)).toEqual({
      tipo: 'redirecionar',
      destino: ROTA_DE_LOGIN,
    });
  });

  it('redireciona de qualquer rota privada, não só da raiz', () => {
    for (const rota of ['/vaga', '/vaga/123', '/configuracoes', '/qualquer/rota/nova']) {
      expect(decidirRedirecionamento(rota, false)).toEqual({
        tipo: 'redirecionar',
        destino: ROTA_DE_LOGIN,
      });
    }
  });

  it('deixa passar as rotas públicas sem redirecionar', () => {
    for (const rota of ROTAS_PUBLICAS) {
      expect(decidirRedirecionamento(rota, false)).toEqual({ tipo: 'seguir' });
    }
  });
});

describe('decidirRedirecionamento — usuário autenticado', () => {
  it('deixa passar a raiz e as rotas privadas', () => {
    expect(decidirRedirecionamento('/', true)).toEqual({ tipo: 'seguir' });
    expect(decidirRedirecionamento('/vaga/123', true)).toEqual({ tipo: 'seguir' });
  });

  it('tira da tela de login para a raiz', () => {
    expect(decidirRedirecionamento('/login', true)).toEqual({
      tipo: 'redirecionar',
      destino: ROTA_INICIAL,
    });
  });

  it('não interrompe o callback, que é onde a sessão é criada', () => {
    // Se o callback fosse redirecionado, o usuário autenticado nunca trocaria o código por
    // sessão e o login não fecharia.
    expect(decidirRedirecionamento('/auth/callback', true)).toEqual({ tipo: 'seguir' });
  });
});

describe('decidirRedirecionamento — destino interno preservado', () => {
  it('leva o destino apenas quando ele é um caminho interno', () => {
    expect(decidirRedirecionamento('/vaga/123', false, '/vaga/123')).toEqual({
      tipo: 'redirecionar',
      destino: `${ROTA_DE_LOGIN}?next=%2Fvaga%2F123`,
    });
  });

  it('não usa como destino nada que não seja caminho interno', () => {
    for (const destino of ['https://evil.com', '//evil.com', 'javascript:alert(1)', '/\r\nX-Injetado: 1']) {
      const decisao = decidirRedirecionamento('/vaga', false, destino);
      expect(decisao).toEqual({ tipo: 'redirecionar', destino: ROTA_DE_LOGIN });
    }
  });

  it('omite o parâmetro quando não há destino informado', () => {
    for (const destino of [null, undefined, '']) {
      expect(decidirRedirecionamento('/', false, destino)).toEqual({
        tipo: 'redirecionar',
        destino: ROTA_DE_LOGIN,
      });
    }
  });
});
