# AMI PHARMA — Web & Android

Application professionnelle de gestion de pharmacie, issue du projet `App-partage1` et empaquetée en application Android avec Capacitor. Le projet conserve le frontend React/TypeScript et l'API REST Node.js/Express existants : l'APK est une vraie application installable, pas une simple page ouverte dans Chrome.

> **Date de l'audit :** 1er octobre 2026
> **Application ID Android :** `com.amipharma.gestion`
> **Version actuelle :** `1.0.0` (`versionCode 1`)
> **Langue / devise :** français / CDF

> **Rapport performance détaillé :** [`docs/performance-optimisation.md`](docs/performance-optimisation.md) — mesures réelles, inventaire statique des requêtes, limitations backend/Android et hash APK.

## 1. Audit de l'application existante

Le dépôt source fourni par `princensamba70-rgb/App-partage1` contenait l'archive `ami-pharma-docker-fix.zip`. Après extraction, l'architecture réellement trouvée est la suivante :

```text
ami-pharma/
├── backend/                    API REST Node.js 20 + Express + Prisma
│   ├── prisma/                 schémas SQLite et PostgreSQL synchronisés
│   ├── src/server.js           serveur, CORS, Helmet, rate limit, routes
│   ├── src/routes/             auth, utilisateurs, médicaments, catalogue,
│   │                           fournisseurs, approvisionnements, ventes,
│   │                           stock, inventaires, rapports, dashboard,
│   │                           notifications, audit, paramètres, exports, sync
│   ├── src/lib/                Prisma, JWT, statistiques, règles métier
│   ├── src/middleware/         authentification, RBAC, validation, erreurs
│   └── data/catalog.json       catalogue de prix importé
├── frontend/                  React 18 + TypeScript + Vite + Tailwind
│   └── src/
│       ├── api/client.ts       fetch, refresh, timeout, détection API, exports
│       ├── context/             authentification, réseau, synchronisation, notifications
│       ├── components/          layout, navigation mobile, UI, exports
│       ├── lib/offlineDb.ts    IndexedDB métier persistante et sync_queue
│       ├── lib/syncManager.ts  pull différentiel, push, retry/backoff, conflits
│       └── pages/               écrans métier existants + Synchronisation
├── data/                       catalogues source
└── docker-compose.yml          PostgreSQL + API + Nginx
```

### Fonctionnalités conservées

- tableau de bord avec chiffre d'affaires, stock, alertes, réapprovisionnement, graphiques et tops/flops ;
- facturation/POS, panier, paiement espèces, Mobile Money, carte ou crédit ;
- déduction transactionnelle du stock, contrôle de stock insuffisant et FIFO par lots ;
- approvisionnements, fournisseurs, catalogue de prix et dates d'expiration ;
- inventaires, écarts, validation et mouvements de stock ;
- rapports journaliers, financiers, bilan et rapport d'approvisionnement ;
- exports Excel, PDF, CSV et impression ;
- utilisateurs, rôles `ADMIN`, `FINANCE`, `ASSISTANT` et permissions serveur ;
- notifications dynamiques, audit, paramètres de pharmacie et changement de mot de passe ;
- API et base de données Prisma conservées, sans données simulées ajoutées pour masquer une erreur.

**Survey Solutions n'est pas utilisé par cette application source.** Aucune connexion Survey Solutions, aucun questionnaire ou mécanisme de contrôle qualité Survey Solutions n'a été trouvé dans l'archive. Les modules réels de l'application sont ceux d'AMI PHARMA ci-dessus ; ils ont été conservés tels quels côté API.

## 2. Modifications Android réalisées

### Choix technique

La conversion directe avec **Capacitor 8** est la solution la plus fiable ici : le métier reste dans le frontend React existant, l'API REST et Prisma restent côté serveur, et la couche native Android fournit le cycle de vie, le splash screen, la barre système et le bouton retour.

