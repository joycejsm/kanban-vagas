'use client';

import { useEffect, useRef } from 'react';

import { type CartaoDeVaga } from '@/quadro/estado';
import { formatarDataCandidatura } from '@/quadro/aparencia';
import { rotuloDoStatus } from '@/quadro/colunas';

/**
 * Drawer de detalhes da vaga.
 *
 * Desktop: painel lateral deslizante pela direita (~480px), sem bloquear o quadro.
 * Mobile: ocupa toda a tela (tela cheia), com rolagem interna.
 *
 * É um `<dialog>` nativo para garantir o gerenciamento correto de foco e a semântica de
 * modal acessível (role, aria-modal, armadilha de foco). O backdrop é do próprio `<dialog>`
 * via CSS, sem JS extra.
 *
 * A lista de requisitos nunca é renderizada como HTML — invariante 6. Cada item é texto
 * simples, exibido via conteúdo de texto do nó, não `dangerouslySetInnerHTML`.
 */
interface Props {
  cartao: CartaoDeVaga | null;
  aoFechar: () => void;
}

export function DrawerDetalhesVaga({ cartao, aoFechar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (cartao !== null) {
      if (!dialog.open) {
        dialog.show(); // `show()` = não-modal, sem backdrop do browser — usamos o nosso
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [cartao]);

  // Fecha ao pressionar Esc
  useEffect(() => {
    function aoTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape' && cartao !== null) {
        aoFechar();
      }
    }
    document.addEventListener('keydown', aoTecla);
    return () => document.removeEventListener('keydown', aoTecla);
  }, [cartao, aoFechar]);

  // Trava o scroll do fundo quando o drawer está aberto no mobile
  useEffect(() => {
    if (cartao !== null) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [cartao]);

  return (
    <>
      {/* Backdrop — clicável para fechar; visível só quando aberto */}
      {cartao !== null && (
        <div
          aria-hidden="true"
          onClick={aoFechar}
          className="fixed inset-0 z-40 bg-tinta/60 backdrop-blur-[2px] md:hidden"
        />
      )}

      {/* Drawer: fullscreen no mobile, lateral no desktop */}
      <dialog
        ref={dialogRef}
        aria-label={cartao ? `Detalhes de ${cartao.titulo}` : 'Detalhes da vaga'}
        className={[
          // Base
          'fixed z-50 m-0 flex flex-col border-traco bg-papel text-tinta-clara',
          // Mobile: tela cheia (bottom sheet)
          'inset-x-0 bottom-0 h-[85vh] w-full rounded-t-lg border-t',
          // Desktop: painel lateral direito
          'md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[480px] md:rounded-none md:border-l md:border-t-0',
          // Animação de slide: fora usa translate, dentro não
          'translate-y-full transition-transform duration-300 ease-out',
          cartao !== null ? 'translate-y-0 md:translate-x-0' : 'md:translate-x-full',
          // Remove estilo default do <dialog>
          'p-0 backdrop:hidden',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Cabeçalho fixo */}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-traco px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-titulo text-xl italic leading-snug text-tinta-clara">
              {cartao?.titulo ?? ''}
            </h2>
            {cartao && (
              <p className="font-dados text-[11px] text-tinta-media">
                {cartao.empresa}
                <span className="text-tinta-fraca"> · </span>
                {cartao.senioridade}
                <span className="text-tinta-fraca"> · </span>
                {rotuloDoStatus(cartao.status)}
                {formatarDataCandidatura(cartao.created_at) !== '' && (
                  <>
                    <span className="text-tinta-fraca"> · </span>
                    <time dateTime={cartao.created_at}>
                      {formatarDataCandidatura(cartao.created_at)}
                    </time>
                  </>
                )}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar detalhes da vaga"
            className="shrink-0 rounded-sm p-1 font-dados text-[11px] text-tinta-fraca transition-colors hover:text-ambar focus-visible:outline-ambar"
          >
            ✕
          </button>
        </header>

        {/* Corpo rolável */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {cartao && (
            <div className="flex flex-col gap-6">
              {/* Link do anúncio */}
              <div className="flex flex-col gap-1">
                <span className="font-dados text-[10px] font-medium uppercase tracking-[0.12em] text-tinta-fraca">
                  Anúncio
                </span>
                <a
                  href={cartao.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-dados text-[12px] text-ambar underline decoration-ambar/40 underline-offset-4 hover:decoration-ambar"
                >
                  {cartao.url}
                </a>
              </div>

              {/* Requisitos */}
              {cartao.requisitos.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="font-dados text-[10px] font-medium uppercase tracking-[0.12em] text-tinta-fraca">
                    Requisitos{' '}
                    <span className="font-dados text-[10px] normal-case tracking-normal text-tinta-fraca">
                      ({cartao.requisitos.length})
                    </span>
                  </span>
                  <ul className="flex flex-col gap-1" role="list">
                    {cartao.requisitos.map((req, idx) => (
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
          )}
        </div>
      </dialog>
    </>
  );
}
