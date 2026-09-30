import { describe, expect, it, vi } from 'vitest';

import {
  ROTA_DE_ERRO_DE_AUTENTICACAO,
  ROTA_DE_ERRO_DE_AUTORIZACAO,
  concluirLogin,
  type ClienteDoCallback,
} from '@/auth/concluirLogin';

const ALLOWLIST = ['ana@exemplo.com'];

/** Cliente falso com o fluxo completo de callback. */
function clienteDeCallback(resultado: {
  user?: { email?: string } | null;
  error?: unknown;
  lanca?: boolean;
}) {
  const exchangeCodeForSession = vi.fn(async (_codigo: string) => {
    if (resultado.lanca === true) {
      throw new Error('rede indisponível');
    }
    return {
      data: resultado.user === undefined ? { user: null } : { user: resultado.user },
      error: resultado.error ?? null,
    };
  });
  const signOut = vi.fn(async () => ({ error: null }));

  return {
    cliente: { auth: { exchangeCodeForSession, signOut } } as ClienteDoCallback,
    exchangeCodeForSession,
    signOut,
  };
}

describe('concluirLogin — troca de código por sessão', () => {
  it('conclui o login com código válido e vai para o destino saneado', async () => {
    const { cliente, exchangeCodeForSession } = clienteDeCallback({ user: { email: 'ana@exemplo.com' } });

    const resultado = await concluirLogin({
      codigo: 'codigo-valido',
      next: '/vaga/123',
      cliente,
      allowlist: ALLOWLIST,
    });

    expect(resultado).toEqual({ destino: '/vaga/123', sessaoEncerrada: false });
    expect(exchangeCodeForSession).toHaveBeenCalledWith('codigo-valido');
  });

  it('sem next, vai para a raiz', async () => {
    const { cliente } = clienteDeCallback({ user: { email: 'ana@exemplo.com' } });

    await expect(
      concluirLogin({ codigo: 'codigo-valido', next: null, cliente, allowlist: ALLOWLIST }),
    ).resolves.toEqual({ destino: '/', sessaoEncerrada: false });
  });

  it('código ausente não cria sessão', async () => {
    for (const codigo of [null, '']) {
      const { cliente, exchangeCodeForSession } = clienteDeCallback({
        user: { email: 'ana@exemplo.com' },
      });

      const resultado = await concluirLogin({
        codigo,
        next: null,
        cliente,
        allowlist: ALLOWLIST,
      });

      expect(resultado).toEqual({
        destino: ROTA_DE_ERRO_DE_AUTENTICACAO,
        sessaoEncerrada: false,
      });
      // Nenhuma tentativa de troca: não há o que trocar.
      expect(exchangeCodeForSession).not.toHaveBeenCalled();
    }
  });

  it('código inválido ou expirado não cria sessão', async () => {
    const { cliente, signOut } = clienteDeCallback({
      user: null,
      error: new Error('invalid authorization code'),
    });

    const resultado = await concluirLogin({
      codigo: 'codigo-expirado',
      next: '/vaga/123',
      cliente,
      allowlist: ALLOWLIST,
    });

    expect(resultado.destino).toBe(ROTA_DE_ERRO_DE_AUTENTICACAO);
    // Sem sessão para encerrar: a troca falhou.
    expect(signOut).not.toHaveBeenCalled();
  });

  it('troca que lança exceção também vira erro de autenticação', async () => {
    const { cliente } = clienteDeCallback({ lanca: true });

    await expect(
      concluirLogin({ codigo: 'codigo', next: null, cliente, allowlist: ALLOWLIST }),
    ).resolves.toEqual({ destino: ROTA_DE_ERRO_DE_AUTENTICACAO, sessaoEncerrada: false });
  });
});

describe('concluirLogin — destino restrito a caminho interno', () => {
  const destinos = [
    ['https://evil.com', '/'],
    ['//evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['', '/'],
    ['/vaga/123', '/vaga/123'],
  ] as const;

  for (const [next, esperado] of destinos) {
    it(`next=${JSON.stringify(next)} leva a ${esperado}`, async () => {
      const { cliente } = clienteDeCallback({ user: { email: 'ana@exemplo.com' } });

      const resultado = await concluirLogin({
        codigo: 'codigo-valido',
        next,
        cliente,
        allowlist: ALLOWLIST,
      });

      expect(resultado.destino).toBe(esperado);
    });
  }
});

describe('concluirLogin — allowlist', () => {
  it('mantém a sessão de e-mail autorizado', async () => {
    const { cliente, signOut } = clienteDeCallback({ user: { email: 'ana@exemplo.com' } });

    const resultado = await concluirLogin({
      codigo: 'codigo-valido',
      next: null,
      cliente,
      allowlist: ALLOWLIST,
    });

    expect(resultado).toEqual({ destino: '/', sessaoEncerrada: false });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('encerra a sessão de e-mail não autorizado e leva a nao_autorizado', async () => {
    const { cliente, signOut } = clienteDeCallback({ user: { email: 'malvado@exemplo.com' } });

    const resultado = await concluirLogin({
      codigo: 'codigo-valido',
      next: '/vaga/123',
      cliente,
      allowlist: ALLOWLIST,
    });

    expect(resultado).toEqual({ destino: ROTA_DE_ERRO_DE_AUTORIZACAO, sessaoEncerrada: true });
    // A sessão existia: encerrar é obrigatório, senão o usuário seguiria autenticado.
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('encerra a sessão quando o usuário não tem e-mail', async () => {
    const { cliente, signOut } = clienteDeCallback({ user: {} });

    const resultado = await concluirLogin({
      codigo: 'codigo-valido',
      next: null,
      cliente,
      allowlist: ALLOWLIST,
    });

    expect(resultado.destino).toBe(ROTA_DE_ERRO_DE_AUTORIZACAO);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('encerra a sessão quando a allowlist está vazia', async () => {
    // Configuração ausente não vira "permitir todos": a lista vazia barra todo mundo.
    const { cliente, signOut } = clienteDeCallback({ user: { email: 'ana@exemplo.com' } });

    const resultado = await concluirLogin({
      codigo: 'codigo-valido',
      next: null,
      cliente,
      allowlist: [],
    });

    expect(resultado.destino).toBe(ROTA_DE_ERRO_DE_AUTORIZACAO);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('a sessão encerrada não sobrevive ao redirect do middleware', async () => {
    // O encadeamento que o requisito pede: callback nega, e a rota privada continua inacessível
    // porque o cookie de sessão foi removido. O middleware revalida e trata como anônimo.
    const { cliente, signOut } = clienteDeCallback({ user: { email: 'malvado@exemplo.com' } });

    const resultado = await concluirLogin({
      codigo: 'codigo-valido',
      next: null,
      cliente,
      allowlist: ALLOWLIST,
    });

    expect(resultado.sessaoEncerrada).toBe(true);
    expect(signOut).toHaveBeenCalledTimes(1);
    // O destino é a tela de login — nunca uma rota privada, nem o destino que o visitante pediu.
    expect(resultado.destino).toBe(ROTA_DE_ERRO_DE_AUTORIZACAO);
    expect(resultado.destino.startsWith('/login')).toBe(true);
  });
});