- `capacitor.config.ts` : configuration native et `webDir: frontend/dist` ;
- `android/` : projet Gradle Android complet ;
- `com.amipharma.gestion` : identifiant stable ;
- `minSdk 24`, `compileSdk 36`, `targetSdk 36` ;
- splash screen et icônes AMI PHARMA personnalisés ;
- barre de navigation inférieure tactile sur smartphone ;
- tiroir latéral pour les modules et les rôles ;
- bouton retour Android relié à l'historique React Router ;
- statut réseau avec bandeau hors connexion/reconnexion ;
- `adjustResize` pour le clavier virtuel et responsive portrait/paysage ;
- stockage des tokens via le plugin Android AMI PHARMA propriétaire et Android Keystore ;
- accès réseau via `@capacitor/network` ;
- retour API mobile sans exposer le refresh token dans le stockage WebView.

### Design mobile

Les écrans existants ont été adaptés sans supprimer les modules : cartes statistiques empilées, tableaux défilables horizontalement, modales en feuille sur téléphone, commandes de taille tactile, safe areas Android, bottom navigation et espace réservé au clavier/à la barre système. Le tableau de bord reste lisible sur téléphone et tablette grâce à des grilles adaptatives et des graphiques Recharts redimensionnés.

### Diagnostic de l'écran blanc APK

L'APK debug livré dans `artifacts/` est produit par le wrapper de secours lorsque Gradle ne peut pas être lancé dans la sandbox. La première version du wrapper ouvrait le bundle Vite avec `file:///android_asset/index.html`. Or le bundle contient des scripts ES modules, des imports dynamiques et des ressources chargées avec CORS : Android WebView bloque ces chargements depuis une origine `file://` opaque avant le montage React, ce qui produit une page blanche.

La correction charge maintenant `https://localhost/index.html` et intercepte les requêtes de l'index, des chunks JavaScript, du CSS et des autres assets via `WebViewClient.shouldInterceptRequest`. Les types MIME sont définis explicitement et l'origine correspond à celle utilisée par Capacitor et autorisée par la configuration CORS de l'API. Le projet Android Capacitor officiel utilisait déjà cette stratégie d'origine sécurisée ; le correctif concerne le wrapper APK de secours livré.

### Diagnostic du stockage des identifiants

L'erreur « Le stockage sécurisé des identifiants est indisponible » ne venait pas du username, du mot de passe, ni du protocole de l'API. `POST /api/auth/login` réussissait, puis `AuthContext.login()` appelait obligatoirement `setSessionTokens()`. Cette fonction appelait le plugin Capacitor même dans un navigateur ; son implémentation Web est un simple adaptateur `localStorage` et peut être absente ou bloquée. Toute erreur de ce second traitement était remontée comme si la connexion avait échoué.

La correction sépare maintenant trois capacités :

1. `secure` : Android Keystore/bridge disponible, les deux tokens sont persistés chiffrés ;
2. `httpOnly-cookie` : navigateur, access token en mémoire et refresh token uniquement dans le cookie httpOnly du serveur ;
3. `memory` : repli natif explicite si le Keystore/plugin est indisponible, sans `localStorage`, sans `sessionStorage`, sans mot de passe et sans token persistant en clair.

Une authentification serveur réussie n'est donc plus annulée par une panne de persistance. L'interface affiche un avertissement clair lorsque la session native ne survivra pas au redémarrage. Au prochain démarrage, le navigateur tente `/api/auth/refresh` avec son cookie avant de déclarer la session expirée.

## 3. Sécurité et authentification

- Les mots de passe restent hachés avec bcrypt côté serveur.
- Les access/refresh tokens ne sont jamais écrits dans `localStorage` ou `sessionStorage` par le nouveau flux. Sur Android, le plugin/bridge Keystore est utilisé en priorité ; si sa capacité est indisponible, les tokens restent uniquement en mémoire pour la durée du processus.
- Dans un navigateur, le serveur conserve le refresh token dans un cookie `httpOnly` et le frontend garde seulement l'access token en mémoire ; après rechargement, la session est restaurée par `/api/auth/refresh` sans exposer le refresh token à JavaScript.
- Le client natif envoie un refresh token dans la réponse uniquement pour permettre le coffre natif ou le repli mémoire. Aucun mot de passe n'est stocké côté client ou journalisé.
- Les routes restent protégées par JWT + RBAC serveur. L'interface ne remplace pas les contrôles serveur.
- Les secrets JWT et les mots de passe initiaux sont obligatoirement fournis par variables d'environnement au premier seed ; aucune valeur réelle n'est commitée.
- En production, définissez `CORS_ORIGIN` explicitement, utilisez HTTPS et `COOKIE_SECURE=true` derrière TLS.
- Les erreurs réseau n'affichent pas de mot de passe ni de token.

