/**
 * Configuração da função, lida do ambiente do Supabase.
 *
 * Nenhum valor tem fallback em código: se faltar secret, a função recusa executar
 * em vez de degradar silenciosamente. `GEMINI_API_KEY` nunca sai daqui (invariante 1).
 */

export interface EnvConfig {
  geminiApiKey: string;
  geminiModel: string;
  allowedEmails: string[];
  appOrigin: string;
}

export class EnvInvalidoError extends Error {
  constructor(nomes: string[]) {
    super(`Configuração ausente: ${nomes.join(', ')}`);
    this.name = 'EnvInvalidoError';
  }
}

type LeitorEnv = (nome: string) => string | undefined;

/** Normaliza e-mail para comparação: sem espaços nas pontas e minúsculas. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Lê e valida as secrets. Separado do acesso direto a `Deno.env` para que os
 * testes possam injetar um leitor falso.
 */
export function lerEnv(ler: LeitorEnv): EnvConfig {
  const faltando: string[] = [];

  const obrigatorio = (nome: string): string => {
    const valor = ler(nome)?.trim();
    if (!valor) {
      faltando.push(nome);
      return '';
    }
    return valor;
  };

  const geminiApiKey = obrigatorio('GEMINI_API_KEY');
  const geminiModel = obrigatorio('GEMINI_MODEL');
  const appOrigin = obrigatorio('APP_ORIGIN');
  const listaEmails = obrigatorio('ALLOWED_EMAILS');

  if (faltando.length > 0) {
    throw new EnvInvalidoError(faltando);
  }

  return {
    geminiApiKey,
    geminiModel,
    appOrigin,
    allowedEmails: listaEmails
      .split(',')
      .map(normalizarEmail)
      .filter((email) => email.length > 0),
  };
}

/** Leitura padrão, a partir do ambiente do runtime. */
export function lerEnvPadrao(): EnvConfig {
  return lerEnv((nome) => Deno.env.get(nome));
}

/**
 * `Origin` é comparado de forma exata: subdomínio diferente não é a mesma origem.
 *
 * Origem **ausente** é aceita, e é o caso que o chamador real produz. A requisição chega por
 * `fetch` dentro de uma Server Action, ou seja, servidor-para-servidor: o cabeçalho `Origin` é
 * emitido pelo user agent, e um `fetch` de Node não o produz. Antes esta função recusava a
 * ausência, e o resultado era que **toda** chamada real do aplicativo morria em `403` na
 * primeira etapa do pipeline, sem chegar a extrair nada.
 *
 * Aceitar a ausência não afrouxa a proteção que este requisito existe para dar. Navegador
 * **sempre** envia `Origin` em requisição cross-origin, então nenhuma página alheia consegue
 * levar a ausência a sério: o `Origin` que ela produz é conferido aqui como sempre, e é recusado
 * se for diferente de `APP_ORIGIN`. O que passa a ser aceito é a chamada de quem não é
 * navegador — o servidor do Next, `curl`, um cliente móvel — e essa já era barrada logo depois,
 * por token de sessão, allowlist e limite de uso.
 */
export function origemPermitida(origem: string | null, appOrigin: string): boolean {
  return origem === null || origem === appOrigin;
}
