import { lerAllowlistDoServidor as lerAllowlist } from '@/config/serverEnv';

/**
 * Allowlist de acesso: só os e-mails explicitamente autorizados usam o app (decisão D4).
 *
 * Este módulo tem duas peças, e a separação é o ponto:
 *
 * - `emailAutorizado` é **puro**. Decide com o que recebeu, sem ler ambiente, sem ir ao banco.
 *   É onde mora a única regra de comparação, e é o que os testes exercitam direto.
 * - `lerAllowlistDoServidor` é a **fonte** da lista. Ela vem do ambiente do servidor, lida pelo
 *   módulo que é o único autorizado a tocar `process.env` — de propósito, para que exista um
 *   lugar, e não N lugares, de onde o ambiente é lido.
 *
 * A comparação é case-insensitive e ignora espaços nas pontas, porque e-mail é case-insensitive
 * na prática: um e-mail autorizado em maiúsculas seria barrado por erro do usuário. O risco
 * oposto — a normalização ampliar o alcance da autorização — é desprezível aqui, porque a lista
 * é do próprio dono do app.
 */

/** Forma canônica de um e-mail para comparação. Valor ausente vira string vazia. */
function normalizarEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? '';
}

/**
 * Diz se o e-mail está na allowlist.
 *
 * E-mail ausente ou lista vazia é **não autorizado**: nunca "permitir todos" como resposta a
 * uma configuração incompleta.
 */
export function emailAutorizado(
  email: string | null | undefined,
  lista: readonly string[],
): boolean {
  const alvo = normalizarEmail(email);
  if (alvo === '') {
    return false;
  }

  return lista.some((autorizado) => normalizarEmail(autorizado) === alvo);
}

/**
 * Lê a allowlist do ambiente do servidor, já normalizada e deduplicada.
 *
 * A lista é lida a cada chamada, sem cache entre requisições: uma mudança de autorização passa
 * a valer no mesmo instante em que a variável muda, e um cache seria um segundo lugar onde a
 * lista mora — justamente o que a decisão D4 tenta evitar.
 *
 * @throws {ErroConfiguracaoAllowlist} quando a variável está ausente ou vazia.
 */
export function lerAllowlistDoServidor(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return lerAllowlist(env);
}
