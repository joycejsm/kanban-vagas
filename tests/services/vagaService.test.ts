import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { VagaCreateInput } from '@/domain/vaga';
import { VagaService } from '@/services/vagaService';
import { VagaDuplicadaError, VagaServiceError } from '@/services/vagaService.errors';

/**
 * Cliente Supabase falso: cada elo da cadeia (`from().insert().select().single()`)
 * é um thenable que resolve sempre na mesma resposta, e toda chamada fica
 * registrada em `registros` para inspeção.
 */
function criarCliente(resposta: { data?: unknown; error?: unknown }) {
  const resultado = { data: resposta.data ?? null, error: resposta.error ?? null };
  const registros: { metodo: string; argumentos: unknown[] }[] = [];

  const criarNo = () => {
    // O alvo é uma função para que o proxy seja chamável; cada método da cadeia
    // (`select`, `insert`, `eq`, `single`...) registra a chamada e devolve outro nó.
    const alvo = () => undefined;
    return new Proxy(alvo, {
      apply(_alvo, _this, argumentos: unknown[]) {
        registros.push({ metodo: 'chain', argumentos });
        return criarNo();
      },
      get(_alvo, prop: string | symbol) {
        // O nó é thenable: `await` resolve na resposta sem precisar de `.single()`
        // ou `.maybeSingle()`, que aqui só aparecem na cadeia registrada.
        if (prop === 'then') return (resolver: (v: unknown) => void) => resolver(resultado);
        if (typeof prop !== 'string') return undefined;
        return (...argumentos: unknown[]) => {
          registros.push({ metodo: prop, argumentos });
          return criarNo();
        };
      },
    });
  };

  return {
    cliente: criarNo() as never,
    registros,
    chamadas: (metodo: string) => registros.filter((r) => r.metodo === metodo),
  };
}

