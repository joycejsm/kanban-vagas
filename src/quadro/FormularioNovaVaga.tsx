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

        {/* O campo de texto colado só existe depois de uma falha de extração: é a segunda
            tentativa de verdade, e oferecê-lo antes gastaria a tela de um campo que quase
            ninguém preenche. */}
        {visao.mostrarCampoDeTexto && (
          <div className="flex flex-col gap-1">
            <label htmlFor="texto" className="font-dados text-[11px] text-tinta-fraca">
              cole o texto do anúncio para eu tentar de novo
            </label>
            <textarea
              id="texto"
              name="texto"
              rows={4}
              maxLength={30000}
              className="campo resize-y"
            />
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
