#!/usr/bin/env bash
# AMI PHARMA — environnement de prévisualisation local (sans Docker)
# Configurez d'abord ADMIN_INITIAL_PASSWORD, FINANCE_INITIAL_PASSWORD et
# ASSISTANT_INITIAL_PASSWORD dans l'environnement ou dans .env.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

: "${ADMIN_INITIAL_PASSWORD:?Définissez ADMIN_INITIAL_PASSWORD avant le premier démarrage}"
: "${FINANCE_INITIAL_PASSWORD:?Définissez FINANCE_INITIAL_PASSWORD avant le premier démarrage}"
: "${ASSISTANT_INITIAL_PASSWORD:?Définissez ASSISTANT_INITIAL_PASSWORD avant le premier démarrage}"

export NODE_ENV="${NODE_ENV:-development}"
export PORT="${PORT:-4000}"
export DATABASE_URL="${DATABASE_URL:-file:./dev.db}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-$(openssl rand -hex 48)}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(openssl rand -hex 48)}"
export CORS_ORIGIN="${CORS_ORIGIN:-*}"

printf '%s\n' "▶ [1/4] Dépendances et schéma SQLite…"
cd "$ROOT/backend"
[ -d node_modules ] || npm ci --no-audit --no-fund
node scripts/use-db.js sqlite
if [ ! -f node_modules/.prisma/client/index.js ] || grep -q '@prisma/client did not initialize yet' node_modules/.prisma/client/index.js; then
  ./node_modules/.bin/prisma generate
fi
[ -f prisma/dev.db ] || ./node_modules/.bin/prisma db push

printf '%s\n' "▶ [2/4] Initialisation idempotente de la base…"
ADMIN_INITIAL_PASSWORD="$ADMIN_INITIAL_PASSWORD" \
FINANCE_INITIAL_PASSWORD="$FINANCE_INITIAL_PASSWORD" \
ASSISTANT_INITIAL_PASSWORD="$ASSISTANT_INITIAL_PASSWORD" \
node src/seed/seed.js | tail -2

printf '%s\n' "▶ [3/4] Dépendances frontend…"
cd "$ROOT/frontend"
[ -d node_modules ] || npm ci --no-audit --no-fund

printf '%s\n' "▶ [4/4] Démarrage API (:4000) puis Web (:5173)…"
(
  cd "$ROOT/backend"
  DATABASE_URL="$DATABASE_URL" NODE_ENV="$NODE_ENV" PORT="$PORT" \
  JWT_ACCESS_SECRET="$JWT_ACCESS_SECRET" JWT_REFRESH_SECRET="$JWT_REFRESH_SECRET" \
  CORS_ORIGIN="$CORS_ORIGIN" nohup node src/server.js > /tmp/amipharma-api.log 2>&1 &
)
sleep 2
curl -sf http://localhost:4000/api/health > /dev/null && echo "  ✔ API opérationnelle" || { echo "  ✖ API en échec — voir /tmp/amipharma-api.log"; exit 1; }
(
  cd "$ROOT/frontend"
  nohup npm run dev > /tmp/amipharma-web.log 2>&1 &
)
sleep 3
curl -sf -o /dev/null http://localhost:5173/ && echo "  ✔ Web opérationnel sur http://localhost:5173" || { echo "  ✖ Web en échec — voir /tmp/amipharma-web.log"; exit 1; }

echo "✅ AMI PHARMA prête. Aucun mot de passe n'est affiché dans les logs."
