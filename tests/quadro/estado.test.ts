import { describe, expect, it } from 'vitest';

import { type VagaRow } from '@/domain/vaga';
import {
  assinaturaDoQuadro,
  colunasDoQuadro,
  moverCard,
  normalizar,
  paraCartoes,
  posicaoDe,
  removerCard,
  reordenarCards,
  resolverDestinoArraste,
  reverterMovimento,
  type CartaoDeVaga,
} from '@/quadro/estado';

/**
 * Testes das transições do quadro e da projeção do card (design D3, D10).
 *
 * Estas funções são a razão do quadro viver fora do componente. O ambiente de testes do projeto
 * roda em `node` e não alcança `.tsx`, então cada passo do estado — mover, reverter, remover,
 * detectar mudança do servidor — é testado aqui e não dentro de um hook.
 */

const USUARIO = '22222222-2222-2222-2222-222222222222';

/** Linha do banco, com o usuário e a URL normalizada que a projeção precisa descartar. */
function linha(overrides: Partial<VagaRow> = {}): VagaRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: USUARIO,
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
    ...overrides,
  };
}

function cartao(overrides: Partial<CartaoDeVaga> = {}): CartaoDeVaga {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    titulo: 'Engenheira de Software',
    empresa: 'Empresa X',
    senioridade: 'Senior',
    url: 'https://empresa.com/vaga/7',
    status: 'aplicado',
    ordem: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    requisitos: ['TypeScript', 'Postgres'],
    quantidadeDeRequisitos: 2,
    ...overrides,
  };
}

describe('paraCartoes — o que atravessa para o navegador', () => {
  it('projeta todos os campos que o card desenha', () => {
    expect(paraCartoes([linha()])[0]).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      titulo: 'Engenheira de Software',
      empresa: 'Empresa X',
      senioridade: 'Senior',
      url: 'https://empresa.com/vaga/7?utm_source=linkedin',
      status: 'aplicado',
      ordem: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      requisitos: ['TypeScript', 'Postgres'],
      quantidadeDeRequisitos: 2,
    });
  });

  it('NÃO leva o user_id, que é o dado de conta que a spec proíbe no HTML', () => {
    // Um Client Component recebe os dados pelo payload de RSC, que é HTML. Passar a linha
    // inteira colocaria o `user_id` da conta no HTML de `/`.
    const [projetado] = paraCartoes([linha()]);

    expect(projetado).toBeDefined();
    expect(Object.keys(projetado ?? {})).not.toContain('user_id');
    expect(JSON.stringify(projetado)).not.toContain(USUARIO);
  });

  it('NÃO leva a url_normalizada, que é derivado do banco e não é desenhado', () => {
    const [projetado] = paraCartoes([linha()]);

    expect(Object.keys(projetado ?? {})).not.toContain('url_normalizada');
  });

  it('leva a url do usuário, e não a normalizada, porque é dela que o link abre', () => {
    expect(paraCartoes([linha()])[0]?.url).toBe('https://empresa.com/vaga/7?utm_source=linkedin');
  });

  it('leva a lista de requisitos para o Drawer de detalhes', () => {
    const [projetado] = paraCartoes([linha({ requisitos: ['a', 'b', 'c'] })]);

    expect(projetado?.quantidadeDeRequisitos).toBe(3);
    expect(projetado?.requisitos).toEqual(['a', 'b', 'c']);
    // Campos proibidos continuam ausentes, independentemente de levar a lista
    expect(Object.keys(projetado ?? {})).not.toContain('user_id');
    expect(Object.keys(projetado ?? {})).not.toContain('url_normalizada');
  });

  it('devolve lista vazia para usuário sem vagas', () => {
    expect(paraCartoes([])).toEqual([]);
  });
});

describe('colunasDoQuadro', () => {
  it('devolve as cinco colunas, na ordem do ciclo de vida', () => {
    expect(colunasDoQuadro([]).map((coluna) => coluna.status)).toEqual([
      'aplicado',
      'entrevista_1',
      'fase_tecnica',
      'proposta',
      'rejeitado',
    ]);
  });

  it('distribui os cards pela coluna de cada um', () => {
    const colunas = colunasDoQuadro([
      cartao({ id: 'a', status: 'aplicado' }),
      cartao({ id: 'b', status: 'proposta' }),
    ]);

    expect(colunas.find((c) => c.status === 'aplicado')?.vagas.map((v) => v.id)).toEqual(['a']);
    expect(colunas.find((c) => c.status === 'proposta')?.vagas.map((v) => v.id)).toEqual(['b']);
    expect(colunas.find((c) => c.status === 'rejeitado')?.vagas).toEqual([]);
  });
});

