import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  restaurarDependencias,
  substituirDependencias,
  type DependenciasDasActions,
} from '@/app/actions/dependencias';
import {
  adicionarVaga,
  adicionarVagaComEstado,
  atualizarStatus,
  removerVaga,
  type EstadoDoFormulario,
} from '@/app/actions/vagas';
import { MENSAGENS, MENSAGENS_DO_QUADRO } from '@/app/actions/erros';

/**
 * Testes das Server Actions com dependências injetadas (design D10).
 *
 * Nenhuma dependência real é tocada: sem banco, sem Edge Function, sem rede. O que se testa
 * é a parte que é do Next — validação, ordem das barreiras, encaminhamento e tradução de
 * erro. A integração real fica para a suíte com Supabase local.
 */

const LINHA_VALIDA = {
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
} as const;

/** Cliente falso com sessão válida por padrão. */
function clienteComSessao(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 'token-de-sessao' } }, error: null }),
      ...overrides,
    },
  };
}

function formDataCom(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) {
    fd.append(chave, valor);
  }
  return fd;
}

/**
 * Espia as dependências injetadas e devolve os observadores usados nas asserções.
 *
 * Um ajuste passado aqui **substitui** o dublê e também o observador devolvido: se devolvesse
 * o dublê padrão, a asserção ficaria olhando para um espião que a action nunca chamou, e o
 * teste passaria sem verificar nada. Por isso os dois vêm do objeto final.
 */
function instalarDublês(ajustes: Partial<DependenciasDasActions> = {}) {
  const ativo: Pick<
    DependenciasDasActions,
    'criarClienteSupabase' | 'criarVagaService' | 'revalidarCaminho' | 'invocarFuncao'
  > = {
    criarClienteSupabase: vi.fn().mockResolvedValue(clienteComSessao()),
    criarVagaService: vi.fn(),
    revalidarCaminho: vi.fn(),
    invocarFuncao: vi.fn(),
    ...ajustes,
  };

  const restaurar = substituirDependencias({
    ...ativo,
    resolverUrlDaFuncao: () => 'https://projeto.supabase.co/functions/v1/ingest-vaga',
  });

  return { ...ativo, restaurar };
}

function respostaJson(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  restaurarDependencias();
  vi.restoreAllMocks();
});

describe('adicionarVaga — validação antes de qualquer efeito', () => {
  it('recusa http:// sem chamar a Edge Function', async () => {
    const dublês = instalarDublês();

    const resultado = await adicionarVaga(formDataCom({ url: 'http://empresa.com/vaga/1' }));

    expect(resultado.ok).toBe(false);
    expect(dublês.invocarFuncao).not.toHaveBeenCalled();
    expect(dublês.criarClienteSupabase).not.toHaveBeenCalled();
  });

  it('recusa URL vazia ou ausente com mensagem em pt-BR', async () => {
    const dublês = instalarDublês();

    const vazia = await adicionarVaga(formDataCom({ url: '' }));
    const ausente = await adicionarVaga(new FormData());

    expect(vazia.ok).toBe(false);
    expect(ausente.ok).toBe(false);
    if (!vazia.ok) {
      expect(vazia.mensagem).toMatch(/URL/i);
    }
    expect(dublês.invocarFuncao).not.toHaveBeenCalled();
  });

  it('recusa URL que não é URL, e recusa texto acima do limite colado', async () => {
    const dublês = instalarDublês();

    const naoUrl = await adicionarVaga(formDataCom({ url: 'nao é uma url' }));
    const textoLongo = await adicionarVaga(
      formDataCom({ url: 'https://empresa.com/vaga/1', texto: 'a'.repeat(30_001) }),
    );

    expect(naoUrl.ok).toBe(false);
    expect(textoLongo.ok).toBe(false);
    expect(dublês.invocarFuncao).not.toHaveBeenCalled();
  });

  it('aceita texto colado exatamente no limite de 30.000', async () => {
    const dublês = instalarDublês({
      invocarFuncao: vi.fn().mockResolvedValue(respostaJson(201, { vaga: LINHA_VALIDA })),
    });

    const resultado = await adicionarVaga(
      formDataCom({ url: 'https://empresa.com/vaga/1', texto: 'a'.repeat(30_000) }),
    );

    expect(resultado.ok).toBe(true);
    expect(dublês.invocarFuncao).toHaveBeenCalledTimes(1);
  });
});

