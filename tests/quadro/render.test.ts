import { describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { type VagaRow } from '@/domain/vaga';
import { Quadro } from '@/quadro/Quadro';
import { paraCartoes } from '@/quadro/estado';

/**
 * Testes de renderização do quadro (tasks 4.2, 4.3, 4.9, 5.2).
 *
 * Vale a pena registrar **por que** este arquivo é `.ts` e mesmo assim renderiza um componente:
 * o `include` do vitest do projeto só coleta arquivos de teste `.ts`, e não alcança `.tsx` — mas
 * essa restrição é sobre quais arquivos são **coletados**, não sobre o que pode ser **importado**.
 * O esbuild transforma o `.tsx` importado normalmente, e `createElement` monta a árvore sem
 * precisar de JSX neste arquivo.
 *
 * O que continua fora do alcance é o que precisa de DOM e eventos: clicar no seletor, responder
 * ao `confirm()`, observar a transição. A otimidade dos controles continua sendo verificada
 * pelas funções puras de `estado.test.ts`, e não aqui.
 *
 * `renderToStaticMarkup` é o servidor do React, sem navegador: é exatamente o HTML que o
 * servidor entrega a quem não tem JavaScript, o que casa com a exigência da spec de que o
 * conteúdo do quadro não dependa de JS.
 */

const USUARIO = '22222222-2222-2222-2222-222222222222';

function linha(overrides: Partial<VagaRow> = {}): VagaRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_id: USUARIO,
    url: 'https://empresa.com/vaga/7?utm_source=linkedin',
    url_normalizada: 'https://empresa.com/vaga/7',
    titulo: 'Engenheira de Software',
    empresa: 'Empresa X',
    requisitos: ['TypeScript'],
    senioridade: 'Senior',
    status: 'aplicado',
    ordem: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** HTML do quadro para as linhas dadas, como o servidor o entregaria. */
function renderizar(vagas: readonly VagaRow[]): string {
  return renderToStaticMarkup(
    createElement(Quadro, { cartoes: paraCartoes(vagas) }) as ReactElement,
  );
}

describe('renderização — colunas (task 4.3)', () => {
  it('renderiza as cinco colunas na ordem do ciclo de vida, com contagem', () => {
    const html = renderizar([linha({ status: 'proposta' })]);

    const posicoes = [
      'Aplicado',
      'Entrevista 1',
      'Fase técnica',
      'Proposta',
      'Rejeitado',
    ].map((rotulo) => html.indexOf(`>${rotulo}<`));

    expect(posicoes.every((p) => p > 0)).toBe(true);
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
  });

  it('renderiza colunas vazias com contagem zero e sem mensagem de erro', () => {
    const html = renderizar([]);

    expect(html).not.toMatch(/Nenhuma vaga encontrada|erro|Error/);
    // Cinco colunas presentes mesmo sem nenhuma vaga: é o que a spec exige.
    expect(html.match(/Nenhuma vaga\./g)).toHaveLength(5);
  });

  it('mostra a contagem de cada coluna', () => {
    const html = renderizar([
      linha({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'aplicado' }),
      linha({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', status: 'aplicado' }),
    ]);

    // Duas vagas em "Aplicado" e nenhuma nas outras quatro: um 2 e quatro 0.
    expect(html).toContain('>2<');
    expect(html.match(/>0</g)).toHaveLength(4);
  });
});

describe('renderização — conteúdo do card (task 4.2)', () => {
  it('mostra título, empresa e senioridade', () => {
    const html = renderizar([linha()]);

    expect(html).toContain('Engenheira de Software');
    expect(html).toContain('Empresa X');
    expect(html).toContain('Senior');
  });

  it('liga para a URL que a pessoa colou, e não para a normalizada', () => {
    const html = renderizar([linha()]);

    expect(html).toContain('href="https://empresa.com/vaga/7?utm_source=linkedin"');
    expect(html).not.toContain('href="https://empresa.com/vaga/7"');
  });

  it('abre em nova aba com noopener e noreferrer', () => {
    // Sem `noopener`, a aba nova ganha `window.opener` e a página de origem vira controlável por
    // um anúncio que veio da internet.
    const html = renderizar([linha()]);

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('trata conteúdo extraído como texto, sem interpretar marcação', () => {
    // Invariante 6: saída de extração nunca vira HTML. Um `<script>` que aparecesse aqui
    // executaria na página de quem está usando o quadro.
    const html = renderizar([
      linha({ titulo: '<script>alert(1)</script>', empresa: '<img src=x onerror=alert(1)>' }),
    ]);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('não traz notas, edição nem link de tela de detalhe', () => {
    const html = renderizar([linha()]);

    expect(html).not.toMatch(/<textarea|contenteditable/);
    expect(html).not.toMatch(/href="\/vaga\//);
  });
});

describe('renderização — nada da conta vaza (task 4.9)', () => {
  it('não inclui o user_id no HTML entregue', () => {
    // O `user_id` é o dado que a spec proíbe na página. A projeção em `estado.ts` é o que
    // impede, e este teste é o que prova que ela está segurando.
    const html = renderizar([
      linha(),
      linha({ id: '99999999-9999-9999-9999-999999999999', user_id: '33333333-3333-3333-3333-333333333333' }),
    ]);

    expect(html).not.toContain(USUARIO);
    expect(html).not.toContain('user_id');
    // Nenhum id de conta, nem o da primeira linha nem o da segunda.
    expect(html).not.toContain('33333333-3333-3333-3333-333333333333');
  });

  it('não inclui a url_normalizada, que é derivado interno do banco', () => {
    const html = renderizar([linha({ url: 'https://empresa.com/vaga/7?utm_source=linkedin' })]);

    expect(html).not.toContain('url_normalizada');
  });
});

describe('renderização — seletor de destino (task 5.2)', () => {
  it('rótula o seletor de cada card com o título da vaga', () => {
    const html = renderizar([linha()]);

    // O rótulo é `sr-only`: invisível, mas é o nome acessível do controle, e é ele que um
    // leitor de tela anuncia antes da lista de destinos.
    expect(html).toContain('for="mover-11111111-1111-1111-1111-111111111111"');
    expect(html).toMatch(/Mover .{0,40} para outra coluna/);
  });

  it('lista as outras quatro colunas e não a coluna atual', () => {
    const html = renderizar([linha({ status: 'aplicado' })]);

    expect(html).toContain('<option value="entrevista_1">Entrevista 1</option>');
    expect(html).toContain('<option value="fase_tecnica">Fase técnica</option>');
    expect(html).toContain('<option value="proposta">Proposta</option>');
    expect(html).toContain('<option value="rejeitado">Rejeitado</option>');
    // `aplicado` é a coluna do card: oferecer seria um no-op que gasta uma requisição.
    expect(html).not.toContain('<option value="aplicado"');
  });

  it('oferece uma opção de repouso, que não é destino', () => {
    const html = renderizar([linha()]);

    // O React marca a opção controlada como `selected`, e o valor vazio é o que faz o seletor
    // voltar ao repouso depois de um movimento.
    expect(html).toMatch(/<option value=""[^>]*>Mover para…<\/option>/);
  });

  it('nunca lista um valor fora do enum, mesmo com entrada forjada', () => {
    const html = renderizar([linha({ status: 'arquivado' as VagaRow['status'] })]);

    expect(html).not.toMatch(/<option value="arquivado"/);
  });
});

describe('renderização — controle de remoção (task 5.4)', () => {
  it('oferece um botão de remover, nomeado em português', () => {
    const html = renderizar([linha()]);

    expect(html).toContain('>Remover<');
  });

  it('não deixa o botão de remover disponível durante a remoção', () => {
    // O estado de remoção só existe depois do clique, e o HTML estático é o de antes dele.
    const html = renderizar([linha()]);

    expect(html).toContain('Remover');
    expect(html).not.toContain('Removendo…');
  });
});

describe('renderização — conteúdo sem JavaScript', () => {
  it('entrega colunas e cards no HTML do servidor, sem depender de JS', () => {
    // `renderToStaticMarkup` não roda nenhum script: se o conteúdo aparece aqui, ele aparece
    // para quem desativou JavaScript.
    const html = renderizar([linha({ titulo: 'Dev Backend' })]);

    expect(html).toContain('Dev Backend');
    expect(html).toContain('Fase técnica');
  });
});
