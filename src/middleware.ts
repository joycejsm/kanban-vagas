import { NextResponse, type NextRequest } from 'next/server';

import { avaliarRequisicao, type RequisicaoAProteger } from '@/auth/protegerRotas';
import {
  CABECALHO_CSP,
  CABECALHO_NONCE,
  configuracaoParaCsp,
  gerarNonce,
  montarCsp,
} from '@/config/csp';
import { criarClienteNoMiddleware } from '@/lib/supabase/server';

/**
 * Ponto único que decide "o usuário está autenticado" (decisão D1).
 *
 * Ele roda antes de qualquer byte de resposta, ao contrário de `redirect()` no layout ou na
 * página, que roda depois do streaming e deixa o HTML vazar antes do redirect. Por isso a
 * proteção mora aqui e não lá.
 *
 * Este arquivo é só a tradução entre o Next e a regra: quem decide é
 * `src/auth/protegerRotas.ts`, e quem decide o destino é `src/auth/rotas.ts`. A sessão é
 * validada a cada requisição por `getUser()` (decisão D2) e o cookie renovado é gravado na
 * resposta pelo `setAll` do cliente.
 *
 * A CSP também mora aqui, e não em `next.config.ts` (design D9, revisado). O nonce precisa
 * ser o **mesmo** valor no cabeçalho da requisição que o Next lê e no atributo `nonce` que ele
 * escreve nos scripts; só o middleware vê os dois lados. Deixá-la no `headers()` do config
 * produziria dois cabeçalhos `Content-Security-Policy`, e o navegador aplica a interseção
 * deles — ou seja, a mais restritiva, que é justamente a que não tem nonce.
 */
export async function middleware(requisicao: NextRequest): Promise<NextResponse> {
  const nonce = gerarNonce();
  const csp = montarCsp(configuracaoParaCsp(), nonce);

  // O cabeçalho vai para a *requisição* porque é de lá que o Next lê o nonce
  // (`headers['content-security-policy']` em `app-render.js`). Sem esta linha os scripts do
  // framework saem sem atributo `nonce` e a CSP os bloqueia — a página carrega sem JS.
  const cabecalhosRequisicao = new Headers(requisicao.headers);
  cabecalhosRequisicao.set(CABECALHO_NONCE, nonce);
  cabecalhosRequisicao.set(CABECALHO_CSP, csp);

  const resposta = NextResponse.next({ request: { headers: cabecalhosRequisicao } });
  resposta.headers.set(CABECALHO_CSP, csp);

  const paraProteger: RequisicaoAProteger = {
    url: requisicao.url,
    caminho: requisicao.nextUrl.pathname,
    parametros: requisicao.nextUrl.searchParams,
  };

  const decisao = await avaliarRequisicao(paraProteger, () =>
    criarClienteNoMiddleware(requisicao, resposta),
  );

  if (decisao.tipo === 'seguir') {
    return resposta;
  }

  // `NextResponse.redirect` cria uma resposta nova, e a nova não carrega os cookies que
  // `setAll` escreveu em `resposta` — a renovação de sessão se perderia justamente na requisição
  // que redireciona. Por isso os cookies são copiados. A CSP vai junto pelo mesmo motivo: a
  // resposta de redirecionamento também é um documento, e é ela que entrega o `Location`.
  const redirecionamento = NextResponse.redirect(new URL(decisao.destino, requisicao.url));
  redirecionamento.headers.set(CABECALHO_CSP, csp);
  for (const cookie of resposta.cookies.getAll()) {
    redirecionamento.cookies.set(cookie);
  }

  return redirecionamento;
}

/**
 * Escopo do middleware.
 *
 * A regex nega, dentro do grupo, os caminhos de infraestrutura do framework e qualquer arquivo
 * com extensão. A negação é por *exclusão explícita* dentro de um matcher que cobre o resto: o
 * requisito pede que assets não passem por aqui, e o efeito colateral desejado é o mesmo da D1
 * — o que não é nomeado não é executado.
 *
 * O Next compila esta string com `path-to-regexp`, que ancora a expressão nas duas pontas: a
 * exclusão vale para o caminho inteiro, e não para qualquer posição dele.
 *
 * `_next/webpack-hmr` entra na lista porque é infraestrutura do framework e não tem extensão:
 * sem ela, o handshake do hot reload passaria pela validação de sessão e o HMR quebraria em
 * desenvolvimento.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|.*\\.[\\w]+$).*)'],
};
