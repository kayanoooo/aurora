import React, { useState } from 'react';
import { api } from '../services/api';
import PolicyModal from './PolicyModal';

interface SetupModalProps {
    token: string;
    onComplete: (token: string, username: string, theme: string) => void;
}

const THEMES = [
    {
        id: 'light',
        label: 'Светлая',
        icon: '☀️',
        pageBg: 'linear-gradient(135deg, #c7caff 0%, #dde0ff 50%, #cdd0ff 100%)',
        cardBg: '#ffffff',
        cardBorder: 'rgba(99,102,241,0.12)',
        textColor: '#1e1b4b',
        subtextColor: '#6b7280',
        mutedColor: '#9ca3af',
        accent: '#6366f1',
        accentGrad: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        inputBg: '#f3f4f8',
        inputBorder: '#e5e7eb',
        previewBg: '#f2f4f8',
        previewHeader: '#f7f8fc',
        ownBubble: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        ownText: '#ffffff',
        otherBubble: '#e8e9f4',
        otherText: '#374151',
        btnBack: '#f3f4f6',
        btnBackText: '#374151',
        btnBackBorder: '#e5e7eb',
    },
    {
        id: 'dark',
        label: 'Тёмная',
        icon: '🌙',
        pageBg: 'linear-gradient(135deg, #0f0c29 0%, #1a1630 60%, #0d0b1a 100%)',
        cardBg: '#1a1a2e',
        cardBorder: 'rgba(99,102,241,0.18)',
        textColor: '#e2e8f0',
        subtextColor: '#7c7caa',
        mutedColor: '#4a4a7a',
        accent: '#818cf8',
        accentGrad: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        inputBg: '#252538',
        inputBorder: 'rgba(99,102,241,0.2)',
        previewBg: '#16162a',
        previewHeader: '#13131f',
        ownBubble: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        ownText: '#ffffff',
        otherBubble: '#2a2a3d',
        otherText: '#c0c0d8',
        btnBack: '#252538',
        btnBackText: '#a5b4fc',
        btnBackBorder: 'rgba(99,102,241,0.2)',
    },
    {
        id: 'oled',
        label: 'OLED',
        icon: '✦',
        pageBg: '#000000',
        cardBg: '#050508',
        cardBorder: 'rgba(167,139,250,0.15)',
        textColor: '#e2e8f0',
        subtextColor: '#6b5fa0',
        mutedColor: '#3a3a5a',
        accent: '#a78bfa',
        accentGrad: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
        inputBg: '#0d0d18',
        inputBorder: 'rgba(167,139,250,0.15)',
        previewBg: '#000000',
        previewHeader: '#000000',
        ownBubble: 'linear-gradient(135deg, #5b21b6, #a78bfa)',
        ownText: '#ffffff',
        otherBubble: '#0d0d18',
        otherText: '#c4b5fd',
        btnBack: '#0d0d18',
        btnBackText: '#c4b5fd',
        btnBackBorder: 'rgba(167,139,250,0.15)',
    },
];

const T = 'all 0.35s cubic-bezier(0.4,0,0.2,1)';