describe('moverCard', () => {
  it('tira o card da origem e põe no fim da destino', () => {
    const cartoes = [
      cartao({ id: 'a', status: 'aplicado', ordem: 0 }),
      cartao({ id: 'b', status: 'fase_tecnica', ordem: 0 }),
      cartao({ id: 'c', status: 'fase_tecnica', ordem: 1 }),
    ];

    const depois = moverCard(cartoes, 'a', 'fase_tecnica', 2);
    const colunas = colunasDoQuadro(depois);

    // A regra do fim da coluna (design D2): a ordem 2 é maior que as duas que já lá estavam.
    expect(colunas.find((c) => c.status === 'fase_tecnica')?.vagas.map((v) => v.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(colunas.find((c) => c.status === 'aplicado')?.vagas).toEqual([]);
  });

  it('atualiza o status e a ordem do card movido', () => {
    const [movido] = moverCard([cartao()], '11111111-1111-1111-1111-111111111111', 'proposta', 3);

    expect(movido?.status).toBe('proposta');
    expect(movido?.ordem).toBe(3);
  });

  it('preserva os dados do card, sem recriá-lo', () => {
    const original = cartao({ titulo: 'Desenvolvedor Front-end' });
    const [movido] = moverCard([original], original.id, 'proposta', 0);

    expect(movido?.titulo).toBe('Desenvolvedor Front-end');
    expect(movido?.url).toBe(original.url);
    expect(movido?.quantidadeDeRequisitos).toBe(original.quantidadeDeRequisitos);
  });

  it('não duplica o card e não o deixa sem coluna', () => {
    const cartoes = [cartao({ id: 'a' }), cartao({ id: 'b', status: 'proposta' })];
    const depois = moverCard(cartoes, 'a', 'proposta', 1);

    expect(depois.filter((c) => c.id === 'a')).toHaveLength(1);
    expect(depois).toHaveLength(2);
  });

  it('ignora um id desconhecido, sem exceção', () => {
    const cartoes = [cartao()];

    // Um card que sumiu não pode derrubar o quadro inteiro — é o mesmo caminho da reversão.
    expect(moverCard(cartoes, 'nao-existe', 'proposta', 0)).toEqual(cartoes);
  });

  it('não altera o array de entrada', () => {
    const cartoes = [cartao({ id: 'a' })];
    moverCard(cartoes, 'a', 'proposta', 0);

    expect(cartoes[0]?.status).toBe('aplicado');
  });

  it('reordena cards na mesma coluna quando novoIndice é informado', () => {
    const cartoes = [
      cartao({ id: 'a', status: 'aplicado', ordem: 0 }),
      cartao({ id: 'b', status: 'aplicado', ordem: 1 }),
      cartao({ id: 'c', status: 'aplicado', ordem: 2 }),
    ];

    // Move 'c' (último) para a primeira posição (índice 0)
    const depois = moverCard(cartoes, 'c', 'aplicado', 0, 0);
    const vagasAplicado = colunasDoQuadro(depois).find((col) => col.status === 'aplicado')?.vagas ?? [];

    expect(vagasAplicado.map((v) => v.id)).toEqual(['c', 'a', 'b']);
    expect(vagasAplicado.map((v) => v.ordem)).toEqual([0, 1, 2]);
  });

  it('move card para índice específico em outra coluna quando novoIndice é informado', () => {
    const cartoes = [
      cartao({ id: 'origem', status: 'aplicado', ordem: 0 }),
      cartao({ id: 'dest-1', status: 'fase_tecnica', ordem: 0 }),
      cartao({ id: 'dest-2', status: 'fase_tecnica', ordem: 1 }),
    ];

    // Insere 'origem' no meio de 'dest-1' e 'dest-2' (índice 1)
    const depois = moverCard(cartoes, 'origem', 'fase_tecnica', 1, 1);
    const vagasDestino = colunasDoQuadro(depois).find((col) => col.status === 'fase_tecnica')?.vagas ?? [];

    expect(vagasDestino.map((v) => v.id)).toEqual(['dest-1', 'origem', 'dest-2']);
    expect(vagasDestino.map((v) => v.ordem)).toEqual([0, 1, 2]);
    expect(colunasDoQuadro(depois).find((col) => col.status === 'aplicado')?.vagas).toEqual([]);
  });

  it('reordenarCards limita índices negativos ou excessivos com segurança', () => {
    const cartoes = [
      cartao({ id: 'a', status: 'aplicado', ordem: 0 }),
      cartao({ id: 'b', status: 'aplicado', ordem: 1 }),
    ];

    // Índice negativo cai no início (0)
    const inicio = reordenarCards(cartoes, 'b', 'aplicado', -5);
    expect(colunasDoQuadro(inicio).find((col) => col.status === 'aplicado')?.vagas.map((v) => v.id)).toEqual(['b', 'a']);

    // Índice excessivo cai no final
    const fim = reordenarCards(cartoes, 'a', 'aplicado', 100);
    expect(colunasDoQuadro(fim).find((col) => col.status === 'aplicado')?.vagas.map((v) => v.id)).toEqual(['b', 'a']);
  });
});

describe('posicaoDe e reverterMovimento', () => {
  it('posicaoDe devolve status e ordem antes do movimento', () => {
    expect(posicaoDe([cartao({ status: 'aplicado', ordem: 1 })], '11111111-1111-1111-1111-111111111111')).toEqual({
      status: 'aplicado',
      ordem: 1,
    });
  });

  it('posicaoDe devolve null para id desconhecido', () => {
    expect(posicaoDe([cartao()], 'nao-existe')).toBeNull();
  });

  it('devolve o card à posição exata de onde saiu', () => {
    const antes = [
      cartao({ id: 'a', status: 'aplicado', ordem: 0 }),
      cartao({ id: 'b', status: 'aplicado', ordem: 1 }),
      cartao({ id: 'c', status: 'aplicado', ordem: 2 }),
    ];
    const anterior = posicaoDe(antes, 'b');
    expect(anterior).not.toBeNull();

    const movido = moverCard(antes, 'b', 'proposta', 0);
    const revertido = reverterMovimento(movido, 'b', { status: anterior?.status ?? 'aplicado', ordem: anterior?.ordem ?? 0 });
    const coluna = colunasDoQuadro(revertido).find((c) => c.status === 'aplicado');

    // De volta entre `a` e `c`, e não no fim: é a posição, e não só a coluna, que importa.
    expect(coluna?.vagas.map((v) => v.id)).toEqual(['a', 'b', 'c']);
  });

  it('não deixa o card nem na origem nem no destino ao reverter', () => {
    const cartoes = moverCard([cartao({ id: 'a' })], 'a', 'proposta', 0);
    const revertido = reverterMovimento(cartoes, 'a', { status: 'aplicado', ordem: 0 });
    const colunas = colunasDoQuadro(revertido);

    expect(colunas.find((c) => c.status === 'aplicado')?.vagas.map((v) => v.id)).toEqual(['a']);
    expect(colunas.find((c) => c.status === 'proposta')?.vagas).toEqual([]);
  });

  it('ignora id desconhecido ao reverter', () => {
    expect(reverterMovimento([cartao()], 'nao-existe', { status: 'proposta', ordem: 0 })).toHaveLength(1);
  });
});

describe('removerCard', () => {
  it('tira o card da lista', () => {
    expect(removerCard([cartao({ id: 'a' }), cartao({ id: 'b' })], 'a').map((c) => c.id)).toEqual(['b']);
  });

  it('deixa a lista intacta para id desconhecido', () => {
    const cartoes = [cartao({ id: 'a' })];
    expect(removerCard(cartoes, 'nao-existe')).toHaveLength(1);
  });
});

describe('normalizar', () => {
  it('ordena por ordem e desempata por created_at', () => {
    const cartoes = [
      cartao({ id: 'c', ordem: 1, created_at: '2026-01-03T00:00:00.000Z' }),
      cartao({ id: 'a', ordem: 0, created_at: '2026-01-01T00:00:00.000Z' }),
      cartao({ id: 'b', ordem: 1, created_at: '2026-01-02T00:00:00.000Z' }),
    ];

    // Mesmo `ordem` em `b` e `c`: sem o desempate por data, os dois trocariam de lugar a cada
    // re-render, e o card piscaria entre as posições.
    expect(normalizar(cartoes).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('assinaturaDoQuadro', () => {
  it('é igual para o mesmo conteúdo em ordens diferentes', () => {
    // Reordenar sem mudar nada não deve custar o movimento otimista de quem está no meio de um.
    const a = [cartao({ id: 'a' }), cartao({ id: 'b', status: 'proposta' })];
    const b = [cartao({ id: 'b', status: 'proposta' }), cartao({ id: 'a' })];

    expect(assinaturaDoQuadro(a)).toBe(assinaturaDoQuadro(b));
  });

  it('muda quando um card muda de coluna', () => {
    const antes = assinaturaDoQuadro([cartao({ id: 'a', status: 'aplicado' })]);
    const depois = assinaturaDoQuadro([cartao({ id: 'a', status: 'proposta' })]);

    expect(antes).not.toBe(depois);
  });

  it('muda quando um card entra ou sai', () => {
    const um = assinaturaDoQuadro([cartao({ id: 'a' })]);
    const dois = assinaturaDoQuadro([cartao({ id: 'a' }), cartao({ id: 'b' })]);

    // É a assinatura que faz o quadro adotar as props depois de uma remoção, que revalida a rota.
    expect(um).not.toBe(dois);
    expect(assinaturaDoQuadro([])).not.toBe(um);
  });

  it('inclui a ordem, que muda no fim da coluna mesmo sem mudar de coluna', () => {
    const antes = assinaturaDoQuadro([cartao({ id: 'a', ordem: 0 })]);
    const depois = assinaturaDoQuadro([cartao({ id: 'a', ordem: 2 })]);

    expect(antes).not.toBe(depois);
  });
});

describe('resolverDestinoArraste', () => {
  it('retorna null quando solto sobre si mesmo ou id inexistente', () => {
    const cartoes = [cartao({ id: 'a', status: 'aplicado' })];
    expect(resolverDestinoArraste(cartoes, 'a', 'a')).toBeNull();
    expect(resolverDestinoArraste(cartoes, 'nao-existe', 'a')).toBeNull();
    expect(resolverDestinoArraste(cartoes, 'a', 'alvo-invalido')).toBeNull();
  });

  it('identifica drop diretamente sobre container de outra coluna', () => {
    const cartoes = [
      cartao({ id: 'a', status: 'aplicado', ordem: 0 }),
      cartao({ id: 'b', status: 'fase_tecnica', ordem: 0 }),
    ];

    expect(resolverDestinoArraste(cartoes, 'a', 'coluna-fase_tecnica')).toEqual({
      destino: 'fase_tecnica',
      novoIndice: 1,
    });
  });

  it('retorna null ao soltar sobre container da mesma coluna sem outro card', () => {
    const cartoes = [cartao({ id: 'a', status: 'aplicado', ordem: 0 })];
    expect(resolverDestinoArraste(cartoes, 'a', 'coluna-aplicado')).toBeNull();
  });

  it('calcula o índice correto quando solto sobre outro card da mesma coluna', () => {
    const cartoes = [
      cartao({ id: 'c1', status: 'aplicado', ordem: 0 }),
      cartao({ id: 'c2', status: 'aplicado', ordem: 1 }),
      cartao({ id: 'c3', status: 'aplicado', ordem: 2 }),
    ];

    // Arrastar c3 para cima de c1 deve indicar índice 0
    expect(resolverDestinoArraste(cartoes, 'c3', 'c1')).toEqual({
      destino: 'aplicado',
      novoIndice: 0,
    });
  });

  it('calcula o índice correto quando solto sobre card em outra coluna', () => {
    const cartoes = [
      cartao({ id: 'origem', status: 'aplicado', ordem: 0 }),
      cartao({ id: 'dest-1', status: 'proposta', ordem: 0 }),
      cartao({ id: 'dest-2', status: 'proposta', ordem: 1 }),
    ];

    // Arrastar 'origem' para cima de 'dest-2' deve indicar índice 1 na coluna 'proposta'
    expect(resolverDestinoArraste(cartoes, 'origem', 'dest-2')).toEqual({
      destino: 'proposta',
      novoIndice: 1,
    });
  });
});
