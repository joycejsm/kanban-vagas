import { describe, expect, it } from 'vitest';

import {
  LIMITE_ITEM_REQUISITO,
  LIMITE_REQUISITOS,
  LIMITE_TEXTO_COLADO,
  LIMITE_TEXTO_CURTO,
  LIMITE_URL,
  senioridadeSchema,
  statusVagaSchema,
  vagaCreateInputSchema,
  vagaRowSchema,
} from '@/domain/vaga';

const entradaValida = {
  url: 'https://empresa.com/vaga/1',
  titulo: 'Engenheira de Software',
  empresa: 'Empresa X',
  requisitos: ['TypeScript', 'Postgres'],
};

describe('statusVagaSchema', () => {
  it('aceita os cinco status canônicos', () => {
    for (const status of ['aplicado', 'entrevista_1', 'fase_tecnica', 'proposta', 'rejeitado'] as const) {
      expect(statusVagaSchema.safeParse(status).success).toBe(true);
    }
  });

  it('rejeita status fora do enum', () => {
    expect(statusVagaSchema.safeParse('arquivado').success).toBe(false);
    expect(statusVagaSchema.safeParse('').success).toBe(false);
    expect(statusVagaSchema.safeParse('entrevistado').success).toBe(false);
  });
});

describe('senioridadeSchema', () => {
  it('aceita os quatro valores e rejeita outros', () => {
    for (const valor of ['Junior', 'Pleno', 'Senior', 'Não informado'] as const) {
      expect(senioridadeSchema.safeParse(valor).success).toBe(true);
    }
    expect(senioridadeSchema.safeParse('Estágio').success).toBe(false);
  });
});

describe('vagaCreateInputSchema', () => {
  it('aceita entrada válida preservando os cinco campos', () => {
    const resultado = vagaCreateInputSchema.safeParse({
      ...entradaValida,
      senioridade: 'Senior',
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(Object.keys(resultado.data).sort()).toEqual([
        'empresa',
        'requisitos',
        'senioridade',
        'titulo',
        'url',
      ]);
    }
  });

  it('aplica "Não informado" como senioridade padrão', () => {
    const resultado = vagaCreateInputSchema.safeParse(entradaValida);

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.senioridade).toBe('Não informado');
    }
  });

  it.each(['id', 'user_id', 'status', 'ordem', 'created_at', 'updated_at'])(
    'rejeita payload com campo de servidor: %s',
    (campo) => {
      const resultado = vagaCreateInputSchema.safeParse({ ...entradaValida, [campo]: 'x' });
      expect(resultado.success).toBe(false);
    },
  );

  it('rejeita URL não https', () => {
    expect(vagaCreateInputSchema.safeParse({ ...entradaValida, url: 'http://empresa.com/vaga/1' }).success).toBe(false);
  });

  it('rejeita URL acima do limite', () => {
    const url = `https://empresa.com/${'a'.repeat(LIMITE_URL)}`;
    expect(url.length).toBeGreaterThan(LIMITE_URL);
    expect(vagaCreateInputSchema.safeParse({ ...entradaValida, url }).success).toBe(false);
  });

  it('rejeita título vazio e empresa acima do limite', () => {
    expect(vagaCreateInputSchema.safeParse({ ...entradaValida, titulo: '' }).success).toBe(false);
    expect(
      vagaCreateInputSchema.safeParse({ ...entradaValida, empresa: 'x'.repeat(LIMITE_TEXTO_CURTO + 1) }).success,
    ).toBe(false);
  });

  it('rejeita lista de requisitos fora dos limites', () => {
    const muitos = Array.from({ length: LIMITE_REQUISITOS + 1 }, (_, i) => `req ${i}`);
    expect(vagaCreateInputSchema.safeParse({ ...entradaValida, requisitos: muitos }).success).toBe(false);

    const itemLongo = 'x'.repeat(LIMITE_ITEM_REQUISITO + 1);
    expect(vagaCreateInputSchema.safeParse({ ...entradaValida, requisitos: [itemLongo] }).success).toBe(false);

    expect(vagaCreateInputSchema.safeParse({ ...entradaValida, requisitos: [''] }).success).toBe(false);
  });

  it('aceita exatamente o limite de requisitos e de itens', () => {
    const noLimite = Array.from({ length: LIMITE_REQUISITOS }, (_, i) => `req ${i}`);
    expect(vagaCreateInputSchema.safeParse({ ...entradaValida, requisitos: noLimite }).success).toBe(true);

    const itemNoLimite = 'x'.repeat(LIMITE_ITEM_REQUISITO);
    expect(vagaCreateInputSchema.safeParse({ ...entradaValida, requisitos: [itemNoLimite] }).success).toBe(true);
  });

  it('rejeita senioridade fora do conjunto permitido', () => {
    expect(vagaCreateInputSchema.safeParse({ ...entradaValida, senioridade: 'Estágio' }).success).toBe(false);
  });
});

describe('vagaRowSchema', () => {
  const linha = {
    id: '2f1c9b0e-9a2b-4f5d-8c1a-1b2c3d4e5f60',
    user_id: '7a3c1d2e-4b5f-4a6c-8d9e-0f1a2b3c4d5e',
    url: 'https://x.com/job/1?utm_source=a',
    url_normalizada: 'https://x.com/job/1',
    titulo: 'Engenheira de Software',
    empresa: 'Empresa X',
    requisitos: ['TypeScript'],
    senioridade: 'Senior',
    status: 'aplicado',
    ordem: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  it('valida um registro completo vindo do banco', () => {
    expect(vagaRowSchema.safeParse(linha).success).toBe(true);
  });

  it('rejeita registro com status fora do enum', () => {
    expect(vagaRowSchema.safeParse({ ...linha, status: 'arquivado' }).success).toBe(false);
  });

  it('rejeita requisitos ausente ou nulo', () => {
    const { requisitos: _omitido, ...semRequisitos } = linha;
    expect(vagaRowSchema.safeParse(semRequisitos).success).toBe(false);
    expect(vagaRowSchema.safeParse({ ...linha, requisitos: null }).success).toBe(false);
  });
});

describe('LIMITE_TEXTO_COLADO', () => {
  it('vale 30.000 — o número que a Edge Function e a Server Action precisam compartilhar', () => {
    // O valor mora no domínio de propósito (Fase 3, task 5.2): a action valida antes de
    // chamar a função, e a função valida de novo. Se um lado mudar sozinho, o limite vira
    // "o usuário só descobre depois do round-trip".
    expect(LIMITE_TEXTO_COLADO).toBe(30_000);
  });

  it('é um inteiro positivo, para que o limite seja aplicável como teto de tamanho', () => {
    // A verificação de fronteira (30.000 passa, 30.001 não) não cabe aqui: ela pertence ao
    // schema que *aplica* o limite, e é testada junto da action em `tests/app/`.
    // Afirmar que `'a'.repeat(N).length` é `N` só testaria o próprio JavaScript.
    expect(Number.isInteger(LIMITE_TEXTO_COLADO)).toBe(true);
    expect(LIMITE_TEXTO_COLADO).toBeGreaterThan(0);
  });
});