const SetupModal: React.FC<SetupModalProps> = ({ token, onComplete }) => {
    const [step, setStep] = useState<1 | 2>(1);
    const [tag, setTag] = useState('');
    const [username, setUsername] = useState('');
    const [selectedId, setSelectedId] = useState('dark');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [exiting, setExiting] = useState(false);
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [policyTab, setPolicyTab] = useState<'license' | 'privacy' | null>(null);

    const theme = THEMES.find(t => t.id === selectedId) ?? THEMES[1];
    const isStep2 = step === 2;

    // Card bg: white on step 1, follows theme on step 2
    const cardBg       = isStep2 ? theme.cardBg       : '#ffffff';
    const cardBorder   = isStep2 ? theme.cardBorder   : 'rgba(255,255,255,0.05)';
    const textColor    = isStep2 ? theme.textColor    : '#1e1b4b';
    const subtextColor = isStep2 ? theme.subtextColor : '#6b7280';
    const overlayBg    = isStep2 ? theme.pageBg       : 'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)';

    const handleNext = () => {
        if (tag.length < 3) { setError('Тег должен быть не менее 3 символов'); return; }
        if (!username.trim()) { setError('Введите отображаемое имя'); return; }
        setError(''); setStep(2);
    };

    const handleComplete = async () => {
        setLoading(true); setError('');
        try {
            const res = await api.setupProfile(token, tag, username, selectedId);
            if (res?.success) {
                setExiting(true);
                setTimeout(() => onComplete(res.token, res.username, selectedId), 650);
            } else {
                setError(Array.isArray(res?.detail) ? res.detail.map((e: any) => e.msg).join('; ') : (res?.detail || 'Ошибка'));
                setStep(1);
            }
        } catch (err: any) {
            setError(err.message || 'Ошибка'); setStep(1);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: overlayBg, transition: T, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>

            {/* Blobs for step 1 */}
            {!isStep2 && <>
                <div style={{ position: 'absolute', top: '-10%', left: '-5%', width: 500, height: 500, borderRadius: '50%', filter: 'blur(60px)', background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: '-15%', right: '-5%', width: 600, height: 600, borderRadius: '50%', filter: 'blur(60px)', background: 'radial-gradient(circle, rgba(139,92,246,0.3) 0%, transparent 70%)', pointerEvents: 'none' }} />
            </>}

            {/* Card */}
            <div
                className={!isStep2 ? 'auth-card-fadein' : ''}
                style={{
                    borderRadius: 24,
                    padding: '36px 36px 28px',
                    width: 440,
                    maxWidth: '95vw',
                    backgroundColor: cardBg,
                    border: `1px solid ${cardBorder}`,
                    boxShadow: isStep2
                        ? `0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px ${theme.cardBorder}`
                        : '0 30px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    transition: T,
                    animation: exiting ? 'setupExitCard 0.4s ease forwards' : undefined,
                    position: 'relative',
                    zIndex: 1,
                }}
            >
                {/* Logo */}
                <img src="/logo192.png" alt="Aurora" style={{ width: 64, height: 64, borderRadius: 16, boxShadow: '0 8px 24px rgba(255,107,0,0.4)', marginBottom: 12 }} />

                <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4, textAlign: 'center', background: 'linear-gradient(90deg,#FF6B00,#ff9a3c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                    Добро пожаловать в Aurora!
                </h2>
                <p style={{ fontSize: 14, color: subtextColor, marginBottom: 20, transition: T }}>Настройте свой профиль</p>

                {/* Steps */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                    {[1, 2].map((n, i) => (
                        <React.Fragment key={n}>
                            {i > 0 && <div style={{ width: 40, height: 2, borderRadius: 1, background: step >= 2 ? theme.accentGrad : (isStep2 ? theme.inputBorder : '#e5e7eb'), transition: T }} />}
                            <div style={{
                                width: 32, height: 32, borderRadius: '50%',
                                background: step >= n ? (n === 1 ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : theme.accentGrad) : (isStep2 ? theme.inputBorder : '#e5e7eb'),
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 13, fontWeight: 700,
                                color: step >= n ? 'white' : (isStep2 ? theme.mutedColor : '#9ca3af'),
                                transition: T,
                            }}>{n}</div>
                        </React.Fragment>
                    ))}
                </div>

                {/* ── STEP 1 ── */}
                {step === 1 && (<>
                    <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, alignSelf: 'flex-start' }}>Шаг 1 — Имя и тег</p>

                    <div style={{ width: '100%', marginBottom: 14 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>Ваш уникальный тег</label>
                        <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #e5e7eb', borderRadius: 10, backgroundColor: '#fafafa', overflow: 'hidden' }}>
                            <span style={{ padding: '12px 8px 12px 14px', fontSize: 15, fontWeight: 700, color: '#6366f1', backgroundColor: '#f3f4ff', borderRight: '1px solid #e5e7eb' }}>@</span>
                            <input type="text" placeholder="например: ivan_petrov" value={tag} onChange={e => setTag(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30))} style={{ width: '100%', padding: '12px 14px', border: 'none', outline: 'none', fontSize: 14, backgroundColor: '#fafafa' }} autoFocus />
                        </div>
                        <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Только латинские буквы, цифры и _ · 3–30 символов</p>
                    </div>

                    <div style={{ width: '100%', marginBottom: 14 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' }}>Отображаемое имя</label>
                        <input type="text" placeholder="Как вас называть?" value={username} onChange={e => setUsername(e.target.value.slice(0, 50))} style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10, outline: 'none', fontSize: 14, backgroundColor: '#fafafa', boxSizing: 'border-box' }} />
                        <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Может быть на любом языке</p>
                    </div>

                    {/* Terms agreement */}
                    <div style={{ width: '100%', marginBottom: 14 }}>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                            <div
                                onClick={() => setAgreedToTerms(v => !v)}
                                style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${agreedToTerms ? '#6366f1' : '#d1d5db'}`, background: agreedToTerms ? '#6366f1' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, transition: 'all 0.15s', cursor: 'pointer' }}
                            >
                                {agreedToTerms && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </div>
                            <span style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
                                Я принимаю{' '}
                                <button type="button" onClick={e => { e.stopPropagation(); setPolicyTab('license'); }} style={{ background: 'none', border: 'none', padding: 0, color: '#6366f1', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>Лицензионное соглашение</button>
                                {' '}и{' '}
                                <button type="button" onClick={e => { e.stopPropagation(); setPolicyTab('privacy'); }} style={{ background: 'none', border: 'none', padding: 0, color: '#6366f1', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>Политику конфиденциальности</button>
                            </span>
                        </label>
                    </div>

                    {error && <div style={{ width: '100%', backgroundColor: '#fff0f0', border: '1px solid #ffcdd2', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#c62828', marginBottom: 12 }}>⚠️ {error}</div>}

                    <button onClick={handleNext} disabled={!agreedToTerms} style={{ width: '100%', padding: '13px', background: agreedToTerms ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#e5e7eb', color: agreedToTerms ? 'white' : '#9ca3af', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: agreedToTerms ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}>
                        Далее →
                    </button>
                </>)}

                {/* ── STEP 2 ── */}
                {step === 2 && (<>
                    <p style={{ fontSize: 13, color: subtextColor, marginBottom: 14, alignSelf: 'flex-start', transition: T }}>Шаг 2 — Тема оформления</p>

                    {/* Mini chat preview */}
                    <div style={{ width: '100%', borderRadius: 14, overflow: 'hidden', border: `1px solid ${theme.inputBorder}`, marginBottom: 16, transition: T }}>
                        {/* Header */}
                        <div style={{ backgroundColor: theme.previewHeader, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${theme.inputBorder}`, transition: T }}>
                            <div style={{ width: 30, height: 30, borderRadius: '50%', background: theme.accentGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'white', fontWeight: 700, flexShrink: 0, transition: T }}>A</div>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: textColor, transition: T }}>Aurora</div>
                                <div style={{ fontSize: 11, color: theme.mutedColor, transition: T }}>в сети</div>
                            </div>
                        </div>
                        {/* Messages */}
                        <div style={{ backgroundColor: theme.previewBg, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, transition: T }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                                <div style={{ width: 24, height: 24, borderRadius: '50%', background: theme.accentGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'white', flexShrink: 0, transition: T }}>A</div>
                                <div style={{ backgroundColor: theme.otherBubble, color: theme.otherText, padding: '8px 12px', borderRadius: '14px 14px 14px 3px', fontSize: 12, lineHeight: 1.45, maxWidth: '75%', transition: T }}>
                                    Привет! Добро пожаловать 👋
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                <div style={{ background: theme.ownBubble, color: theme.ownText, padding: '8px 12px', borderRadius: '14px 14px 3px 14px', fontSize: 12, lineHeight: 1.45, boxShadow: `0 2px 10px ${theme.accent}35`, transition: T }}>
                                    Отлично выглядит! ✨
                                </div>
                                <div style={{ fontSize: 10, color: theme.mutedColor, marginTop: 3, transition: T }}>12:01 ✓✓</div>
                            </div>
                        </div>
                    </div>

                    {/* 3 theme cards */}
                    <div style={{ display: 'flex', gap: 10, width: '100%', marginBottom: 16 }}>
                        {THEMES.map(th => {
                            const active = th.id === selectedId;
                            return (
                                <button
                                    key={th.id}
                                    onClick={() => setSelectedId(th.id)}
                                    style={{
                                        flex: 1, borderRadius: 14, padding: '10px 8px 8px',
                                        cursor: 'pointer',
                                        border: `2px solid ${active ? th.accent : theme.inputBorder}`,
                                        backgroundColor: th.cardBg,
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                                        boxShadow: active ? `0 0 0 3px ${th.accent}28, 0 4px 16px ${th.accent}20` : 'none',
                                        transform: active ? 'scale(1.05)' : 'scale(1)',
                                        transition: 'all 0.22s cubic-bezier(0.4,0,0.2,1)',
                                        position: 'relative',
                                    }}
                                >
                                    {/* Bubble strip */}
                                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3, padding: '0 2px' }}>
                                        <div style={{ height: 6, width: '60%', borderRadius: 6, background: th.otherBubble }} />
                                        <div style={{ height: 6, width: '76%', borderRadius: 6, background: th.ownBubble, alignSelf: 'flex-end' }} />
                                        <div style={{ height: 6, width: '50%', borderRadius: 6, background: th.otherBubble }} />
                                    </div>
                                    <span style={{ fontSize: 18 }}>{th.icon}</span>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: active ? th.accent : th.subtextColor, transition: 'color 0.2s' }}>{th.label}</span>
                                    {active && (
                                        <div style={{ position: 'absolute', top: 6, right: 6, width: 17, height: 17, borderRadius: '50%', background: th.accentGrad, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                        <button onClick={() => setStep(1)} style={{ padding: '12px 18px', backgroundColor: theme.btnBack, color: theme.btnBackText, border: `1px solid ${theme.btnBackBorder}`, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: T }}>
                            ← Назад
                        </button>
                        <button onClick={handleComplete} disabled={loading} style={{ flex: 1, padding: '12px', background: theme.accentGrad, color: 'white', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: loading ? 0.7 : 1, boxShadow: `0 4px 20px ${theme.accent}45`, transition: T }}>
                            {loading ? <span style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} /> : 'Начать →'}
                        </button>
                    </div>
                </>)}
            </div>

            {/* Exit overlay — fills screen with theme bg, then app appears */}
            {policyTab && <PolicyModal initialTab={policyTab} isDark={false} onClose={() => setPolicyTab(null)} />}

            {exiting && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    background: theme.pageBg,
                    animation: 'setupExitFill 0.55s cubic-bezier(0.4,0,0.2,1) forwards',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <img
                        src="/logo192.png"
                        alt="Aurora"
                        style={{
                            width: 72, height: 72, borderRadius: 18,
                            boxShadow: `0 0 40px ${theme.accent}60`,
                            animation: 'setupExitFill 0.55s 0.1s cubic-bezier(0.4,0,0.2,1) both',
                        }}
                    />
                </div>
            )}
        </div>
    );
};

export default SetupModal;
