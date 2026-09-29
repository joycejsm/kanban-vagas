/**
 * Busca da página com limites.
 *
 * Três barreiras, nesta ordem: timeout, tipo de conteúdo e tamanho. O redirect é
 * seguido à mão e cada destino passa pela MESMA validação da entrada (design D3) —
 * é isso que barra "302 de site público para IP privado".
 */

import { resolverDnsPadrao, validarUrl, type ResolvedorDns } from './urlSafety.ts';

export const TIMEOUT_MS = 8_000;
export const TAMANHO_MAXIMO_BYTES = 1_500_000;
export const MAXIMO_REDIRECTS = 3;

export const USER_AGENT = 'KanbanVagasBot/1.0 (+https://github.com/kanban-vagas; contato via app)';

export class PaginaGrandeDemaisError extends Error {
  constructor() {
    super('A página excede o tamanho máximo');
    this.name = 'PaginaGrandeDemaisError';
  }
}

export type Fetcher = typeof globalThis.fetch;

export interface OpcoesBuscar {
  fetchImpl?: Fetcher;
  resolver?: ResolvedorDns;
}

/** Erros que a validação de URL pode produzir, para o handler mapear o status certo. */
export class UrlRecusadaError extends Error {
  readonly razao: string;
  constructor(razao: string) {
    super(`URL recusada: ${razao}`);
    this.name = 'UrlRecusadaError';
    this.razao = razao;
  }
}

/**
 * Busca `url` e devolve o HTML, respeitando timeout, tipo e tamanho.
 *
 * `validarUrl` é chamada aqui de novo mesmo quando o handler já validou: o
 * destino pode ter mudado entre as duas chamadas, e o custo é desprezível.
 */
export async function buscarPagina(url: string, opcoes: OpcoesBuscar = {}): Promise<string> {
  const fetchImpl = opcoes.fetchImpl ?? globalThis.fetch;
  const resolver = opcoes.resolver ?? resolverDnsPadrao;

  let atual = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    for (let salto = 0; salto <= MAXIMO_REDIRECTS; salto++) {
      const validacao = await validarUrl(atual, resolver);
      if (!validacao.ok) {
        throw new UrlRecusadaError(validacao.razao);
      }

      const resposta = await fetchImpl(validacao.url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
      });

      if (ehRedirect(resposta.status)) {
        const destino = resposta.headers.get('Location');
        if (!destino) {
          throw new UrlRecusadaError('redirect-sem-location');
        }

        if (salto === MAXIMO_REDIRECTS) {
          throw new UrlRecusadaError('redirect-excedido');
        }

        // Revalidação acontece no início da próxima iteração, com as mesmas
        // regras aplicadas à entrada.
        atual = new URL(destino, validacao.url).toString();
        continue;
      }

      if (!resposta.ok) {
        throw new Error(`http-${resposta.status}`);
      }

      const tipo = resposta.headers.get('content-type') ?? '';
      if (!tipo.toLowerCase().includes('text/html')) {
        throw new UrlRecusadaError('content-type');
      }

      return await lerComTeto(resposta);
    }

    throw new UrlRecusadaError('redirect-excedido');
  } finally {
    clearTimeout(timer);
  }
}

/** 301, 302, 303, 307 e 308. */
function ehRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Lê o corpo em chunks, abortando assim que o acumulado passa do teto.
 *
 * `Content-Length` não é confiável (o servidor pode mentir ou omitir), então é
 * usado apenas como atalho para abortar antes de gastar banda.
 */
export async function lerComTeto(resposta: Response, teto = TAMANHO_MAXIMO_BYTES): Promise<string> {
  const declarado = Number(resposta.headers.get('content-length') ?? '0');
  if (Number.isFinite(declarado) && declarado > teto) {
    await resposta.body?.cancel();
    throw new PaginaGrandeDemaisError();
  }

  if (!resposta.body) {
    return '';
  }

  const leitor = resposta.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;

      total += value.byteLength;
      if (total > teto) {
        await leitor.cancel();
        throw new PaginaGrandeDemaisError();
      }

      pedacos.push(value);
    }
  } finally {
    leitor.releaseLock?.();
  }

  const totalBytes = new Uint8Array(total);
  let posicao = 0;
  for (const pedaco of pedacos) {
    totalBytes.set(pedaco, posicao);
    posicao += pedaco.byteLength;
  }

  return new TextDecoder('utf-8').decode(totalBytes);
}

export { resolverDnsPadrao };
