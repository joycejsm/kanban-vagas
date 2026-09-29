/**
 * Erros de domínio do serviço de vagas.
 *
 * A mensagem devolvida ao chamador é sempre genérica e em pt-BR (invariante 8).
 * O erro original do Supabase fica anexado em `cause` apenas para inspeção interna
 * e jamais é serializado para o cliente.
 */

export class VagaServiceError extends Error {
  constructor(mensagem = 'Não foi possível concluir a operação. Tente novamente.', opcao?: { cause?: unknown }) {
    super(mensagem, opcao);
    this.name = 'VagaServiceError';
  }
}

/** A URL já foi cadastrada por este usuário (violação de `vagas_user_id_url_normalizada_key`). */
export class VagaDuplicadaError extends VagaServiceError {
  constructor() {
    super('Você já cadastrou esta vaga.');
    this.name = 'VagaDuplicadaError';
  }
}
