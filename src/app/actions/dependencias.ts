import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { lerConfiguracaoSupabase } from '@/config/serverEnv';
import { criarClienteServidor } from '@/lib/supabase/server';
import { VagaService } from '@/services/vagaService';

/**
 * Dependências das Server Actions, injetadas por módulo (design D10).
 *
 * Server Actions são chamadas pelo navegador com um argumento — o `FormData`. Não há como
 * passar um cliente Supabase como segundo parâmetro sem que isso vire mais uma entrada
 * pública da função. A injeção acontece por aqui, num módulo que a action importa e que os
 * testes substituem.
 *
 * O que este módulo compra: os testes de `adicionarVaga` e `atualizarStatus` rodam sem
 * banco, sem Edge Function e sem rede, e mesmo assim exercitam o caminho completo —
 * validação, sessão, encaminhamento, tradução de erro e revalidação. Sem isto, a única forma
 * de testar o mapeamento 409/422/429 seria subir a stack inteira.
 *
 * Duas invariantes moram aqui, e não na action:
 *
 * - o cliente é sempre o **do usuário**, montado com a chave anon e o JWT dos cookies. A
 *   service role key não é importada nem mencionada neste arquivo, e `criarVagaService`
 *   recebe o mesmo cliente — assim o RLS é o que autoriza cada escrita, não um privilégio
 *   (invariante 2);
 * - nenhuma dependência aceita `user_id`. Quem define o dono da linha é o banco, via
 *   `default auth.uid()` (invariante 3).
 *
 * `NEXT_PUBLIC_SUPABASE_URL` é lida por `lerConfiguracaoSupabase`, como todo o resto: este
 * projeto tem um único módulo que toca `process.env` para configuração, e uma leitura inline
 * aqui devolveria um `fetch` para a string `"undefined/functions/v1/ingest-vaga"` no dia em
 * que a variável faltar.
 */

/** Cliente do usuário autenticado da requisição. */
export type CriarClienteSupabase = () => Promise<SupabaseClient>;

/** Serviço de vagas sobre o cliente do usuário. */
export type CriarVagaService = (cliente: SupabaseClient) => VagaService;

/** Revalidação de caminho, isolada para o teste observar sem tocar no cache do Next. */
export type RevalidarCaminho = (caminho: string) => void;

/** URL da Edge Function de ingestão. */
export type ResolverUrlDaFuncao = () => string;

/** Chamada à Edge Function, com o token da sessão do usuário. */
export type InvocarFuncao = (entrada: {
  url: string;
  corpo: unknown;
  token: string;
}) => Promise<Response>;

/** O conjunto completo de dependências. */
export interface DependenciasDasActions {
  criarClienteSupabase: CriarClienteSupabase;
  criarVagaService: CriarVagaService;
  revalidarCaminho: RevalidarCaminho;
  resolverUrlDaFuncao: ResolverUrlDaFuncao;
  invocarFuncao: InvocarFuncao;
}

/**
 * Implementações reais.
 *
 * `invocarFuncao` vai direto ao `fetch` em vez de passar pelo `supabase-js`: a resposta da
 * função é um envelope HTTP próprio, e usar o cliente de dados para chamá-la trouxeria um
 * envelope diferente do que `mapearErroIngestao` entende. O token vai no cabeçalho
 * `Authorization` sem ser alterado, e é a função quem o revalida chamando `auth.getUser`
 * do outro lado.
 */
const PADRAO: DependenciasDasActions = {
  criarClienteSupabase: criarClienteServidor,

  criarVagaService: (cliente) => new VagaService(cliente),

  revalidarCaminho: (caminho) => {
    revalidatePath(caminho);
  },

  resolverUrlDaFuncao: () => {
    const { NEXT_PUBLIC_SUPABASE_URL } = lerConfiguracaoSupabase();
    return `${NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ingest-vaga`;
  },

  invocarFuncao: async ({ url, corpo, token }) =>
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
    }),
};

/**
 * Dependências ativas. Os testes trocam este binding; a produção nunca faz.
 *
 * `let` e não um objeto congelado porque a troca precisa ser visível para as actions, que leem
 * este binding no momento da chamada em vez de capturar uma referência na importação.
 */
let ativas: DependenciasDasActions = PADRAO;

/** Substitui as dependências. Usado só por teste; devolve a função que restaura as anteriores. */
export function substituirDependencias(
  substituicoes: Partial<DependenciasDasActions>,
): () => void {
  const anteriores = ativas;
  ativas = { ...anteriores, ...substituicoes };
  return () => {
    ativas = anteriores;
  };
}

/** Restaura as dependências reais. */
export function restaurarDependencias(): void {
  ativas = PADRAO;
}

/** Acesso às dependências ativas. */
export function dependencias(): DependenciasDasActions {
  return ativas;
}
