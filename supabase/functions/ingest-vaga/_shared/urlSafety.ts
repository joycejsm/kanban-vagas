/**
 * Resolução de host e verificação de faixas não públicas.
 *
 * RISCO RESIDUAL CONHECIDO — DNS rebinding (design D4)
 *
 * Entre a resolução DNS que aprovamos aqui e o `fetch` que abre a conexão, o
 * servidor de nomes pode responder diferente. Edge Functions não permitem fixar o
 * IP resolvido no `fetch` (não há `lookup` customizado nem socket cru), então esta
 * validação NÃO fecha o problema de forma absoluta.
 *
 * Mitigações adotadas:
 *  1. a função roda em ambiente sem acesso a redes privadas (RFC1918 e
 *     169.254.169.254 não são alcançáveis a partir do isolate);
 *  2. o corpo bruto da resposta nunca é devolvido ao cliente — apenas campos
 *     extraídos e revalidados por schema;
 *  3. o fetch tem timeout de 8 s, limitando quanto tempo uma conexão pode ser
 *     mantida viva.
 */

/** Resolução injetável: em produção é o `Deno.resolveDns`; em teste, um dublê. */
export type ResolvedorDns = (hostname: string, familia: 'A' | 'AAAA') => Promise<string[]>;

export type ResultadoValidacaoUrl =
  | { ok: true; url: string; enderecos: string[] }
  | { ok: false; razao: string };

/** Uma URL passa por estes passos, nesta ordem, antes de qualquer conexão. */
export const LIMITE_URL = 2048;

interface FaixaIpv4 {
  base: [number, number, number, number];
  bits: number;
}

/** Faixas não públicas (RFC 1918, loopback, link-local, CGNAT e equivalentes IPv6). */
/** Resolver padrão do runtime; os testes injetam um dublê. */
export const resolverDnsPadrao: ResolvedorDns = (hostname, familia) => {
  const tipo = familia === 'A' ? 'A' : 'AAAA';
  return Deno.resolveDns(hostname, tipo);
};

export const FAIXAS_BLOQUEADAS: FaixaIpv4[] = [
  { base: [0, 0, 0, 0], bits: 8 }, // "este host"
  { base: [10, 0, 0, 0], bits: 8 },
  { base: [100, 64, 0, 0], bits: 10 }, // CGNAT
  { base: [127, 0, 0, 0], bits: 8 },
  { base: [169, 254, 0, 0], bits: 16 }, // metadados de cloud
  { base: [172, 16, 0, 0], bits: 12 },
  { base: [192, 168, 0, 0], bits: 16 },
  { base: [224, 0, 0, 0], bits: 4 }, // multicast
  { base: [240, 0, 0, 0], bits: 4 }, // reservado
];

const SUFIXOS_BLOQUEADOS = ['.local', '.internal', '.localhost', '.localdomain', '.home.arpa'];

/** Nomes que nunca alcançam a internet pública. */
const NOMES_BLOQUEADOS = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

/**
 * Valida a URL completa: forma, host e resolução DNS.
 *
 * É a MESMA função usada na entrada e em cada redirect — por isso ela é pura em
 * relação ao `fetch` e recebe o resolvedor por parâmetro (design D3).
 */
export async function validarUrl(
  bruto: string,
  resolver: ResolvedorDns = resolverDnsPadrao,
): Promise<ResultadoValidacaoUrl> {
  if (bruto.length > LIMITE_URL) {
    return { ok: false, razao: 'url-longa' };
  }

  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return { ok: false, razao: 'url-malformada' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, razao: 'esquema' };
  }

  // Credenciais embutidas (user:pass@) são rejeitadas: são tanto um vetor de
  // phishing quanto uma forma de smuglar dados no host.
  if (url.username !== '' || url.password !== '') {
    return { ok: false, razao: 'credenciais' };
  }

  if (url.port !== '' && url.port !== '443') {
    return { ok: false, razao: 'porta' };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (NOMES_BLOQUEADOS.has(host) || SUFIXOS_BLOQUEADOS.some((s) => host.endsWith(s))) {
    return { ok: false, razao: 'host-interno' };
  }

  if (ehIpLiteral(host)) {
    // IP literal nunca é aceito: pode apontar para a rede interna ou para a
    // interface da própria função.
    return { ok: false, razao: 'ip-literal' };
  }

  let enderecos: string[];
  try {
    const [v4, v6] = await Promise.all([
      resolver(url.hostname, 'A').catch(() => [] as string[]),
      resolver(url.hostname, 'AAAA').catch(() => [] as string[]),
    ]);
    enderecos = [...v4, ...v6];
  } catch {
    return { ok: false, razao: 'dns' };
  }

  if (enderecos.length === 0) {
    return { ok: false, razao: 'dns-sem-resposta' };
  }

  // Qualquer endereço não público recusa o destino inteiro (design D3).
  for (const endereco of enderecos) {
    if (!ehEnderecoPublico(endereco)) {
      return { ok: false, razao: 'ip-nao-publico' };
    }
  }

  return { ok: true, url: url.toString(), enderecos };
}

