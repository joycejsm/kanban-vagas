/**
 * Tradução das respostas de erro da Edge Function para o vocabulário da interface.
 *
 * Este é o **único** lugar do Next.js que conhece os status HTTP da ingestão. Se cada action
 * traduzisse por conta própria, a mesma falha receberia palavras diferentes dependendo de
 * quem a traduziu.
 *
 * A interface decide o que fazer a partir de `code`, não da mensagem: `extracao_falhou`
 * abre o campo de texto colado, `limite_uso` sugere esperar, `sessao_expirada` manda para o
 * login. A `mensagem` é para o olho da pessoa, e por isso é uma string fechada em pt-BR.
 */

/** Código que a interface usa para decidir o que fazer. */
export type CodigoErroIngestao =
  | 'duplicada'
  | 'extracao_falhou'
  | 'limite_uso'
  | 'sessao_expirada'
  | 'erro';

/** Retorno de falha de uma action de ingestão. Espelha o `{ ok, ... }` de D5. */
export interface FalhaIngestao {
  ok: false;
  code: CodigoErroIngestao;
  mensagem: string;
}

/**
 * Mensagens por código. Escritas uma vez e reutilizadas.
 *
 * A ausência de um `default` no objeto é intencional: `mapearErroIngestao` indexa por
 * código, e um código novo sem mensagem aqui é erro de typecheck, não um `undefined`
 * silencioso chegando na tela.
 */
const MENSAGENS: Record<CodigoErroIngestao, string> = {
  duplicada: 'Você já cadastrou esta vaga.',
  extracao_falhou:
    'Não consegui extrair os dados da vaga. Cole o texto do anúncio para eu tentar de novo.',
  limite_uso: 'Limite de ingestões atingido. Tente novamente mais tarde.',
  sessao_expirada: 'Sua sessão expirou. Entre novamente.',
  erro: 'Não foi possível concluir a operação. Tente novamente.',
};

/**
 * Status HTTP → código de decisão.
 *
 * 422 e 413 caem no mesmo código porque são a mesma coisa do ponto de vista de quem está na
 * tela: não deu para extrair, e a saída é pedir o texto colado. A Edge Function já tem
 * mensagens próprias para cada um; aqui o que importa é que a interface saiba o que oferecer.
 */
const CODIGO_POR_STATUS: Record<number, CodigoErroIngestao> = {
  401: 'sessao_expirada',
  403: 'sessao_expirada',
  409: 'duplicada',
  413: 'extracao_falhou',
  422: 'extracao_falhou',
  429: 'limite_uso',
};

/**
 * Traduz a resposta de erro da Edge Function.
 *
 * `corpo` entra **só** para o log do servidor. Ele nunca alimenta a `mensagem`: o corpo da
 * função é escrito por código que este projeto não controla (a resposta do LLM, o HTML
 * extraído, a mensagem do Postgres) e concatená-lo na mensagem devolveria ao navegador
 * exatamente o detalhe interno que as invariantes 6 e 8 proíbem (design D5).
 *
 * Status fora do mapa — 5xx, 405, 418, qualquer coisa inesperada — vira `erro`, nunca uma
 * exceção. Uma action que lança mostra a tela de erro genérica do Next em produção, que é
 * pior do que uma mensagem genérica e controlável.
 *
 * @param status Status HTTP da resposta da Edge Function.
 * @param corpo Corpo já parseado, se houver. Usado apenas no log.
 */
export function mapearErroIngestao(status: number, corpo?: unknown): FalhaIngestao {
  // Tudo que não está no mapa cai em `erro`, 5xx ou não. A distinção entre "a função
  // quebrou" e "a função respondeu algo que não previa" é interessante no log e
  // irrelevante para quem está na tela: nos dois casos, só há uma coisa a fazer.
  const code = CODIGO_POR_STATUS[status] ?? 'erro';

  // O código que a função reportou fica no log, nunca na resposta. É o que permite
  // depurar um 422 sem precisar abrir o isolate e ler o que deu lá dentro.
  const codigoDaFuncao = extrairCodigoDoCorpo(corpo);
  console.error(
    '[acoes/erros] status=%d code=%s code_funcao=%s',
    status,
    code,
    codigoDaFuncao ?? 'desconhecido',
  );

  return { ok: false, code, mensagem: MENSAGENS[code] };
}

/** Lê só o campo `code` do corpo, e só se ele for string. Qualquer outra forma é ignorada. */
function extrairCodigoDoCorpo(corpo: unknown): string | undefined {
  if (typeof corpo === 'object' && corpo !== null && 'code' in corpo) {
    const { code } = corpo as { code?: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Falha de sessão, que não vem da Edge Function e por isso tem o seu próprio caminho. */
export function falhaDeSessao(): FalhaIngestao {
  return { ok: false, code: 'sessao_expirada', mensagem: MENSAGENS.sessao_expirada };
}

/** Falha de validação da entrada: o `FormData` não passou no schema. */
export function falhaDeEntrada(mensagem: string): FalhaIngestao {
  return { ok: false, code: 'erro', mensagem };
}

export { MENSAGENS };
