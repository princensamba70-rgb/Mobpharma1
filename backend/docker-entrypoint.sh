#!/bin/sh
# AMI PHARMA — point d'entrée conteneur : schéma + seed idempotent puis démarrage.
# IMPORTANT : jamais de `npx prisma` ici — si la CLI locale est absente, npx
# télécharge silencieusement la dernière version majeure (Prisma 7+), incompatible
# avec ce schéma (erreur P1012) → db push échoue en boucle → conteneur « unhealthy ».
set -e

PRISMA=./node_modules/.bin/prisma

if [ ! -x "$PRISMA" ]; then
  echo "✖ CLI Prisma locale introuvable ($PRISMA)."
  echo "  L'image doit être construite avec les devDependencies (npm ci)."
  echo "  Refaites le build sans cache : docker compose build --no-cache api"
  exit 1
fi

echo "▶ Version Prisma utilisée : $($PRISMA --version 2>/dev/null | grep -m1 '^prisma' || echo inconnue)"

echo "▶ Attente de la base de données…"
i=0
until $PRISMA db push --skip-generate --accept-data-loss > /tmp/dbpush.log 2>&1; do
  i=$((i+1))
  if [ $i -ge 30 ]; then
    echo "✖ Base de données injoignable/inapplicable après 30 tentatives."
    echo "──── Dernier résultat de 'prisma db push' ────"
    cat /tmp/dbpush.log
    echo "──────────────────────────────────────────────"
    echo "  Vérifiez DATABASE_URL et l'état du service db (docker compose logs db)."
    exit 1
  fi
  # Afficher l'erreur réelle dès le 1er échec (diagnostic immédiat dans
  # `docker compose logs api` : P1010 mot de passe, base injoignable, etc.)
  if [ $i -eq 1 ]; then
    echo "  ⚠ Premier échec de 'prisma db push' — sortie :"
    sed 's/^/    │ /' /tmp/dbpush.log
  fi
  echo "  … tentative $i/30"
  sleep 2
done
echo "✔ Schéma de base de données appliqué"

echo "▶ Initialisation des données (rôles, utilisateurs, catalogue PDF, démo)…"
if ! node src/seed/seed.js; then
  # Le seed est idempotent : s'il échoue alors que des utilisateurs existent déjà
  # (initialisation partielle d'un démarrage précédent), on démarre quand même l'API
  # au lieu de boucler en crash — c'est ce crash-loop qui rend l'API « injoignable »
  # derrière Nginx (502/503 permanent). Base vide + seed en échec = fatal.
  USERS=$(node --input-type=module -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try { console.log(await p.user.count()); } catch { console.log(-1); } finally { await p.\$disconnect(); }
" 2>/dev/null || echo "-1")
  if [ "${USERS:-0}" -gt 0 ] 2>/dev/null; then
    echo "⚠ Seed en échec mais base déjà initialisée ($USERS utilisateurs) — démarrage de l'API."
    echo "⚠ Consultez les logs ci-dessus pour corriger la cause du seed."
  else
    echo "✖ Seed en échec sur une base vide — démarrage impossible (voir erreur ci-dessus)."
    exit 1
  fi
fi

echo "▶ Démarrage de l'API…"
exec "$@"
