import React, { useState } from 'react';
import { api } from '../services/api';

type Screen = 'login' | 'register' | 'reset';

interface AuthProps {
    onAuth: (token: string, userId: number, username: string, setupRequired?: boolean) => void;
}

const Auth: React.FC<AuthProps> = ({ onAuth }) => {
    const [screen, setScreen] = useState<Screen>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    // Reset screen
    const [resetTag, setResetTag] = useState('');
    const [resetOldPass, setResetOldPass] = useState('');
    const [resetNewPass, setResetNewPass] = useState('');
    const [showOldPass, setShowOldPass] = useState(false);

    const reset = () => { setError(''); setSuccess(''); setEmail(''); setPassword(''); setResetTag(''); setResetOldPass(''); setResetNewPass(''); };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(''); setSuccess('');
        setLoading(true);
        try {
            if (screen === 'login') {
                const res = await api.login(email, password);
                if (res?.success) {
                    onAuth(res.token, res.user_id, res.username, res.setup_required);
                } else {
                    setError(Array.isArray(res?.detail) ? res.detail.map((e: any) => { const field = e.loc?.slice(-1)[0]; return field ? `${field}: ${e.msg}` : e.msg; }).join('; ') : (res?.detail || 'Неверный email или пароль'));
                }
            } else if (screen === 'register') {
                const res = await api.register(email, password);
                if (res?.success) {
                    onAuth(res.token, res.user_id, '', true);
                } else {
                    setError(Array.isArray(res?.detail) ? res.detail.map((e: any) => e.msg).join('; ') : (res?.detail || 'Ошибка регистрации'));
                }
            } else {
                const res = await api.resetPassword(email, resetTag, resetOldPass, resetNewPass);
                if (res?.success) {
                    setSuccess('Пароль успешно изменён! Войдите с новым паролем.');
                    setTimeout(() => { reset(); setScreen('login'); }, 2000);
                } else {
                    setError(Array.isArray(res?.detail) ? res.detail.map((e: any) => e.msg).join('; ') : (res?.detail || 'Пользователь не найден'));
                }
            }
        } catch (err: any) {
            if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
                setError('Сервер недоступен. Проверьте подключение.');
            } else {
                setError(err.message || 'Произошла ошибка');
            }
        } finally {
            setLoading(false);
        }
    };

    const switchScreen = (s: Screen) => { reset(); setScreen(s); };

    return (
        <div style={st.page}>
            <div style={{ ...st.blob, top: '-10%', left: '-5%', background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)' }} />
            <div style={{ ...st.blob, bottom: '-15%', right: '-5%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(139,92,246,0.3) 0%, transparent 70%)' }} />
            <div style={{ ...st.blob, top: '40%', right: '20%', width: 300, height: 300, background: 'radial-gradient(circle, rgba(6,182,212,0.2) 0%, transparent 70%)' }} />

            <div className="auth-card-fadein" style={st.card}>
                <div style={st.logoWrap}>
                    <img className="auth-logo-float" src="/logo192.png" alt="Aurora" style={st.logo} />
                </div>
                <h1 style={st.appName}>Aurora</h1>
                <p style={st.subtitle}>
                    {screen === 'login' ? 'Добро пожаловать обратно!' : screen === 'register' ? 'Создайте аккаунт' : 'Восстановление пароля'}
                </p>

                {screen !== 'reset' && (
                    <div style={st.tabRow}>
                        <button onClick={() => switchScreen('login')} style={{ ...st.tabBtn, ...(screen === 'login' ? st.tabBtnActive : {}) }}>Вход</button>
                        <button onClick={() => switchScreen('register')} style={{ ...st.tabBtn, ...(screen === 'register' ? st.tabBtnActive : {}) }}>Регистрация</button>
                    </div>
                )}

                <form onSubmit={handleSubmit} style={st.form}>
                    <div className="auth-input-wrap" style={st.inputWrap}>
                        <span style={st.inputIcon}>📧</span>
                        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={st.input} required autoFocus />
                    </div>

                    {screen === 'reset' && (
                        <div className="auth-input-wrap" style={st.inputWrap}>
                            <span style={st.inputIcon}>🏷️</span>
                            <input type="text" placeholder="Тег (@ваш_тег)" value={resetTag} onChange={e => setResetTag(e.target.value.replace(/^@/, ''))} style={st.input} required />
                        </div>
                    )}

                    {screen === 'reset' && (
                        <div className="auth-input-wrap" style={st.inputWrap}>
                            <span style={st.inputIcon}>🔑</span>
                            <input
                                type={showOldPass ? 'text' : 'password'}
                                placeholder="Текущий пароль"
                                value={resetOldPass}
                                onChange={e => setResetOldPass(e.target.value)}
                                style={{ ...st.input, paddingRight: 44 }}
                                required
                            />
                            <button type="button" onClick={() => setShowOldPass(!showOldPass)} style={st.eyeBtn}>{showOldPass ? '🙈' : '👁️'}</button>
                        </div>
                    )}

                    <div className="auth-input-wrap" style={st.inputWrap}>
                        <span style={st.inputIcon}>🔒</span>
                        <input
                            type={showPass ? 'text' : 'password'}
                            placeholder={screen === 'reset' ? 'Новый пароль' : 'Пароль'}
                            value={screen === 'reset' ? resetNewPass : password}
                            onChange={e => screen === 'reset' ? setResetNewPass(e.target.value) : setPassword(e.target.value)}
                            style={{ ...st.input, paddingRight: 44 }}
                            required
                        />
                        <button type="button" onClick={() => setShowPass(!showPass)} style={st.eyeBtn}>{showPass ? '🙈' : '👁️'}</button>
                    </div>

                    {error && <div style={st.errorBox}>⚠️ {error}</div>}
                    {success && <div style={st.successBox}>✓ {success}</div>}

                    <button type="submit" disabled={loading} className={!loading ? 'auth-btn-pulse' : ''} style={{ ...st.submitBtn, ...(loading ? st.submitBtnLoading : {}) }}>
                        {loading ? <span style={st.loader} /> : screen === 'login' ? '→ Войти' : screen === 'register' ? '✓ Зарегистрироваться' : '🔑 Сбросить пароль'}
                    </button>
                </form>

                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    {screen === 'login' && (
                        <button onClick={() => switchScreen('reset')} style={st.switchLink}>Забыли пароль?</button>
                    )}
                    {screen === 'reset' && (
                        <button onClick={() => switchScreen('login')} style={st.switchLink}>← Назад ко входу</button>
                    )}
                </div>
            </div>
        </div>
    );
};

