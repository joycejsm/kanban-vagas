import { entrarComGoogle } from '@/app/login/actions';

/**
 * Mensagens da tela de login, em pt-BR.
 *
 * Ficam em um lugar só porque a tela tem dois motivos de erro e o texto não pode divergir entre
 * eles — nem com o que a rota de callback mostra. O `erro` chega pela query string porque o
 * destino do redirect precisa sobreviver a um servidor: a query é o canal mais curto entre o
 * callback e esta página.
 */
const MENSAGENS_DE_ERRO: Record<string, string> = {
  auth: 'Não foi possível concluir o login. Tente novamente.',
  nao_autorizado: 'Este e-mail não tem acesso ao aplicativo.',
};

const ERRO_DESCONHECIDO =
  'Algo deu errado no login. Tente novamente.';

/** Traduz o parâmetro `erro` da query em mensagem; valor desconhecido cai na genérica. */
export function mensagemDeErro(erro: string | null): string | null {
  if (erro === null || erro === '') {
    return null;
  }

  return MENSAGENS_DE_ERRO[erro] ?? ERRO_DESCONHECIDO;
}

type Props = {
  searchParams: Promise<{ erro?: string | string[]; next?: string | string[] }>;
};

/**
 * Tela de login.
 *
 * Server Component, sem estado e sem JavaScript de cliente: o botão é um form que chama a
 * Server Action. A tela de login é de longe o caminho mais frio da aplicação — poucos
 * visitantes, nenhum motivo para hydrated bundle.
 */
export default async function PaginaDeLogin({ searchParams }: Props) {
  const parametros = await searchParams;
  const erro = Array.isArray(parametros.erro) ? parametros.erro[0] : parametros.erro;
  const destino = Array.isArray(parametros.next) ? parametros.next[0] : parametros.next;
  const mensagem = mensagemDeErro(erro ?? null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Kanban de Vagas</h1>

      {mensagem !== null && (
        <p role="alert" className="max-w-sm text-center text-sm text-red-700">
          {mensagem}
        </p>
      )}

      <form action={entrarComGoogle.bind(null, destino ?? null)}>
        <button
          type="submit"
          className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
        >
          Entrar com Google
        </button>
      </form>
    </main>
  );
}
