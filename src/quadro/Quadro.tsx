'use client';

import { useState, useTransition } from 'react';

import { atualizarStatus, removerVaga } from '@/app/actions/vagas';
import { type StatusVaga } from '@/domain/vaga';
import { destinosPossiveis, rotuloDoStatus } from '@/quadro/colunas';
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
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {erro}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {colunas.map((coluna) => (
          <section
            key={coluna.status}
            aria-labelledby={`coluna-${coluna.status}`}
            className="flex min-h-32 flex-col gap-2 rounded bg-neutral-100 p-3"
          >
            <header className="flex items-baseline justify-between gap-2">
              <h2 id={`coluna-${coluna.status}`} className="text-sm font-semibold">
                {coluna.rotulo}
              </h2>
              <span className="text-xs text-neutral-500">{coluna.vagas.length}</span>
            </header>

            {/* Coluna vazia continua na tela, com a contagem em zero: é ela que convida a mover
                algo para lá. */}
            {coluna.vagas.length === 0 && (
              <p className="text-xs text-neutral-400">Nenhuma vaga.</p>
            )}

            {coluna.vagas.map((cartao) => (
              <Cartao
                key={cartao.id}
                cartao={cartao}
                ocupado={emTransicao || emMovimento?.vagaId === cartao.id}
                emRemocao={emRemocao === cartao.id}
                aoMover={moverPara}
                aoRemover={removerVagaDoQuadro}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
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

  return (
    <article className="flex flex-col gap-2 rounded border border-neutral-200 bg-white p-3">
      <h3 className="text-sm font-medium">{cartao.titulo}</h3>
      <p className="text-xs text-neutral-600">
        {cartao.empresa} · {cartao.senioridade}
      </p>

      {/*
        O destino do link é a URL que a pessoa colou, e não a `url_normalizada` nem qualquer valor
        vindo da extração: a invariante 6 proíbe que saída de modelo vire `href`, e o `rel` sem
        `noopener` entregaria a aba nova o controle da página de origem.
      */}
      <a
        href={cartao.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-blue-700 underline"
      >
        Ver anúncio
      </a>

      <div className="flex items-center gap-2">
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
          className="min-w-0 flex-1 rounded border border-neutral-300 px-1 py-1 text-xs disabled:opacity-50"
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
          className="rounded border border-neutral-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {emRemocao ? 'Removendo…' : 'Remover'}
        </button>
      </div>
    </article>
  );
}
