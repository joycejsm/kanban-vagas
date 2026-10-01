import { beforeEach, describe, expect, it, vi } from 'vitest';

import { falhaDeSessao, mapearErroIngestao } from '@/app/actions/erros';

/**
 * Testes do mapeamento HTTP → `code` da interface (design D5).
 *
 * Esta função é o único lugar do Next.js que conhece os status da Edge Function, então ela é
 * testada sozinha: o que importa aqui é que a tradução seja **total** e **fechada** — todo
 * status tem destino, e nenhum destino carrega detalhe interno.
 */

beforeEach(() => {
  // O mapeamento registra o código que a função reportou. O log é informação de
  // diagnóstico, não o que está sob teste.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

/** O `code` de um corpo, lido como a produção lê: só se for string. */
function extrairCode(corpo: unknown): string | undefined {
  if (typeof corpo === 'object' && corpo !== null && 'code' in corpo) {
    const { code } = corpo as { code?: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

describe('mapearErroIngestao — status conhecidos', () => {
  it('409 vira duplicada, com aviso de vaga já cadastrada', () => {
    const falha = mapearErroIngestao(409);

    expect(falha.ok).toBe(false);
    expect(falha.code).toBe('duplicada');
    expect(falha.mensagem).toBe('Você já cadastrou esta vaga.');
  });

  it('422 vira extracao_falhou e convida a colar o texto', () => {
    const falha = mapearErroIngestao(422);

    expect(falha.code).toBe('extracao_falhou');
    expect(falha.mensagem).toMatch(/cole o texto/i);
  });

  it('413 também vira extracao_falhou — é o mesmo problema do ponto de vista de quem está na tela', () => {
    // Página grande demais e extração insuficiente pedem a mesma coisa: o texto colado.
    expect(mapearErroIngestao(413).code).toBe('extracao_falhou');
    expect(mapearErroIngestao(413).code).toBe(mapearErroIngestao(422).code);
  });

  it('429 vira limite_uso, mandando tentar mais tarde', () => {
    const falha = mapearErroIngestao(429);

    expect(falha.code).toBe('limite_uso');
    expect(falha.mensagem).toMatch(/mais tarde/i);
  });

  it('401 e 403 sem code viram o mesmo pedido de novo login', () => {
    const semPermissao = mapearErroIngestao(401);
    const proibido = mapearErroIngestao(403);

    expect(semPermissao.code).toBe('sessao_expirada');
    expect(proibido.code).toBe('sessao_expirada');
    // Sem `code` no corpo — o fallback, que vale durante o deploy e para qualquer resposta
    // inesperada — a tela não distingue "não autenticado" de "não autorizado", porque o status
    // 403 sozinho não carrega essa diferença. Com `code`, os dois se separam: ver o bloco
    // seguinte, que é o caminho real, já que a função sempre manda o `code`.
    expect(semPermissao).toEqual(proibido);
  });
});

describe('mapearErroIngestao — o code da função decide', () => {
  it('403 de e-mail fora da allowlist não vira sessão expirada', () => {
    const falha = mapearErroIngestao(403, { code: 'nao_autorizado', message: 'x' });

    expect(falha.code).toBe('nao_autorizado');
    expect(falha.mensagem).toMatch(/permissão/i);
    expect(falha.mensagem).not.toMatch(/sessão expirou/i);
  });

  it('403 de origem não permitida não vira sessão expirada', () => {
    const falha = mapearErroIngestao(403, { code: 'origem_nao_permitida', message: 'x' });

    expect(falha.code).toBe('origem_nao_permitida');
    expect(falha.mensagem).not.toMatch(/sessão expirou/i);
  });

  it('a mensagem de allowlist não diz se o endereço está na lista', () => {
    // Responder a quem não tem conta se um endereço tem acesso transforma a recusa em oráculo
    // sobre a allowlist. A ação indicada é a mesma nos dois casos, então a frase não precisa
    // revelar nada.
    const mensagem = mapearErroIngestao(403, { code: 'nao_autorizado', message: 'x' }).mensagem;

    expect(mensagem).not.toMatch(/@|não está na lista|não consta|autorizado na lista/i);
  });

  it('401 continua sendo sessão expirada mesmo com code no corpo', () => {
    const falha = mapearErroIngestao(401, { code: 'nao_autenticado', message: 'x' });

    expect(falha.code).toBe('sessao_expirada');
    expect(falha.mensagem).toBe(mapearErroIngestao(401).mensagem);
  });

  it('code desconhecido recua para o status, sem quebrar o conjunto fechado', () => {
    for (const status of [403, 409, 422, 429, 500]) {
      const comCode = mapearErroIngestao(status, { code: 'algo_que_nao_existe' });
      const semCorpo = mapearErroIngestao(status);

      expect(comCode).toEqual(semCorpo);
    }
  });

  it('cada code da função tem destino, e nenhum vira erro genérico sem querer', () => {
    // Lista extraída de `_shared/erros.ts`. Um code novo na função sem entrada aqui cairia
    // silenciosamente no fallback por status, que é o mesmo modo de falha que motivou a
    // mudança: duas causas, uma mensagem. Status e destino ficam na mesma linha de propósito —
    // separadas, um code poderia ficar sem status e o teste não perceberia.
    const ESPERADOS: { code: string; status: number; esperado: string }[] = [
      { code: 'nao_autenticado', status: 401, esperado: 'sessao_expirada' },
      { code: 'nao_autorizado', status: 403, esperado: 'nao_autorizado' },
      { code: 'origem_nao_permitida', status: 403, esperado: 'origem_nao_permitida' },
      { code: 'metodo_nao_permitido', status: 405, esperado: 'erro' },
      { code: 'vaga_duplicada', status: 409, esperado: 'duplicada' },
      { code: 'pagina_grande', status: 413, esperado: 'extracao_falhou' },
      { code: 'corpo_invalido', status: 422, esperado: 'extracao_falhou' },
      { code: 'extracao_insuficiente', status: 422, esperado: 'extracao_falhou' },
      { code: 'tipo_nao_suportado', status: 422, esperado: 'extracao_falhou' },
      { code: 'url_invalida', status: 422, esperado: 'extracao_falhou' },
      { code: 'limite_de_uso', status: 429, esperado: 'limite_uso' },
      { code: 'erro_interno', status: 500, esperado: 'erro' },
      { code: 'pagina_inacessivel', status: 502, esperado: 'extracao_falhou' },
    ];

    for (const { code, status, esperado } of ESPERADOS) {
      expect(mapearErroIngestao(status, { code }).code, `code ${code}`).toBe(esperado);
    }
  });
});

describe('mapearErroIngestao — status inesperados', () => {
  it('5xx vira erro genérico com sugestão de tentar de novo', () => {
    for (const status of [500, 502, 503, 504]) {
      const falha = mapearErroIngestao(status);

      expect(falha.code).toBe('erro');
      expect(falha.mensagem).toMatch(/tente novamente/i);
    }
  });

  it('qualquer status fora do mapa também vira erro, e nunca uma exceção', () => {
    for (const status of [0, 204, 301, 418, 451, 999]) {
      const falha = mapearErroIngestao(status);

      expect(falha.ok).toBe(false);
      expect(falha.code).toBe('erro');
    }
  });

  it('status negativo ou não numérico não quebra a função', () => {
    expect(mapearErroIngestao(-1).code).toBe('erro');
    expect(mapearErroIngestao(Number.NaN).code).toBe('erro');
  });
});

describe('mapearErroIngestao — o corpo da resposta nunca vaza', () => {
  const CORPOS_VAZADOS = [
    { code: 'erro_interno', message: 'Erro em relation "vagas": violates check constraint' },
    { code: 'x', message: 'SELECT * FROM vagas WHERE user_id = ...', sql: 'SELECT 1' },
    { code: 'y', message: 'O modelo respondeu: {"candidates":[{"content":"..."}]}' },
    { code: 'z', stack: 'Error: boom\n    at index.ts:42:11', trace: 'at Object.insert' },
    { html: '<html><body>502 Bad Gateway</body></html>' },
  ];

  for (const [indice, corpo] of CORPOS_VAZADOS.entries()) {
    it(`corpo ${indice + 1} não aparece na mensagem`, () => {
      const falha = mapearErroIngestao(422, corpo);
      const serializado = JSON.stringify(falha);

      expect(serializado).not.toMatch(/relation|constraint|SELECT|vagas|at Object|\.ts:|html|candidates/i);

      // A referência é a mesma chamada com o **mesmo** `code` e um corpo vazio. A mensagem
      // pode variar com o `code` — ele decide o que a tela mostra —, mas nunca com o resto do
      // corpo. Comparar com `mapearErroIngestao(422)` sem corpo só valia quando o status era a
      // única entrada; agora a igualdade que importa é "o resto do corpo não muda nada".
      const codigo = extrairCode(corpo);
      const referencia = mapearErroIngestao(422, codigo === undefined ? undefined : { code: codigo });

      expect(falha.mensagem).toBe(referencia.mensagem);
    });
  }

  it('corpos de formatos inesperados são ignorados sem lançar', () => {
    for (const corpo of [null, undefined, 'texto', 42, [], () => undefined, Symbol('x')]) {
      expect(() => mapearErroIngestao(500, corpo)).not.toThrow();
    }
  });

  it('a mensagem de um código é sempre a mesma, venha o corpo que vier', () => {
    const semCorpo = mapearErroIngestao(409).mensagem;
    const comCorpo = mapearErroIngestao(409, { code: 'vaga_duplicada', message: 'detalhe' }).mensagem;

    expect(comCorpo).toBe(semCorpo);
  });

  it('o code tem precedência sobre o status, porque o status não distingue as recusas', () => {
    // A função responde 403 tanto para e-mail fora da allowlist quanto para origem não
    // permitida. Decidir pelo status achatava as duas em "sua sessão expirou".
    expect(mapearErroIngestao(403, { code: 'nao_autorizado' }).code).toBe('nao_autorizado');
    expect(mapearErroIngestao(403, { code: 'origem_nao_permitida' }).code).toBe('origem_nao_permitida');
  });
});

describe('falhaDeSessao', () => {
  it('usa o mesmo vocabulário de sessao_expirada do mapeamento HTTP', () => {
    // A sessão pode falhar antes da chamada à função, e as duas rotas precisam dar a mesma
    // resposta para a interface — senão a interface precisaria tratar de dois jeitos o mesmo evento.
    expect(falhaDeSessao()).toEqual(mapearErroIngestao(401));
  });
});
