import React, { useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { User } from '../types';
import { config } from '../config';
import { useLang } from '../i18n';

interface ContactPickerProps {
    users: User[];
    currentUserId: number;
    isDark?: boolean;
    onSend: (contact: { id: number; username: string; avatar?: string; avatar_color?: string }) => void;
    onClose: () => void;
}

const ContactPicker: React.FC<ContactPickerProps> = ({ users, currentUserId, isDark = false, onSend, onClose }) => {
    const { lang } = useLang();
    const dm = isDark;
    const isOled = dm && document.body.classList.contains('oled-theme');
    const isMobile = window.innerWidth <= 768;

    const [closing, setClosing] = useState(false);
    const [search, setSearch] = useState('');

    const bg = isOled ? '#000' : dm ? '#13131f' : '#fff';
    const cardBg = isOled ? '#0a0a14' : dm ? '#1a1a2e' : '#f5f3ff';
    const textCol = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const border = isOled ? 'rgba(167,139,250,0.15)' : dm ? 'rgba(99,102,241,0.2)' : '#ede9fe';
    const accent = '#6366f1';

    const close = () => { setClosing(true); setTimeout(onClose, 200); };

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return users.filter(u => u.id !== currentUserId && (u.username.toLowerCase().includes(q) || (u.tag || '').toLowerCase().includes(q)));
    }, [users, currentUserId, search]);

    const handleSelect = (u: User) => {
        onSend({ id: u.id, username: u.username, avatar: u.avatar, avatar_color: u.avatar_color });
        close();
    };

    const getInitial = (name: string) => name[0]?.toUpperCase() || '?';

    return ReactDOM.createPortal(
        <div
            className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            style={{ position: 'fixed', inset: 0, zIndex: 4500, background: isOled ? 'rgba(0,0,0,0.9)' : dm ? 'rgba(15,10,40,0.8)' : 'rgba(15,10,40,0.45)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}
            onClick={close}
        >
            <div
                className={closing ? 'modal-exit' : 'modal-enter'}
                style={{ background: bg, borderRadius: isMobile ? '20px 20px 0 0' : 20, width: isMobile ? '100%' : 380, maxWidth: '96vw', maxHeight: isMobile ? '80svh' : '78vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.35)', paddingBottom: isMobile ? 'env(safe-area-inset-bottom,0px)' : 0 }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 10px', gap: 10, flexShrink: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 16, color: textCol, flex: 1 }}>{lang === 'en' ? 'Share contact' : 'Поделиться контактом'}</span>
                    <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: subCol, padding: 4, display: 'flex' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                {/* Search */}
                <div style={{ padding: '4px 14px 8px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: cardBg, border: `1.5px solid ${border}`, borderRadius: 12, padding: '8px 12px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={subCol} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={lang === 'en' ? 'Search...' : 'Поиск...'} style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 13, color: textCol, fontFamily: 'inherit' }} autoFocus />
                    </div>
                </div>

                {/* List */}
                <div style={{ flex: 1, overflowY: 'auto', paddingInline: 10, paddingBottom: 10 }}>
                    {filtered.length === 0 && (
                        <div style={{ textAlign: 'center', padding: 32, color: subCol, fontSize: 13 }}>{lang === 'en' ? 'No contacts found' : 'Контакты не найдены'}</div>
                    )}
                    {filtered.map(u => {
                        const avatarSrc = u.avatar ? config.fileUrl(u.avatar) : null;
                        return (
                            <button key={u.id} onClick={() => handleSelect(u)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '9px 8px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 12, textAlign: 'left', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent' }}
                                onMouseEnter={e => { e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.07)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                                <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: u.avatar_color || accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {avatarSrc
                                        ? <img src={avatarSrc} alt={u.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <span style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>{getInitial(u.username)}</span>}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: textCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                    {u.tag && <div style={{ fontSize: 11, color: subCol }}>@{u.tag}</div>}
                                </div>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={subCol} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ContactPicker;
