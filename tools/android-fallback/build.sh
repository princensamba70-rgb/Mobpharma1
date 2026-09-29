#!/usr/bin/env bash
# Build the constrained WebView fallback APK. The canonical build is Gradle:
#   npm run android:debug
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AAPT2="${ANDROID_AAPT2:-aapt2}"
ANDROID_JAR="${ANDROID_JAR:-${ANDROID_HOME:-}/platforms/android-34/android.jar}"
ECJ_JAR="${ANDROID_ECJ:-}"
ECJ_CLASSPATH="${ANDROID_ECJ_CLASSPATH:-}"
D8_JAR="${ANDROID_D8:-}"
APKSIGNER_JAR="${ANDROID_APKSIGNER:-}"
JAVA_BIN="${JAVA_BIN:-java}"
KEYTOOL_BIN="${KEYTOOL_BIN:-keytool}"
API_LEVEL="${ANDROID_API_LEVEL:-34}"
OUTPUT="${ANDROID_FALLBACK_OUTPUT:-$ROOT/artifacts/ami-pharma-debug.apk}"
API_ORIGIN="${VITE_API_URL:-http://10.0.2.2:4000}"

require_file() {
  if [ ! -f "$1" ]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command "$AAPT2"
require_command "$JAVA_BIN"
require_command "$KEYTOOL_BIN"
require_command zip
require_file "$ANDROID_JAR"
require_file "$ECJ_JAR"
require_file "$D8_JAR"
require_file "$APKSIGNER_JAR"
require_file "$ROOT/tools/android-fallback/MainActivity.java"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP"/{src,res/drawable,res/values,assets,classes,dex,apk}

VITE_API_URL="$API_ORIGIN" npm --prefix "$ROOT/frontend" run build -- --base=./
cp -a "$ROOT/frontend/dist/." "$TMP/assets/"
sed -i 's#<head>#<head>\n    <script>window.__AMI_ANDROID__=true;</script>#' "$TMP/assets/index.html"
cp "$ROOT/resources/generated/icon.png" "$TMP/res/drawable/icon.png"

cat >"$TMP/res/values/strings.xml" <<'EOF'
<resources><string name="app_name">AMI PHARMA</string></resources>
EOF
cat >"$TMP/res/values/styles.xml" <<'EOF'
<resources>
    <style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar">
        <item name="android:fontFamily">sans</item>
        <item name="android:colorAccent">#0d9488</item>
        <item name="android:navigationBarColor">#0b1324</item>
        <item name="android:statusBarColor">#ffffff</item>
        <item name="android:windowLightStatusBar">true</item>
        <item name="android:windowActionModeOverlay">true</item>
    </style>
</resources>
EOF
cat >"$TMP/AndroidManifest.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<manifest package="com.amipharma.gestion" xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:allowBackup="true" android:icon="@drawable/icon" android:label="@string/app_name" android:supportsRtl="true" android:theme="@style/AppTheme" android:usesCleartextTraffic="true">
        <activity android:name=".MainActivity" android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|screenLayout|uiMode|navigation|density" android:exported="true" android:launchMode="singleTask" android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
EOF
cp "$ROOT/tools/android-fallback/MainActivity.java" "$TMP/src/MainActivity.java"

"$AAPT2" compile --dir "$TMP/res" -o "$TMP/res/compiled.zip"
"$AAPT2" link -o "$TMP/apk/resources.apk" -I "$ANDROID_JAR" --manifest "$TMP/AndroidManifest.xml" \
  --auto-add-overlay --min-sdk-version 24 --target-sdk-version "$API_LEVEL" \
  --version-code 1 --version-name 1.0.0 -A "$TMP/assets" "$TMP/res/compiled.zip"
if [ -n "$ECJ_CLASSPATH" ]; then
  "$JAVA_BIN" -cp "$ECJ_CLASSPATH:$ECJ_JAR" org.eclipse.jdt.internal.compiler.batch.Main \
    -proc:none -source 8 -target 8 -encoding UTF-8 \
    -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
    -d "$TMP/classes" "$TMP/src/MainActivity.java"
else
  "$JAVA_BIN" -jar "$ECJ_JAR" -proc:none -source 8 -target 8 -encoding UTF-8 \
    -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
    -d "$TMP/classes" "$TMP/src/MainActivity.java"
fi
mapfile -t JAVA_CLASSES < <(find "$TMP/classes" -name '*.class' -print)
if [ "${#JAVA_CLASSES[@]}" -eq 0 ]; then
  echo "ECJ did not produce any class files" >&2
  exit 1
fi
"$JAVA_BIN" -cp "$D8_JAR" com.android.tools.r8.D8 --release --min-api 24 \
  --lib "$ANDROID_JAR" --output "$TMP/dex" "${JAVA_CLASSES[@]}"
cp "$TMP/apk/resources.apk" "$TMP/apk/app-unsigned.apk"
(cd "$TMP/dex" && zip -q -u ../apk/app-unsigned.apk classes.dex)

KEYSTORE="$TMP/debug.keystore"
"$JAVA_BIN" -version >/dev/null 2>&1
"$KEYTOOL_BIN" -genkeypair -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
  -keystore "$KEYSTORE" -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US" \
  >/dev/null 2>&1
mkdir -p "$(dirname "$OUTPUT")"
"$JAVA_BIN" -jar "$APKSIGNER_JAR" sign \
  --ks "$KEYSTORE" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  --out "$OUTPUT" "$TMP/apk/app-unsigned.apk"
"$JAVA_BIN" -jar "$APKSIGNER_JAR" verify --verbose "$OUTPUT"
printf 'Created %s (%s bytes)\n' "$OUTPUT" "$(wc -c < "$OUTPUT")"
