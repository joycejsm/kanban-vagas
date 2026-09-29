import { assertEquals } from 'jsr:@std/assert@1';
import { describe, it } from 'jsr:@std/testing@1/bdd';

import {
  ehEnderecoPublico,
  ehIpLiteral,
  validarUrl,
  type ResolvedorDns,
} from './urlSafety.ts';

/** Resolver fixo: sempre devolve os mesmos endereços, qualquer que seja o host. */
function resolverFixo(v4: string[], v6: string[] = []): ResolvedorDns {
  return (_host, familia) => Promise.resolve(familia === 'A' ? v4 : v6);
}

const PUBLICO = resolverFixo(['93.184.216.34']);

describe('validarUrl — forma da URL', () => {
  it('recusa esquema que não é https', async () => {
    for (const url of ['http://empresa.com/vaga/1', 'ftp://empresa.com/vaga', 'file:///etc/passwd']) {
      const r = await validarUrl(url, PUBLICO);
      assertEquals(r.ok, false, url);
    }
  });

  it('recusa URL malformada', async () => {
    const r = await validarUrl('não é uma url', PUBLICO);
    assertEquals(r.ok, false);
  });

  it('recusa credenciais embutidas', async () => {
    const r = await validarUrl('https://usuario:senha@empresa.com/vaga/1', PUBLICO);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.razao, 'credenciais');
  });

  it('recusa porta não padrão', async () => {
    const r = await validarUrl('https://empresa.com:8443/vaga', PUBLICO);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.razao, 'porta');
  });

  it('aceita porta vazia e 443 explícita', async () => {
    assertEquals((await validarUrl('https://empresa.com/vaga', PUBLICO)).ok, true);
    assertEquals((await validarUrl('https://empresa.com:443/vaga', PUBLICO)).ok, true);
  });

  it('recusa URL acima de 2048 caracteres', async () => {
    const url = `https://empresa.com/${'a'.repeat(2100)}`;
    const r = await validarUrl(url, PUBLICO);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.razao, 'url-longa');
  });
});

describe('validarUrl — host não público', () => {
  const casos = [
    'https://127.0.0.1/vaga',
    'https://localhost/vaga',
    'https://LOCALHOST/vaga',
    'https://[::1]/vaga',
    'https://169.254.169.254/latest/meta-data/',
    'https://servidor.local/vaga',
    'https://api.internal/vaga',
    'https://box.localdomain/vaga',
  ];

  for (const url of casos) {
    it(`recusa ${url} antes de resolver`, async () => {
      let resolveu = false;
      const spy: ResolvedorDns = () => {
        resolveu = true;
        return Promise.resolve([]);
      };

      const r = await validarUrl(url, spy);
      assertEquals(r.ok, false, url);
      assertEquals(resolveu, false, 'não deveria nem resolver o DNS');
    });
  }

  it('recusa IPv4 em forma decimal (não canônica) por ser literal', async () => {
    const r = await validarUrl('https://2130706433/vaga', PUBLICO);
    assertEquals(r.ok, false);
  });
});

describe('validarUrl — faixas não públicas via DNS', () => {
  const faixas: readonly (readonly [string, string[], string[]])[] = [
    ['0.0.0.1', ['0.0.0.1'], []],
    ['10.1.2.3', ['10.1.2.3'], []],
    ['100.64.0.1', ['100.64.0.1'], []],
    ['127.0.0.1', ['127.0.0.1'], []],
    ['169.254.169.254', ['169.254.169.254'], []],
    ['172.16.5.4', ['172.16.5.4'], []],
    ['172.31.255.1', ['172.31.255.1'], []],
    ['192.168.1.1', ['192.168.1.1'], []],
    ['::1', [], ['::1']],
    ['fc00::1', [], ['fc00::1']],
    ['fd12:3456::1', [], ['fd12:3456::1']],
    ['fe80::1', [], ['fe80::1']],
    ['::', [], ['::']],
  ];

  for (const [nome, v4, v6] of faixas) {
    it(`recusa host público que resolve para ${nome}`, async () => {
      const r = await validarUrl('https://empresa.com/vaga', resolverFixo([...v4], [...v6]));
      assertEquals(r.ok, false, nome);
      if (!r.ok) assertEquals(r.razao, 'ip-nao-publico');
    });
  }

  it('recusa IPv4 mapeado em IPv6 apontando para faixa privada', async () => {
    const r = await validarUrl(
      'https://empresa.com/vaga',
      resolverFixo([], ['::ffff:10.0.0.1']),
    );
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.razao, 'ip-nao-publico');
  });

  it('recusa quando UM dos endereços é privado, mesmo com outro público', async () => {
    const r = await validarUrl('https://empresa.com/vaga', resolverFixo(['93.184.216.34', '10.0.0.5']));
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.razao, 'ip-nao-publico');
  });

  it('recusa host que não resolve', async () => {
    const r = await validarUrl('https://nao-existe.example/vaga', resolverFixo([]));
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.razao, 'dns-sem-resposta');
  });

  it('aceita host que resolve apenas para endereços públicos', async () => {
    const r = await validarUrl('https://empresa.com/vaga', resolverFixo(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']));
    assertEquals(r.ok, true);
    if (r.ok) {
      assertEquals(r.enderecos.length, 2);
    }
  });

  it('tolera falha de uma família sem reprovar a outra', async () => {
    const parcial: ResolvedorDns = (_h, familia) =>
      familia === 'A' ? Promise.resolve(['93.184.216.34']) : Promise.reject(new Error('sem AAAA'));

    assertEquals((await validarUrl('https://empresa.com/vaga', parcial)).ok, true);
  });
});

describe('ehEnderecoPublico', () => {
  it('classifica faixas públicas e privadas', () => {
    assertEquals(ehEnderecoPublico('93.184.216.34'), true);
    assertEquals(ehEnderecoPublico('8.8.8.8'), true);
    assertEquals(ehEnderecoPublico('1.1.1.1'), true);

    assertEquals(ehEnderecoPublico('10.0.0.1'), false);
    assertEquals(ehEnderecoPublico('172.32.0.1'), true, '172.32 está fora do /12');
    assertEquals(ehEnderecoPublico('172.31.255.255'), false);
    assertEquals(ehEnderecoPublico('2606:2800:220:1::1'), true);
    assertEquals(ehEnderecoPublico('2001:db8::1'), true, 'documentação não é link-local');
    assertEquals(ehEnderecoPublico('fe80::1'), false);
  });

  it('detecta literais IPv4 e IPv6', () => {
    assertEquals(ehIpLiteral('10.0.0.1'), true);
    assertEquals(ehIpLiteral('::1'), true);
    assertEquals(ehIpLiteral('empresa.com'), false);
    assertEquals(ehIpLiteral('meu-empresa.com.br'), false);
  });
});
