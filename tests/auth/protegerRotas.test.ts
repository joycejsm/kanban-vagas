import { describe, expect, it, vi } from 'vitest';

import { ROTA_DE_LOGIN, ROTA_INICIAL } from '@/auth/rotas';
import {
  avaliarRequisicao,
  resolverSessao,
  type ClienteDeSessao,
  type RequisicaoAProteger,
} from '@/auth/protegerRotas';
import { config as configuracaoDoMiddleware } from '@/middleware';

/** Cliente falso: expõe apenas `getUser`, o mesmo recorte de que o núcleo depende. */
function clienteComSessao(resultado: { user: { email: string } | null; error?: unknown } | 'lança') {
  const getUser = vi.fn(async () => {
    if (resultado === 'lança') {
      throw new Error('falha de rede ao falar com o Auth');
    }
    return { data: { user: resultado.user }, error: resultado.error ?? null };
  });

  // Se alguém trocar `getUser()` por `getSession()`, este espião acusa.
  const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));

  return { cliente: { auth: { getUser } } as ClienteDeSessao, getUser, getSession };
}

function requisicao(caminho: string): RequisicaoAProteger {
  const url = new URL(caminho, 'https://app.exemplo.com');
  return { url: url.href, caminho: url.pathname, parametros: url.searchParams };
}

const SEM_SESSAO = clienteComSessao({ user: null, error: new Error('sem sessão') }).cliente;
const COM_SESSAO = clienteComSessao({ user: { email: 'ana@exemplo.com' } }).cliente;

describe('resolverSessao', () => {
  it('considera autenticado quem tem usuário devolvido por getUser', async () => {
    const { cliente, getUser } = clienteComSessao({ user: { email: 'ana@exemplo.com' } });

    await expect(resolverSessao(cliente)).resolves.toEqual({
      autenticado: true,
      email: 'ana@exemplo.com',
    });
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('trata cookie adulterado ou expirado como não autenticado', async () => {
    // É o caso em que o token foi recusado pelo serviço de autenticação: `user` vem nulo e
    // `error` preenchido. O requisito manda tratar como visitante anônimo.
    const { cliente } = clienteComSessao({ user: null, error: new Error('invalid claim') });

    await expect(resolverSessao(cliente)).resolves.toEqual({ autenticado: false, email: null });
  });

  it('trata falha de rede como não autenticado, em vez de propagar', async () => {
    const { cliente } = clienteComSessao('lança');

    await expect(resolverSessao(cliente)).resolves.toEqual({ autenticado: false, email: null });
  });

  it('não valida a sessão por cookie: getSession não é chamado', async () => {
    // Se alguém trocar `getUser()` por `getSession()`, o cookie sozinho passaria — e um cookie
    // forjado também. O espião existe para tornar essa troca visível.
    const { cliente, getUser, getSession } = clienteComSessao({
      user: { email: 'ana@exemplo.com' },
    });

    await resolverSessao(cliente);

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getSession).not.toHaveBeenCalled();
  });
});

describe('avaliarRequisicao — visitante anônimo', () => {
  it('redireciona da raiz para o login', async () => {
    await expect(avaliarRequisicao(requisicao('/'), () => SEM_SESSAO)).resolves.toEqual({
      tipo: 'redirecionar',
      destino: ROTA_DE_LOGIN,
    });
  });

  it('redireciona de qualquer rota privada, não só da raiz', async () => {
    for (const caminho of ['/vaga', '/vaga/123', '/configuracoes', '/qualquer/rota/nova']) {
      await expect(avaliarRequisicao(requisicao(caminho), () => SEM_SESSAO)).resolves.toEqual({
        tipo: 'redirecionar',
        destino: ROTA_DE_LOGIN,
      });
    }
  });

  it('deixa passar as rotas públicas sem redirecionar', async () => {
    for (const caminho of ['/login', '/auth/callback']) {
      await expect(avaliarRequisicao(requisicao(caminho), () => SEM_SESSAO)).resolves.toEqual({
        tipo: 'seguir',
      });
    }
  });

  it('preserva o destino interno no parâmetro next', async () => {
    await expect(
      avaliarRequisicao(requisicao('/vaga/123?next=%2Fvaga%2F123'), () => SEM_SESSAO),
    ).resolves.toEqual({
      tipo: 'redirecionar',
      destino: `${ROTA_DE_LOGIN}?next=%2Fvaga%2F123`,
    });
  });

  it('não usa destino externo nem perigoso vindo da query', async () => {
    const destinos = [
      'https%3A%2F%2Fevil.com',
      '%2F%2Fevil.com',
      'javascript%3Aalert(1)',
      '%2F%0D%0AX-Injetado%3A%201',
    ];

    for (const destino of destinos) {
      await expect(
        avaliarRequisicao(requisicao(`/vaga?next=${destino}`), () => SEM_SESSAO),
      ).resolves.toEqual({ tipo: 'redirecionar', destino: ROTA_DE_LOGIN });
    }
  });
});

describe('avaliarRequisicao — usuário autenticado', () => {
  it('deixa passar a raiz e as rotas privadas', async () => {
    for (const caminho of ['/', '/vaga/123']) {
      await expect(avaliarRequisicao(requisicao(caminho), () => COM_SESSAO)).resolves.toEqual({
        tipo: 'seguir',
      });
    }
  });

  it('tira da tela de login para a raiz', async () => {
    await expect(avaliarRequisicao(requisicao('/login'), () => COM_SESSAO)).resolves.toEqual({
      tipo: 'redirecionar',
      destino: ROTA_INICIAL,
    });
  });

  it('não interrompe o callback, que é onde a sessão é criada', async () => {
    // Se o callback fosse redirecionado, o usuário autenticado nunca trocaria o código por
    // sessão e o login não fecharia.
    await expect(
      avaliarRequisicao(requisicao('/auth/callback?code=abc'), () => COM_SESSAO),
    ).resolves.toEqual({ tipo: 'seguir' });
  });
});

describe('escopo do matcher', () => {
  // O Next compila o matcher com `path-to-regexp`, que ancora a expressão nas duas pontas. O
  // teste replica essa âncora: sem ela, `/_next/image` casaria a partir da segunda barra.
  const regex = new RegExp(`^${configuracaoDoMiddleware.matcher[0] ?? ''}$`);

  it('não casa com assets estáticos e de infraestrutura do framework', () => {
    for (const caminho of [
      '/_next/static/chunks/main.js',
      '/_next/image',
      '/_next/webpack-hmr',
      '/favicon.ico',
      '/logo.svg',
      '/manifest.webmanifest',
      '/robots.txt',
    ]) {
      expect(regex.test(caminho)).toBe(false);
    }
  });

  it('casa com rotas de página, inclusive a raiz e as públicas', () => {
    for (const caminho of ['/', '/login', '/auth/callback', '/vaga/123', '/vaga/123/notas']) {
      expect(regex.test(caminho)).toBe(true);
    }
  });
});
