import { lerConfiguracaoSupabase } from '@/config/serverEnv';
import { FormularioNovaVaga } from '@/quadro/FormularioNovaVaga';
import { Quadro } from '@/quadro/Quadro';
import { carregarQuadro, ehEstadoVazio } from '@/quadro/carregarQuadro';
import { paraCartoes } from '@/quadro/estado';

/**
 * A rota raiz: o formulário de cadastro e o quadro.
 *
 * `force-dynamic` mantém a leitura no tempo de requisição. Sem ele o Next geraria a página em
 * tempo de build, e `next build` passaria a depender de `.env.local` existir — além de um quadro
 * estático, que é o contrário do que a spec pede.
 *
 * A leitura da configuração **precisa** acontecer aqui, e fora do `try/catch` de `carregarQuadro`.
 * A spec `app-scaffold` exige que a ausência de uma variável interrompa a execução com a mensagem
 * de `ErroConfiguracaoSupabase`, e `carregarQuadro` engole toda exceção de propósito — para que
 * uma falha de consulta virasse aviso em vez de tela quebrada. Sem esta chamada, uma aplicação
 * sem configuração subiria degradada, mostrando cinco colunas vazias e um aviso, e o
 * desenvolvedor não saberia que o problema era o ambiente.
 */
export const dynamic = 'force-dynamic';

export default async function PaginaInicial() {
  lerConfiguracaoSupabase();

  const resultado = await carregarQuadro();
  // A projeção acontece no servidor, antes da fronteira: um Client Component recebe os dados pelo
  // payload de RSC, que é HTML, e a linha do banco carrega `user_id` (design D10).
  const cartoes = paraCartoes(resultado.vagas);
  const semVagas = ehEstadoVazio(resultado);

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-traco pb-4">
        <div>
          {/*
            O título é a Fraunces com `WONK` ligado e em itálico: é o traço mais forte da
            identidade. Num título de produto ela grita; num cabeçalho de uso diário ela fica só
            estranha o bastante para não parecer template.
          */}
          <h1 className="font-titulo text-3xl italic text-tinta-clara">Kanban de Vagas</h1>
          <p className="mt-1 font-dados text-[11px] tracking-wide text-tinta-fraca">
            cole o link de um anúncio para acompanhar a candidatura
          </p>
        </div>

        {/*
          O total à direita, em mono e com zero à esquerda, como os números das colunas: é o
          mesmo sistema de leitura, e quem olha o cabeçalho já entende a notação sem lê-la. Fica
          fora do `<h1>` de propósito — um total de vagas não é o assunto da página, e entra-lo
          no título o colocaria no primeiro plano da navegação por leitor de tela.
        */}
        <p className="font-dados text-[11px] tabular-nums tracking-wide text-tinta-fraca">
          {String(cartoes.length).padStart(2, '0')} vaga{cartoes.length === 1 ? '' : 's'}
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <FormularioNovaVaga />

        {resultado.aviso !== null && (
          <p
            role="alert"
            className="rounded-sm border border-barro/40 bg-ambar-fundo px-3 py-2 font-corpo text-sm text-barro"
          >
            {resultado.aviso}
          </p>
        )}

        {/* O convite só aparece quando a leitura deu certo e não havia vaga alguma. Num estado de
            falha ele seria mentira: a pessoa veria "cadastre a primeira vaga" sem saber que
            existe uma segunda. */}
        {semVagas && (
          <p className="font-corpo text-sm text-tinta-media">
            Nenhuma vaga ainda.{' '}
            <a
              href="#nova-vaga"
              className="text-ambar underline decoration-ambar/40 underline-offset-4 hover:decoration-ambar"
            >
              Cadastre a primeira pelo link do anúncio
            </a>
            .
          </p>
        )}

        <Quadro cartoes={cartoes} />
      </div>
    </main>
  );
}
