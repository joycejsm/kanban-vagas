import { describe, expect, it } from 'vitest';

import { MENSAGENS, type CodigoErroIngestao } from '@/app/actions/erros';
import { visaoDoFormulario, type EstadoDoFormulario } from '@/quadro/formulario';

/**
 * Testes da tradução de resultado em apresentação do formulário (design D9).
 *
 * A regra que importa aqui é "falha de extração oferece o texto colado, e só ela". É a diferença
 * entre uma tela que ajuda a pessoa a concluir o cadastro e uma que mostra um campo que não
 * muda nada, e ela mora numa função pura justamente porque o componente não é alcançável pelos
 * testes deste projeto.
 */

/** Falha com um código do enum, e a mensagem que o servidor realmente devolveu. */
function falha(code: CodigoErroIngestao): EstadoDoFormulario {
  return { ok: false, code, mensagem: MENSAGENS[code] };
}

const TODOS_OS_CODIGOS: CodigoErroIngestao[] = [
  'duplicada',
  'extracao_falhou',
  'limite_uso',
  'sessao_expirada',
  'erro',
];

describe('visaoDoFormulario — estado inicial', () => {
  it('não mostra mensagem, não revela campo de texto e não limpa', () => {
    expect(visaoDoFormulario(null)).toEqual({
      mensagem: null,
      aparencia: null,
      mostrarCampoDeTexto: false,
      deveLimpar: false,
    });
  });
});

describe('visaoDoFormulario — sucesso', () => {
  it('limpa os campos e não mostra mensagem', () => {
    // A vaga já aparece no quadro: um "cadastrado!" ao lado do card novo seria redundante.
    const visao = visaoDoFormulario({ ok: true, vaga: { id: 'x' } });

    expect(visao.deveLimpar).toBe(true);
    expect(visao.mensagem).toBeNull();
    expect(visao.aparencia).toBeNull();
    expect(visao.mostrarCampoDeTexto).toBe(false);
  });
});

describe('visaoDoFormulario — qual código revela o texto colado', () => {
  it('extracao_falhou é o único que revela o campo de texto', () => {
    expect(visaoDoFormulario(falha('extracao_falhou')).mostrarCampoDeTexto).toBe(true);
  });

  it('nenhum outro código revela o campo de texto', () => {
    // Oferecer o campo nas demais seria sugerir uma solução para um problema em que o texto
    // colado não muda a resposta: a vaga já está cadastrada, o limite é do servidor, ou a
    // sessão morreu.
    for (const code of TODOS_OS_CODIGOS.filter((c) => c !== 'extracao_falhou')) {
      expect(visaoDoFormulario(falha(code)).mostrarCampoDeTexto).toBe(false);
    }
  });

  it('um resultado posterior sem extração esconde o campo de novo', () => {
    // A segunda tentativa, com o texto colado, devolve outro resultado — e o campo não pode
    // continuar ali, sugerindo outra colagem que não resolve mais nada.
    const primeira = visaoDoFormulario(falha('extracao_falhou'));
    const segunda = visaoDoFormulario(falha('duplicada'));

    expect(primeira.mostrarCampoDeTexto).toBe(true);
    expect(segunda.mostrarCampoDeTexto).toBe(false);
  });
});

describe('visaoDoFormulario — apresentação por código', () => {
  it('duplicidade e limite de uso são avisos, não falhas', () => {
    // Nada quebrou: a vaga não entrou porque já existia, ou porque o servidor pediu para esperar.
    expect(visaoDoFormulario(falha('duplicada')).aparencia).toBe('aviso');
    expect(visaoDoFormulario(falha('limite_uso')).aparencia).toBe('aviso');
  });

  it('extração, sessão e erro genérico são falhas', () => {
    expect(visaoDoFormulario(falha('extracao_falhou')).aparencia).toBe('erro');
    expect(visaoDoFormulario(falha('sessao_expirada')).aparencia).toBe('erro');
    expect(visaoDoFormulario(falha('erro')).aparencia).toBe('erro');
  });

  it('toda falha tem aparência, sem código fora do mapa', () => {
    for (const code of TODOS_OS_CODIGOS) {
      expect(visaoDoFormulario(falha(code)).aparencia).not.toBeNull();
    }
  });
});

describe('visaoDoFormulario — a mensagem exibida é sempre a do servidor', () => {
  it('repassa o texto devolvido, sem reescrever', () => {
    for (const code of TODOS_OS_CODIGOS) {
      expect(visaoDoFormulario(falha(code)).mensagem).toBe(MENSAGENS[code]);
    }
  });

  it('uma falha de validação de entrada mostra a mensagem do schema, não uma de catálogo', () => {
    // `falhaDeEntrada` monta a frase a partir da issue do Zod, e ela não está em `MENSAGENS`.
    // O formulário precisa mostrar o que veio, não reconstruir o que o catálogo diz.
    const entrada: EstadoDoFormulario = {
      ok: false,
      code: 'erro',
      mensagem: 'URL inválida. Use o link completo da vaga.',
    };

    expect(visaoDoFormulario(entrada).mensagem).toBe('URL inválida. Use o link completo da vaga.');
  });

  it('nenhum código produz mensagem com stack trace, SQL ou chave de API', () => {
    for (const code of TODOS_OS_CODIGOS) {
      const mensagem = visaoDoFormulario(falha(code)).mensagem ?? '';

      expect(mensagem).not.toMatch(
        /at Object|Error:|stack|SELECT|INSERT|DELETE FROM|api[_-]?key|Bearer|eyJ/i,
      );
      expect(mensagem).not.toMatch(/GEMINI|SUPABASE|supabase\.co/i);
    }
  });

  it('as mensagens do formulário são as do catálogo, sem texto novo', () => {
    // O componente nunca escreve frase própria: se someday escrever, este teste quebra.
    const conhecidas = new Set<string>(Object.values(MENSAGENS));

    for (const code of TODOS_OS_CODIGOS) {
      expect(conhecidas.has(visaoDoFormulario(falha(code)).mensagem ?? '')).toBe(true);
    }
  });
});
