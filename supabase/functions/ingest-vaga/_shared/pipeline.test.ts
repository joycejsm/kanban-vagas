import { assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { describe, it } from 'jsr:@std/testing@1/bdd';

import type { VagaRow } from '@/domain/vaga';

import type { EnvConfig } from './env.ts';
import type { Dependencias, UsuarioAutenticado } from './pipeline.ts';
import {
  etapaAllowlist,
  etapaAutenticacao,
  etapaCors,
  etapaRateLimit,
  executarPipeline,
  extrairToken,
  LIMITE_POR_DIA,
  LIMITE_POR_HORA,
  usuarioTruncado,
} from './pipeline.ts';
import * as urlSafety from './urlSafety.ts';

/**
 * Módulo de URL dublê: aprova tudo, exceto o que o teste mandar recusar.
 * Sem isto, `validarUrl` chamaria o DNS real e os testes dependeriam de rede.
 */
function urlAceita(negadas: string[] = []) {
  return {
    ...urlSafety,
    validarUrl: (bruto: string) =>
      Promise.resolve(
        negadas.includes(bruto)
          ? { ok: false as const, razao: 'teste' }
          : { ok: true as const, url: bruto, enderecos: ['93.184.216.34'] },
      ),
  };
}

const CONFIG: EnvConfig = {
  geminiApiKey: 'chave',
  geminiModel: 'gemini-2.5-flash',
  allowedEmails: ['joyce@exemplo.com'],
  appOrigin: 'http://localhost:3000',
};

const USUARIO: UsuarioAutenticado = { id: 'abcdef12-3456-7890-abcd-ef1234567890', email: 'joyce@exemplo.com' };

const VAGA: VagaRow = {
  id: 'vaga-1',
  user_id: USUARIO.id,
  url: 'https://empresa.com/vaga/1',
  url_normalizada: 'https://empresa.com/vaga/1',
  titulo: 'Engenheira de Software',
  empresa: 'Empresa X',
  requisitos: ['TypeScript'],
  senioridade: 'Senior' as const,
  status: 'aplicado' as const,
  ordem: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const EXTRACAO_VALIDA = {
  titulo: 'Engenheira de Software',
  empresa: 'Empresa X',
  requisitos: ['TypeScript'],
  senioridade: 'Senior',
};

interface Rastros {
  buscar: number;
  extrair: number;
  inserir: number;
  registrar: number;
  marcar: string[];
}

function depsBase(
  sobrescritas: Partial<Dependencias> = {},
  negadas: string[] = [],
): { deps: Dependencias; rastros: Rastros } {
  const rastros: Rastros = { buscar: 0, extrair: 0, inserir: 0, registrar: 0, marcar: [] };

  const deps: Dependencias = {
    config: CONFIG,
    url: urlAceita(negadas),
    autenticar: () => Promise.resolve(USUARIO),
    registrarTentativa: () => {
      rastros.registrar++;
      return Promise.resolve({ hora: 1, dia: 1 });
    },
    buscar: () => {
      rastros.buscar++;
      return Promise.resolve('<html><body>Vaga</body></html>');
    },
    extrair: () => {
      rastros.extrair++;
      return Promise.resolve(EXTRACAO_VALIDA);
    },
    inserir: () => {
      rastros.inserir++;
      return Promise.resolve(VAGA);
    },
    marcarDesfecho: (resultado) => {
      rastros.marcar.push(resultado);
      return Promise.resolve();
    },
    ...sobrescritas,
  };

  return { deps, rastros };
}

function requisicao(
  opcoes: { metodo?: string; origem?: string | null; token?: string | null; corpo?: unknown } = {},
): Request {
  const metodo = opcoes.metodo ?? 'POST';
  const headers = new Headers();
  const origem = opcoes.origem === undefined ? CONFIG.appOrigin : opcoes.origem;
  if (origem !== null) headers.set('Origin', origem);
  if (opcoes.token) headers.set('Authorization', `Bearer ${opcoes.token}`);

  return new Request('http://localhost/ingest-vaga', {
    method: metodo,
    headers,
    body: metodo === 'GET' ? undefined : JSON.stringify(opcoes.corpo ?? { url: 'https://empresa.com/vaga/1' }),
  });
}

/** Silencia o console.error durante os testes e devolve o que foi escrito. */
function silenciarLogs(): () => string[] {
  const originalError = console.error;
  const originalInfo = console.info;
  const linhas: string[] = [];
  console.error = (...args: unknown[]) => linhas.push(args.map(String).join(' '));
  console.info = (...args: unknown[]) => linhas.push(args.map(String).join(' '));
  return () => {
    console.error = originalError;
    console.info = originalInfo;
    return linhas;
  };
}

describe('etapaCors', () => {
  it('aceita POST da origem configurada', () => {
    assertEquals(etapaCors(requisicao(), CONFIG), null);
  });

  it('recusa origem desconhecida', () => {
    const falha = etapaCors(requisicao({ origem: 'https://evil.com' }), CONFIG);

    assertEquals(falha?.status, 403);
  });

  it('recusa navegador de origem errada, que é o que a conferência existe para barrar', () => {
    // O caso acima, por outro ângulo: origem presente e diferente é sempre recusada. É a
    // proteção que importa, e ela não muda ao lado da aceitação da ausência.
    assertEquals(etapaCors(requisicao({ origem: 'https://app.exemplo.com:8443' }), CONFIG)?.status, 403);
    assertEquals(etapaCors(requisicao({ origem: 'https://localhost:3000' }), CONFIG)?.status, 403, 'esquema diferente');
    assertEquals(etapaCors(requisicao({ origem: 'http://localhost:3002' }), CONFIG)?.status, 403, 'porta diferente');
    assertEquals(etapaCors(requisicao({ origem: 'http://localhost:3000/x' }), CONFIG)?.status, 403, 'caminho');
  });

  it('aceita ausência de Origin, que é o que a chamada servidor-para-servidor produz', () => {
    // Server Action chama a função por `fetch` de Node, que não emite `Origin`: esse cabeçalho
    // é do user agent. Recusar a ausência matava toda requisição real do app em 403.
    assertEquals(etapaCors(requisicao({ origem: null }), CONFIG), null);
  });

  it('atende preflight da origem configurada', () => {
    assertEquals(etapaCors(requisicao({ metodo: 'OPTIONS' }), CONFIG), null);
  });

  it('recusa método diferente de POST', () => {
    assertEquals(etapaCors(requisicao({ metodo: 'GET' }), CONFIG)?.status, 405);
    assertEquals(etapaCors(requisicao({ metodo: 'DELETE' }), CONFIG)?.status, 405);
  });
});

describe('etapaAutenticacao', () => {
  it('recusa sem Authorization', async () => {
    const { deps, rastros } = depsBase();

    const r = await etapaAutenticacao(requisicao({ token: null }), deps);

    assertEquals(r.ok, false);
    assertEquals(rastros.registrar, 0, 'não registra tentativa sem autenticar');
  });

  it('recusa token inválido', async () => {
    const { deps } = depsBase({ autenticar: () => Promise.resolve(null) });

    const r = await etapaAutenticacao(requisicao({ token: 'invalido' }), deps);

    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.falha.status, 401);
  });

  it('aceita token válido', async () => {
    const { deps } = depsBase();

    const r = await etapaAutenticacao(requisicao({ token: 'valido' }), deps);

    assertEquals(r.ok, true);
  });
});

describe('extrairToken', () => {
  it('aceita Bearer com qualquer caixa', () => {
    assertEquals(extrairToken('Bearer abc'), 'abc');
    assertEquals(extrairToken('bearer abc'), 'abc');
    assertEquals(extrairToken('BEARER abc'), 'abc');
  });

  it('rejeita outros formatos', () => {
    assertEquals(extrairToken('abc'), null);
    assertEquals(extrairToken('Basic abc'), null);
    assertEquals(extrairToken('Bearer a b'), null);
    assertEquals(extrairToken(''), null);
    assertEquals(extrairToken(null), null);
  });
});

describe('etapaAllowlist', () => {
  it('aceita e-mail autorizado', () => {
    assertEquals(etapaAllowlist(USUARIO, CONFIG), null);
  });

  it('recusa e-mail fora da lista', () => {
    const falha = etapaAllowlist({ id: USUARIO.id, email: 'estranho@outro.com' }, CONFIG);

    assertEquals(falha?.status, 403);
  });

  it('recusa usuário sem e-mail', () => {
    assertEquals(etapaAllowlist({ id: USUARIO.id, email: null }, CONFIG)?.status, 403);
  });

  it('ignora caixa e espaços no e-mail', () => {
    const usuario: UsuarioAutenticado = { id: USUARIO.id, email: '  JOYCE@Exemplo.COM ' };

    assertEquals(etapaAllowlist(usuario, CONFIG), null);
  });
});

describe('etapaRateLimit', () => {
  it('aceita dentro do limite', async () => {
    const { deps } = depsBase();

    assertEquals(await etapaRateLimit(deps, 'empresa.com'), null);
  });

  it('recusa no 21º da hora', async () => {
    const { deps } = depsBase({
      registrarTentativa: () => Promise.resolve({ hora: LIMITE_POR_HORA + 1, dia: 5 }),
    });

    const falha = await etapaRateLimit(deps, 'empresa.com');

    assertEquals(falha?.status, 429);
  });

  it('recusa no 101º do dia, mesmo com menos de 20 na hora', async () => {
    const { deps } = depsBase({
      registrarTentativa: () => Promise.resolve({ hora: 3, dia: LIMITE_POR_DIA + 1 }),
    });

    assertEquals((await etapaRateLimit(deps, 'empresa.com'))?.status, 429);
  });

  it('os limites são 20/hora e 100/dia', () => {
    assertEquals(LIMITE_POR_HORA, 20);
    assertEquals(LIMITE_POR_DIA, 100);
  });
});

describe('usuarioTruncado', () => {
  it('nunca expõe o identificador inteiro', () => {
    const truncado = usuarioTruncado(USUARIO.id);

    assertEquals(truncado.includes(USUARIO.id), false);
    assertEquals(truncado.length < USUARIO.id.length, true);
  });
});

describe('executarPipeline — caminho feliz', () => {
  it('devolve 201 com a vaga', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase();

    const resposta = await executarPipeline(requisicao({ token: 'ok' }), deps);
    const corpo = await resposta.json();

    restaurar();

    assertEquals(resposta.status, 201);
    assertEquals((corpo as { vaga: typeof VAGA }).vaga.id, 'vaga-1');
    assertEquals(rastros.inserir, 1);
    assertEquals(rastros.marcar, ['sucesso']);
  });

  it('envia o header de CORS na resposta', async () => {
    const restaurar = silenciarLogs();
    const { deps } = depsBase();

    const resposta = await executarPipeline(requisicao({ token: 'ok' }), deps);
    restaurar();

    assertEquals(resposta.headers.get('Access-Control-Allow-Origin'), CONFIG.appOrigin);
  });

  it('requisição sem Origin chega ao fim, que é o caminho real do aplicativo', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase();

    // Este é o teste que faltava: ele exercita a costura entre a Server Action, que chama por
    // `fetch` de Node e não emite `Origin`, e a função. Nenhuma suíte isolada enxergava o
    // contrato entre as duas, e por isso 35 passos verdes coexistiam com a funcionalidade
    // inteira quebrada.
    const resposta = await executarPipeline(requisicao({ token: 'ok', origem: null }), deps);
    const corpo = await resposta.json();

    restaurar();

    assertEquals(resposta.status, 201);
    assertEquals((corpo as { vaga: typeof VAGA }).vaga.id, 'vaga-1');
    assertEquals(rastros.buscar, 1, 'a extração chegou a rodar');
    assertEquals(rastros.inserir, 1);
  });

  it('ausência de Origin não dispensa autenticação', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase({ autenticar: () => Promise.resolve(null) });

    const resposta = await executarPipeline(requisicao({ token: 'invalido', origem: null }), deps);

    restaurar();

    assertEquals(resposta.status, 401);
    assertEquals(rastros.buscar, 0, 'nenhuma extração sem sessão');
    assertEquals(rastros.inserir, 0);
  });

  it('ausência de Origin não dispensa a allowlist', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase({
      autenticar: () => Promise.resolve({ id: USUARIO.id, email: 'estranho@exemplo.com' }),
    });

    const resposta = await executarPipeline(requisicao({ token: 'ok', origem: null }), deps);

    restaurar();

    assertEquals(resposta.status, 403);
    assertEquals(rastros.buscar, 0, 'nenhuma extração fora da allowlist');
    assertEquals(rastros.inserir, 0);
  });
});

