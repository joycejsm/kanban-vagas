import { assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1';
import { describe, it } from 'jsr:@std/testing@1/bdd';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { VagaCreateInput, VagaRow } from '@/domain/vaga';

import { contarJanelas, JANELA_DIA_MS, JANELA_HORA_MS, marcarDesfecho, registrarTentativa } from './supabase.ts';
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

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

/**
 * Dublê do `supabase-js` para as três consultas de auditoria.
 *
 * O que este bloco segura é a **forma** das consultas, não o resultado delas: a
 * janela é enviada como timestamp e não como SQL, e o desfecho é filtrado pelo
 * `id` da linha. Um teste que só conferisse a contagem passada com a data de
 * hoje e falharia com a de amanhã.
 */

interface ConsultaAuditoria {
  tipo: 'insert' | 'select' | 'update';
  colunas: string | null;
  filtros: [string, unknown][];
  ordenacao: { coluna: string; crescente: boolean } | null;
  limite: number | null;
  valores: Record<string, unknown> | null;
}

const REGISTRO_ID = '9fcd1ce7-a5bb-4878-9479-14574acfa203';

function clienteAuditoria(
  opcoes: {
    erroInsert?: unknown;
    contagens?: number[];
    erroContagem?: unknown;
    linhasAtualizadas?: unknown[] | null;
    erroUpdate?: unknown;
  } = {},
) {
  const consultas: ConsultaAuditoria[] = [];
  const insercoes: Record<string, unknown>[] = [];
  const contagens = [...(opcoes.contagens ?? [0, 0])];

  function nova(tipo: ConsultaAuditoria['tipo'], colunas: string | null, valores: Record<string, unknown> | null): ConsultaAuditoria {
    const consulta: ConsultaAuditoria = { tipo, colunas, filtros: [], ordenacao: null, limite: null, valores };
    consultas.push(consulta);
    return consulta;
  }

  /** Encadeamento que o supabase-js resolve como thenable ao ser awaited. */
  function encadear(consulta: ConsultaAuditoria, resposta: () => Promise<unknown>) {
    const api = {
      eq(coluna: string, valor: unknown) {
        consulta.filtros.push([coluna, valor]);
        return api;
      },
      gte(coluna: string, valor: unknown) {
        consulta.filtros.push([coluna, valor]);
        return api;
      },
      order(coluna: string, opcoes?: { ascending?: boolean }) {
        consulta.ordenacao = { coluna, crescente: opcoes?.ascending ?? true };
        return api;
      },
      limit(quantidade: number) {
        consulta.limite = quantidade;
        return api;
      },
      select(colunas: string) {
        consulta.colunas = colunas;
        return api;
      },
      single() {
        return resposta();
      },
      then(resolve: (valor: unknown) => unknown, reject?: (motivo: unknown) => unknown) {
        return resposta().then(resolve, reject);
      },
    };
    return api;
  }

  const cliente = {
    from(_tabela: string) {
      return {
        insert(valores: Record<string, unknown>) {
          insercoes.push(valores);
          return encadear(nova('insert', null, valores), () =>
            Promise.resolve(
              opcoes.erroInsert
                ? { data: null, error: opcoes.erroInsert }
                : { data: { id: REGISTRO_ID }, error: null },
            ),
          );
        },
        select(colunas: string) {
          return encadear(nova('select', colunas, null), () => {
            const count = contagens.shift() ?? 0;
            return Promise.resolve({ data: null, count, error: opcoes.erroContagem ?? null });
          });
        },
        update(valores: Record<string, unknown>) {
          return encadear(nova('update', null, valores), () => {
            if (opcoes.erroUpdate) return Promise.resolve({ data: null, error: opcoes.erroUpdate });
            const data = opcoes.linhasAtualizadas === null
              ? []
              : (opcoes.linhasAtualizadas ?? [{ id: REGISTRO_ID }]);
            return Promise.resolve({ data, error: null });
          });
        },
      };
    },
  };

  return { cliente: cliente as unknown as SupabaseClient, consultas, insercoes };
}

describe('registrarTentativa', () => {
  it('devolve o id da linha criada, que é o que fecha o desfecho depois', async () => {
    const duble = clienteAuditoria();

    const registro = await registrarTentativa(duble.cliente, 'empresa.com');

    assertEquals(registro.id, REGISTRO_ID);
    assertEquals(duble.insercoes[0], { host: 'empresa.com', resultado: 'pendente' });
    assertEquals('user_id' in (duble.insercoes[0] ?? {}), false, 'o user_id vem do RLS, não do insert');
  });

  it('lança quando o registro não é criado, e sem linha para fechar', async () => {
    const duble = clienteAuditoria({ erroInsert: { code: '42501' } });

    await assertRejects(() => registrarTentativa(duble.cliente, 'empresa.com'));
  });
});

describe('contarJanelas — a janela é um valor, não uma expressão SQL', () => {
  const AGORA = Date.parse('2026-10-01T12:00:00.000Z');

  it('envia instantes em ISO 8601 nas duas janelas', async () => {
    const duble = clienteAuditoria({ contagens: [3, 9] });

    const janelas = await contarJanelas(duble.cliente, AGORA);

    assertEquals(janelas, { hora: 3, dia: 9 });
    const valores = duble.consultas.map((c) => c.filtros[0]?.[1]);
    assertEquals(valores, [
      new Date(AGORA - JANELA_HORA_MS).toISOString(),
      new Date(AGORA - JANELA_DIA_MS).toISOString(),
    ]);
  });

  it('nunca manda SQL no filtro, que o banco recusa como formato inválido', async () => {
    const duble = clienteAuditoria();

    await contarJanelas(duble.cliente, AGORA);

    // O defeito que travou toda a ingestão: `now() - interval '1 hour'` como valor
    // de filtro devolve 400/22007 do PostgREST — e, com `head: true`, sem corpo,
    // o que chega ao supabase-js como erro de mensagem vazia.
    for (const consulta of duble.consultas) {
      const valor = String(consulta.filtros[0]?.[1] ?? '');
      assertEquals(valor.includes('now()'), false, `filtro com SQL: ${valor}`);
      assertEquals(valor.includes('interval'), false, `filtro com SQL: ${valor}`);
      assertMatch(valor, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
      assertEquals(consulta.filtros[0]?.[0], 'criado_em');
    }
  });

  it('as duas janelas saem do mesmo instante, e a do dia é maior que a da hora', async () => {
    const duble = clienteAuditoria();

    await contarJanelas(duble.cliente, AGORA);

    const [hora, dia] = duble.consultas.map((c) => Date.parse(String(c.filtros[0]?.[1])));
    assertEquals(AGORA - hora!, JANELA_HORA_MS);
    assertEquals(AGORA - dia!, JANELA_DIA_MS);
    assertEquals(hora! > dia!, true, 'a janela do dia começa antes e contém a da hora');
  });

  it('lança quando o banco recusa a contagem', async () => {
    const duble = clienteAuditoria({ erroContagem: { code: '22007', message: '' } });

    await assertRejects(() => contarJanelas(duble.cliente, AGORA));
  });
});

describe('marcarDesfecho — a linha que a tentativa criou', () => {
  it('filtra pelo id, e não por "a pendente mais recente"', async () => {
    const duble = clienteAuditoria();

    const { gravado } = await marcarDesfecho(duble.cliente, REGISTRO_ID, 'sucesso');

    const update = duble.consultas.find((c) => c.tipo === 'update');
    assertEquals(update?.filtros, [['id', REGISTRO_ID]]);
    assertEquals(update?.valores, { resultado: 'sucesso' });
    assertEquals(update?.ordenacao, null, 'ordenar não é aplicado em escrita');
    assertEquals(update?.limite, null, 'limitar não é aplicado em escrita');
    assertEquals(update?.colunas, 'id', 'o select distingue "gravou" de "não encontrou"');
    assertEquals(gravado, true);
  });

  it('relança o erro do banco cru, para o SQLSTATE chegar ao log', async () => {
    const falha = { code: '42501', message: 'permission denied for table ingest_log' };
    const duble = clienteAuditoria({ erroUpdate: falha });

    // Embrulhar em `Error` esconderia o `.code`, que é público e é o que diagnostica.
    let capturado: unknown = null;
    try {
      await marcarDesfecho(duble.cliente, REGISTRO_ID, 'erro');
    } catch (erro) {
      capturado = erro;
    }

    assertEquals(capturado, falha);
  });

  it('distingue a atualização sem linhas de uma gravação efetiva', async () => {
    const duble = clienteAuditoria({ linhasAtualizadas: [] });

    const { gravado } = await marcarDesfecho(duble.cliente, REGISTRO_ID, 'erro');

    // A API de escrita devolve sucesso mesmo sem alterar nada; sem este retorno, a
    // linha podia ficar `pendente` e o log continuaria mudo.
    assertEquals(gravado, false);
  });
});
