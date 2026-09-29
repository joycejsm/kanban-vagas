import { describe, expect, it } from 'vitest';

import { LIMITE_URL, statusVagaSchema, vagaCreateInputSchema } from '@/domain/vaga';
import { VagaService } from '@/services/vagaService';

/**
 * Este arquivo não existe para testar o domínio: ele existe para testar o **alias** (D3).
 *
 * O alias `@/*` é declarado em dois lugares por necessidade — `tsconfig.json` (typecheck e Next)
 * e `vitest.config.ts` (testes, que rodam fora do Next) — e a duplicação é um risco real de
 * divergência silenciosa. Este teste cobre exatamente esse erro: se alguém mudar o alias em um
 * lugar e esquecer o outro, a suíte falha em vez de o alias divergir em silêncio.
 */
describe('alias @/ nos testes', () => {
  it('resolve um módulo de domínio importado por @/', () => {
    expect(LIMITE_URL).toBe(2048);
    expect(statusVagaSchema.options).toContain('entrevista_1');
    expect(
      vagaCreateInputSchema.safeParse({
        url: 'https://empresa.com/vaga/1',
        titulo: 'Engenheira de Software',
        empresa: 'Empresa',
        requisitos: ['TypeScript'],
      }).success,
    ).toBe(true);
  });

  it('resolve um módulo de serviço importado por @/', () => {
    expect(typeof VagaService).toBe('function');
  });
});