describe('executarPipeline — falhas encadeiam na ordem', () => {
  it('origem inválida interrompe antes de autenticar', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase();

    const resposta = await executarPipeline(requisicao({ origem: 'https://evil.com', token: 'ok' }), deps);
    restaurar();

    assertEquals(resposta.status, 403);
    assertEquals(rastros.registrar, 0);
    assertEquals(rastros.buscar, 0);
  });

  it('sem sessão interrompe antes da allowlist e do rate limit', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase();

    const resposta = await executarPipeline(requisicao({ token: null }), deps);
    restaurar();

    assertEquals(resposta.status, 401);
    assertEquals(rastros.registrar, 0);
    assertEquals(rastros.buscar, 0);
  });

  it('e-mail fora da allowlist interrompe antes do rate limit', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase({
      autenticar: () => Promise.resolve({ id: USUARIO.id, email: 'estranho@outro.com' }),
    });

    const resposta = await executarPipeline(requisicao({ token: 'ok' }), deps);
    restaurar();

    assertEquals(resposta.status, 403);
    assertEquals(rastros.registrar, 0);
    assertEquals(rastros.buscar, 0);
  });

  it('corpo inválido interrompe antes do rate limit', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase();

    const resposta = await executarPipeline(
      requisicao({ token: 'ok', corpo: { url: 'http://inseguro.com' } }),
      deps,
    );
    restaurar();

    assertEquals(resposta.status, 422);
    assertEquals(rastros.registrar, 0);
  });

  it('corpo com campo de servidor é rejeitado', async () => {
    const restaurar = silenciarLogs();
    const { deps } = depsBase();

    const resposta = await executarPipeline(
      requisicao({ token: 'ok', corpo: { url: 'https://empresa.com/1', user_id: USUARIO.id } }),
      deps,
    );
    restaurar();

    assertEquals(resposta.status, 422);
  });

  it('limite excedido interrompe antes de qualquer fetch', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase({
      registrarTentativa: () => Promise.resolve({ hora: 99, dia: 99 }),
    });

    const resposta = await executarPipeline(requisicao({ token: 'ok' }), deps);
    restaurar();

    assertEquals(resposta.status, 429);
    assertEquals(rastros.buscar, 0);
    assertEquals(rastros.extrair, 0);
  });

  it('URL bloqueada interrompe antes do fetch', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase({}, ['https://169.254.169.254/']);

    const resposta = await executarPipeline(
      requisicao({ token: 'ok', corpo: { url: 'https://169.254.169.254/' } }),
      deps,
    );
    restaurar();

    assertEquals(resposta.status, 422);
    assertEquals(rastros.buscar, 0, 'não deve abrir conexão com IP privado');
  });

  it('texto colado dispensa o scraping', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase();

    const resposta = await executarPipeline(
      requisicao({ token: 'ok', corpo: { url: 'https://empresa.com/1', texto: 'Vaga colada' } }),
      deps,
    );
    restaurar();

    assertEquals(resposta.status, 201);
    assertEquals(rastros.buscar, 0);
    assertEquals(rastros.extrair, 1);
  });
});

