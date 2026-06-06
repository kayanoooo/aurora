import { registerPlugin } from '@capacitor/core';

export type NativeAudioRouteId = 'earpiece' | 'speaker' | 'bluetooth';

export interface NativeAudioRoute {
    id: NativeAudioRouteId;
    label: string;
    available: boolean;
    deviceId?: string;
}

interface AuroraAudioPlugin {
    getRoutes(): Promise<{ routes: NativeAudioRoute[]; activeRoute?: NativeAudioRouteId }>;
    setRoute(options: { route: NativeAudioRouteId; deviceId?: string }): Promise<{ activeRoute?: NativeAudioRouteId }>;
}

export const AuroraAudio = registerPlugin<AuroraAudioPlugin>('AuroraAudio');
