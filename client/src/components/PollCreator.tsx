import React, { useState } from 'react';
import { useLang } from '../i18n';

interface PollCreatorProps {
    isDark?: boolean;
    onClose: () => void;
    onCreate: (question: string, options: string[], isAnonymous: boolean, isMultiChoice: boolean) => void;
}

const PollCreator: React.FC<PollCreatorProps> = ({ isDark = false, onClose, onCreate }) => {
    const dm = isDark;
    const { lang } = useLang();
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '']);
    const [isAnonymous, setIsAnonymous] = useState(false);
    const [isMultiChoice, setIsMultiChoice] = useState(false);
    const [closing, setClosing] = useState(false);

    const isOled = dm && document.body.classList.contains('oled-theme');
    const bg = isOled ? '#08080f' : dm ? '#1a1a2e' : 'white';
    const border = isOled ? 'rgba(167,139,250,0.15)' : dm ? 'rgba(99,102,241,0.22)' : '#ede9fe';
    const inputBg = isOled ? '#050508' : dm ? '#12122a' : '#f9fafb';
    const textColor = isOled ? '#e2e0ff' : dm ? '#e2e8f0' : '#1e1b4b';
    const subColor = isOled ? '#7c6aaa' : dm ? '#7c7caa' : '#6b7280';

    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const addOption = () => { if (options.length < 10) setOptions(o => [...o, '']); };
    const removeOption = (i: number) => { if (options.length > 2) setOptions(o => o.filter((_, j) => j !== i)); };
    const setOption = (i: number, val: string) => setOptions(o => o.map((v, j) => j === i ? val : v));

    const handleCreate = () => {
        const q = question.trim();
        const opts = options.map(o => o.trim()).filter(Boolean);
        if (!q || opts.length < 2) return;
        onCreate(q, opts, isAnonymous, isMultiChoice);
        close();
    };

    const Toggle: React.FC<{ checked: boolean; onChange: () => void; label: string }> = ({ checked, onChange, label }) => (
        <div onClick={onChange} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', cursor: 'pointer', borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: 14, color: textColor }}>{label}</span>
            <div style={{ width: 40, height: 22, borderRadius: 11, background: checked ? '#6366f1' : (dm ? '#2d2d50' : '#e5e7eb'), position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
            </div>
        </div>
    );

    return (
        <div className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 5000, background: isOled ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={close}>
            <div className={closing ? 'modal-exit' : 'modal-enter'} style={{ background: bg, borderRadius: 20, width: 400, maxWidth: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.12), 0 24px 60px rgba(0,0,0,0.98)' : dm ? '0 0 40px rgba(99,102,241,0.25), 0 30px 80px rgba(0,0,0,0.7)' : '0 20px 60px rgba(0,0,0,0.14)', border: `1px solid ${border}` }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '18px 20px 14px', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: isOled ? 'rgba(167,139,250,0.12)' : dm ? 'rgba(99,102,241,0.12)' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isOled ? '#a78bfa' : '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                        </div>
                        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: textColor }}>{lang === 'en' ? 'Create Poll' : 'Создать опрос'}</h3>
                    </div>
                    <button onClick={close} style={{ width: 28, height: 28, background: isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', border: 'none', borderRadius: '50%', cursor: 'pointer', color: subColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>✕</button>
                </div>
                <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: subColor, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{lang === 'en' ? 'Question' : 'Вопрос'}</div>
                        <textarea
                            value={question}
                            onChange={e => setQuestion(e.target.value)}
                            placeholder={lang === 'en' ? 'Ask a question...' : 'Задайте вопрос...'}
                            rows={2}
                            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${border}`, background: inputBg, color: textColor, fontSize: 14, resize: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                        />
                    </div>
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: subColor, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{lang === 'en' ? 'Options' : 'Варианты'}</div>
                        {options.map((opt, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <input
                                    value={opt}
                                    onChange={e => setOption(i, e.target.value)}
                                    placeholder={lang === 'en' ? `Option ${i + 1}` : `Вариант ${i + 1}`}
                                    style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${border}`, background: inputBg, color: textColor, fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                                />
                                {options.length > 2 && (
                                    <button onClick={() => removeOption(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 17, lineHeight: 1, flexShrink: 0 }}>✕</button>
                                )}
                            </div>
                        ))}
                        {options.length < 10 && (
                            <button onClick={addOption} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: `1.5px dashed ${dm ? 'rgba(99,102,241,0.4)' : '#c4b5fd'}`, borderRadius: 10, padding: '8px 12px', cursor: 'pointer', color: '#6366f1', fontSize: 13, fontWeight: 600, width: '100%' }}>
                                + {lang === 'en' ? 'Add option' : 'Добавить вариант'}
                            </button>
                        )}
                    </div>
                    <div>
                        <Toggle checked={isAnonymous} onChange={() => setIsAnonymous(v => !v)} label={lang === 'en' ? 'Anonymous voting' : 'Анонимное голосование'} />
                        <Toggle checked={isMultiChoice} onChange={() => setIsMultiChoice(v => !v)} label={lang === 'en' ? 'Multiple answers' : 'Несколько ответов'} />
                    </div>
                </div>
                <div style={{ padding: '14px 20px', borderTop: `1px solid ${border}`, flexShrink: 0, display: 'flex', gap: 10 }}>
                    <button onClick={close} style={{ flex: 1, padding: '11px', borderRadius: 12, border: `1.5px solid ${border}`, background: 'none', color: subColor, cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit' }}>
                        {lang === 'en' ? 'Cancel' : 'Отмена'}
                    </button>
                    <button onClick={handleCreate} disabled={!question.trim() || options.filter(o => o.trim()).length < 2} style={{ flex: 2, padding: '11px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 700, opacity: (!question.trim() || options.filter(o => o.trim()).length < 2) ? 0.45 : 1, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        {lang === 'en' ? 'Create Poll' : 'Создать опрос'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PollCreator;
