import React, { useEffect, useState, useMemo } from 'react';
import { DevBadge, TesterBadge, DEV_TAGS, TESTER_TAGS } from './UserBadges';
import ReactDOM from 'react-dom';
import { User } from '../types';
import { api } from '../services/api';
import { config } from '../config';
import { useLang } from '../i18n';

const BASE_URL = config.BASE_URL;

const isImg = (n: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(n);
const isVid = (n: string) => /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(n);
const isAud = (n: string) => /\.(mp3|ogg|wav|flac|aac|m4a|opus|weba)$/i.test(n);

interface UserProfileModalProps {
    user: User;
    token: string;
    isDark?: boolean;
    messages?: any[];
    isOnline?: boolean;
    isSelf?: boolean;
    initialMediaOpen?: boolean;
    onClose: () => void;
    onStartChat?: () => void;
    onGoToMessage?: (id: number) => void;
    onReport?: (type: 'user', id: number, name: string) => void;
    onClearChat?: () => void;
    onExportChat?: () => void;
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({
    user, token, isDark = false, messages = [], isOnline, isSelf = false, initialMediaOpen = false, onClose, onStartChat, onGoToMessage, onReport, onClearChat, onExportChat
}) => {
    const dm = isDark;
    const { t, lang } = useLang();
    const [fullUser, setFullUser] = useState<User>(user);
    const [closing, setClosing] = useState(false);
    const [avatarLightbox, setAvatarLightbox] = useState(false);
    const [expanded, setExpanded] = useState(initialMediaOpen);
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    const [mediaTab, setMediaTab] = useState<'images' | 'video' | 'audio' | 'files'>('images');
    const [lightbox, setLightbox] = useState<{ src: string; filename: string; isVideo: boolean } | null>(null);
    const [mediaClosing, setMediaClosing] = useState(false);
    const [usernameHistory, setUsernameHistory] = useState<{ old_username: string; changed_at: string }[]>([]);
    const [mediaDateFrom, setMediaDateFrom] = useState('');
    const [mediaDateTo, setMediaDateTo] = useState('');
    const close = () => { setClosing(true); setTimeout(onClose, 180); };
    const collapseMedia = () => { setMediaClosing(true); setTimeout(() => { setExpanded(false); setMediaClosing(false); }, 220); };

    useEffect(() => {
        api.findUser(token, user.username).then(res => {
            if (res.user) setFullUser(res.user);
        }).catch(() => {});
        if (!isSelf) {
            fetch(`${config.API_URL}/users/${user.id}/username-history?token=${token}`)
                .then(r => r.json()).then(d => setUsernameHistory(d.history || [])).catch(() => {});
        }
    }, [token, user.username, user.id, isSelf]);

    const avatarUrl = config.fileUrl(fullUser.avatar);

    // Parse media from messages
    const { imgs, vids, auds, files } = useMemo(() => {
        const i: any[] = [], v: any[] = [], a: any[] = [], f: any[] = [];
        const dateFrom = mediaDateFrom ? new Date(mediaDateFrom) : null;
        const dateTo = mediaDateTo ? new Date(mediaDateTo + 'T23:59:59') : null;
        const add = (fp: string, fn: string, fs: number | undefined, mid: number, ts?: string) => {
            if (dateFrom || dateTo) {
                const d = ts ? new Date(ts) : null;
                if (d) {
                    if (dateFrom && d < dateFrom) return;
                    if (dateTo && d > dateTo) return;
                }
            }
            const src = fp.startsWith('http') ? fp : `${BASE_URL}${fp}`;
            const item = { src, filename: fn, fileSize: fs, messageId: mid };
            if (isImg(fn)) i.push(item);
            else if (isVid(fn)) v.push(item);
            else if (isAud(fn)) a.push(item);
            else f.push(item);
        };
        for (const msg of messages) {
            if (msg.file_path && msg.filename) add(msg.file_path, msg.filename, msg.file_size, msg.id, (msg as any).timestamp);
            if (msg.files) {
                const arr = typeof msg.files === 'string' ? (() => { try { return JSON.parse(msg.files); } catch { return []; } })() : msg.files;
                if (Array.isArray(arr)) arr.forEach((fi: any) => fi.file_path && fi.filename && add(fi.file_path, fi.filename, fi.file_size, msg.id, (msg as any).timestamp));
            }
        }
        return { imgs: i.reverse(), vids: v.reverse(), auds: a.reverse(), files: f.reverse() };
    }, [messages, mediaDateFrom, mediaDateTo]);

    const mediaTabs = [
        { key: 'images' as const, label: t('Photo'), count: imgs.length },
        { key: 'video' as const, label: t('Video'), count: vids.length },
        { key: 'audio' as const, label: t('Audio'), count: auds.length },
        { key: 'files' as const, label: t('Files'), count: files.length },
    ];

    const hasMedia = messages.length > 0;

    const openMediaTab = (tab: typeof mediaTab) => {
        setMediaTab(tab);
        setExpanded(true);
    };

    const formatLastSeenProfile = (lastSeen: string): string => {
        try {
            const date = new Date(lastSeen);
            if (isNaN(date.getTime())) return t('last seen recently');
            const now = new Date();
            const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
            if (diffMin < 1) return lang === 'en' ? 'just now' : 'только что';
            if (diffMin < 60) return lang === 'en' ? `${diffMin} min ago` : `был(а) ${diffMin} мин. назад`;
            const diffH = Math.floor(diffMin / 60);
            if (diffH < 6) return lang === 'en' ? `${diffH} h ago` : `был(а) ${diffH} ч. назад`;
            const today = new Date(); today.setHours(0,0,0,0);
            const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
            const msgDay = new Date(date); msgDay.setHours(0,0,0,0);
            const hhmm = date.toLocaleTimeString(lang === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
            if (msgDay.getTime() === today.getTime()) return lang === 'en' ? `today at ${hhmm}` : `был(а) сегодня в ${hhmm}`;
            if (msgDay.getTime() === yesterday.getTime()) return lang === 'en' ? `yesterday at ${hhmm}` : `был(а) вчера в ${hhmm}`;
            const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
            return lang === 'en' ? `${days} days ago` : `был(а) ${days} дн. назад`;
        } catch { return t('last seen recently'); }
    };

    const formatBirthday = (val?: string) => {
        if (!val) return null;
        try { return new Date(val).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { year: 'numeric', month: 'long', day: 'numeric' }); }
        catch { return val; }
    };

    const formatSize = (b?: number) => {
        if (!b) return '';
        if (b < 1024) return `${b} B`;
        if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
        return `${(b / 1048576).toFixed(1)} MB`;
    };

    const isOled = dm && document.body.classList.contains('oled-theme');
    const tk = tokens(dm, isOled);
    const border = isOled ? 'rgba(167,139,250,0.2)' : (dm ? 'rgba(99,102,241,0.25)' : '#ede9fe');
    const bg = isOled ? '#000000' : (dm ? '#1a1a2e' : '#ffffff');
    const sub = isOled ? '#7c6aaa' : dm ? '#7c7caa' : '#9ca3af';

    const currentTabData = mediaTab === 'images' ? imgs : mediaTab === 'video' ? vids : mediaTab === 'audio' ? auds : files;

    // ── Mobile fullscreen layout ─────────────────────────────────────────────
    if (isMobile) {
        // For Favorites (isSelf + initialMediaOpen): show media panel title
        const profileTitle = isSelf && initialMediaOpen
            ? (lang === 'en' ? 'Favorites' : 'Избранное')
            : (lang === 'en' ? 'Profile' : 'Профиль');

        return ReactDOM.createPortal(
            <>
            {/* Full-screen backdrop */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 3000, backgroundColor: isOled ? 'rgba(0,0,0,0.88)' : (dm ? 'rgba(15,10,40,0.6)' : 'rgba(15,10,40,0.3)'), backdropFilter: 'blur(10px)' }}
                className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
                onClick={close} />

            {/* Profile screen — slides up from bottom; hidden when initialMediaOpen (favorites goes straight to media) */}
            {!(isSelf && initialMediaOpen) && (
            <div
                style={{ position: 'fixed', left: 0, right: 0, bottom: 0, top: 0, zIndex: 3001, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                className={closing ? 'mobile-profile-exit' : 'mobile-profile-enter'}
                onClick={e => e.stopPropagation()}
            >
                {/* Top bar */}
                <div style={{ display: 'flex', alignItems: 'center', paddingTop: 'max(14px, env(safe-area-inset-top, 14px))', paddingBottom: 10, paddingLeft: 16, paddingRight: 16, gap: 10, flexShrink: 0 }}>
                    <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: 4, display: 'flex', alignItems: 'center' }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <span style={{ fontWeight: 700, fontSize: 17, color: dm ? '#e2e8f0' : '#1e1b4b', flex: 1 }}>
                        {profileTitle}
                    </span>
                </div>

                {/* Profile content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', paddingBottom: 'max(32px, calc(32px + env(safe-area-inset-bottom, 0px)))', textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
                        <div onClick={() => avatarUrl && setAvatarLightbox(true)} style={{ width: 96, height: 96, borderRadius: '50%', backgroundColor: avatarUrl ? (dm ? '#1a1a2e' : '#f3f4f6') : (fullUser.avatar_color || '#6366f1'), display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, overflow: 'hidden', boxShadow: `0 4px 20px ${fullUser.avatar_color ? fullUser.avatar_color + '66' : 'rgba(108,71,212,0.4)'}`, cursor: avatarUrl ? 'zoom-in' : 'default' }}>
                            {avatarUrl ? <img src={avatarUrl} alt={fullUser.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : <span style={{ color: 'white', fontSize: 40, fontWeight: 700 }}>{fullUser.username[0]?.toUpperCase()}</span>}
                        </div>
                        <h2 style={{ fontSize: 22, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', margin: '0 0 2px', display: 'flex', alignItems: 'center', gap: 6 }}>{fullUser.username}</h2>
                        {fullUser.tag && <p style={{ fontSize: 13, color: '#6366f1', margin: '0 0 4px', fontWeight: 600 }}>@{fullUser.tag}</p>}
                        {(isOnline ?? fullUser.is_online)
                            ? <p style={{ fontSize: 13, color: '#22c55e', margin: '0 0 4px', fontWeight: 600 }}>🟢 {t('Online')}</p>
                            : fullUser.last_seen && fullUser.last_seen !== 'hidden'
                                ? <p style={{ fontSize: 13, color: sub, margin: '0 0 4px' }}>{formatLastSeenProfile(fullUser.last_seen)}</p>
                                : null}
                        {fullUser.status && <p style={{ fontSize: 14, color: sub, margin: 0 }}>{fullUser.status}</p>}
                        {!isSelf && usernameHistory.length > 0 && (
                            <p style={{ fontSize: 11, color: sub, margin: '4px 0 0' }}>
                                <span style={{ fontWeight: 600 }}>{lang === 'en' ? 'Also known as: ' : 'Также известен как: '}</span>
                                {usernameHistory.slice(0, 3).map((h, i) => (
                                    <span key={i}>{i > 0 ? ', ' : ''}<span style={{ color: dm ? '#c4b5fd' : '#6366f1' }}>{h.old_username}</span></span>
                                ))}
                            </p>
                        )}
                    </div>
                    <div style={tk.infoCard}>
                        {fullUser.email && <div style={tk.infoRow}><span style={{ fontSize: 16, flexShrink: 0 }}>📧</span><span style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151' }}>{fullUser.email}</span></div>}
                        {fullUser.phone && <div style={tk.infoRow}><span style={{ fontSize: 16, flexShrink: 0 }}>📱</span><span style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151' }}>{fullUser.phone}</span></div>}
                        {fullUser.birthday && <div style={tk.infoRow}><span style={{ fontSize: 16, flexShrink: 0 }}>🎂</span><span style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151' }}>{formatBirthday(fullUser.birthday)}</span></div>}
                        {fullUser.created_at && <div style={{ ...tk.infoRow, borderBottom: 'none' }}><span style={{ fontSize: 16, flexShrink: 0 }}>📅</span><span style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151' }}>{lang === 'en' ? `In chat since ${new Date(fullUser.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}` : `В чате с ${new Date(fullUser.created_at).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' })}`}</span></div>}
                    </div>
                    {hasMedia && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                            {mediaTabs.map(tab => {
                                const tabIcons: Record<string, React.ReactNode> = {
                                    images: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
                                    video: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
                                    audio: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
                                    files: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
                                };
                                return (
                                    <button key={tab.key} onClick={() => openMediaTab(tab.key)}
                                        style={{ padding: '14px 8px', borderRadius: 14, border: 'none', boxShadow: isOled ? '0 2px 12px rgba(0,0,0,0.8)' : dm ? '0 2px 10px rgba(0,0,0,0.35)' : '0 2px 8px rgba(99,102,241,0.07)', background: isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff'), cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: sub }}>
                                        {tabIcons[tab.key]}
                                        <span style={{ fontSize: 12, fontWeight: 600 }}>{tab.label}</span>
                                        {tab.count > 0 && <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 700 }}>{tab.count}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {onStartChat && (
                            <button onClick={onStartChat} style={{ width: '100%', padding: 14, background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 14, cursor: 'pointer', fontSize: 15, fontWeight: 600 }}>
                                {isSelf ? `⭐ ${lang === 'en' ? 'Favorites' : 'Избранное'}` : `${t('Start chat')}`}
                            </button>
                        )}
                        {!isSelf && (onClearChat || onExportChat) && (
                            <div style={{ display: 'flex', gap: 8 }}>
                                {onExportChat && (
                                    <button onClick={() => { onExportChat(); onClose(); }} style={{ flex: 1, padding: '10px 8px', background: 'transparent', color: dm ? '#a5b4fc' : '#6366f1', border: `1.5px solid ${dm ? 'rgba(99,102,241,0.25)' : '#e0d9ff'}`, borderRadius: 14, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                        {lang === 'en' ? 'Export' : 'Экспорт'}
                                    </button>
                                )}
                                {onClearChat && (
                                    <button onClick={() => { onClearChat(); onClose(); }} style={{ flex: 1, padding: '10px 8px', background: 'transparent', color: '#ef4444', border: `1.5px solid rgba(239,68,68,0.3)`, borderRadius: 14, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                                        {lang === 'en' ? 'Clear chat' : 'Очистить'}
                                    </button>
                                )}
                            </div>
                        )}
                        {!isSelf && onReport && (
                            <button onClick={() => onReport('user', fullUser.id, fullUser.username)} style={{ width: '100%', padding: 11, background: 'transparent', color: '#ef4444', border: `1.5px solid rgba(239,68,68,0.3)`, borderRadius: 14, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                                {lang === 'en' ? 'Report' : 'Пожаловаться'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
            )}

            {/* Media panel — slides in from right over profile; for Favorites goes straight here */}
            {expanded && (
                <div
                    style={{ position: 'fixed', inset: 0, zIndex: 3002, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    className={(isSelf && initialMediaOpen) ? (closing ? 'mobile-profile-exit' : 'mobile-profile-enter') : (mediaClosing ? 'mobile-media-exit' : 'mobile-media-enter')}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Media top bar */}
                    <div style={{ display: 'flex', alignItems: 'center', paddingTop: 'max(14px, env(safe-area-inset-top, 14px))', paddingBottom: 10, paddingLeft: 16, paddingRight: 16, gap: 10, flexShrink: 0 }}>
                        <button onClick={isSelf && initialMediaOpen ? close : collapseMedia} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: 4, display: 'flex', alignItems: 'center' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        <span style={{ fontWeight: 700, fontSize: 17, color: dm ? '#e2e8f0' : '#1e1b4b', flex: 1 }}>
                            {isSelf && initialMediaOpen && !mediaClosing
                                ? (lang === 'en' ? 'Favorites' : 'Избранное')
                                : (mediaTabs.find(tab => tab.key === mediaTab)?.label || '')}
                        </span>
                    </div>
                    {/* Tab strip */}
                    <div style={{ display: 'flex', padding: '8px 12px', gap: 4, borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                        {mediaTabs.map(tab => {
                            const isActive = mediaTab === tab.key;
                            return (
                                <button key={tab.key} onClick={() => setMediaTab(tab.key)}
                                    style={{ flex: 1, padding: '8px 4px', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 700, background: isActive ? (isOled ? 'rgba(167,139,250,0.15)' : dm ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.1)') : 'transparent', color: isActive ? '#6366f1' : sub, transition: 'all 0.15s' }}>
                                    {tab.label}
                                    {tab.count > 0 && <span style={{ marginLeft: 4, fontSize: 10 }}>({tab.count})</span>}
                                </button>
                            );
                        })}
                    </div>
                    {/* Date filter */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px 4px', flexShrink: 0 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        <input type="date" value={mediaDateFrom} onChange={e => setMediaDateFrom(e.target.value)} style={{ flex: 1, background: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', border: `1px solid ${border}`, borderRadius: 8, padding: '3px 6px', fontSize: 11, color: dm ? '#e2e8f0' : '#1e1b4b', outline: 'none', colorScheme: dm ? 'dark' as any : 'light' as any }} />
                        <span style={{ fontSize: 11, color: sub }}>—</span>
                        <input type="date" value={mediaDateTo} onChange={e => setMediaDateTo(e.target.value)} style={{ flex: 1, background: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', border: `1px solid ${border}`, borderRadius: 8, padding: '3px 6px', fontSize: 11, color: dm ? '#e2e8f0' : '#1e1b4b', outline: 'none', colorScheme: dm ? 'dark' as any : 'light' as any }} />
                        {(mediaDateFrom || mediaDateTo) && <button onClick={() => { setMediaDateFrom(''); setMediaDateTo(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sub, padding: 2, display: 'flex' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
                    </div>
                    {/* Media content */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: (mediaTab === 'images' || mediaTab === 'video') ? 8 : 0 }}>
                        {currentTabData.length === 0 ? (
                            <div style={{ padding: 40, textAlign: 'center', color: sub, fontSize: 14 }}>{t('No files')}</div>
                        ) : (mediaTab === 'images' || mediaTab === 'video') ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
                                {currentTabData.map((f, i) => (
                                    <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', background: dm ? '#252540' : '#f0f0f8' }}
                                        onClick={() => setLightbox({ src: f.src, filename: f.filename, isVideo: isVid(f.filename) })}>
                                        {isVid(f.filename) ? <video src={f.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={f.src} alt={f.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                        {isVid(f.filename) && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: 'white', fontSize: 12, marginLeft: 2 }}>▶</span></div></div>}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div>
                                {currentTabData.map((f, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)'}` }}>
                                        <div style={{ width: 40, height: 40, borderRadius: 10, background: dm ? '#252540' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: mediaTab === 'audio' ? 18 : 10, fontWeight: 700, color: '#6366f1' }}>
                                            {mediaTab === 'audio' ? '🎵' : (f.filename.split('.').pop()?.toUpperCase() || 'FILE')}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{f.filename}</div>
                                            {f.fileSize && <div style={{ fontSize: 11, color: sub }}>{formatSize(f.fileSize)}</div>}
                                        </div>
                                        {onGoToMessage && <button onClick={() => { onGoToMessage(f.messageId); close(); }} style={{ width: 32, height: 32, borderRadius: 10, background: dm ? '#252540' : '#f0f0ff', border: 'none', cursor: 'pointer', color: '#6366f1', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>→</button>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {avatarLightbox && avatarUrl && ReactDOM.createPortal(
                <div className="modal-backdrop-enter" onClick={() => setAvatarLightbox(false)} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)' }}>
                    <img src={avatarUrl} alt={fullUser.username} style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 16, objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
                    <button onClick={() => setAvatarLightbox(false)} style={{ position: 'fixed', top: 20, right: 20, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white', fontSize: 18 }}>✕</button>
                </div>,
                document.body
            )}
            {lightbox && ReactDOM.createPortal(
                <div className="modal-backdrop-enter" onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(rgba(0,0,0,0.6), transparent)' }} onClick={e => e.stopPropagation()}>
                        <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lightbox.filename}</span>
                        <button onClick={() => setLightbox(null)} style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.12)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18 }}>✕</button>
                    </div>
                    <div onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '84vh' }}>
                        {lightbox.isVideo ? <video src={lightbox.src} controls autoPlay style={{ maxWidth: '92vw', maxHeight: '84vh', borderRadius: 12 }} /> : <img src={lightbox.src} alt={lightbox.filename} style={{ maxWidth: '92vw', maxHeight: '84vh', borderRadius: 12, objectFit: 'contain' }} />}
                    </div>
                </div>,
                document.body
            )}
            </>,
            document.body
        );
    }

    // ── Desktop layout ─────────────────────────────────────────────────────────
    return ReactDOM.createPortal((
        <>
        <div style={tk.overlay} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
            <div
                style={{
                    backgroundColor: bg,
                    borderRadius: 20,
                    width: expanded ? Math.min(720, window.innerWidth * 0.92) : 340,
                    maxWidth: '95vw',
                    boxShadow: isOled ? '0 0 60px rgba(124,58,237,0.3), 0 30px 80px rgba(0,0,0,0.95)' : (dm ? '0 0 50px rgba(99,102,241,0.25), 0 30px 80px rgba(0,0,0,0.7)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)'),
                    position: 'relative' as const,
                    display: 'flex',
                    overflow: 'hidden',
                    transition: 'width 0.32s cubic-bezier(0.4,0,0.2,1)',
                }}
                className={`user-profile-shell ${closing ? 'modal-exit' : 'modal-enter'}`}
                onClick={e => e.stopPropagation()}
            >
                {/* Profile panel */}
                <div className="user-profile-left" style={{ width: 340, flexShrink: 0, padding: '32px 28px 24px', boxSizing: 'border-box', textAlign: 'center', overflowY: 'auto', maxHeight: '88vh' }}>
                    {/* Close button only when media panel is closed */}
                    {!expanded && (
                        <button onClick={close} style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: dm ? '#9999bb' : '#9ca3af', zIndex: 1 }}>✕</button>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
                        <div onClick={() => avatarUrl && setAvatarLightbox(true)} style={{ width: 96, height: 96, borderRadius: '50%', backgroundColor: avatarUrl ? (dm ? '#1a1a2e' : '#f3f4f6') : (fullUser.avatar_color || '#6366f1'), display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, overflow: 'hidden', boxShadow: `0 4px 20px ${fullUser.avatar_color ? fullUser.avatar_color + '66' : 'rgba(108,71,212,0.4)'}`, cursor: avatarUrl ? 'zoom-in' : 'default' }}>
                            {avatarUrl
                                ? <img src={avatarUrl} alt={fullUser.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                                : <span style={{ color: 'white', fontSize: 40, fontWeight: 700 }}>{fullUser.username[0]?.toUpperCase()}</span>
                            }
                        </div>
                        <h2 style={{ fontSize: 22, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', margin: '0 0 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
                            {fullUser.username}
                            {DEV_TAGS.includes(fullUser.tag || '') && <DevBadge size={20} />}
                            {TESTER_TAGS.includes(fullUser.tag || '') && <TesterBadge size={20} />}
                        </h2>
                        {fullUser.tag && <p style={{ fontSize: 13, color: '#6366f1', margin: '0 0 4px', fontWeight: 600 }}>@{fullUser.tag}</p>}
                        {(isOnline ?? fullUser.is_online)
                            ? <p style={{ fontSize: 13, color: '#22c55e', margin: '0 0 4px', fontWeight: 600 }}>🟢 {t('Online')}</p>
                            : fullUser.last_seen && fullUser.last_seen !== 'hidden'
                                ? <p style={{ fontSize: 13, color: sub, margin: '0 0 4px' }}>{formatLastSeenProfile(fullUser.last_seen)}</p>
                                : fullUser.last_seen === 'hidden'
                                    ? <p style={{ fontSize: 13, color: sub, margin: '0 0 4px' }}>{t('last seen recently')}</p>
                                    : null
                        }
                        {fullUser.status && <p style={{ fontSize: 14, color: sub, margin: 0 }}>{fullUser.status}</p>}
                    </div>

                    <div style={tk.infoCard}>
                        {fullUser.email && (
                            <div style={tk.infoRow}>
                                <span style={{ fontSize: 16, flexShrink: 0 }}>📧</span>
                                <span style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151' }}>{fullUser.email}</span>
                            </div>
                        )}
                        {fullUser.phone && (
                            <div style={tk.infoRow}>
                                <span style={{ fontSize: 16, flexShrink: 0 }}>📱</span>
                                <span style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151' }}>{fullUser.phone}</span>
                            </div>
                        )}
                        {fullUser.birthday && (
                            <div style={tk.infoRow}>
                                <span style={{ fontSize: 16, flexShrink: 0 }}>🎂</span>
                                <span style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151' }}>{formatBirthday(fullUser.birthday)}</span>
                            </div>
                        )}
                        {fullUser.created_at && (
                            <div style={{ ...tk.infoRow, borderBottom: 'none' }}>
                                <span style={{ fontSize: 16, flexShrink: 0 }}>📅</span>
                                <span style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151' }}>
                                    {lang === 'en'
                                        ? `In chat since ${new Date(fullUser.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
                                        : `В чате с ${new Date(fullUser.created_at).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' })}`
                                    }
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Media shortcut buttons */}
                    {hasMedia && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                            {mediaTabs.map(tab => {
                                const isActive = expanded && mediaTab === tab.key;
                                const tabIcons: Record<string, React.ReactNode> = {
                                    images: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
                                    video: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
                                    audio: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
                                    files: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
                                };
                                return (
                                    <button key={tab.key} onClick={() => openMediaTab(tab.key)}
                                        style={{
                                            padding: '12px 8px',
                                            borderRadius: 14,
                                            border: 'none',
                                            boxShadow: isActive
                                                ? `0 0 0 2px #6366f1, 0 4px 16px rgba(99,102,241,0.25)`
                                                : isOled ? '0 2px 12px rgba(0,0,0,0.8)' : dm ? '0 2px 10px rgba(0,0,0,0.35)' : '0 2px 8px rgba(99,102,241,0.07)',
                                            background: isActive
                                                ? dm ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.08)'
                                                : isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff'),
                                            cursor: 'pointer',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                                            transition: 'all 0.18s',
                                            color: isActive ? '#6366f1' : sub,
                                        }}>
                                        {tabIcons[tab.key]}
                                        <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? '#6366f1' : sub }}>{tab.label}</span>
                                        {tab.count > 0 && <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700 }}>{tab.count}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {onStartChat && (
                            <button onClick={onStartChat} style={{ width: '100%', padding: 12, background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                                {isSelf ? `⭐ ${lang === 'en' ? 'Favorites' : 'Избранное'}` : `${t('Start chat')}`}
                            </button>
                        )}
                        {!isSelf && (onClearChat || onExportChat) && (
                            <div style={{ display: 'flex', gap: 7 }}>
                                {onExportChat && (
                                    <button onClick={() => { onExportChat(); onClose(); }} style={{ flex: 1, padding: '9px 6px', background: 'transparent', color: dm ? '#a5b4fc' : '#6366f1', border: `1.5px solid ${dm ? 'rgba(99,102,241,0.25)' : '#e0d9ff'}`, borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                        {lang === 'en' ? 'Export' : 'Экспорт'}
                                    </button>
                                )}
                                {onClearChat && (
                                    <button onClick={() => { onClearChat(); onClose(); }} style={{ flex: 1, padding: '9px 6px', background: 'transparent', color: '#ef4444', border: `1.5px solid rgba(239,68,68,0.3)`, borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                                        {lang === 'en' ? 'Clear' : 'Очистить'}
                                    </button>
                                )}
                            </div>
                        )}
                        {!isSelf && onReport && (
                            <button onClick={() => onReport('user', fullUser.id, fullUser.username)} style={{ width: '100%', padding: 9, background: 'transparent', color: '#ef4444', border: `1.5px solid rgba(239,68,68,0.3)`, borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                                {lang === 'en' ? 'Report' : 'Пожаловаться'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Media panel (animated) */}
                <div className="user-profile-media" style={{
                    width: isMobile ? (expanded ? '100%' : 0) : (expanded ? 380 : 0),
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    transition: isMobile ? 'none' : 'width 0.32s cubic-bezier(0.4,0,0.2,1)',
                    maxHeight: isMobile ? '55svh' : '88vh',
                    minHeight: (isMobile && expanded) ? '40svh' : undefined,
                    background: isOled ? '#000' : dm ? 'rgba(255,255,255,0.02)' : 'rgba(99,102,241,0.02)',
                }}>
                    {/* Tab bar */}
                    <div style={{ display: 'flex', padding: '10px 12px 6px', flexShrink: 0, alignItems: 'center', gap: 4 }}>
                        {mediaTabs.map(tab => {
                            const tabIcons: Record<string, React.ReactNode> = {
                                images: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
                                video: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
                                audio: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
                                files: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
                            };
                            const isActive = mediaTab === tab.key;
                            return (
                                <button key={tab.key} onClick={() => setMediaTab(tab.key)}
                                    style={{
                                        flex: 1, padding: '7px 4px', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700,
                                        background: isActive ? (isOled ? 'rgba(167,139,250,0.15)' : dm ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.1)') : 'transparent',
                                        color: isActive ? (isOled ? '#a78bfa' : '#6366f1') : sub,
                                        borderRadius: 10,
                                        transition: 'all 0.15s',
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                                    }}>
                                    {tabIcons[tab.key]}
                                    {tab.label}
                                    {tab.count > 0 && <span style={{ fontSize: 9, color: isActive ? (isOled ? '#a78bfa' : '#6366f1') : sub }}>({tab.count})</span>}
                                </button>
                            );
                        })}
                        <div style={{ flex: 1 }} />
                        {!isMobile && (
                            <button onClick={() => setExpanded(false)} title={lang === 'en' ? 'Collapse' : 'Свернуть'}
                                style={{ padding: '6px 8px', border: 'none', background: 'none', cursor: 'pointer', color: sub, flexShrink: 0, display: 'flex', alignItems: 'center', borderRadius: 8 }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                            </button>
                        )}
                        <button onClick={close} title={t('Close')}
                            style={{ padding: '6px 8px', border: 'none', background: 'none', cursor: 'pointer', color: sub, flexShrink: 0, display: 'flex', alignItems: 'center', borderRadius: 8 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: (mediaTab === 'images' || mediaTab === 'video') ? 8 : 0 }}>
                        {currentTabData.length === 0 ? (
                            <div style={{ padding: 32, textAlign: 'center', color: sub, fontSize: 13 }}>{t('No files')}</div>
                        ) : (mediaTab === 'images' || mediaTab === 'video') ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                                {currentTabData.map((f, i) => (
                                    <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: dm ? '#252540' : '#f0f0f8' }}
                                        title={f.filename}
                                        onClick={() => setLightbox({ src: f.src, filename: f.filename, isVideo: isVid(f.filename) })}>
                                        {isVid(f.filename)
                                            ? <video src={f.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            : <img src={f.src} alt={f.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        }
                                        {isVid(f.filename) && (
                                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <span style={{ color: 'white', fontSize: 11, marginLeft: 2 }}>▶</span>
                                                </div>
                                            </div>
                                        )}
                                        {onGoToMessage && (
                                            <button onClick={e => { e.stopPropagation(); onGoToMessage(f.messageId); close(); }}
                                                style={{ position: 'absolute', bottom: 3, right: 3, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 5, color: 'white', fontSize: 10, padding: '2px 5px', cursor: 'pointer' }}>
                                                →
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div>
                                {currentTabData.map((f, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)'}` }}>
                                        <div style={{ width: 36, height: 36, borderRadius: 10, background: dm ? '#252540' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: mediaTab === 'audio' ? 16 : 9, fontWeight: 700, color: '#6366f1' }}>
                                            {mediaTab === 'audio' ? '🎵' : (f.filename.split('.').pop()?.toUpperCase() || 'FILE')}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 12, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{f.filename}</div>
                                            {f.fileSize && <div style={{ fontSize: 11, color: sub }}>{formatSize(f.fileSize)}</div>}
                                        </div>
                                        {onGoToMessage && (
                                            <button onClick={() => { onGoToMessage(f.messageId); close(); }}
                                                style={{ width: 28, height: 28, borderRadius: 8, background: dm ? '#252540' : '#f0f0ff', border: 'none', cursor: 'pointer', color: '#6366f1', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={lang === 'en' ? 'Go to message' : 'Перейти к сообщению'}>→</button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* Avatar lightbox */}
        {avatarLightbox && avatarUrl && ReactDOM.createPortal(
            <div className="modal-backdrop-enter" onClick={() => setAvatarLightbox(false)} style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', backdropFilter: 'blur(8px)' }}>
                <img src={avatarUrl} alt={fullUser.username} style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 20, boxShadow: '0 8px 60px rgba(0,0,0,0.7)', objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
                <button onClick={() => setAvatarLightbox(false)} style={{ position: 'fixed', top: 20, right: 20, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white', fontSize: 18, backdropFilter: 'blur(4px)' }}>✕</button>
            </div>,
            document.body
        )}

        {/* Media lightbox */}
        {lightbox && ReactDOM.createPortal(
            <div className="modal-backdrop-enter" onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(rgba(0,0,0,0.6), transparent)' }}
                    onClick={e => e.stopPropagation()}>
                    <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lightbox.filename}</span>
                    <button onClick={() => setLightbox(null)} style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.12)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 18 }}>✕</button>
                </div>
                <div onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '84vh' }}>
                    {lightbox.isVideo
                        ? <video src={lightbox.src} controls autoPlay style={{ maxWidth: '92vw', maxHeight: '84vh', borderRadius: 12 }} />
                        : <img src={lightbox.src} alt={lightbox.filename} style={{ maxWidth: '92vw', maxHeight: '84vh', borderRadius: 12, objectFit: 'contain' }} />
                    }
                </div>
            </div>,
            document.body
        )}
        </>
    ), document.body);
};

const tokens = (dm: boolean, o = false) => ({
    overlay: { position: 'fixed' as const, inset: 0, backgroundColor: o ? 'rgba(0,0,0,0.88)' : (dm ? 'rgba(15,10,40,0.85)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
    infoCard: { backgroundColor: o ? '#050508' : (dm ? '#12122a' : '#f5f3ff'), borderRadius: 14, padding: '12px 16px', marginBottom: 20, textAlign: 'left' as const, boxShadow: o ? '0 2px 16px rgba(0,0,0,0.8)' : dm ? '0 2px 12px rgba(0,0,0,0.35)' : '0 2px 8px rgba(99,102,241,0.06)' },
    infoRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: o ? '1px solid rgba(167,139,250,0.07)' : (dm ? '1px solid rgba(99,102,241,0.08)' : '1px solid rgba(99,102,241,0.06)') },
});

export default UserProfileModal;