describe('adicionarVaga — sessão', () => {
  it('sem usuário, devolve sessao_expirada e não grava nem chama a função', async () => {
    const dublês = instalarDublês({
      criarClienteSupabase: vi.fn().mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        },
      }),
    });

    const resultado = await adicionarVaga(formDataCom({ url: 'https://empresa.com/vaga/1' }));

    expect(resultado).toEqual({
      ok: false,
      code: 'sessao_expirada',
      mensagem: 'Sua sessão expirou. Entre novamente.',
    });
    expect(dublês.invocarFuncao).not.toHaveBeenCalled();
    expect(dublês.revalidarCaminho).not.toHaveBeenCalled();
  });

  it('usuário válido sem access_token também é sessão expirada, e não uma chamada sem token', async () => {
    const dublês = instalarDublês({
      criarClienteSupabase: vi.fn().mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u' } }, error: null }),
          getSession: vi.fn().mockResolvedValue({ data: { session: {} }, error: null }),
        },
      }),
    });

    const resultado = await adicionarVaga(formDataCom({ url: 'https://empresa.com/vaga/1' }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.code).toBe('sessao_expirada');
    }
    expect(dublês.invocarFuncao).not.toHaveBeenCalled();
  });

  it('repassa o token da sessão no encaminhamento', async () => {
    const invocarFuncao = vi.fn().mockResolvedValue(respostaJson(201, { vaga: LINHA_VALIDA }));
    instalarDublês({ invocarFuncao });

    await adicionarVaga(formDataCom({ url: 'https://empresa.com/vaga/1' }));

    expect(invocarFuncao).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'token-de-sessao' }),
    );
  });
});

describe('adicionarVaga — encaminhamento e retorno', () => {
  it('sucesso 201 devolve a vaga e revalida /', async () => {
    const dublês = instalarDublês({
      invocarFuncao: vi.fn().mockResolvedValue(respostaJson(201, { vaga: LINHA_VALIDA })),
    });

    const resultado = await adicionarVaga(formDataCom({ url: 'https://empresa.com/vaga/1' }));

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.vaga).toEqual(LINHA_VALIDA);
    }
    expect(dublês.revalidarCaminho).toHaveBeenCalledWith('/');
  });

  it('encaminha o texto de fallback sem processá-lo no Next', async () => {
    const invocarFuncao = vi.fn().mockResolvedValue(respostaJson(201, { vaga: LINHA_VALIDA }));
    instalarDublês({ invocarFuncao });

    await adicionarVaga(
      formDataCom({ url: 'https://empresa.com/vaga/1', texto: 'Vaga de Engenheira de Software' }),
    );

    expect(invocarFuncao).toHaveBeenCalledWith(
      expect.objectContaining({
        corpo: { url: 'https://empresa.com/vaga/1', texto: 'Vaga de Engenheira de Software' },
      }),
    );
  });

  it('o corpo enviado não carrega user_id, status ou ordem', async () => {
    const invocarFuncao = vi.fn().mockResolvedValue(respostaJson(201, { vaga: LINHA_VALIDA }));
    instalarDublês({ invocarFuncao });

    // O formulário traz campos de servidor junto da URL: a action precisa descartá-los.
    await adicionarVaga(
      formDataCom({
        url: 'https://empresa.com/vaga/1',
        user_id: '99999999-9999-9999-9999-999999999999',
        status: 'proposta',
        ordem: '7',
      }),
    );

    const { corpo } = invocarFuncao.mock.calls[0]![0] as { corpo: Record<string, unknown> };
    expect(Object.keys(corpo).sort()).toEqual(['url']);
    expect(corpo).not.toHaveProperty('user_id');
    expect(corpo).not.toHaveProperty('status');
    expect(corpo).not.toHaveProperty('ordem');
  });

  it('2xx com envelope inesperado vira erro, e não meia vaga', async () => {
    const dublês = instalarDublês({
      invocarFuncao: vi.fn().mockResolvedValue(respostaJson(201, { vaga: { id: 'nao-e-uuid' } })),
    });

    const resultado = await adicionarVaga(formDataCom({ url: 'https://empresa.com/vaga/1' }));

    expect(resultado.ok).toBe(false);
    expect(dublês.revalidarCaminho).not.toHaveBeenCalled();
  });

  it('corpo ilegível no erro não vira exceção', async () => {
    instalarDublês({
      invocarFuncao: vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })),
    });

    const resultado = await adicionarVaga(formDataCom({ url: 'https://empresa.com/vaga/1' }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.code).toBe('erro');
    }
  });
});

