import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `redirect()` do Next nunca retorna: ele lança um erro interno que o framework transforma em
 * resposta. O dublê abaixo lança igual, senão o fluxo da action continua depois do redirect e o
 * teste passa a descrever um caminho que não existe em produção.
 */
class RedirectInjetado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT:${destino}`);
    this.name = 'RedirectInjetado';
  }
}

const mocks = vi.hoisted(() => ({
  criarClienteServidor: vi.fn(),
  redirect: vi.fn(),
  cabecalhos: new Map<string, string>(),
}));

vi.mock('@/lib/supabase/server', () => ({ criarClienteServidor: mocks.criarClienteServidor }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect.mockImplementation((destino: string) => {
    throw new RedirectInjetado(destino);
  }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(mocks.cabecalhos as unknown as Record<string, string>),
}));

const { entrarComGoogle } = await import('@/app/login/actions');

/** Executa a action e devolve o destino para onde ela redirecionou. */
async function destinoDoRedirect(acao: () => Promise<void>): Promise<string> {
  try {
    await acao();
  } catch (lancado) {
    if (lancado instanceof RedirectInjetado) {
      return lancado.destino;
    }
    throw lancado;
  }
  throw new Error('a action terminou sem redirecionar');
}

/** Cliente falso do Supabase, com o contrato mínimo que a action usa. */
function clienteFalso(resultado: { url?: string; error?: unknown }) {
  const signInWithOAuth = vi.fn(async (_opcoes: unknown) => ({
    data: resultado.url === undefined ? null : { url: resultado.url },
    error: resultado.error ?? null,
  }));
  return { cliente: { auth: { signInWithOAuth } } as never, signInWithOAuth };
}

beforeEach(() => {
  mocks.criarClienteServidor.mockReset();
  mocks.redirect.mockClear();
  mocks.cabecalhos.clear();
  mocks.cabecalhos.set('host', 'localhost:3123');
});

describe('entrarComGoogle', () => {
  it('monta o redirectTo com o callback e o destino interno', async () => {
    const { cliente, signInWithOAuth } = clienteFalso({
      url: 'https://conta.google.com/o/oauth2',
    });
    mocks.criarClienteServidor.mockResolvedValue(cliente);

    await expect(destinoDoRedirect(() => entrarComGoogle('/vaga/123'))).resolves.toBe(
      'https://conta.google.com/o/oauth2',
    );

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        skipBrowserRedirect: true,
        redirectTo: 'http://localhost:3123/auth/callback?next=%2Fvaga%2F123',
      },
    });
  });

  it('usa https e o host encaminhado quando houver proxy na frente', async () => {
    const { cliente, signInWithOAuth } = clienteFalso({
      url: 'https://conta.google.com/o/oauth2',
    });
    mocks.criarClienteServidor.mockResolvedValue(cliente);
    mocks.cabecalhos.set('x-forwarded-host', 'app.exemplo.com');
    mocks.cabecalhos.set('x-forwarded-proto', 'https');

    await destinoDoRedirect(() => entrarComGoogle());

    expect(signInWithOAuth.mock.calls[0]?.[0]).toMatchObject({
      options: { redirectTo: 'https://app.exemplo.com/auth/callback?next=%2F' },
    });
  });

  it('saneia destino externo antes de colocá-lo no redirectTo', async () => {
    const { cliente, signInWithOAuth } = clienteFalso({
      url: 'https://conta.google.com/o/oauth2',
    });
    mocks.criarClienteServidor.mockResolvedValue(cliente);

    await destinoDoRedirect(() => entrarComGoogle('https://evil.com'));

    const opcoes = signInWithOAuth.mock.calls[0]?.[0] as { options: { redirectTo: string } };
    expect(opcoes.options.redirectTo).toContain('next=%2F');
    expect(opcoes.options.redirectTo).not.toContain('evil.com');
  });

  it('vai para a tela de login com erro genérico quando o provedor falha', async () => {
    const { cliente, signInWithOAuth } = clienteFalso({
      error: new Error('Falha interna do provedor: client_id inválido em /auth/v1/token'),
    });
    mocks.criarClienteServidor.mockResolvedValue(cliente);

    const destino = await destinoDoRedirect(() => entrarComGoogle());

    expect(destino).toBe('/login?erro=auth');
    // O detalhe do Supabase não pode aparecer no destino do redirect.
    expect(destino).not.toContain('client_id');
    expect(destino).not.toContain('auth/v1');
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it('trata resposta sem URL como falha, e não redireciona para undefined', async () => {
    const { cliente } = clienteFalso({});
    mocks.criarClienteServidor.mockResolvedValue(cliente);

    const destino = await destinoDoRedirect(() => entrarComGoogle());

    expect(destino).toBe('/login?erro=auth');
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });
});
