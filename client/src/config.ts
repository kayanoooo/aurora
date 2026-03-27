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
    return localStorage.getItem('maxServerHost') || 'localhost';
};

// Sync the Electron-side store into localStorage on startup so that
// getServerHost() above stays consistent.
if (isElectron()) {
    (window as any).electronAPI.getServerHost().then((host: string) => {
        if (host) localStorage.setItem('maxServerHost', host);
    });
}

const ENV_API_URL = process.env.REACT_APP_API_URL;
const ENV_WS_URL = process.env.REACT_APP_WS_URL;

export const config = {
    get SERVER_IP() { return getServerHost(); },
    get BASE_URL() {
        if (isElectron()) return `http://${getServerHost()}:8000`;
        if (ENV_API_URL) return ENV_API_URL.replace('/api', '');
        const loc = window.location;
        if (loc.protocol === 'https:') return `https://${loc.host}`;
        return `http://${getServerHost()}:8000`;
    },
    get API_URL() {
        if (isElectron()) return `http://${getServerHost()}:8000/api`;
        if (ENV_API_URL) return ENV_API_URL;
        const loc = window.location;
        if (loc.protocol === 'https:') return `https://${loc.host}/api`;
        return `http://${getServerHost()}:8000/api`;
    },
    get WS_URL() {
        if (isElectron()) return `ws://${getServerHost()}:8000`;
        if (ENV_WS_URL) return ENV_WS_URL;
        const loc = window.location;
        if (loc.protocol === 'https:') return `wss://${loc.host}`;
        return `ws://${getServerHost()}:8000`;
    },

    isElectron,

    /** Change the server address (Electron only). Persists across restarts. */
    setServerHost(host: string) {
        localStorage.setItem('maxServerHost', host);
        if (isElectron()) {
            (window as any).electronAPI.setServerHost(host);
        }
    },
};
