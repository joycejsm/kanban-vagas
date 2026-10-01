/**
 * Pipeline da Edge Function `ingest-vaga`.
 *
 * Cada etapa é `(entrada, deps) => Resultado | ErroPipeline`, e o handler principal
 * percorre a sequência parando na primeira falha. Assim o `code` devolvido é sempre
 * o da etapa que realmente impediu o trabalho (design D1), e nenhum efeito colateral
 * acontece depois de um erro.
 */

import { vagaCreateInputSchema, type VagaCreateInput, type VagaRow } from '@/domain/vaga';

import { lerEnvPadrao, normalizarEmail, origemPermitida, type EnvConfig } from './env.ts';
import { corpoIngestaoSchema, type CorpoIngestao } from './entrada.ts';
import { ERROS, type ErroPipeline } from './erros.ts';
import { hostDaUrl, lerCorpo, respostaErroHttp, respostaJson, registrarFalha } from './http.ts';
import type { Janelas } from './supabase.ts';

export const LIMITE_POR_HORA = 20;
export const LIMITE_POR_DIA = 100;

// ---------------------------------------------------------------------------
// Dependências injetáveis
// ---------------------------------------------------------------------------

export interface Dependencias {
  config: EnvConfig;
  /** Valida o token e devolve o usuário. Nunca lança: devolve `null`. */
  autenticar: (token: string | null) => Promise<UsuarioAutenticado | null>;
  /** Registra a tentativa e devolve o `id` da linha criada. */
  registrarTentativa: (host: string) => Promise<{ id: string }>;
  /** Conta as janelas já com o registro corrente incluído. */
  contarJanelas: () => Promise<Janelas>;
  /** Busca a página aplicando todas as regras de URL e de fetch. */
  buscar: (url: string) => Promise<string>;
  /** Extrai os campos da vaga a partir do HTML (ou do texto colado). */
  extrair: (conteudo: string, url: string) => Promise<unknown>;
  /** Insere a vaga com o cliente do usuário. */
  inserir: (dados: VagaCreateInput, usuarioId: string) => Promise<VagaRow>;
  /** Atualiza o desfecho no registro da tentativa, dizendo se gravou. */
  marcarDesfecho: (id: string, resultado: ResultadoAuditoria) => Promise<{ gravado: boolean }>;
  /** Dependências do módulo de segurança, injetadas para teste. */
  url: typeof import('./urlSafety.ts');
}

/** Desfecho possível de uma tentativa registrada. */
export type ResultadoAuditoria = 'sucesso' | 'duplicada' | 'erro';

/** Registro de auditoria aberto por esta requisição. */
export interface AuditoriaAberta {
  id: string;
}

export interface UsuarioAutenticado {
  id: string;
  email: string | null;
}

export type Resultado =
  | { ok: true; vaga: VagaRow }
  | { ok: false; falha: ErroPipeline };

// ---------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------

/**
 * CORS + método. A origem precisa ser exatamente `APP_ORIGIN`; qualquer outra é
 * recusada antes de ler o corpo.
 */
export function etapaCors(requisicao: Request, config: EnvConfig): ErroPipeline | null {
  const origem = requisicao.headers.get('Origin');

  if (requisicao.method === 'OPTIONS') {
    return origemPermitida(origem, config.appOrigin) ? null : ERROS.origemNaoPermitida();
  }

  if (requisicao.method !== 'POST') {
    return ERROS.metodoNaoPermitido();
  }

  return origemPermitida(origem, config.appOrigin) ? null : ERROS.origemNaoPermitida();
}

/** Autenticação: sem sessão válida, `401`. Confia no token, nunca no corpo. */
export async function etapaAutenticacao(
  requisicao: Request,
  deps: Dependencias,
): Promise<{ ok: true; usuario: UsuarioAutenticado } | { ok: false; falha: ErroPipeline }> {
  const token = extrairToken(requisicao.headers.get('Authorization'));
  if (!token) {
    return { ok: false, falha: ERROS.naoAutenticado() };
  }

  const usuario = await deps.autenticar(token);
  if (!usuario) {
    return { ok: false, falha: ERROS.naoAutenticado() };
  }

  return { ok: true, usuario };
}

/** Allowlist: e-mail precisa estar em `ALLOWED_EMAILS`, comparado sem caixa nem espaços. */
export function etapaAllowlist(
  usuario: UsuarioAutenticado,
  config: EnvConfig,
): ErroPipeline | null {
  const email = usuario.email ? normalizarEmail(usuario.email) : '';
  return config.allowedEmails.includes(email) ? null : ERROS.naoAutorizado();
}

/**
 * Rate limit. A tentativa já foi registrada e a contagem já inclui o registro
 * corrente, para que chamadas simultâneas não escapem (design D2).
 *
 * Recebe as janelas prontas e não lança: a contagem é uma etapa nomeada do
 * pipeline, com resposta e log próprios, e não um erro inesperado.
 */
