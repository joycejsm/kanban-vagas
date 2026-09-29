/**
 * Configuração de PostCSS do projeto.
 *
 * O Tailwind v4 não usa `tailwind.config.js`: a configuração vive na própria
 * folha de estilos global (`src/app/globals.css`), que começa com a diretiva
 * `@import "tailwindcss"`. Aqui só ligamos o plugin que a transforma.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
