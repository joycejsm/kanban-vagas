import { type Senioridade, type StatusVaga, type VagaRow } from '@/domain/vaga';
import { agruparPorColuna, COLUNAS, type Coluna } from '@/quadro/colunas';

/**
 * Estado do quadro no cliente, e a projeção que decide o que dele atravessa para o navegador.
 *
 * São duas responsabilidades no mesmo lugar porque as duas precisam ser puras: o quadro é um
 * Client Component, e o ambiente de testes do projeto não alcança `.tsx` (design D3). Uma
 * transição de estado escrita dentro de um hook seria comportamento sem asserção possível; aqui
 * cada passo — mover, reverter, remover, detectar mudança do servidor — é uma função que o
 * vitest executa.
 */

/**
 * A vaga como o card a desenha, e como o quadro a carrega.
 *
 * **Não é a `VagaRow`.** Um Client Component recebe seus dados pelo payload de RSC, que é
 * HTML: passar a linha inteira colocaria o `user_id` da conta no HTML de `/`, que a spec proíbe e
 * que a verificação da 4.9 procura com `grep`. `url_normalizada` fica de fora pelo mesmo motivo
 * de hygiene — é um derivado do banco, e o card não desenha.
 *
 * `quantidadeDeRequisitos` é um número, não a lista: os requisitos são conteúdo extraído de
 * página alheia, e mostrar a lista inteira aqui seria abrir espaço para conteúdo que ninguém
 * revisou. A tela de detalhe, quando existir, é o lugar de mostrá-la.
 */
export interface CartaoDeVaga {
  id: string;
  titulo: string;
  empresa: string;
  senioridade: Senioridade;
  /** A URL que a pessoa colou. É ela que o link do card abre — nunca a normalizada. */
  url: string;
  status: StatusVaga;
  ordem: number;
  created_at: string;
  quantidadeDeRequisitos: number;
}

/** Onde o card estava antes de um movimento, para poder voltar. */
export interface PosicaoAnterior {
  status: StatusVaga;
  ordem: number;
}

/**
 * Projeta as linhas do banco nos cards do quadro.
 *
 * A função é o **único** caminho do banco até o cliente, e por isso o lugar onde um campo novo
 * poderia vazar. O teste correspondente verifica a ausência de `user_id` e `url_normalizada` por
 * nome, de modo que acrescentar um campo aqui quebra o teste em vez de quebrar a privacidade.
 */
export function paraCartoes(vagas: readonly VagaRow[]): CartaoDeVaga[] {
  return vagas.map((vaga) => ({
    id: vaga.id,
    titulo: vaga.titulo,
    empresa: vaga.empresa,
    senioridade: vaga.senioridade,
    url: vaga.url,
    status: vaga.status,
    ordem: vaga.ordem,
    created_at: vaga.created_at,
    quantidadeDeRequisitos: vaga.requisitos.length,
  }));
}

/**
 * Ordena as colunas como o serviço as devolve: por `ordem` e, no empate, por `created_at`.
 *
 * É a mesma ordem do `ORDER BY` de `listarVagas`, e é ela que faz o card movido cair no fim da
 * coluna de destino e o card revertido voltar exatamente ao lugar de onde saiu. Sem o desempate
 * por `created_at`, dois cards com o mesmo `ordem` trocariam de lugar a cada movimento.
 */
export function normalizar(cartoes: readonly CartaoDeVaga[]): CartaoDeVaga[] {
  return agruparPorColuna(cartoes)
    .flatMap((coluna) => [...coluna.vagas].sort(ordenarPorPosicao));
}

/** Comparador de posição: `ordem` primeiro, `created_at` como desempate. */
function ordenarPorPosicao(a: CartaoDeVaga, b: CartaoDeVaga): number {
  if (a.ordem !== b.ordem) {
    return a.ordem - b.ordem;
  }
  return a.created_at.localeCompare(b.created_at);
}

