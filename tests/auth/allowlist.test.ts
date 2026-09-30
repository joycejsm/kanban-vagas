import { describe, expect, it } from 'vitest';

import { ErroConfiguracaoAllowlist } from '@/config/serverEnv';
import { emailAutorizado, lerAllowlistDoServidor } from '@/auth/allowlist';

const LISTA = ['ana@exemplo.com', 'bruno@exemplo.com'];

describe('emailAutorizado', () => {
  it('aceita e-mail presente na lista', () => {
    expect(emailAutorizado('ana@exemplo.com', LISTA)).toBe(true);
    expect(emailAutorizado('bruno@exemplo.com', LISTA)).toBe(true);
  });

  it('recusa e-mail ausente da lista', () => {
    expect(emailAutorizado('carla@exemplo.com', LISTA)).toBe(false);
  });

  it('ignora caixa e espaços nas pontas dos dois lados', () => {
    expect(emailAutorizado('  ANA@Exemplo.COM  ', LISTA)).toBe(true);
    expect(emailAutorizado('ana@exemplo.com', ['  Ana@Exemplo.COM  '])).toBe(true);
  });

  it('recusa e-mail ausente, vazio ou só com espaços', () => {
    for (const email of [undefined, null, '', '   ']) {
      expect(emailAutorizado(email, LISTA)).toBe(false);
    }
  });

  it('recusa quando a lista está vazia, em vez de liberar o acesso', () => {
    expect(emailAutorizado('ana@exemplo.com', [])).toBe(false);
  });

  it('não confunde e-mail que é subcadeia de outro autorizado', () => {
    // A comparação é por igualdade: `x@exemplo.com.br` não casa com `ana@exemplo.com`, e
    // `ana@exemplo.com.evil.test` não é a mesma coisa que o e-mail autorizado.
    expect(emailAutorizado('ana@exemplo.com.evil.test', LISTA)).toBe(false);
    expect(emailAutorizado('xxana@exemplo.com', LISTA)).toBe(false);
  });
});

describe('lerAllowlistDoServidor', () => {
  it('lê a lista do ambiente já normalizada e deduplicada', () => {
    expect(
      lerAllowlistDoServidor({ ALLOWED_EMAILS: ' Ana@Exemplo.com ,bruno@exemplo.com,ana@exemplo.com ' }),
    ).toEqual(['ana@exemplo.com', 'bruno@exemplo.com']);
  });

  it('falha quando a variável não está definida', () => {
    expect(() => lerAllowlistDoServidor({})).toThrow(ErroConfiguracaoAllowlist);
  });
});
