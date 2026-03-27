const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,

    // App info
    getVersion: () => ipcRenderer.invoke('get-version'),
    getPlatform: () => ipcRenderer.invoke('get-platform'),

    // Native notifications
    showNotification: (title, body, options = {}) =>
        ipcRenderer.send('show-notification', { title, body, ...options }),

    // Notification event callbacks (called from main process)
    onNotificationReply: (callback) => {
        ipcRenderer.removeAllListeners('notification-reply');
        ipcRenderer.on('notification-reply', (_, data) => callback(data));
    },
    onNotificationClick: (callback) => {
        ipcRenderer.removeAllListeners('notification-click');
        ipcRenderer.on('notification-click', (_, data) => callback(data));
    },

    // Server host configuration (persisted in Electron userData, not localStorage)
    getServerHost: () => ipcRenderer.invoke('get-server-host'),
    setServerHost: (host) => ipcRenderer.invoke('set-server-host', host),
});