## 4. Fonctionnement ONLINE/OFFLINE livré

Le projet conserve les pages et l’API existantes et ajoute une couche locale métier dans `frontend/src/lib/offlineDb.ts`.

### Base locale persistante

- IndexedDB `ami_pharma_business_v1` (et non un simple `localStorage`) avec les stores `medicaments`, `catalogue_prix`, `factures`, `sync_queue` et `meta` ;
- les données survivent à la fermeture, au redémarrage du WebView et à la perte réseau ;
- le service worker `frontend/public/sw.js` conserve uniquement l’app shell pour qu’une application web déjà ouverte puisse redémarrer hors ligne ; il ne met jamais en cache `/api` ni les tokens ;
- les produits, le stock confirmé, les prix du catalogue et les informations nécessaires à la facturation sont téléchargés par `GET /api/sync/pull` ; le curseur `since`/`cursor` rend la mise à jour différentielle ;
- une mise à jour serveur ne supprime jamais les prix locaux lors d’une panne. Les produits archivés sont reçus comme mises à jour logiques (`actif=false`, `deletedAt`) ;
- le prix, la remise éventuelle, les quantités, les montants et les lignes sont des snapshots dans la facture. Le changement ultérieur du prix produit ne réécrit pas une facture historique.

### Écritures offline et reprise

- une facture créée hors ligne reçoit immédiatement un UUID `syncId` stable, est stockée dans IndexedDB avec son prix réellement utilisé, réserve/déduit localement le stock et est ajoutée atomiquement à `sync_queue` ;
- un ajustement manuel de stock autorisé suit le même chemin et conserve le stock/version serveur de référence ; si un autre appareil a modifié le produit entre-temps, l’API renvoie un conflit `409` explicite au lieu d’écraser silencieusement le mouvement ; les mouvements générés par une vente sont créés transactionnellement côté serveur ;
- les états persistants de la queue sont `PENDING`, `SYNCING`, `SYNCED`, `FAILED`, avec compteur de tentatives, timeout réseau, backoff exponentiel et remise en file après interruption ;
- le serveur déduplique avec `Vente.syncId` et `StockMovement.syncId`. Un retry après une coupure après commit renvoie la ressource existante au lieu de créer un doublon ;
- les erreurs de stock ou de validation ne sont pas écrasées : elles restent `FAILED`, affichent leur message dans **Synchronisation** et peuvent être réessayées ou annulées localement avec restauration de la réserve ;
- si le prix a changé pendant que la facture était hors ligne, le serveur conserve le prix snapshot et inscrit `syncConflict=PRICE_CHANGED` dans la facture et l’audit. Ce conflit est visible, il n’est pas silencieux.

### Détection réelle et interface

`navigator.onLine`/Capacitor Network ne sont que des signaux de transport. L’état API est aussi vérifié par une requête réelle `/api/health` et par les appels synchronisation. L’interface permanente affiche `ONLINE`, `OFFLINE`, `SYNCHRONISATION`, `SYNCHRONISÉ` ou `ÉCHEC`, la dernière synchronisation et le nombre d’opérations en attente. Le tableau **Synchronisation** permet la synchronisation manuelle, le détail des UUID, retries/backoff et la résolution des échecs.

