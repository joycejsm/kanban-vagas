import { describe, expect, it } from 'vitest';

import { statusVagaSchema, type StatusVaga, type VagaRow } from '@/domain/vaga';
import {
  agruparPorColuna,
  COLUNAS,
  destinosPossiveis,
  ordemDeDestino,
  rotuloDoStatus,
  STATUS_DO_QUADRO,
} from '@/quadro/colunas';

/**
 * Testes das funções puras do quadro (design D3).
 *
 * Estas funções existem fora do componente por um motivo verificável: o ambiente de testes do
 * projeto é `node` e só coleta arquivos de teste `.ts` (o glob não alcança `.tsx`), então a
 * lógica que dá para testar é a que não mora em hook de Client Component. O que sobrar de
 * markup é verificado por typecheck, build e inspeção — e essa divisão é intencional, não uma
 * folga.
 */

/**
 * Os cinco status na ordem do ciclo de vida.
 *
 * `as const` porque a tupla é usada como `StatusVaga` em chamada de função tipada: sem ele, o
 * array é `string[]` e `vaga({ status })` não compila. É a lista de StatusVaga do quadro, e
 * nada aqui passa a aceitar um status que o enum não tem.
 */
const ORDEM_DOS_CINCO = [
  'aplicado',
  'entrevista_1',
  'fase_tecnica',
  'proposta',
  'rejeitado',
] as const;

/** Vaga válida com o status e a ordem pedidos. `id` distinto por padrão para não colidir. */
function vaga(overrides: Partial<VagaRow> = {}): VagaRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    url: 'https://empresa.com/vaga/1',
    url_normalizada: 'https://empresa.com/vaga/1',
    titulo: 'Engenheira de Software',
    empresa: 'Empresa X',
    requisitos: ['TypeScript'],
    senioridade: 'Senior',
    status: 'aplicado',
    ordem: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('COLUNAS', () => {
  it('tem uma coluna para cada status do enum, na ordem do ciclo de vida', () => {
    expect(COLUNAS.map((coluna) => coluna.status)).toEqual(ORDEM_DOS_CINCO);
  });

  it('não repete status e não deixa coluna sem rótulo', () => {
    expect(new Set(COLUNAS.map((coluna) => coluna.status)).size).toBe(COLUNAS.length);
    for (const coluna of COLUNAS) {
      expect(coluna.rotulo.trim().length).toBeGreaterThan(0);
    }
  });

  it('cada coluna corresponde a um status aceito pelo schema de domínio', () => {
    for (const coluna of COLUNAS) {
      expect(statusVagaSchema.safeParse(coluna.status).success).toBe(true);
    }
  });
});

describe('rotuloDoStatus', () => {
  it('traduz os cinco status', () => {
    expect(rotuloDoStatus('aplicado')).toBe('Aplicado');
    expect(rotuloDoStatus('entrevista_1')).toBe('Entrevista 1');
    expect(rotuloDoStatus('fase_tecnica')).toBe('Fase técnica');
    expect(rotuloDoStatus('proposta')).toBe('Proposta');
    expect(rotuloDoStatus('rejeitado')).toBe('Rejeitado');
  });

  it('devolve o próprio identificador para status desconhecido, nunca undefined', () => {
    // Um `undefined` aqui viraria `undefined` no cabeçalho da coluna ou no `value` do option.
    expect(rotuloDoStatus('arquivado' as StatusVaga)).toBe('arquivado');
  });
});

