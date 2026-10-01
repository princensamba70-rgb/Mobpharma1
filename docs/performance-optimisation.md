# Rapport d'analyse et d'optimisation — AMI PHARMA

**Date de mesure : 1 octobre 2026 (Africa/Kinshasa)**
**Branche : `arena/01a0ecb7-mobpharma1`**

Ce rapport sépare les mesures obtenues dans la sandbox, les vérifications simulées/statique et les hypothèses qui restent à valider avec une base Prisma et un appareil Android.

## Diagnostic retenu

Le message « L'application prend plus de temps pour charger le contenu » ne provenait pas d'une seule erreur démontrée en production dans cet environnement. L'analyse du code a identifié trois blocages qui se cumulaient :

1. **Le bundle JavaScript initial chargeait toutes les pages, Recharts et leurs dépendances**, même sur l'écran de connexion.
2. **Le démarrage attendait la session et la sonde réseau** alors qu'une API lente ou indisponible pouvait retarder l'affichage de l'interface.
3. **Le dashboard et les notifications matérialisaient plusieurs fois des ensembles de ventes, de médicaments et de lots** pour calculer des totaux proches ou identiques.

Le runtime backend n'a pas pu démarrer dans la sandbox : il manque le client Prisma généré et le téléchargement TLS des artefacts Prisma échoue. Il n'est donc pas correct de présenter une latence SQL réelle comme mesurée.

## Modifications réalisées

### Frontend

- Découpage des routes avec `React.lazy` : la connexion et le shell ne chargent plus les 18 pages à l'ouverture.
- Découpage séparé de `DashboardCharts` : les cartes du dashboard peuvent s'afficher avant le chunk Recharts.
- Le dashboard hydrate immédiatement une réponse dashboard précédemment mise en cache, puis affiche l'actualisation en arrière-plan. Une erreur laisse les données visibles avec un message actionnable.
- Délais explicites : refresh/session **6 s**, requêtes métier ordinaires **15 s**, recherche de médicaments de facturation **7 s**, exports **120 s**.
- Les recherches de typeahead de facturation utilisent un `AbortController` : une recherche remplacée n'est pas traitée comme une panne API et ne laisse pas de requête inutile active.
- Le cache de présentation est limité aux dashboard/rapports/paramètres. Il est effacé à la déconnexion, à un logout forcé et avant un changement de compte ; il ne contient pas les enregistrements métier offline.
- Les notifications ne sont plus appelées dans le chemin critique : premier chargement différé de 5 s, puis actualisation à l'ouverture et toutes les 60 s pendant que le panneau est ouvert.
- Le bouton retour Android et les fonctions online/offline existantes restent conservés.

### Backend / Prisma

- Dashboard : agrégats Prisma pour les compteurs et sommes au lieu de charger toutes les ventes ; lectures indépendantes en parallèle ; sélection minimale des médicaments ; une seule capture d'items de vente sert à la série, au top/flop et au coût de revient ; alertes et réapprovisionnement réutilisent la même capture enrichie.
- Dashboard : le calcul de la marge de la carte conserve la formule historique `chiffreAffaires - coût des ventes`, y compris l'effet des remises facture ; la série conserve sa marge par item.
- Notifications : médicaments et lots d'expiration sont lus en parallèle ; le calcul du réapprovisionnement réutilise le snapshot au lieu de relire médicaments et lots.
- Paramètres : cache mémoire de 10 s avec déduplication des appels simultanés et invalidation après une écriture.
- Médicaments : pagination, `select` restreint et tri validé côté base lorsque le filtre de statut calculé n'est pas demandé. Le filtre calculé continue volontairement à enrichir l'ensemble nécessaire avant pagination.
- Index composés ajoutés dans les trois variantes de schéma (`prisma/schema*.prisma`) pour statut/date des ventes et approvisionnements, type/date des transactions financières et recherche des lots expirants.

## Mesures réellement obtenues

### Build frontend de production

Commande :

```bash
npm --prefix frontend run build
```

Résultat final : **2 425 modules transformés, 6,66 s, succès**.

| Élément | Référence avant optimisation | Après optimisation |
|---|---:|---:|
| Chunk JavaScript initial brut | 835,11 kB | 250,04 kB |
| Chunk JavaScript initial gzip | 227,06 kB | 79,20 kB |
| CSS brut | 47,81 kB | 47,86 kB |
| CSS gzip | 8,02 kB | 8,03 kB |
| Route dashboard | incluse dans le gros chunk | 9,38 kB, lazy |
| Chunk `DashboardCharts` | inclus | 30,14 kB, lazy |
| Chunk Recharts `BarChart` | inclus | 375,32 kB, lazy |

La réduction du chunk JavaScript initial est de **70,1 % brut** et **65,1 % gzip**. Les chunks de graphiques restent dans l'application et sont chargés lorsque le dashboard en a besoin : aucune fonctionnalité n'a été supprimée.

### Tests automatisés

- Frontend : `npm --prefix frontend run test` — **3 fichiers, 10 tests réussis** ; TypeScript inclus.
- Backend : `npm test` dans `backend/` — **5 tests réussis**.
- Vérification syntaxique Node (`node --check`) : routes/statistiques/serveur modifiés — **succès**.

### Vérification HTTP locale réellement exécutée

Le serveur Vite de développement était accessible sur `0.0.0.0:5173`.

