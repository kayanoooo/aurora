import React, { useState } from 'react';
import { api } from '../services/api';
import { useLang } from '../i18n';

type Screen = 'login' | 'register' | 'reset';

interface AuthProps {
    onAuth: (token: string, userId: number, username: string, setupRequired?: boolean) => void;
}

const Auth: React.FC<AuthProps> = ({ onAuth }) => {
    const { t } = useLang();
    const [screen, setScreen] = useState<Screen>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    const [resetStep, setResetStep] = useState<1 | 2>(1); // 1=email, 2=code+newpass
    const [resetCode, setResetCode] = useState('');
    const [resetNewPass, setResetNewPass] = useState('');
    const [resetDevCode, setResetDevCode] = useState(''); // dev mode only
    const [codeSent, setCodeSent] = useState(false);

    const isMobile = window.innerWidth <= 600;

    const reset = () => { setError(''); setSuccess(''); setEmail(''); setPassword(''); setResetCode(''); setResetNewPass(''); setResetStep(1); setCodeSent(false); setResetDevCode(''); };

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
                    setError(Array.isArray(res?.detail) ? res.detail.map((e: any) => { const field = e.loc?.slice(-1)[0]; return field ? `${field}: ${e.msg}` : e.msg; }).join('; ') : (res?.detail || t('Invalid username or password')));
                }
            } else if (screen === 'register') {
                const res = await api.register(email, password);
                if (res?.success) {
                    onAuth(res.token, res.user_id, '', true);
                } else {
                    setError(Array.isArray(res?.detail) ? res.detail.map((e: any) => e.msg).join('; ') : (res?.detail || t('Registration error')));
                }
            } else {
                if (resetStep === 1) {
                    // Step 1: send code
                    const res = await api.sendResetCode(email);
                    if (res?.success) {
                        setCodeSent(true);
                        setResetStep(2);
                        if (res.dev_code) {
                            setResetDevCode(res.dev_code);
                            setSuccess(`Dev mode: код ${res.dev_code} (SMTP не настроен)`);
                        } else if (res.email_sent) {
                            setSuccess(`Код отправлен на ${email}. Проверьте почту.`);
                        } else {
                            setSuccess(`Если такой email зарегистрирован, код будет отправлен.`);
                        }
                    } else {
                        setError(res?.detail || t('An error occurred'));
                    }
                } else {
                    // Step 2: confirm code + set new password
                    const res = await api.confirmReset(email, resetCode, resetNewPass);
                    if (res?.success) {
                        setSuccess(t('Password changed! Sign in with new password.'));
                        setTimeout(() => { reset(); setScreen('login'); }, 2000);
                    } else {
                        setError(Array.isArray(res?.detail) ? res.detail.map((e: any) => e.msg).join('; ') : (res?.detail || t('An error occurred')));
                    }
                }
            }
        } catch (err: any) {
            if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
                setError(t('Server unavailable. Check connection.'));
            } else {
                setError(err.message || t('An error occurred'));
            }
        } finally {
            setLoading(false);
        }
    };

    const switchScreen = (s: Screen) => { reset(); setScreen(s); };

    return (
        <div style={{
            minHeight: '100svh',
            display: 'flex',
            alignItems: isMobile ? 'flex-start' : 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
            position: 'relative',
            overflow: 'auto',
            padding: isMobile ? '24px 16px env(safe-area-inset-bottom, 16px)' : '32px 16px',
            boxSizing: 'border-box',
        }}>
            {/* Blobs */}
            {!isMobile && <>
                <div style={{ position: 'absolute', top: '-10%', left: '-5%', width: 500, height: 500, borderRadius: '50%', filter: 'blur(60px)', background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: '-15%', right: '-5%', width: 600, height: 600, borderRadius: '50%', filter: 'blur(60px)', background: 'radial-gradient(circle, rgba(139,92,246,0.3) 0%, transparent 70%)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: '40%', right: '20%', width: 300, height: 300, borderRadius: '50%', filter: 'blur(60px)', background: 'radial-gradient(circle, rgba(6,182,212,0.2) 0%, transparent 70%)', pointerEvents: 'none' }} />
            </>}

            <div className="auth-card-fadein" style={{
                backgroundColor: 'white',
                borderRadius: isMobile ? 20 : 24,
                padding: isMobile ? '28px 20px 24px' : '40px 40px 32px',
                width: '100%',
                maxWidth: 420,
                boxShadow: '0 30px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)',
                position: 'relative',
                zIndex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                boxSizing: 'border-box',
            }}>
                <div style={{ marginBottom: isMobile ? 8 : 12 }}>
                    <img className="auth-logo-float" src="/logo192.png" alt="Aurora" style={{ width: isMobile ? 56 : 72, height: isMobile ? 56 : 72, borderRadius: isMobile ? 14 : 18, display: 'block', boxShadow: '0 8px 24px rgba(255,107,0,0.4)' }} />
                </div>
                <h1 style={{ fontSize: isMobile ? 24 : 28, fontWeight: 800, letterSpacing: '-0.5px', background: 'linear-gradient(90deg, #FF6B00 0%, #ff9a3c 60%, #ffb347 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: 4 }}>Aurora</h1>
                <p style={{ fontSize: 13, color: '#888', marginBottom: isMobile ? 16 : 24 }}>
                    {screen === 'login' ? t('Welcome back!') : screen === 'register' ? t('Create account') : t('Password recovery')}
                </p>

                {screen !== 'reset' && (
                    <div style={{ display: 'flex', backgroundColor: '#f3f4f6', borderRadius: 12, padding: 4, width: '100%', marginBottom: isMobile ? 16 : 24, gap: 4 }}>
                        <button onClick={() => switchScreen('login')} style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500, color: screen === 'login' ? '#6366f1' : '#888', background: screen === 'login' ? 'white' : 'none', boxShadow: screen === 'login' ? '0 2px 8px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.2s', fontFamily: 'inherit' }}>{t('Sign In')}</button>
                        <button onClick={() => switchScreen('register')} style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500, color: screen === 'register' ? '#6366f1' : '#888', background: screen === 'register' ? 'white' : 'none', boxShadow: screen === 'register' ? '0 2px 8px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.2s', fontFamily: 'inherit' }}>{t('Sign Up')}</button>
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Email — shown on login/register and reset step 1 */}
                    {(screen !== 'reset' || resetStep === 1) && (
                        <div className="auth-input-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <span style={{ position: 'absolute', left: 12, fontSize: 16, pointerEvents: 'none', zIndex: 1 }}>📧</span>
                            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                                style={{ width: '100%', padding: '13px 12px 13px 40px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 15, outline: 'none', transition: 'border-color 0.2s', backgroundColor: '#fafafa', boxSizing: 'border-box', fontFamily: 'inherit' }}
                                required autoFocus={!isMobile} readOnly={screen === 'reset' && codeSent} />
                        </div>
                    )}

                    {/* Reset step 2: code + new password */}
                    {screen === 'reset' && resetStep === 2 && (
                        <>
                            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#0369a1', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <span style={{ flexShrink: 0 }}>📬</span>
                                <span>Код отправлен на <strong>{email}</strong>. Введите его ниже.</span>
                            </div>
                            {resetDevCode && (
                                <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400e' }}>
                                    ⚙️ Dev mode (SMTP не настроен): код <strong style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2 }}>{resetDevCode}</strong>
                                </div>
                            )}
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <span style={{ position: 'absolute', left: 12, fontSize: 16, pointerEvents: 'none', zIndex: 1 }}>🔢</span>
                                <input
                                    type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                                    placeholder="Код из письма"
                                    value={resetCode} onChange={e => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    style={{ width: '100%', padding: '13px 12px 13px 40px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 18, outline: 'none', backgroundColor: '#fafafa', boxSizing: 'border-box', fontFamily: 'monospace', letterSpacing: 4, textAlign: 'center' }}
                                    required autoFocus />
                            </div>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <span style={{ position: 'absolute', left: 12, fontSize: 16, pointerEvents: 'none', zIndex: 1 }}>🔒</span>
                                <input
                                    type={showPass ? 'text' : 'password'}
                                    placeholder="Новый пароль"
                                    value={resetNewPass} onChange={e => setResetNewPass(e.target.value)}
                                    style={{ width: '100%', padding: '13px 44px 13px 40px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 15, outline: 'none', backgroundColor: '#fafafa', boxSizing: 'border-box', fontFamily: 'inherit' }}
                                    required />
                                <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px', opacity: 0.6, lineHeight: 1 }}>{showPass ? '🙈' : '👁️'}</button>
                            </div>
                        </>
                    )}

                    {/* Password for login/register */}
                    {screen !== 'reset' && (
                        <div className="auth-input-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <span style={{ position: 'absolute', left: 12, fontSize: 16, pointerEvents: 'none', zIndex: 1 }}>🔒</span>
                            <input
                                type={showPass ? 'text' : 'password'}
                                placeholder={t('Password')}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                style={{ width: '100%', padding: '13px 44px 13px 40px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 15, outline: 'none', backgroundColor: '#fafafa', boxSizing: 'border-box', fontFamily: 'inherit' }}
                                required
                            />
                            <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px', opacity: 0.6, lineHeight: 1 }}>{showPass ? '🙈' : '👁️'}</button>
                        </div>
                    )}

                    {error && <div style={{ backgroundColor: '#fff0f0', border: '1px solid #ffcdd2', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#c62828' }}>⚠️ {error}</div>}
                    {success && !error && <div style={{ backgroundColor: '#f0fff4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#166534' }}>✓ {success}</div>}

                    <button type="submit" disabled={loading} className={!loading ? 'auth-btn-pulse' : ''} style={{ marginTop: 4, padding: '14px', background: loading ? 'rgba(99,102,241,0.7)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit', minHeight: 48 }}>
                        {loading
                            ? <span style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                            : screen === 'login' ? t('→ Sign In')
                            : screen === 'register' ? t('✓ Sign Up')
                            : resetStep === 1 ? '📨 Получить код'
                            : '🔑 Сбросить пароль'}
                    </button>
                </form>

                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    {screen === 'login' && (
                        <button onClick={() => switchScreen('reset')} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 600, textDecoration: 'underline', fontFamily: 'inherit', padding: '4px 0', minHeight: 36 }}>{t('Forgot password?')}</button>
                    )}
                    {screen === 'reset' && resetStep === 2 && (
                        <button onClick={() => { setResetStep(1); setError(''); setSuccess(''); setResetCode(''); setCodeSent(false); setResetDevCode(''); }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '4px 0', minHeight: 36 }}>← Изменить email</button>
                    )}
                    {screen === 'reset' && (
                        <button onClick={() => switchScreen('login')} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 600, textDecoration: 'underline', fontFamily: 'inherit', padding: '4px 0', minHeight: 36 }}>{t('← Back to sign in')}</button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Auth;
