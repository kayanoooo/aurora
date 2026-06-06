import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { config, normalizeServerAddress } from '../config';
import { useLang } from '../i18n';
import { useIsMobile } from '../hooks/useMediaQuery';
import PolicyModal from './PolicyModal';

type Screen = 'login' | 'register' | 'reset';

interface AuthProps {
    onAuth: (token: string, userId: number, username: string, setupRequired?: boolean) => void;
}

const Auth: React.FC<AuthProps> = ({ onAuth }) => {
    const { t, lang } = useLang();
    const [screen, setScreen] = useState<Screen>('login');
    const [bannedReason, setBannedReason] = useState<string | null>(() => {
        const r = localStorage.getItem('aurora_banned_reason');
        if (r !== null) { localStorage.removeItem('aurora_banned_reason'); return r || ''; }
        return null;
    });
    const [bannedExpiresAt, setBannedExpiresAt] = useState<string | null>(() => {
        const r = localStorage.getItem('aurora_banned_expires_at');
        if (r !== null) { localStorage.removeItem('aurora_banned_expires_at'); return r || null; }
        return null;
    });
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);
    const [policyTab, setPolicyTab] = useState<'license' | 'privacy' | null>(null);
    const [showServerSettings, setShowServerSettings] = useState(false);
    const [serverHost, setServerHost] = useState(() => config.BASE_URL.replace(/\/api\/?$/, ''));
    const [currentServerBase, setCurrentServerBase] = useState(() => config.BASE_URL);
    const [serverChecking, setServerChecking] = useState(false);
    const [serverStatus, setServerStatus] = useState('');

    // Reset password flow
    const [resetStep, setResetStep] = useState<1 | 2>(1);
    const [resetCode, setResetCode] = useState('');
    const [resetNewPass, setResetNewPass] = useState('');
    const [resetDevCode, setResetDevCode] = useState('');
    const [codeSent, setCodeSent] = useState(false);

    // Registration email verification flow
    const [regStep, setRegStep] = useState<1 | 2>(1); // 1=email+get code, 2=enter code+password
    const [regCode, setRegCode] = useState('');
    const [regDevCode, setRegDevCode] = useState('');
    const [regCodeSent, setRegCodeSent] = useState(false);
    const [acceptedPolicies, setAcceptedPolicies] = useState(false);

    // Resend cooldown (shared for both flows): seconds remaining
    const [resendCooldown, setResendCooldown] = useState(0);
    const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startCooldown = () => {
        setResendCooldown(60);
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        cooldownRef.current = setInterval(() => {
            setResendCooldown(prev => {
                if (prev <= 1) { clearInterval(cooldownRef.current!); return 0; }
                return prev - 1;
            });
        }, 1000);
    };

    useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

    const isMobile = useIsMobile(600);

    const saveServerHost = async (check = false) => {
        const normalized = normalizeServerAddress(serverHost);
        if (!normalized) {
            setServerStatus(lang === 'en' ? 'Enter server address.' : 'Введите адрес сервера.');
            return;
        }
        config.setServerHost(normalized);
        setCurrentServerBase(config.BASE_URL);
        setServerHost(config.BASE_URL);
        setError('');
        setSuccess(lang === 'en' ? 'Server address saved.' : 'Адрес сервера сохранён.');

        if (!check) {
            setServerStatus(lang === 'en' ? 'Saved. Try signing in again.' : 'Сохранено. Попробуйте войти снова.');
            return;
        }

        setServerChecking(true);
        setServerStatus('');
        try {
            const info = await api.getServerInfo();
            if (info) {
                const fileCheck = await api.checkFileStorage((info as any).sample_file);
                if (!fileCheck.ok) {
                    setServerStatus(
                        lang === 'en'
                            ? `API is available, but files do not load: HTTP ${fileCheck.status || 'network'} ${fileCheck.url}`
                            : `API доступен, но файлы не грузятся: HTTP ${fileCheck.status || 'сеть'} ${fileCheck.url}`
                    );
                } else {
                    setServerStatus(lang === 'en' ? 'Server and files are available.' : 'Сервер и файлы доступны.');
                }
            } else {
                setServerStatus(lang === 'en' ? 'No response from server.' : 'Сервер не отвечает.');
            }
        } finally {
            setServerChecking(false);
        }
    };

    const reset = () => {
        setError(''); setSuccess('');
        setEmail(''); setPassword('');
        setResetCode(''); setResetNewPass(''); setResetStep(1); setCodeSent(false); setResetDevCode('');
        setRegCode(''); setRegStep(1); setRegCodeSent(false); setRegDevCode(''); setAcceptedPolicies(false);
    };

    const inputStyle: React.CSSProperties = {
        width: '100%',
        minHeight: isMobile ? 52 : undefined,
        padding: isMobile ? '14px 14px 14px 44px' : '13px 12px 13px 40px',
        border: isMobile ? '1px solid rgba(99,102,241,0.16)' : '1.5px solid #e5e7eb',
        borderRadius: isMobile ? 16 : 10,
        fontSize: isMobile ? 16 : 15,
        color: '#1e1b4b',
        caretColor: '#6366f1',
        outline: 'none',
        backgroundColor: isMobile ? 'rgba(248,247,255,0.94)' : '#fafafa',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        transition: 'border-color 0.2s, box-shadow 0.2s, background-color 0.2s',
        boxShadow: isMobile ? 'inset 0 1px 0 rgba(255,255,255,0.8)' : undefined,
    };
    const getCodeInputStyle = (value: string): React.CSSProperties => ({
        ...inputStyle,
        fontSize: value ? 22 : 16,
        fontFamily: value ? 'monospace' : 'inherit',
        letterSpacing: value ? 6 : 0,
        textAlign: 'center',
        padding: isMobile ? '14px 12px' : '13px 12px',
    });

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(''); setSuccess('');
        setLoading(true);
        try {
            if (screen === 'login') {
                const res = await api.login(email, password);
                if (res?.success) {
                    onAuth(res.token, res.user_id, res.username, res.setup_required);
                } else if (res?.banned) {
                    setBannedReason(res.ban_reason || '');
                    setBannedExpiresAt(res.ban_expires_at || null);
                } else {
                    setError(Array.isArray(res?.detail)
                        ? res.detail.map((e: any) => { const field = e.loc?.slice(-1)[0]; return field ? `${field}: ${e.msg}` : e.msg; }).join('; ')
                        : (res?.detail || t('Invalid username or password')));
                }

            } else if (screen === 'register') {
                if (regStep === 1) {
                    // Send verification code
                    const res = await api.sendRegisterCode(email);
                    if (res?.success) {
                        setRegCodeSent(true);
                        setRegStep(2);
                        startCooldown();
                        if (res.dev_code) {
                            setRegDevCode(res.dev_code);
                            setSuccess(lang === 'en' ? `Email couldn't be delivered. Your code: ${res.dev_code}` : `Письмо не доставлено. Ваш код: ${res.dev_code}`);
                        } else {
                            setSuccess(lang === 'en' ? `Code sent to ${email}. Check your inbox.` : `Код отправлен на ${email}. Проверьте почту.`);
                        }
                    } else {
                        setError(res?.detail || t('An error occurred'));
                    }
                } else {
                    // Verify code and register
                    if (password.length < 6) {
                        setError(t('Password must be at least 6 characters'));
                        setLoading(false);
                        return;
                    }
                    if (!acceptedPolicies) {
                        setError(lang === 'en' ? 'Accept the license agreement and privacy policy to continue.' : 'Примите лицензионное соглашение и политику конфиденциальности, чтобы продолжить.');
                        setLoading(false);
                        return;
                    }
                    const res = await api.register(email, password, regCode);
                    if (res?.success) {
                        onAuth(res.token, res.user_id, '', true);
                    } else {
                        setError(Array.isArray(res?.detail)
                            ? res.detail.map((e: any) => e.msg).join('; ')
                            : (res?.detail || t('Registration error')));
                    }
                }

            } else {
                // Reset flow
                if (resetStep === 1) {
                    const res = await api.sendResetCode(email);
                    if (res?.success) {
                        setCodeSent(true);
                        setResetStep(2);
                        startCooldown();
                        if (res.dev_code) {
                            setResetDevCode(res.dev_code);
                            setSuccess(lang === 'en' ? `Email couldn't be delivered. Your code: ${res.dev_code}` : `Письмо не доставлено. Ваш код: ${res.dev_code}`);
                        } else if (res.email_sent) {
                            setSuccess(lang === 'en' ? `Code sent to ${email}. Check your inbox.` : `Код отправлен на ${email}. Проверьте почту.`);
                        } else {
                            setSuccess(`Если такой email зарегистрирован, код будет отправлен.`);
                        }
                    } else {
                        setError(res?.detail || t('An error occurred'));
                    }
                } else {
                    const res = await api.confirmReset(email, resetCode, resetNewPass);
                    if (res?.success) {
                        setSuccess(t('Password changed! Sign in with new password.'));
                        setTimeout(() => { reset(); setScreen('login'); }, 2000);
                    } else {
                        setError(Array.isArray(res?.detail)
                            ? res.detail.map((e: any) => e.msg).join('; ')
                            : (res?.detail || t('An error occurred')));
                    }
                }
            }
        } catch (err: any) {
            if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
                setShowServerSettings(true);
                setError(t('Server unavailable. Check connection.'));
            } else {
                setError(err.message || t('An error occurred'));
            }
        } finally {
            setLoading(false);
        }
    };

    const switchScreen = (s: Screen) => { reset(); setScreen(s); };

    const subtitle =
        screen === 'login' ? t('Welcome back!') :
        screen === 'register' ? (regStep === 1 ? t('Create account') : 'Подтвердите email') :
        t('Password recovery');

    const submitLabel = loading
        ? null
        : screen === 'login' ? t('→ Sign In')
        : screen === 'register'
            ? (regStep === 1 ? '📨 Получить код' : '✓ Создать аккаунт')
        : resetStep === 1 ? '📨 Получить код'
        : '🔑 Сбросить пароль';

    return (
        <div style={{
            minHeight: '100svh',
            display: 'flex',
            alignItems: isMobile ? 'center' : 'center',
            justifyContent: 'center',
            background: isMobile
                ? 'radial-gradient(circle at 50% 8%, rgba(255,107,0,0.26), transparent 22%), radial-gradient(circle at 18% 24%, rgba(139,92,246,0.34), transparent 28%), radial-gradient(circle at 85% 72%, rgba(99,102,241,0.28), transparent 30%), linear-gradient(180deg, #0b0718 0%, #17113a 52%, #0b0718 100%)'
                : 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
            position: 'relative',
            overflow: 'auto',
            padding: isMobile ? 'max(18px, env(safe-area-inset-top, 18px)) 16px max(18px, env(safe-area-inset-bottom, 18px))' : '32px 16px',
            boxSizing: 'border-box',
        }}>
            {!isMobile && <>
                <div style={{ position: 'absolute', top: '-10%', left: '-5%', width: 500, height: 500, borderRadius: '50%', filter: 'blur(60px)', background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: '-15%', right: '-5%', width: 600, height: 600, borderRadius: '50%', filter: 'blur(60px)', background: 'radial-gradient(circle, rgba(139,92,246,0.3) 0%, transparent 70%)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: '40%', right: '20%', width: 300, height: 300, borderRadius: '50%', filter: 'blur(60px)', background: 'radial-gradient(circle, rgba(6,182,212,0.2) 0%, transparent 70%)', pointerEvents: 'none' }} />
            </>}

            {bannedReason !== null && (
                <div className="auth-card-fadein" style={{ backgroundColor: 'white', borderRadius: isMobile ? 20 : 24, padding: isMobile ? '28px 20px 24px' : '40px', width: '100%', maxWidth: 420, boxShadow: '0 30px 80px rgba(0,0,0,0.4)', position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: bannedExpiresAt ? 'linear-gradient(135deg,#f97316,#ea580c)' : 'linear-gradient(135deg,#ef4444,#dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 24px ${bannedExpiresAt ? 'rgba(249,115,22,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                    </div>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#1e1b4b', marginBottom: 6 }}>
                            {bannedExpiresAt
                                ? (lang === 'en' ? 'Account temporarily suspended' : 'Аккаунт временно заблокирован')
                                : (lang === 'en' ? 'Account suspended' : 'Аккаунт заблокирован')}
                        </div>
                        <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.5 }}>
                            {bannedReason
                                ? (lang === 'en' ? `Reason: ${bannedReason}` : `Причина: ${bannedReason}`)
                                : (lang === 'en' ? 'Your account was suspended by an administrator.' : 'Ваш аккаунт был заблокирован администратором.')}
                        </div>
                    </div>
                    {bannedExpiresAt && (
                        <div style={{ fontSize: 13, color: '#f97316', padding: '10px 16px', background: 'rgba(249,115,22,0.06)', borderRadius: 10, width: '100%', boxSizing: 'border-box', border: '1px solid rgba(249,115,22,0.15)' }}>
                            ⏱ {lang === 'en' ? 'Ban expires' : 'Блокировка истекает'}:{' '}
                            <strong>{new Date(bannedExpiresAt).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
                        </div>
                    )}
                    <div style={{ fontSize: 12, color: '#9ca3af', padding: '10px 16px', background: '#f9fafb', borderRadius: 10, width: '100%', boxSizing: 'border-box' }}>
                        {lang === 'en' ? 'If you believe this is an error, contact support.' : 'Если вы считаете это ошибкой, обратитесь в поддержку.'}
                    </div>
                    <button
                        onClick={() => setBannedReason(null)}
                        style={{ padding: '10px 24px', borderRadius: 12, border: '1.5px solid #e5e7eb', background: 'white', color: '#6b7280', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        {lang === 'en' ? '← Back to login' : '← Назад к входу'}
                    </button>
                </div>
            )}
            {bannedReason === null && <div className="auth-card-fadein" style={{
                background: isMobile ? 'rgba(255,255,255,0.94)' : 'white',
                borderRadius: isMobile ? 30 : 24,
                padding: isMobile ? '24px 18px 22px' : '40px 40px 32px',
                width: '100%',
                maxWidth: isMobile ? 380 : 420,
                boxShadow: isMobile
                    ? '0 24px 70px rgba(0,0,0,0.38), 0 0 0 1px rgba(255,255,255,0.42), inset 0 1px 0 rgba(255,255,255,0.88)'
                    : '0 30px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)',
                position: 'relative', zIndex: 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                boxSizing: 'border-box',
                backdropFilter: isMobile ? 'blur(22px)' : undefined,
                border: isMobile ? '1px solid rgba(255,255,255,0.54)' : undefined,
            }}>
                <div style={{ marginBottom: isMobile ? 8 : 12 }}>
                    <img className="auth-logo-float" src="/logo192.png" alt="Aurora" style={{ width: isMobile ? 62 : 72, height: isMobile ? 62 : 72, borderRadius: isMobile ? 18 : 18, display: 'block', boxShadow: isMobile ? '0 16px 36px rgba(255,107,0,0.34), 0 0 0 8px rgba(255,107,0,0.06)' : '0 8px 24px rgba(255,107,0,0.4)' }} />
                </div>
                <h1 style={{ fontSize: isMobile ? 24 : 28, fontWeight: 800, letterSpacing: '-0.5px', background: 'linear-gradient(90deg, #FF6B00 0%, #ff9a3c 60%, #ffb347 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: 4 }}>Aurora</h1>
                <p style={{ fontSize: isMobile ? 13 : 13, color: '#888', marginBottom: isMobile ? 18 : 24 }}>{subtitle}</p>

                {isMobile && (
                    <>
                        <button
                            type="button"
                            onClick={() => {
                                setServerHost(currentServerBase);
                                setShowServerSettings(v => !v);
                                setServerStatus('');
                            }}
                            style={{
                                width: '100%',
                                border: '1px solid rgba(99,102,241,0.14)',
                                background: 'rgba(99,102,241,0.055)',
                                color: '#6d64b8',
                                borderRadius: 14,
                                padding: '10px 12px',
                                marginBottom: showServerSettings ? 10 : 14,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                textAlign: 'left',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                            title={currentServerBase}
                        >
                            {lang === 'en' ? 'Server' : 'Сервер'}: {currentServerBase}
                        </button>

                        {showServerSettings && (
                            <div style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                borderRadius: 18,
                                border: '1px solid rgba(99,102,241,0.18)',
                                background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05))',
                                padding: 12,
                                marginBottom: 14,
                            }}>
                                <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.45, marginBottom: 10 }}>
                                    {lang === 'en'
                                        ? 'For a phone, localhost is the phone itself. Use your PC LAN IP, tunnel URL, or Railway URL.'
                                        : 'На телефоне localhost — это сам телефон. Укажите LAN IP компьютера, tunnel-ссылку или Railway URL.'}
                                </div>
                                <input
                                    value={serverHost}
                                    onChange={e => setServerHost(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && saveServerHost(true)}
                                    placeholder="192.168.1.9 или https://server.app"
                                    style={{
                                        width: '100%',
                                        boxSizing: 'border-box',
                                        border: '1px solid rgba(99,102,241,0.2)',
                                        borderRadius: 12,
                                        background: 'rgba(255,255,255,0.78)',
                                        color: '#1e1b4b',
                                        outline: 'none',
                                        padding: '12px 12px',
                                        fontSize: 14,
                                        fontFamily: 'inherit',
                                        marginBottom: 10,
                                    }}
                                />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        type="button"
                                        onClick={() => saveServerHost(false)}
                                        style={{ flex: 1, border: 'none', borderRadius: 12, padding: '11px 10px', background: 'rgba(99,102,241,0.12)', color: '#5b5ff0', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
                                    >
                                        {lang === 'en' ? 'Save' : 'Сохранить'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={serverChecking}
                                        onClick={() => saveServerHost(true)}
                                        style={{ flex: 1, border: 'none', borderRadius: 12, padding: '11px 10px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', fontWeight: 800, cursor: serverChecking ? 'default' : 'pointer', opacity: serverChecking ? 0.72 : 1, fontFamily: 'inherit' }}
                                    >
                                        {serverChecking ? (lang === 'en' ? 'Checking...' : 'Проверка...') : (lang === 'en' ? 'Check' : 'Проверить')}
                                    </button>
                                </div>
                                {serverStatus && (
                                    <div style={{ marginTop: 9, fontSize: 12, color: serverStatus.includes('доступен') || serverStatus.includes('available') ? '#047857' : '#8a6d3b' }}>
                                        {serverStatus}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}

                {/* Login / Register tabs */}
                {screen !== 'reset' && (
                    <div style={{ display: 'flex', backgroundColor: isMobile ? 'rgba(99,102,241,0.07)' : '#f3f4f6', borderRadius: isMobile ? 16 : 12, padding: 4, width: '100%', marginBottom: isMobile ? 18 : 24, gap: 4, boxShadow: isMobile ? 'inset 0 1px 2px rgba(30,27,75,0.08)' : undefined }}>
                        <button onClick={() => switchScreen('login')} style={{ flex: 1, padding: isMobile ? '11px 0' : '8px 0', border: 'none', borderRadius: isMobile ? 13 : 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: screen === 'login' ? '#6366f1' : '#888', background: screen === 'login' ? 'white' : 'none', boxShadow: screen === 'login' ? '0 6px 18px rgba(76,61,135,0.14)' : 'none', transition: 'all 0.2s', fontFamily: 'inherit' }}>{t('Sign In')}</button>
                        <button onClick={() => switchScreen('register')} style={{ flex: 1, padding: isMobile ? '11px 0' : '8px 0', border: 'none', borderRadius: isMobile ? 13 : 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: screen === 'register' ? '#6366f1' : '#888', background: screen === 'register' ? 'white' : 'none', boxShadow: screen === 'register' ? '0 6px 18px rgba(76,61,135,0.14)' : 'none', transition: 'all 0.2s', fontFamily: 'inherit' }}>{t('Sign Up')}</button>
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>

                    {/* ── Email field ── */}
                    {(screen === 'login' || (screen === 'register' && regStep === 1) || (screen === 'reset' && resetStep === 1)) && (
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <span style={{ position: 'absolute', left: 12, fontSize: 16, pointerEvents: 'none', zIndex: 1 }}>📧</span>
                            <input className="auth-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                                style={inputStyle} required autoFocus={!isMobile}
                                readOnly={(screen === 'reset' && codeSent) || (screen === 'register' && regCodeSent)} />
                        </div>
                    )}

                    {/* ── Register step 2: verify code + password ── */}
                    {screen === 'register' && regStep === 2 && (
                        <>
                            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#0369a1', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <span style={{ flexShrink: 0 }}>📬</span>
                                <span>{lang === 'en' ? <>{t('Code sent to')} <strong>{email}</strong>. Enter it below.</> : <>Код отправлен на <strong>{email}</strong>. Введите его ниже.</>}</span>
                            </div>
                            {regDevCode && (
                                <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400e' }}>
                                    ⚙ Dev: <strong style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2 }}>{regDevCode}</strong>
                                </div>
                            )}
                            <input
                                className="auth-input"
                                type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                                placeholder={t('Code from email')}
                                value={regCode} onChange={e => setRegCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                style={getCodeInputStyle(regCode)} required autoFocus />
                            <button type="button" disabled={resendCooldown > 0} onClick={async () => {
                                setError(''); setSuccess(''); setRegDevCode('');
                                const res = await api.sendRegisterCode(email);
                                if (res?.success) {
                                    startCooldown();
                                    if (res.dev_code) { setRegDevCode(res.dev_code); setSuccess(`Dev: ${res.dev_code}`); }
                                    else setSuccess('Новый код отправлен.');
                                } else setError(res?.detail || t('An error occurred'));
                            }} style={{ background: 'none', border: 'none', cursor: resendCooldown > 0 ? 'default' : 'pointer', color: resendCooldown > 0 ? '#9ca3af' : '#6366f1', fontSize: 13, fontFamily: 'inherit', padding: '2px 0', textAlign: 'center' }}>
                                {resendCooldown > 0 ? `Отправить снова через ${resendCooldown} с` : 'Отправить код снова'}
                            </button>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <span style={{ position: 'absolute', left: 12, fontSize: 16, pointerEvents: 'none', zIndex: 1 }}>🔒</span>
                                <input
                                    className="auth-input"
                                    type={showPass ? 'text' : 'password'} placeholder={t('Password')}
                                    value={password} onChange={e => setPassword(e.target.value)}
                                    style={{ ...inputStyle, padding: isMobile ? '14px 48px 14px 44px' : '13px 44px 13px 40px' }} required />
                                <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px', opacity: 0.6, lineHeight: 1 }}>{showPass ? '🙈' : '👁️'}</button>
                            </div>
                            <label style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 10,
                                padding: isMobile ? '12px 12px' : '10px 12px',
                                borderRadius: isMobile ? 15 : 12,
                                background: acceptedPolicies ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.04)',
                                border: `1px solid ${acceptedPolicies ? 'rgba(99,102,241,0.28)' : 'rgba(99,102,241,0.12)'}`,
                                color: '#6b7280',
                                fontSize: 12,
                                lineHeight: 1.45,
                                cursor: 'pointer',
                                textAlign: 'left',
                            }}>
                                <input
                                    type="checkbox"
                                    checked={acceptedPolicies}
                                    onChange={e => setAcceptedPolicies(e.target.checked)}
                                    style={{ width: 20, height: 20, margin: '1px 0 0', accentColor: '#6366f1', flexShrink: 0 }}
                                />
                                <span>
                                    {lang === 'en' ? 'I accept the ' : 'Я принимаю '}
                                    <button type="button" onClick={e => { e.preventDefault(); setPolicyTab('license'); }} style={{ background: 'none', border: 'none', color: '#6366f1', padding: 0, cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>
                                        {lang === 'en' ? 'License Agreement' : 'Лицензионное соглашение'}
                                    </button>
                                    {lang === 'en' ? ' and ' : ' и '}
                                    <button type="button" onClick={e => { e.preventDefault(); setPolicyTab('privacy'); }} style={{ background: 'none', border: 'none', color: '#6366f1', padding: 0, cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>
                                        {lang === 'en' ? 'Privacy Policy' : 'Политику конфиденциальности'}
                                    </button>
                                </span>
                            </label>
                        </>
                    )}

                    {/* ── Reset step 2: code + new password ── */}
                    {screen === 'reset' && resetStep === 2 && (
                        <>
                            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#0369a1', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <span style={{ flexShrink: 0 }}>📬</span>
                                <span>{lang === 'en' ? <>{t('Code sent to')} <strong>{email}</strong>. Enter it below.</> : <>Код отправлен на <strong>{email}</strong>. Введите его ниже.</>}</span>
                            </div>
                            {resetDevCode && (
                                <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400e' }}>
                                    ⚙ Dev: <strong style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 2 }}>{resetDevCode}</strong>
                                </div>
                            )}
                            <input
                                className="auth-input"
                                type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                                placeholder="Код из письма"
                                value={resetCode} onChange={e => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                style={getCodeInputStyle(resetCode)} required autoFocus />
                            <button type="button" disabled={resendCooldown > 0} onClick={async () => {
                                setError(''); setSuccess(''); setResetDevCode('');
                                const res = await api.sendResetCode(email);
                                if (res?.success) {
                                    startCooldown();
                                    if (res.dev_code) { setResetDevCode(res.dev_code); setSuccess(`Dev: ${res.dev_code}`); }
                                    else setSuccess('Новый код отправлен.');
                                } else setError(res?.detail || t('An error occurred'));
                            }} style={{ background: 'none', border: 'none', cursor: resendCooldown > 0 ? 'default' : 'pointer', color: resendCooldown > 0 ? '#9ca3af' : '#6366f1', fontSize: 13, fontFamily: 'inherit', padding: '2px 0', textAlign: 'center' }}>
                                {resendCooldown > 0 ? `Отправить снова через ${resendCooldown} с` : 'Отправить код снова'}
                            </button>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <span style={{ position: 'absolute', left: 12, fontSize: 16, pointerEvents: 'none', zIndex: 1 }}>🔒</span>
                                <input
                                    className="auth-input"
                                    type={showPass ? 'text' : 'password'} placeholder={t('New password')}
                                    value={resetNewPass} onChange={e => setResetNewPass(e.target.value)}
                                    style={{ ...inputStyle, padding: isMobile ? '14px 48px 14px 44px' : '13px 44px 13px 40px' }} required />
                                <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px', opacity: 0.6, lineHeight: 1 }}>{showPass ? '🙈' : '👁️'}</button>
                            </div>
                        </>
                    )}

                    {/* ── Password for login ── */}
                    {screen === 'login' && (
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <span style={{ position: 'absolute', left: 12, fontSize: 16, pointerEvents: 'none', zIndex: 1 }}>🔒</span>
                            <input
                                className="auth-input"
                                type={showPass ? 'text' : 'password'} placeholder={t('Password')}
                                value={password} onChange={e => setPassword(e.target.value)}
                                style={{ ...inputStyle, padding: isMobile ? '14px 48px 14px 44px' : '13px 44px 13px 40px' }} required />
                            <button type="button" onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px', opacity: 0.6, lineHeight: 1 }}>{showPass ? '🙈' : '👁️'}</button>
                        </div>
                    )}

                    {error && <div style={{ backgroundColor: '#fff0f0', border: '1px solid #ffcdd2', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#c62828' }}>⚠️ {error}</div>}
                    {success && !error && !(screen === 'register' && regStep === 2) && !(screen === 'reset' && resetStep === 2) && (
                        <div style={{ backgroundColor: '#f0fff4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#166534' }}>✓ {success}</div>
                    )}

                    <button type="submit" disabled={loading} className={!loading ? 'auth-btn-pulse' : ''} style={{ marginTop: 4, padding: isMobile ? '15px' : '14px', background: loading ? 'rgba(99,102,241,0.7)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none', borderRadius: isMobile ? 16 : 10, fontSize: 15, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit', minHeight: isMobile ? 54 : 48, boxShadow: loading ? 'none' : '0 12px 26px rgba(99,102,241,0.28)' }}>
                        {loading
                            ? <span style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                            : submitLabel}
                    </button>
                </form>

                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    {screen === 'login' && (
                        <button onClick={() => switchScreen('reset')} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 600, textDecoration: 'underline', fontFamily: 'inherit', padding: '4px 0', minHeight: 36 }}>{t('Forgot password?')}</button>
                    )}
                    {screen === 'register' && regStep === 2 && (
                        <button onClick={() => { setRegStep(1); setError(''); setSuccess(''); setRegCode(''); setRegCodeSent(false); setRegDevCode(''); }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '4px 0', minHeight: 36 }}>{lang === 'en' ? `← ${t('Change email')}` : `← ${t('Change email')}`}</button>
                    )}
                    {screen === 'reset' && resetStep === 2 && (
                        <button onClick={() => { setResetStep(1); setError(''); setSuccess(''); setResetCode(''); setCodeSent(false); setResetDevCode(''); }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '4px 0', minHeight: 36 }}>{lang === 'en' ? `← ${t('Change email')}` : `← ${t('Change email')}`}</button>
                    )}
                    {screen === 'reset' && (
                        <button onClick={() => switchScreen('login')} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 600, textDecoration: 'underline', fontFamily: 'inherit', padding: '4px 0', minHeight: 36 }}>{t('← Back to sign in')}</button>
                    )}
                </div>
            </div>}
            {policyTab && (
                <PolicyModal
                    initialTab={policyTab}
                    isDark={false}
                    onClose={() => setPolicyTab(null)}
                />
            )}
        </div>
    );
};

export default Auth;
