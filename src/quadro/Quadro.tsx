'use client';

import { useState, useTransition } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
  resolverDestinoArraste,
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
 * Suporta movimentação por drag-and-drop (Fase 5) com `@dnd-kit` e mantém o seletor `<select>`
 * como via acessível.
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
  const [cardAtivoId, definirCardAtivoId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  /**
   * Adota as props quando o servidor manda um quadro diferente.
   */
  const assinatura = assinaturaDoQuadro(iniciais);
  const [ultimaAssinatura, definirUltimaAssinatura] = useState(assinatura);

  if (assinatura !== ultimaAssinatura) {
    definirUltimaAssinatura(assinatura);
    definirCartoes(normalizar(iniciais));
  }

  /**
   * Move o card de coluna (ou reordena na mesma coluna), na tela antes de o servidor responder.
   */
  function moverPara(vagaId: string, destino: StatusVaga, novoIndice?: number) {
    const anterior = posicaoDe(cartoes, vagaId);
    if (anterior === null) {
      return;
    }
    if (anterior.status === destino && novoIndice === undefined) {
      return;
    }
    if (anterior.status === destino && novoIndice !== undefined && anterior.ordem === novoIndice) {
      return;
    }

    const ordem = novoIndice ?? cartoes.filter((cartao) => cartao.status === destino).length;

    definirErro(null);
    definirMovimento({ vagaId, anterior });
    definirCartoes(moverCard(cartoes, vagaId, destino, ordem, novoIndice));

    iniciarTransicao(async () => {
      const resposta = await atualizarStatus({ vagaId, novoStatus: destino, ordem });

      if (!resposta.ok) {
        definirCartoes((atuais) => reverterMovimento(atuais, vagaId, anterior));
        definirErro(resposta.mensagem);
      }

      definirMovimento(null);
    });
  }

  function tratarInicioArraste(evento: DragStartEvent) {
    definirCardAtivoId(String(evento.active.id));
  }

  function tratarFimArraste(evento: DragEndEvent) {
    const { active, over } = evento;
    definirCardAtivoId(null);

    if (!over) {
      return;
    }

    const vagaId = String(active.id);
    const sobreId = String(over.id);

    const destinoResolvido = resolverDestinoArraste(cartoes, vagaId, sobreId);
    if (!destinoResolvido) {
      return;
    }

    moverPara(vagaId, destinoResolvido.destino, destinoResolvido.novoIndice);
  }

  function tratarCancelamentoArraste() {
    definirCardAtivoId(null);
  }

  /**
   * Remove a vaga, depois de uma confirmação.
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
    definirCartoes(removerCard(cartoes, vagaId));

    iniciarTransicao(async () => {
      const resposta = await removerVaga({ vagaId });

      if (!resposta.ok) {
        definirCartoes((atuais) => normalizar([...atuais, removido]));
        definirErro(resposta.mensagem);
      }

      definirRemocao(null);
    });
  }

  const colunas = colunasDoQuadro(cartoes);
  const cardAtivo = cardAtivoId ? cartoes.find((c) => c.id === cardAtivoId) ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={tratarInicioArraste}
      onDragEnd={tratarFimArraste}
      onDragCancel={tratarCancelamentoArraste}
    >
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
              cardArrastadoId={cardAtivoId}
              aoMover={moverPara}
              aoRemover={removerVagaDoQuadro}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {cardAtivo ? (
          <Cartao
            cartao={cardAtivo}
            ocupado={false}
            emRemocao={false}
            aoMover={() => {}}
            aoRemover={() => {}}
            isDragOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Uma coluna: a barra de acento, o cabeçalho, a contagem e os cards.
 */
function Coluna({
  status,
  rotulo,
  cartoes,
  ocupado,
  vagaEmMovimento,
  vagaEmRemocao,
  cardArrastadoId,
  aoMover,
  aoRemover,
}: {
  status: StatusVaga;
  rotulo: string;
  cartoes: CartaoDeVaga[];
  ocupado: boolean;
  vagaEmMovimento: string | null;
  vagaEmRemocao: string | null;
  cardArrastadoId: string | null;
  aoMover: (vagaId: string, destino: StatusVaga, novoIndice?: number) => void;
  aoRemover: (vagaId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `coluna-${status}`,
    data: { status },
  });

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`coluna-${status}`}
      className={`flex min-h-32 flex-col rounded-sm border bg-papel transition-colors ${
        isOver ? 'border-ambar ring-1 ring-ambar/50' : 'border-traco'
      }`}
    >
      <div className={`h-[3px] w-full rounded-t-sm ${fundoDaColuna(status)}`} />

      <header className="flex items-baseline justify-between gap-2 border-b border-traco px-3 py-2">
        <h2
          id={`coluna-${status}`}
          className={`font-dados text-[11px] font-medium uppercase tracking-[0.14em] ${textoDaColuna(status)}`}
        >
          {rotulo}
        </h2>
        <span className="font-dados text-[11px] tabular-nums text-tinta-fraca">
          {String(cartoes.length).padStart(2, '0')}
        </span>
      </header>

      {cartoes.length === 0 && (
        <p className="px-3 py-4 font-corpo text-xs italic text-tinta-fraca">Nenhuma vaga.</p>
      )}

      <SortableContext
        id={`coluna-${status}`}
        items={cartoes.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2 p-2">
          {cartoes.map((cartao) => (
            <Cartao
              key={cartao.id}
              cartao={cartao}
              ocupado={ocupado || vagaEmMovimento === cartao.id}
              emRemocao={vagaEmRemocao === cartao.id}
              estaSendoArrastado={cardArrastadoId === cartao.id}
              aoMover={aoMover}
              aoRemover={aoRemover}
            />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

/** Um card: os dados da vaga, o seletor de destino e o botão de remover. */
function Cartao({
  cartao,
  ocupado,
  emRemocao,
  estaSendoArrastado,
  aoMover,
  aoRemover,
  isDragOverlay,
}: {
  cartao: CartaoDeVaga;
  ocupado: boolean;
  emRemocao: boolean;
  estaSendoArrastado?: boolean;
  aoMover: (vagaId: string, destino: StatusVaga, novoIndice?: number) => void;
  aoRemover: (vagaId: string) => void;
  isDragOverlay?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: cartao.id,
    disabled: ocupado || emRemocao || isDragOverlay,
  });

  const destinos = destinosPossiveis(cartao.status);

  const style = isDragOverlay
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      };

  const sendoArrastado = isDragging || estaSendoArrastado;

  const classesDoCard = [
    'flex flex-col gap-2 rounded-sm border border-traco bg-papel-alto p-3 transition-shadow',
    fileteDaColuna(cartao.status),
    !isDragOverlay && 'cursor-grab active:cursor-grabbing touch-none',
    sendoArrastado ? 'opacity-30' : ocupado || emRemocao ? 'opacity-60' : null,
    isDragOverlay ? 'shadow-2xl ring-2 ring-ambar/70 rotate-1 cursor-grabbing' : null,
  ]
    .filter((classe) => Boolean(classe))
    .join(' ');

  return (
    <article
      ref={isDragOverlay ? undefined : setNodeRef}
      style={style}
      {...(isDragOverlay ? {} : attributes)}
      {...(isDragOverlay ? {} : listeners)}
      className={classesDoCard}
    >
      <h3 className="font-titulo text-[15px] leading-snug text-tinta-clara">{cartao.titulo}</h3>

      <p className="font-dados text-[11px] text-tinta-media">
        {cartao.empresa} <span className="text-tinta-fraca">·</span> {cartao.senioridade}
      </p>

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
          disabled={ocupado || emRemocao || isDragOverlay}
          onChange={(evento) => {
            const escolhido = evento.target.value;
            if (escolhido !== '') {
              aoMover(cartao.id, escolhido as StatusVaga);
            }
          }}
          className="campo min-w-0 flex-1 py-1 font-dados text-[11px]"
        >
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
          disabled={emRemocao || isDragOverlay}
          className="rounded-sm border border-traco px-2 py-1 font-dados text-[11px] text-tinta-fraca transition-colors hover:border-terra/50 hover:bg-terra-fundo hover:text-terra disabled:opacity-50"
        >
          {emRemocao ? 'Removendo…' : 'Remover'}
        </button>
      </div>
    </article>
  );
}
