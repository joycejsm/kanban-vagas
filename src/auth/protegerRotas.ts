import { destinoParaRedirecionamento } from '@/auth/next';
import { decidirRedirecionamento, type DecisaoRotas } from '@/auth/rotas';

/**
 * Núcleo da proteção de rotas, separado do `src/middleware.ts` para poder ser testado.
 *
 * O middleware exportado pelo Next tem contrato próprio — uma requisição, uma `NextResponse` —
 * e não aceita dependência injetada. Trazer a decisão para cá, expressa em termos que não são
 * do Next, deixa o comportamento verificável com um cliente falso: sem subir servidor, sem
 * falar com o Supabase e sem depender de `NextRequest`, que só existe dentro do runtime do Next.
 *
 * Os cookies não aparecem neste módulo. A renovação de sessão é escrita pelo `setAll` do
 * cliente, que o middleware entrega apontando para a resposta que ele próprio vai devolver.
 */

/** Usuário como o `getUser()` o devolve. Só o e-mail interessa nesta camada. */
export interface UsuarioDaSessao {
  email?: string | null;
}

/**
 * Parte do cliente Supabase que esta camada usa.
 *
 * Deliberadamente mínima e **sem `getSession`**: um cliente que exponha só isto não permite
 * validar a sessão pelo cookie, que é o caminho que a invariante 4 proíbe.
 */
export interface ClienteDeSessao {
  auth: {
    getUser(): Promise<{ data: { user: UsuarioDaSessao | null }; error: unknown }>;
  };
}

/** A requisição, reduzida ao que a decisão realmente consulta. */
export interface RequisicaoAProteger {
  /** URL absoluta, para montar o destino do redirecionamento. */
  url: string;
  /** `pathname`, sem query string. */
  caminho: string;
  /** Parâmetros da query, de onde sai o `next`. */
  parametros: URLSearchParams;
}

/** Fábrica do cliente, injetada para que o teste não dependa de ambiente nem de rede. */
export type FabricaClienteDeSessao = (requisicao: RequisicaoAProteger) => ClienteDeSessao;

/** Sessão resolvida no servidor. `autenticado: false` é a resposta para qualquer dúvida. */
export interface SessaoResolvida {
  autenticado: boolean;
  email: string | null;
}

/**
 * Resolve a sessão chamando o serviço de autenticação.
 *
 * `getUser()` e nunca `getSession()`: o cookie é assinado, mas o conteúdo não é conferido contra
 * o servidor, e um cookie forjado — ou um token expirado que o cliente ainda apresenta — passa
 * pela verificação local. Confirmar o token com o Auth é o que faz "autenticado" significar
 * algo.
 *
 * Falha de rede ou exceção do Auth resultam em **não autenticado**. O efeito é um redirecionamento
 * para o login em vez de uma tela quebrada, que é o pior desfecho para quem está entrando.
 */
export async function resolverSessao(cliente: ClienteDeSessao): Promise<SessaoResolvida> {
  try {
    const { data, error } = await cliente.auth.getUser();

    if (error || data?.user === null || data?.user === undefined) {
      return { autenticado: false, email: null };
    }

    return { autenticado: true, email: data.user.email ?? null };
  } catch {
    return { autenticado: false, email: null };
  }
}

/**
 * Avalia a requisição e devolve o que fazer com ela.
 *
 * Não constrói resposta: devolve a decisão, e quem chamou — o middleware — a traduz para uma
 * `NextResponse`. Assim o núcleo não sabe o que é resposta, e o middleware não sabe o que é
 * regra de rota.
 *
 * @param requisicao caminho, query e URL da requisição que está entrando.
 * @param criarCliente fábrica do cliente do usuário da requisição.
 */
export async function avaliarRequisicao(
  requisicao: RequisicaoAProteger,
  criarCliente: FabricaClienteDeSessao,
): Promise<DecisaoRotas> {
  const cliente = criarCliente(requisicao);
  const sessao = await resolverSessao(cliente);

  return decidirRedirecionamento(
    requisicao.caminho,
    sessao.autenticado,
    destinoParaRedirecionamento(requisicao.parametros.get('next')),
  );
}
