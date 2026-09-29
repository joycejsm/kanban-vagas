import { lerConfiguracaoSupabase } from '@/config/serverEnv';

/**
 * A rota raiz consome a configuração do servidor (tarefa 3.3), de modo que a ausência de uma
 * variável interrompa a execução com a mensagem de `ErroConfiguracaoSupabase` em vez de a
 * aplicação subir degradada e falhar mais tarde, em um lugar que não aponta para a causa.
 *
 * `force-dynamic` mantém essa leitura no tempo de requisição: sem ele o Next geraria a página
 * em tempo de build, e `next build` passaria a depender de `.env.local` existir.
 */
export const dynamic = 'force-dynamic';

export default function PaginaInicial() {
  const config = lerConfiguracaoSupabase();

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold">Kanban de Vagas</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Aplicação Next.js inicializada. A interface do quadro é da fase de interface; aqui a
        rota existe, compila e é servida.
      </p>
      {/* Confirma que a configuração foi lida, sem exibir o valor de nenhuma chave. */}
      <p className="mt-4 text-xs text-neutral-500">
        Supabase configurado em: {config.NEXT_PUBLIC_SUPABASE_URL}
      </p>
    </main>
  );
}