describe('adicionarVaga — tradução de erro', () => {
  const casos: { status: number; code: string; texto: string }[] = [
    { status: 409, code: 'duplicada', texto: 'Você já cadastrou esta vaga.' },
    { status: 422, code: 'extracao_falhou', texto: 'Cole o texto do anúncio' },
    { status: 413, code: 'extracao_falhou', texto: 'Cole o texto do anúncio' },
    { status: 429, code: 'limite_uso', texto: 'Limite de ingestões atingido' },
    { status: 401, code: 'sessao_expirada', texto: 'Sua sessão expirou' },
    { status: 403, code: 'sessao_expirada', texto: 'Sua sessão expirou' },
    { status: 500, code: 'erro', texto: 'Tente novamente' },
    { status: 418, code: 'erro', texto: 'Tente novamente' },
  ];

  for (const { status, code, texto } of casos) {
    it(`${status} vira ${code}`, async () => {
      const dublês = instalarDublês({
        invocarFuncao: vi
          .fn()
          .mockResolvedValue(respostaJson(status, { code: 'x', message: 'detalhe interno' })),
      });

      const resultado = await adicionarVaga(formDataCom({ url: 'https://empresa.com/vaga/1' }));

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.code).toBe(code);
        expect(resultado.mensagem).toContain(texto);
        // O corpo da função é material externo e não pode aparecer na mensagem.
        expect(resultado.mensagem).not.toContain('detalhe interno');
      }
      // Falha nunca revalida: só o caminho feliz mexe no cache (design D8).
      expect(dublês.revalidarCaminho).not.toHaveBeenCalled();
    });
  }

  it('a mensagem de erro não carrega corpo da resposta, SQL nem stack', async () => {
    const corpoVazado = {
      code: 'extracao_insuficiente',
      message: 'Erro em relation "vagas": duplicate key value violates unique constraint',
      detalhe: 'at Object.insert (/var/task/functions/ingest-vaga/index.ts:42:11)',
    };
    instalarDublês({ invocarFuncao: vi.fn().mockResolvedValue(respostaJson(422, corpoVazado)) });

    const resultado = await adicionarVaga(formDataCom({ url: 'https://empresa.com/vaga/1' }));

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      const serializado = JSON.stringify(resultado);
      expect(serializado).not.toMatch(/relation|constraint|SELECT|INSERT|at Object|\.ts:/i);
    }
  });
});

describe('atualizarStatus — validação', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('rejeita novoStatus fora do enum sem gravar', async () => {
    const dublês = instalarDublês();

    const resultado = await atualizarStatus({
      vagaId: LINHA_VALIDA.id,
      novoStatus: 'foo',
      ordem: 1,
    });

    expect(resultado.ok).toBe(false);
    expect(dublês.criarVagaService).not.toHaveBeenCalled();
  });

  it('rejeita vagaId que não é UUID sem gravar', async () => {
    const dublês = instalarDublês();

    const resultado = await atualizarStatus({ vagaId: 'nao-e-uuid', novoStatus: 'proposta' });

    expect(resultado.ok).toBe(false);
    expect(dublês.criarVagaService).not.toHaveBeenCalled();
  });

  it('rejeita payload com user_id, em vez de ignorá-lo em silêncio', async () => {
    const dublês = instalarDublês();

    const resultado = await atualizarStatus({
      vagaId: LINHA_VALIDA.id,
      novoStatus: 'proposta',
      user_id: '99999999-9999-9999-9999-999999999999',
    });

    expect(resultado.ok).toBe(false);
    expect(dublês.criarVagaService).not.toHaveBeenCalled();
  });

  it('sem sessão, devolve sessao_expirada e não grava', async () => {
    const dublês = instalarDublês({
      criarClienteSupabase: vi.fn().mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        },
      }),
    });

    const resultado = await atualizarStatus({ vagaId: LINHA_VALIDA.id, novoStatus: 'proposta' });

    expect(resultado).toEqual({
      ok: false,
      code: 'sessao_expirada',
      mensagem: 'Sua sessão expirou. Entre novamente.',
    });
    expect(dublês.criarVagaService).not.toHaveBeenCalled();
  });
});

