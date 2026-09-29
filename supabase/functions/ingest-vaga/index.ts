/**
 * Edge Function `ingest-vaga`.
 *
 * Recebe uma URL, extrai os dados da vaga e insere em `public.vagas` com o JWT do
 * próprio usuário. Este arquivo só faz a composição: lê o ambiente, monta as
 * dependências e delega ao pipeline (design D1).
 *
 * Deploy:  supabase functions deploy ingest-vaga
 * Secrets:  GEMINI_API_KEY, GEMINI_MODEL, ALLOWED_EMAILS, APP_ORIGIN
 *
 * Nenhum segredo é lido no cliente: tudo vem de `Deno.env` dentro do isolate.
 */

import { buscarPagina } from './_shared/buscar.ts';
import { extrairVaga } from './_shared/llm.ts';
import { extrairLdJson } from './_shared/parsing.ts';
import { autenticarComToken, criarClientDoUsuario, inserirVaga, marcarDesfecho, registrarTentativa } from './_shared/supabase.ts';
import { lerEnvPadrao } from './_shared/env.ts';
import { etapaExtracao, executarPipeline, type Dependencias } from './_shared/pipeline.ts';
import { respostaErroHttp } from './_shared/http.ts';
import { ERROS } from './_shared/erros.ts';
import * as urlSafety from './_shared/urlSafety.ts';

Deno.serve(async (requisicao: Request): Promise<Response> => {
  const token = lerBearer(requisicao.headers.get('Authorization'));

  try {
    const config = lerEnvPadrao();
    const urlSupabase = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const deps: Dependencias = {
      config,
      url: urlSafety,

      autenticar: (recebido) =>
        recebido === null
          ? Promise.resolve(null)
          : autenticarComToken({ url: urlSupabase, anonKey: anonKey }, recebido),

      registrarTentativa: async (host) => {
        if (!token) throw new Error('sem-token');
        return registrarTentativa(criarClientDoUsuario({ url: urlSupabase, anonKey: anonKey }, token), host);
      },

      buscar: (url) => buscarPagina(url),

      extrair: async (conteudo, url) => {
        // O caminho estruturado tem precedência: quando o site declara
        // JobPosting e os dados bastam, o modelo não é chamado (design D7).
        if (conteudo.trimStart().startsWith('<')) {
          const estruturada = extrairLdJson(conteudo);
          if (estruturada) return estruturada;
        }

        return extrairVaga(conteudo, {
          apiKey: config.geminiApiKey,
          modelo: config.geminiModel,
        });
      },

      inserir: async (dados, usuarioId) => {
        if (!token) throw new Error('sem-token');
        return inserirVaga(criarClientDoUsuario({ url: urlSupabase, anonKey: anonKey }, token), dados);
      },

      marcarDesfecho: async (resultado) => {
        if (!token) return;
        await marcarDesfecho(
          criarClientDoUsuario({ url: urlSupabase, anonKey: anonKey }, token),
          resultado,
        );
      },
    };

    return await executarPipeline(requisicao, deps);
  } catch (erro) {
    // Configuração ausente ou falha inesperada: mensagem genérica, sem detalhe.
    console.error('[ingest-vaga] etapa=bootstrap falha=%s', erro instanceof Error ? erro.name : 'desconhecido');
    return respostaErroHttp(ERROS.erroGenerico(), null);
  }
});

/** Reexportado para os testes de integração da etapa. */
export { etapaExtracao };

function lerBearer(cabecalho: string | null): string | null {
  if (!cabecalho) return null;
  const partes = cabecalho.split(' ');
  if (partes.length === 2 && partes[0]?.toLowerCase() === 'bearer') return partes[1] ?? null;
  return null;
}
