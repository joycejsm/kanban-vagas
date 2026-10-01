/**
 * Acesso ao Supabase a partir da função.
 *
 * Duas clients, deliberadamente:
 *  - `clientAnon` valida o token do usuário (`auth.getUser`). É a única que fala
 *    com o serviço de Auth.
 *  - `clientDoUsuario` executa a inserção, com o JWT da requisição anexado. O RLS
 *    se aplica porque o dono da linha é `auth.uid()` do próprio usuário.
 *
 * A service role key NUNCA é usada aqui — nem para ler, nem para inserir
 * (invariante 2). As permissões de tabela vêm do RLS, não de privilégio.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { vagaRowSchema, type VagaCreateInput, type VagaRow } from '@/domain/vaga';

import type { UsuarioAutenticado } from './pipeline.ts';

export interface ContextoSupabase {
  url: string;
  anonKey: string;
}

/** Colunas lidas na volta; `user_id` vem do banco, nunca do payload. */
const COLUNAS =
  'id, user_id, url, url_normalizada, titulo, empresa, requisitos, senioridade, status, ordem, created_at, updated_at';

export function criarClientAnon(ctx: ContextoSupabase): SupabaseClient {
  return createClient(ctx.url, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cliente com o JWT do usuário: o RLS passa a valer de verdade. */
export function criarClientDoUsuario(ctx: ContextoSupabase, token: string): SupabaseClient {
  return createClient(ctx.url, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Valida o token chamando o serviço de Auth.
 *
 * `getUser(token)` vai ao servidor; confiar apenas no JWT decodificado localmente
 * seria aceitar qualquer token não expirado (invariante 4).
 */
export async function autenticarComToken(
  ctx: ContextoSupabase,
  token: string,
): Promise<UsuarioAutenticado | null> {
  const { data, error } = await criarClientAnon(ctx).auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return { id: data.user.id, email: data.user.email ?? null };
}

/** Janelas do limite de uso, em milissegundos. */
export const JANELA_HORA_MS = 60 * 60 * 1000;
export const JANELA_DIA_MS = 24 * 60 * 60 * 1000;

export interface Janelas {
  hora: number;
  dia: number;
}

/**
 * Registra a tentativa e devolve o `id` da linha criada.
 *
 * O `id` volta porque é o único jeito de fechar **esta** tentativa: a API de
 * escrita ignora ordenação e limite, então "a pendente mais recente" atualiza
 * todas as pendentes do usuário — e com duas chamadas em voo, uma fecha a
 * tentativa da outra.
 *
 * Falhar aqui significa que nenhuma linha existe: o pipeline trata como falha
 * anterior ao registro e não tenta fechar nada.
 */
export async function registrarTentativa(
  cliente: SupabaseClient,
  host: string,
): Promise<{ id: string }> {
  const { data: registro, error } = await cliente
    .from('ingest_log')
    .insert({ host, resultado: 'pendente' })
    .select('id')
    .single();

  if (error || !registro) {
    throw new Error('auditoria-indisponivel');
  }

  return { id: registro.id };
}

/**
 * Conta as ingestões do usuário na hora e no dia, **incluindo o registro
 * corrente** — é o que fecha a corrida do design D2.
 *
 * A janela é calculada aqui e enviada como valor ISO 8601 porque o filtro do
 * PostgREST é um literal, não SQL: `now() - interval '1 hour'` é recusado pelo
 * banco como formato inválido de `timestamptz` (`22007`) e a contagem falha.
 * Como o filtro usa `head: true`, a resposta é um `HEAD` sem corpo — o erro
 * chega ao `supabase-js` sem mensagem nenhuma, o que tornava o defeito invisível
 * no log.
 *
 * As duas janelas saem do mesmo `agora`: dois `Date.now()` sucessivos fariam a
 * contagem horária e a diária discordarem entre si.
 */
export async function contarJanelas(
  cliente: SupabaseClient,
  agora: number = Date.now(),
): Promise<Janelas> {
  const [hora, dia] = await Promise.all([
    contarDesde(cliente, new Date(agora - JANELA_HORA_MS)),
    contarDesde(cliente, new Date(agora - JANELA_DIA_MS)),
  ]);

  return { hora, dia };
}

async function contarDesde(cliente: SupabaseClient, desde: Date): Promise<number> {
  const { count, error } = await cliente
    .from('ingest_log')
    .select('id', { count: 'exact', head: true })
    .gte('criado_em', desde.toISOString());

  if (error) {
    throw new Error('auditoria-indisponivel');
  }

  return count ?? 0;
}

/**
 * Grava o desfecho **da linha que esta tentativa criou** e diz se gravou.
 *
 * O filtro é por `id`, nunca por `resultado = 'pendente'` + ordenação: a API de
 * escrita aceita `order` e `limit` e **os ignora**, então o filtro anterior
 * atualizava todas as pendências do usuário.
 *
 * O `.select('id')` existe para o pipeline distinguir "não havia linha para
 * fechar" de "a gravação foi recusada" — sem ele, os dois casos são o mesmo
 * sucesso mudo.
 */
export async function marcarDesfecho(
  cliente: SupabaseClient,
  id: string,
  resultado: 'sucesso' | 'duplicada' | 'erro',
): Promise<{ gravado: boolean }> {
  const { data, error } = await cliente
    .from('ingest_log')
    .update({ resultado })
    .eq('id', id)
    .select('id');

  if (error) {
    // Relançado cru, como em `inserirVaga`: o pipeline lê `.code` para o log, e
    // embrulhar aqui esconderia o SQLSTATE — que é público e é o que diagnostica.
    throw error;
  }

  return { gravado: (data?.length ?? 0) > 0 };
}

/**
 * Insere a vaga com `status` inicial e `ordem` no fim da coluna.
 *
 * `ordem` é calculada no servidor a partir do máximo da coluna de destino, para
 * que o card novo apareça por último em vez de colar no topo.
 */
export async function inserirVaga(
  cliente: SupabaseClient,
  dados: VagaCreateInput,
): Promise<VagaRow> {
  const { data: ultimo, error: erroLeitura } = await cliente
    .from('vagas')
    .select('ordem')
    .eq('status', 'aplicado')
    .order('ordem', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erroLeitura) {
    throw erroLeitura;
  }

  const { data, error } = await cliente
    .from('vagas')
    .insert({
      url: dados.url,
      titulo: dados.titulo,
      empresa: dados.empresa,
      requisitos: dados.requisitos,
      senioridade: dados.senioridade,
      status: 'aplicado',
      ordem: ultimo === null ? 0 : (ultimo.ordem as number) + 1,
    })
    .select(COLUNAS)
    .single();

  if (error) {
    throw error; // 23505 chega ao pipeline, que traduz em 409.
  }

  const validado = vagaRowSchema.safeParse(data);
  if (!validado.success) {
    throw new Error('linha-invalida');
  }

  return validado.data;
}