describe('atualizarStatus — persistência', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('movimentação válida persiste e devolve sucesso', async () => {
    const atualizarStatusService = vi.fn().mockResolvedValue(LINHA_VALIDA);
    const dublês = instalarDublês({
      criarVagaService: vi.fn().mockReturnValue({ atualizarStatus: atualizarStatusService }),
    });

    const resultado = await atualizarStatus({
      vagaId: LINHA_VALIDA.id,
      novoStatus: 'entrevista_1',
      ordem: 3,
    });

    expect(resultado).toEqual({ ok: true });
    expect(atualizarStatusService).toHaveBeenCalledWith(LINHA_VALIDA.id, 'entrevista_1', 3);
    // Não revalida: o drop é otimista (design D8).
    expect(dublês.revalidarCaminho).not.toHaveBeenCalled();
  });

  it('ordem ausente chega ao serviço como undefined, para manter a posição', async () => {
    const atualizarStatusService = vi.fn().mockResolvedValue(LINHA_VALIDA);
    instalarDublês({
      criarVagaService: vi.fn().mockReturnValue({ atualizarStatus: atualizarStatusService }),
    });

    await atualizarStatus({ vagaId: LINHA_VALIDA.id, novoStatus: 'proposta' });

    expect(atualizarStatusService).toHaveBeenCalledWith(LINHA_VALIDA.id, 'proposta', undefined);
  });

  it('zero linhas afetadas vira "Vaga não encontrada"', async () => {
    instalarDublês({
      criarVagaService: vi.fn().mockReturnValue({ atualizarStatus: vi.fn().mockResolvedValue(null) }),
    });

    const resultado = await atualizarStatus({ vagaId: LINHA_VALIDA.id, novoStatus: 'proposta' });

    expect(resultado).toEqual({
      ok: false,
      code: 'erro',
      mensagem: 'Vaga não encontrada.',
    });
  });

  it('id inexistente e vaga alheia recebem a MESMA resposta, sem oráculo de enumeração', async () => {
    // O serviço devolve `null` nos dois casos — é o RLS que não diz qual dos dois foi.
    const porUsuario = vi.fn().mockResolvedValue(null);
    instalarDublês({ criarVagaService: vi.fn().mockReturnValue({ atualizarStatus: porUsuario }) });

    const inexistente = await atualizarStatus({
      vagaId: '00000000-0000-0000-0000-000000000000',
      novoStatus: 'proposta',
    });
    const alheia = await atualizarStatus({
      vagaId: '33333333-3333-3333-3333-333333333333',
      novoStatus: 'proposta',
    });

    expect(inexistente).toEqual(alheia);
    expect(inexistente.ok).toBe(false);
  });

  it('falha do serviço não vaza detalhe e não revalida', async () => {
    const dublês = instalarDublês({
      criarVagaService: vi.fn().mockReturnValue({
        atualizarStatus: vi
          .fn()
          .mockRejectedValue(new Error('duplicate key value violates unique constraint')),
      }),
    });

    const resultado = await atualizarStatus({ vagaId: LINHA_VALIDA.id, novoStatus: 'proposta' });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.mensagem).not.toMatch(/constraint|duplicate|relation/i);
    }
    expect(dublês.revalidarCaminho).not.toHaveBeenCalled();
  });
});

describe('adicionarVaga — forma do retorno (task 5.5)', () => {
  it('devolve só { ok, vaga }, e a vaga só com os campos do schema de domínio', async () => {
    // A função devolve a linha com campos a mais. `vagaRowSchema` não é estrito, então os
    // extras são descartados na validação — e é isso que impede que um campo novo no
    // envelope da função vire campo novo no payload do navegador.
    instalarDublês({
      invocarFuncao: vi.fn().mockResolvedValue(
        respostaJson(201, {
          vaga: { ...LINHA_VALIDA, token_secreto: 'vaza', cabecalho_authorization: 'Bearer x' },
        }),
      ),
    });

    const resultado = await adicionarVaga(formDataCom({ url: 'https://empresa.com/vaga/1' }));

    expect(Object.keys(resultado).sort()).toEqual(['ok', 'vaga']);
    if (resultado.ok) {
      expect(Object.keys(resultado.vaga as object).sort()).toEqual(Object.keys(LINHA_VALIDA).sort());
      expect(JSON.stringify(resultado)).not.toMatch(/token_secreto|cabecalho_authorization|Bearer/);
    }
  });
});

