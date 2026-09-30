import { ehCaminhoInterno } from '@/auth/next';

/**
 * Rotas públicas e regra de redirecionamento (decisão D1).
 *
 * A lista é uma **allowlist**, não uma blocklist: tudo é privado salvo o que está escrito aqui.
 * A alternativa — proteger só a raiz com `matcher: ['/']` — é exatamente o bug que o requisito
 * manda evitar, porque uma rota nova nasce desprotegida por padrão e ninguém nota até alguém
 * notar.
 *
 * O `matcher` do middleware é outro assunto (assets não passam por aqui) e mora em
 * `src/middleware.ts`, junto do resto do que o Next precisa ler.
 */

/** Rotas acessíveis sem sessão válida. `/auth/callback` entra porque é ela que cria a sessão. */
export const ROTAS_PUBLICAS = ['/login', '/auth/callback'] as const;

/** Para onde vai quem não tem sessão, e de onde vem quem já tem. */
export const ROTA_DE_LOGIN = '/login';
export const ROTA_INICIAL = '/';

/** Decisão do middleware para uma requisição. */
export type DecisaoRotas =
  | { tipo: 'seguir' }
  | { tipo: 'redirecionar'; destino: string };

/** `true` quando o caminho é uma das rotas públicas. */
export function ehRotaPublica(caminho: string): boolean {
  return (ROTAS_PUBLICAS as readonly string[]).includes(caminho);
}

/**
 * Decide o que fazer com a requisição.
 *
 * A ordem das regras importa. `/login` é tratada antes da allowlist porque tem regra própria nos
 * dois sentidos: o anônimo fica, o autenticado sai. Já `/auth/callback` nunca é redirecionado —
 * é onde o código de autorização é trocado por sessão, e quem chega lá autenticado precisa
 * conseguir passar.
 *
 * @param caminho `pathname` da requisição, sem query string.
 * @param autenticado resultado de `getUser()` no servidor — nunca a presença de cookies.
 * @param destinoPedido caminho interno que o visitante tentou acessar, já saneado por
 * `sanearNext`. Só é usado para montar o `next` do redirecionamento ao login, e nunca é
 * aproveitado como URL completa.
 */
export function decidirRedirecionamento(
  caminho: string,
  autenticado: boolean,
  destinoPedido?: string | null,
): DecisaoRotas {
  if (caminho === ROTA_DE_LOGIN) {
    return autenticado
      ? { tipo: 'redirecionar', destino: ROTA_INICIAL }
      : { tipo: 'seguir' };
  }

  if (ehRotaPublica(caminho)) {
    return { tipo: 'seguir' };
  }

  if (!autenticado) {
    return {
      tipo: 'redirecionar',
      destino: montarDestinoDoLogin(destinoPedido),
    };
  }

  return { tipo: 'seguir' };
}

/**
 * `/login` ou `/login?next=…`, conforme haja destino interno a preservar.
 *
 * O destino é um dado que chega do cliente, então a forma é conferida aqui de novo, e não
 * apenas na sanitização da origem: mesmo que a sanitização seja contornada em algum lugar, o
 * que for acrescentado à URL só passa se casar com caminho relativo interno. Redundância
 * barata para uma concatenação que vira redirecionamento.
 */
function montarDestinoDoLogin(destinoPedido?: string | null): string {
  if (destinoPedido === undefined || destinoPedido === null || !ehCaminhoInterno(destinoPedido)) {
    return ROTA_DE_LOGIN;
  }

  return `${ROTA_DE_LOGIN}?next=${encodeURIComponent(destinoPedido)}`;
}
