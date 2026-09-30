import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  restaurarDependencias,
  substituirDependencias,
  type DependenciasDasActions,
} from '@/app/actions/dependencias';
import { type VagaRow } from '@/domain/vaga';
import {
  AVISO_DE_FALHA,
  carregarQuadro,
  ehEstadoVazio,
  statusOcupados,
} from '@/quadro/carregarQuadro';

/**
 * Testes da carga do quadro (design D4).
 *
 * A carga passa pelo mesmo `dependencias()` das Server Actions, então estes testes rodam sem
 * banco e sem rede, do mesmo jeito que os das actions: o que se exercita é a borda entre a
 * falha do serviço e a tela — justamente o ponto em que um erro de banco viraria uma tela
 * quebrada do Next.
 */

const LINHA: VagaRow = {
  id: '11111111-1111-1111-1111-111111111111',
  user_id: '22222222-2222-2222-2222-222222222222',
  // URL com parâmetro de rastreamento de propósito: é a `url` que o usuário colou, e é ela que
  // o card usa. Trocar pela `url_normalizada` esconderia o anúncio original de quem se candidatou.
  url: 'https://empresa.com/vaga/7?utm_source=linkedin',
  url_normalizada: 'https://empresa.com/vaga/7',
  titulo: 'Engenheira de Software',
  empresa: 'Empresa X',
  requisitos: ['TypeScript', 'Postgres'],
  senioridade: 'Senior',
  status: 'aplicado',
  ordem: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

/** Cliente falso: o ponto é que ele seja o mesmo objeto repassado ao serviço. */
function clienteFalso(): Record<string, unknown> {
  return { auth: { getUser: vi.fn(), getSession: vi.fn() } };
}

/** Instala a dependência de carga com o `listarVagas` devolvendo `linhas`. */
function instalarComListagem(linhas: VagaRow[]) {
  const listarVagas = vi.fn().mockResolvedValue(linhas);
  const cliente = clienteFalso();
  const criarClienteSupabase = vi.fn().mockResolvedValue(cliente);
  const criarVagaService = vi.fn().mockReturnValue({ listarVagas });

  substituirDependencias({
    criarClienteSupabase,
    criarVagaService,
  } as Partial<DependenciasDasActions>);

  return { listarVagas, cliente, criarClienteSupabase, criarVagaService };
}

afterEach(() => {
  restaurarDependencias();
  vi.restoreAllMocks();
});

describe('carregarQuadro — leitura bem-sucedida', () => {
  it('agrupa as vagas nas cinco colunas, na ordem do serviço', async () => {
    instalarComListagem([
      { ...LINHA, status: 'fase_tecnica', ordem: 0 },
      { ...LINHA, id: '33333333-3333-3333-3333-333333333333', status: 'aplicado', ordem: 0 },
    ]);

    const resultado = await carregarQuadro();

    expect(resultado.colunas).toHaveLength(5);
    expect(resultado.colunas.map((coluna) => coluna.status)).toEqual([
      'aplicado',
      'entrevista_1',
      'fase_tecnica',
      'proposta',
      'rejeitado',
    ]);
    expect(resultado.aviso).toBeNull();
  });

  it('preserva a ordem devolvida pelo serviço, sem reordenar', async () => {
    // Reordenar aqui trocaria a consulta sustentada pelo índice `(user_id, status, ordem)` por
    // um sort em JavaScript, e a ordem do banco é a que o usuário reconhece.
    instalarComListagem([
      { ...LINHA, id: 'aaaaaaaaaaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'aplicado', ordem: 0 },
      { ...LINHA, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', status: 'aplicado', ordem: 1 },
      { ...LINHA, id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', status: 'aplicado', ordem: 2 },
    ]);

    const resultado = await carregarQuadro();

    expect(
      resultado.colunas.find((coluna) => coluna.status === 'aplicado')?.vagas.map((v) => v.ordem),
    ).toEqual([0, 1, 2]);
  });

  it('entrega a vaga sem alterar nenhum campo, url inclusive', async () => {
    // O card depende disso duas vezes: o link do anúncio usa a `url` do usuário, e a lista de
    // requisitos é o que a extração devolve. Um `parse` no meio do caminho aqui já valeria como
    // perda de dado.
    instalarComListagem([LINHA]);

    const resultado = await carregarQuadro();

    expect(resultado.vagas).toEqual([LINHA]);
    expect(resultado.vagas[0]?.url).toBe('https://empresa.com/vaga/7?utm_source=linkedin');
    expect(resultado.vagas[0]?.url_normalizada).toBe('https://empresa.com/vaga/7');
    expect(resultado.colunas[0]?.vagas[0]).toEqual(LINHA);
  });

  it('lê pelo cliente da requisição, e o mesmo cliente vai para o serviço', async () => {
    // É esse cliente que carrega o JWT, e é por isso que o RLS — não um privilégio — decide o
    // que a consulta devolve (invariante 2).
    const dublês = instalarComListagem([LINHA]);

    await carregarQuadro();

    expect(dublês.criarClienteSupabase).toHaveBeenCalledTimes(1);
    expect(dublês.criarVagaService).toHaveBeenCalledWith(dublês.cliente);
    expect(dublês.listarVagas).toHaveBeenCalledTimes(1);
  });

  it('não aceita user_id por parâmetro: a carga não tem esse argumento', async () => {
    instalarComListagem([LINHA]);

    // `carregarQuadro` não tem parâmetro nenhum, e é isso que garante que não há caminho para
    // passar o dono da linha por aqui.
    expect(carregarQuadro.length).toBe(0);
  });
});

describe('carregarQuadro — falha de leitura', () => {
  it('devolve as cinco colunas vazias e um aviso, em vez de propagar a exceção', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    substituirDependencias({
      criarClienteSupabase: vi.fn().mockResolvedValue(clienteFalso()),
      criarVagaService: vi.fn().mockReturnValue({
        listarVagas: vi.fn().mockRejectedValue(new Error('connection refused')),
      }),
    } as Partial<DependenciasDasActions>);

    const resultado = await carregarQuadro();

    expect(resultado.colunas).toHaveLength(5);
    expect(resultado.colunas.every((coluna) => coluna.vagas.length === 0)).toBe(true);
    expect(resultado.vagas).toEqual([]);
    expect(resultado.aviso).toBe(AVISO_DE_FALHA);
  });

  it('o aviso não carrega o texto do erro, nome de tabela nem identificador de usuário', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    substituirDependencias({
      criarClienteSupabase: vi.fn().mockResolvedValue(clienteFalso()),
      criarVagaService: vi.fn().mockReturnValue({
        listarVagas: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'permission denied for table vagas; user 22222222-2222-2222-2222-222222222222 does not have select',
            ),
          ),
      }),
    } as Partial<DependenciasDasActions>);

    const resultado = await carregarQuadro();

    // O termo "vagas" aparece em português na mensagem e é correto; o que não pode vazar é a
    // forma técnica — o erro do banco, o nome qualificado da tabela e o id da conta.
    expect(resultado.aviso).not.toMatch(
      /permission|denied|22222222|select|connection|Error|at Object|public\./i,
    );
  });

  it('registra a falha no servidor sem o valor da exceção', async () => {
    // Invariante 9: o log ajuda a depurar e não carrega o conteúdo que o banco devolveu.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    substituirDependencias({
      criarClienteSupabase: vi.fn().mockResolvedValue(clienteFalso()),
      criarVagaService: vi.fn().mockReturnValue({
        listarVagas: vi.fn().mockRejectedValue(new Error('segredo que nao pode aparecer no log')),
      }),
    } as Partial<DependenciasDasActions>);

    await carregarQuadro();

    expect(spy).toHaveBeenCalled();
    const registrado = spy.mock.calls.flat().join(' ');
    expect(registrado).toContain('listarVagas');
    expect(registrado).not.toContain('segredo que nao pode aparecer no log');
  });

  it('uma falha da fábrica de cliente também vira aviso, não exceção', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    substituirDependencias({
      criarClienteSupabase: vi.fn().mockRejectedValue(new Error('sem sessão')),
    } as Partial<DependenciasDasActions>);

    const resultado = await carregarQuadro();

    expect(resultado.aviso).toBe(AVISO_DE_FALHA);
    expect(resultado.colunas).toHaveLength(5);
  });
});

