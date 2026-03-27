const {
    app,
    BrowserWindow,
    Tray,
    Menu,
    nativeImage,
    ipcMain,
    shell,
    Notification,
    dialog,
} = require('electron');
const path = require('path');

const isDev = !!process.env.ELECTRON_START_URL;
const START_URL = process.env.ELECTRON_START_URL
    || `file://${path.join(__dirname, '../client/build/index.html')}`;

let mainWindow = null;
let tray = null;

// ─── Icon ────────────────────────────────────────────────────────────────────

function getAppIcon() {
    const candidates = [
        path.join(__dirname, 'icon.png'),
        path.join(__dirname, '../client/public/logo512.png'),
    ];
    for (const p of candidates) {
        try {
            const img = nativeImage.createFromPath(p);
            if (!img.isEmpty()) return img;
        } catch {}
    }
    return nativeImage.createEmpty();
}

// ─── Main Window ─────────────────────────────────────────────────────────────

function createWindow() {
    const icon = getAppIcon();

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'MAX Messenger',
        icon: icon.isEmpty() ? undefined : icon,
        backgroundColor: '#1a1a2e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // Allow loading local files and mixed content in prod
            webSecurity: isDev,
        },
        show: false,
    });

    mainWindow.loadURL(START_URL);

    if (isDev) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Hide to tray instead of closing
    mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
            if (process.platform === 'linux' || process.platform === 'win32') {
                // Show balloon hint once
                if (tray && !app.trayHintShown) {
                    app.trayHintShown = true;
                    tray.displayBalloon?.({
                        title: 'MAX Messenger',
                        content: 'Приложение свёрнуто в трей. Дважды кликните, чтобы открыть.',
                    });
                }
            }
        }
    });

    // Open all external links in the default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
            e.preventDefault();
            shell.openExternal(url);
        }
    });
}

// ─── System Tray ─────────────────────────────────────────────────────────────

function createTray() {
    const icon = getAppIcon();
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Открыть MAX Messenger',
            click: () => showMainWindow(),
        },
        { type: 'separator' },
        {
            label: 'Настройки сервера',
            click: () => {
                showMainWindow();
                mainWindow.webContents.executeJavaScript(
                    'window.dispatchEvent(new CustomEvent("electron:open-server-settings"))'
                );
            },
        },
        { type: 'separator' },
        {
            label: 'Выход',
            click: () => {
                app.isQuitting = true;
                app.quit();
            },
        },
    ]);

    tray.setToolTip('MAX Messenger');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => showMainWindow());
    tray.on('click', () => showMainWindow()); // Windows single-click
}

function showMainWindow() {
    if (!mainWindow) {
        createWindow();
        return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

// ─── App Menu ─────────────────────────────────────────────────────────────────

function buildAppMenu() {
    const template = [
        {
            label: 'MAX',
            submenu: [
                { label: 'О программе', role: 'about' },
                { type: 'separator' },
                { label: 'Скрыть MAX', role: 'hide' },
                { type: 'separator' },
                {
                    label: 'Выход',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => { app.isQuitting = true; app.quit(); },
                },
            ],
        },
        {
            label: 'Правка',
            submenu: [
                { label: 'Отменить', role: 'undo' },
                { label: 'Повторить', role: 'redo' },
                { type: 'separator' },
                { label: 'Вырезать', role: 'cut' },
                { label: 'Копировать', role: 'copy' },
                { label: 'Вставить', role: 'paste' },
                { label: 'Выделить всё', role: 'selectAll' },
            ],
        },
        {
            label: 'Вид',
            submenu: [
                { label: 'Обновить', role: 'reload' },
                { label: 'Принудительно обновить', role: 'forceReload' },
                ...(isDev ? [{ label: 'DevTools', role: 'toggleDevTools' }] : []),
                { type: 'separator' },
                { label: 'Восстановить масштаб', role: 'resetZoom' },
                { label: 'Увеличить', role: 'zoomIn' },
                { label: 'Уменьшить', role: 'zoomOut' },
                { type: 'separator' },
                { label: 'Полный экран', role: 'togglefullscreen' },
            ],
        },
        {
            label: 'Окно',
            submenu: [
                { label: 'Свернуть', role: 'minimize' },
                { label: 'Закрыть', role: 'close' },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('is-electron', () => true);

// Native notification from renderer
ipcMain.on('show-notification', (event, { title, body, silent, chatType, chatId, senderId, groupId }) => {
    if (Notification.isSupported()) {
        const icon = getAppIcon();
        const notifOpts = {
            title,
            body,
            silent: !!silent,
            icon: icon.isEmpty() ? undefined : icon,
        };
        if (process.platform === 'darwin') {
            notifOpts.hasReply = true;
            notifOpts.replyPlaceholder = 'Введите ответ...';
        }
        const n = new Notification(notifOpts);
        n.on('click', () => {
            showMainWindow();
            if (chatType && chatId != null && mainWindow) {
                mainWindow.webContents.send('notification-click', { chatType, chatId });
            }
        });
        n.on('reply', (_, reply) => {
            if (reply && mainWindow) {
                mainWindow.webContents.send('notification-reply', { chatType, chatId, senderId, groupId, text: reply });
            }
        });
        n.show();
    }
});

// Server host config — stored in userData (not localStorage, works before login)
const Store = (() => {
    const fs = require('fs');
    const storeFile = path.join(app.getPath('userData'), 'config.json');
    const read = () => {
        try { return JSON.parse(fs.readFileSync(storeFile, 'utf8')); }
        catch { return {}; }
    };
    const write = (data) => {
        try { fs.writeFileSync(storeFile, JSON.stringify(data, null, 2)); }
        catch {}
    };
    return { get: (k) => read()[k], set: (k, v) => { const d = read(); d[k] = v; write(d); } };
})();

ipcMain.handle('get-server-host', () => Store.get('serverHost') || 'localhost');
ipcMain.handle('set-server-host', (event, host) => {
    Store.set('serverHost', host);
    // Reload the window so config picks up the new host
    mainWindow?.webContents.reload();
});

// ─── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
    buildAppMenu();
    createWindow();
    createTray();
});

app.on('window-all-closed', () => {
    // Keep running in tray on all platforms
});

app.on('activate', () => {
    // macOS: re-create window on dock click
    showMainWindow();
});

app.on('before-quit', () => {
    app.isQuitting = true;
});
