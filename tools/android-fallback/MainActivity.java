package com.amipharma.gestion;

import android.app.Activity;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

/**
 * Minimal fallback wrapper used only when Gradle/Android SDK cannot run in the
 * build sandbox. The canonical Android application is android/ (Capacitor).
 * Tokens exposed to the web bundle are still encrypted with Android Keystore.
 */
public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        webView.addJavascriptInterface(new SecureStorageBridge(), "AmiPharmaSecureStorage");
        webView.setWebViewClient(new WebViewClient());
        webView.loadUrl("file:///android_asset/index.html");
        setContentView(webView);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private final class SecureStorageBridge {
        private static final String PREFS = "ami_pharma_secure_session";
        private static final String KEY_ALIAS = "ami_pharma_keystore_v1";
        private final SecureRandom random = new SecureRandom();

        private boolean valid(String key) {
            return "ami_pharma_access_token_v1".equals(key)
                || "ami_pharma_refresh_token_v1".equals(key);
        }

        private SecretKey key() throws Exception {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (!store.containsAlias(KEY_ALIAS)) {
                KeyGenerator generator = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build());
                generator.generateKey();
            }
            return ((SecretKey) store.getKey(KEY_ALIAS, null));
        }

        @JavascriptInterface
        public synchronized String get(String key) {
            if (!valid(key)) return null;
            try {
                String encoded = MainActivity.this.getSharedPreferences(PREFS, MODE_PRIVATE).getString(key, null);
                if (encoded == null) return null;
                byte[] packed = Base64.decode(encoded, Base64.NO_WRAP);
                byte[] iv = new byte[12];
                byte[] cipherText = new byte[packed.length - iv.length];
                System.arraycopy(packed, 0, iv, 0, iv.length);
                System.arraycopy(packed, iv.length, cipherText, 0, cipherText.length);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
                return new String(cipher.doFinal(cipherText), StandardCharsets.UTF_8);
            } catch (Exception ignored) {
                return null;
            }
        }

        @JavascriptInterface
        public synchronized boolean set(String key, String value) {
            if (!valid(key) || value == null) return false;
            try {
                byte[] iv = new byte[12];
                random.nextBytes(iv);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(128, iv));
                byte[] cipherText = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
                byte[] packed = new byte[iv.length + cipherText.length];
                System.arraycopy(iv, 0, packed, 0, iv.length);
                System.arraycopy(cipherText, 0, packed, iv.length, cipherText.length);
                return MainActivity.this.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putString(key, Base64.encodeToString(packed, Base64.NO_WRAP))
                    .commit();
            } catch (Exception ignored) {
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean remove(String key) {
            if (!valid(key)) return false;
            return MainActivity.this.getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(key).commit();
        }
    }
}
