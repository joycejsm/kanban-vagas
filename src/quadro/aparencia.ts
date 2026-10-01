import { type StatusVaga } from '@/domain/vaga';

/**
 * A aparência do quadro, separada da razão dele.
 *
 * Companion de `colunas.ts`: aquele decide para onde um card vai e qual o rótulo da coluna; este
 * decide a cor com que ela aparece. A separação é a do design D3 e vale pelo mesmo motivo —
 * `estado.ts` e `colunas.ts` são testáveis em Node sem DOM, e misturar um mapa de classes no
 * meio da lógica de movimento vira um arquivo que ninguém lê inteiro.
 *
 * ## Por que uma cor por coluna
 *
 * Não é decoração de tabela colorida: o valor do quadro é ver, num relance, como a candidatura
 * está distribuída. Cinco colunas com o mesmo fundo obrigam a pessoa a ler os cinco cabeçalhos;
 * com um acento próprio em cada uma, ela lê a proporção. Os cinco tons são dessaturados de
 * propósito — cores vivas em fundo escuro vibram, cansam e competem com o texto.
 *
 * Cada status tem **uma** cor, a mesma na barra da coluna, na contagem e no filete do card.
 * Divergir entre os três seria o mesmo defeito que a coluna e o rótulo já tiveram.
 */

/** Os três lugares onde a cor da coluna aparece, com a classe de cada um. */
interface AcentoDeColuna {
  /** A barra no topo da coluna. */
  fundo: string;
  /** O cabeçalho e a contagem. */
  texto: string;
  /** O filete de 2px à esquerda do card. */
  filete: string;
}

/**
 * O acento de cada coluna, com as classes **escritas por extenso**.
 *
 * Este é o ponto do arquivo que mais parece redundante e é o que sustenta o resto. O Tailwind
 * varre o **texto** dos arquivos para descobrir as classes que deve gerar: uma classe montada por
 * interpolação — `border-l-${corDaColuna(s)}` — não aparece em lugar nenhum do código-fonte, e
 * por isso não entra no CSS. O efeito é silencioso e só aparece no build: a coluna fica sem cor,
 * sem erro, sem aviso, e só alguém comparando a tela com o palette percebe.
 *
 * Escrever as três classes por extenso em cada status é o que mantém isso correto. O preço é
 * repetição; o benefício é que a falha, se algum dia acontecer, aparece no diff.
 */
const ACENTO: Readonly<Record<StatusVaga, AcentoDeColuna>> = {
  aplicado: {
    fundo: 'bg-coluna-aplicado',
    texto: 'text-coluna-aplicado',
    filete: 'border-l-coluna-aplicado',
  },
  entrevista_1: {
    fundo: 'bg-coluna-entrevista',
    texto: 'text-coluna-entrevista',
    filete: 'border-l-coluna-entrevista',
  },
  fase_tecnica: {
    fundo: 'bg-coluna-tecnica',
    texto: 'text-coluna-tecnica',
    filete: 'border-l-coluna-tecnica',
  },
  proposta: {
    fundo: 'bg-coluna-proposta',
    texto: 'text-coluna-proposta',
    filete: 'border-l-coluna-proposta',
  },
  rejeitado: {
    fundo: 'bg-coluna-rejeitado',
    texto: 'text-coluna-rejeitado',
    filete: 'border-l-coluna-rejeitado',
  },
};

/**
 * A classe de **fundo** da coluna, para a barra no topo dela.
 */
export function fundoDaColuna(status: StatusVaga): string {
  return ACENTO[status].fundo;
}

/** A classe de **cor de texto** da coluna, para o cabeçalho e a contagem. */
export function textoDaColuna(status: StatusVaga): string {
  return ACENTO[status].texto;
}

/** A classe de **borda** da coluna, para o filete à esquerda do card. */
export function fileteDaColuna(status: StatusVaga): string {
  return ACENTO[status].filete;
}

/** As três classes de uma coluna, para quem quiser as duas de uma vez. */
export function acentoDaColuna(status: StatusVaga): AcentoDeColuna {
  return ACENTO[status];
}
