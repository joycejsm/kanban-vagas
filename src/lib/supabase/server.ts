import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

import { lerConfiguracaoSupabase } from '@/config/serverEnv';

/**
 * Fábrica única de cliente Supabase do lado do servidor.
 *
 * Existe uma só porque a sessão é uma coisa só: duas fábricas com adaptadores de cookie
 * diferentes dariam duas maneiras de ler a sessão, e a diferença só apareceria em produção,
 * quando a sessão de um usuário não atravessa a requisição (decisão D1/D2).
 *
 * O cliente é **sempre** o do usuário, montado com a chave anon e o JWT dos cookies da
 * requisição. A service role key nunca entra aqui: toda escrita passa pelo RLS real
 * (invariante 2), e é por isso que `vagaService` recebe este cliente e não outro.
 */
export async function criarClienteServidor(): Promise<SupabaseClient> {
  const config = lerConfiguracaoSupabase();
  const cookieStore = await cookies();

  return createServerClient(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesParaGravar) {
        try {
          for (const { name, value, options } of cookiesParaGravar) {
            cookieStore.set(name, value, options);
          }
        } catch (erro) {
          // `setAll` só pode ser chamado em Route Handler ou Server Action. Em Server
          // Component o cookie já vem escrito na resposta pela camada que renova a sessão, e o
          // erro aqui seria apenas ruído no terminal.
          //
          // Isso NÃO é só ruído no fluxo PKCE: se a gravação do `code_verifier` falhar na
          // action de login, o código volta do Google sem par e a troca falha com
          // `erro=auth` — sem nenhuma pista do motivo. O log é só do tipo, nunca do valor do
          // cookie nem da mensagem do erro.
          console.error(
            '[supabase/server] setAll falhou (%d cookie(s)): %s',
            cookiesParaGravar.length,
            erro instanceof Error ? erro.name : 'desconhecido',
          );
        }
      },
    },
  });
}

/**
 * Cliente para o middleware, com os cookies da requisição e da resposta.
 *
 * Fica no mesmo módulo de propósito — a configuração é a mesma e o próximo passo é o do
 * middleware — mas não toca `next/headers`: o edge runtime não tem esse módulo, e a leitura do
 * cookie vem do `NextRequest`, enquanto a escrita vai no `NextResponse`.
 *
 * O `setAll` é o que renova a sessão a cada navegação: sem ele o cookie issued pelo Supabase
 * seria descartado e a sessão expiraria mesmo com o usuário ativo.
 */
export function criarClienteNoMiddleware(
  requisicao: NextRequest,
  resposta: NextResponse,
): SupabaseClient {
  const config = lerConfiguracaoSupabase();

  return createServerClient(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return requisicao.cookies.getAll();
      },
      setAll(cookiesParaGravar) {
        for (const { name, value, options } of cookiesParaGravar) {
          resposta.cookies.set(name, value, options);
        }
      },
    },
  });
}
