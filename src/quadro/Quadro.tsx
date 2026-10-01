'use client';

import { useState, useTransition } from 'react';

import { atualizarStatus, removerVaga } from '@/app/actions/vagas';
import { type StatusVaga } from '@/domain/vaga';
import { destinosPossiveis, rotuloDoStatus } from '@/quadro/colunas';
import { fileteDaColuna, fundoDaColuna, textoDaColuna } from '@/quadro/aparencia';
import {
  assinaturaDoQuadro,
  colunasDoQuadro,
  moverCard,
  normalizar,
  posicaoDe,
  removerCard,
  reverterMovimento,
  type CartaoDeVaga,
  type PosicaoAnterior,
} from '@/quadro/estado';

/**
 * O quadro: cinco colunas, cards, e o estado otimista do movimento.
 *
 * Client Component porque o quadro tem duas formas de mudar sem recarregar a página: mover um
 * card e reverter um movimento que o servidor recusou. A Server Action `atualizarStatus` não
 * revalida — decisão da Fase 3 (D8 lá) —, então quem reflete a mudança na tela é este
 * componente, e ele precisa saber o estado antes e depois de cada chamada.
 *
 * Nada de decisão mora aqui. Agrupar, calcular destino, calcular ordem, mover, reverter e remover
 * são funções puras em `estado.ts` e `colunas.ts` (design D3): o que resta neste arquivo é
 * markup e o encanamento das chamadas, que é justamente o que o ambiente de testes deste projeto
 * não alcança.
 */

/** Props do quadro. `cartoes` vem já projetado, sem `user_id` e sem `url_normalizada` (D10). */
interface Props {
  cartoes: CartaoDeVaga[];
}

/** O card em movimento, e a posição de onde ele veio, para a reversão. */
interface MovimentoPendente {
  vagaId: string;
  anterior: PosicaoAnterior;
}

