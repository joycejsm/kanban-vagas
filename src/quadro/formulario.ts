import { type CodigoErroIngestao } from '@/app/actions/erros';

/**
 * Como o formulário reage ao resultado de um envio.
 *
 * A decisão mora aqui, e não dentro do componente, pelo motivo de D3: o ambiente de testes do
 * projeto não alcança `.tsx`, e "falha de extração revela o campo de texto colado" é exatamente
 * o tipo de regra que precisa de asserção. Um `if` dentro do JSX seria comportamento que ninguém
 * consegue testar neste repositório.
 *
 * O formulário fala por **código**, nunca pela mensagem — `src/app/actions/erros.ts` diz que é
 * assim que a interface deve decidir. O motivo é que a apresentação correta depende da origem da
 * falha: duplicidade e limite de uso são avisos, porque nada quebrou e a vaga simplesmente não
 * entrou; extração falhou é o único caso em que há o que oferecer, que é o texto colado.
 */

/** Como a mensagem é apresentada. `aviso` é informativo; `erro` é uma falha. */
export type AparenciaDoAviso = 'erro' | 'aviso';

/**
 * O que o resultado de um envio diz para a tela mostrar.
 *
 * `mensagem` é sempre o texto que o servidor devolveu, nunca um texto montado aqui: a frase em
 * pt-BR é do servidor, e reescrevê-la no cliente criaria duas versões da mesma frase.
 */
export interface VisaoDoFormulario {
  mensagem: string | null;
  aparencia: AparenciaDoAviso | null;
  /** Revela o campo de texto colado, para a segunda tentativa. */
  mostrarCampoDeTexto: boolean;
  /** Limpa os campos depois de um cadastro bem-sucedido. */
  deveLimpar: boolean;
}

/**
 * O resultado de um envio, na forma que o formulário consome.
 *
 * Espelha o retorno de `adicionarVaga` e é declarado localmente, em vez de importado do módulo
 * `'use server'`: um tipo-only import atravessaria a fronteira do servidor para dentro de um
 * módulo que o teste carrega, e a dependência não compra nada — a forma já é a mesma.
 */
export type EstadoDoFormulario =
  | { ok: true; vaga: unknown }
  | { ok: false; code: CodigoErroIngestao; mensagem: string }
  | null;

/**
 * Aparência por código.
 *
 * Sem `default`: `APARENCIA_POR_CODIGO[codigo]` é um erro de typecheck quando nasce um código
 * novo, e não um `undefined` silencioso chegando na tela. É a mesma disciplina de
 * `CODIGO_POR_STATUS` em `erros.ts`, que nunca omite o caso não mapeado.
 */
const APARENCIA_POR_CODIGO: Record<CodigoErroIngestao, AparenciaDoAviso> = {
  duplicada: 'aviso',
  extracao_falhou: 'erro',
  limite_uso: 'aviso',
  sessao_expirada: 'erro',
  erro: 'erro',
};

/** Estado sem resultado nenhum: o formulário aparece limpo, sem mensagem. */
const VISAO_INICIAL: VisaoDoFormulario = {
  mensagem: null,
  aparencia: null,
  mostrarCampoDeTexto: false,
  deveLimpar: false,
};

/**
 * Traduz o resultado de um envio na apresentação do formulário.
 *
 * O sucesso não mostra mensagem: a vaga aparece no quadro, e um "cadastrado!" ao lado do card
 * novo seria redundante. O que ele faz é mandar limpar os campos, porque a próxima vaga colada
 * não é a que acabou de ser cadastrada.
 */
export function visaoDoFormulario(estado: EstadoDoFormulario): VisaoDoFormulario {
  if (estado === null) {
    return VISAO_INICIAL;
  }

  if (estado.ok) {
    return { mensagem: null, aparencia: null, mostrarCampoDeTexto: false, deveLimpar: true };
  }

  return {
    mensagem: estado.mensagem,
    aparencia: APARENCIA_POR_CODIGO[estado.code],
    // Só a extração falhada tem segunda tentativa de verdade. Nas outras, oferecer o campo de
    // texto seria sugerir uma solução para um problema em que o texto não muda nada.
    mostrarCampoDeTexto: estado.code === 'extracao_falhou',
    deveLimpar: false,
  };
}
