import { z } from 'zod';

/** Limites de entrada do endpoint. Espelham os limites do domínio (Fase 1). */
export const LIMITE_TEXTO_COLADO = 30_000;

export const urlSchema = z
  .string()
  .max(2048, 'URL excede o tamanho máximo')
  .url('URL inválida')
  .refine((valor) => valor.startsWith('https://'), {
    message: 'A URL deve usar o protocolo https',
  });

/**
 * Corpo aceito pela função.
 *
 * Estrito de propósito: `user_id`, `status` e `ordem` são campos de servidor e
 * NÃO têm lugar aqui (invariante 3). `texto` é o fallback para quando o scraping
 * não funciona — o site bloqueia, ou renderiza por JavaScript.
 */
export const corpoIngestaoSchema = z
  .object({
    url: urlSchema,
    texto: z.string().max(LIMITE_TEXTO_COLADO, 'Texto excede o tamanho máximo').optional(),
  })
  .strict();

export type CorpoIngestao = z.infer<typeof corpoIngestaoSchema>;
