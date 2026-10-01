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

export const LIMITE_POR_HORA = 20;
export const LIMITE_POR_DIA = 100;

// ---------------------------------------------------------------------------
// Dependências injetáveis
// ---------------------------------------------------------------------------

export interface Dependencias {
  config: EnvConfig;
  /** Valida o token e devolve o usuário. Nunca lança: devolve `null`. */
  autenticar: (token: string | null) => Promise<UsuarioAutenticado | null>;
  /** Registra a tentativa e conta as janelas. */
  registrarTentativa: (host: string) => Promise<{ hora: number; dia: number }>;
  /** Busca a página aplicando todas as regras de URL e de fetch. */
  buscar: (url: string) => Promise<string>;
  /** Extrai os campos da vaga a partir do HTML (ou do texto colado). */
  extrair: (conteudo: string, url: string) => Promise<unknown>;
  /** Insere a vaga com o cliente do usuário. */
  inserir: (dados: VagaCreateInput, usuarioId: string) => Promise<VagaRow>;
  /** Atualiza o desfecho registrado na auditoria. */
  marcarDesfecho: (resultado: 'sucesso' | 'duplicada' | 'erro') => Promise<void>;
  /** Dependências do módulo de segurança, injetadas para teste. */
  url: typeof import('./urlSafety.ts');
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
 * Rate limit. A tentativa é registrada antes da contagem e a contagem inclui o
 * próprio registro, para que chamadas simultâneas não escapem (design D2).
 */
export async function etapaRateLimit(
  deps: Dependencias,
  host: string,
): Promise<ErroPipeline | null> {
  const janela = await deps.registrarTentativa(host);

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
  // O desfecho da tentativa registrada só é gravado uma vez, aqui no final.
  let auditoriaAberta = false;

  try {
    // 1. CORS e método
    const falhaCors = etapaCors(requisicao, deps.config);
    if (falhaCors) return responderErro(falhaCors, deps, inicio, host, usuario, false, undefined, origem);

    // 2. Autenticação
    const auth = await etapaAutenticacao(requisicao, deps);
    if (!auth.ok) return responderErro(auth.falha, deps, inicio, host, null, false, undefined, origem);
    usuario = auth.usuario;

    // 3. Allowlist
    const falhaAllowlist = etapaAllowlist(usuario, deps.config);
    if (falhaAllowlist) return responderErro(falhaAllowlist, deps, inicio, host, usuario, false, undefined, origem);

    // 4. Corpo
    const corpo = await lerCorpo(requisicao);
    if (!corpo.ok) return responderErro(corpo.falha, deps, inicio, host, usuario, false, undefined, origem);

    host = hostDaUrl(corpo.dados.url);

    // 5. Rate limit — antes de qualquer trabalho caro
    const falhaLimite = await etapaRateLimit(deps, host);
    // A tentativa foi registrada, então o desfecho precisa ser gravado.
    auditoriaAberta = true;
    if (falhaLimite) return responderErro(falhaLimite, deps, inicio, host, usuario, true, undefined, origem);

    // 6. Conteúdo (URL + fetch)
    const conteudo = await etapaConteudo(corpo.dados, deps);
    if (!conteudo.ok) return responderErro(conteudo.falha, deps, inicio, host, usuario, auditoriaAberta, undefined, origem);

    // 7. Extração + validação
    const extracao = await etapaExtracao(conteudo.conteudo, corpo.dados.url, deps);
    if (!extracao.ok) return responderErro(extracao.falha, deps, inicio, host, usuario, auditoriaAberta, undefined, origem);

    // 8. Persistência
    const persistencia = await etapaPersistencia(extracao.dados, usuario, deps);
    if (!persistencia.ok) return responderErro(persistencia.falha, deps, inicio, host, usuario, auditoriaAberta, undefined, origem);

    await marcarDesfechoSilencioso(deps, 'sucesso');
    console.info(
      '[ingest-vaga] etapa=sucesso host=%s duracao_ms=%d usuario=%s',
      host,
      Date.now() - inicio,
      usuarioTruncado(usuario.id),
    );

    return respostaJson({ vaga: persistencia.vaga }, 201, origem);
  } catch (erro) {
    return responderErro(ERROS.erroGenerico(), deps, inicio, host, usuario, auditoriaAberta, erro, origem);
  }
}

async function responderErro(
  falha: ErroPipeline,
  deps: Dependencias,
  inicio: number,
  host: string,
  usuario: UsuarioAutenticado | null,
  auditoriaAberta = false,
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
  // Só grava desfecho se houve registro da tentativa; falhas anteriores (CORS,
  // auth, allowlist, corpo) acontecem antes de a auditoria existir.
  if (auditoriaAberta) {
    await marcarDesfechoSilencioso(deps, falha.code === 'vaga_duplicada' ? 'duplicada' : 'erro');
  }

  return respostaErroHttp(falha, deps.config.appOrigin);
}

/** Falha na auditoria nunca derruba a resposta que o usuário recebe. */
async function marcarDesfechoSilencioso(deps: Dependencias, resultado: 'sucesso' | 'duplicada' | 'erro') {
  try {
    await deps.marcarDesfecho(resultado);
  } catch {
    // silencioso por decisão: a auditoria é acessória, o resultado do usuário não é.
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
