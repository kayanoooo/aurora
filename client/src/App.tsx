import { useState, useCallback, useEffect } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import SetupModal from './components/SetupModal';
import { ThemeSettings } from './types';
import { api } from './services/api';
import { wsService } from './services/websocket';
import './App.css';

const DEFAULT_THEME: ThemeSettings = {
    fontSize: 14,
    bubbleOwnColor: '#1a73e8',
    bubbleOtherColor: '#e8e8e8',
    chatBg: '#fafafa',
    darkMode: false,
    avatarColor: '#1a73e8',
};

const THEME_MAP: Record<string, Partial<ThemeSettings>> = {
    light: { darkMode: false, chatBg: '#f8f9ff', bubbleOwnColor: '#6366f1',  bubbleOtherColor: '#e8e8e8' },
    dark:  { darkMode: true,  chatBg: '#1a1a2e', bubbleOwnColor: '#6366f1',  bubbleOtherColor: '#2a2a3d' },
    oled:  { darkMode: true,  chatBg: '#000000', bubbleOwnColor: '#a78bfa',  bubbleOtherColor: '#0d0d0d' },
};

interface AuthState {
    token: string;
    userId: number;
    username: string;
    avatar?: string;
    status?: string;
    tag?: string;
    isDeveloper?: boolean;
}

