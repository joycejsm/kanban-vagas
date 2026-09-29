/**
 * Validação da configuração no arranque do servidor.
 *
 * Sem isto, o servidor sobe normalmente e a falha de configuração só aparece na primeira
 * requisição — exatamente o cenário que a decisão D4 rejeita: a aplicação "subiria sem Supabase
 * e falharia mais tarde". `instrumentation.ts` roda uma vez, quando o servidor sobe, e é o ponto
 *suportado para recusar a inicialização.
 *
 * O escopo é o desenvolvimento, como pede a spec: em produção a leitura acontece por requisição
 * na rota raiz, e o comportamento de lá é assunto da change de auth.
 */
export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  // Import dinâmico: em produção este módulo não deve nem avaliar a leitura de ambiente.
  const { lerConfiguracaoSupabase } = await import('@/config/serverEnv');

  try {
    lerConfiguracaoSupabase();
  } catch (erro) {
    // `ErroConfiguracaoSupabase` já carrega a mensagem final, sem stack trace e sem valor de
    // segredo. Reemitimos só ela para que o terminal mostre a causa, não um stack de módulo.
    throw new Error((erro as Error).message);
  }
}
