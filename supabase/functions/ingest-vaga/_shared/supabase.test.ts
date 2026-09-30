import { assertEquals } from 'jsr:@std/assert@1';
import { describe, it } from 'jsr:@std/testing@1/bdd';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { VagaCreateInput, VagaRow } from '@/domain/vaga';

import { inserirVaga } from './supabase.ts';

/**
 * Testes da inserção de vaga — em particular do cálculo de `ordem`.
 *
 * A posição de entrada no quadro é a parte do contrato da Fase 2 que nenhuma
 * suíte cobria: `pipeline.test.ts` injeta um dublê em `deps.inserir` e contorna
 * a inserção real, e o pgTAP exercita `ordem` por `UPDATE`, não pelo cálculo do
 * `insert`. O modo de falha é silencioso — remover o filtro de status faz o card
 * novo colar no topo da coluna, e nada sente.
 *
 * O dublê abaixo registra as consultas para poder afirmar a *forma* da busca
 * (`status = aplicado`, ordem decrescente, `limit 1`), e não só o resultado.
 *
 * Limite honesto deste arquivo: ele trava a aritmética e a query, não o
 * comportamento ponta a ponta contra o Postgres. O isolamento real entre
 * usuários vem do RLS sobre o cliente da sessão e é provado pelo pgTAP
 * (`supabase/tests/vagas_rls.sql`).
 */

const USUARIO_ID = '7a3c1d2e-4b5f-4a6c-8d9e-0f1a2b3c4d5e';
const VAGA_ID = '3f1b0e2a-8c4d-4a91-b7e6-0d2a5c9f1234';
const INSTANTE = '2026-01-01T00:00:00.000Z';

const DADOS: VagaCreateInput = {
  url: 'https://empresa.com/vaga/1',
  titulo: 'Engenheira de Software',
  empresa: 'Empresa X',
  requisitos: ['TypeScript'],
  senioridade: 'Senior',
};

interface Consulta {
  colunas: string;
  filtros: [string, unknown][];
  ordenacao: { coluna: string; crescente: boolean } | null;
  limite: number | null;
}

/**
 * Cliente dublê que responde à cadeia encadeada do supabase-js.
 * Os nomes dos métodos acompanham a API real (`select`, `eq`, `order`, `limit`,
 * `maybeSingle`, `insert`, `single`) porque é essa superfície que `inserirVaga`
 * consome; a simulação é do cliente, não do dado.
 */
function clienteDuble(opcoes: { maiorOrdem: number | null; erroInsert?: unknown }) {
  const consultas: Consulta[] = [];
  const insercoes: Record<string, unknown>[] = [];
  let atual: Consulta | null = null;

  function linha(valores: Record<string, unknown>): VagaRow {
    return {
      id: VAGA_ID,
      user_id: USUARIO_ID,
      url: valores.url as string,
      url_normalizada: valores.url as string,
      titulo: valores.titulo as string,
      empresa: valores.empresa as string,
      requisitos: valores.requisitos as string[],
      senioridade: valores.senioridade as VagaRow['senioridade'],
      status: 'aplicado',
      ordem: valores.ordem as number,
      created_at: INSTANTE,
      updated_at: INSTANTE,
    };
  }

  const cliente = {
    from(_tabela: string) {
      return {
        select(colunas: string) {
          atual = { colunas, filtros: [], ordenacao: null, limite: null };
          consultas.push(atual);

          const api = {
            eq(coluna: string, valor: unknown) {
              atual?.filtros.push([coluna, valor]);
              return api;
            },
            order(coluna: string, opcoes?: { ascending?: boolean }) {
              if (atual) atual.ordenacao = { coluna, crescente: opcoes?.ascending ?? true };
              return api;
            },
            limit(quantidade: number) {
              if (atual) atual.limite = quantidade;
              return api;
            },
            maybeSingle() {
              return Promise.resolve({
                data: opcoes.maiorOrdem === null ? null : { ordem: opcoes.maiorOrdem },
                error: null,
              });
            },
          };
          return api;
        },
        insert(valores: Record<string, unknown>) {
          insercoes.push(valores);
          return {
            select(_colunas: string) {
              return {
                single() {
                  return Promise.resolve(
                    opcoes.erroInsert
                      ? { data: null, error: opcoes.erroInsert }
                      : { data: linha(valores), error: null },
                  );
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    cliente: cliente as unknown as SupabaseClient,
    consultas,
    insercoes,
  };
}

describe('inserirVaga — posição de entrada no quadro', () => {
  it('entra no fim da coluna de destino', async () => {
    const duble = clienteDuble({ maiorOrdem: 2 });

    const vaga = await inserirVaga(duble.cliente, DADOS);

    assertEquals(vaga.ordem, 3);
    assertEquals(duble.insercoes[0]?.status, 'aplicado');
    assertEquals(duble.insercoes[0]?.ordem, 3);
  });

  it('a primeira vaga da coluna recebe ordem zero', async () => {
    const duble = clienteDuble({ maiorOrdem: null });

    const vaga = await inserirVaga(duble.cliente, DADOS);

    assertEquals(vaga.ordem, 0);
  });

  it('a posição é calculada sobre a coluna de destino, e não sobre o quadro inteiro', async () => {
    const duble = clienteDuble({ maiorOrdem: 2 });

    await inserirVaga(duble.cliente, DADOS);

    // Só a coluna `aplicado` entra no cálculo: uma vaga em `entrevista_1` com
    // `ordem` 99 não pode empurrar o card novo para o fim do quadro.
    assertEquals(duble.consultas.length, 1);
    assertEquals(duble.consultas[0]?.filtros, [['status', 'aplicado']]);
    assertEquals(duble.consultas[0]?.ordenacao, { coluna: 'ordem', crescente: false });
    assertEquals(duble.consultas[0]?.limite, 1);
  });

  it('não filtra nem grava `user_id`, delegando o isolamento ao RLS da sessão', async () => {
    const duble = clienteDuble({ maiorOrdem: 0 });

    await inserirVaga(duble.cliente, DADOS);

    // Se `inserirVaga` mandasse um filtro de usuário, a posição passaria a
    // depender de dado vindo do cliente. O isolamento vem do cliente da sessão.
    const semUserId = duble.consultas[0]?.filtros.some(([coluna]) => coluna === 'user_id');
    assertEquals(semUserId, false);
    assertEquals('user_id' in (duble.insercoes[0] ?? {}), false);
  });

  it('propaga o erro do banco como está, que o pipeline traduz em 409', async () => {
    const falha = { code: '23505', constraint: 'vagas_user_id_url_normalizada_key' };
    const duble = clienteDuble({ maiorOrdem: 0, erroInsert: falha });

    // O erro é relançado cru, não embrulhado em `Error`: o pipeline lê `.code`
    // para decidir entre 409 e 500, e embrulhá-lo aqui esconderia esse contrato.
    let capturado: unknown = null;
    try {
      await inserirVaga(duble.cliente, DADOS);
    } catch (erro) {
      capturado = erro;
    }

    assertEquals(capturado, falha);
  });
});
