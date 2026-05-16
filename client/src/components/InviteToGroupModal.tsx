import React, { useState, useRef } from 'react';
import { api } from '../services/api';
import { config } from '../config';
import { useLang } from '../i18n';

interface InviteToGroupModalProps {
    token: string;
    groupId: number;
    groupName: string;
    isDark?: boolean;
    onClose: () => void;
    onInvited: () => void;
}

const InviteToGroupModal: React.FC<InviteToGroupModalProps> = ({ token, groupId, groupName, isDark = false, onClose, onInvited }) => {
    const { t, lang } = useLang();
    const dm = isDark;
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [closing, setClosing] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isOled = dm && document.body.classList.contains('oled-theme');
    const bg = isOled ? '#000000' : dm ? '#0d0d1a' : '#f7f6ff';
    const cardBg = isOled ? '#050508' : dm ? '#13131f' : 'white';
    const cardShadow = isOled ? '0 2px 16px rgba(0,0,0,0.9),0 0 0 1px rgba(167,139,250,0.07)' : dm ? '0 2px 12px rgba(0,0,0,0.4),0 0 0 1px rgba(99,102,241,0.08)' : '0 2px 8px rgba(99,102,241,0.07),0 0 0 1px rgba(99,102,241,0.05)';
    const hdrShadow = `0 1px 0 ${isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}`;
    const inputBg = isOled ? '#0a0a14' : dm ? '#1e1e38' : '#f5f3ff';
    const textColor = dm ? '#e2e8f0' : '#1e1b4b';
    const subColor = isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af';

    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const search = (q: string) => {
        setQuery(q);
        setError('');
        if (timerRef.current) clearTimeout(timerRef.current);
        const clean = q.trim().replace(/^@/, '');
        if (!clean) { setResults([]); return; }
        timerRef.current = setTimeout(async () => {
            setLoading(true);
            try {
                const r = await api.searchUsers(token, clean);
                setResults((r.users || []).filter((u: any) =>
                    u.tag?.toLowerCase().startsWith(clean.toLowerCase())
                ));
            } catch {} finally { setLoading(false); }
        }, 280);
    };

    const handleAdd = async (u: any) => {
        setError('');
        setLoading(true);
        try {
            const res = await api.inviteToGroup(token, groupId, u.tag || u.username);
            if (res.success) {
                onInvited();
                close();
            } else {
                const msg = res.message || res.detail || '';
                if (msg === 'User not found') setError(t('User not found'));
                else if (msg === 'User already in group') setError(t('User is already in group'));
                else setError(t('Could not invite'));
            }
        } catch { setError(t('Network error')); }
        finally { setLoading(false); }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
            <div style={{ background: bg, borderRadius: 20, width: 420, maxWidth: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: isOled ? '0 0 60px rgba(124,58,237,0.25), 0 30px 80px rgba(0,0,0,0.9)' : dm ? '0 0 50px rgba(99,102,241,0.22), 0 24px 70px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.14), 0 20px 60px rgba(0,0,0,0.15)' }} className={closing ? 'modal-exit' : 'modal-enter'} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '18px 20px 14px', background: cardBg, boxShadow: hdrShadow, flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: textColor }}>{t('Invite to group')}</h3>
                        <button onClick={close} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: subColor }}>✕</button>
                    </div>
                    <div style={{ fontSize: 12, color: subColor }}>{t('Group:')} <span style={{ color: isOled ? '#a78bfa' : '#6366f1', fontWeight: 600 }}>{groupName}</span></div>
                </div>
                <div style={{ padding: '12px 16px 14px', background: cardBg, boxShadow: hdrShadow, flexShrink: 0 }}>
                    <input
                        autoFocus
                        type="text"
                        placeholder={lang === 'en' ? '@tag of user' : '@тег пользователя'}
                        value={query}
                        onChange={e => search(e.target.value)}
                        style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: `1.5px solid ${isOled ? 'rgba(167,139,250,0.2)' : dm ? 'rgba(99,102,241,0.2)' : '#ede9fe'}`, background: inputBg, color: textColor, fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    />
                    {error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>{error}</div>}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {loading && <div style={{ textAlign: 'center', color: subColor, fontSize: 13, padding: '12px 0' }}>{lang === 'en' ? 'Searching...' : 'Поиск...'}</div>}
                    {!loading && query.trim() && results.length === 0 && (
                        <div style={{ textAlign: 'center', color: subColor, fontSize: 13, padding: '12px 0' }}>{t('User not found')}</div>
                    )}
                    {results.map(u => (
                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: cardBg, boxShadow: cardShadow, cursor: 'pointer' }} onClick={() => handleAdd(u)}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')} onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                            <div style={{ width: 38, height: 38, borderRadius: 10, background: u.avatar ? 'transparent' : (isOled ? 'rgba(167,139,250,0.2)' : '#6366f1'), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, overflow: 'hidden', flexShrink: 0 }}>
                                {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt={u.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                {u.tag && <div style={{ fontSize: 11, color: isOled ? '#a78bfa' : '#6366f1' }}>@{u.tag}</div>}
                            </div>
                            <div style={{ fontSize: 12, color: isOled ? '#a78bfa' : '#6366f1', fontWeight: 600, flexShrink: 0 }}>+ {lang === 'en' ? 'Add' : 'Добавить'}</div>
                        </div>
                    ))}
                </div>
                <div style={{ padding: '12px 14px', background: cardBg, boxShadow: `0 -1px 0 ${isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}`, flexShrink: 0 }}>
                    <button onClick={close} style={{ width: '100%', padding: '11px', borderRadius: 12, border: 'none', background: isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.08)' : '#f0eeff', color: subColor, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                        {lang === 'en' ? 'Cancel' : 'Отмена'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InviteToGroupModal;
