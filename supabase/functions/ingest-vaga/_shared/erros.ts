/**
 * Erros do pipeline, com o status HTTP e o código já decididos em um único lugar.
 *
 * `message` é sempre uma string fechada em pt-BR: o corpo devolvido ao cliente
 * nunca carrega detalhe do banco, do modelo ou do HTML (invariante 8). O detalhe
 * original segue em `detalhe`, que só vai para o log interno (invariante 9).
 */

export interface ErroPipeline {
  status: number;
  code: string;
  message: string;
  /** Etapa do pipeline em que parou, usada apenas no log. */
  etapa: string;
  detalhe?: unknown;
}

export function erro(
  status: number,
  code: string,
  message: string,
  etapa: string,
  detalhe?: unknown,
): ErroPipeline {
  return { status, code, message, etapa, detalhe };
}

export const ERROS = {
  metodoNaoPermitido: () =>
    erro(405, 'metodo_nao_permitido', 'Método não permitido.', 'cors'),

  origemNaoPermitida: () => erro(403, 'origem_nao_permitida', 'Origem não permitida.', 'cors'),

  corpoInvalido: () =>
    erro(
      422,
      'corpo_invalido',
      'Não consegui ler os dados enviados. Confira a URL e tente novamente.',
      'validacao_entrada',
    ),

  naoAutenticado: () =>
    erro(401, 'nao_autenticado', 'Sua sessão expirou. Entre novamente.', 'autenticacao'),

  naoAutorizado: () =>
    erro(403, 'nao_autorizado', 'Você não tem permissão para usar este recurso.', 'allowlist'),

  limiteDeUso: () =>
    erro(429, 'limite_de_uso', 'Limite de ingestões atingido. Tente novamente mais tarde.', 'rate_limit'),

  urlInvalida: () =>
    erro(
      422,
      'url_invalida',
      'Não consegui acessar essa URL. Use um link https de uma página de vaga.',
      'validacao_url',
    ),

  paginaInacessivel: () =>
    erro(
      502,
      'pagina_inacessivel',
      'Não consegui baixar a página. Tente novamente ou cole o texto da vaga.',
      'fetch',
    ),

  paginaGrandeDemais: () =>
    erro(
      413,
      'pagina_grande',
      'A página é grande demais para processar. Cole o texto da vaga.',
      'fetch',
    ),

  tipoNaoSuportado: () =>
    erro(422, 'tipo_nao_suportado', 'O link não aponta para uma página HTML.', 'fetch'),

  extracaoInsuficiente: () =>
    erro(
      422,
      'extracao_insuficiente',
      'Não consegui extrair os dados da vaga. Cole o texto da anúncio para eu tentar de novo.',
      'extracao',
    ),

  duplicada: () => erro(409, 'vaga_duplicada', 'Você já cadastrou esta vaga.', 'persistencia'),

  erroGenerico: () =>
    erro(500, 'erro_interno', 'Não foi possível concluir a operação. Tente novamente.', 'pipeline'),
} as const;

export function erroDoHttp(status: number): ErroPipeline {
  if (status >= 500) return ERROS.erroGenerico();
  return ERROS.paginaInacessivel();
}
