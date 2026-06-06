package com.aurora.messenger;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuroraAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
