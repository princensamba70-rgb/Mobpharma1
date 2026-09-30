# AMI PHARMA — Web & Android

Application professionnelle de gestion de pharmacie, issue du projet `App-partage1` et empaquetée en application Android avec Capacitor. Le projet conserve le frontend React/TypeScript et l'API REST Node.js/Express existants : l'APK est une vraie application installable, pas une simple page ouverte dans Chrome.

> **Date de l'audit :** 30 septembre 2026
> **Application ID Android :** `com.amipharma.gestion`
> **Version actuelle :** `1.0.0` (`versionCode 1`)
> **Langue / devise :** français / CDF

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
│   │                           notifications, audit, paramètres, exports
│   ├── src/lib/                Prisma, JWT, statistiques, règles métier
│   ├── src/middleware/         authentification, RBAC, validation, erreurs
│   └── data/catalog.json       catalogue de prix importé
├── frontend/                  React 18 + TypeScript + Vite + Tailwind
│   └── src/
│       ├── api/client.ts       fetch, refresh, cache hors connexion, exports
│       ├── context/             authentification, réseau, notifications
│       ├── components/          layout, navigation mobile, UI, exports
│       └── pages/               16 écrans métier existants
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

## 4. Hors connexion et synchronisation

Le métier étant transactionnel et centralisé (vente, stock et finance), une écriture locale aveugle pourrait créer des doubles ventes ou des stocks incohérents. Le choix sûr est donc :

- détection native et navigateur de la connectivité ;
- cache limité des lectures non sensibles aux tokens, utilisé seulement si une requête GET échoue ;
- indication claire `en ligne`, `hors connexion` ou `données mises en cache` ;
- les écritures sont refusées hors connexion avec un message explicite, jamais simulées ;
- reconnexion automatique du client et renouvellement de session ;
- invalidation du cache à la déconnexion.

Une véritable file de synchronisation de ventes devrait être ajoutée côté serveur avec des identifiants d'idempotence et une politique métier validée par l'organisation ; elle n'existait pas dans le projet source et n'a pas été inventée au risque de modifier les règles de stock.

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
| taille | `254 889 octets` |
| SHA-256 | `462ca7e987ee2c945b66dbd76cfb46c46c9039708da18caa968963a43757d192` |
| vérification | signature APK v2/v3 valide, manifeste contrôlé par `aapt2 dump badging` |

Cette sandbox ne disposait pas du JDK/SDK requis par Gradle. L'APK livré a donc été produit par le wrapper de secours documenté dans `tools/android-fallback/`, avec le bundle React compilé et un stockage AES/GCM protégé par Android Keystore. Le projet `android/` Capacitor reste la voie canonique et doit être utilisé pour les builds de release et pour bénéficier de tous les plugins Capacitor. L'APK de secours accepte les endpoints `http://` et `https://` ; sa valeur par défaut est l'émulateur Android (`http://10.0.2.2:4000`). Sur un téléphone, renseignez l'URL API depuis **Serveur de données** ou reconstruisez avec `VITE_API_URL`.

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

## 10. Tests effectués

- analyse de l'archive source et inventaire des routes, pages, services, schémas, Docker et variables ;
- build TypeScript/Vite du frontend ;
- vérification `node --check` de tous les fichiers backend ;
- tests Node des règles d'arrondi, du statut de stock et des attributs cookie HTTP/HTTPS ;
- tests Vitest du stockage secure disponible/indisponible, du repli mémoire, des identifiants invalides, de la perte réseau et du refus d'un certificat HTTPS invalide ;
- vérification que le navigateur n'utilise pas le plugin Web base64/localStorage pour les tokens et utilise le cookie httpOnly ;
- `npx cap doctor` : projet Android détecté et plugins synchronisés ;
- contrôle de la configuration Android, de l'application ID, des permissions réseau, du splash, des icônes et du manifeste debug/release ;
- compilation Java/D8 du wrapper corrigé, avec inclusion de la classe `LocalAssetWebViewClient` et du coffre Android Keystore ;
- création de `artifacts/ami-pharma-debug.apk` par le wrapper de secours, inspection du manifeste et vérification de signature APK v2/v3 ;
- contrôle automatisé que les références `./assets/*` de `index.html` existent dans l'APK et que l'APK utilise `https://localhost/index.html` plutôt que `file://` ;
- endpoint de santé prévu et testable par `curl` une fois l'API démarrée ;
- build frontend exécuté avec succès après la correction, sans modification des pages métier.

Les tests nécessitant une base Prisma restent bloqués dans cette sandbox : le client doit télécharger son moteur natif et le réseau TLS externe a échoué. Les tests d'authentification HTTP/HTTPS réalisés ici sont des tests de transport et de contrat ; la connexion à une base réelle nécessite un serveur Prisma opérationnel. Le build Gradle Capacitor est également bloqué avant compilation tant qu'un JDK et un Android SDK API 36 ne sont pas disponibles. Le frontend, le wrapper de secours et la signature de l'APK livré ont en revanche été réellement compilés et vérifiés.

## 11. Limites connues

1. Aucun serveur API public n'était fourni dans le dépôt source : l'URL doit être configurée par l'installation ou par `VITE_API_URL`.
2. La sandbox actuelle ne contenait ni JDK/`javac` ni Android SDK API 36, et les téléchargements de binaires externes (Prisma/Adoptium/SDK) ont été refusés par son réseau. Le projet Capacitor/Gradle est toutefois généré et configuré ; l'APK livré est explicitement le fallback documenté, pas un build Gradle de release.
3. Sans appareil ou émulateur `adb` dans cette sandbox, l'installation réelle, la connexion API, la rotation, le offline/reconnexion et le test du bouton retour ne peuvent pas être exécutés ici. Le manifeste et le code de navigation ont été contrôlés statiquement ; exécutez la checklist ci-dessous avec un appareil.
4. Les notifications push ne sont pas activées car aucune clé Firebase/FCM n'existait dans le projet source. L'architecture de notifications API et le plugin Capacitor pourront être ajoutés sans exposer de secret.

Checklist appareil/émulateur recommandée :

```text
installer l'APK → ouvrir → configurer Serveur de données → tester /api/health
→ connexion/déconnexion → dashboard → stock/ventes/rapports → verrouiller l'écran
→ désactiver le réseau → vérifier le cache GET et le refus des écritures → reconnecter
→ utiliser le bouton retour dans plusieurs écrans → fermer puis rouvrir l'application.
```

## 12. Arborescence mobile livrée

```text
android/                         projet Android Gradle Capacitor
capacitor.config.ts              configuration Capacitor
resources/icon.svg               source de l'icône AMI PHARMA
resources/splash.svg             source du splash screen
frontend/src/lib/secureStorage.ts coffre tokens
frontend/src/context/NetworkContext.tsx statut réseau/cache
frontend/src/components/NativeRuntime.tsx cycle de vie Android
frontend/src/components/ServerEndpoint.tsx configuration API APK
artifacts/                       ami-pharma-debug.apk livré ; release via Gradle
```