describe('removerVaga — validação antes de qualquer efeito', () => {
  it('recusa vagaId que não é UUID sem chamar o serviço', async () => {
    const dublês = instalarDublês();

    const resultado = await removerVaga({ vagaId: 'nao-e-um-uuid' });

    expect(resultado.ok).toBe(false);
    expect(dublês.criarVagaService).not.toHaveBeenCalled();
    expect(dublês.revalidarCaminho).not.toHaveBeenCalled();
  });

  it('recusa payload sem vagaId', async () => {
    const dublês = instalarDublês();

    const resultado = await removerVaga({});

    expect(resultado.ok).toBe(false);
    expect(dublês.criarVagaService).not.toHaveBeenCalled();
  });

  it('recusa entrada não-objeto sem tocar em nada', async () => {
    const dublês = instalarDublês();

    for (const entrada of [null, undefined, 'apagar', 42, [LINHA_VALIDA.id]]) {
      const resultado = await removerVaga(entrada);
      expect(resultado.ok).toBe(false);
    }
    expect(dublês.criarVagaService).not.toHaveBeenCalled();
  });

  it('recusa user_id forjado no payload, em vez de ignorá-lo em silêncio', async () => {
    // O `.strict()` é o que transforma um `user_id` em falha de validação. Sem ele, o campo
    // entraria no objeto validado e sairia intocado, e a próxima edição do schema passaria a
    // aceitá-lo sem ninguém perceber (invariante 3).
    const dublês = instalarDublês();

    const resultado = await removerVaga({
      vagaId: LINHA_VALIDA.id,
      user_id: '33333333-3333-3333-3333-333333333333',
    });

    expect(resultado.ok).toBe(false);
    expect(dublês.criarVagaService).not.toHaveBeenCalled();
  });
});

describe('removerVaga — sessão', () => {
  it('sem sessão válida não remove nada', async () => {
    const removerNoServico = vi.fn();
    const dublês = instalarDublês({
      criarClienteSupabase: vi
        .fn()
        .mockResolvedValue(
          clienteComSessao({
            getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          }),
        ),
      criarVagaService: vi.fn().mockReturnValue({ removerVaga: removerNoServico }),
    });

    const resultado = await removerVaga({ vagaId: LINHA_VALIDA.id });

    expect(resultado).toEqual({
      ok: false,
      code: 'sessao_expirada',
      mensagem: MENSAGENS.sessao_expirada,
    });
    expect(removerNoServico).not.toHaveBeenCalled();
    expect(dublês.revalidarCaminho).not.toHaveBeenCalled();
  });

  it('falha do Auth também aborta a remoção', async () => {
    const removerNoServico = vi.fn();
    instalarDublês({
      criarClienteSupabase: vi
        .fn()
        .mockResolvedValue(
          clienteComSessao({
            getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: 'boom' }),
          }),
        ),
      criarVagaService: vi.fn().mockReturnValue({ removerVaga: removerNoServico }),
    });

    const resultado = await removerVaga({ vagaId: LINHA_VALIDA.id });

    expect(resultado.ok).toBe(false);
    expect(removerNoServico).not.toHaveBeenCalled();
  });
});

