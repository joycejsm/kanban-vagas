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
    <main className="min-h-screen p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Kanban de Vagas</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Cole o link de um anúncio para acompanhar a candidatura.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <FormularioNovaVaga />

        {resultado.aviso !== null && (
          <p
            role="alert"
            className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            {resultado.aviso}
          </p>
        )}

        {/* O convite só aparece quando a leitura deu certo e não havia vaga alguma. Num estado de
            falha ele seria mentira: a pessoa veria "cadastre a primeira vaga" sem saber que
            existe uma segunda. */}
        {semVagas && (
          <p className="text-sm text-neutral-600">
            Nenhuma vaga ainda.{' '}
            <a href="#nova-vaga" className="text-blue-700 underline">
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
