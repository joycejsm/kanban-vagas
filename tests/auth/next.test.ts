import { describe, expect, it } from 'vitest';

import { DESTINO_PADRAO, destinoParaRedirecionamento, sanearNext } from '@/auth/next';

describe('sanearNext', () => {
  it('preserva caminho relativo interno', () => {
    expect(sanearNext('/vaga/123')).toBe('/vaga/123');
    expect(sanearNext('/')).toBe('/');
    expect(sanearNext('/vaga/123?origem=login')).toBe('/vaga/123?origem=login');
    expect(sanearNext('/vaga-123')).toBe('/vaga-123');
  });

  it('descarta URL externa', () => {
    expect(sanearNext('https://evil.com')).toBe(DESTINO_PADRAO);
    expect(sanearNext('http://evil.com/callback')).toBe(DESTINO_PADRAO);
  });

  it('descarta URL com protocolo relativo', () => {
    expect(sanearNext('//evil.com')).toBe(DESTINO_PADRAO);
    expect(sanearNext('//')).toBe(DESTINO_PADRAO);
  });

  it('descarta esquema perigoso', () => {
    expect(sanearNext('javascript:alert(1)')).toBe(DESTINO_PADRAO);
    expect(sanearNext('data:text/html,<script>alert(1)</script>')).toBe(DESTINO_PADRAO);
  });

  it('trata string vazia e ausência como raiz', () => {
    expect(sanearNext('')).toBe(DESTINO_PADRAO);
    expect(sanearNext(null)).toBe(DESTINO_PADRAO);
    expect(sanearNext(undefined)).toBe(DESTINO_PADRAO);
  });

  it('descarta barra invertida e quebra de linha', () => {
    expect(sanearNext('/\\evil.com')).toBe(DESTINO_PADRAO);
    expect(sanearNext('/vaga\r\nSet-Cookie: a=b')).toBe(DESTINO_PADRAO);
    expect(sanearNext('/vaga\nLocation: https://evil.com')).toBe(DESTINO_PADRAO);
  });

  it('não faz trim: espaço no começo já não é caminho interno', () => {
    expect(sanearNext(' /vaga')).toBe(DESTINO_PADRAO);
  });
});

describe('destinoParaRedirecionamento', () => {
  it('preserva o caminho interno informado pelo visitante', () => {
    expect(destinoParaRedirecionamento('/vaga/123')).toBe('/vaga/123');
  });

  it('não inventa destino quando o parâmetro não veio', () => {
    // Sem `next`, o redirecionamento é o `/login` limpo — não `/login?next=%2F`.
    for (const valor of [null, undefined, '']) {
      expect(destinoParaRedirecionamento(valor)).toBeNull();
    }
  });

  it('não inventa destino quando o valor foi descartado pela sanitização', () => {
    for (const valor of ['https://evil.com', '//evil.com', 'javascript:alert(1)', '/\\evil.com']) {
      expect(destinoParaRedirecionamento(valor)).toBeNull();
    }
  });
});
