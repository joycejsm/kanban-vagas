/**
 * Parsing do HTML com Cheerio.
 *
 * O texto extraído é MATÉRIA-PRIMA DE DADOS, nunca instrução: ele vai para o
 * modelo dentro de delimitadores com nonce e a saída passa pelo schema do domínio.
 * Nenhum trecho deste arquivo decide o que o modelo faz.
 */

import * as cheerio from 'cheerio';

export const LIMITE_TEXTO_MODELO = 12_000;

/**
 * Remove o que não é texto de vaga: código, estilo, iframes e blocos ocultos.
 *
 * Os seletores de classe ocultos são lidos ANTES de descartar o `<style>` — sem
 * isso, `<div class="oculto">` de um site real sobreviveria, porque o CSS que o
 * tornava invisível era justamente o elemento descartado.
 */
export function limparHtml(html: string): cheerio.CheerioAPI {
  const $ = cheerio.load(html);

  const seletoresOcultos = coletarSeletoresOcultos($);

  $('script, style, noscript, iframe, template, svg, canvas').remove();
  $('*').contents().filter((_, node) => node.type === 'comment').remove();

  // Ocultos por atributo
  $('[hidden], [aria-hidden="true"], [type="hidden"]').remove();

  // Ocultos por estilo inline
  $('[style]').each((_, elemento) => {
    if (estiloOculta($(elemento).attr('style') ?? '')) {
      $(elemento).remove();
    }
  });

  // Ocultos por classe declarada em CSS
  if (seletoresOcultos.length > 0) {
    $(seletoresOcultos.join(', ')).remove();
  }

  return $;
}

