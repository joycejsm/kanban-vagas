import { type StatusVaga, type VagaRow } from '@/domain/vaga';

/**
 * Colunas do quadro e as funções puras que decidem o movimento entre elas.
 *
 * Este módulo é a **razão** do quadro, separada da sua aparência (design D3). Ele não importa
 * React, nada de `next/` nem de `@supabase/`, e existe por um motivo concreto: o ambiente de
 * testes do projeto roda em `node` e só coleta arquivos de teste `.ts` — o glob não alcança
 * `.tsx`, e não há jsdom. Tudo que é decisão fica aqui, dentro do alcance dos testes; o que
 * sobra no Client Component é markup.
 *
 * As colunas derivam de `statusVagaSchema`, e não de uma lista escrita à mão: uma coluna que
 * não existisse no enum renderizaria uma faixa morta na tela, e um status novo no enum ficaria
 * sem coluna. A ordem de `COLUNAS` é a ordem do ciclo de vida da candidatura, e é a ordem em
 * que o quadro se apresenta.
 */

/**
 * O mínimo que uma vaga precisa ter para estar no quadro.
 *
 * Existe para que `agruparPorColuna` sirva tanto à linha do banco quanto ao card projetado, sem
 * duplicar a função nem forçar o card a carregar campos que ele não desenha (design D10).
 */
export interface VagaNoQuadro {
  id: string;
  status: StatusVaga;
  ordem: number;
  created_at: string;
}

/** Uma coluna do quadro: o status, o rótulo em pt-BR e as vagas que caem nela. */
export interface Coluna<T extends VagaNoQuadro = VagaNoQuadro> {
  status: StatusVaga;
  rotulo: string;
  vagas: T[];
}

/** Definição de uma coluna, sem as vagas. É a fonte de `agruparPorColuna`. */
export interface DefinicaoDeColuna {
  status: StatusVaga;
  rotulo: string;
}

/**
 * As cinco colunas, na ordem do ciclo de vida.
 *
 * Os rótulos são a única tradução de identificador para português do quadro, e moram aqui para
 * que o cabeçalho da coluna e o rótulo acessível do seletor de destino não possam divergir.
 */
export const COLUNAS: readonly DefinicaoDeColuna[] = [
  { status: 'aplicado', rotulo: 'Aplicado' },
  { status: 'entrevista_1', rotulo: 'Entrevista 1' },
  { status: 'fase_tecnica', rotulo: 'Fase técnica' },
  { status: 'proposta', rotulo: 'Proposta' },
  { status: 'rejeitado', rotulo: 'Rejeitado' },
];

/** Os cinco status do quadro, na ordem das colunas. */
export const STATUS_DO_QUADRO: readonly StatusVaga[] = COLUNAS.map((coluna) => coluna.status);

/**
 * Rótulo de um status, ou o próprio status quando ele não está no quadro.
 *
 * O segundo retorno de `COLUNAS.map` é `undefined` por tipo para status desconhecido, e
 * devolver o identificador é melhor que devolver `undefined`: um `undefined` no `key` de um card
 * ou no `value` de um `<option>` vira comportamento imprevisível em vez de um texto visível.
 */
export function rotuloDoStatus(status: StatusVaga): string {
  return COLUNAS.find((coluna) => coluna.status === status)?.rotulo ?? status;
}

/**
 * Distribui as vagas nas cinco colunas.
 *
 * **Todas** as colunas voltam no resultado, mesmo as que não têm vaga nenhuma: o quadro mostra
 * a faixa de "Fase técnica" com contagem zero porque é ela que convida a mover algo para lá, e
 * omiti-la transformaria um quadro de cinco colunas em um quadro de tamanho variável.
 *
 * A ordem das vagas dentro de cada coluna é a de entrada, que é a ordem que o serviço devolve
 * (`status`, `ordem`, `created_at`) — reordenar aqui seria substituir uma consulta que o índice
 * `(user_id, status, ordem)` sustenta por um `sort` em JavaScript.
 *
 * Uma vaga com status fora do enum é ignorada em vez de criar uma coluna nova: `vagaRowSchema`
 * já impede que ela chegue até aqui, e tratá-la como erro lançaria dentro da renderização.
 */
export function agruparPorColuna<T extends VagaNoQuadro>(vagas: readonly T[]): Coluna<T>[] {
  const porStatus = new Map<StatusVaga, T[]>();

  for (const coluna of COLUNAS) {
    porStatus.set(coluna.status, []);
  }

  for (const vaga of vagas) {
    porStatus.get(vaga.status)?.push(vaga);
  }

  return COLUNAS.map((coluna) => ({
    status: coluna.status,
    rotulo: coluna.rotulo,
    vagas: porStatus.get(coluna.status) ?? [],
  }));
}

/**
 * Os destinos possíveis a partir de uma coluna: as outras quatro, na ordem do quadro.
 *
 * A coluna atual não entra na lista. Offer o mesmo destino de onde o card já está tornaria o
 * controle um no-op, e o usuário gastaria uma requisição para não ver nada acontecer.
 */
export function destinosPossiveis(statusAtual: StatusVaga): StatusVaga[] {
  return STATUS_DO_QUADRO.filter((status) => status !== statusAtual);
}

/**
 * A posição de entrada de um card na coluna de destino: a quantidade de vagas que já estão
 * nela, isto é, o fim da coluna (design D2).
 *
 * Reaproveita a mesma regra da spec `vaga-persistence` para a entrada por ingestão, e evita
 * trazer ordenação dentro da coluna para o MVP — que exigiria o cliente virar a fonte da
 * verdade da ordem. A conta é feita sobre a coluna de destino, e não sobre o total do quadro,
 * pelo mesmo motivo que a spec usa o maior `ordem` da própria coluna.
 *
 * Dois movimentos simultâneos podem gravar o mesmo número; o desempate é o `created_at`, na
 * mesma ordem que o serviço usa ao ler.
 */
export function ordemDeDestino(vagas: readonly VagaRow[], destino: StatusVaga): number {
  return vagas.reduce((total, vaga) => (vaga.status === destino ? total + 1 : total), 0);
}
