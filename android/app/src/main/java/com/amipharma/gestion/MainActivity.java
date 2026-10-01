package com.amipharma.gestion;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AmiPharmaSecureStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