export function Quadro({ cartoes: iniciais }: Props) {
  const [cartoes, definirCartoes] = useState<CartaoDeVaga[]>(() => normalizar(iniciais));
  const [emTransicao, iniciarTransicao] = useTransition();
  const [emMovimento, definirMovimento] = useState<MovimentoPendente | null>(null);
  const [emRemocao, definirRemocao] = useState<string | null>(null);
  const [erro, definirErro] = useState<string | null>(null);

  /**
   * Adota as props quando o servidor manda um quadro diferente.
   *
   * A assinatura compara **conteúdo**, não referência: depois de uma remoção, `removerVaga`
   * revalida a rota e o servidor entrega props novas, que precisam substituir o estado local. Mas
   * um re-render comum entrega um array novo com o mesmo conteúdo, e descartar o estado aí
   * perderia o movimento otimista de quem está no meio de um.
   *
   * O ajuste acontece durante o render e não num efeito de propósito: um `useEffect` ajustaria o
   * estado **depois** de o quadro já ter sido pintado com a lista velha, e a pessoa veria o card
   * voltar por um quadro. O React permite ajustar estado durante o render para esta comparação
   * com props, e recusa o laço se ele não convergir — que é o que a guarda abaixo garante.
   */
  const assinatura = assinaturaDoQuadro(iniciais);
  const [ultimaAssinatura, definirUltimaAssinatura] = useState(assinatura);

  if (assinatura !== ultimaAssinatura) {
    definirUltimaAssinatura(assinatura);
    definirCartoes(normalizar(iniciais));
  }

  /**
   * Move o card de coluna, na tela antes de o servidor responder.
   *
   * A posição de origem é guardada **antes** da chamada, e é ela que a reversão usa: depois do
   * movimento o card já está na coluna nova, e a posição antiga só existe aqui.
   */
  function moverPara(vagaId: string, destino: StatusVaga) {
    const anterior = posicaoDe(cartoes, vagaId);
    if (anterior === null || anterior.status === destino) {
      return;
    }

    // O fim da coluna de destino (design D2): a mesma conta que `ordemDeDestino` faz sobre as
    // linhas do banco, aqui sobre os cards que estão na tela.
    const ordem = cartoes.filter((cartao) => cartao.status === destino).length;

    definirErro(null);
    definirMovimento({ vagaId, anterior });
    definirCartoes(moverCard(cartoes, vagaId, destino, ordem));

    iniciarTransicao(async () => {
      const resposta = await atualizarStatus({ vagaId, novoStatus: destino, ordem });

      if (!resposta.ok) {
        definirCartoes((atuais) => reverterMovimento(atuais, vagaId, anterior));
        definirErro(resposta.mensagem);
      }

      definirMovimento(null);
    });
  }

  /**
   * Remove a vaga, depois de uma confirmação.
   *
   * A confirmação acontece **antes** de qualquer chamada: cancelar não chega a falar com o
   * servidor. E é por isso que o `if` fica aqui e não dentro da action — a action não tem por que
   * saber que existe um `confirm()` (design D6).
   */
  function removerVagaDoQuadro(vagaId: string) {
    if (!window.confirm('Remover esta vaga do quadro? Esta ação não pode ser desfeita.')) {
      return;
    }

    const removido = cartoes.find((cartao) => cartao.id === vagaId);
    if (removido === undefined) {
      return;
    }

    definirErro(null);
    definirRemocao(vagaId);
    // Sai da tela na hora. A revalidação da action é o que torna a remoção durável; o estado
    // local aqui é só para o botão não ficar clicável de novo.
    definirCartoes(removerCard(cartoes, vagaId));

    iniciarTransicao(async () => {
      const resposta = await removerVaga({ vagaId });

      if (!resposta.ok) {
        // O servidor recusou: o card volta, e a mensagem explica por quê. Sem esta volta, a
        // pessoa veria a vaga desaparecer e nenhuma pista de que ela continua lá.
        definirCartoes((atuais) => normalizar([...atuais, removido]));
        definirErro(resposta.mensagem);
      }

      definirRemocao(null);
    });
  }

  const colunas = colunasDoQuadro(cartoes);

  return (
    <div className="flex flex-col gap-4">
      {erro !== null && (
        <p
          role="alert"
          className="rounded-sm border border-terra/40 bg-terra-fundo px-3 py-2 text-sm text-terra"
        >
          {erro}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {colunas.map((coluna) => (
          <Coluna
            key={coluna.status}
            status={coluna.status}
            rotulo={coluna.rotulo}
            cartoes={coluna.vagas}
            ocupado={emTransicao}
            vagaEmMovimento={emMovimento?.vagaId ?? null}
            vagaEmRemocao={emRemocao}
            aoMover={moverPara}
            aoRemover={removerVagaDoQuadro}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Uma coluna: a barra de acento, o cabeçalho, a contagem e os cards.
 *
 * Virou um componente próprio por dois motivos práticos. O primeiro é o `key`: o cabeçalho com a
 * contagem precisa reagir a cada card que entra e sai, e com as cinco colunas num único elemento
 * o React reconcilia a coluna inteira — work isso que não é de ninguém. O segundo é a cor: a
 * barra, o número e o anel do card leem o mesmo token, e ler de um lugar só é o que impede que um
 * dos três fique para trás quando a paleta mudar.
 */
function Coluna({
  status,
  rotulo,
  cartoes,
  ocupado,
  vagaEmMovimento,
  vagaEmRemocao,
  aoMover,
  aoRemover,
}: {
  status: StatusVaga;
  rotulo: string;
  cartoes: CartaoDeVaga[];
  ocupado: boolean;
  vagaEmMovimento: string | null;
  vagaEmRemocao: string | null;
  aoMover: (vagaId: string, destino: StatusVaga) => void;
  aoRemover: (vagaId: string) => void;
}) {
  return (
    <section
      aria-labelledby={`coluna-${status}`}
      className="flex min-h-32 flex-col rounded-sm border border-traco bg-papel"
    >
      {/* A barra é a cor da coluna em 3px: o único elemento que identifica a coluna sem texto,
          e o mesmo que o anel do card usa quando ele muda de lugar. */}
      <div className={`h-[3px] w-full rounded-t-sm ${fundoDaColuna(status)}`} />

      <header className="flex items-baseline justify-between gap-2 border-b border-traco px-3 py-2">
        <h2
          id={`coluna-${status}`}
          className={`font-dados text-[11px] font-medium uppercase tracking-[0.14em] ${textoDaColuna(status)}`}
        >
          {rotulo}
        </h2>
        {/* A contagem com zero à esquerda é o que dá cara de ficha, e alinha as unidades — 3 e 12
            ocupam a mesma largura que 03 e 12. */}
        <span className="font-dados text-[11px] tabular-nums text-tinta-fraca">
          {String(cartoes.length).padStart(2, '0')}
        </span>
      </header>

      {/* Coluna vazia continua na tela, com a contagem em zero: é ela que convida a mover
          algo para lá. */}
      {cartoes.length === 0 && (
        <p className="px-3 py-4 font-corpo text-xs italic text-tinta-fraca">Nenhuma vaga.</p>
      )}

      <div className="flex flex-col gap-2 p-2">
        {cartoes.map((cartao) => (
          <Cartao
            key={cartao.id}
            cartao={cartao}
            ocupado={ocupado || vagaEmMovimento === cartao.id}
            emRemocao={vagaEmRemocao === cartao.id}
            aoMover={aoMover}
            aoRemover={aoRemover}
          />
        ))}
      </div>
    </section>
  );
}

/** Um card: os dados da vaga, o seletor de destino e o botão de remover. */
function Cartao({
  cartao,
  ocupado,
  emRemocao,
  aoMover,
  aoRemover,
}: {
  cartao: CartaoDeVaga;
  ocupado: boolean;
  emRemocao: boolean;
  aoMover: (vagaId: string, destino: StatusVaga) => void;
  aoRemover: (vagaId: string) => void;
}) {
  const destinos = destinosPossiveis(cartao.status);

  // A classe do card é montada em partes — filete da coluna e estado de transição — e montada por
  // concatenação porque cada parte vem de uma decisão diferente. Um array filtrado em vez disso
  // deixaria um espaço sobrando no atributo quando o card não estivesse em transição, e esse
  // espaço é o tipo de coisa que só aparece quando alguém inspeciona o HTML.
  const classesDoCard = [
    'flex flex-col gap-2 rounded-sm border border-traco bg-papel-alto p-3',
    fileteDaColuna(cartao.status),
    ocupado || emRemocao ? 'opacity-60' : null,
  ]
    .filter((classe) => classe !== null)
    .join(' ');

  return (
    /*
     * O card é uma ficha de papel: fundo um passo acima do da coluna, borda quase apagada, e um
     * filete de 2px na cor da coluna. O filete é o que faz o card carregar a coluna junto com
     * ele — sem ele, um card em movimento atravessa a tela sem nenhuma pista de para onde vai.
     */
    <article className={classesDoCard}>
      <h3 className="font-titulo text-[15px] leading-snug text-tinta-clara">{cartao.titulo}</h3>

      {/* Empresa e senioridade em mono e separadas por um ponto: é a linha de metadados, e a
          tipografia é o que a distingue do título sem precisar de outro peso. */}
      <p className="font-dados text-[11px] text-tinta-media">
        {cartao.empresa} <span className="text-tinta-fraca">·</span> {cartao.senioridade}
      </p>

      {/*
        O destino do link é a URL que a pessoa colou, e não a `url_normalizada` nem qualquer valor
        vindo da extração: a invariante 6 proíbe que saída de modelo vire `href`, e o `rel` sem
        `noopener` entregaria a aba nova o controle da página de origem.

        A seta é `→` (U+2192) e não `↗` (U+2197) por um motivo que só aparece na tela: o subset
        latino que o `next/font` baixa da IBM Plex Mono cobre U+2191, U+2192, U+2193 e U+2195, mas
        **não** U+2197. A seta diagonal saía como caixa vazia — um tofu no meio do card. O glifo
        precisa estar no `unicode-range`, não só no arquivo.
      */}
      <a
        href={cartao.url}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start font-dados text-[11px] text-ambar underline decoration-ambar/40 underline-offset-4 hover:decoration-ambar"
      >
        Ver anúncio →
      </a>

      <div className="mt-1 flex items-center gap-2">
        <label htmlFor={`mover-${cartao.id}`} className="sr-only">
          Mover “{cartao.titulo}” para outra coluna
        </label>
        <select
          id={`mover-${cartao.id}`}
          value=""
          disabled={ocupado || emRemocao}
          onChange={(evento) => {
            const escolhido = evento.target.value;
            if (escolhido !== '') {
              aoMover(cartao.id, escolhido as StatusVaga);
            }
          }}
          className="campo min-w-0 flex-1 py-1 font-dados text-[11px]"
        >
          {/*
            A primeira opção é a de repouso, e é ela que reaparece depois do movimento — é o que
            impede o seletor de ficar exibindo o destino enquanto o card já mudou de coluna. Não
            é um destino: escolher "Mover para…" não faz nada.
          */}
          <option value="">Mover para…</option>
          {destinos.map((destino) => (
            <option key={destino} value={destino}>
              {rotuloDoStatus(destino)}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => aoRemover(cartao.id)}
          disabled={emRemocao}
          className="rounded-sm border border-traco px-2 py-1 font-dados text-[11px] text-tinta-fraca transition-colors hover:border-terra/50 hover:bg-terra-fundo hover:text-terra disabled:opacity-50"
        >
          {emRemocao ? 'Removendo…' : 'Remover'}
        </button>
      </div>
    </article>
  );
}
