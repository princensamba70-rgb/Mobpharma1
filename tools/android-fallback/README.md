# Wrapper Android de secours

`android/` reste le projet Android canonique : c'est lui qui utilise Capacitor, les plugins natifs, le splash généré et la configuration Gradle API 36.

Ce dossier contient uniquement l'activité minimale utilisée pour produire `artifacts/ami-pharma-debug.apk` dans la sandbox quand aucun JDK ni SDK Android n'était disponible pour Gradle. Elle embarque le même bundle `frontend/dist`, gère le bouton retour et expose un petit coffre AES/GCM Android Keystore pour que le bundle de secours ne retombe pas sur `localStorage` pour les tokens.

Ce wrapper n'est pas le chemin de release. Pour une build de production, utilisez :

```bash
npm run android:debug
```

Si une machine doit reproduire le fallback, `build.sh` accepte les chemins des outils (`ANDROID_AAPT2`, `ANDROID_JAR`, `ANDROID_ECJ`, `ANDROID_D8`, `ANDROID_APKSIGNER`, `JAVA_BIN` et `KEYTOOL_BIN`) et produit `artifacts/ami-pharma-debug.apk`. Un JDK complet est recommandé ; `ANDROID_ECJ_CLASSPATH` peut fournir les classes manquantes à un runtime Java réduit. Le fichier Java est volontairement indépendant de Capacitor et ne doit pas remplacer `android/app/src/main/java`.
