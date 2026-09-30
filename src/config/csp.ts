// Import com extensão explícita porque este arquivo é carregado também pelo
// `next.config.ts`, que o Next compila em CommonJS e resolve sem o alias `@/` nem a
// extensão implícita. Dentro do app os dois formatos valeriam; aqui só o explícito resolve.
import { lerConfiguracaoSupabase, type ConfiguracaoSupabase } from './serverEnv.ts';

/**
 * Content Security Policy da aplicação (design D9, revisado).
 *
 * A política é montada a partir da configuração do servidor, e não escrita como string fixa.
 * O único valor que muda por ambiente é a origem do Supabase, e escrevê-la no repositório
 * resolveria de duas formas erradas: no dev, a CSP apontaria para o domínio de produção, e na
 * produção apontaria para o errado até alguém lembrar de editar.
 *
 * ## Por que nonce, e não `script-src 'self'` puro
 *
 * A primeira versão desta política usava `script-src 'self'` e **quebrava a aplicação**. O
 * App Router do Next sempre emite script inline — no mínimo `(self.__next_f=…).push([0])` e o
 * *flight payload* do RSC — e `script-src 'self'` sem `'unsafe-inline'`, hash ou nonce os
 * bloqueia. O sintoma não era sutil: a página ficava sem JavaScript, e o runtime do Next nem
 * subia (`InvariantError: Expected a request ID … via self.__next_r`), porque o script que
 * define esse objeto era justamente um dos bloqueados.
 *
 * Hash estático não resolve: o *flight payload* muda a cada requisição, então não há um
 * conjunto fixo de hashes para listar. `'unsafe-inline'` resolveria e custaria exatamente a
 * proteção que a diretiva existe para dar — e o spec `security-headers` proíbe explicitamente
 * a palavra. Sobra o nonce: um valor aleatório por resposta, ecoado no atributo `nonce` dos
 * scripts do Next, que bloqueia script inline injetado e ainda permite os do próprio
 * framework.
 *
 * O nonce é **obrigatório** nesta função, e não opcional. Deixá-lo opcional recriaria
 * exatamente o bug acima na primeira chamada que o esquecesse, e o modo de falha — uma página
 * silenciosamente sem JavaScript — é dos mais difíceis de identificar depois.
 *
 * ## Por que `'unsafe-eval'` volta só em desenvolvimento
 *
 * O build de desenvolvimento do React chama `eval()` para reconstruir call stacks quando o
 * erro vem de outro contexto. Sem a diretiva, o app levanta
 * `eval() is not supported in this environment` e o runtime de cliente não sobe. O build de
 * produção nunca usa `eval()`, então lá a diretiva continua fora — que é o que o D9 prometeu e
 * o que o spec exige.
 *
 * A consequência é que a política **não é idêntica** entre dev e produção, e isso é
 * intencional: a diferença cobre um requisito do bundle de desenvolvimento, não uma
 * concessão de segurança em produção.
 *
 * `connect-src`, `img-src`, `object-src`, `base-uri` e `frame-ancestors` seguem independentes
 * do nonce e continuam valendo.
 */

/** Origens do Google que o navegador legitimately alcança durante o login OAuth. */
const ORIGENS_DE_AUTENTICACAO_GOOGLE = [
  'https://accounts.google.com',
  'https://apis.google.com',
] as const;

/** Origens de imagem autorizadas: a própria, dados embutidos e o avatar do Google. */
const ORIGENS_DE_IMAGEM = ["'self'", 'data:', 'lh3.googleusercontent.com'] as const;

/**
 * Monta a política completa.
 *
 * As diretivas são uma lista de pares, montada aqui e unida em seguida, para que a ordem da
 * política e a ordem deste arquivo sejam a mesma coisa — a diferença só apareceria ao
 * revisar um diff.
 *
 * @param config Configuração do servidor, lida de `serverEnv` e nunca de `process.env` aqui.
 * @param nonce Valor aleatório por resposta, echoed no atributo `nonce` dos scripts do Next.
 * @param ambiente `NODE_ENV`. Em desenvolvimento a política inclui `'unsafe-eval'`, de que o
 *   build de desenvolvimento do React precisa; em produção, nunca.
 */
export function montarCsp(
  config: ConfiguracaoSupabase,
  nonce: string,
  ambiente: string | undefined = process.env.NODE_ENV,
): string {
  const origemSupabase = new URL(config.NEXT_PUBLIC_SUPABASE_URL).origin;
  const emProducao = ambiente === 'production';

  const diretivas: readonly string[] = [
    `default-src 'self'`,
    // `'self'` cobre os chunks externos; o nonce cobre o inline do framework.
    // `'unsafe-inline'` nunca entra. `'unsafe-eval'` entra só fora de produção, porque é o
    // que o runtime de desenvolvimento do React usa para reconstruir call stacks.
    `script-src 'self' 'nonce-${nonce}'${emProducao ? '' : " 'unsafe-eval'"}`,
    `connect-src 'self' ${origemSupabase} ${ORIGENS_DE_AUTENTICACAO_GOOGLE.join(' ')}`,
    `img-src ${ORIGENS_DE_IMAGEM.join(' ')}`,
    `font-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
  ];

  return diretivas.join('; ');
}

/**
 * Cabeçalhos de hardening acompanhando a CSP.
 *
 * `X-Frame-Options` é redundante com `frame-ancestors 'none'` em qualquer navegador
 * moderno, e fica mesmo assim porque há clientes que não aplicam CSP — a defesa vale mais
 * para o navegador antigo do que para o cenário ideal.
 */
export const CABECALHOS_DE_HARDENING: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

/** Cabeçalho que o Next lê para descobrir o nonce e aplicá-lo aos scripts dele. */
export const CABECALHO_CSP = 'Content-Security-Policy';

/** Cabeçalho auxiliar que carrega o nonce para o resto da pilha. */
export const CABECALHO_NONCE = 'x-nonce';

/** Gera o nonce da resposta. `randomUUID` casa com a regex que o Next usa para extraí-lo. */
export function gerarNonce(): string {
  return crypto.randomUUID();
}

/** Lê a configuração do servidor para a CSP. Em desenvolvimento, a ausência de env é erro. */
export function configuracaoParaCsp(
  env: Record<string, string | undefined> = process.env,
): ConfiguracaoSupabase {
  return lerConfiguracaoSupabase(env);
}
