import { z } from 'zod';

/**
 * Limites de tamanho compartilhados entre o frontend Next.js e as Edge Functions em Deno.
 * Nenhuma entrada externa entra no sistema sem passar por estes limites (invariante 5).
 */
export const LIMITE_URL = 2048;
export const LIMITE_TEXTO_CURTO = 200;
export const LIMITE_REQUISITOS = 30;
export const LIMITE_ITEM_REQUISITO = 300;

/** Status possíveis de uma vaga no quadro Kanban. Espelha o CHECK constraint da tabela `public.vagas`. */
export const statusVagaSchema = z.enum([
  'aplicado',
  'entrevista_1',
  'fase_tecnica',
  'proposta',
  'rejeitado',
]);

/** Senioridade da vaga. `Não informado` é o valor padrão quando a extração não informa nada. */
export const senioridadeSchema = z.enum(['Junior', 'Pleno', 'Senior', 'Não informado']);

/**
 * Entrada de criação de uma vaga.
 *
 * NÃO contém `id`, `user_id`, `status`, `ordem`, `created_at` ou `updated_at`:
 * - `user_id` vem do servidor (`auth.uid()`),
 * - `id`/`created_at`/`updated_at` são gerados pelo banco,
 * - `status` e `ordem` pertencem ao estado do quadro, não ao cadastro.
 */
export const vagaCreateInputSchema = z
  .object({
    url: z
      .string()
      .max(LIMITE_URL, 'URL excede o tamanho máximo')
      .url('URL inválida')
      .refine((valor) => valor.startsWith('https://'), {
        message: 'A URL deve usar o protocolo https',
      }),
    titulo: z.string().trim().min(1).max(LIMITE_TEXTO_CURTO),
    empresa: z.string().trim().min(1).max(LIMITE_TEXTO_CURTO),
    requisitos: z
      .array(z.string().trim().min(1).max(LIMITE_ITEM_REQUISITO))
      .max(LIMITE_REQUISITOS, 'Quantidade de requisitos excede o máximo'),
    senioridade: senioridadeSchema.default('Não informado'),
  })
  .strict();

/** Registro completo de uma vaga, como persistido em `public.vagas`. */
export const vagaRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  url: z.string(),
  url_normalizada: z.string(),
  titulo: z.string(),
  empresa: z.string(),
  requisitos: z.array(z.string()),
  senioridade: senioridadeSchema,
  status: statusVagaSchema,
  ordem: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type StatusVaga = z.infer<typeof statusVagaSchema>;
export type Senioridade = z.infer<typeof senioridadeSchema>;
export type VagaCreateInput = z.infer<typeof vagaCreateInputSchema>;
export type VagaRow = z.infer<typeof vagaRowSchema>;