export function etapaRateLimit(janela: Janelas): ErroPipeline | null {
  if (janela.hora > LIMITE_POR_HORA || janela.dia > LIMITE_POR_DIA) {
    return ERROS.limiteDeUso();
  }

  return null;
}

/**
 * Validação e busca da URL. O módulo de segurança é injetado, mas o handler usa
 * sempre `deps.url.validarUrl` — a mesma função que revalida cada redirect.
 */
export async function etapaConteudo(
  dados: CorpoIngestao,
  deps: Dependencias,
): Promise<{ ok: true; conteudo: string } | { ok: false; falha: ErroPipeline }> {
  const validacao = await deps.url.validarUrl(dados.url);
  if (!validacao.ok) {
    return { ok: false, falha: ERROS.urlInvalida() };
  }

  try {
    // `texto` colado pelo usuário dispensa o scraping: a URL segue válida e
    // normalizada, mas não é buscada.
    const conteudo = dados.texto ? dados.texto : await deps.buscar(validacao.url);
    return { ok: true, conteudo };
  } catch (erro) {
    return { ok: false, falha: erro instanceof Error && erro.name === 'PaginaGrandeDemaisError'
      ? ERROS.paginaGrandeDemais()
      : ERROS.paginaInacessivel() };
  }
}

/** Extração e validação pelo schema do domínio. A URL persistida é a da requisição. */
export async function etapaExtracao(
  conteudo: string,
  url: string,
  deps: Dependencias,
): Promise<{ ok: true; dados: VagaCreateInput } | { ok: false; falha: ErroPipeline }> {
  let bruto: unknown;
  try {
    bruto = await deps.extrair(conteudo, url);
  } catch (erro) {
    return { ok: false, falha: { ...ERROS.extracaoInsuficiente(), detalhe: erro } };
  }

  // A URL nunca vem do modelo: é a da requisição, já validada.
  const candidato = { ...(bruto as Record<string, unknown>), url };
  const validado = vagaCreateInputSchema.safeParse(candidato);

  if (!validado.success) {
    return { ok: false, falha: ERROS.extracaoInsuficiente() };
  }

  return { ok: true, dados: validado.data };
}

