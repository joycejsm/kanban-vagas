import type { NextConfig } from 'next';

/**
 * O `next.config` nasce configurável e **sem política de segurança**: a Content Security Policy
 * e os cabeçalhos de hardening pertencem à change `add-nextjs-auth-and-server-actions`
 * (capability `security-headers`, decisão D9), assim como o `middleware.ts` (decisão D1).
 *
 * Mantê-los fora daqui evita dois lugares definindo a mesma política — e evita que a Fase 3
 * comece consertando o scaffold em vez de implementar o que lhe cabe.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
