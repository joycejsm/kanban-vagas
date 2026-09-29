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

/** Arquivo onde essas variáveis devem estar declaradas em desenvolvimento. */
export const ARQUIVO_AMBIENTE_LOCAL = '.env.local';

const configuracaoSupabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1, 'valor vazio'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'valor vazio'),
});

export type ConfiguracaoSupabase = z.infer<typeof configuracaoSupabaseSchema>;

/**
 * Erro de configuração ausente, com mensagem já pronta para o terminal.
 *
 * Carrega só os *nomes* das variáveis que faltam — nunca o valor de nenhuma delas. A mensagem
 * é a informação que o desenvolvedor precisa; um valor de segredo no texto de erro acabaria
 * em log, em issue e em print de terminal.
 */
export class ErroConfiguracaoSupabase extends Error {
  readonly variaveisAusentes: readonly string[];

  constructor(variaveisAusentes: readonly string[]) {
    const lista = variaveisAusentes.join(', ');
    super(
      `Configuração do Supabase ausente no servidor: ${lista}. ` +
        `Declare ${variaveisAusentes.length === 1 ? 'a variável' : 'as variáveis'} ` +
        `${lista} no arquivo ${ARQUIVO_AMBIENTE_LOCAL}, na raiz do projeto ` +
        `(copie .env.example como base).`,
    );
    this.name = 'ErroConfiguracaoSupabase';
    this.variaveisAusentes = variaveisAusentes;
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
