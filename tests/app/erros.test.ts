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

  it('401 e 403 viram o mesmo pedido de novo login', () => {
    const semPermissao = mapearErroIngestao(401);
    const proibido = mapearErroIngestao(403);

    expect(semPermissao.code).toBe('sessao_expirada');
    expect(proibido.code).toBe('sessao_expirada');
    // A tela não distingue "não autenticado" de "não autorizado": para o usuário, a
    // resposta é a mesma, e distinguishable seria dar informação sobre a configuração do app.
    expect(semPermissao).toEqual(proibido);
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
      expect(falha.mensagem).toBe(mapearErroIngestao(422).mensagem);
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
});

describe('falhaDeSessao', () => {
  it('usa o mesmo vocabulário de sessao_expirada do mapeamento HTTP', () => {
    // A sessão pode falhar antes da chamada à função, e as duas rotas precisam dar a mesma
    // resposta para a interface — senão a interface precisaria tratar de dois jeitos o mesmo evento.
    expect(falhaDeSessao()).toEqual(mapearErroIngestao(401));
  });
});
