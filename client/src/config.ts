// Detect Electron environment (loaded from file:// — hostname is empty)
const isElectron = (): boolean => {
    return !!(window as any).electronAPI?.isElectron;
};

// In browser: use hostname from URL (same as before).
// In Electron: use the host stored via electronAPI (defaults to 'localhost').
// getServerHost() is sync so it reads from localStorage as a fast cache;
// the authoritative store is updated via setServerHost().
const getServerHost = (): string => {
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
           h.endsWith('.loca.lt') || h.endsWith('.localhost.run');
};

export const config = {
    get SERVER_IP() { return getServerHost(); },
    get BASE_URL() {
        if (isElectron()) return `http://${getServerHost()}:8000`;
        // Tunnel (ngrok etc): use same origin — requires ngrok to tunnel port 8000 (the FastAPI server)
        if (isTunnelDomain()) return `${window.location.origin}`;
        if (ENV_API_URL) return ENV_API_URL.replace('/api', '');
        const loc = window.location;
        if (loc.protocol === 'https:') return `https://${loc.host}`;
        return `http://${getServerHost()}:8000`;
    },
    get API_URL() {
        if (isElectron()) return `http://${getServerHost()}:8000/api`;
        if (isTunnelDomain()) return `${window.location.origin}/api`;
        if (ENV_API_URL) return ENV_API_URL;
        const loc = window.location;
        if (loc.protocol === 'https:') return `https://${loc.host}/api`;
        return `http://${getServerHost()}:8000/api`;
    },
    get WS_URL() {
        if (isElectron()) return `ws://${getServerHost()}:8000`;
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
        if (path.startsWith('http')) return path;
        if (isElectron()) return `http://${getServerHost()}:8000${path}`;
        if (isTunnelDomain()) return `${window.location.origin}${path}`;
        if (ENV_API_URL) return `${ENV_API_URL.replace('/api', '')}${path}`;
        const loc = window.location;
        const base = loc.protocol === 'https:' ? `https://${loc.host}` : `http://${getServerHost()}:8000`;
        return `${base}${path}`;
    },

    isElectron,

    /** Change the server address (Electron only). Persists across restarts. */
    setServerHost(host: string) {
        localStorage.setItem('auroraServerHost', host);
        if (isElectron()) {
            (window as any).electronAPI.setServerHost(host);
        }
    },
};
