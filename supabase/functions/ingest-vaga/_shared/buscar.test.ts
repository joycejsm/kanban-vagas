import { assertEquals } from 'jsr:@std/assert@1';
import { describe, it } from 'jsr:@std/testing@1/bdd';

import {
  buscarPagina,
  lerComTeto,
  MAXIMO_REDIRECTS,
  PaginaGrandeDemaisError,
  TAMANHO_MAXIMO_BYTES,
  TIMEOUT_MS,
  USER_AGENT,
  UrlRecusadaError,
} from './buscar.ts';
import type { ResolvedorDns } from './urlSafety.ts';

const PUBLICO: ResolvedorDns = () => Promise.resolve(['93.184.216.34']);

/** Resposta HTTP mínima, com corpo em streaming controlado. */
function resposta(opcoes: {
  status?: number;
  headers?: Record<string, string>;
  corpo?: string;
  /** Simula corpo que nunca termina, para testar o teto. */
  infinito?: boolean;
  tamanhoDeclarado?: number;
}): Response {
  const headers = new Headers(opcoes.headers ?? {});

  if (opcoes.tamanhoDeclarado !== undefined) {
    headers.set('content-length', String(opcoes.tamanhoDeclarado));
  }

  if (opcoes.infinito) {
    // Stream que emite blocos de 100 KB indefinidamente.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(100_000));
      },
    });
    return new Response(stream, { status: opcoes.status ?? 200, headers });
  }

  return new Response(opcoes.corpo ?? '<html><body>vaga</body></html>', {
    status: opcoes.status ?? 200,
    headers,
  });
}

function fetchDublê(
  respostas: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>,
) {
  const chamadas: string[] = [];
  const impl = ((url: string | URL | Request, init?: RequestInit) => {
    const alvo = String(url);
    chamadas.push(alvo);
    const proxima = respostas.shift();
    if (!proxima) throw new Error(`sem resposta para ${alvo}`);
    return Promise.resolve(proxima(alvo, init));
  }) as typeof fetch;

  return { impl, chamadas };
}

describe('buscarPagina — opções da requisição', () => {
  it('envia redirect manual, User-Agent e timeout', async () => {
    let initVisto: RequestInit | undefined;
    const { impl } = fetchDublê([
      (_u, init) => {
        initVisto = init;
        return resposta({ headers: { 'content-type': 'text/html' } });
      },
    ]);

    await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO });

    assertEquals(initVisto?.redirect, 'manual');
    assertEquals((initVisto?.headers as Record<string, string>)['User-Agent'], USER_AGENT);
    assertEquals(initVisto?.signal instanceof AbortSignal, true);
  });

  it('o timeout é de 8 segundos', () => {
    assertEquals(TIMEOUT_MS, 8_000);
  });
});

describe('buscarPagina — content-type', () => {
  it('recusa application/pdf', async () => {
    const { impl } = fetchDublê([() => resposta({ headers: { 'content-type': 'application/pdf' } })]);

    const erro = await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO })
      .then(() => null, (e: Error) => e);

    assertEquals(erro instanceof UrlRecusadaError, true);
    assertEquals((erro as UrlRecusadaError).razao, 'content-type');
  });

  it('recusa image/png', async () => {
    const { impl } = fetchDublê([() => resposta({ headers: { 'content-type': 'image/png' } })]);

    const resultado = await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO }).then(
      () => 'ok' as const,
      () => 'erro' as const,
    );
    assertEquals(resultado, 'erro');
  });

  it('aceita text/html com charset', async () => {
    const { impl } = fetchDublê([
      () => resposta({ headers: { 'content-type': 'text/html; charset=utf-8' }, corpo: '<html>ok</html>' }),
    ]);

    assertEquals(
      await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO }),
      '<html>ok</html>',
    );
  });
});