const linhaVaga = {
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

const entradaValida: VagaCreateInput = {
  url: 'https://x.com/job/1?utm_source=a',
  titulo: 'Engenheira de Software',
  empresa: 'Empresa X',
  requisitos: ['TypeScript'],
  senioridade: 'Senior',
};

describe('VagaService', () => {
  let logs: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logs.mockRestore();
  });

  describe('listarVagas', () => {
    it('ordena por status e ordem e valida as linhas', async () => {
      const { cliente, chamadas } = criarCliente({ data: [linhaVaga] });
      const vagas = await new VagaService(cliente).listarVagas();

      expect(vagas).toHaveLength(1);
      expect(vagas[0]?.titulo).toBe('Engenheira de Software');
      expect(chamadas('order').map((c) => c.argumentos)).toEqual([
        ['status', { ascending: true }],
        ['ordem', { ascending: true }],
        ['created_at', { ascending: true }],
      ]);
    });

    it('traduz erro do banco em erro de domínio genérico', async () => {
      const { cliente } = criarCliente({ error: { code: '57014', message: 'canceling statement' } });

      await expect(new VagaService(cliente).listarVagas()).rejects.toBeInstanceOf(VagaServiceError);
      await expect(new VagaService(cliente).listarVagas()).rejects.not.toBeInstanceOf(VagaDuplicadaError);
    });
  });

  describe('criarVaga', () => {
    it('não envia user_id nem url_normalizada ao banco', async () => {
      const { cliente, chamadas } = criarCliente({ data: linhaVaga });
      await new VagaService(cliente).criarVaga(entradaValida);

      const enviado = chamadas('insert')[0]?.argumentos[0] as Record<string, unknown>;
      expect(enviado).not.toHaveProperty('user_id');
      expect(enviado).not.toHaveProperty('url_normalizada');
      expect(enviado).not.toHaveProperty('status');
      expect(enviado).not.toHaveProperty('ordem');
      expect(enviado['url']).toBe('https://x.com/job/1?utm_source=a');
    });

    it('não chama o banco quando a entrada é inválida', async () => {
      const { cliente, chamadas } = criarCliente({ data: linhaVaga });

      await expect(
        new VagaService(cliente).criarVaga({ ...entradaValida, url: 'http://x.com/job/1' }),
      ).rejects.toBeInstanceOf(VagaServiceError);
      expect(chamadas('insert')).toHaveLength(0);
    });

    it('traduz 23505 da constraint de URL em VagaDuplicadaError', async () => {
      const { cliente } = criarCliente({
        error: {
          code: '23505',
          constraint: 'vagas_user_id_url_normalizada_key',
          details: 'Key (user_id, url_normalizada)=(...)',
        },
      });

      await expect(new VagaService(cliente).criarVaga(entradaValida)).rejects.toBeInstanceOf(VagaDuplicadaError);
    });

    it('não confunde 23505 de outra constraint com duplicidade', async () => {
      const { cliente } = criarCliente({ error: { code: '23505', constraint: 'outra_constraint' } });

      await expect(new VagaService(cliente).criarVaga(entradaValida)).rejects.not.toBeInstanceOf(VagaDuplicadaError);
    });

    it('não deixa a mensagem do banco vazar para o chamador', async () => {
      const { cliente } = criarCliente({
        error: { code: '42501', message: 'permission denied for table vagas' },
      });

      const erro = await new VagaService(cliente)
        .criarVaga(entradaValida)
        .catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(VagaServiceError);
      expect((erro as Error).message).not.toContain('permission denied');
      expect((erro as Error).message).toBe('Não foi possível concluir a operação. Tente novamente.');
    });
  });

  describe('atualizarStatus', () => {
    it('envia apenas status e ordem', async () => {
      const { cliente, chamadas } = criarCliente({ data: { ...linhaVaga, status: 'entrevista_1', ordem: 2 } });
      const atualizada = await new VagaService(cliente).atualizarStatus(linhaVaga.id, 'entrevista_1', 2);

      expect(chamadas('update')[0]?.argumentos[0]).toEqual({ status: 'entrevista_1', ordem: 2 });
      expect(atualizada?.status).toBe('entrevista_1');
    });

    it('omite ordem quando não informada, preservando a posição', async () => {
      const { cliente, chamadas } = criarCliente({ data: { ...linhaVaga, status: 'proposta' } });
      await new VagaService(cliente).atualizarStatus(linhaVaga.id, 'proposta');

      expect(chamadas('update')[0]?.argumentos[0]).toEqual({ status: 'proposta' });
    });

    it('devolve null quando nenhuma linha é afetada', async () => {
      const { cliente } = criarCliente({ data: null });

      await expect(new VagaService(cliente).atualizarStatus(linhaVaga.id, 'rejeitado')).resolves.toBeNull();
    });
  });

  describe('removerVaga', () => {
    it('devolve true quando a vaga é removida', async () => {
      const { cliente } = criarCliente({ data: [{ id: linhaVaga.id }] });

      await expect(new VagaService(cliente).removerVaga(linhaVaga.id)).resolves.toBe(true);
    });

    it('devolve false quando nada é removido', async () => {
      const { cliente } = criarCliente({ data: [] });

      await expect(new VagaService(cliente).removerVaga(linhaVaga.id)).resolves.toBe(false);
    });
  });

  describe('assinaturas', () => {
    it('nenhuma operação aceita user_id', () => {
      const prototipo = VagaService.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
      // listarVagas=0, criarVaga=1, atualizarStatus=3 (id, status, ordem), removerVaga=1.
      const esperado: Record<string, number> = {
        listarVagas: 0,
        criarVaga: 1,
        atualizarStatus: 3,
        removerVaga: 1,
      };

      for (const [metodo, aridade] of Object.entries(esperado)) {
        expect(typeof prototipo[metodo]).toBe('function');
        expect(
          prototipo[metodo]?.length,
          `${metodo} deveria receber ${aridade} argumento(s)`,
        ).toBe(aridade);
      }
    });
  });

  describe('logging', () => {
    it('não registra conteúdo do usuário, token ou e-mail', async () => {
      const { cliente } = criarCliente({
        error: {
          code: '23505',
          constraint: 'vagas_user_id_url_normalizada_key',
          message: 'duplicate key value violates unique constraint',
          details: 'Key (user_id, url_normalizada)=(7a3c1d2e, https://x.com/job/1)',
        },
      });

      await new VagaService(cliente).criarVaga(entradaValida).catch(() => undefined);

      const registrado = logs.mock.calls.map((chamada) => chamada.join(' ')).join('\n');
      expect(registrado).toContain('criarVaga');
      expect(registrado).toContain('23505');
      expect(registrado).not.toContain('x.com');
      expect(registrado).not.toContain('TypeScript');
      expect(registrado).not.toContain('@');
    });
  });
});