/** As colunas do quadro a partir de uma lista de cards, já normalizadas. */
export function colunasDoQuadro(cartoes: readonly CartaoDeVaga[]): Coluna<CartaoDeVaga>[] {
  const ordenados = normalizar(cartoes);

  // As cinco colunas vêm de `agruparPorColuna([])` — a lista vazia já devolve a estrutura
  // completa, com os rótulos e na ordem do ciclo de vida. Reagrupar aqui seria pedir de novo
  // as colunas que a normalização acabou de percorrer.
  return agruparPorColuna<CartaoDeVaga>([]).map((coluna) => ({
    ...coluna,
    vagas: ordenados.filter((cartao) => cartao.status === coluna.status),
  }));
}

/**
 * Move o card para outra coluna ou para uma nova posição na mesma coluna.
 *
 * Quando `novoIndice` é informado, insere o card exatamente nessa posição e
 * renumera os cards da coluna de destino (0, 1, 2...), garantindo ordenação
 * determinística em drag-and-drop.
 *
 * Quando `novoIndice` é omitido, preserva o comportamento da Fase 4: atribui a
 * `ordem` informada diretamente ao card movido.
 *
 * Um `vagaId` que não existe devolve a mesma lista, sem exceção.
 */
export function moverCard(
  cartoes: readonly CartaoDeVaga[],
  vagaId: string,
  destino: StatusVaga,
  ordem: number,
  novoIndice?: number,
): CartaoDeVaga[] {
  if (novoIndice !== undefined) {
    return reordenarCards(cartoes, vagaId, destino, novoIndice);
  }

  const atual = cartoes.find((cartao) => cartao.id === vagaId);
  if (atual === undefined) {
    return [...cartoes];
  }

  const movido: CartaoDeVaga = { ...atual, status: destino, ordem };

  return normalizar([
    ...cartoes.filter((cartao) => cartao.id !== vagaId),
    movido,
  ]);
}

/**
 * Reordena cards inserindo o card indicado na posição `novoIndice` da coluna de destino,
 * recalculando as ordens relativas da coluna de destino de forma contígua.
 */
export function reordenarCards(
  cartoes: readonly CartaoDeVaga[],
  vagaId: string,
  destino: StatusVaga,
  novoIndice: number,
): CartaoDeVaga[] {
  const atual = cartoes.find((cartao) => cartao.id === vagaId);
  if (atual === undefined) {
    return [...cartoes];
  }

  // Cards da coluna de destino, exceto o que está sendo movido, já na ordem correta
  const outrosDestino = normalizar(
    cartoes.filter((cartao) => cartao.id !== vagaId && cartao.status === destino),
  );

  // Limita o novo índice entre 0 e o total de cards restantes na coluna
  const indiceClamped = Math.max(0, Math.min(novoIndice, outrosDestino.length));

  const cardMovido: CartaoDeVaga = { ...atual, status: destino };

  const colunaReordenada = [
    ...outrosDestino.slice(0, indiceClamped),
    cardMovido,
    ...outrosDestino.slice(indiceClamped),
  ].map((cartao, idx) => ({ ...cartao, ordem: idx }));

  const outrasColunas = cartoes.filter(
    (cartao) => cartao.id !== vagaId && cartao.status !== destino,
  );

  return normalizar([...outrasColunas, ...colunaReordenada]);
}

/**
 * Devolve o card à posição de origem depois de um movimento recusado pelo servidor.
 *
 * A restauração usa a posição **anterior** — status e ordem —, e não um "volta para a coluna
 * original": é a posição exata que faz o quadro voltar a ser o que era, e é ela que a reversão
 * guarda antes de disparar a chamada.
 */
export function reverterMovimento(
  cartoes: readonly CartaoDeVaga[],
  vagaId: string,
  anterior: PosicaoAnterior,
): CartaoDeVaga[] {
  const atual = cartoes.find((cartao) => cartao.id === vagaId);
  if (atual === undefined) {
    return [...cartoes];
  }

  const devolvido: CartaoDeVaga = { ...atual, ...anterior };

  return normalizar([
    ...cartoes.filter((cartao) => cartao.id !== vagaId),
    devolvido,
  ]);
}

