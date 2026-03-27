import { useState, useCallback, useEffect } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
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

interface AuthState {
    token: string;
    userId: number;
    username: string;
    avatar?: string;
    status?: string;
}

function App() {
    const [auth, setAuth] = useState<AuthState | null>(null);
    const [loading, setLoading] = useState(true);
    const [theme, setTheme] = useState<ThemeSettings>(() => {
        try {
            const saved = localStorage.getItem('chat_theme');
            return saved ? { ...DEFAULT_THEME, ...JSON.parse(saved) } : DEFAULT_THEME;
        } catch { return DEFAULT_THEME; }
    });

    const restoreSession = useCallback(async (token: string, userId: number, username: string) => {
        try {
            const res = await api.getProfile(token);
            if (res.success && res.user) {
                const avatar = res.user.avatar || undefined;
                const status = res.user.status || undefined;
                if (res.user.avatar_color) {
                    setTheme(prev => {
                        const updated = { ...prev, avatarColor: res.user.avatar_color };
                        localStorage.setItem('chat_theme', JSON.stringify(updated));
                        return updated;
                    });
                }
                setAuth({ token, userId, username: res.user.username || username, avatar, status });
            } else {
                sessionStorage.removeItem('chat_auth');
            }
        } catch {
            sessionStorage.removeItem('chat_auth');
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        try {
            const saved = sessionStorage.getItem('chat_auth');
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

    const handleAuth = useCallback(async (token: string, userId: number, username: string) => {
        let avatar: string | undefined;
        let status: string | undefined;
        try {
            const res = await api.getProfile(token);
            if (res.success && res.user) {
                avatar = res.user.avatar || undefined;
                status = res.user.status || undefined;
                if (res.user.avatar_color) {
                    setTheme(prev => {
                        const updated = { ...prev, avatarColor: res.user.avatar_color };
                        localStorage.setItem('chat_theme', JSON.stringify(updated));
                        return updated;
                    });
                }
            }
        } catch {}
        sessionStorage.setItem('chat_auth', JSON.stringify({ token, userId, username }));
        setAuth({ token, userId, username, avatar, status });
    }, []);

    const handleThemeChange = useCallback((newTheme: ThemeSettings) => {
        setTheme(newTheme);
        localStorage.setItem('chat_theme', JSON.stringify(newTheme));
    }, []);

    const handleLogout = useCallback(() => {
        wsService.disconnect();
        sessionStorage.removeItem('chat_auth');
        setAuth(null);
        setTheme(DEFAULT_THEME);
    }, []);

    const handleProfileUpdate = useCallback((username: string, avatar?: string, status?: string) => {
        setAuth(prev => {
            if (!prev) return prev;
            const updated = { ...prev, username, avatar, status };
            sessionStorage.setItem('chat_auth', JSON.stringify({ token: updated.token, userId: updated.userId, username: updated.username }));
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
