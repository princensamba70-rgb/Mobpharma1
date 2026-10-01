# Migration ONLINE/OFFLINE

Les champs ONLINE/OFFLINE sont **additifs** et ne doivent pas supprimer la base métier existante :

- `Medicament.version`, `Medicament.deletedAt` et `updatedAt` servent au curseur différentiel ;
- `PriceCatalog.version` et `importedAt` conservent l’historique des prix téléchargés ;
- `Vente.syncId` est l’UUID d’idempotence de l’appareil, `Vente.updatedAt`, `version`, `deletedAt`, `remise` et `syncConflict` rendent la résolution explicite ;
- `StockMovement.syncId` rend un ajustement offline rejouable sans double mouvement.

## Procédure contrôlée

1. Faire une sauvegarde PostgreSQL/SQLite et vérifier qu’elle est restaurable.
2. Vérifier que `backend/prisma/schema.postgres.prisma` ou `schema.sqlite.prisma` correspond au dialecte (`node scripts/use-db.js postgres|sqlite`).
3. Régénérer le client avec la version locale verrouillée :

   ```bash
   cd backend
   npm ci
   node scripts/use-db.js postgres   # production Docker
   ./node_modules/.bin/prisma generate
   ```

4. En préproduction, exécuter `./node_modules/.bin/prisma db push --skip-generate` et contrôler le rapport Prisma. Cette étape n’accepte pas `--accept-data-loss`; elle refuse une évolution destructive.
5. Tester une connexion, une facture existante, un prix existant, un stock et un redémarrage avant promotion.
6. En production, appliquer d’abord la sauvegarde validée puis la même commande additive via l’entrypoint Docker. Ne jamais supprimer/recréer la base pour résoudre un écart de schéma.

Le dépôt d’origine n’avait pas de répertoire de migrations Prisma versionnées ; l’entrypoint conserve donc `db push` pour assurer la compatibilité avec les installations déjà initialisées. Une équipe qui utilise `prisma migrate` doit générer et relire la migration dans une base de staging avant de la committer et de remplacer `db push` par `migrate deploy`.
