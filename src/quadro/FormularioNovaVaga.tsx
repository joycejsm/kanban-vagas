'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { adicionarVagaComEstado } from '@/app/actions/vagas';
import { LIMITE_TEXTO_COLADO } from '@/domain/vaga';
import { visaoDoFormulario } from '@/quadro/formulario';

/**
 * Formulário de cadastro de vaga por URL.
 *
 * É o ponto de entrada do produto inteiro: cola-se o link do anúncio, o servidor encaminha para a
 * Edge Function extrair os dados, e o card nasce no quadro. Não há cadastro manual — o que
 * aparece aqui é só a URL, e o texto colado existe para quando o site bloqueia a extração.
 *
 * Client Component porque `useActionState` e a leitura da área de transferência dependem do
 * navegador. A chamada de extração continua rodando inteiramente no servidor.
 *
 * O formulário é um `<form action>` de verdade, e não um `onSubmit`: a URL e o botão funcionam
 * sem JavaScript, e o que depende dele é a revelação do campo de texto, o movimento de cards e a
 * remoção (design D9).
 */
export function FormularioNovaVaga() {
  const [estado, enviar, pendente] = useActionState(adicionarVagaComEstado, null);
  const [mostrarTexto, setMostrarTexto] = useState(false);
  const [textoColado, setTextoColado] = useState('');
  const [mensagemClipboard, setMensagemClipboard] = useState<string | null>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const visao = visaoDoFormulario(estado);

  async function colarTextoCompleto() {
    setMostrarTexto(true);
    setMensagemClipboard(null);

    if (!navigator.clipboard?.readText) {
      setMensagemClipboard(
        'Não foi possível acessar a área de transferência. Cole o texto manualmente no campo abaixo.',
      );
      return;
    }

    try {
      const texto = await navigator.clipboard.readText();

      if (texto.trim() === '') {
        setMensagemClipboard('A área de transferência está vazia. Copie a descrição da vaga e tente novamente.');
        return;
      }

      if (texto.length > LIMITE_TEXTO_COLADO) {
        setMensagemClipboard(
          `O texto excede o limite de ${LIMITE_TEXTO_COLADO.toLocaleString('pt-BR')} caracteres. Copie apenas o anúncio da vaga.`,
        );
        return;
      }

      setTextoColado(texto);
    } catch (erro) {
      const mensagem =
        erro instanceof Error && erro.name === 'NotAllowedError'
          ? 'O navegador bloqueou o acesso à área de transferência. Cole o texto manualmente no campo abaixo.'
          : 'Não foi possível ler a área de transferência. Cole o texto manualmente no campo abaixo.';
      setMensagemClipboard(mensagem);
    }
  }

  // Limpa os campos depois de um cadastro certo, para a próxima URL colada não ficar misturada
  // com a anterior. `deveLimpar` vem da função pura justamente para essa decisão não ser um
  // `if` dentro do JSX.
  useEffect(() => {
    if (visao.deveLimpar) {
      formulario.current?.reset();
      setTextoColado('');
      setMostrarTexto(false);
      setMensagemClipboard(null);
    }
  }, [estado, visao.deveLimpar]);

  // O `aviso` e o `erro` diferem em cor, e a escolha fica num objeto em vez de uma interpolação
  // de classe: `text-${aparencia}` não entraria no CSS, pela mesma razão que o
  // `quadro/aparencia.ts` documente.
  const tomDaMensagem =
    visao.aparencia === 'aviso' ? 'text-barro' : 'text-terra';

  return (
    <section
      id="nova-vaga"
      aria-labelledby="nova-vaga-titulo"
      className="rounded-sm border border-traco bg-papel"
    >
      <header className="border-b border-traco px-4 py-3">
        <h2
          id="nova-vaga-titulo"
          className="font-dados text-[11px] font-medium uppercase tracking-[0.14em] text-ambar"
        >
          Nova vaga
        </h2>
      </header>

      <form ref={formulario} action={enviar} className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="url" className="font-dados text-[11px] text-tinta-fraca">
              link da vaga
            </label>
            <input
              id="url"
              name="url"
              type="url"
              required
              maxLength={2048}
              placeholder="https://"
              autoComplete="off"
              className="campo font-dados"
            />
          </div>

          <button
            type="submit"
            disabled={pendente}
            className="rounded-sm border border-ambar/50 bg-ambar-fundo px-4 py-2 font-dados text-xs font-medium text-ambar transition-colors hover:bg-ambar hover:text-tinta disabled:opacity-50"
          >
            {pendente ? 'Buscando dados…' : 'Adicionar'}
          </button>
        </div>

        <button
          type="button"
          onClick={colarTextoCompleto}
          disabled={pendente}
          aria-expanded={mostrarTexto || visao.mostrarCampoDeTexto}
          className="self-start rounded-sm border border-traco px-3 py-2 font-dados text-xs text-tinta-fraca transition-colors hover:border-ambar hover:text-ambar disabled:opacity-50"
        >
          Colar texto completo da vaga
        </button>
        <p className="font-corpo text-xs text-tinta-fraca">
          Copie a descrição do Indeed e use este botão, ou cole manualmente no campo que aparecer.
        </p>

        {(mostrarTexto || visao.mostrarCampoDeTexto) && (
          <div className="flex flex-col gap-1">
            <label htmlFor="texto" className="font-dados text-[11px] text-tinta-fraca">
              texto do anúncio
            </label>
            <textarea
              id="texto"
              name="texto"
              rows={4}
              maxLength={LIMITE_TEXTO_COLADO}
              value={textoColado}
              onChange={(evento) => setTextoColado(evento.currentTarget.value)}
              className="campo resize-y"
            />
            <p className="font-corpo text-xs text-tinta-fraca">
              Cole a descrição aqui. O link acima será salvo como origem da vaga.
            </p>
            {mensagemClipboard !== null && (
              <p role="status" className="font-corpo text-xs text-terra">
                {mensagemClipboard}
              </p>
            )}
          </div>
        )}

        {visao.mensagem !== null && (
          <p role="alert" className={`font-corpo text-sm ${tomDaMensagem}`}>
            {visao.mensagem}
          </p>
        )}
      </form>
    </section>
  );
}
