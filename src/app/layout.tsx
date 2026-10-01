import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Kanban de Vagas',
  description: 'Kanban pessoal para acompanhar as vagas às quais me candidatei.',
};

/**
 * As três fontes da identidade visual.
 *
 * **Fraunces** nos títulos: uma serif variável com eixos `SOFT` e `WONK`, e o `WONK` é o que
 * troca as terminações retas por formas irregulares. É uma fonte desenhada para não ser
 * neutra, e é isso que dá ao quadro a cara de papel impresso em vez de painel de dashboard.
 *
 * **IBM Plex Sans** no corpo: humanista, com um desenho de engineer sem ser geométrica. Casa com
 * a Fraunces porque as duas carregam um traço de projeto, e não porque são parecidas.
 *
 * **IBM Plex Mono** nos rótulos, contagens e metadados. Duas funções: casa com a Plex Sans como
 * irmã, e é o que faz "Aplicado 3" parecer um registro de ficha em vez de um cabeçalho de
 * interface.
 *
 * ## Por que `next/font/google` não mexe na CSP
 *
 * O comentário original deste arquivo dizia que uma fonte remota exigiria `style-src`/`font-src`
 * e uma decisão de segurança da Fase 3. Isso descreve carregar a fonte por `<link>` para um CDN
 * — que é de fato uma origem nova. O `next/font` é outra coisa: ele **baixa a fonte no build**
 * e a serve em `/_next/static/media/`, na própria origem, com `@font-face` numa folha de estilo
 * que o próprio Next emite. Nenhuma requisição para fora do servidor, nenhuma origem nova,
 * `font-src 'self'` continua valendo.
 *
 * O que ele emite, porém, é um `<style>` inline com a métrica de fallback do navegador, e é
 * governado por `style-src` — diretiva que a política não lista, então cai em `default-src
 * 'self'`, que bloqueia estilo inline sem nonce. O Next aplica o nonce da requisição também nos
 * `<style>` que ele emite, e é isso que a task 1.3 desta change verifica no HTML entregue: sem
 * `nonce` no `<style>`, a fonte cai e a página aparece com a fallback.
 */

/** Títulos e qualquer texto de display. `WONK` ligado: é o traço da identidade. */
const titulo = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  axes: ['opsz', 'SOFT', 'WONK'],
  variable: '--fonte-titulo',
});

/** Corpo, campos e botões. */
const corpo = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--fonte-corpo',
});

/** Rótulos, contagens e metadados. */
const dados = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--fonte-dados',
});

/**
 * Layout raiz do App Router.
 *
 * Server Component mínimo: as três variáveis de fonte entram pelo atributo `className` do
 * `<html>`, e o `globals.css` as consome em `@theme`. Assim nenhum componente precisa saber o
 * nome da fonte — ele só escreve `font-titulo` — e trocar a fonte é uma edição nesta lista.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${titulo.variable} ${corpo.variable} ${dados.variable} textura-cartao`}
    >
      <body>{children}</body>
    </html>
  );
}