const st: { [key: string]: React.CSSProperties } = {
    page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)', position: 'relative', overflow: 'hidden' },
    blob: { position: 'absolute', width: 500, height: 500, borderRadius: '50%', filter: 'blur(60px)', pointerEvents: 'none' },
    card: { backgroundColor: 'white', borderRadius: 24, padding: '40px 40px 32px', width: 420, maxWidth: '95vw', boxShadow: '0 30px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)', position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' },
    logoWrap: { marginBottom: 12 },
    logo: { width: 72, height: 72, borderRadius: 18, display: 'block', boxShadow: '0 8px 24px rgba(255,107,0,0.4)' },
    appName: { fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px', background: 'linear-gradient(90deg, #FF6B00 0%, #ff9a3c 60%, #ffb347 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: 4 },
    subtitle: { fontSize: 14, color: '#888', marginBottom: 24 },
    tabRow: { display: 'flex', backgroundColor: '#f3f4f6', borderRadius: 12, padding: 4, width: '100%', marginBottom: 24, gap: 4 },
    tabBtn: { flex: 1, padding: '8px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500, color: '#888', background: 'none', transition: 'all 0.2s' },
    tabBtnActive: { background: 'white', color: '#6366f1', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' },
    form: { width: '100%', display: 'flex', flexDirection: 'column', gap: 12 },
    inputWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
    inputIcon: { position: 'absolute', left: 12, fontSize: 16, pointerEvents: 'none', zIndex: 1 },
    input: { width: '100%', padding: '12px 12px 12px 40px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 14, outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#fafafa', boxSizing: 'border-box' },
    eyeBtn: { position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 4px', opacity: 0.6 },
    errorBox: { backgroundColor: '#fff0f0', border: '1px solid #ffcdd2', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#c62828' },
    successBox: { backgroundColor: '#f0fff4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#166534' },
    submitBtn: { marginTop: 4, padding: '13px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'opacity 0.2s' },
    submitBtnLoading: { opacity: 0.7, cursor: 'not-allowed' },
    loader: { width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' },
    switchLink: { background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 600, textDecoration: 'underline' },
};

export default Auth;
