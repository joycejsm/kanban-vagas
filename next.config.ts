import type { NextConfig } from 'next';

// Extensão explícita pelo mesmo motivo do import em `csp.ts`: o Next compila o
// `next.config` em CommonJS, onde o alias `@/` e a extensão implícita não resolvem.
import { CABECALHOS_DE_HARDENING } from './src/config/csp.ts';

/**
 * Cabeçalhos de hardening servidos em toda resposta (capability `security-headers`, D9).
 *
 * A CSP **não** fica aqui, e sim em `src/middleware.ts`, porque ela precisa de um nonce por
 * resposta e o Next só aplica o atributo `nonce` nos scripts dele quando encontra o valor no
 * cabeçalho CSP da requisição — que só o middleware monta. Se os dois lugares emitissem
 * `Content-Security-Policy`, o navegador aplicaria a interseção dos dois cabeçalhos, e a mais
 * restritiva — a que não tem nonce — quebraria a página sem JavaScript. Um cabeçalho só, no
 * middleware.
 *
 * Os três cabeçalhos de hardening são estáticos e não dependem de requisição, então ficam aqui
 * sem custo: assim eles valem também para o que o matcher do middleware não cobre.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: Object.entries(CABECALHOS_DE_HARDENING).map(([key, value]) => ({ key, value })),
      },
    ];
  },
};

export default nextConfig;
