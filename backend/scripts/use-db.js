// Sélectionne le schéma Prisma actif : `node scripts/use-db.js sqlite|postgres`
import { copyFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prismaDir = join(__dirname, '..', 'prisma');
const target = (process.argv[2] || process.env.DB_DIALECT || 'postgres').toLowerCase();

const src = join(prismaDir, `schema.${target}.prisma`);
if (!existsSync(src)) {
  console.error(`Schéma introuvable : ${src}`);
  process.exit(1);
}
copyFileSync(src, join(prismaDir, 'schema.prisma'));
console.log(`✔ prisma/schema.prisma → provider "${target}"`);
