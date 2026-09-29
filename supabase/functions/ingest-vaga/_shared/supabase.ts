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

/**
 * Registra a tentativa e devolve quantas ingestões o usuário já tem na hora e no
 * dia, **incluindo o registro corrente**.
 *
 * Inserir antes de contar é o que fecha a corrida: duas requisições simultâneas
 * do mesmo usuário não passam ambas pelo SELECT (design D2).
 */
export async function registrarTentativa(
  cliente: SupabaseClient,
  host: string,
): Promise<{ hora: number; dia: number }> {
  const { data: registro, error } = await cliente
    .from('ingest_log')
    .insert({ host, resultado: 'pendente' })
    .select('id')
    .single();

  if (error || !registro) {
    throw new Error('auditoria-indisponivel');
  }

  const [hora, dia] = await Promise.all([
    contarDesde(cliente, "now() - interval '1 hour'"),
    contarDesde(cliente, "now() - interval '1 day'"),
  ]);

  return { hora, dia };
}

async function contarDesde(cliente: SupabaseClient, desde: string): Promise<number> {
  const { count, error } = await cliente
    .from('ingest_log')
    .select('id', { count: 'exact', head: true })
    .gte('criado_em', desde);

  if (error) {
    throw new Error('auditoria-indisponivel');
  }

  return count ?? 0;
}

/** Atualiza o desfecho da última tentativa do usuário. */
export async function marcarDesfecho(
  cliente: SupabaseClient,
  resultado: 'sucesso' | 'duplicada' | 'erro',
): Promise<void> {
  await cliente
    .from('ingest_log')
    .update({ resultado })
    .eq('resultado', 'pendente')
    .order('criado_em', { ascending: false })
    .limit(1);
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
