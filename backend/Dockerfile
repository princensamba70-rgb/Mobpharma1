# AMI PHARMA — API Backend (Node.js + Express + Prisma + PostgreSQL)
FROM node:20-alpine

# Prérequis Prisma sur Alpine/musl : libssl (moteur query-engine) + compat glibc
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Dépendances — npm ci : installation déterministe depuis le lockfile,
# devDependencies INCLUSES (la CLI Prisma est requise par l'entrypoint au runtime)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Code source + catalogue (issu du PDF)
COPY scripts ./scripts
COPY src ./src
COPY data ./data

# Schéma PostgreSQL + génération du client Prisma.
# Binaire LOCAL explicite (jamais `npx prisma` : si la CLI locale est absente,
# npx télécharge silencieusement la DERNIÈRE version majeure (v7+) dont le
# schéma est incompatible → erreur P1012 → crash-loop → conteneur "unhealthy")
RUN node scripts/use-db.js postgres && ./node_modules/.bin/prisma generate

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# Healthcheck : l'API est "healthy" seulement quand /api/health répond
# (utilisé par docker-compose pour ne démarrer Nginx qu'après → plus de 502 au login)
HEALTHCHECK --interval=5s --timeout=3s --start-period=90s --retries=30 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
