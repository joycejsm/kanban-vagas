import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Kanban de Vagas',
  description: 'Kanban pessoal para acompanhar as vagas às quais me candidatei.',
};

/**
 * Layout raiz do App Router.
 *
 * Server Component mínimo, sem UI de produto: a identidade visual e o quadro Kanban são da
 * Fase 4 (`add-kanban-ui`). Nenhuma folha de estilo externa é carregada aqui — o gerador
 * normalmente traz `next/font/google` apontando para uma fonte remota, que exigiria
 * `style-src`/`font-src` na CSP e decidedoria de segurança que é da Fase 3.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