/** Persistência com o cliente do usuário. `23505` vira `409`. */
export async function etapaPersistencia(
  dados: VagaCreateInput,
  usuario: UsuarioAutenticado,
  deps: Dependencias,
): Promise<{ ok: true; vaga: VagaRow } | { ok: false; falha: ErroPipeline }> {
  try {
    const vaga = await deps.inserir(dados, usuario.id);
    return { ok: true, vaga };
  } catch (erro) {
    const codigo = sqlstate(erro);
    if (codigo === '23505') {
      return { ok: false, falha: ERROS.duplicada() };
    }
    // A etapa no log precisa dizer onde parou, não apenas "pipeline".
    return {
      ok: false,
      falha: { ...ERROS.erroGenerico(), etapa: 'persistencia', detalhe: erro },
    };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Executa o pipeline completo. `deps.config` e `deps.url` vêm da composição de
 * `index.ts`; os testes montam as suas versões.
 */
export async function executarPipeline(
  requisicao: Request,
  deps: Dependencias,
): Promise<Response> {
  const inicio = Date.now();
  const origem = requisicao.headers.get('Origin');

  let host = 'desconhecido';
  let usuario: UsuarioAutenticado | null = null;
  // O registro de auditoria é criado na etapa 5 e o desfecho é gravado uma vez, no
  // fim. A variável existe para que uma falha *depois* do registro — inclusive a
  // própria contagem de janela — ainda feche a linha, em vez de deixá-la pendente.
  let auditoria: AuditoriaAberta | null = null;

  try {
    // 1. CORS e método
    const falhaCors = etapaCors(requisicao, deps.config);
    if (falhaCors) return responderErro(falhaCors, deps, inicio, host, usuario, null, undefined, origem);

    // 2. Autenticação
    const auth = await etapaAutenticacao(requisicao, deps);
    if (!auth.ok) return responderErro(auth.falha, deps, inicio, host, null, null, undefined, origem);
    usuario = auth.usuario;

    // 3. Allowlist
    const falhaAllowlist = etapaAllowlist(usuario, deps.config);
    if (falhaAllowlist) return responderErro(falhaAllowlist, deps, inicio, host, usuario, null, undefined, origem);

    // 4. Corpo
    const corpo = await lerCorpo(requisicao);
    if (!corpo.ok) return responderErro(corpo.falha, deps, inicio, host, usuario, null, undefined, origem);

    host = hostDaUrl(corpo.dados.url);

    // 5. Auditoria e rate limit — antes de qualquer trabalho caro.
    //    Isolados do `catch` geral porque a auditoria tem dois estados distintos
    //    que o código precisa distinguir: registro que não aconteceu (nenhuma
    //    linha para fechar) e registro que aconteceu, com a contagem recusada
    //    pelo banco (linha existe e precisa ser fechada).
    let janela: Janelas;
    try {
      auditoria = await deps.registrarTentativa(host);
      janela = await deps.contarJanelas();
    } catch (erro) {
      return responderErro(
        { ...ERROS.erroGenerico(), etapa: 'auditoria' },
        deps,
        inicio,
        host,
        usuario,
        auditoria,
        erro,
        origem,
      );
    }

    const falhaLimite = etapaRateLimit(janela);
    if (falhaLimite) return responderErro(falhaLimite, deps, inicio, host, usuario, auditoria, undefined, origem);

    // 6. Conteúdo (URL + fetch)
    const conteudo = await etapaConteudo(corpo.dados, deps);
    if (!conteudo.ok) return responderErro(conteudo.falha, deps, inicio, host, usuario, auditoria, undefined, origem);

    // 7. Extração + validação
    const extracao = await etapaExtracao(conteudo.conteudo, corpo.dados.url, deps);
    if (!extracao.ok) return responderErro(extracao.falha, deps, inicio, host, usuario, auditoria, undefined, origem);

    // 8. Persistência
    const persistencia = await etapaPersistencia(extracao.dados, usuario, deps);
    if (!persistencia.ok) return responderErro(persistencia.falha, deps, inicio, host, usuario, auditoria, undefined, origem);

    await fecharAuditoria(deps, auditoria, 'sucesso', usuario);
    console.info(
      '[ingest-vaga] etapa=sucesso host=%s duracao_ms=%d usuario=%s',
      host,
      Date.now() - inicio,
      usuarioTruncado(usuario.id),
    );

    return respostaJson({ vaga: persistencia.vaga }, 201, origem);
  } catch (erro) {
    return responderErro(ERROS.erroGenerico(), deps, inicio, host, usuario, auditoria, erro, origem);
  }
}

async function responderErro(
  falha: ErroPipeline,
  deps: Dependencias,
  inicio: number,
  host: string,
  usuario: UsuarioAutenticado | null,
  auditoria: AuditoriaAberta | null,
  causa?: unknown,
  origem: string | null = null,
): Promise<Response> {
  registrarFalha(causa === undefined ? falha : { ...falha, detalhe: causa }, {
    host,
    duracaoMs: Date.now() - inicio,
    usuario: usuario ? usuarioTruncado(usuario.id) : null,
    origem,
    appOrigin: deps.config.appOrigin,
  });
  // Só grava desfecho se o registro da tentativa chegou a existir; falhas anteriores
  // (CORS, auth, allowlist, corpo) acontecem antes da auditoria existir.
  await fecharAuditoria(
    deps,
    auditoria,
    falha.code === 'vaga_duplicada' ? 'duplicada' : 'erro',
    usuario,
  );

  return respostaErroHttp(falha, deps.config.appOrigin);
}

/**
 * Fecha o registro da tentativa.
 *
 * Falha aqui nunca derruba a resposta que o usuário recebe — a auditoria é
 * acessória. Mas ela deixa de ser **invisível**: era neste ponto, silencioso por
 * decisão, que a informação valia mais, e é por isso que a linha pode ter ficado
 * `pendente` sem nenhuma pista. O efeito continua silencioso; o registro, não.
 */
async function fecharAuditoria(
  deps: Dependencias,
  auditoria: AuditoriaAberta | null,
  resultado: ResultadoAuditoria,
  usuario: UsuarioAutenticado | null,
): Promise<void> {
  if (!auditoria) return;

  const quem = usuario ? usuarioTruncado(usuario.id) : 'desconhecido';

  try {
    const { gravado } = await deps.marcarDesfecho(auditoria.id, resultado);
    if (!gravado) {
      console.error(
        '[ingest-vaga] etapa=auditoria codigo=desfecho-nao-encontrado usuario=%s',
        quem,
      );
    }
  } catch (erro) {
    console.error(
      '[ingest-vaga] etapa=auditoria codigo=%s usuario=%s',
      sqlstate(erro) ?? 'falha-desconhecida',
      quem,
    );
  }
}

/** `Bearer <token>` ou o token cru. Nenhum outro formato é aceito. */
export function extrairToken(cabecalho: string | null): string | null {
  if (!cabecalho) return null;

  const partes = cabecalho.split(' ');
  if (partes.length === 2 && partes[0]?.toLowerCase() === 'bearer') {
    return partes[1] ?? null;
  }

  return null;
}

/** Identificador de usuário nunca aparece inteiro no log. */
export function usuarioTruncado(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}...`;
}

function sqlstate(erro: unknown): string | undefined {
  if (typeof erro === 'object' && erro !== null && 'code' in erro) {
    const { code } = erro as { code?: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export { lerEnvPadrao, corpoIngestaoSchema, type CorpoIngestao };
export type { VagaRow, VagaCreateInput };
