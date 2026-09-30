import { dependencias } from '@/app/actions/dependencias';
import { type StatusVaga, type VagaRow } from '@/domain/vaga';
import { agruparPorColuna, type Coluna } from '@/quadro/colunas';

/**
 * Carga do quadro no servidor.
 *
 * É a ponte entre a página e o `VagaService`: monta as colunas com as vagas do usuário
 * autenticado, usando o cliente da requisição e o mesmo ponto de injeção de dependências que as
 * Server Actions já usam (design D10 da Fase 3, reaproveitado aqui em D4). A consequência
 * prática é que o teste desta carga roda sem banco e sem rede, como os das actions rodam.
 *
 * Nada de `user_id` nesta função, nem em nenhum parâmetro: o dono da linha é o banco, via
 * `default auth.uid()`, e o RLS decide o que a consulta devolve (invariantes 2 e 3).
 */

/** O que a página recebe do quadro, já agrupado. */
export interface ResultadoDaCarga {
  /** As cinco colunas, sempre — inclusive as vazias. */
  colunas: Coluna[];
  /** As vagas como o serviço as devolveu, sem reordenar nem remexer em campo algum. */
  vagas: VagaRow[];
  /** Aviso de falha de leitura, ou `null` quando a leitura deu certo. */
  aviso: string | null;
}

/**
 * O aviso de falha de leitura, em pt-BR.
 *
 * Uma frase, e ela **não** afirma que o usuário não tem vagas: quem falhou foi a leitura, e
 * dizer o contrário faria a pessoa concluir que o trabalho sumiu. Também não diz nada de banco,
 * de rede ou de sessão — o que a tela mostra é sempre o mesmo texto, e o motivo fica no log do
 * servidor (design D4).
 */
export const AVISO_DE_FALHA = 'Não foi possível carregar suas vagas agora. Tente recarregar a página.';

/** Quadro vazio com as cinco colunas, usado tanto no erro quanto no estado sem vagas. */
function quadroVazio(aviso: string | null): ResultadoDaCarga {
  return { colunas: agruparPorColuna([]), vagas: [], aviso };
}

/**
 * Carrega as vagas do usuário autenticado e devolve o quadro.
 *
 * A falha de leitura **não** vira exceção. Uma exceção aqui derrubaria a renderização da rota e
 * o usuário veria a tela de erro do Next em vez do aplicativo; um quadro honesto com aviso é o
 * pior desfecho aceitável, e o melhor não existe. O detalhe da falha — operação, SQLSTATE — já
 * foi registrado pelo `VagaService`; aqui só se acrescenta o tipo da exceção, e nenhum valor de
 * erro entra no log (invariante 9).
 *
 * As vagas não são reordenadas aqui. `listarVagas` já devolve por `status`, `ordem` e
 * `created_at`, que é a ordem que o índice `(user_id, status, ordem)` sustenta, e refazer isso em
 * JavaScript trocaria uma consulta por um `sort`.
 */
export async function carregarQuadro(): Promise<ResultadoDaCarga> {
  try {
    const deps = dependencias();
    const cliente = await deps.criarClienteSupabase();
    const vagas = await deps.criarVagaService(cliente).listarVagas();

    return { colunas: agruparPorColuna(vagas), vagas, aviso: null };
  } catch (erro) {
    console.error(
      '[quadro/carregarQuadro] listarVagas falhou (%s)',
      erro instanceof Error ? erro.name : 'desconhecido',
    );

    return quadroVazio(AVISO_DE_FALHA);
  }
}

/**
 * `true` quando o quadro está sem vaga **e** sem falha de leitura.
 *
 * A distinção existe porque as duas produzem a mesma tela — cinco colunas zeradas — e
 * mensagens diferentes: uma convida a cadastrar a primeira vaga, a outra manda recarregar. Uma
 * falha de leitura mostrada como "você não tem vagas" diria uma coisa falsa sobre o estado da
 * conta, e é o tipo de mentira que faz a pessoa procurar um problema onde não há.
 */
export function ehEstadoVazio(resultado: ResultadoDaCarga): boolean {
  return resultado.aviso === null && resultado.vagas.length === 0;
}

/** Os status que têm ao menos uma vaga. Serve ao rodapé e ao resumo, nunca ao card. */
export function statusOcupados(colunas: readonly Coluna[]): StatusVaga[] {
  return colunas.filter((coluna) => coluna.vagas.length > 0).map((coluna) => coluna.status);
}