/** Detecta IPv4 e IPv6 literais, incluindo as formas abreviadas do IPv6. */
export function ehIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':');
}

/**
 * Verdadeiro apenas para endereços globalmente roteáveis.
 *
 * `::ffff:10.0.0.1` é normalizado antes da comparação — sem isso o mapeamento
 * IPv4-in-IPv6 passaria despercebido por comparação textual.
 */
export function ehEnderecoPublico(endereco: string): boolean {
  const ipv4Mapeado = extrairIpv4Mapeado(endereco);
  if (ipv4Mapeado !== null) {
    return ehIpv4Publico(ipv4Mapeado);
  }

  if (endereco.includes(':')) {
    return ehIpv6Publico(endereco);
  }

  return ehIpv4Publico(endereco);
}

function ehIpv4Publico(endereco: string): boolean {
  const partes = endereco.split('.').map(Number);
  if (partes.length !== 4 || partes.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }

  return !FAIXAS_BLOQUEADAS.some((faixa) => dentroDaFaixa(partes, faixa));
}

function dentroDaFaixa(partes: number[], faixa: FaixaIpv4): boolean {
  const numero =
    (((partes[0] ?? 0) << 24) >>> 0) + ((partes[1] ?? 0) << 16) + ((partes[2] ?? 0) << 8) + (partes[3] ?? 0);
  const mascara = faixa.bits === 0 ? 0 : (0xffffffff << (32 - faixa.bits)) >>> 0;
  const base =
    ((faixa.base[0] << 24) >>> 0) + (faixa.base[1] << 16) + (faixa.base[2] << 8) + faixa.base[3];

  return ((numero & mascara) >>> 0) === ((base & mascara) >>> 0);
}

function ehIpv6Publico(endereco: string): boolean {
  const normalizado = normalizarIpv6(endereco);
  if (normalizado === null) {
    return false;
  }

  // Cada elemento é um GRUPO de 16 bits, não um byte de 8 — as máscaras abaixo
  // deslocam em cima do grupo inteiro.
  const gruposNumericos = normalizado.split(':').map((grupo) => parseInt(grupo, 16));

  // :: (não roteável) e ::1 (loopback)
  const todosZero = gruposNumericos.every((g) => g === 0);
  const loopback = gruposNumericos.slice(0, 7).every((g) => g === 0) && gruposNumericos[7] === 1;
  if (todosZero || loopback) {
    return false;
  }

  const primeiro = gruposNumericos[0] ?? 0;

  // fe80::/10 — link-local. fe80 = 1111111010......, os 10 bits mais altos.
  if ((primeiro >> 6) === 0x3fa) {
    return false;
  }

  // fc00::/7 — unique local. fc00 = 1111110......., os 7 bits mais altos.
  if ((primeiro >> 9) === 0x7e) {
    return false;
  }

  // ff00::/8 — multicast
  if ((primeiro >> 8) === 0xff) {
    return false;
  }

  return true;
}

/** Expande `::` e retorna 8 grupos em hexadecimal minúsculo, ou `null` se inválido. */
function normalizarIpv6(endereco: string): string | null {
  let texto = endereco.toLowerCase();

  if (!/^[0-9a-f:]+$/.test(texto)) {
    return null;
  }

  // Elimina eventual zona (fe80::1%eth0).
  const percent = texto.indexOf('%');
  if (percent >= 0) texto = texto.slice(0, percent);

  const duplo = texto.indexOf('::');
  if (duplo >= 0 && texto.indexOf('::', duplo + 1) >= 0) {
    return null;
  }

  const lados = texto.split('::');
  const esquerda = lados[0] === '' ? [] : lados[0].split(':');
  const direita = lados.length === 2 ? (lados[1] === '' ? [] : lados[1].split(':')) : [];
  const faltantes = 8 - esquerda.length - direita.length;

  if (lados.length === 1) {
    if (esquerda.length !== 8) return null;
  } else if (faltantes < 1) {
    return null;
  }

  const grupos = [
    ...esquerda,
    ...Array.from({ length: faltantes }, () => '0'),
    ...direita,
  ];

  if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) {
    return null;
  }

  return grupos.join(':');
}

/** `::ffff:192.168.0.1` → `192.168.0.1`. Demais formas retornam `null`. */
function extrairIpv4Mapeado(endereco: string): string | null {
  const normalizado = normalizarIpv6(endereco);
  if (normalizado === null) return null;

  const grupos = normalizado.split(':');
  // ::ffff:a.b.c.d — os 5 primeiros grupos zerados e o sexto = ffff
  if (grupos.slice(0, 5).every((g) => g === '0') && grupos[5] === 'ffff') {
    const alta = parseInt(grupos[6] ?? '0', 16);
    const baixa = parseInt(grupos[7] ?? '0', 16);
    return [alta >> 8, alta & 0xff, baixa >> 8, baixa & 0xff].join('.');
  }

  return null;
}
