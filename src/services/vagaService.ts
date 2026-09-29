import type { SupabaseClient } from '@supabase/supabase-js';

import {
  vagaCreateInputSchema,
  vagaRowSchema,
  type StatusVaga,
  type VagaCreateInput,
  type VagaRow,
} from '@/domain/vaga';
import { VagaDuplicadaError, VagaServiceError } from '@/services/vagaService.errors';

/** Nome da constraint de unicidade que identifica a vaga duplicada. */
const CONSTRAINT_URL_NORMALIZADA = 'vagas_user_id_url_normalizada_key';

/** Colunas graváveis. `user_id` e `url_normalizada` nunca entram aqui (design D4/D6). */
const COLUNAS_INSERCAO = 'id, user_id, url, url_normalizada, titulo, empresa, requisitos, senioridade, status, ordem, created_at, updated_at';

/**
 * Acesso às vagas do usuário autenticado.
 *
 * O cliente Supabase entra por injeção e deve ser o cliente do usuário da requisição,
 * com o JWT anexado — assim o RLS sempre se aplica. A service role key nunca é usada
 * aqui (invariante 2), e nenhuma operação aceita `user_id` como parâmetro: quem o
 * define é o banco, via `default auth.uid()` (invariante 3).
 */
export class VagaService {
  constructor(private readonly cliente: SupabaseClient) {}

  /**
   * Lista as vagas do usuário autenticado, ordenadas por status e posição na coluna.
   */
  async listarVagas(): Promise<VagaRow[]> {
    const { data: dados, error: erro } = await this.cliente
      .from('vagas')
      .select(COLUNAS_INSERCAO)
      .order('status', { ascending: true })
      .order('ordem', { ascending: true })
      .order('created_at', { ascending: true });

    if (erro) {
      throw this.traduzirErro(erro, 'listarVagas');
    }

    return this.validarLinhas(dados, 'listarVagas');
  }

  /**
   * Cria uma vaga. `user_id`, `status` e `ordem` são definidos pelo banco.
   */
  async criarVaga(input: VagaCreateInput): Promise<VagaRow> {
    const validado = vagaCreateInputSchema.safeParse(input);
    if (!validado.success) {
      throw new VagaServiceError('Dados da vaga inválidos.', { cause: validado.error });
    }

    // `url_normalizada` é calculada por trigger; enviá-la permitiria forjar a deduplicação.
    const linha = validado.data;

    const { data: dados, error: erro } = await this.cliente
      .from('vagas')
      .insert({
        url: linha.url,
        titulo: linha.titulo,
        empresa: linha.empresa,
        requisitos: linha.requisitos,
        senioridade: linha.senioridade,
      })
      .select(COLUNAS_INSERCAO)
      .single();

    if (erro || !dados) {
      throw this.traduzirErro(erro, 'criarVaga');
    }

    return this.validarLinha(dados, 'criarVaga');
  }

  /**
   * Move a vaga para outra coluna e/ou posição. `ordem` omitida mantém a posição atual.
   * Retorna `null` quando nenhuma linha foi afetada — o que ocorre tanto para id
   * inexistente quanto para vaga de outro usuário, indistinguivelmente.
   */
  async atualizarStatus(id: string, status: StatusVaga, ordem?: number): Promise<VagaRow | null> {
    const atualizacao: { status: StatusVaga; ordem?: number } = { status };
    if (ordem !== undefined) {
      atualizacao.ordem = ordem;
    }

    const { data: dados, error: erro } = await this.cliente
      .from('vagas')
      .update(atualizacao)
      .eq('id', id)
      .select(COLUNAS_INSERCAO)
      .maybeSingle();

    if (erro) {
      throw this.traduzirErro(erro, 'atualizarStatus');
    }

    if (!dados) {
      return null;
    }

    return this.validarLinha(dados, 'atualizarStatus');
  }

  /**
   * Remove a vaga. Retorna `false` quando nada foi removido, pelo mesmo motivo de
   * `atualizarStatus`.
   */
  async removerVaga(id: string): Promise<boolean> {
    const { data: removidas, error: erro } = await this.cliente
      .from('vagas')
      .delete()
      .eq('id', id)
      .select('id');

    if (erro) {
      throw this.traduzirErro(erro, 'removerVaga');
    }

    return Array.isArray(removidas) && removidas.length > 0;
  }

  /**
   * Converte a resposta do PostgREST em erro de domínio.
   *
   * Só o log estruturado recebe detalhe do banco — nunca o payload enviado pelo
   * usuário, o token ou o e-mail (invariantes 8 e 9).
   */
  private traduzirErro(erro: unknown, operacao: string): Error {
    const codigo = this.extrairCodigo(erro);

    if (codigo === '23505' && this.constraintDoErro(erro)?.includes(CONSTRAINT_URL_NORMALIZADA)) {
      console.error('[vagaService] operacao=%s codigo=%s constraint=%s', operacao, codigo, CONSTRAINT_URL_NORMALIZADA);
      return new VagaDuplicadaError();
    }

    console.error('[vagaService] operacao=%s codigo=%s', operacao, codigo ?? 'desconhecido');
    return new VagaServiceError(undefined, { cause: erro });
  }

  private extrairCodigo(erro: unknown): string | undefined {
    if (typeof erro === 'object' && erro !== null && 'code' in erro) {
      const { code } = erro as { code?: unknown };
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
  }

  private constraintDoErro(erro: unknown): string | undefined {
    if (typeof erro === 'object' && erro !== null && 'constraint' in erro) {
      const { constraint } = erro as { constraint?: unknown };
      return typeof constraint === 'string' ? constraint : undefined;
    }
    return undefined;
  }

  private validarLinhas(dados: unknown, operacao: string): VagaRow[] {
    const resultado = vagaRowSchema.array().safeParse(dados);
    if (!resultado.success) {
      console.error('[vagaService] operacao=%s validacao=falhou', operacao);
      throw new VagaServiceError();
    }
    return resultado.data;
  }

  private validarLinha(dados: unknown, operacao: string): VagaRow {
    const resultado = vagaRowSchema.safeParse(dados);
    if (!resultado.success) {
      console.error('[vagaService] operacao=%s validacao=falhou', operacao);
      throw new VagaServiceError();
    }
    return resultado.data;
  }
}