describe('removerVaga — persistência', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('remoção válida apaga a linha, revalida / e devolve só { ok: true }', async () => {
    const removerNoServico = vi.fn().mockResolvedValue(true);
    const dublês = instalarDublês({
      criarVagaService: vi.fn().mockReturnValue({ removerVaga: removerNoServico }),
    });

    const resultado = await removerVaga({ vagaId: LINHA_VALIDA.id });

    expect(resultado).toEqual({ ok: true });
    expect(removerNoServico).toHaveBeenCalledWith(LINHA_VALIDA.id);
    // Ao contrário de `atualizarStatus`, a remoção revalida (design D5): sem isso, um
    // recarregamento da página mostraria de novo a vaga que a pessoa acabou de apagar.
    expect(dublês.revalidarCaminho).toHaveBeenCalledTimes(1);
    expect(dublês.revalidarCaminho).toHaveBeenCalledWith('/');
  });

  it('usa o cliente da requisição, e não algum cliente privilegiado', async () => {
    const cliente = clienteComSessao();
    const criarCliente = vi.fn().mockResolvedValue(cliente);
    const criarVagaService = vi.fn().mockReturnValue({ removerVaga: vi.fn().mockResolvedValue(true) });
    instalarDublês({ criarClienteSupabase: criarCliente, criarVagaService });

    await removerVaga({ vagaId: LINHA_VALIDA.id });

    // O mesmo cliente da sessão alimenta a fábrica do serviço: é ele que carrega o JWT, e é
    // por isso que o RLS autoriza a remoção em vez de um privilégio (invariante 2).
    expect(criarVagaService).toHaveBeenCalledWith(cliente);
  });

  it('zero linhas afetadas vira "Vaga não encontrada" e não revalida', async () => {
    const dublês = instalarDublês({
      criarVagaService: vi.fn().mockReturnValue({ removerVaga: vi.fn().mockResolvedValue(false) }),
    });

    const resultado = await removerVaga({ vagaId: LINHA_VALIDA.id });

    expect(resultado).toEqual({
      ok: false,
      code: 'erro',
      mensagem: 'Vaga não encontrada.',
    });
    expect(dublês.revalidarCaminho).not.toHaveBeenCalled();
  });

  it('id inexistente e vaga alheia recebem a MESMA resposta, sem oráculo de enumeração', async () => {
    // O serviço devolve `false` nos dois casos — é o RLS que não diz qual dos dois foi.
    const porUsuario = vi.fn().mockResolvedValue(false);
    instalarDublês({ criarVagaService: vi.fn().mockReturnValue({ removerVaga: porUsuario }) });

    const inexistente = await removerVaga({ vagaId: '00000000-0000-0000-0000-000000000000' });
    const alheia = await removerVaga({ vagaId: '33333333-3333-3333-3333-333333333333' });

    expect(inexistente).toEqual(alheia);
    expect(inexistente.ok).toBe(false);
  });

  it('a resposta de "não encontrada" é a mesma de atualizarStatus, campo a campo', async () => {
    // A igualdade é comparada entre as duas actions, não contra uma constante. É o que impede
    // que uma edição futura deixe as duas frases divergentes e abra o oráculo de enumeração
    // sem nenhum teste quebrar junto (design D7).
    instalarDublês({
      criarVagaService: vi.fn().mockReturnValue({
        removerVaga: vi.fn().mockResolvedValue(false),
        atualizarStatus: vi.fn().mockResolvedValue(null),
      }),
    });

    const remocao = await removerVaga({ vagaId: LINHA_VALIDA.id });
    const movimentacao = await atualizarStatus({
      vagaId: LINHA_VALIDA.id,
      novoStatus: 'proposta',
    });

    expect(remocao).toEqual(movimentacao);
  });
});