Les autres modules en lecture utilisent d’abord IndexedDB lorsque le serveur n’est pas joignable. Les écritures qui n’ont pas de contrat de synchronisation explicite (utilisateurs, paramètres, fournisseurs, approvisionnements et inventaires complexes) restent soumises à l’API afin de ne pas inventer une règle métier ou perdre une relation serveur. La procédure additive de schéma et de sauvegarde est documentée dans `backend/prisma/OFFLINE_SYNC_MIGRATION.md`.

## 5. Variables d'environnement

Copiez `.env.example` vers `.env` et renseignez des valeurs propres à votre déploiement. Les trois mots de passe `*_INITIAL_PASSWORD` ne servent qu'à créer les comptes lors du premier seed et ne doivent pas être commités.

```bash
cp .env.example .env
# générer deux secrets JWT aléatoires d'au moins 32 caractères
openssl rand -hex 48
```

Pour le développement local, exportez aussi les trois mots de passe initiaux avant `start-preview.sh` ou placez-les dans `.env`. Les identifiants ne sont pas affichés par le seed.

## 6. Démarrage web local

Prérequis : Node.js 22+, npm, et un moteur Prisma accessible.

```bash
npm run install:all
export ADMIN_INITIAL_PASSWORD='votre-mot-de-passe-admin'
export FINANCE_INITIAL_PASSWORD='votre-mot-de-passe-finance'
export ASSISTANT_INITIAL_PASSWORD='votre-mot-de-passe-assistant'
bash start-preview.sh
```

- API : `http://localhost:4000`
- interface Vite : `http://localhost:5173`
- santé API : `http://localhost:4000/api/health`

Le mode local sélectionne SQLite et le mode Docker sélectionne PostgreSQL ; les deux schémas Prisma restent dans le dépôt et sont sélectionnés par `backend/scripts/use-db.js`.

## 7. Démarrage Docker / production

```bash
cp .env.example .env
# renseigner POSTGRES_PASSWORD, les secrets JWT et les trois mots de passe initiaux
docker compose up --build -d
docker compose ps
```

- Nginx : `http://localhost:8080` en environnement de démonstration ;
- API directe : `http://localhost:4001/api/health` ;
- PostgreSQL n'est pas exposé sur un port hôte.

Pour un vrai déploiement, placez Nginx derrière TLS, configurez un nom de domaine API HTTPS et définissez `COOKIE_SECURE=true`. Le conteneur API utilise Prisma 5.22.0 épinglé dans le lockfile et le binaire local, jamais une version Prisma téléchargée silencieusement par `npx`.

## 8. Configuration de l'API pour l'APK

Un APK ne peut pas utiliser `localhost` pour joindre le serveur de la pharmacie : `localhost` désigne le téléphone.

### Build avec URL connue

```bash
# URL de base uniquement, sans /api
printf 'VITE_API_URL=https://api.votre-domaine.cd\n' > frontend/.env.production
npm run android:debug
```

### Configuration après installation

Sur l'écran de connexion Android, ouvrez **Serveur de données**, saisissez l'URL de base de l'API, puis appuyez sur **Tester et enregistrer**. Les deux formes sont conservées telles quelles : `http://serveur...` ou `https://serveur...` ; aucune conversion automatique n'est faite.

- `https://` conserve la validation TLS/certificat native. L'application ne définit aucun `onReceivedSslError` permissif et ne remplace jamais HTTPS par HTTP.
- `http://` fonctionne seulement si le serveur est explicitement déployé en HTTP et si le build autorise le trafic cleartext. Cela ne rend pas HTTPS moins strict, mais HTTP ne protège pas les identifiants pendant le transport et reste déconseillé en production.
- Le serveur doit autoriser les origines `https://localhost` et `capacitor://localhost` ou les origines explicitement configurées par `CORS_ORIGIN`.
- Les cookies du navigateur sont `httpOnly`, `Secure` lorsque la requête est HTTPS et non `Secure` pour un HTTP explicitement autorisé. Les clients natifs utilisent le coffre natif ou le repli mémoire et ne dépendent pas d'un cookie tiers.

## 9. Build Android

Prérequis de la machine de build :

- JDK 17 ou 21 ;
- Android SDK avec platform/build-tools correspondant à API 36 ;
- licence Android acceptée ;
- Node.js 22+ et npm.