describe('ehEstadoVazio', () => {
  it('é verdadeiro só quando não há vaga e não houve falha', async () => {
    instalarComListagem([]);
    expect(ehEstadoVazio(await carregarQuadro())).toBe(true);

    instalarComListagem([LINHA]);
    expect(ehEstadoVazio(await carregarQuadro())).toBe(false);
  });

  it('é falso quando a leitura falhou, mesmo sem vaga alguma', async () => {
    // A falha e o estado vazio desenham a mesma tela de cinco colunas zeradas. Confundi-los
    // faria a página dizer "você não tem vagas" para quem tem, logo depois de uma falha.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    substituirDependencias({
      criarClienteSupabase: vi.fn().mockResolvedValue(clienteFalso()),
      criarVagaService: vi.fn().mockReturnValue({
        listarVagas: vi.fn().mockRejectedValue(new Error('boom')),
      }),
    } as Partial<DependenciasDasActions>);

    expect(ehEstadoVazio(await carregarQuadro())).toBe(false);
  });
});

describe('statusOcupados', () => {
  it('lista só as colunas com vaga, na ordem do quadro', async () => {
    instalarComListagem([LINHA, { ...LINHA, status: 'proposta' }, { ...LINHA, status: 'aplicado' }]);

    const resultado = await carregarQuadro();

    expect(statusOcupados(resultado.colunas)).toEqual(['aplicado', 'proposta']);
  });

  it('devolve lista vazia quando não há vaga alguma', async () => {
    instalarComListagem([]);

    expect(statusOcupados((await carregarQuadro()).colunas)).toEqual([]);
  });
});
