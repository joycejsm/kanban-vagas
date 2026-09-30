'use client';

import { useActionState, useEffect, useRef } from 'react';

import { adicionarVagaComEstado } from '@/app/actions/vagas';
import { visaoDoFormulario } from '@/quadro/formulario';

/**
 * Formulário de cadastro de vaga por URL.
 *
 * É o ponto de entrada do produto inteiro: cola-se o link do anúncio, o servidor encaminha para a
 * Edge Function extrair os dados, e o card nasce no quadro. Não há cadastro manual — o que
 * aparece aqui é só a URL, e o texto colado existe para quando o site bloqueia a extração.
 *
 * Client Component por dois motivos, ambos verificáveis: o `useActionState` precisa mostrar o
 * resultado do envio sem recarregar a página, e o campo de texto colado só aparece **depois** de
 * uma falha de extração — não há como fazer isso num Server Component. A chamada, essa, continua
 * rodando inteiramente no servidor, em `adicionarVaga`.
 *
 * O formulário é um `<form action>` de verdade, e não um `onSubmit`: a URL e o botão funcionam
 * sem JavaScript, e o que depende dele é a revelação do campo de texto, o movimento de cards e a
 * remoção (design D9).
 */
export function FormularioNovaVaga() {
  const [estado, enviar, pendente] = useActionState(adicionarVagaComEstado, null);
  const formulario = useRef<HTMLFormElement>(null);
  const visao = visaoDoFormulario(estado);

  // Limpa os campos depois de um cadastro certo, para a próxima URL colada não ficar misturada
  // com a anterior. `deveLimpar` vem da função pura justamente para essa decisão não ser um
  // `if` dentro do JSX.
  useEffect(() => {
    if (visao.deveLimpar) {
      formulario.current?.reset();
    }
  }, [visao.deveLimpar]);

  const corDaMensagem =
    visao.aparencia === 'aviso' ? 'text-amber-800' : 'text-red-700';

  return (
    <section
      id="nova-vaga"
      aria-labelledby="nova-vaga-titulo"
      className="rounded border border-neutral-200 bg-white p-4"
    >
      <h2 id="nova-vaga-titulo" className="text-sm font-semibold">
        Adicionar vaga pela URL
      </h2>

      <form ref={formulario} action={enviar} className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="url" className="text-xs text-neutral-600">
              Link da vaga
            </label>
            <input
              id="url"
              name="url"
              type="url"
              required
              maxLength={2048}
              placeholder="https://"
              autoComplete="off"
              className="rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={pendente}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {pendente ? 'Buscando dados…' : 'Adicionar'}
          </button>
        </div>

        {/* O campo de texto colado só existe depois de uma falha de extração: é a segunda
            tentativa de verdade, e oferecê-lo antes gastaria a tela de um campo que quase
            ninguém preenche. */}
        {visao.mostrarCampoDeTexto && (
          <div className="flex flex-col gap-1">
            <label htmlFor="texto" className="text-xs text-neutral-600">
              Cole o texto do anúncio para eu tentar de novo
            </label>
            <textarea
              id="texto"
              name="texto"
              rows={4}
              maxLength={30000}
              className="rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        )}

        {visao.mensagem !== null && (
          <p role="alert" className={`text-sm ${corDaMensagem}`}>
            {visao.mensagem}
          </p>
        )}
      </form>
    </section>
  );
}
