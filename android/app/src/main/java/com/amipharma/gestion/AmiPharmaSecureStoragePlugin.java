package com.amipharma.gestion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Small application-owned credential store. Unlike the old generic plugin, it
 * never falls back to plaintext SharedPreferences when Android Keystore fails.
 */
@CapacitorPlugin(name = "AmiPharmaSecureStorage")
public class AmiPharmaSecureStoragePlugin extends Plugin {
    private static final String PREFS = "ami_pharma_secure_session";
    private static final String KEY_ALIAS = "ami_pharma_keystore_v1";
    private static final String ACCESS_KEY = "ami_pharma_access_token_v1";
    private static final String REFRESH_KEY = "ami_pharma_refresh_token_v1";
    private static final int IV_LENGTH = 12;
    private final SecureRandom random = new SecureRandom();

    private boolean validKey(String key) {
        return ACCESS_KEY.equals(key) || REFRESH_KEY.equals(key);
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
        SecretKey result = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (result == null) throw new IllegalStateException("Android Keystore key unavailable");
        return result;
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        try {
            key();
            result.put("value", true);
        } catch (Exception ignored) {
            result.put("value", false);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (!validKey(key) || value == null) {
            call.reject("Invalid secure storage key");
            return;
        }
        try {
            byte[] iv = new byte[IV_LENGTH];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] packed = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, packed, 0, iv.length);
            System.arraycopy(encrypted, 0, packed, iv.length, encrypted.length);
            boolean saved = preferences().edit()
                .putString(key, Base64.encodeToString(packed, Base64.NO_WRAP))
                .commit();
            if (!saved) {
                call.reject("Secure storage write failed");
                return;
            }
            JSObject result = new JSObject();
            result.put("value", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Secure storage unavailable", error);
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (!validKey(key)) {
            call.reject("Invalid secure storage key");
            return;
        }
        try {
            String encoded = preferences().getString(key, null);
            if (encoded == null) {
                call.reject("Item with given key does not exist");
                return;
            }
            byte[] packed = Base64.decode(encoded, Base64.NO_WRAP);
            if (packed.length <= IV_LENGTH) throw new IllegalStateException("Corrupt secure storage value");
            byte[] iv = new byte[IV_LENGTH];
            byte[] encrypted = new byte[packed.length - IV_LENGTH];
            System.arraycopy(packed, 0, iv, 0, IV_LENGTH);
            System.arraycopy(packed, IV_LENGTH, encrypted, 0, encrypted.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            JSObject result = new JSObject();
            result.put("value", new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Secure storage unavailable", error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (!validKey(key)) {
            call.reject("Invalid secure storage key");
            return;
        }
        try {
            boolean removed = preferences().edit().remove(key).commit();
            if (!removed) {
                call.reject("Secure storage remove failed");
                return;
            }
            JSObject result = new JSObject();
            result.put("value", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Secure storage unavailable", error);
        }
    }
}
