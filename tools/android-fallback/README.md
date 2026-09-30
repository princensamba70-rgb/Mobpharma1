# Wrapper Android de secours

`android/` reste le projet Android canonique : c'est lui qui utilise Capacitor, le plugin natif AMI PHARMA basé sur Android Keystore, le splash généré et la configuration Gradle API 36.

Ce dossier contient uniquement l'activité minimale utilisée pour produire `artifacts/ami-pharma-debug.apk` dans la sandbox quand aucun JDK ni SDK Android n'était disponible pour Gradle. Elle embarque le même bundle `frontend/dist`, gère le bouton retour et expose un petit coffre AES/GCM Android Keystore pour que le bundle de secours ne retombe pas sur `localStorage` pour les tokens.

## Cause de l'écran blanc corrigée

La première activité de secours ouvrait `file:///android_asset/index.html`. Le bundle Vite utilise des scripts ES modules, des imports dynamiques et des feuilles de style avec CORS ; Android WebView les bloque depuis une origine `file://` opaque, avant que React ne puisse monter. Le résultat était un écran blanc sans exception Java visible dans l'activité.

Le wrapper sert maintenant les assets APK sur l'origine sécurisée `https://localhost`, via `WebViewClient.shouldInterceptRequest`, avec les bons types MIME. Cette origine est également celle autorisée par l'API Capacitor en production. Les assets manquants sont signalés dans Logcat avec le tag `AmiPharma`. Les requêtes API `http://` explicitement configurées restent possibles via le mode cleartext/mixed-content du fallback ; les certificats HTTPS ne sont jamais acceptés sans validation.

Ce wrapper n'est pas le chemin de release. Pour une build de production, utilisez :

```bash
npm run android:debug
```

Si une machine doit reproduire le fallback, `build.sh` accepte les chemins des outils (`ANDROID_AAPT2`, `ANDROID_JAR`, `ANDROID_ECJ`, `ANDROID_D8`, `ANDROID_APKSIGNER`, `JAVA_BIN` et `KEYTOOL_BIN`) et produit `artifacts/ami-pharma-debug.apk`. Un JDK complet est recommandé ; `ANDROID_ECJ_CLASSPATH` peut fournir les classes manquantes à un runtime Java réduit. Pour conserver la compatibilité d'une réinstallation par-dessus un ancien debug APK, fournissez aussi un keystore de développement hors du dépôt via `ANDROID_DEBUG_KEYSTORE` et ses variables `ANDROID_DEBUG_*_PASSWORD`/`ANDROID_DEBUG_KEY_ALIAS`. Sinon un keystore temporaire est généré. Le fichier Java est volontairement indépendant de Capacitor et ne doit pas remplacer `android/app/src/main/java`.
