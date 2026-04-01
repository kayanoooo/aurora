import React, { useState } from 'react';
import { api } from '../services/api';

interface SetupModalProps {
    token: string;
    onComplete: (token: string, username: string, theme: string) => void;
}

const THEMES = [
    { id: 'dark', label: 'Тёмная', bg: '#1a1a2e', accent: '#6366f1' },
    { id: 'light', label: 'Светлая', bg: '#f8f9ff', accent: '#6366f1' },
    { id: 'midnight', label: 'Полночь', bg: '#0f0c29', accent: '#8b5cf6' },
    { id: 'forest', label: 'Лес', bg: '#1a2e1a', accent: '#22c55e' },
    { id: 'ocean', label: 'Океан', bg: '#0c1a2e', accent: '#06b6d4' },
    { id: 'sunset', label: 'Закат', bg: '#2e1a1a', accent: '#f43f5e' },
];

const SetupModal: React.FC<SetupModalProps> = ({ token, onComplete }) => {
    const [step, setStep] = useState<1 | 2>(1);
    const [tag, setTag] = useState('');
    const [username, setUsername] = useState('');
    const [selectedTheme, setSelectedTheme] = useState('light');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleTagChange = (v: string) => {
        setTag(v.replace(/[^a-z0-9_]/g, '').slice(0, 30));
    };

    const handleNext = () => {
        if (tag.length < 3) { setError('Тег должен быть не менее 3 символов'); return; }
        if (!username.trim()) { setError('Введите отображаемое имя'); return; }
        setError('');
        setStep(2);
    };

    const handleComplete = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await api.setupProfile(token, tag, username, selectedTheme);
            if (res?.success) {
                onComplete(res.token, res.username, selectedTheme);
            } else {
                setError(Array.isArray(res?.detail) ? res.detail.map((e: any) => e.msg).join('; ') : (res?.detail || 'Ошибка при настройке профиля'));
                setStep(1);
            }
        } catch (err: any) {
            setError(err.message || 'Ошибка');
            setStep(1);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={st.overlay}>
            <div style={st.card}>
                <div style={st.logoWrap}>
                    <img src="/logo192.png" alt="Aurora" style={st.logo} />
                </div>
                <h2 style={st.title}>Добро пожаловать в Aurora!</h2>
                <p style={st.subtitle}>Настройте свой профиль</p>

                {/* Steps indicator */}
                <div style={st.steps}>
                    <div style={{ ...st.step, ...(step >= 1 ? st.stepActive : {}) }}>1</div>
                    <div style={st.stepLine} />
                    <div style={{ ...st.step, ...(step >= 2 ? st.stepActive : {}) }}>2</div>
                </div>

                {step === 1 ? (
                    <>
                        <p style={st.stepLabel}>Выберите тег и имя</p>

                        {/* Tag input */}
                        <div style={st.inputGroup}>
                            <label style={st.label}>Ваш тег (уникальный)</label>
                            <div style={st.inputWrap}>
                                <span style={st.prefix}>@</span>
                                <input
                                    type="text"
                                    placeholder="например: ivan_petrov"
                                    value={tag}
                                    onChange={e => handleTagChange(e.target.value.toLowerCase())}
                                    style={st.input}
                                    autoFocus
                                />
                            </div>
                            <p style={st.hint}>Только латинские буквы, цифры и _ · 3–30 символов</p>
                        </div>

                        {/* Username input */}
                        <div style={st.inputGroup}>
                            <label style={st.label}>Отображаемое имя</label>
                            <input
                                type="text"
                                placeholder="Как вас называть?"
                                value={username}
                                onChange={e => setUsername(e.target.value.slice(0, 50))}
                                style={{ ...st.input, paddingLeft: 14 }}
                            />
                            <p style={st.hint}>Может быть любым, даже на русском</p>
                        </div>

                        {error && <div style={st.errorBox}>⚠️ {error}</div>}

                        <button onClick={handleNext} style={st.btn}>
                            Далее →
                        </button>
                    </>
                ) : (
                    <>
                        <p style={st.stepLabel}>Выберите тему оформления</p>

                        <div style={st.themeGrid}>
                            {THEMES.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setSelectedTheme(t.id)}
                                    style={{
                                        ...st.themeBtn,
                                        backgroundColor: t.bg,
                                        border: selectedTheme === t.id ? `2px solid ${t.accent}` : '2px solid transparent',
                                        boxShadow: selectedTheme === t.id ? `0 0 0 2px ${t.accent}40` : 'none',
                                    }}
                                >
                                    <div style={{ ...st.themeAccent, backgroundColor: t.accent }} />
                                    <span style={{ ...st.themeLabel, color: selectedTheme === t.id ? t.accent : '#999' }}>{t.label}</span>
                                </button>
                            ))}
                        </div>

                        {error && <div style={st.errorBox}>⚠️ {error}</div>}

                        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                            <button onClick={() => setStep(1)} style={st.backBtn}>← Назад</button>
                            <button onClick={handleComplete} disabled={loading} style={{ ...st.btn, flex: 1 }}>
                                {loading ? <span style={st.loader} /> : 'Начать →'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const st: { [key: string]: React.CSSProperties } = {
    overlay: { position: 'fixed', inset: 0, background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
    card: { backgroundColor: 'white', borderRadius: 24, padding: '40px 40px 32px', width: 440, maxWidth: '95vw', boxShadow: '0 30px 80px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', alignItems: 'center' },
    logoWrap: { marginBottom: 12 },
    logo: { width: 64, height: 64, borderRadius: 16, boxShadow: '0 8px 24px rgba(255,107,0,0.4)' },
    title: { fontSize: 22, fontWeight: 800, background: 'linear-gradient(90deg, #FF6B00, #ff9a3c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: 4, textAlign: 'center' },
    subtitle: { fontSize: 14, color: '#888', marginBottom: 20 },
    steps: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 },
    step: { width: 32, height: 32, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#9ca3af', transition: 'all 0.3s' },
    stepActive: { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white' },
    stepLine: { width: 40, height: 2, backgroundColor: '#e5e7eb' },
    stepLabel: { fontSize: 13, color: '#6b7280', marginBottom: 16, alignSelf: 'flex-start' },
    inputGroup: { width: '100%', marginBottom: 14 },
    label: { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' },
    inputWrap: { display: 'flex', alignItems: 'center', border: '1.5px solid #e5e7eb', borderRadius: 10, backgroundColor: '#fafafa', overflow: 'hidden' },
    prefix: { padding: '12px 8px 12px 14px', fontSize: 15, fontWeight: 700, color: '#6366f1', backgroundColor: '#f3f4ff', borderRight: '1px solid #e5e7eb' },
    input: { width: '100%', padding: '12px 14px', border: 'none', outline: 'none', fontSize: 14, backgroundColor: '#fafafa', borderRadius: 10 },
    hint: { fontSize: 11, color: '#9ca3af', marginTop: 4 },
    themeGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, width: '100%', marginBottom: 20 },
    themeBtn: { borderRadius: 12, padding: '14px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, transition: 'all 0.2s' },
    themeAccent: { width: 24, height: 24, borderRadius: '50%' },
    themeLabel: { fontSize: 11, fontWeight: 600 },
    errorBox: { width: '100%', backgroundColor: '#fff0f0', border: '1px solid #ffcdd2', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#c62828', marginBottom: 12 },
    btn: { width: '100%', padding: '13px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    backBtn: { padding: '13px 20px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
    loader: { width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' },
};

export default SetupModal;