Installation des dépendances et synchronisation :

```bash
npm install
npm --prefix frontend ci
npm run mobile:sync
```

Le build accepte par défaut les endpoints API `http://` et `https://`. Pour produire volontairement une variante HTTPS-only :

```bash
CAPACITOR_ALLOW_HTTP_API=false npm run mobile:sync
```

Ce réglage contrôle uniquement l'autorisation Android du trafic HTTP et du contenu mixte nécessaire à une API `http://`. Il ne désactive pas la validation des certificats HTTPS.

APK debug signé automatiquement par la clé debug de Gradle :

```bash
npm run android:debug
# android/app/build/outputs/apk/debug/app-debug.apk
```

### APK disponible dans ce dépôt

Une build debug installable est également livrée dans `artifacts/ami-pharma-debug.apk` :

| Élément | Valeur |
|---|---|
| fichier | `artifacts/ami-pharma-debug.apk` |
| mode | Debug, signature de développement |
| version | `1.0.0` / `versionCode 1` |
| application ID | `com.amipharma.gestion` |
| SDK fallback | min 24 / target 34 (le projet Capacitor Gradle cible 36) |
| taille | `302 775 octets` |
| SHA-256 | `f11da9dbf228383b96b0fd350b6a0667db11ee7718e008bf4c8a2eaf6b722737` |
| vérification | signature APK v2/v3 valide, manifeste contrôlé par `aapt2 dump badging` |

Cette sandbox ne disposait pas du JDK/SDK requis par Gradle et le runtime Java réduit ne fournit pas `java.compiler`. L'APK livré a donc été produit par le wrapper de secours documenté dans `tools/android-fallback/`, avec le bundle React/IndexedDB/service-worker actuel, un wrapper dex de développement déjà compilé et un stockage AES/GCM protégé par Android Keystore. La signature v2/v3 a été vérifiée ; ce n'est pas un build Gradle officiel. Le projet `android/` Capacitor reste la voie canonique et doit être utilisé pour les builds de release et pour bénéficier de tous les plugins Capacitor. L'APK de secours accepte les endpoints `http://` et `https://` ; sa valeur par défaut est l'émulateur Android (`http://10.0.2.2:4000`). Sur un téléphone, renseignez l'URL API depuis **Serveur de données** ou reconstruisez avec `VITE_API_URL`. Aucun secret réel ni clé privée n'est livré dans le dépôt.

Installation sur un appareil Android avec ADB :

```bash
adb install -r artifacts/ami-pharma-debug.apk
```

Release : le projet n'embarque aucune clé privée. Fournissez un keystore hors du dépôt :

```bash
export ANDROID_KEYSTORE_PATH=/chemin/hors-du-repo/ami-pharma-release.jks
export ANDROID_KEYSTORE_PASSWORD='...'
export ANDROID_KEY_ALIAS='ami-pharma'
export ANDROID_KEY_PASSWORD='...'
npm run android:release
# android/app/build/outputs/apk/release/app-release.apk
```

Sans ces variables, Gradle peut produire un release non signé destiné à une signature CI ; ne le distribuez pas tel quel. Pour Google Play, générez aussi un AAB avec `cd android && ./gradlew bundleRelease` après configuration de la même signature.

## 10. Tests réellement exécutés

✅ Commandes passées avec succès :

- `npm run web:build` : TypeScript/Vite et bundle app shell ;
- `npm --prefix frontend run test` : 3 fichiers, 10 tests, dont la base IndexedDB, le snapshot de prix, la réservation stock, `sync_queue`, l’acquittement et l’annulation locale ;
- `npm --prefix backend run test` : 5 tests Node sur arrondis, stock et cookies HTTP/HTTPS ;
- `npm test` à la racine : build frontend, 10 tests frontend et 5 tests backend ;
- `node --check` sur tous les fichiers `backend/src/**/*.js` ;
- `npm run mobile:sync` puis `npm run cap:doctor` : Capacitor 8, plugins et assets Android synchronisés ;
- wrapper fallback : bundle avec IndexedDB/service worker inclus, manifeste inspecté, APK signé et vérifié en signatures v2/v3 ;
- SHA-256 recalculé après cette actualisation : `f11da9dbf228383b96b0fd350b6a0667db11ee7718e008bf4c8a2eaf6b722737`.