describe('executarPipeline — persistência', () => {
  it('23505 vira 409 com mensagem de duplicidade', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase({
      inserir: () => Promise.reject({ code: '23505', constraint: 'vagas_user_id_url_normalizada_key' }),
    });

    const resposta = await executarPipeline(requisicao({ token: 'ok' }), deps);
    const corpo = await resposta.json();

    restaurar();

    assertEquals(resposta.status, 409);
    assertEquals((corpo as { message: string }).message, 'Você já cadastrou esta vaga.');
    assertEquals(rastros.marcar, ['duplicada']);
  });

  it('erro inesperado vira 500 genérico, sem detalhe', async () => {
    const restaurar = silenciarLogs();
    const { deps } = depsBase({
      inserir: () => Promise.reject({ code: '42501', message: 'permission denied for table vagas' }),
    });

    const resposta = await executarPipeline(requisicao({ token: 'ok' }), deps);
    const texto = await resposta.text();

    restaurar();

    assertEquals(resposta.status, 500);
    assertEquals(texto.includes('permission denied'), false);
    assertEquals(texto.includes('42501'), false);
    assertEquals(texto.includes('stack'), false);
  });

  it('a URL persistida é a da requisição, nunca a devolvida pelo modelo', async () => {
    const restaurar = silenciarLogs();
    let urlEnviada = '';
    const { deps } = depsBase({
      extrair: () => Promise.resolve({ ...EXTRACAO_VALIDA, url: 'https://evil.com/fake' }),
      inserir: (dados) => {
        urlEnviada = dados.url;
        return Promise.resolve(VAGA);
      },
    });

    await executarPipeline(requisicao({ token: 'ok' }), deps);
    restaurar();

    assertEquals(urlEnviada, 'https://empresa.com/vaga/1');
    assertEquals(urlEnviada.includes('evil.com'), false);
  });

  it('extração fora do schema vira 422 sem repassar a saída', async () => {
    const restaurar = silenciarLogs();
    const { deps, rastros } = depsBase({
      extrair: () => Promise.resolve({ titulo: 'x'.repeat(300), empresa: 'E', requisitos: [] }),
    });

    const resposta = await executarPipeline(requisicao({ token: 'ok' }), deps);
    const texto = await resposta.text();

    restaurar();

    assertEquals(resposta.status, 422);
    assertEquals(rastros.inserir, 0);
    assertEquals(texto.includes('x'.repeat(50)), false, 'não vaza a saída do modelo');
  });
});

