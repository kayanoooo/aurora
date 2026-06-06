import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Badge } from '@capawesome/capacitor-badge';

export type AuroraRuntime = 'capacitor' | 'electron' | 'pwa' | 'web';

export interface AuroraNotificationData {
    chatType?: 'private' | 'group';
    chatId?: number;
    senderId?: number;
    groupId?: number;
    url?: string;
    [key: string]: any;
}

export interface AuroraNotificationOptions {
    title: string;
    body?: string;
    tag?: string;
    data?: AuroraNotificationData;
    silent?: boolean;
}

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let swMessageBridgeAttached = false;
let runtimeCleanup: (() => void) | null = null;

const appLogo192 = '/logo192.png';
const appLogo512 = '/logo512.png';

export const getAuroraRuntime = (): AuroraRuntime => {
    if (Capacitor.isNativePlatform?.()) return 'capacitor';
    if ((window as any).electronAPI) return 'electron';
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone;
    return standalone ? 'pwa' : 'web';
};

const dispatchAuroraEvent = (name: string, detail?: any) => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
};

const handleServiceWorkerMessage = (event: MessageEvent) => {
    const msg = event.data || {};
    if (msg.type === 'AURORA_NOTIFICATION_CLICK') {
        dispatchAuroraEvent('aurora:notification-click', msg.data || {});
    }
    if (msg.type === 'AURORA_NOTIFICATION_REPLY') {
        dispatchAuroraEvent('aurora:notification-reply', msg.data || {});
    }
};

const ensureServiceWorkerBridge = () => {
    if (!('serviceWorker' in navigator) || swMessageBridgeAttached) return;
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    swMessageBridgeAttached = true;
};

export const registerAuroraServiceWorker = () => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') {
        return Promise.resolve<ServiceWorkerRegistration | null>(null);
    }
    ensureServiceWorkerBridge();
    if (!swRegistrationPromise) {
        swRegistrationPromise = new Promise(resolve => {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js', { scope: '/' })
                    .then(reg => {
                        window.setInterval(() => reg.update(), 30 * 60 * 1000);
                        resolve(reg);
                    })
                    .catch(() => resolve(null));
            });
        });
    }
    return swRegistrationPromise;
};

export const initMobileAppRuntime = () => {
    ensureServiceWorkerBridge();
    document.documentElement.dataset.auroraRuntime = getAuroraRuntime();

    if (runtimeCleanup) return runtimeCleanup;

    const cleanupFns: Array<() => void> = [];
    const emitState = (isActive: boolean) => {
        dispatchAuroraEvent(isActive ? 'aurora:app-foreground' : 'aurora:app-background');
    };

    const onVisibility = () => emitState(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', () => emitState(true));
    window.addEventListener('blur', () => emitState(false));
    cleanupFns.push(() => document.removeEventListener('visibilitychange', onVisibility));

    const nativeListeners: any[] = [];
    if (Capacitor.isNativePlatform?.()) {
        CapacitorApp.addListener('appStateChange', ({ isActive }) => emitState(!!isActive))
            .then((h: any) => nativeListeners.push(h))
            .catch(() => {});
        CapacitorApp.addListener('resume', () => emitState(true))
            .then((h: any) => nativeListeners.push(h))
            .catch(() => {});
        CapacitorApp.addListener('pause', () => emitState(false))
            .then((h: any) => nativeListeners.push(h))
            .catch(() => {});
    }

    runtimeCleanup = () => {
        cleanupFns.forEach(fn => fn());
        nativeListeners.forEach(h => h?.remove?.());
        runtimeCleanup = null;
    };
    return runtimeCleanup;
};

export const ensureAuroraNotificationPermission = async (_request = true): Promise<NotificationPermission | 'unsupported'> => {
    if (Capacitor.isNativePlatform?.()) return 'unsupported';
    return 'unsupported';
};

export const showAuroraNotification = async (_options: AuroraNotificationOptions) => {
    return false;
};

export const registerAuroraPushNotifications = async () => {
    return null;
};

export const onAuroraNotificationClick = (handler: (data: AuroraNotificationData) => void) => {
    const listener = (event: Event) => handler((event as CustomEvent<AuroraNotificationData>).detail || {});
    window.addEventListener('aurora:notification-click', listener);
    return () => window.removeEventListener('aurora:notification-click', listener);
};

export const onAuroraNotificationReply = (handler: (data: AuroraNotificationData & { text?: string }) => void) => {
    const listener = (event: Event) => handler((event as CustomEvent<AuroraNotificationData & { text?: string }>).detail || {});
    window.addEventListener('aurora:notification-reply', listener);
    return () => window.removeEventListener('aurora:notification-reply', listener);
};

export const setAuroraAppBadge = async (count: number) => {
    const safeCount = Math.max(0, Math.floor(count || 0));
    const nav = navigator as any;
    try {
        if (safeCount > 0 && nav.setAppBadge) await nav.setAppBadge(safeCount);
        else if (nav.clearAppBadge) await nav.clearAppBadge();
    } catch {}

    try {
        if (Capacitor.isNativePlatform?.()) {
            if (safeCount > 0) await Badge.set({ count: safeCount });
            else await Badge.clear();
        }
    } catch {}
};

export const getDefaultNotificationIcon = () => ({ icon: appLogo192, badge: appLogo192, image: appLogo512 });
