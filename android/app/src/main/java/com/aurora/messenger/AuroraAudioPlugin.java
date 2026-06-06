package com.aurora.messenger;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AuroraAudio")
public class AuroraAudioPlugin extends Plugin {
    private static final String ROUTE_EARPIECE = "earpiece";
    private static final String ROUTE_SPEAKER = "speaker";
    private static final String ROUTE_BLUETOOTH = "bluetooth";

    private AudioManager audioManager() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void getRoutes(PluginCall call) {
        AudioManager audio = audioManager();
        JSArray routes = new JSArray();

        routes.put(route(ROUTE_EARPIECE, "Динамик телефона", true));
        routes.put(route(ROUTE_SPEAKER, "Громкая связь", true));

        if (audio != null) {
            for (AudioDeviceInfo device : getOutputDevices(audio)) {
                if (isBluetoothDevice(device)) {
                    routes.put(route(
                        ROUTE_BLUETOOTH,
                        device.getProductName() != null ? device.getProductName().toString() : "Bluetooth",
                        true,
                        String.valueOf(device.getId())
                    ));
                }
            }
        }

        JSObject result = new JSObject();
        result.put("routes", routes);
        result.put("activeRoute", getActiveRoute(audio));
        call.resolve(result);
    }

    @PluginMethod
    public void setRoute(PluginCall call) {
        String route = call.getString("route", ROUTE_SPEAKER);
        String deviceId = call.getString("deviceId", null);
        AudioManager audio = audioManager();
        if (audio == null) {
            call.reject("Audio manager is unavailable");
            return;
        }

        try {
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ROUTE_SPEAKER.equals(route)) {
                    setCommunicationDevice(audio, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, null);
                } else if (ROUTE_EARPIECE.equals(route)) {
                    setCommunicationDevice(audio, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, null);
                } else if (ROUTE_BLUETOOTH.equals(route)) {
                    setCommunicationDevice(audio, -1, deviceId);
                }
            } else {
                if (ROUTE_BLUETOOTH.equals(route)) {
                    audio.setSpeakerphoneOn(false);
                    audio.startBluetoothSco();
                    audio.setBluetoothScoOn(true);
                } else {
                    audio.setBluetoothScoOn(false);
                    audio.stopBluetoothSco();
                    audio.setSpeakerphoneOn(ROUTE_SPEAKER.equals(route));
                }
            }

            JSObject result = new JSObject();
            result.put("activeRoute", getActiveRoute(audio));
            call.resolve(result);
        } catch (SecurityException ex) {
            call.reject("Нет доступа к Bluetooth-аудио. Разрешите подключение к Bluetooth-устройствам.", ex);
        } catch (Exception ex) {
            call.reject("Не удалось переключить аудиовыход", ex);
        }
    }

    private JSObject route(String id, String label, boolean available) {
        return route(id, label, available, null);
    }

    private JSObject route(String id, String label, boolean available, String deviceId) {
        JSObject route = new JSObject();
        route.put("id", id);
        route.put("label", label);
        route.put("available", available);
        if (deviceId != null) route.put("deviceId", deviceId);
        return route;
    }

    private AudioDeviceInfo[] getOutputDevices(AudioManager audio) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && hasBluetoothConnectPermission()) {
            return audio.getAvailableCommunicationDevices().toArray(new AudioDeviceInfo[0]);
        }
        return audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
    }

    private boolean hasBluetoothConnectPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isBluetoothDevice(AudioDeviceInfo device) {
        int type = device.getType();
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
            || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET)
            || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_SPEAKER);
    }

    private String getActiveRoute(AudioManager audio) {
        if (audio == null) return ROUTE_SPEAKER;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo device = audio.getCommunicationDevice();
            if (device != null) {
                if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) return ROUTE_EARPIECE;
                if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return ROUTE_SPEAKER;
                if (isBluetoothDevice(device)) return ROUTE_BLUETOOTH;
            }
        }
        if (audio.isBluetoothScoOn()) return ROUTE_BLUETOOTH;
        return audio.isSpeakerphoneOn() ? ROUTE_SPEAKER : ROUTE_EARPIECE;
    }

    private void setCommunicationDevice(AudioManager audio, int targetType, String targetId) {
        for (AudioDeviceInfo device : getOutputDevices(audio)) {
            boolean idMatches = targetId != null && targetId.equals(String.valueOf(device.getId()));
            boolean typeMatches = targetType != -1 && device.getType() == targetType;
            if (idMatches || typeMatches || (targetType == -1 && isBluetoothDevice(device))) {
                audio.setCommunicationDevice(device);
                return;
            }
        }
    }
}