describe('logging', () => {
  it('não registra conteúdo, token, chave nem e-mail', async () => {
    const restaurar = silenciarLogs();
    const { deps } = depsBase({
      inserir: () => Promise.reject({ code: '42501', message: 'boom' }),
    });

    await executarPipeline(requisicao({ token: 'secreto-jwt' }), deps);
    const logs = restaurar();

    const tudo = logs.join('\n');
    assertMatch(tudo, /empresa\.com/);
    assertMatch(tudo, /etapa=%s/);
    assertMatch(tudo, /persistencia/, 'a etapa da falha deve constar no log');
    assertMatch(tudo, /42501/, 'o SQLSTATE é público e ajuda a diagnosticar');
    assertEquals(tudo.includes('secreto-jwt'), false);
    assertEquals(tudo.includes('chave'), false);
    assertEquals(tudo.includes('joyce@exemplo.com'), false);
    assertEquals(tudo.includes('Engenheira'), false);
    assertEquals(tudo.includes(USUARIO.id), false, 'usuário deve aparecer truncado');
  });

  it('registra o usuário truncado no caminho feliz', async () => {
    const restaurar = silenciarLogs();
    const { deps } = depsBase();

    await executarPipeline(requisicao({ token: 'ok' }), deps);
    const logs = restaurar();

    const tudo = logs.join('\n');
    assertMatch(tudo, /etapa=sucesso/);
    assertMatch(tudo, /empresa\.com/);
    assertEquals(tudo.includes(USUARIO.id), false);
  });

  it('nomeia a origem recusada, para o 403 não ser um mistério', async () => {
    const restaurar = silenciarLogs();
    const { deps } = depsBase();

    await executarPipeline(requisicao({ token: 'ok', origem: 'https://evil.com' }), deps);
    const logs = restaurar();

    // `silenciarLogs` junta a string de formato com os argumentos, sem interpolar — por isso o
    // valor da origem aparece solto, depois do `origem=%s`.
    const tudo = logs.join('\n');
    assertMatch(tudo, /origem=%s/, 'o campo da origem precisa estar no formato do log');
    assertMatch(tudo, /https:\/\/evil\.com:recusada/);
  });

  it('nomeia a origem configurada como aceita', async () => {
    const restaurar = silenciarLogs();
    const { deps } = depsBase({
      autenticar: () => Promise.resolve({ id: USUARIO.id, email: 'estranho@exemplo.com' }),
    });

    await executarPipeline(requisicao({ token: 'ok' }), deps);
    const logs = restaurar();

    assertMatch(logs.join('\n'), /http:\/\/localhost:3000:aceita/);
  });

  it('nomeia a origem ausente como aceita, que é o caminho do aplicativo', async () => {
    const restaurar = silenciarLogs();
    const { deps } = depsBase({
      autenticar: () => Promise.resolve({ id: USUARIO.id, email: 'estranho@exemplo.com' }),
    });

    await executarPipeline(requisicao({ token: 'ok', origem: null }), deps);
    const logs = restaurar();

    assertMatch(logs.join('\n'), /ausente:aceita/);
  });

  it('limita o tamanho da origem que vem do chamador', async () => {
    const restaurar = silenciarLogs();
    const enorme = `https://${'a'.repeat(500)}.com`;
    const { deps } = depsBase();

    await executarPipeline(requisicao({ token: 'ok', origem: enorme }), deps);
    const logs = restaurar();

    const linha = logs.find((l) => l.includes('origem=')) ?? '';
    assertEquals(linha.length < 400, true, `origem sem limite no log: ${linha.length} chars`);
  });
});
