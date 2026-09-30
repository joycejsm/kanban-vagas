/**
 * Origem da requisição, para montar o `redirectTo` do OAuth.
 *
 * Vem do cabeçalho e não de uma variável de ambiente porque o app tem um endereço só em tempo
 * de execução — `localhost` em desenvolvimento, o domínio real em produção — e criar uma
 * variável pública para isso colocaria no ambiente do navegador um valor que só o servidor
 * precisa (invariante 1). A lista de `NEXT_PUBLIC_*` continua com as duas do Supabase.
 *
 * A origem é reconstruída a partir de cabeçalhos que, em última instância, o cliente controla.
 * Isso não é uma brecha: o que decide se o retorno do OAuth é aceito é a lista de redirect URI
 * registrada no Supabase, e um `redirectTo` forjado é rejeitado por lá. Aqui o objetivo é só
 * montar um endereço para o mesmo app que está respondendo.
 */

/** Cabeçalhos usados, em ordem de preferência. `Headers` do Fetch — nada do Next nesta função. */
export type CabecalhosDaRequisicao = Pick<Headers, 'get'>;

/**
 * Devolve a origem da requisição, sem barra final.
 *
 * @throws {Error} quando não há host conhecido — sem ele não há para onde enviar o usuário
 * depois do login, e inventar um destino seria pior do que falhar.
 */
export function resolverOrigem(cabecalhos: CabecalhosDaRequisicao): string {
  const direta = cabecalhos.get('origin');
  if (direta !== null && direta !== '') {
    return semBarraFinal(direta);
  }

  const host = cabecalhos.get('x-forwarded-host') ?? cabecalhos.get('host');
  if (host === null || host === '') {
    throw new Error(
      'Não foi possível determinar a origem da requisição: cabeçalhos host/x-forwarded-host ausentes.',
    );
  }

  const protocolo = cabecalhos.get('x-forwarded-proto') ?? 'http';

  return semBarraFinal(`${protocolo}://${host}`);
}

function semBarraFinal(valor: string): string {
  return valor.endsWith('/') ? valor.slice(0, -1) : valor;
}
