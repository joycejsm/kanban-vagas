/**
 * Saneamento do parâmetro `next` (decisão D3).
 *
 * Allowlist **positiva**, não blocklist: o valor só é aceito se casar com a forma de caminho
 * relativo interno. Blocklist (`não pode conter "://"`, `não pode começar com "javascript"`) é
 * uma lista de casos proibidos que sempre admite o próximo; aqui a propriedade é por
 * construção — o valor aceito começa com `/` e não começa com `//`, então não há como produzir
 * uma URL absoluta nem trocar de esquema.
 *
 * A alternativa com `new URL(valor, origin)` e comparação de `origin` funciona, mas depende de
 * `origin` estar corretamente configurada e é mais difícil de testar sem contexto. A forma
 * positiva é testável em isolamento.
 */

/**
 * Caminho interno: começa com `/`, não com `//` e não carrega barra invertida nem quebra de linha.
 */
const CAMINHO_INTERNO = /^\/(?!\/)/;

/** Caracteres que não podem aparecer: barra invertida (Windows/URL ambiguo) e CR/LF (quebra de cabeçalho). */
const CARACTERES_PROIBIDOS = /[\\\r\n]/;

/** Destino usado quando o valor recebido não serve. */
export const DESTINO_PADRAO = '/';

/**
 * Diz se o valor é um caminho relativo interno.
 *
 * Exposta porque a decisão reaparece em outro lugar — o redirecionamento para o login só
 * aceita um destino que passe por aqui — e a regra do que é caminho interno precisa ser uma só.
 */
export function ehCaminhoInterno(valor: string): boolean {
  return CAMINHO_INTERNO.test(valor) && !CARACTERES_PROIBIDOS.test(valor);
}

/**
 * Devolve o destino pós-login confiável.
 *
 * Qualquer valor que não seja caminho relativo interno vira `/`. A comparação é feita sobre o
 * valor bruto, sem `trim`: espaço no começo já não casa com `^\/`, e um espaço no fim dentro de
 * um caminho válido é preservado — é o servidor que decide se aquilo é uma rota, não esta
 * função.
 */
export function sanearNext(valor: string | null | undefined): string {
  if (typeof valor !== 'string' || valor === '' || !ehCaminhoInterno(valor)) {
    return DESTINO_PADRAO;
  }

  return valor;
}

/**
 * Destino a ser preservado no redirecionamento ao login, ou `null` quando não há nada a
 * preservar.
 *
 * A diferença entre "sem `next`" e "`next` sanitizado para `/`" importa: sem o parâmetro o
 * redirecionamento é o `/login` limpo que o requisito pede; com um valor rejeitado, carregar o
 * `/` de resultado inventaria um destino que o visitante não pediu e poluiria a URL de login.
 * Então só é aceito o valor que a sanitização devolveu **inalterado** — o que, por construção
 * da regra, já é caminho interno.
 */
export function destinoParaRedirecionamento(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string' || valor === '') {
    return null;
  }

  return sanearNext(valor) === valor ? valor : null;
}
