'use server';

import { z } from 'zod';

import { LIMITE_TEXTO_COLADO, LIMITE_URL, statusVagaSchema, vagaRowSchema } from '@/domain/vaga';

import { dependencias } from '@/app/actions/dependencias';
import {
  falhaDeEntrada,
  falhaDeSessao,
  mapearErroIngestao,
  type FalhaIngestao,
} from '@/app/actions/erros';

/**
 * Server Actions do quadro.
 *
 * Todas seguem o mesmo contrato (design D5): recebem entrada não confiável, devolvem um
 * objeto discriminado por `ok` e **nunca lançam**. Uma action que lança mostra a tela de
 * erro genérica do Next em produção, que perde o `digest` e entrega ao usuário uma página
 * morta em vez de uma mensagem.
 *
 * Nenhuma delas recebe `user_id` como parâmetro: o dono da linha é o banco, via
 * `default auth.uid()` (invariante 3).
 */

/** Retorno de sucesso de `adicionarVaga`. */
export interface SucessoVaga {
  ok: true;
  vaga: unknown;
}

/** Retorno de sucesso de `atualizarStatus`. Não devolve a linha, porque a UI já a tem. */
export interface SucessoMovimentacao {
  ok: true;
}

/**
 * Entrada de `adicionarVaga`, já extraída do `FormData`.
 *
 * Estrita de propósito: um campo a mais no formulário é material descartado, e o `.strict()`
 * torna isso visível em vez de silencioso. `texto` é o fallback para quando o scraping não
 * funciona — o site bloqueia, ou renderiza por JavaScript.
 */
const entradaVagaSchema = z
  .object({
    url: z
      .string({
        required_error: 'Informe a URL da vaga.',
        invalid_type_error: 'Informe a URL da vaga.',
      })
      .max(LIMITE_URL, 'A URL é longa demais.')
      .url('URL inválida. Use o link completo da vaga.')
      .refine((valor) => valor.startsWith('https://'), {
        message: 'A URL deve usar o protocolo https.',
      }),
    texto: z
      .string()
      .max(LIMITE_TEXTO_COLADO, 'O texto colado é longo demais.')
      .optional(),
  })
  .strict();

/**
 * Envelope de sucesso da Edge Function.
 *
 * A função responde `{ vaga }`, e é esse envelope que espelha `respostaSucessoSchema` lá
 * dentro. Validar o envelope inteiro com `vagaRowSchema` aceitaria uma resposta sem a chave
 * `vaga` e devolveria uma falha de validação — daí o schema separado.
 */
const respostaSucessoSchema = z.object({ vaga: vagaRowSchema });

/** Leitura de um campo do `FormData`, colapsando ausente, arquivo e string vazia em `undefined`. */
function campo(formData: FormData, nome: string): string | undefined {
  const valor = formData.get(nome);
  return typeof valor === 'string' && valor.trim() !== '' ? valor : undefined;
}

/**
 * Monta o corpo do encaminhamento sem chaves `undefined`.
 *
 * O Zod preserva a chave com valor `undefined` quando o campo é opcional, e `JSON.stringify`
 * a descartaria só na hora de enviar. Remover aqui deixa o objeto entregue à função igual ao
 * que vai na rede — e faz o teste conseguir afirmar a forma do payload sem depender dessa
 * coincidência.
 */
function corpoParaEnviar(dados: { url: string; texto?: string }): { url: string; texto?: string } {
  return dados.texto === undefined ? { url: dados.url } : { url: dados.url, texto: dados.texto };
}

/**
 * Cria uma vaga, encaminhando a URL para a Edge Function.
 *
 * A ordem das etapas é a ordem das barreiras, e cada uma é um ponto de saída:
 *
 * 1. valida a entrada — antes de qualquer efeito, e portanto antes de gastar rede;
 * 2. resolve o usuário com `getUser()` no servidor;
 * 3. encaminha para a Edge Function com o token da sessão;
 * 4. no sucesso, revalida `/` para o quadro refletir a vaga nova.
 *
 * Não há scraping nem chamada de modelo aqui (design D6): o Next não tem o timeout nem o
 * limite de stream da Edge Function, e duplicar o pipeline criaria uma segunda política de
 * SSRF e uma segunda forma de normalizar URL. `GEMINI_API_KEY` não entra no bundle do
 * servidor por este caminho.
 */
export async function adicionarVaga(formData: FormData): Promise<SucessoVaga | FalhaIngestao> {
  // 1. Validação. Um `FormData` é entrada externa como qualquer outra.
  const validado = entradaVagaSchema.safeParse({
    url: campo(formData, 'url'),
    texto: campo(formData, 'texto'),
  });

  if (!validado.success) {
    return falhaDeEntrada(primeiraMensagem(validado.error));
  }

  // 2. Sessão, antes de qualquer escrita ou chamada de rede.
  const deps = dependencias();
  const cliente = await deps.criarClienteSupabase();
  const sessao = await resolverSessao(cliente);

  if (sessao === null) {
    return falhaDeSessao();
  }

  // 3. Encaminhamento. O corpo é `{ url, texto }` e nada mais: a função valida de novo com
  //    o mesmo schema de domínio, e o que ela recebe não decide quem é o dono da vaga.
  const resposta = await deps.invocarFuncao({
    url: deps.resolverUrlDaFuncao(),
    corpo: corpoParaEnviar(validado.data),
    token: sessao.token,
  });

  if (!resposta.ok) {
    return mapearErroIngestao(resposta.status, await lerCorpoSeguro(resposta));
  }

  // A função respondeu 2xx. O que volta ainda é material externo e passa pelo schema do
  // domínio: um envelope inesperado vira erro genérico, nunca um objeto meio preenchido que
  // a interface tentaria renderizar.
  const linha = respostaSucessoSchema.safeParse(await lerCorpoSeguro(resposta));
  if (!linha.success) {
    return mapearErroIngestao(502);
  }

  // 4. Revalidação, só no caminho feliz (design D8).
  deps.revalidarCaminho('/');

  return { ok: true, vaga: linha.data.vaga };
}