describe('removerVaga — a falha do serviço não vaza detalhe (task 2.3)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('erro do Postgres vira mensagem genérica, sem SQL nem nome de relação', async () => {
    const dublês = instalarDublês({
      criarVagaService: vi.fn().mockReturnValue({
        removerVaga: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'delete from "public"."vagas" violates foreign key constraint "vagas_user_id_fkey" on table "public"."usuarios"',
            ),
          ),
      }),
    });

    const resultado = await removerVaga({ vagaId: LINHA_VALIDA.id });

    expect(resultado).toEqual({
      ok: false,
      code: 'erro',
      mensagem: 'Não foi possível remover a vaga. Tente novamente.',
    });
    expect(JSON.stringify(resultado)).not.toMatch(
      /delete from|constraint|foreign key|vagas|public|Error|at Object/i,
    );
    expect(dublês.revalidarCaminho).not.toHaveBeenCalled();
  });

  it('falha do servidor devolve uma mensagem de MENSAGENS_DO_QUADRO, nunca texto livre', async () => {
    // `MENSAGENS` é o vocabulário da ingestão, e estas falhas não vêm da Edge Function: elas
    // têm o conjunto próprio `MENSAGENS_DO_QUADRO`, do mesmo jeito que `atualizarStatus` já
    // fazia. O que importa aqui é que a mensagem seja sempre uma fechada de catálogo.
    const mensagensConhecidas = new Set<string>(Object.values(MENSAGENS_DO_QUADRO));

    instalarDublês({
      criarVagaService: vi.fn().mockReturnValue({ removerVaga: vi.fn().mockResolvedValue(false) }),
    });
    const semLinha = await removerVaga({ vagaId: LINHA_VALIDA.id });

    instalarDublês({
      criarVagaService: vi
        .fn()
        .mockReturnValue({ removerVaga: vi.fn().mockRejectedValue(new Error('SQLSTATE 42P01')) }),
    });
    const excecao = await removerVaga({ vagaId: LINHA_VALIDA.id });

    for (const falha of [semLinha, excecao]) {
      expect(falha.ok).toBe(false);
      if (!falha.ok) {
        expect(mensagensConhecidas.has(falha.mensagem)).toBe(true);
      }
    }
  });

  it('a sessão expirada reuse a mensagem de sessão, sem variante própria', async () => {
    instalarDublês({
      criarClienteSupabase: vi
        .fn()
        .mockResolvedValue(
          clienteComSessao({
            getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          }),
        ),
    });

    const resultado = await removerVaga({ vagaId: LINHA_VALIDA.id });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.mensagem).toBe(MENSAGENS.sessao_expirada);
    }
  });

  it('entrada inválida devolve a mensagem do schema, em português e sem detalhe técnico', async () => {
    instalarDublês();

    const resultado = await removerVaga({ vagaId: 'nao-e-um-uuid' });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.mensagem).toBe('Identificador de vaga inválido.');
      expect(resultado.mensagem).not.toMatch(/uuid|invalid_string|zod|Error|at Object/i);
    }
  });
});

describe('adicionarVagaComEstado — adaptador do useActionState (task 4.6)', () => {
  it('repassa o FormData intacto e devolve o mesmo resultado de adicionarVaga', async () => {
    // Sem o adaptador, o `useActionState` do React chamaria a action como
    // `(estadoAnterior, formData)` e `adicionarVaga` receberia o estado anterior no lugar do
    // formulário — e a validação de URL falharia sempre.
    const resposta = respostaJson(201, { vaga: LINHA_VALIDA });
    const invocarFuncao = vi.fn().mockResolvedValue(resposta);
    instalarDublês({ invocarFuncao });

    const resultado = await adicionarVagaComEstado(null, formDataCom({ url: 'https://empresa.com/vaga/1' }));

    expect(resultado.ok).toBe(true);
    const chamada = invocarFuncao.mock.calls[0]?.[0] as {
      corpo: { url: string };
      token: string;
    };
    expect(chamada.corpo).toEqual({ url: 'https://empresa.com/vaga/1' });
    expect(chamada.token).toBe('token-de-sessao');
  });

  it('ignora o estado anterior, em vez de deixá-lo virar entrada da função', async () => {
    const anterior: EstadoDoFormulario = {
      ok: false,
      code: 'duplicada',
      mensagem: 'Você já cadastrou esta vaga.',
    };
    const invocarFuncao = vi.fn().mockResolvedValue(respostaJson(201, { vaga: LINHA_VALIDA }));
    instalarDublês({ invocarFuncao });

    const resultado = await adicionarVagaComEstado(
      anterior,
      formDataCom({ url: 'https://empresa.com/vaga/1' }),
    );

    expect(resultado.ok).toBe(true);
  });

  it('repassa o texto colado sem alteração, para a segunda tentativa', async () => {
    const invocarFuncao = vi.fn().mockResolvedValue(respostaJson(201, { vaga: LINHA_VALIDA }));
    instalarDublês({ invocarFuncao });

    await adicionarVagaComEstado(
      null,
      formDataCom({ url: 'https://empresa.com/vaga/1', texto: 'Descrição colada' }),
    );

    const chamada = invocarFuncao.mock.calls[0]?.[0] as { corpo: { texto: string } };
    expect(chamada.corpo.texto).toBe('Descrição colada');
  });

  it('devolve a falha do formulário no mesmo formato de adicionarVaga', async () => {
    instalarDublês();

    const resultado = await adicionarVagaComEstado(null, formDataCom({ url: 'http://inseguro.com' }));

    expect(resultado.ok).toBe(false);
  });
});
