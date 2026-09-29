import { z } from 'zod';

import { LIMITE_TEXTO_COLADO, corpoIngestaoSchema } from './entrada.ts';
import { ERROS, erroDoHttp, type ErroPipeline } from './erros.ts';

/** Resposta de sucesso: a vaga persistida, já validada pelo schema do domínio. */
export const respostaSucessoSchema = z.object({ vaga: z.unknown() });

/** Resposta de erro: mensagem fechada, sem detalhe interno. */
export const respostaErroSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type RespostaErro = z.infer<typeof respostaErroSchema>;

/** `Origin` exato de `APP_ORIGIN`; subdomínio diferente não conta. */
export function cabecalhosCors(origem: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function respostaJson(
  corpo: unknown,
  status: number,
  origem: string | null,
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      ...(origem ? cabecalhosCors(origem) : {}),
      'Content-Type': 'application/json',
    },
  });
}

export function respostaErroHttp(falha: ErroPipeline, origem: string | null): Response {
  const erroValidado = respostaErroSchema.parse({
    code: falha.code,
    message: falha.message,
  });
  return respostaJson(erroValidado, falha.status, origem);
}

/**
 * Lê e valida o corpo da requisição.
 *
 * O corpo é material externo: passa pelo schema estrito antes de qualquer efeito.
 * Erros de JSON malformado e de schema colapsam no mesmo 422, sem que o cliente
 * consiga distinguir os dois casos.
 */
export async function lerCorpo(
  requisicao: Request,
): Promise<{ ok: true; dados: z.infer<typeof corpoIngestaoSchema> } | { ok: false; falha: ErroPipeline }> {
  let bruto: unknown;
  try {
    bruto = await requisicao.json();
  } catch {
    return { ok: false, falha: ERROS.corpoInvalido() };
  }

  const validado = corpoIngestaoSchema.safeParse(bruto);
  if (!validado.success) {
    return { ok: false, falha: ERROS.corpoInvalido() };
  }

  return { ok: true, dados: validado.data };
}

/** Host da URL, usado só no log e na auditoria. Nunca o corpo inteiro. */
export function hostDaUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'desconhecido';
  }
}

/** Registra a falha sem vazar conteúdo. `detalhe` vai só para o log do isolate. */
export function registrarFalha(falha: ErroPipeline, contexto: {
  host: string;
  duracaoMs: number;
  usuario: string | null;
}): void {
  const codigo = detalheSqlstate(falha.detalhe);
  console.error(
    '[ingest-vaga] etapa=%s codigo=%s host=%s duracao_ms=%d usuario=%s',
    falha.etapa,
    codigo ?? falha.code,
    contexto.host,
    Math.round(contexto.duracaoMs),
    contexto.usuario ?? 'anonimo',
  );
}

/** Só o SQLSTATE, que é público — a mensagem do banco não vai para o log. */
function detalheSqlstate(detalhe: unknown): string | undefined {
  if (typeof detalhe === 'object' && detalhe !== null && 'code' in detalhe) {
    const { code } = detalhe as { code?: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export { erroDoHttp, LIMITE_TEXTO_COLADO };