describe('agruparPorColuna', () => {
  it('devolve as cinco colunas para usuário sem nenhuma vaga', () => {
    const colunas = agruparPorColuna([]);

    expect(colunas).toHaveLength(5);
    expect(colunas.map((coluna) => coluna.status)).toEqual(ORDEM_DOS_CINCO);
    for (const coluna of colunas) {
      expect(coluna.vagas).toEqual([]);
    }
  });

  it('devolve as cinco colunas mesmo quando só uma tem vaga', () => {
    const colunas = agruparPorColuna([vaga({ status: 'proposta' })]);

    expect(colunas).toHaveLength(5);
    expect(colunas.find((coluna) => coluna.status === 'proposta')?.vagas).toHaveLength(1);
    expect(colunas.filter((coluna) => coluna.vagas.length > 0)).toHaveLength(1);
  });

  it('distribui vagas em todas as colunas', () => {
    const colunas = agruparPorColuna(ORDEM_DOS_CINCO.map((status) => vaga({ status })));

    expect(colunas.map((coluna) => coluna.status)).toEqual(ORDEM_DOS_CINCO);
    for (const coluna of colunas) {
      expect(coluna.vagas).toHaveLength(1);
    }
  });

  it('preserva a ordem de entrada das vagas dentro da coluna', () => {
    // A ordem de entrada é a do serviço (status, ordem, created_at): reordenar aqui trocaria
    // a consulta sustentada pelo índice por um sort em JavaScript.
    const colunas = agruparPorColuna([
      vaga({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ordem: 0, status: 'aplicado' }),
      vaga({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', ordem: 1, status: 'aplicado' }),
      vaga({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', ordem: 2, status: 'aplicado' }),
    ]);

    expect(
      colunas.find((coluna) => coluna.status === 'aplicado')?.vagas.map((v) => v.ordem),
    ).toEqual([0, 1, 2]);
  });

  it('preserva os campos da vaga, incluindo a url como persistida', () => {
    const original = vaga({ url: 'https://empresa.com/vaga/9?utm_source=linkedin' });
    const colunas = agruparPorColuna([original]);

    // O card depende disso: o link é a `url` do usuário, nunca a normalizada pelo trigger.
    expect(colunas[0]?.vagas[0]).toEqual(original);
    expect(colunas[0]?.vagas[0]?.url).toBe('https://empresa.com/vaga/9?utm_source=linkedin');
  });

  it('ignora vaga com status fora do enum em vez de criar coluna nova', () => {
    const colunas = agruparPorColuna([vaga({ status: 'arquivado' as StatusVaga })]);

    expect(colunas).toHaveLength(5);
    expect(colunas.map((coluna) => coluna.status)).toEqual(ORDEM_DOS_CINCO);
    expect(colunas.every((coluna) => coluna.vagas.length === 0)).toBe(true);
  });

  it('nunca devolve status fora do enum, o que impede faixa morta na tela', () => {
    const colunas = agruparPorColuna([vaga({ status: 'arquivado' as StatusVaga })]);

    for (const coluna of colunas) {
      expect(statusVagaSchema.safeParse(coluna.status).success).toBe(true);
    }
  });
});

describe('destinosPossiveis', () => {
  it('lista as outras quatro colunas, na ordem do quadro', () => {
    expect(destinosPossiveis('aplicado')).toEqual([
      'entrevista_1',
      'fase_tecnica',
      'proposta',
      'rejeitado',
    ]);
    expect(destinosPossiveis('proposta')).toEqual([
      'aplicado',
      'entrevista_1',
      'fase_tecnica',
      'rejeitado',
    ]);
  });

  it('nunca inclui a coluna atual', () => {
    for (const status of ORDEM_DOS_CINCO) {
      expect(destinosPossiveis(status)).not.toContain(status);
    }
  });

  it('devolve sempre os quatro destinos, qualquer que seja a coluna atual', () => {
    for (const status of ORDEM_DOS_CINCO) {
      expect(destinosPossiveis(status)).toHaveLength(4);
    }
  });

  it('só devolve valores aceitos pelo schema de domínio', () => {
    for (const status of ORDEM_DOS_CINCO) {
      for (const destino of destinosPossiveis(status)) {
        expect(statusVagaSchema.safeParse(destino).success).toBe(true);
      }
    }
  });
});

describe('ordemDeDestino', () => {
  it('devolve 0 para coluna de destino vazia', () => {
    expect(ordemDeDestino([], 'fase_tecnica')).toBe(0);
    expect(ordemDeDestino([vaga({ status: 'aplicado' })], 'fase_tecnica')).toBe(0);
  });

  it('devolve a quantidade de vagas da coluna de destino, isto é, o fim da coluna', () => {
    const vagas = [
      vaga({ status: 'fase_tecnica', ordem: 0 }),
      vaga({ status: 'fase_tecnica', ordem: 1 }),
      vaga({ status: 'fase_tecnica', ordem: 2 }),
    ];

    expect(ordemDeDestino(vagas, 'fase_tecnica')).toBe(3);
  });

  it('conta só a coluna de destino, e não o total do quadro', () => {
    // Mesma regra da spec de persistência: a contagem é da coluna, não do quadro.
    const vagas = [
      vaga({ status: 'aplicado', ordem: 0 }),
      vaga({ status: 'aplicado', ordem: 1 }),
      vaga({ status: 'fase_tecnica', ordem: 0 }),
    ];

    expect(ordemDeDestino(vagas, 'fase_tecnica')).toBe(1);
    expect(ordemDeDestino(vagas, 'aplicado')).toBe(2);
  });

  it('ignora o card que está saindo, porque ele conta na origem e não no destino', () => {
    const vagas = [vaga({ status: 'aplicado' }), vaga({ status: 'entrevista_1' })];

    expect(ordemDeDestino(vagas, 'entrevista_1')).toBe(1);
  });
});
