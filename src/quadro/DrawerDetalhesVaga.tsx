'use client';

import { useEffect, useState } from 'react';

import { type CartaoDeVaga } from '@/quadro/estado';
import { formatarDataCandidatura } from '@/quadro/aparencia';
import { rotuloDoStatus } from '@/quadro/colunas';

/**
 * Drawer de detalhes da vaga.
 *
 * Desktop: painel lateral deslizante pela direita (~480px).
 * Mobile: bottom sheet ocupando a maior parte da tela (85vh), com rolagem interna.
 *
 * Utiliza o elemento semântico `<dialog open>` durante a exibição para garantir acessibilidade
 * (role dialog, aria-label, gerenciamento semântico). O backdrop fecha o drawer ao ser clicado,
 * e a tecla Escape é suportada nativamente e via listener.
 *
 * A lista de requisitos nunca é renderizada como HTML — invariante 6. Cada item é texto
 * simples, exibido via conteúdo de texto do nó, não `dangerouslySetInnerHTML`.
 */
interface Props {
  cartao: CartaoDeVaga | null;
  aoFechar: () => void;
}

export function DrawerDetalhesVaga({ cartao, aoFechar }: Props) {
  const [visivel, setVisivel] = useState(false);
  const [cartaoAtivo, setCartaoAtivo] = useState<CartaoDeVaga | null>(cartao);

  useEffect(() => {
    if (cartao !== null) {
      setCartaoAtivo(cartao);
      // Próximo frame de animação garante a transição de slide da posição fora da tela para dentro
      const animTimer = requestAnimationFrame(() => {
        setVisivel(true);
      });
      return () => cancelAnimationFrame(animTimer);
    } else {
      setVisivel(false);
      // Mantém os dados da vaga durante a animação de saída (300ms) antes de desmontar
      const fecharTimer = setTimeout(() => {
        setCartaoAtivo(null);
      }, 300);
      return () => clearTimeout(fecharTimer);
    }
  }, [cartao]);

  // Fecha ao pressionar Esc
  useEffect(() => {
    function aoTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape' && cartaoAtivo !== null) {
        aoFechar();
      }
    }
    document.addEventListener('keydown', aoTecla);
    return () => document.removeEventListener('keydown', aoTecla);
  }, [cartaoAtivo, aoFechar]);

  // Trava o scroll do fundo enquanto o drawer estiver ativo
  useEffect(() => {
    if (cartaoAtivo !== null) {
      const estiloOriginal = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = estiloOriginal;
      };
    }
  }, [cartaoAtivo]);

  if (cartaoAtivo === null) {
    return null;
  }

  return (
    <>
      {/* Backdrop — clicável para fechar; visível em mobile e desktop com fade-in */}
      <div
        aria-hidden="true"
        onClick={aoFechar}
        className={[
          'fixed inset-0 z-40 bg-tinta/60 backdrop-blur-[2px] transition-opacity duration-300 ease-out',
          visivel ? 'opacity-100' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      />

      {/* Drawer: bottom sheet no mobile, painel lateral direito no desktop */}
      <dialog
        open
        aria-label={`Detalhes de ${cartaoAtivo.titulo}`}
        onCancel={(e) => {
          e.preventDefault();
          aoFechar();
        }}
        className={[
          // Base e resets nativos do <dialog>
          'fixed z-50 m-0 p-0 max-h-[none] max-w-none flex flex-col border-traco bg-papel text-tinta-clara shadow-2xl backdrop:hidden',
          // Mobile: tela inferior (bottom sheet de 85vh)
          'inset-x-0 bottom-0 h-[85vh] w-full rounded-t-lg border-t',
          // Desktop: painel lateral direito (480px, tela inteira de altura)
          'md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[480px] md:rounded-none md:border-l md:border-t-0',
          // Animação de slide fluida
          'transition-transform duration-300 ease-out',
          visivel
            ? 'translate-y-0 md:translate-x-0 md:translate-y-0'
            : 'translate-y-full md:translate-x-full md:translate-y-0',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Cabeçalho fixo */}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-traco px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-titulo text-xl italic leading-snug text-tinta-clara">
              {cartaoAtivo.titulo}
            </h2>
            <p className="font-dados text-[11px] text-tinta-media">
              {cartaoAtivo.empresa}
              <span className="text-tinta-fraca"> · </span>
              {cartaoAtivo.senioridade}
              <span className="text-tinta-fraca"> · </span>
              {rotuloDoStatus(cartaoAtivo.status)}
              {formatarDataCandidatura(cartaoAtivo.created_at) !== '' && (
                <>
                  <span className="text-tinta-fraca"> · </span>
                  <time dateTime={cartaoAtivo.created_at}>
                    {formatarDataCandidatura(cartaoAtivo.created_at)}
                  </time>
                </>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar detalhes da vaga"
            className="shrink-0 rounded-sm p-1 font-dados text-[11px] text-tinta-fraca transition-colors hover:text-ambar focus-visible:outline-ambar cursor-pointer"
          >
            ✕
          </button>
        </header>

        {/* Corpo rolável */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-6">
            {/* Link do anúncio */}
            <div className="flex flex-col gap-1">
              <span className="font-dados text-[10px] font-medium uppercase tracking-[0.12em] text-tinta-fraca">
                Anúncio
              </span>
              <a
                href={cartaoAtivo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-dados text-[12px] text-ambar underline decoration-ambar/40 underline-offset-4 hover:decoration-ambar"
              >
                {cartaoAtivo.url}
              </a>
            </div>

            {/* Requisitos */}
            {cartaoAtivo.requisitos.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="font-dados text-[10px] font-medium uppercase tracking-[0.12em] text-tinta-fraca">
                  Requisitos{' '}
                  <span className="font-dados text-[10px] normal-case tracking-normal text-tinta-fraca">
                    ({cartaoAtivo.requisitos.length})
                  </span>
                </span>
                <ul className="flex flex-col gap-1" role="list">
                  {cartaoAtivo.requisitos.map((req, idx) => (
                    <li
                      // requisitos são strings extraídas, sem id; idx é o índice estável da lista
                      // eslint-disable-next-line react/no-array-index-key
                      key={idx}
                      className="flex items-baseline gap-2 font-corpo text-sm text-tinta-clara"
                    >
                      <span className="shrink-0 font-dados text-[10px] tabular-nums text-tinta-fraca">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      {req}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="font-dados text-[10px] font-medium uppercase tracking-[0.12em] text-tinta-fraca">
                  Requisitos
                </span>
                <p className="font-corpo text-sm italic text-tinta-fraca">
                  Nenhum requisito extraído para esta vaga.
                </p>
              </div>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
