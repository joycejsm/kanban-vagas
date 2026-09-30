'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { sanearNext } from '@/auth/next';
import { resolverOrigem } from '@/auth/origem';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * Início do login com o Google.
 *
 * O fluxo é PKCE: o Supabase devolve um código em vez do token, e quem troca o código por sessão
 * é a rota `/auth/callback`. O `skipBrowserRedirect: true` desliga o redirect que o SDK faria
 * por conta própria, porque quem deve construir o redirecionamento é esta action — com o destino
 * já saneado, e não o endereço que o provedor devolveu.
 *
 * O destino é transportado como parâmetro `next` da própria rota de callback, sanitizado antes
 * de ser montado. O provedor nunca escolhe para onde o usuário volta: ele devolve um código, e
 * o `next` viaja na URL que esta action construiu, que só existe porque o valor passou por
 * `sanearNext`.
 */
export async function entrarComGoogle(destinoPedido?: string | null): Promise<void> {
  const cliente = await criarClienteServidor();
  const origem = resolverOrigem(await headers());
  const destino = sanearNext(destinoPedido);

  const { data, error } = await cliente.auth.signInWithOAuth({
    provider: 'google',
    options: {
      skipBrowserRedirect: true,
      redirectTo: `${origem}/auth/callback?next=${encodeURIComponent(destino)}`,
    },
  });

  // Falha do provedor e resposta sem URL são o mesmo desfecho: mensagem genérica na tela de
  // login. O conteúdo do erro do Supabase não vai para o navegador.
  const urlDeRetorno = error === null ? data?.url : undefined;
  if (urlDeRetorno === undefined) {
    redirect('/login?erro=auth');
  }

  redirect(urlDeRetorno);
}
