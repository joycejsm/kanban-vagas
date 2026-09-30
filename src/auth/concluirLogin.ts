import { emailAutorizado } from '@/auth/allowlist';
import { sanearNext } from '@/auth/next';
import { ROTA_DE_LOGIN, ROTA_INICIAL } from '@/auth/rotas';

/**
 * Conclusão do login: troca do código por sessão e decisão de acesso.
 *
 * Fica fora da rota porque a rota do App Router tem contrato próprio e não aceita dependência
 * injetada. Aqui o fluxo inteiro é verificável com um cliente falso — código válido, código
 * ausente, código inválido, e-mail dentro e fora da lista — sem servidor e sem Supabase.
 *
 * O destino do pós-login é decidido **aqui**, a partir do `next` sanitizado, e não a partir do
 * que o provedor devolveu. O provedor devolve um código; ele não escolhe para onde o usuário
 * volta.
 */

/** Usuário como o Auth o devolve. Só o e-mail interessa aqui. */
export interface UsuarioDoCallback {
  email?: string | null;
}

/** Resposta de `exchangeCodeForSession`. */
export interface SessaoTrocada {
  data: { user: UsuarioDoCallback | null } | null;
  error: unknown;
}

/** Cliente usado pelo callback, reduzido ao que o fluxo consome. */
export interface ClienteDoCallback {
  auth: {
    exchangeCodeForSession(codigo: string): Promise<SessaoTrocada>;
    signOut(): Promise<unknown>;
  };
}

/** O que a rota precisa saber para responder. */
export interface ResultadoDoCallback {
  /** Caminho interno para onde redirecionar. */
  destino: string;
  /** `true` quando a sessão foi encerrada e nenhum cookie de sessão deve sobreviver. */
  sessaoEncerrada: boolean;
}

/** Parâmetros que a rota entrega ao núcleo. */
export interface EntradaDoCallback {
  codigo: string | null;
  next: string | null;
  cliente: ClienteDoCallback;
  allowlist: readonly string[];
}

/** Caminhos de erro da tela de login. */
const ROTA_DE_ERRO_DE_AUTENTICACAO = `${ROTA_DE_LOGIN}?erro=auth`;
const ROTA_DE_ERRO_DE_AUTORIZACAO = `${ROTA_DE_LOGIN}?erro=nao_autorizado`;

/**
 * Conclui o login.
 *
 * Ordem das etapas, e cada uma é um ponto de saída:
 *
 * 1. código ausente → erro de autenticação, sem tocar na sessão;
 * 2. troca recusada ou código inválido/expirado → erro de autenticação, sem sessão criada;
 * 3. e-mail fora da allowlist → **encerra a sessão** e vai para `nao_autorizado`;
 * 4. sucesso → destino saneado, que nunca é uma URL fora do app.
 *
 * O `next` é saneado antes de qualquer uso, e o resultado da sanitização é o que vai para o
 * redirecionamento. Nenhum detalhe do erro do Supabase chega ao destino: a tela recebe
 * `erro=auth` e nada mais.
 */
export async function concluirLogin(entrada: EntradaDoCallback): Promise<ResultadoDoCallback> {
  const { codigo, cliente, allowlist } = entrada;

  if (codigo === null || codigo === '') {
    return { destino: ROTA_DE_ERRO_DE_AUTENTICACAO, sessaoEncerrada: false };
  }

  const { data, error } = await trocarCodigo(cliente, codigo);

  if (error !== null || data?.user === null || data?.user === undefined) {
    return { destino: ROTA_DE_ERRO_DE_AUTENTICACAO, sessaoEncerrada: false };
  }

  if (!emailAutorizado(data.user.email, allowlist)) {
    // A sessão existe neste ponto — o código era válido e a conta foi autenticada. Encerrá-la
    // aqui é o que impede que o usuário siga com uma sessão ativa, mesmo que ele já tenha
    // carregado a página.
    await cliente.auth.signOut();
    return { destino: ROTA_DE_ERRO_DE_AUTORIZACAO, sessaoEncerrada: true };
  }

  return { destino: sanearNext(entrada.next), sessaoEncerrada: false };
}

/**
 * Troca o código por sessão sem deixar exceção escapar.
 *
 * A rede falha, o cliente pode lançar, e um Route Handler que deixa a exceção passar responde
 * 500 com a mensagem do erro no corpo. Isso violaria o requisito de tratar código inválido como
 * falha previsível e sem expor detalhe: o desfecho de qualquer problema na troca é o mesmo
 * `erro=auth`, e o motivo real vai só para o log do servidor.
 */
async function trocarCodigo(cliente: ClienteDoCallback, codigo: string): Promise<SessaoTrocada> {
  try {
    const resultado = await cliente.auth.exchangeCodeForSession(codigo);

    // Um código inválido, expirado ou já usado não lança: o SDK **resolve** com `error` no
    // corpo. Sem este log, a falha mais comum do fluxo PKCE era completamente silenciosa — o
    // navegador recebia `erro=auth` e o terminal não dizia nada. Registra-se o tipo, nunca a
    // mensagem, que carregaria o detalhe interno que a invariante 8 proíbe.
    if (resultado.error !== null && resultado.error !== undefined) {
      console.error(
        '[auth/callback] falha ao trocar codigo por sessao: %s',
        erroDescritivo(resultado.error),
      );
    }

    return resultado;
  } catch (erro) {
    console.error('[auth/callback] falha ao trocar codigo por sessao: %s', erroDescritivo(erro));
    return { data: null, error: erro };
  }
}

/** Só o tipo do erro, nunca a mensagem: a mensagem pode conter detalhe interno. */
function erroDescritivo(erro: unknown): string {
  if (erro instanceof Error) {
    return erro.name;
  }

  if (typeof erro === 'object' && erro !== null) {
    // O erro do SDK do Supabase nem sempre é uma `Error`: costuma ser um objeto com `name`,
    // `code` e `status`. Sem este ramo, a falha de PKCE — o caso mais comum — cairia em
    // "desconhecido" e o log não diria nada de útil.
    const { name, code, status } = erro as { name?: unknown; code?: unknown; status?: unknown };
    const partes = [
      typeof name === 'string' ? name : undefined,
      typeof code === 'string' ? code : undefined,
      typeof status === 'number' ? String(status) : undefined,
    ].filter((parte): parte is string => parte !== undefined);

    return partes.length > 0 ? partes.join('/') : 'desconhecido';
  }

  return 'desconhecido';
}

export { ROTA_DE_ERRO_DE_AUTENTICACAO, ROTA_DE_ERRO_DE_AUTORIZACAO, ROTA_INICIAL };
