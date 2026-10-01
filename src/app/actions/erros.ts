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
  | 'nao_autorizado'
  | 'origem_nao_permitida'
  | 'erro';

/**
 * Mensagens das actions do quadro, que **não** vêm da Edge Function.
 *
 * `MENSAGENS` acima é o vocabulário da ingestão: cada entrada corresponde a um status HTTP da
 * função. Estas são as das actions que falam com o Postgres — `atualizarStatus` e `removerVaga` —
 * e por isso vivem em um conjunto separado, com a mesma disciplina: conjunto fechado, escrito uma
 * vez e comparado por teste.
 *
 * Elas não entram em `MENSAGENS` porque não são erros de ingestão. Misturar os dois vocabulários
 * faria o leitor procurar um status HTTP por trás de "Vaga não encontrada.", que não tem nenhum —
 * e faria `MENSAGENS` crescer com frases que nenhum `mapearErroIngestao` pode devolver.
 *
 * `naoEncontrada` é compartilhada pelas duas actions **de propósito**: confirmar que um
 * identificador alheio existe é um oráculo de enumeração, e a defesa é que as duas digam
 * exatamente a mesma frase (design D7).
 */
export const MENSAGENS_DO_QUADRO = {
  naoEncontrada: 'Vaga não encontrada.',
  moverFalhou: 'Não foi possível mover a vaga. Tente novamente.',
  removerFalhou: 'Não foi possível remover a vaga. Tente novamente.',
} as const;

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
 *
 * `nao_autorizado` e `origem_nao_permitida` existem para separar duas recusas que antes
 * apareciam como "sua sessão expirou". Mandar alguém refazer o login diante de nenhuma das
 * duas resolve nada, e a ambiguidade custou um diagnóstico errado: o `403` de origem foi lido
 * como token vencido com a sessão válida.
 *
 * A de `nao_autorizado` não diz se o endereço está na allowlist — seria responder a uma
 * sondagem sobre a lista. O que muda é a ação indicada, não o que se revela: nos dois casos a
 * resposta é falar com quem administra o acesso.
 */
const MENSAGENS: Record<CodigoErroIngestao, string> = {
  duplicada: 'Você já cadastrou esta vaga.',
  extracao_falhou:
    'Não consegui extrair os dados da vaga. Cole o texto do anúncio para eu tentar de novo.',
  limite_uso: 'Limite de ingestões atingido. Tente novamente mais tarde.',
  sessao_expirada: 'Sua sessão expirou. Entre novamente.',
  nao_autorizado: 'Você não tem permissão para adicionar vagas neste aplicativo.',
  origem_nao_permitida: 'A origem do aplicativo não está autorizada.',
  erro: 'Não foi possível concluir a operação. Tente novamente.',
};

/**
 * Status HTTP → código de decisão, usado como **fallback**.
 *
 * O caminho primário é o campo `code` do corpo (ver `CODIGO_DA_FUNCAO`); esta tabela só entra
 * quando ele está ausente ou não é reconhecido — o que acontece durante o deploy, com o app
 * novo falando com a função antiga, ou diante de uma resposta inesperada.
 *
 * 422 e 413 caem no mesmo código porque são a mesma coisa do ponto de vista de quem está na
 * tela: não deu para extrair, e a saída é pedir o texto colado. A Edge Function já tem
 * mensagens próprias para cada um; aqui o que importa é que a interface saiba o que oferecer.
 *
 * `403` continua mapeado para `sessao_expirada` aqui, e é o fallback que ele tem de ser: a
 * função usa o mesmo status para e-mail fora da allowlist e para origem não permitida, e é
 * por isso que o `code` precisa ser lido antes. Com `code` presente, nenhum `403` chega aqui.
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
 * `code` que a Edge Function devolve → código de decisão da interface.
 *
 * A função responde `{"code": ..., "message": ...}` e o spec dela diz que esse `code` "identifica
 * a categoria do erro para o cliente agir". A correspondência abaixo é o que concretiza isso:
 * sem ela, o campo era extraído, ia para o log e era descartado, e a decisão vinha do status
 * sozinho — o que achatava "e-mail fora da allowlist" e "origem não permitida" na mesma
 * mensagem de sessão expirada, apesar de serem causas sem nada em comum.
 *
 * Só entram códigos cujo significado coincide com o do lado do Next. Um código da função que
 * aqui não mapeia não é erro: é o caso do fallback por status, e é assim que a troca de
 * versão no deploy não deixa a tela sem mensagem.
 */
const CODIGO_DA_FUNCAO: Record<string, CodigoErroIngestao> = {
  nao_autenticado: 'sessao_expirada',
  nao_autorizado: 'nao_autorizado',
  origem_nao_permitida: 'origem_nao_permitida',
  vaga_duplicada: 'duplicada',
  limite_de_uso: 'limite_uso',
  extracao_insuficiente: 'extracao_falhou',
  corpo_invalido: 'extracao_falhou',
  url_invalida: 'extracao_falhou',
  tipo_nao_suportado: 'extracao_falhou',
  pagina_grande: 'extracao_falhou',
  pagina_inacessivel: 'extracao_falhou',
  metodo_nao_permitido: 'erro',
  erro_interno: 'erro',
};

/**
 * Traduz a resposta de erro da Edge Function.
 *
 * `corpo` entra para a **decisão** pelo campo `code` e para o **log** — nunca para a `mensagem`.
 * A função escreve esse corpo em código que este projeto não controla (a resposta do LLM, o
 * HTML extraído, a mensagem do Postgres), e concatená-lo na mensagem devolveria ao navegador
 * exatamente o detalhe interno que as invariantes 6 e 8 proíbem (design D5). O que se aproveita
 * dele é o `code`, que é um identificador de catálogo, não conteúdo.
 *
 * A decisão sai do `code` quando ele é reconhecido, e do status quando não é. A ordem importa:
 * o status sozinho não distingue e-mail fora da allowlist de origem não permitida, porque a
 * função responde `403` para as duas coisas.
 *
 * Status fora do mapa — 5xx, 405, 418, qualquer coisa inesperada — vira `erro`, nunca uma
 * exceção. Uma action que lança mostra a tela de erro genérica do Next em produção, que é
 * pior do que uma mensagem genérica e controlável.
 *
 * @param status Status HTTP da resposta da Edge Function.
 * @param corpo Corpo já parseado, se houver. Lido pelo `code` e registrado no log.
 */
export function mapearErroIngestao(status: number, corpo?: unknown): FalhaIngestao {
  // O código que a função reportou vai para o log, e é também o que decide quando reconhecido.
  const codigoDaFuncao = extrairCodigoDoCorpo(corpo);

  // Tudo que não está no mapa cai em `erro`, 5xx ou não. A distinção entre "a função
  // quebrou" e "a função respondeu algo que não previa" é interessante no log e
  // irrelevante para quem está na tela: nos dois casos, só há uma coisa a fazer.
  const code =
    (codigoDaFuncao === undefined ? undefined : CODIGO_DA_FUNCAO[codigoDaFuncao]) ??
    CODIGO_POR_STATUS[status] ??
    'erro';

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
