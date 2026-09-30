import { z } from 'zod';

/**
 * Configuração do Supabase lida no servidor.
 *
 * Regra do projeto (D6): o app lê **apenas** estas duas variáveis e **não cria nenhuma
 * `NEXT_PUBLIC_*` nova**. A URL e a chave anon são públicas por definição — a chave anon não
 * acessa nada de outro usuário sem o RLS, que já está no banco. `GEMINI_API_KEY` e a service
 * role key são secrets do Supabase e nunca aparecem no ambiente do Next.
 *
 * Este módulo é o **único** lugar do servidor que lê `process.env` para configuração: ler
 * `process.env` inline em cada componente espalha o `undefined` não tratado e duplica a
 * mensagem de erro em N lugares (decisão D4).
 */

/** Nomes das variáveis de ambiente que o app consome. Nenhuma outra é lida. */
export const VARIAVEIS_SUPABASE = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

/**
 * Allowlist de e-mails autorizados a usar o app (Fase 3, decisão D4).
 *
 * É variável de **servidor** e não `NEXT_PUBLIC_*`: a lista autorizada é um segredo do dono
 * do app, não um dado público. Ela é comparada com `trim` + `toLowerCase`, porque e-mail é
 * case-insensitive na prática e um e-mail autorizado em maiúsculas seria barrado por erro
 * do usuário.
 */
export const VARIAVEL_ALLOWED_EMAILS = 'ALLOWED_EMAILS' as const;

/** Arquivo onde essas variáveis devem estar declaradas em desenvolvimento. */
export const ARQUIVO_AMBIENTE_LOCAL = '.env.local';

const configuracaoSupabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1, 'valor vazio'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'valor vazio'),
});

export type ConfiguracaoSupabase = z.infer<typeof configuracaoSupabaseSchema>;

/**
 * Monta a mensagem de configuração ausente.
 *
 * Carrega só os *nomes* das variáveis que faltam — nunca o valor de nenhuma delas. A mensagem
 * é a informação que o desenvolvedor precisa; um valor de segredo no texto de erro acabaria
 * em log, em issue e em print de terminal.
 */
function mensagemConfiguracaoAusente(variaveisAusentes: readonly string[]): string {
  const lista = variaveisAusentes.join(', ');
  return (
    `Configuração do Supabase ausente no servidor: ${lista}. ` +
    `Declare ${variaveisAusentes.length === 1 ? 'a variável' : 'as variáveis'} ` +
    `${lista} no arquivo ${ARQUIVO_AMBIENTE_LOCAL}, na raiz do projeto ` +
    `(copie .env.example como base).`
  );
}

/**
 * Erro de configuração ausente, com mensagem já pronta para o terminal.
 *
 * Carrega só os *nomes* das variáveis que faltam — nunca o valor de nenhuma delas.
 */
export class ErroConfiguracaoSupabase extends Error {
  readonly variaveisAusentes: readonly string[];

  constructor(variaveisAusentes: readonly string[]) {
    super(mensagemConfiguracaoAusente(variaveisAusentes));
    this.name = 'ErroConfiguracaoSupabase';
    this.variaveisAusentes = variaveisAusentes;
  }
}

/**
 * Erro de allowlist ausente ou vazia.
 *
 * Mesmo formato de `ErroConfiguracaoSupabase` — mesma origem (`.env.local`), mesma
 * proibição de carregar valor — para que a falha tenha a mesma leitura no terminal.
 */
export class ErroConfiguracaoAllowlist extends Error {
  constructor() {
    super(mensagemConfiguracaoAusente([VARIAVEL_ALLOWED_EMAILS]));
    this.name = 'ErroConfiguracaoAllowlist';
  }
}

/**
 * Lê e valida a configuração do Supabase.
 *
 * Lê de forma **preguiçosa** (dentro da função, não no import) para que a ausência das
 * variáveis não derrube a verificação de tipos nem a coleta dos testes, e para que a falha
 * aconteça no momento em que a configuração é realmente usada.
 *
 * @throws {ErroConfiguracaoSupabase} quando alguma variável está ausente ou vazia.
 */
export function lerConfiguracaoSupabase(
  env: Record<string, string | undefined> = process.env,
): ConfiguracaoSupabase {
  const ausentes: string[] = [];

  for (const variavel of VARIAVEIS_SUPABASE) {
    const valor = env[variavel];
    if (valor === undefined || valor.trim() === '') {
      ausentes.push(variavel);
    }
  }

  if (ausentes.length > 0) {
    throw new ErroConfiguracaoSupabase(ausentes);
  }

  return configuracaoSupabaseSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/**
 * Lê a allowlist de e-mails autorizados do ambiente do servidor.
 *
 * Separada de `lerConfiguracaoSupabase` porque a lista não é configuração do Supabase: é
 * política de acesso do app, e as duas leituras não compartilham os mesmos testes nem a mesma
 * obrigação de estar presentes. Ainda assim é lida **aqui**, e não em outro módulo, para
 * conservar a regra de que este arquivo é o único lugar do servidor que toca `process.env`.
 *
 * Lê de forma preguiçosa, como a configuração do Supabase, para que a ausência da variável não
 * derrube a verificação de tipos nem a coleta dos testes.
 *
 * A lista é normalizada (`trim` + `toLowerCase`) e deduplicada na volta: a comparação é feita
 * sempre contra a forma canônica, e `a@x.com, A@X.com` é a mesma entrada duas vezes.
 *
 * @throws {ErroConfiguracaoAllowlist} quando a variável está ausente, vazia ou não tem
 * nenhuma entrada aproveitável. Nunca há fallback: sem allowlist o acesso é negado, e código
 * que degrada para "permitir todos" seria uma falha de segurança silenciosa.
 */
export function lerAllowlistDoServidor(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const bruta = env[VARIAVEL_ALLOWED_EMAILS];

  if (bruta === undefined || bruta.trim() === '') {
    throw new ErroConfiguracaoAllowlist();
  }

  const lista = bruta
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

  if (lista.length === 0) {
    throw new ErroConfiguracaoAllowlist();
  }

  return [...new Set(lista)];
}
