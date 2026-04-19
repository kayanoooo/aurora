import React, { useEffect, useState, useMemo, useCallback } from 'react';
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
    onClose: () => void;
    onStartChat?: () => void;
    onGoToMessage?: (id: number) => void;
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({
    user, token, isDark = false, messages = [], isOnline, isSelf = false, onClose, onStartChat, onGoToMessage
}) => {
    const dm = isDark;
    const { t, lang } = useLang();
    const [fullUser, setFullUser] = useState<User>(user);
    const [closing, setClosing] = useState(false);
    const [avatarLightbox, setAvatarLightbox] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    const [mediaTab, setMediaTab] = useState<'images' | 'video' | 'audio' | 'files'>('images');
    const [lightbox, setLightbox] = useState<{ src: string; filename: string; isVideo: boolean } | null>(null);
    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    useEffect(() => {
        api.findUser(token, user.username).then(res => {
            if (res.user) setFullUser(res.user);
        }).catch(() => {});
    }, [token, user.username]);

    const avatarUrl = config.fileUrl(fullUser.avatar);

    // Parse media from messages
    const { imgs, vids, auds, files } = useMemo(() => {
        const i: any[] = [], v: any[] = [], a: any[] = [], f: any[] = [];
        const add = (fp: string, fn: string, fs: number | undefined, mid: number) => {
            const src = fp.startsWith('http') ? fp : `${BASE_URL}${fp}`;
            const item = { src, filename: fn, fileSize: fs, messageId: mid };
            if (isImg(fn)) i.push(item);
            else if (isVid(fn)) v.push(item);
            else if (isAud(fn)) a.push(item);
            else f.push(item);
        };
        for (const msg of messages) {
            if (msg.file_path && msg.filename) add(msg.file_path, msg.filename, msg.file_size, msg.id);
            if (msg.files) {
                const arr = typeof msg.files === 'string' ? (() => { try { return JSON.parse(msg.files); } catch { return []; } })() : msg.files;
                if (Array.isArray(arr)) arr.forEach((fi: any) => fi.file_path && fi.filename && add(fi.file_path, fi.filename, fi.file_size, msg.id));
            }
        }
        return { imgs: i.reverse(), vids: v.reverse(), auds: a.reverse(), files: f.reverse() };
    }, [messages]);

    const mediaTabs = [
        { key: 'images' as const, icon: '🖼', label: t('Photo'), count: imgs.length },
        { key: 'video' as const, icon: '🎬', label: t('Video'), count: vids.length },
        { key: 'audio' as const, icon: '🎵', label: t('Audio'), count: auds.length },
        { key: 'files' as const, icon: '📄', label: t('Files'), count: files.length },
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
    const sub = dm ? '#6060a0' : '#9ca3af';

    const currentTabData = mediaTab === 'images' ? imgs : mediaTab === 'video' ? vids : mediaTab === 'audio' ? auds : files;

    return (
        <>
        <div style={tk.overlay} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
            <div
                style={{
                    backgroundColor: bg,
                    borderRadius: isMobile ? 20 : 20,
                    width: isMobile ? '95vw' : (expanded ? Math.min(720, window.innerWidth * 0.92) : 340),
                    maxWidth: '95vw',
                    boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)',
                    border: `1px solid ${border}`,
                    position: 'relative' as const,
                    display: 'flex',
                    overflow: 'hidden',
                    transition: 'width 0.32s cubic-bezier(0.4,0,0.2,1)',
                }}
                className={`user-profile-shell ${closing ? 'modal-exit' : 'modal-enter'}`}
                onClick={e => e.stopPropagation()}
            >
                {/* Profile panel */}
                <div className="user-profile-left" style={{ width: 340, flexShrink: 0, padding: isMobile ? '24px 20px 16px' : '32px 28px 24px', boxSizing: 'border-box', textAlign: 'center', overflowY: 'auto', maxHeight: isMobile ? (expanded ? '45svh' : '88svh') : '88vh' }}>
                    {/* Close button only when media panel is closed */}
                    {!expanded && (
                        <button onClick={close} style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: dm ? '#9999bb' : '#9ca3af', zIndex: 1 }}>✕</button>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
                        <div onClick={() => avatarUrl && setAvatarLightbox(true)} style={{ width: 96, height: 96, borderRadius: '50%', backgroundColor: avatarUrl ? (dm ? '#1a1a2e' : '#f3f4f6') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, overflow: 'hidden', boxShadow: '0 4px 20px rgba(108,71,212,0.4)', cursor: avatarUrl ? 'zoom-in' : 'default' }}>
                            {avatarUrl
                                ? <img src={avatarUrl} alt={fullUser.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                                : <span style={{ color: 'white', fontSize: 40, fontWeight: 700 }}>{fullUser.username[0]?.toUpperCase()}</span>
                            }
                        </div>
                        <h2 style={{ fontSize: 22, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', margin: '0 0 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
                            {fullUser.username}
                            {(fullUser.tag === 'kayano' || fullUser.tag === 'durov') && <span title={t('developer of Aurora')} style={{ fontSize: 18, cursor: 'default' }}>🔧</span>}
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
                            {mediaTabs.map(tab => (
                                <button key={tab.key} onClick={() => openMediaTab(tab.key)}
                                    style={{
                                        padding: '10px 8px',
                                        borderRadius: 12,
                                        border: `1px solid ${expanded && mediaTab === tab.key ? '#6366f1' : border}`,
                                        background: expanded && mediaTab === tab.key
                                            ? dm ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.08)'
                                            : dm ? '#12122a' : '#f5f3ff',
                                        cursor: 'pointer',
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                                        transition: 'all 0.18s',
                                    }}>
                                    <span style={{ fontSize: 18 }}>{tab.icon}</span>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: expanded && mediaTab === tab.key ? '#6366f1' : sub }}>{tab.label}</span>
                                    {tab.count > 0 && <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700 }}>{tab.count}</span>}
                                </button>
                            ))}
                        </div>
                    )}

                    {onStartChat && (
                        <button onClick={onStartChat} style={{ width: '100%', padding: 12, background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                            {isSelf ? `⭐ ${lang === 'en' ? 'Favorites' : 'Избранное'}` : `💬 ${t('Start chat')}`}
                        </button>
                    )}
                </div>

                {/* Media panel (animated) */}
                <div className="user-profile-media" style={{
                    width: isMobile ? (expanded ? '100%' : 0) : (expanded ? 380 : 0),
                    flexShrink: 0,
                    borderLeft: (!isMobile && expanded) ? `1px solid ${border}` : 'none',
                    borderTop: (isMobile && expanded) ? `1px solid ${border}` : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    transition: isMobile ? 'none' : 'width 0.32s cubic-bezier(0.4,0,0.2,1)',
                    maxHeight: isMobile ? '55svh' : '88vh',
                    minHeight: (isMobile && expanded) ? '40svh' : undefined,
                }}>
                    {/* Tab bar */}
                    <div style={{ display: 'flex', borderBottom: `1px solid ${border}`, flexShrink: 0, alignItems: 'stretch' }}>
                        {mediaTabs.map(tab => (
                            <button key={tab.key} onClick={() => setMediaTab(tab.key)}
                                style={{
                                    flex: 1, padding: '12px 4px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                                    background: 'none',
                                    color: mediaTab === tab.key ? '#6366f1' : sub,
                                    borderBottom: mediaTab === tab.key ? '2px solid #6366f1' : '2px solid transparent',
                                    transition: 'all 0.15s',
                                }}>
                                {tab.icon}<br />{tab.label}
                                {tab.count > 0 && <span style={{ marginLeft: 3, fontSize: 10, color: '#6366f1' }}>({tab.count})</span>}
                            </button>
                        ))}
                        {!isMobile && (
                            <button onClick={() => setExpanded(false)} title={lang === 'en' ? 'Collapse' : 'Свернуть'}
                                style={{ padding: '0 10px', border: 'none', background: 'none', cursor: 'pointer', color: sub, fontSize: 16, borderBottom: '2px solid transparent', flexShrink: 0 }}>‹</button>
                        )}
                        <button onClick={close} title={t('Close')}
                            style={{ padding: '0 10px', border: 'none', background: 'none', cursor: 'pointer', color: sub, fontSize: 18, borderBottom: '2px solid transparent', flexShrink: 0, borderLeft: `1px solid ${border}` }}>✕</button>
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
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${border}` }}>
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
    );
};

const tokens = (dm: boolean, o = false) => ({
    overlay: { position: 'fixed' as const, inset: 0, backgroundColor: o ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.85)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
    infoCard: { backgroundColor: o ? '#050508' : (dm ? '#12122a' : '#f5f3ff'), borderRadius: 12, padding: '12px 16px', marginBottom: 20, textAlign: 'left' as const, border: o ? '1px solid rgba(167,139,250,0.12)' : (dm ? '1px solid rgba(99,102,241,0.15)' : '1px solid #ede9fe') },
    infoRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: dm ? '1px solid rgba(99,102,241,0.1)' : '1px solid #ede9fe' },
});

export default UserProfileModal;
