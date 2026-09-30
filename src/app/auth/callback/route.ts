import { lerAllowlistDoServidor } from '@/auth/allowlist';
import {
  concluirLogin,
  type ClienteDoCallback,
  type UsuarioDoCallback,
} from '@/auth/concluirLogin';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * Conclusão do login por código PKCE.
 *
 * Rota de Route Handler porque o retorno é um redirecionamento do navegador para a aplicação,
 * não uma página: o provedor manda o usuário para cá e ele tem que continuar navegável.
 *
 * A sessão criada por `exchangeCodeForSession` é propagada pelos cookies do `@supabase/ssr`, de
 * modo que as requisições seguintes já saiam autenticadas sem novo login. O `criarClienteServidor`
 * funciona em Route Handler, então a gravação dos cookies acontece na própria resposta.
 */
export async function GET(requisicao: Request): Promise<Response> {
  const url = new URL(requisicao.url);

  const clienteCompleto = await criarClienteServidor();
  const cliente: ClienteDoCallback = {
    auth: {
      exchangeCodeForSession: (codigo: string) =>
        clienteCompleto.auth.exchangeCodeForSession(codigo),
      signOut: () => clienteCompleto.auth.signOut(),
    },
  };

  const resultado = await concluirLogin({
    codigo: url.searchParams.get('code'),
    next: url.searchParams.get('next'),
    cliente,
    allowlist: lerAllowlistDoServidor(),
  });

  // `303` porque a requisição que chega aqui é um GET do navegador vindo do provedor; o `302`
  // faria alguns navegadores reexecutarem a rota como POST depois do redirect.
  return Response.redirect(new URL(resultado.destino, url.origin), 303);
}

export type { UsuarioDoCallback };