⚠ Vérifications non exécutées dans cette sandbox :

- le serveur API ne démarre pas ici car `@prisma/client` doit télécharger/générer son moteur natif et le réseau TLS vers `binaries.prisma.sh` a échoué ;
- `prisma validate/generate`, migration sur une vraie SQLite/PostgreSQL, seed et appels HTTP authentifiés réels n'ont donc pas été validés ;
- `npm run android:debug` officiel est bloqué avant Gradle faute de JDK/Android SDK ; l'APK fourni est explicitement le fallback, pas un build Gradle ;
- aucun appareil/émulateur/ADB/Logcat n'est disponible : lancement APK, bouton retour, login réel, perte réseau réelle, sync après coupure et conflit contre une base n'ont pas été exécutés ;
- le test IndexedDB est un test simulé avec `fake-indexeddb`, pas une preuve de comportement WebView sur appareil.

La distinction ci-dessus est volontaire : aucune validation runtime API/Prisma ou Android n'est déclarée comme réussie sans son exécution.

## 11. Limites et checklist de recette

1. Aucun serveur API public n'est fourni. Configurez `VITE_API_URL` au build Android ou **Serveur de données** après installation ; n'utilisez jamais `localhost` du téléphone pour joindre un serveur distant.
2. Les modules complexes sans contrat de queue (utilisateurs, paramètres, fournisseurs, approvisionnements et inventaires) gardent leurs écritures serveur ; les factures, prix et ajustements de stock autorisés sont le périmètre offline livré.
3. L'installation réelle et l'API doivent être vérifiées avec un environnement de déploiement qui dispose de JDK/SDK/Prisma et d'une base sauvegardée.
4. Les notifications push Firebase restent désactivées faute de configuration fournie.

Checklist de recette avec une API de staging et un appareil :

```text
1. npm ci && npm run mobile:sync && npm run android:debug
2. installer l'APK → configurer l'URL API HTTPS → tester /api/health → se connecter
3. attendre SYNCHRONISÉ → fermer/réouvrir → vérifier produits et catalogue local
4. couper Internet réel (pas seulement le Wi-Fi) → rechercher un prix → créer une facture
   → vérifier facture imprimable, prix snapshot, stock local et queue PENDING
5. couper le réseau pendant une synchronisation → remettre Internet → vérifier reprise,
   backoff, UUID identique et absence de doublon serveur
6. modifier le prix serveur puis synchroniser une facture offline → vérifier prix historique
   et conflit PRICE_CHANGED visible
7. créer un ajustement stock offline → vérifier mouvement unique après retry
8. rendre le serveur indisponible avec transport actif → vérifier ÉCHEC/API injoignable,
   puis retour réel de l'API et synchronisation manuelle
9. tester navigation, bouton retour Android, fermeture/redémarrage et déconnexion.
```

## 12. Arborescence mobile livrée

```text
android/                         projet Android Gradle Capacitor
capacitor.config.ts              configuration Capacitor
resources/icon.svg               source de l'icône AMI PHARMA
resources/splash.svg             source du splash screen
frontend/src/lib/secureStorage.ts coffre tokens (Keystore/cookie/mémoire)
frontend/src/lib/offlineDb.ts    IndexedDB métier persistante + sync_queue
frontend/src/lib/syncManager.ts pull différentiel, push idempotent, backoff/conflits
frontend/src/context/NetworkContext.tsx état API réel + synchronisation
frontend/src/components/NativeRuntime.tsx cycle de vie Android
frontend/src/components/ServerEndpoint.tsx configuration API APK
backend/src/routes/sync.js      pull produits/prix par curseur
artifacts/                       ami-pharma-debug.apk livré ; release via Gradle
```