/** Regras com display:none, visibility:hidden ou opacity:0 viram seletores. */
function coletarSeletoresOcultos($: cheerio.CheerioAPI): string[] {
  const seletores = new Set<string>();

  $('style').each((_, elemento) => {
    const css = $(elemento).text();

    for (const bloco of css.split('}')) {
      if (!estiloOculta(bloco)) continue;

      const seletoresDoBloco = bloco.split('{')[0];
      if (!seletoresDoBloco) continue;

      for (const seletor of seletoresDoBloco.split(',')) {
        const limpo = seletor.trim();
        // Só classes e ids simples: seletores complexos podem dar falso positivo.
        if (/^[.#][a-zA-Z0-9_-]+$/.test(limpo)) {
          seletores.add(limpo);
        }
      }
    }
  });

  return [...seletores];
}

function estiloOculta(estilo: string): boolean {
  const normalizado = estilo.toLowerCase().replace(/\s+/g, '');
  return (
    normalizado.includes('display:none') ||
    normalizado.includes('visibility:hidden') ||
    normalizado.includes('opacity:0')
  );
}

/** Texto visível, com espaços normalizados e truncado para o modelo. */
export function extrairTexto(html: string, limite = LIMITE_TEXTO_MODELO): string {
  const $ = limparHtml(html);

  // Blocos que semanticamente carregam o texto da vaga ganham espaçamento
  // antes da extração, senão frases de itens diferentes ficam coladas.
  $('p, div, li, br, h1, h2, h3, h4, h5, h6, tr, section, article').after('\n');

  const texto = $.root().text().replace(/\r/g, '');

  return normalizarEspacos(texto).slice(0, limite);
}

/** Colapsa qualquer sequência de espaço em um único espaço, preservando quebras. */
export function normalizarEspacos(texto: string): string {
  return texto
    .split('\n')
    .map((linha) => linha.replace(/[^\S\n]+/g, ' ').trim())
    .filter((linha) => linha.length > 0)
    .join('\n')
    .trim();
}

/** Campos estruturados do `application/ld+json` com `@type: JobPosting`. */
export interface VagaEstruturada {
  titulo: string;
  empresa: string;
  requisitos: string[];
  senioridade: string;
}

/**
 * Lê `ld+json` e monta a vaga estruturada, ou `null` se não houver dados
 * suficientes.
 *
 * Cada campo tolera as três formas que os sites usam: string, objeto aninhado e
 * array. Quando falta título, empresa ou qualquer requisito, devolve `null` para
 * que o chamador recorra ao modelo (design D7).
 */
export function extrairLdJson(html: string): VagaEstruturada | null {
  // Carregado SEM `limparHtml`: a limpeza remove `<script>`, e é justamente o
  // `ld+json` que mora lá. Os scripts são lidos e descartados manualmente.
  const $ = cheerio.load(html);
  const resultados: VagaEstruturada[] = [];

  $('script[type="application/ld+json"]').each((_, elemento) => {
    const bruto = $(elemento).text().trim();
    if (bruto === '') return;

    let dados: unknown;
    try {
      dados = JSON.parse(bruto);
    } catch {
      return; // JSON-LD malformado é comum; apenas ignoramos.
    }

    for (const vaga of localizarJobPostings(dados)) {
      const extraida = montarDeJobPosting(vaga);
      if (extraida) resultados.push(extraida);
    }
  });

  // Com múltiplos JobPosting na página, o primeiro com dados completos vence.
  return resultados.find((r) => r.titulo !== '' && r.empresa !== '' && r.requisitos.length > 0) ?? null;
}

/** Achata o JSON-LD, que pode ser objeto, array ou @graph aninhado. */
function localizarJobPostings(dados: unknown): Record<string, unknown>[] {
  if (Array.isArray(dados)) {
    return dados.flatMap((item) => localizarJobPostings(item));
  }

  if (typeof dados !== 'object' || dados === null) {
    return [];
  }

  const objeto = dados as Record<string, unknown>;

  if (ehJobPosting(objeto)) {
    return [objeto];
  }

  if (Array.isArray(objeto['@graph'])) {
    return (objeto['@graph'] as unknown[]).flatMap((item) => localizarJobPostings(item));
  }

  return [];
}

function ehJobPosting(objeto: Record<string, unknown>): boolean {
  const tipo = objeto['@type'];
  if (typeof tipo === 'string') return tipo === 'JobPosting';
  if (Array.isArray(tipo)) return tipo.includes('JobPosting');
  return false;
}

function montarDeJobPosting(vaga: Record<string, unknown>): VagaEstruturada | null {
  const titulo = primeiroTexto(vaga['title']);
  const empresa = extrairEmpresa(vaga['hiringOrganization']);
  const requisitos = extrairRequisitos(vaga);
  const senioridade = extrairSenioridade(vaga);

  if (titulo === '' || empresa === '' || requisitos.length === 0) {
    return null;
  }

  return { titulo, empresa, requisitos, senioridade };
}

function extrairEmpresa(campo: unknown): string {
  if (typeof campo === 'string') return campo.trim();

  if (Array.isArray(campo)) {
    for (const item of campo) {
      const nome = extrairEmpresa(item);
      if (nome !== '') return nome;
    }
    return '';
  }

  if (typeof campo === 'object' && campo !== null) {
    return primeiroTexto((campo as Record<string, unknown>)['name']);
  }

  return '';
}

/**
 * Requisitos: prefere a lista estruturada; senão extrai itens da descrição,
 * que é o formato mais comum em sites menores.
 */
function extrairRequisitos(vaga: Record<string, unknown>): string[] {
  const structured = primeiroLista(vaga['requirements'] ?? vaga['qualifications']);
  if (structured.length > 0) return structured;

  const descricao = primeiroTexto(vaga['description']);
  if (descricao === '') return [];

  return extrairListaDaDescricao(descricao);
}

/**
 * Reconhece os marcadores mais usados por páginas de vaga: bullets de verdade,
 * vírgulas em frases curtas e blocos iniciados por marcador de skill.
 */
export function extrairListaDaDescricao(descricao: string): string[] {
  const linhas = descricao
    .split('\n')
    .map((linha) => linha.replace(/^[\s\-*•·‣▪►–—>]+/, '').trim())
    .filter((linha) => linha.length > 0 && linha.length <= 200);

  const candidatos = linhas.filter((linha) => /[-–—•*]/.test(linha) || linhas.length <= 8);

  if (candidatos.length >= 2) {
    return candidatos.slice(0, 30);
  }

  const porVirgula = descricao
    .split(/[,;\n]/)
    .map((parte) => parte.replace(/^[\s\-*•]+/, '').trim())
    .filter((parte) => parte.length > 1 && parte.length <= 200);

  return porVirgula.slice(0, 30);
}

function extrairSenioridade(vaga: Record<string, unknown>): string {
  const explicito = primeiroTexto(vaga['experienceRequirements']);
  if (explicito !== '') {
    return normalizarSenioridade(explicito);
  }

  const titulo = primeiroTexto(vaga['title']).toLowerCase();
  const descricao = primeiroTexto(vaga['description']).toLowerCase();

  const fonte = `${titulo} ${descricao}`;
  if (/\b(sênior|senior|sr\.?|especialista|staff|principal)\b/.test(fonte)) return 'Senior';
  if (/\b(pleno|mid[- ]?level|intermediário|intermediario)\b/.test(fonte)) return 'Pleno';
  if (/\b(júnior|junior|jr\.?|estágio|estagio|trainee|entry[- ]level)\b/.test(fonte)) return 'Junior';

  return 'Não informado';
}

function normalizarSenioridade(valor: string): string {
  const texto = valor.toLowerCase();
  if (/\b(sênior|senior|sr)\b/.test(texto)) return 'Senior';
  if (/\b(pleno|mid)\b/.test(texto)) return 'Pleno';
  if (/\b(júnior|junior|jr|estágio|estagio)\b/.test(texto)) return 'Junior';
  return 'Não informado';
}

/** Primeiro valor textual de um campo que pode ser string ou objeto com @value. */
function primeiroTexto(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number') return String(valor);

  if (Array.isArray(valor)) {
    for (const item of valor) {
      const texto = primeiroTexto(item);
      if (texto !== '') return texto;
    }
    return '';
  }

  if (typeof valor === 'object' && valor !== null) {
    const objeto = valor as Record<string, unknown>;
    return primeiroTexto(objeto['@value'] ?? objeto['name'] ?? objeto['text'] ?? '');
  }

  return '';
}

function primeiroLista(valor: unknown): string[] {
  if (typeof valor === 'string') return extrairListaDaDescricao(valor);
  if (!Array.isArray(valor)) return [];

  return valor
    .map((item) => primeiroTexto(item))
    .filter((texto): texto is string => texto !== '')
    .slice(0, 30);
}
