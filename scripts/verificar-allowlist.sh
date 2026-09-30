#!/usr/bin/env bash
# =============================================================================
# Verificação de sincronia da allowlist: public.allowed_emails (banco) contra
# ALLOWED_EMAILS (servidor Next). Ver README, "Acesso por allowlist".
#
# Por que comparar hash e não os e-mails: o projeto tem a regra de que log e
# terminal não recebem endereço de e-mail. As duas pontas produzem a mesma
# normalização -- lower(trim(email)), ordenado, separado por virgula -- e o
# script compara o md5 dessa string. O conteúdo diverge ou não diverge sem que
# um único endereço apareça na tela.
#
# Uso:
#   scripts/verificar-allowlist.sh                    # pede a linha do banco
#   scripts/verificar-allowlist.sh "<saida-do-sql>"   # sem prompt
#   DB_URL=postgres://... scripts/verificar-allowlist.sh   # lê o banco direto
#
# Saída: 0 = batem, 1 = divergem, 2 = uso incorreto ou falta de acesso.
# =============================================================================

set -uo pipefail

PATH_INFISICAL="${PATH_INFISICAL:-/nextjs}"
CHAVE_ALLOWED="ALLOWED_EMAILS"
SQL="select (select count(*) from public.allowed_emails) as total,
       coalesce(md5((select string_agg(\"email\", ',' order by \"email\") from public.allowed_emails)), '') as md5,
       (select relrowsecurity from pg_class where oid = 'public.allowed_emails'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'allowed_emails') as policies;"

verde() { printf '\033[32m%s\033[0m\n' "$1"; }
vermelho() { printf '\033[31m%s\033[0m\n' "$1"; }
amarelo() { printf '\033[33m%s\033[0m\n' "$1"; }

# -----------------------------------------------------------------------------
# Lado do Next: a lista normalizada, e nada mais
# -----------------------------------------------------------------------------

# Normaliza como o banco: minusculo, sem espaco nas pontas, sem vazio, sem
# repetida. LC_ALL=C para que a ordem de sort seja estavel e independente de
# locale -- ver a nota de colacao no relatorio.
contar_e_hashear() {
  local bruto="$1"
  printf '%s' "$bruto" \
    | tr ',' '\n' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
    | LC_ALL=C tr '[:upper:]' '[:lower:]' \
    | grep -v '^$' \
    | LC_ALL=C sort -u > /tmp/allowlist-normalizada.$$
  local total
  total=$(wc -l < /tmp/allowlist-normalizada.$$ | tr -d ' ')
  local md5
  if [ "$total" -eq 0 ]; then
    md5=""
  else
    # paste acrescenta um \n final; o string_agg do banco nao tem. A
    # substituicao de comando remove, para os dois lados hashear o mesmo bytes.
    md5=$(printf '%s' "$(paste -sd, /tmp/allowlist-normalizada.$$)" | md5sum | cut -d' ' -f1)
  fi
  rm -f /tmp/allowlist-normalizada.$$
  printf '%s|%s' "$total" "$md5"
}

# O Infisical e a fonte; o .env.local e o que o Next realmente carrega em
# execucao. Os dois sao conferidos porque podem divergir entre si.
# "Definida mas vazia" e um estado real -- o Next barra todo mundo -- e nao
# se confunde com a variavel ausente, entao presenca e valor sao separados.
# Atencao: no `infisical export --format=json` o segredo vem no campo
# `value`. Usar `secretKey` devolve null silenciosamente, e um "null" solto
# entraria na lista como se fosse um e-mail.
valor_do_infisical() {
  command -v infisical >/dev/null 2>&1 || return 1
  infisical export --path="$PATH_INFISICAL" --format=json 2>/dev/null \
    | jq -r --arg k "$CHAVE_ALLOWED" '[.[] | select(.key == $k)] | .[0].value // empty' 2>/dev/null
}

infisical_tem_a_chave() {
  command -v infisical >/dev/null 2>&1 || return 1
  [ "$(infisical export --path="$PATH_INFISICAL" --format=json 2>/dev/null \
      | jq -r --arg k "$CHAVE_ALLOWED" '[.[] | select(.key == $k)] | length' 2>/dev/null)" = "1" ]
}

valor_do_env_local() {
  [ -f ".env.local" ] || return 1
  sed -n "s/^${CHAVE_ALLOWED}=//p" .env.local | head -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

env_local_tem_a_chave() {
  [ -f ".env.local" ] && grep -q "^${CHAVE_ALLOWED}=" .env.local
}

INF=$(valor_do_infisical || true)
LOCAL=$(valor_do_env_local || true)
INF_PRESENTE=0; LOCAL_PRESENTE=0
infisical_tem_a_chave && INF_PRESENTE=1
env_local_tem_a_chave && LOCAL_PRESENTE=1

if [ "$INF_PRESENTE" -eq 0 ] && [ "$LOCAL_PRESENTE" -eq 0 ]; then
  vermelho "Nao encontrei $CHAVE_ALLOWED nem no Infisical ($PATH_INFISICAL) nem no .env.local."
  exit 2
fi

linhas=()
relatorio=""
for origem in infisical env_local; do
  case "$origem" in
    infisical) bruto="$INF"; presente="$INF_PRESENTE"; rotulo="infisical (/nextjs)";;
    env_local) bruto="$LOCAL"; presente="$LOCAL_PRESENTE"; rotulo=".env.local";;
  esac
  [ "$presente" -eq 0 ] && continue
  IFS='|' read -r total md5 <<< "$(contar_e_hashear "$bruto")"
  if [ "$total" -eq 0 ]; then
    rotulo_formatado=$(printf '%-22s' "$rotulo")
    relatorio="${relatorio}${relatorio:+
}${rotulo_formatado} VAZIA"
    linhas+=("$rotulo|VAZIA|")
    continue
  fi
  linhas+=("$rotulo|$total|$md5")
  rotulo_formatado=$(printf '%-22s' "$rotulo")
  relatorio="${relatorio}${relatorio:+
}${rotulo_formatado} ${total}|${md5}"
done

# -----------------------------------------------------------------------------
# Lado do banco: direto se houver conexao, colado se nao houver
# -----------------------------------------------------------------------------

saida_do_banco="${1:-}"

if [ -z "$saida_do_banco" ] && [ -n "${DB_URL:-}" ]; then
  if command -v psql >/dev/null 2>&1; then
    saida_do_banco=$(psql "$DB_URL" -tAc "$SQL" 2>/dev/null | head -1)
  fi
fi

if [ -z "$saida_do_banco" ]; then
  echo "Rode esta consulta no SQL Editor do projeto e cole o resultado:"
  echo
  printf '  %s\n\n' "$SQL"
  printf 'resultado (total|md5|rls|policies): '
  IFS= read -r saida_do_banco || true
fi

saida_do_banco=$(printf '%s' "$saida_do_banco" | tr -d '[:space:]')
if [ -z "$saida_do_banco" ]; then
  vermelho "Nao recebi o resultado da consulta."
  exit 2
fi

BANCO_TOTAL=$(printf '%s' "$saida_do_banco" | cut -d'|' -f1)
BANCO_MD5=$(printf '%s' "$saida_do_banco" | cut -d'|' -f2)
BANCO_RLS=$(printf '%s' "$saida_do_banco" | cut -d'|' -f3)
BANCO_POLICIES=$(printf '%s' "$saida_do_banco" | cut -d'|' -f4)

[ -z "$BANCO_MD5" ] && BANCO_MD5="vazio"
[ -z "$BANCO_RLS" ] && BANCO_RLS="desconhecido"
[ -z "$BANCO_POLICIES" ] && BANCO_POLICIES="desconhecido"

# -----------------------------------------------------------------------------
# Relatorio
# -----------------------------------------------------------------------------

echo
echo "banco:         $BANCO_TOTAL|$BANCO_MD5"
echo "$relatorio"
echo

falha=0

if [ "$BANCO_TOTAL" -eq 0 ]; then
  vermelho "A tabela public.allowed_emails esta vazia."
  echo "  O hook e fail-closed: com a tabela vazia ele recusa a criacao de TODA"
  echo "  conta, inclusive a sua, com um erro generico que parece falha do Google."
  echo "  Popule antes do task 9.4:  insert into public.allowed_emails (email) values ('voce@exemplo.com');"
  exit 1
fi

[ "$BANCO_RLS" = "t" ] || { vermelho "RLS NAO esta habilitado em allowed_emails (esperado: habilitado)."; falha=1; }
[ "$BANCO_RLS" = "t" ] && verde "RLS habilitado em allowed_emails."
if [ "$BANCO_POLICIES" = "0" ]; then
  verde "Zero policies: anon e authenticated nao leem a lista."
else
  vermelho "$BANCO_POLICIES policy(s) em allowed_emails (esperado: zero)."
  falha=1
fi

falha_inicial=$falha
for linha in "${linhas[@]}"; do
  IFS='|' read -r lado total md5 <<< "$linha"
  if [ "$total" = "VAZIA" ]; then
    vermelho "$lado tem $CHAVE_ALLOWED definida mas VAZIA: nenhum e-mail passa no callback."
    falha=1
    continue
  fi
  if [ "$total" = "$BANCO_TOTAL" ] && [ "$md5" = "$BANCO_MD5" ]; then
    verde "$lado bate com o banco ($total e-mail(s), conteudo identico)."
  elif [ "$total" = "$BANCO_TOTAL" ]; then
    amarelo "$lado tem a mesma contagem do banco, mas conteudo diferente."
    echo "  Endereco presente de um lado so, ou diferenca de normalizacao."
    falha=1
  else
    vermelho "$lado NAO bate: $total e-mail(s) contra $BANCO_TOTAL no banco."
    echo "  Consultar README, 'Em caso de divergencia': os dois desvios sao"
    echo "  conservadores, e o banco nunca amplia o acesso."
    falha=1
  fi
done

if [ "$falha" -eq 0 ]; then
  verde "Sincronia confirmada. As duas listas tem o mesmo conteudo."
else
  echo
  [ "$falha_inicial" -eq 1 ] && echo "RLS ou policies fora do esperado: isso e problema de seguranca, nao de lista." && echo
  amarelo "Se as contagens batem e so o md5 difere, a ordem de ordenacao do banco"
  amarelo "pode estar usando outra collacao que o LC_ALL=C do script. Nesse caso o"
  amarelo "conteudo ainda e o mesmo -- compare o string_agg direto para fechar."
fi

exit "$falha"