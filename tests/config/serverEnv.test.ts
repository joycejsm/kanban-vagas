import { describe, expect, it } from 'vitest';

import {
  ARQUIVO_AMBIENTE_LOCAL,
  ErroConfiguracaoSupabase,
  VARIAVEIS_SUPABASE,
  lerConfiguracaoSupabase,
} from '@/config/serverEnv';

const URL_VALIDA = 'https://projeto.supabase.co';
const ANON_VALIDA = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token-de-exemplo';

const AMBAS = {
  NEXT_PUBLIC_SUPABASE_URL: URL_VALIDA,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_VALIDA,
};

function semChavesValidas(): Record<string, string | undefined> {
  return {};
}

describe('lerConfiguracaoSupabase', () => {
  it('devolve a configuração quando as duas variáveis estão presentes', () => {
    const config = lerConfiguracaoSupabase(AMBAS);

    expect(config.NEXT_PUBLIC_SUPABASE_URL).toBe(URL_VALIDA);
    expect(config.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(ANON_VALIDA);
  });

  it('falha nomeando a variável ausente', () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: URL_VALIDA };

    expect(() => lerConfiguracaoSupabase(env)).toThrow(ErroConfiguracaoSupabase);
    expect(() => lerConfiguracaoSupabase(env)).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('trata valor vazio ou só com espaços como ausente', () => {
    const vazia = { ...AMBAS, NEXT_PUBLIC_SUPABASE_URL: '' };
    const brancos = { ...AMBAS, NEXT_PUBLIC_SUPABASE_ANON_KEY: '   ' };

    expect(() => lerConfiguracaoSupabase(vazia)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => lerConfiguracaoSupabase(brancos)).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('falha nomeando as duas variáveis quando nada está definido', () => {
    expect(() => lerConfiguracaoSupabase(semChavesValidas())).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });

  it('aponta .env.local como origem esperada e não inclui stack trace nem valor de segredo', () => {
    const erro = (() => {
      try {
        lerConfiguracaoSupabase(semChavesValidas());
        throw new Error('deveria ter lançado');
      } catch (lancado) {
        return lancado as ErroConfiguracaoSupabase;
      }
    })();

    // A mensagem nomeia o arquivo de onde a configuração deve vir.
    expect(erro.message).toContain(ARQUIVO_AMBIENTE_LOCAL);

    // E não carrega o valor de nenhuma variável — nem de uma configuração válida,
    // que é o pior caso: o valor vazio seria lido como "ausente" e a mensagem mentiria.
    const comValorSecreto = { ...AMBAS, NEXT_PUBLIC_SUPABASE_ANON_KEY: '   ' };
    let mensagem = '';
    try {
      lerConfiguracaoSupabase(comValorSecreto);
    } catch (lancado) {
      mensagem = (lancado as Error).message;
    }
    expect(mensagem).not.toContain(ANON_VALIDA);
    expect(mensagem).not.toContain(URL_VALIDA);
    expect(mensagem).not.toContain('\n');
  });

  it('expõe a lista de variáveis lidas sem incluir segredo algum', () => {
    expect([...VARIAVEIS_SUPABASE]).toEqual([
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ]);
  });
});