- `GET /` : **HTTP 200**, 1 000 octets, **6,708 ms** dans la sandbox.
- `GET /api/health` via le proxy Vite alors que l'API n'était pas disponible : **HTTP 503**, 114 octets, **498,491 ms**. Le corps indiquait explicitement que le backend du port 4000 était injoignable.
- Cela vérifie le comportement d'erreur du proxy, pas la latence de l'API métier et pas le temps de chargement dans un navigateur réel.

### APK livré

L'APK a été régénéré après le build frontend final avec `tools/android-fallback/build.sh`, en reconditionnant le bundle actuel et en vérifiant la signature avec `apksigner`.

- Fichier : `artifacts/ami-pharma-debug.apk`
- Taille : **302 775 octets**
- SHA-256 : `f11da9dbf228383b96b0fd350b6a0667db11ee7718e008bf4c8a2eaf6b722737`
- Signature vérifiée : schémas Android **v2 et v3**
- L'archive contient les chunks lazy du dashboard et le nouveau chunk initial.

Il s'agit du **fallback APK documenté** pour cette sandbox, car le build Gradle canonique n'a pas pu être lancé : aucun `java`/`JAVA_HOME` système n'était disponible, puis le runtime temporaire a échoué sur le téléchargement TLS de Gradle 8.14.3. Aucun keystore privé n'a été ajouté au dépôt ; le fallback utilise une clé de debug temporaire.

## Inventaire statique des requêtes dashboard

Ce tableau est un comptage des opérations Prisma dans le code, **pas un benchmark SQL**. Une relation Prisma peut produire plusieurs requêtes selon le moteur et le plan.

| Chemin dashboard | Avant | Après |
|---|---:|---:|
| paramètres | 1 | 1 (cache 10 s, appels simultanés dédupliqués) |
| compteurs/agrégats principaux | 7 | 7 |
| expiration | 1 | 1 |
| série et items de vente | 4, dont une lecture d'items inutilisée | 3, partagés avec top/flop et coût |
| top/flop ventes | 2 | 0 supplémentaire |
| top/flop achats | 2 | 1 |
| réapprovisionnement | 2 | 0 supplémentaire |
| alertes | 4 | 0 supplémentaire |
| marge séparée | 1 | 0 supplémentaire |
| **Total d'opérations Prisma estimé dans le chemin** | **24** | **13** |

La baisse statique est d'environ **45,8 %** avant même de compter la réduction des colonnes et du volume JSON. Elle doit être confirmée avec `DEBUG`/query logging Prisma, un jeu de données représentatif et `EXPLAIN`.

## Tests simulés / vérifications de code

Les cas suivants ont été couverts par lecture du code, tests unitaires existants ou simulation de défaillance du transport ; ils ne remplacent pas un test appareil/serveur :

- API lente : AbortController et timeout ; le dashboard garde une donnée précédente ou affiche une erreur avec bouton « Réessayer ».
- API indisponible : la sonde `/api/health` passe à `apiReachable=false`, le proxy renvoie 503 et l'état réseau n'est pas confondu avec le Wi-Fi.
- Offline : la base IndexedDB et la file durable existantes restent utilisées pour les données métier ; les opérations gardent leurs UUID, retries/backoff/idempotence et états de synchronisation.
- Retour réseau : le contexte réseau déclenche une sonde réelle puis la reprise de synchronisation ; les opérations non confirmées ne sont pas supprimées.
- Session : refresh httpOnly côté navigateur, stockage Keystore natif prioritaire, mémoire si coffre indisponible, access token non persisté en clair dans le frontend.
- Navigation : le fallback React des routes lazy évite un écran vide pendant le chargement d'un module.

## Ce qui reste non vérifié / limitations

1. **API et Prisma** : `npm start` échoue actuellement avec `@prisma/client did not initialize yet`; `npx prisma validate` échoue pendant le téléchargement TLS de `binaries.prisma.sh`. Aucune mesure backend p50/p95, taille de réponse API, plan SQL ou test avec données seedées n'est donc revendiquée.
2. **Base de données** : les index sont présents dans les trois fichiers de schéma, mais leur application par migration/db push doit être faite dans un environnement qui possède les binaires Prisma et la base cible.
3. **Navigateur** : la sandbox ne fournit pas d'automatisation navigateur/DevTools. Le nombre exact de requêtes réseau, FCP/LCP, mémoire et rendu React n'a pas été capturé.
4. **Android** : `adb` et aucun émulateur/appareil ne sont disponibles. L'APK a été signé et inspecté, mais le lancement, le bouton retour, Keystore réel, online/offline, TLS et synchronisation n'ont pas été exercés sur appareil.
5. Les résultats réels côté API doivent être collectés après redémarrage du backend avec `API_TIMING_LOG=true PRISMA_LOG_QUERIES=true`, une base représentative et un réseau lent injecté. Les valeurs attendues sont : chargement progressif, timeout fini, erreur actionnable et absence de requêtes de notifications dans le chemin critique.

## Reproduction courte

```bash
# Frontend
npm --prefix frontend run test
npm --prefix frontend run build

# Backend (dans un environnement avec Prisma généré et DATABASE_URL valide)
npm --prefix backend test
npm --prefix backend run prisma:generate
API_TIMING_LOG=true PRISMA_LOG_QUERIES=true npm --prefix backend start

# APK fallback de sandbox (outils temporaires à fournir via variables)
ANDROID_AAPT2=... ANDROID_JAR=... ANDROID_APKSIGNER=... \
JAVA_BIN=... KEYTOOL_BIN=... ANDROID_PREBUILT_DEX=... \
./tools/android-fallback/build.sh
```