/** Tira o card do quadro. Sem card com esse id, devolve a lista como está. */
export function removerCard(cartoes: readonly CartaoDeVaga[], vagaId: string): CartaoDeVaga[] {
  return cartoes.filter((cartao) => cartao.id !== vagaId);
}

/**
 * A posição do card antes de um movimento, ou `null` se ele não estiver no quadro.
 *
 * Separada de `moverCard` porque quem guarda o antes é o componente, e ele precisa do valor
 * **antes** de a transição acontecer — se buscasse depois, já estaria tarde.
 */
export function posicaoDe(cartoes: readonly CartaoDeVaga[], vagaId: string): PosicaoAnterior | null {
  const cartao = cartoes.find((item) => item.id === vagaId);
  return cartao === undefined ? null : { status: cartao.status, ordem: cartao.ordem };
}

/**
 * Uma assinatura do conteúdo do quadro, para perceber que o servidor mandou outra coisa.
 *
 * O quadro é otimista (design D7) e o servidor revalida a rota depois de uma remoção, o que traz
 * props novas para o mesmo componente. Sem esta assinatura, o componente teria de aceitar props
 * novas a cada re-render e perderia o movimento otimista; com ela, o estado local só é
 * descartado quando o **conteúdo** de fato mudou, e não quando o React entrega um array novo.
 *
 * Os blocos são ordenados para que a assinatura dependa do conjunto de cards e não da ordem em
 * que eles chegaram: reordenar sem mudar nada é o tipo de diferença que não deve custar o
 * estado otimista de quem está arrastando um card para outra coluna.
 */
export function assinaturaDoQuadro(cartoes: readonly CartaoDeVaga[]): string {
  return cartoes
    .map((cartao) => `${cartao.id}:${cartao.status}:${cartao.ordem}`)
    .sort()
    .join('|');
}

/**
 * Determina o status de destino e o índice na coluna a partir do elemento alvo do arraste (over).
 *
 * Suporta soltar diretamente sobre a coluna (identificada por `coluna-{status}` ou `{status}`)
 * ou sobre outro card da coluna (assumindo o status e o índice daquele card).
 * Retorna `null` se o drop for inválido, sobre si mesmo ou em posição inalterada.
 */
export function resolverDestinoArraste(
  cartoes: readonly CartaoDeVaga[],
  vagaId: string,
  sobreId: string,
): { destino: StatusVaga; novoIndice: number } | null {
  if (vagaId === sobreId) {
    return null;
  }

  const cardArrastado = cartoes.find((c) => c.id === vagaId);
  if (!cardArrastado) {
    return null;
  }

  // Caso 1: Solto diretamente sobre o container da coluna
  const statusDireto = (sobreId.startsWith('coluna-') ? sobreId.replace('coluna-', '') : sobreId) as StatusVaga;
  const colunaValida = COLUNAS.some((c) => c.status === statusDireto);
  if (colunaValida) {
    if (cardArrastado.status === statusDireto) {
      return null;
    }
    const totalNaColuna = cartoes.filter((c) => c.status === statusDireto && c.id !== vagaId).length;
    return { destino: statusDireto, novoIndice: totalNaColuna };
  }

  // Caso 2: Solto sobre outro card da lista
  const sobreCard = cartoes.find((c) => c.id === sobreId);
  if (!sobreCard) {
    return null;
  }

  const cardsDestino = cartoes
    .filter((c) => c.status === sobreCard.status && c.id !== vagaId)
    .sort((a, b) => a.ordem - b.ordem);

  const indiceAlvo = cardsDestino.findIndex((c) => c.id === sobreId);
  const novoIndice = indiceAlvo >= 0 ? indiceAlvo : cardsDestino.length;

  if (cardArrastado.status === sobreCard.status && cardArrastado.ordem === novoIndice) {
    return null;
  }

  return {
    destino: sobreCard.status,
    novoIndice,
  };
}
