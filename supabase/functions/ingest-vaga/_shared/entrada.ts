import { z } from 'zod';

import { LIMITE_TEXTO_COLADO } from '@/domain/vaga';

/**
 * Limites de entrada do endpoint.
 *
 * Reexportados do domínio, e não definidos aqui: o valor é o mesmo que a Server Action do
 * Next aplica antes de chamar esta função, e as duas pontas precisam ler o mesmo número.
 * A reexportação existe para que `_shared/http.ts` e o resto da função continuem importando
 * de onde já importavam.
 */
export { LIMITE_TEXTO_COLADO };

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
