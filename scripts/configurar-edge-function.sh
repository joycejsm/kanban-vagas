#!/usr/bin/env bash
# =============================================================================
# Sobe o cadastro por URL: secrets da Edge Function + deploy.
#
# Por que este script existe: a lista `ALLOWED_EMAILS` da Edge Function é o TERCEIRO
# portão da allowlist, depois da tabela `public.allowed_emails` (que decide a criação
# da conta, no hook) e da variável do Next (que decide o acesso, no callback). Os três
# precisam do mesmo conteúdo — ver README, "Acesso por allowlist".
#
# Digitar a lista à mão em três lugares foi o que produziu o login quebrado que este
# projeto acabou de diagnosticar: três e-mails diferentes em três lugares, e o
# sintoma apareceu só no fim. Aqui a lista sai do banco, por comando, e não de
# digitação — o mesmo caminho que o README manda usar.
#
# Das quatro secrets, só uma precisa ser buscada fora: GEMINI_API_KEY. As outras
# três derivam, e é por isso que este script existe em vez de um `supabase secrets set`
# no README:
#
#   ALLOWED_EMAILS  derivada de public.allowed_emails — a fonte, o espelho não inventa
#   APP_ORIGIN      a origem em que o app roda; `origemPermitida` compara esquema, host
#                   e porta por igualdade estrita, então tem que ser a porta real
#   GEMINI_MODEL    um nome de modelo, não um segredo
#   GEMINI_API_KEY  a única que precisa vir de fora (aistudio.google.com) — mas já está
#                   no Infisical, e é de lá que este script a lê
#
# A chave nunca é digitada no terminal nem passada por argv: o `supabase secrets set` lê
# de um arquivo temporário com permissão 600, para que nenhum valor apareça em `ps`, no
# histórico do shell ou no log. A ordem de leitura é variável de ambiente, Infisical,
# prompt — o prompt é o último recurso, para quem não usa o Infisical.
#
# Uso:
#   scripts/configurar-edge-function.sh                 # pergunta a chave
#   GEMINI_API_KEY=... scripts/configurar-edge-function.sh   # útil em CI, e em
#                                                          # sessão automatizada
#   APP_ORIGIN=http://localhost:3000 scripts/configurar-edge-function.sh
#
# Saída: 0 = publicado, 1 = uso incorreto ou falta de acesso.
# =============================================================================

set -uo pipefail

GEMINI_MODEL_PADRAO="gemini-3.5-flash"
APP_ORIGIN_PADRAO="http://localhost:3002"

# O app local roda em 3002 porque 3000 e 3001 estão ocupadas por processo de outro
# usuário nesta máquina. Ver DEBUG-login-hook.md, "Como testar o login".
raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$raiz"

verde()  { printf '\033[32m%s\033[0m\n' "$1"; }
vermelho(){ printf '\033[31m%s\033[0m\n' "$1"; }
amarelo() { printf '\033[33m%s\033[0m\n' "$1"; }

if ! command -v supabase >/dev/null 2>&1; then
  vermelho "supabase CLI nao encontrado no PATH."
  exit 1
fi

# -----------------------------------------------------------------------------
# 1. A lista, derivada do banco
# -----------------------------------------------------------------------------
# Desempata o espelho pela mesma consulta que o README documenta. Se o banco estiver
# inacessível, o script para em vez de aceitar uma lista digitada: seguir com uma lista
# inventada é a divergência que este script existe para impedir.

sql_lista() {
  local url
  if [ -n "${DB_URL:-}" ]; then
    url="$DB_URL"
  elif command -v infisical >/dev/null 2>&1; then
    local senha
    senha=$(infisical export --path="${PATH_INFISICAL:-/nextjs}" --format=json 2>/dev/null \
      | jq -r '.[] | select(.key == "SUPABASE_DB_PASSWORD") | .value' | head -1)
    [ -n "$senha" ] || return 1
    local ref
    ref=$(cat supabase/.temp/project-ref 2>/dev/null)
    [ -n "$ref" ] || return 1
    url="postgresql://postgres.${ref}:${senha}@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
  else
    return 1
  fi
  psql "$url" -tAc \
    "select string_agg(email, ',' order by email) from public.allowed_emails;" 2>/dev/null | head -1
}

echo
echo "Derivando ALLOWED_EMAILS de public.allowed_emails..."

LISTA="$(sql_lista || true)"
if [ -z "$LISTA" ]; then
  vermelho "Nao consegui ler public.allowed_emails."
  echo "  Configure DB_URL, ou instale o infisical, ou rode a consulta no SQL Editor:"
  echo "    select string_agg(email, ',' order by email) from public.allowed_emails;"
  echo "  e reexecute com ALLOWED_EMAILS=<resultado> no ambiente."
  exit 1
fi

total="$(printf '%s' "$LISTA" | tr ',' '\n' | grep -c .)"
if [ "$total" -eq 0 ]; then
  vermelho "A tabela public.allowed_emails esta vazia."
  echo "  Publicar assim faria a Edge Function recusar todo mundo, com um erro de"
  echo "  nao autorizado que nao distingue isso de e-mail fora da lista."
  exit 1
fi
verde "ALLOWED_EMAILS derivada do banco: $total e-mail(s)."