describe('buscarPagina — limite de tamanho', () => {
  it('aborta corpo de 50 MB', async () => {
    const { impl } = fetchDublê([
      () => resposta({ headers: { 'content-type': 'text/html' }, infinito: true }),
    ]);

    const erro = await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO })
      .then(() => null, (e: Error) => e);

    assertEquals(erro instanceof PaginaGrandeDemaisError, true);
  });

  it('aborta imediatamente quando Content-Length já excede o teto', async () => {
    const corpo = 'x'.repeat(10);
    const { impl } = fetchDublê([
      () =>
        resposta({
          headers: { 'content-type': 'text/html' },
          corpo,
          tamanhoDeclarado: 50 * 1024 * 1024,
        }),
    ]);

    const erro = await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO })
      .then(() => null, (e: Error) => e);

    assertEquals(erro instanceof PaginaGrandeDemaisError, true);
  });

  it('aceita corpo dentro do teto', async () => {
    const corpo = 'a'.repeat(1_000_000);
    const { impl } = fetchDublê([
      () => resposta({ headers: { 'content-type': 'text/html' }, corpo }),
    ]);

    assertEquals(
      (await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO })).length,
      1_000_000,
    );
  });

  it('lerComTeto respeita o limite', async () => {
    const grande = 'x'.repeat(5_000);
    const resultado = await lerComTeto(new Response(grande), 1_000).then(
      () => 'ok' as const,
      () => 'erro' as const,
    );
    assertEquals(resultado, 'erro');

    assertEquals(await lerComTeto(new Response('pequeno'), 1_000), 'pequeno');
  });

  it('o teto padrão é 1,5 MB', () => {
    assertEquals(TAMANHO_MAXIMO_BYTES, 1_500_000);
  });
});

describe('buscarPagina — redirects revalidados', () => {
  it('segue redirect público válido', async () => {
    const { impl, chamadas } = fetchDublê([
      () => resposta({ status: 302, headers: { location: 'https://outra.empresa.com/vaga' } }),
      () => resposta({ headers: { 'content-type': 'text/html' }, corpo: '<html>final</html>' }),
    ]);

    assertEquals(
      await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO }),
      '<html>final</html>',
    );
    assertEquals(chamadas.length, 2);
    assertEquals(chamadas[1], 'https://outra.empresa.com/vaga');
  });

  it('BLOQUEIA redirect para IP privado (169.254.169.254)', async () => {
    const { impl, chamadas } = fetchDublê([
      () => resposta({ status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } }),
    ]);

    const erro = await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO })
      .then(() => null, (e: Error) => e);

    assertEquals(erro instanceof UrlRecusadaError, true);
    // O destino é um IP literal, barrado antes de qualquer resolução.
    assertEquals((erro as UrlRecusadaError).razao, 'ip-literal');
    assertEquals(chamadas.length, 1, 'não deve abrir conexão com o destino privado');
  });

  it('BLOQUEIA redirect que resolve para faixa privada', async () => {
    const resolvendoInterno: ResolvedorDns = (host) =>
      host === 'infiltrado.example'
        ? Promise.resolve(['10.0.0.9'])
        : Promise.resolve(['93.184.216.34']);

    const { impl, chamadas } = fetchDublê([
      () => resposta({ status: 302, headers: { location: 'https://infiltrado.example/dados' } }),
    ]);

    const erro = await buscarPagina('https://empresa.com/vaga', {
      fetchImpl: impl,
      resolver: resolvendoInterno,
    }).then(() => null, (e: Error) => e);

    assertEquals(erro instanceof UrlRecusadaError, true);
    assertEquals((erro as UrlRecusadaError).razao, 'ip-nao-publico');
    assertEquals(chamadas.length, 1);
  });

  it('interrompe cadeia com mais de 3 redirects', async () => {
    const { impl, chamadas } = fetchDublê([
      () => resposta({ status: 302, headers: { location: 'https://a.example/1' } }),
      () => resposta({ status: 302, headers: { location: 'https://a.example/2' } }),
      () => resposta({ status: 302, headers: { location: 'https://a.example/3' } }),
      () => resposta({ status: 302, headers: { location: 'https://a.example/4' } }),
    ]);

    const erro = await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO })
      .then(() => null, (e: Error) => e);

    assertEquals(erro instanceof UrlRecusadaError, true);
    assertEquals((erro as UrlRecusadaError).razao, 'redirect-excedido');
    assertEquals(chamadas.length, MAXIMO_REDIRECTS + 1, 'para no quarto salto');
  });

  it('recusa redirect sem Location', async () => {
    const { impl } = fetchDublê([() => resposta({ status: 302 })]);

    const erro = await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO })
      .then(() => null, (e: Error) => e);

    assertEquals((erro as UrlRecusadaError).razao, 'redirect-sem-location');
  });
});

describe('buscarPagina — erro HTTP', () => {
  it('propaga erro de status não-2xx', async () => {
    const { impl } = fetchDublê([() => resposta({ status: 404 })]);

    const erro = await buscarPagina('https://empresa.com/vaga', { fetchImpl: impl, resolver: PUBLICO })
      .then(() => null, (e: Error) => e);

    assertEquals(erro?.message, 'http-404');
  });
});