/**
 * Entrada de `atualizarStatus`.
 *
 * `user_id` e `status` não entram: o primeiro é do banco, o segundo é o campo que esta action
 * existe para mudar. O `.strict()` faz uma tentativa de forjar `user_id` no payload ser uma
 * falha de validação, e não um campo silenciosamente ignorado.
 */
const entradaMovimentacaoSchema = z
  .object({
    vagaId: z.string({ invalid_type_error: 'Identificador de vaga inválido.' }).uuid('Identificador de vaga inválido.'),
    novoStatus: statusVagaSchema,
    ordem: z.number().int().optional(),
  })
  .strict();

/**
 * Move a vaga para outra coluna e/ou posição.
 *
 * Não revalida (design D8): o drop é otimista, a reordenação pode afetar várias linhas, e
 * revalidar a cada card durante um drag burst causaria uma enxurrada de re-render. A UI
 * atualiza localmente e o próximo carregamento já reflete o banco.
 *
 * "Não encontrada" cobre tanto id inexistente quanto vaga de outro usuário, e a resposta é
 * idêntica nos dois casos: confirmar que um id alheio existe é um oráculo de enumeração
 * (design D7).
 */
export async function atualizarStatus(
  entrada: unknown,
): Promise<SucessoMovimentacao | FalhaIngestao> {
  const validado = entradaMovimentacaoSchema.safeParse(entrada);
  if (!validado.success) {
    return falhaDeEntrada(primeiraMensagem(validado.error));
  }

  const deps = dependencias();
  const cliente = await deps.criarClienteSupabase();
  const sessao = await resolverSessao(cliente);

  if (sessao === null) {
    return falhaDeSessao();
  }

  const { vagaId, novoStatus, ordem } = validado.data;

  try {
    const service = deps.criarVagaService(cliente);
    const atualizada = await service.atualizarStatus(vagaId, novoStatus, ordem);

    if (atualizada === null) {
      return { ok: false, code: 'erro', mensagem: 'Vaga não encontrada.' };
    }

    return { ok: true };
  } catch {
    // A falha do serviço já foi registrada no log por `vagaService`, com o SQLSTATE e a
    // operação. Aqui só sobra a tradução para a tela, e ela é sempre a mesma: um erro de
    // banco nunca vira a mensagem que o usuário lê.
    return {
      ok: false,
      code: 'erro',
      mensagem: 'Não foi possível mover a vaga. Tente novamente.',
    };
  }
}

/** Cliente reduzido ao que a resolução de sessão consome. */
interface ClienteComSessao {
  auth: {
    getUser(): Promise<{ data: { user: unknown } | null; error: unknown }>;
    getSession(): Promise<{
      data: { session: { access_token?: string } | null } | null;
      error: unknown;
    }>;
  };
}

/**
 * Resolve o usuário autenticado e o token de sessão.
 *
 * `getUser()` decide se há sessão — é uma ida ao Auth, e é o que a decisão D2 exige. O token
 * reencaminhado para a Edge Function vem de `getSession()`, e a diferença importa: aqui
 * `getSession` **não valida nada**, ele só lê o cookie já validado acima para extrair uma
 * string. Quem valida o token de fato é a função, chamando `auth.getUser` do outro lado.
 * Tratar o `getSession` deste ponto como validação seria relaxingar D2 sem perceber.
 *
 * @returns `null` quando não há sessão válida, ou quando não há token para reencaminhar.
 */
async function resolverSessao(cliente: ClienteComSessao): Promise<{ token: string } | null> {
  const { data, error } = await cliente.auth.getUser();

  if (error !== null || data?.user === null || data?.user === undefined) {
    return null;
  }

  const sessao = await cliente.auth.getSession();
  const token = sessao.data?.session?.access_token;

  if (sessao.error !== null || token === undefined || token === '') {
    return null;
  }

  return { token };
}

/** Lê o corpo da resposta sem deixar exceção escapar. */
async function lerCorpoSeguro(resposta: Response): Promise<unknown> {
  try {
    return await resposta.json();
  } catch {
    // 5xx do gateway às vezes vem sem corpo, ou com HTML. Isso não pode virar exceção.
    return undefined;
  }
}

/** Primeira mensagem do Zod, já em pt-BR, sem a estrutura de issue que o Zod anexa. */
function primeiraMensagem(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? 'Dados inválidos.';
}