function App() {
    const [auth, setAuth] = useState<AuthState | null>(null);
    const [setupToken, setSetupToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [theme, setTheme] = useState<ThemeSettings>(() => {
        try {
            let userId: number | null = null;
            try { const a = localStorage.getItem('chat_auth'); if (a) userId = JSON.parse(a).userId; } catch {}
            const key = userId ? `chat_theme_${userId}` : 'chat_theme';
            const saved = localStorage.getItem(key) ?? (userId ? localStorage.getItem('chat_theme') : null);
            const t = saved ? { ...DEFAULT_THEME, ...JSON.parse(saved) } : DEFAULT_THEME;
            if (t.darkMode && t.chatBg === '#000000') document.body.classList.add('oled-theme');
            return t;
        } catch { return DEFAULT_THEME; }
    });

    const restoreSession = useCallback(async (token: string, userId: number, username: string) => {
        try {
            const themeKey = `chat_theme_${userId}`;
            const saved = localStorage.getItem(themeKey) ?? localStorage.getItem('chat_theme');
            if (saved) {
                const t = { ...DEFAULT_THEME, ...JSON.parse(saved) };
                setTheme(t);
                document.body.classList.toggle('oled-theme', t.darkMode && t.chatBg === '#000000');
            }
            const res = await api.getProfile(token);
            if (res.success && res.user) {
                const avatar = res.user.avatar || undefined;
                const status = res.user.status || undefined;
                const tag = res.user.tag || undefined;
                if (res.user.avatar_color) {
                    setTheme(prev => {
                        const updated = { ...prev, avatarColor: res.user.avatar_color };
                        localStorage.setItem(themeKey, JSON.stringify(updated));
                        return updated;
                    });
                }
                setAuth({ token, userId, username: res.user.username || username, avatar, status, tag });
            } else {
                localStorage.removeItem('chat_auth');
            }
        } catch {
            localStorage.removeItem('chat_auth');
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        try {
            const saved = localStorage.getItem('chat_auth');
            if (saved) {
                const { token, userId, username } = JSON.parse(saved);
                if (token && userId && username) {
                    restoreSession(token, userId, username);
                    return;
                }
            }
        } catch {}
        setLoading(false);
    }, [restoreSession]);

    const handleAuth = useCallback(async (token: string, userId: number, username: string, setupRequired?: boolean) => {
        if (setupRequired) {
            setSetupToken(token);
            return;
        }
        const themeKey = `chat_theme_${userId}`;
        const saved = localStorage.getItem(themeKey) ?? localStorage.getItem('chat_theme');
        if (saved) {
            const t = { ...DEFAULT_THEME, ...JSON.parse(saved) };
            setTheme(t);
            document.body.classList.toggle('oled-theme', t.darkMode && t.chatBg === '#000000');
        }
        let avatar: string | undefined;
        let status: string | undefined;
        let tag: string | undefined;
        try {
            const res = await api.getProfile(token);
            if (res.success && res.user) {
                avatar = res.user.avatar || undefined;
                status = res.user.status || undefined;
                tag = res.user.tag || undefined;
                if (res.user.avatar_color) {
                    setTheme(prev => {
                        const updated = { ...prev, avatarColor: res.user.avatar_color };
                        localStorage.setItem(themeKey, JSON.stringify(updated));
                        return updated;
                    });
                }
            }
        } catch {}
        localStorage.setItem('chat_auth', JSON.stringify({ token, userId, username }));
        setAuth({ token, userId, username, avatar, status, tag });
    }, []);

    const handleSetupComplete = useCallback(async (newToken: string, username: string, selectedTheme: string) => {
        const themeOverride = THEME_MAP[selectedTheme] || {};
        const newTheme = { ...DEFAULT_THEME, ...themeOverride };
        setTheme(newTheme);

        setSetupToken(null);
        let avatar: string | undefined;
        let userId: number | null = null;
        try {
            const res = await api.getProfile(newToken);
            if (res.success && res.user) {
                avatar = res.user.avatar || undefined;
                userId = res.user.id;
            }
        } catch {}
        if (!userId) {
            // getProfile failed — cannot continue without a valid userId
            console.error('Failed to fetch profile after setup');
            return;
        }
        localStorage.setItem(`chat_theme_${userId}`, JSON.stringify(newTheme));
        localStorage.setItem('chat_auth', JSON.stringify({ token: newToken, userId, username }));
        setAuth({ token: newToken, userId, username, avatar });
    }, []);

    const handleThemeChange = useCallback((newTheme: ThemeSettings) => {
        const fixed = (!newTheme.darkMode && newTheme.chatBg === '#000000')
            ? { ...newTheme, chatBg: '#f8f9ff' }
            : newTheme;
        setTheme(fixed);
        const key = auth ? `chat_theme_${auth.userId}` : 'chat_theme';
        localStorage.setItem(key, JSON.stringify(fixed));
        const oled = fixed.darkMode && fixed.chatBg === '#000000';
        document.body.classList.toggle('oled-theme', oled);
    }, [auth]);

    const handleLogout = useCallback(() => {
        wsService.disconnect();
        localStorage.removeItem('chat_auth');
        setAuth(null);
        setSetupToken(null);
        setTheme(DEFAULT_THEME);
    }, []);

    const handleProfileUpdate = useCallback((username: string, avatar?: string, status?: string, tag?: string) => {
        setAuth(prev => {
            if (!prev) return prev;
            const updated = { ...prev, username, avatar, status, tag: tag ?? prev.tag };
            localStorage.setItem('chat_auth', JSON.stringify({ token: updated.token, userId: updated.userId, username: updated.username }));
            return updated;
        });
    }, []);

    if (loading) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' }}>
                <div style={{ width: 40, height: 40, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#8b5cf6', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            </div>
        );
    }

    if (setupToken) {
        return <SetupModal token={setupToken} onComplete={handleSetupComplete} />;
    }

    return (
        <div className="App">
            {!auth ? (
                <Auth onAuth={handleAuth} />
            ) : (
                <Chat
                    token={auth.token}
                    currentUserId={auth.userId}
                    currentUsername={auth.username}
                    currentUserAvatar={auth.avatar}
                    currentUserStatus={auth.status}
                    currentUserTag={auth.tag}
                    theme={theme}
                    onThemeChange={handleThemeChange}
                    onProfileUpdate={handleProfileUpdate}
                    onLogout={handleLogout}
                />
            )}
        </div>
    );
}

export default App;
