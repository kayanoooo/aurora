import React, { useState } from 'react';
import { api } from '../services/api';

interface AuthProps {
    onAuth: (token: string, userId: number, username: string) => void;
}

const Auth: React.FC<AuthProps> = ({ onAuth }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const response = isLogin
                ? await api.login(username, password)
                : await api.register(username, email, password);
            if (response?.success) {
                onAuth(response.token, response.user_id, response.username);
            } else {
                setError(response?.detail || (isLogin ? 'Ошибка входа' : 'Ошибка регистрации'));
            }
        } catch (err: any) {
            if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
                setError('Сервер недоступен. Проверьте подключение.');
            } else if (err.message?.includes('401') || err.message?.includes('400')) {
                setError(isLogin ? 'Неверное имя пользователя или пароль' : 'Ошибка при регистрации');
            } else {
                setError(err.message || 'Произошла ошибка');
            }
        } finally {
            setLoading(false);
        }
    };

    const switchMode = () => {
        setIsLogin(!isLogin);
        setError('');
        setUsername('');
        setEmail('');
        setPassword('');
    };

    return (
        <div style={st.page}>
            {/* Background blobs */}
            <div style={{ ...st.blob, top: '-10%', left: '-5%', background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)' }} />
            <div style={{ ...st.blob, bottom: '-15%', right: '-5%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(139,92,246,0.3) 0%, transparent 70%)' }} />
            <div style={{ ...st.blob, top: '40%', right: '20%', width: 300, height: 300, background: 'radial-gradient(circle, rgba(6,182,212,0.2) 0%, transparent 70%)' }} />

            <div className="auth-card-fadein" style={st.card}>
                {/* Logo */}
                <div style={st.logoWrap}>
                    <img className="auth-logo-float" src="/logo192.png" alt="Aurora" style={st.logo} />
                </div>

                <h1 style={st.appName}>Aurora</h1>
                <p style={st.subtitle}>{isLogin ? 'Добро пожаловать обратно!' : 'Создайте аккаунт'}</p>

                {/* Tab switcher */}
                <div style={st.tabRow}>
                    <button
                        className={isLogin ? 'auth-tab-active' : ''}
                        onClick={() => isLogin || switchMode()}
                        style={{ ...st.tabBtn, ...(isLogin ? st.tabBtnActive : {}) }}
                    >Вход</button>
                    <button
                        className={!isLogin ? 'auth-tab-active' : ''}
                        onClick={() => isLogin && switchMode()}
                        style={{ ...st.tabBtn, ...(!isLogin ? st.tabBtnActive : {}) }}
                    >Регистрация</button>
                </div>

                <form onSubmit={handleSubmit} style={st.form}>
                    {/* Username */}
                    <div className="auth-input-wrap" style={st.inputWrap}>
                        <span style={st.inputIcon}>👤</span>
                        <input
                            type="text"
                            placeholder="Имя пользователя"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            style={st.input}
                            required
                            autoFocus
                        />
                    </div>

                    {/* Email (register only) */}
                    {!isLogin && (
                        <div className="auth-input-wrap" style={st.inputWrap}>
                            <span style={st.inputIcon}>📧</span>
                            <input
                                type="email"
                                placeholder="Email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                style={st.input}
                                required
                            />
                        </div>
                    )}

                    {/* Password */}
                    <div className="auth-input-wrap" style={st.inputWrap}>
                        <span style={st.inputIcon}>🔒</span>
                        <input
                            type={showPass ? 'text' : 'password'}
                            placeholder="Пароль"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            style={{ ...st.input, paddingRight: 44 }}
                            required
                        />
                        <button
                            type="button"
                            onClick={() => setShowPass(!showPass)}
                            style={st.eyeBtn}
                        >{showPass ? '🙈' : '👁️'}</button>
                    </div>

                    {error && (
                        <div style={st.errorBox}>
                            ⚠️ {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className={!loading ? 'auth-btn-pulse' : ''}
                        style={{ ...st.submitBtn, ...(loading ? st.submitBtnLoading : {}) }}
                    >
                        {loading
                            ? <span style={st.loader} />
                            : (isLogin ? '→ Войти' : '✓ Зарегистрироваться')
                        }
                    </button>
                </form>

                <p style={st.switchText}>
                    {isLogin ? 'Нет аккаунта? ' : 'Уже есть аккаунт? '}
                    <button onClick={switchMode} style={st.switchLink}>
                        {isLogin ? 'Зарегистрируйтесь' : 'Войдите'}
                    </button>
                </p>
            </div>
        </div>
    );
};

const st: { [key: string]: React.CSSProperties } = {
    page: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
        position: 'relative',
        overflow: 'hidden',
    },
    blob: {
        position: 'absolute',
        width: 500,
        height: 500,
        borderRadius: '50%',
        filter: 'blur(60px)',
        pointerEvents: 'none',
    },
    card: {
        backgroundColor: 'white',
        borderRadius: 24,
        padding: '40px 40px 32px',
        width: 420,
        maxWidth: '95vw',
        boxShadow: '0 30px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)',
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
    },
    logoWrap: {
        marginBottom: 12,
    },
    logo: {
        width: 72,
        height: 72,
        borderRadius: 18,
        display: 'block',
        boxShadow: '0 8px 24px rgba(255,107,0,0.4)',
    },
    appName: {
        fontSize: 28,
        fontWeight: 800,
        letterSpacing: '-0.5px',
        background: 'linear-gradient(90deg, #FF6B00 0%, #ff9a3c 60%, #ffb347 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 14,
        color: '#888',
        marginBottom: 24,
    },
    tabRow: {
        display: 'flex',
        backgroundColor: '#f3f4f6',
        borderRadius: 12,
        padding: 4,
        width: '100%',
        marginBottom: 24,
        gap: 4,
    },
    tabBtn: {
        flex: 1,
        padding: '8px 0',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: 500,
        color: '#888',
        background: 'none',
        transition: 'all 0.2s',
    },
    tabBtnActive: {
        background: 'white',
        color: '#6366f1',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    },
    form: {
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
    },
    inputWrap: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
    },
    inputIcon: {
        position: 'absolute',
        left: 12,
        fontSize: 16,
        pointerEvents: 'none',
        zIndex: 1,
    },
    input: {
        width: '100%',
        padding: '12px 12px 12px 40px',
        border: '1.5px solid #e5e7eb',
        borderRadius: 10,
        fontSize: 14,
        outline: 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        backgroundColor: '#fafafa',
        boxSizing: 'border-box',
    },
    eyeBtn: {
        position: 'absolute',
        right: 10,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 16,
        padding: '0 4px',
        opacity: 0.6,
    },
    errorBox: {
        backgroundColor: '#fff0f0',
        border: '1px solid #ffcdd2',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 13,
        color: '#c62828',
    },
    submitBtn: {
        marginTop: 4,
        padding: '13px',
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        color: 'white',
        border: 'none',
        borderRadius: 10,
        fontSize: 15,
        fontWeight: 700,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        transition: 'opacity 0.2s, transform 0.1s',
    },
    submitBtnLoading: {
        opacity: 0.7,
        cursor: 'not-allowed',
    },
    loader: {
        width: 18,
        height: 18,
        border: '2px solid rgba(255,255,255,0.3)',
        borderTopColor: 'white',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'spin 0.7s linear infinite',
    },
    switchText: {
        marginTop: 20,
        fontSize: 13,
        color: '#888',
    },
    switchLink: {
        background: 'none',
        border: 'none',
        color: '#6366f1',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        textDecoration: 'underline',
    },
};

export default Auth;