# -----------------------------------------------------------------------------
# 2. A chave, a unica que precisa vir de fora
# -----------------------------------------------------------------------------

CHAVE="${GEMINI_API_KEY:-}"

# O Infisical é onde as credenciais deste projeto vivem, e a chave do Gemini foi para lá.
# Lê sem imprimir: o valor vai direto para a variável e dali para o arquivo com 600.
if [ -z "$CHAVE" ] && command -v infisical >/dev/null 2>&1; then
  CHAVE="$(infisical export --path="${PATH_INFISICAL:-/nextjs}" --format=json 2>/dev/null \
    | jq -r '.[] | select(.key == "GEMINI_API_KEY") | .value' | head -1)"
  [ -n "$CHAVE" ] && echo "GEMINI_API_KEY lida do Infisical (${PATH_INFISICAL:-/nextjs})."
fi

if [ -z "$CHAVE" ]; then
  echo
  echo "Falta GEMINI_API_KEY. Onde ela esta, na ordem de leitura:"
  echo "  1. variavel de ambiente GEMINI_API_KEY"
  echo "  2. Infisical em ${PATH_INFISICAL:-/nextjs} (https://aistudio.google.com/apikey)"
  echo "Digitar na mao e o ultimo recurso, e a digitacao nao aparece na tela"
  echo "nem no historico."
  printf 'GEMINI_API_KEY: '
  IFS= read -rs CHAVE
  echo
fi
CHAVE="$(printf '%s' "$CHAVE" | tr -d '\r\n[:space:]')"
[ -n "$CHAVE" ] || { vermelho "Chave vazia."; exit 1; }

MODELO="${GEMINI_MODEL:-$GEMINI_MODEL_PADRAO}"
ORIGEM="${APP_ORIGIN:-$APP_ORIGIN_PADRAO}"

case "$ORIGEM" in
  http://*|https://*) ;;
  *) vermelho "APP_ORIGIN deve ser uma URL completa (ex.: $APP_ORIGIN_PADRAO). Recebi: '$ORIGEM'"; exit 1 ;;
esac

# -----------------------------------------------------------------------------
# 3. Publicar
# -----------------------------------------------------------------------------
# Arquivo temporário com 600: os valores não passam por argv (o `supabase secrets set
# KEY=VALOR` colocaria ALLOWED_EMAILS inteiro na tabela de processos, visível a qualquer
# usuário da máquina), e o arquivo é removido na saída, inclusive em falha.

arquivo="$(mktemp)"
liberar() { shred -u "$arquivo" 2>/dev/null || rm -f "$arquivo"; }
trap liberar EXIT
chmod 600 "$arquivo"

{
  printf 'GEMINI_API_KEY=%s\n' "$CHAVE"
  printf 'GEMINI_MODEL=%s\n'   "$MODELO"
  printf 'APP_ORIGIN=%s\n'     "$ORIGEM"
  printf 'ALLOWED_EMAILS=%s\n' "$LISTA"
} > "$arquivo"

echo
echo "Publicando secrets (GEMINI_MODEL=$MODELO, APP_ORIGIN=$ORIGEM)..."
if ! supabase secrets set --env-file "$arquivo"; then
  vermelho "Falha ao publicar as secrets. Nada foi implantado."
  exit 1
fi
liberar
trap - EXIT
verde "Secrets publicadas."

echo
echo "Deployando ingest-vaga..."
if ! supabase functions deploy ingest-vaga; then
  vermelho "O deploy falhou. As secrets acima ja valem para o proximo deploy."
  exit 1
fi
verde " ingest-vaga no ar."

# -----------------------------------------------------------------------------
# 4. Verificacao
# -----------------------------------------------------------------------------
# Confirma pela mesma porta que o app usa. Um 404 aqui significa que o deploy nao
# pegou; um 401 significa que a função subiu mas exige autenticacao, que e o esperado
# para quem chama sem sessao. Qualquer outro codigo e o que precisa de investigacao.

echo
echo "Verificando..."
codigo="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "${SUPABASE_URL:-https://$(cat supabase/.temp/project-ref 2>/dev/null).supabase.co}/functions/v1/ingest-vaga" \
  -H 'Content-Type: application/json' -d '{}' --max-time 30 2>/dev/null)"

case "$codigo" in
  404) vermelho "A funcao respondeu 404: o deploy nao pegou. Confira 'supabase functions list'."; exit 1 ;;
  401|403) verde "A funcao respondeu $codigo: subiu e exige autenticacao, como esperado." ;;
  400) verde "A funcao respondeu 400: subiu e recusou a requisicao sem sessao, como esperado." ;;
  000) vermelho "Sem resposta da funcao (timeout ou DNS). O deploy pode ter sido bem-sucedido; confira 'supabase functions list'." ;;
  *) amarelo "A funcao respondeu $codigo. Subiu, mas ve-se o que esse codigo significa antes de confiar." ;;
esac

echo
verde "Cadastro por URL publicado."
echo
echo "Falta uma coisa, e ela e sua: abrir o app em $ORIGEM e colar uma URL de verdade."
echo "E um e-mail que esteja na lista pode colar; um que nao esta recebe nao autorizado."
