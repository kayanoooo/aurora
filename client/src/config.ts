import { Capacitor } from '@capacitor/core';

// Detect Electron environment (loaded from file:// — hostname is empty)
const isElectron = (): boolean => {
    return !!(window as any).electronAPI?.isElectron;
};

const isCapacitorNative = (): boolean => {
    return !!Capacitor.isNativePlatform?.();
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const normalizeFilePath = (path: string): string => {
    const value = path.trim();
    if (/^https?:\/\//i.test(value)) {
        try {
            const url = new URL(value);
            if (url.pathname.startsWith('/files/')) return url.pathname;
        } catch {
            return value;
        }
        return value;
    }
    if (value.startsWith('/')) return value;
    if (value.startsWith('files/')) return `/${value}`;
    if (value.startsWith('uploads/')) return `/files/${value.replace(/^uploads\/+/, '')}`;
    return `/${value}`;
};

export const serverBaseFromHost = (host: string): string => {
    const value = trimTrailingSlash((host || '').trim());
    if (!value) return 'http://localhost:8000';
    if (/^https?:\/\//i.test(value)) {
        if (/:\d+(\/|$)/.test(value)) return value;
        const urlHost = value.replace(/^https?:\/\//i, '');
        if (/^(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(\/|$)/i.test(urlHost)) return `${value}:8000`;
        return value;
    }
    if (/:\d+(\/|$)/.test(value)) return `http://${value}`;
    return `http://${value}:8000`;
};

export const normalizeServerAddress = (value: string): string =>
    trimTrailingSlash((value || '').trim().replace(/\/api\/?$/, ''));

const getConfiguredServerBase = (): string => {
    if (ENV_API_URL) return trimTrailingSlash(ENV_API_URL.replace(/\/api\/?$/, ''));
    if (isCapacitorNative() || isElectron()) {
        const storedHost = localStorage.getItem('auroraServerHost');
        if (storedHost) return serverBaseFromHost(storedHost);
    }
    return serverBaseFromHost(localStorage.getItem('auroraServerHost') || 'localhost');
};

// In browser: use hostname from URL (same as before).
// In Electron: use the host stored via electronAPI (defaults to 'localhost').
// getServerHost() is sync so it reads from localStorage as a fast cache;
// the authoritative store is updated via setServerHost().
const getServerHost = (): string => {
    if (isCapacitorNative()) return localStorage.getItem('auroraServerHost') || 'localhost';
    const h = window.location.hostname;
    if (h && h !== '') return h;
    // Electron / file:// mode
    return localStorage.getItem('auroraServerHost') || 'localhost';
};

// Sync the Electron-side store into localStorage on startup so that
// getServerHost() above stays consistent.
if (isElectron()) {
    (window as any).electronAPI.getServerHost().then((host: string) => {
        if (host) localStorage.setItem('auroraServerHost', host);
    });
}

const ENV_API_URL = process.env.REACT_APP_API_URL;
const ENV_WS_URL = process.env.REACT_APP_WS_URL;

// Detect tunnel services (ngrok, etc.) — route to local backend when accessed via tunnel
const isTunnelDomain = (): boolean => {
    const h = window.location.hostname;
    return h.endsWith('.ngrok-free.dev') || h.endsWith('.ngrok-free.app') ||
           h.endsWith('.ngrok.io') || h.endsWith('.ngrok.app') ||
           h.endsWith('.loca.lt') || h.endsWith('.localhost.run') ||
           h.endsWith('.lhr.life') || h.endsWith('.trycloudflare.com') ||
           h.endsWith('.pinggy-free.link') || h.endsWith('.pinggy.link');
};

export const config = {
    get SERVER_IP() { return getServerHost(); },
    get BASE_URL() {
        if (isCapacitorNative() || isElectron()) return getConfiguredServerBase();
        // Tunnel (ngrok etc): use same origin — requires ngrok to tunnel port 8000 (the FastAPI server)
        if (isTunnelDomain()) return `${window.location.origin}`;
        if (ENV_API_URL) return ENV_API_URL.replace('/api', '');
        const loc = window.location;
        if (loc.protocol === 'https:') return `https://${loc.host}`;
        return `http://${getServerHost()}:8000`;
    },
    get API_URL() {
        if (isCapacitorNative() || isElectron()) return `${getConfiguredServerBase()}/api`;
        if (isTunnelDomain()) return `${window.location.origin}/api`;
        if (ENV_API_URL) return ENV_API_URL;
        const loc = window.location;
        if (loc.protocol === 'https:') return `https://${loc.host}/api`;
        return `http://${getServerHost()}:8000/api`;
    },
    get WS_URL() {
        if (isCapacitorNative() || isElectron()) {
            if (ENV_WS_URL) return ENV_WS_URL;
            const base = getConfiguredServerBase();
            return base.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
        }
        if (isTunnelDomain()) {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${proto}//${window.location.host}`;
        }
        if (ENV_WS_URL) return ENV_WS_URL;
        const loc = window.location;
        if (loc.protocol === 'https:') return `wss://${loc.host}`;
        return `ws://${getServerHost()}:8000`;
    },

    fileUrl(path: string | null | undefined): string | null {
        if (!path) return null;
        const normalizedPath = normalizeFilePath(path);
        if (normalizedPath.startsWith('http')) return normalizedPath;
        if (isCapacitorNative() || isElectron()) return `${getConfiguredServerBase()}${normalizedPath}`;
        if (isTunnelDomain()) return `${window.location.origin}${normalizedPath}`;
        if (ENV_API_URL) return `${ENV_API_URL.replace('/api', '')}${normalizedPath}`;
        const loc = window.location;
        const base = loc.protocol === 'https:' ? `https://${loc.host}` : `http://${getServerHost()}:8000`;
        return `${base}${normalizedPath}`;
    },

    isElectron,
    isCapacitorNative,

    /** Change the server address for Electron/Capacitor. Persists across restarts. */
    setServerHost(host: string) {
        localStorage.setItem('auroraServerHost', normalizeServerAddress(host));
        if (isElectron()) {
            (window as any).electronAPI.setServerHost(normalizeServerAddress(host));
        }
    },
};
