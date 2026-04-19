import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../services/api';
import { ThemeSettings } from '../types';
import { config } from '../config';
import EmojiPicker from './EmojiPicker';
import type { StickerPack } from './MediaPicker';
import { setLang as setGlobalLang, useLang } from '../i18n';
import AvatarCropper from './AvatarCropper';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
    <div
        onClick={() => onChange(!value)}
        style={{ width: 48, height: 26, borderRadius: 13, cursor: 'pointer', background: value ? primaryGrad() : '#d1d5db', position: 'relative', transition: 'background 0.2s', flexShrink: 0, boxShadow: value ? '0 2px 8px rgba(99,102,241,0.35)' : 'none' }}
    >
        <div style={{ position: 'absolute', top: 3, left: value ? 25 : 3, width: 20, height: 20, borderRadius: '50%', backgroundColor: 'white', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
    </div>
);

const PRESET_THEMES = [
    { id: 'light', labelKey: 'Light',  bg: '#f8f9ff', accent: '#6366f1', darkMode: false, otherBubble: '#e8e8e8' },
    { id: 'dark',  labelKey: 'Dark',   bg: '#1a1a2e', accent: '#6366f1', darkMode: true,  otherBubble: '#2a2a3d' },
    { id: 'oled',  labelKey: 'OLED',   bg: '#000000', accent: '#a78bfa', darkMode: true,  otherBubble: '#0d0d0d' },
];

const THEME_TO_SETTINGS = (id: string, base: ThemeSettings): ThemeSettings => {
    const th = PRESET_THEMES.find(th => th.id === id);
    if (!th) return base;
    return { ...base, darkMode: th.darkMode, chatBg: th.bg, bubbleOwnColor: th.accent, bubbleOtherColor: th.otherBubble };
};

const QUICK_REACTIONS_DEFAULT = ['👍','❤️','😂','😮','😢','🔥','🎉','👏'];


// ─── Sub-modal wrapper ────────────────────────────────────────────────────────

// Detect OLED theme from body class — avoids threading a prop through every modal
const getIsOled = () => typeof document !== 'undefined' && document.body.classList.contains('oled-theme');

// OLED-aware color helper — OLED uses same colors as dark for modal backgrounds
const dmC = (dm: boolean, dark: string, light: string, oled?: string): string =>
    !dm ? light : (getIsOled() ? (oled ?? dark) : dark);

// Theme-aware primary gradient (violet-purple for OLED, indigo for others)
const GRAD_NORMAL = 'linear-gradient(135deg,#6366f1,#8b5cf6)';
const GRAD_OLED   = 'linear-gradient(135deg,#7c3aed,#a78bfa)';
const primaryGrad = (): string => getIsOled() ? GRAD_OLED : GRAD_NORMAL;

interface SubModalProps { title: string; onBack: () => void; dm: boolean; children: React.ReactNode; }
const SubModal: React.FC<SubModalProps> = ({ title, onBack, dm, children }) => {
    const bg = dmC(dm, '#13131f', 'white', '#000000');
    const borderCol = dmC(dm, '#2a2a3d', '#ede9fe', 'rgba(167,139,250,0.12)');
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const [closing, setClosing] = useState(false);
    const close = () => { setClosing(true); setTimeout(onBack, 180); };
    return ReactDOM.createPortal(
        <div className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} style={{ position: 'fixed', inset: 0, zIndex: 4500, backgroundColor: getIsOled() ? 'rgba(0,0,0,0.85)' : 'rgba(15,10,40,0.55)', backdropFilter: getIsOled() ? 'blur(8px)' : 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={close}>
            <div className={`submodal-panel ${closing ? 'modal-exit' : 'modal-enter'}`} style={{ backgroundColor: bg, borderRadius: 20, width: 480, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(99,102,241,0.2)', border: `1px solid ${borderCol}` }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: `1px solid ${borderCol}`, background: dmC(dm, '#1a1a2e', '#f5f3ff', '#050508') }}>
                    <button onClick={close} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6366f1', padding: 4, lineHeight: 1 }}>←</button>
                    <span style={{ fontSize: 16, fontWeight: 700, color: col }}>{title}</span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 16px' }}>
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
};

// ─── Profile sub-modal ────────────────────────────────────────────────────────

interface ProfileSubProps { token: string; currentUsername: string; currentAvatar?: string; currentStatus?: string; theme: ThemeSettings; onThemeChange: (t: ThemeSettings) => void; onProfileUpdate: (u: string, a?: string, s?: string, tag?: string) => void; onBack: () => void; }
const ProfileSubModal: React.FC<ProfileSubProps> = ({ token, currentUsername, currentAvatar, currentStatus, theme, onThemeChange, onProfileUpdate, onBack }) => {
    const { t } = useLang();
    const dm = theme.darkMode;
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const inputBg = dmC(dm, '#1e1e30', '#f5f3ff', '#050508');
    const inputBorder = !dm ? '1.5px solid #ede9fe' : (getIsOled() ? '1.5px solid rgba(167,139,250,0.2)' : '1.5px solid #3a3a55');

    const [username, setUsername] = useState(currentUsername);
    const [status, setStatus] = useState(currentStatus || '');
    const [tag, setTag] = useState('');
    const [birthday, setBirthday] = useState('');
    const [phone, setPhone] = useState('');
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarColor, setAvatarColor] = useState(theme.avatarColor || '#6366f1');
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        api.getProfile(token).then(res => {
            if (res.success && res.user) {
                const u = res.user;
                setTag(u.tag || '');
                setBirthday(u.birthday || '');
                setPhone(u.phone || '');
                if (u.avatar_color) setAvatarColor(u.avatar_color);
            }
        }).catch(() => {});
    }, [token]);

    const avatarUrl = avatarPreview || (currentAvatar ? config.fileUrl(currentAvatar) : null);
    const initials = (username || currentUsername)[0]?.toUpperCase() || '?';

    const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > 20*1024*1024) { alert(t('File too large (max 5MB)')); return; }
        setCropSrc(URL.createObjectURL(file));
    };

    const handleCropApply = (blob: Blob) => {
        if (cropSrc) URL.revokeObjectURL(cropSrc);
        setCropSrc(null);
        const croppedFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
        setAvatarFile(croppedFile);
        if (avatarPreview) URL.revokeObjectURL(avatarPreview);
        setAvatarPreview(URL.createObjectURL(croppedFile));
    };

    const handleCropCancel = () => {
        if (cropSrc) URL.revokeObjectURL(cropSrc);
        setCropSrc(null);
    };

    const handleRemoveAvatar = async () => {
        setSaving(true); setConfirmRemove(false);
        try {
            await api.removeAvatar(token);
            setAvatarPreview(null); setAvatarFile(null);
            onProfileUpdate(username, undefined, status || undefined);
            setMsg(t('Avatar removed'));
        } catch { setMsg(t('Error')); } finally { setSaving(false); }
    };

    const handleSave = async () => {
        setSaving(true); setMsg('');
        try {
            let newAvatar = currentAvatar;
            if (avatarFile) {
                const r = await api.uploadAvatar(token, avatarFile);
                if (r.success) newAvatar = r.avatar;
                else { setMsg(t('Upload error')); setSaving(false); return; }
            }
            const data: any = { status, avatar_color: avatarColor };
            if (username !== currentUsername) data.username = username;
            if (tag) data.tag = tag;
            if (birthday) data.birthday = birthday;
            if (phone) data.phone = phone;
            const r = await api.updateProfile(token, data);
            if (!r.success) { setMsg(r.detail || t('Error')); setSaving(false); return; }
            onThemeChange({ ...theme, avatarColor });
            onProfileUpdate(username, newAvatar || undefined, status || undefined, tag || undefined);
            setMsg(t('Changes saved'));
            setAvatarFile(null);
            if (avatarPreview) { URL.revokeObjectURL(avatarPreview); setAvatarPreview(null); }
        } catch { setMsg(t('Connection error')); } finally { setSaving(false); }
    };

    const inp: React.CSSProperties = { width: '100%', padding: '11px 14px', border: inputBorder, borderRadius: 12, fontSize: 14, outline: 'none', backgroundColor: inputBg, color: col, boxSizing: 'border-box', fontFamily: 'inherit' };
    const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'block', marginBottom: 6, marginTop: 16 };

    return (
        <SubModal title={t('Profile')} onBack={onBack} dm={dm}>
            {/* Avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', backgroundColor: dmC(dm, '#1a1a2e', '#f5f3ff', '#050508'), borderRadius: 16, marginBottom: 4 }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', backgroundColor: avatarUrl ? 'transparent' : avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.3)', position: 'relative' }} onClick={() => fileRef.current?.click()}>
                    {avatarUrl ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'white', fontSize: 26, fontWeight: 800 }}>{initials}</span>}
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, borderRadius: '50%', opacity: 0, transition: 'opacity 0.2s' }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>📷</div>
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 700, fontSize: 16, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username || currentUsername}</span>
                            {(tag === 'kayano' || tag === 'durov') && <span title={t('developer of Aurora')} style={{ fontSize: 16, cursor: 'default', lineHeight: 1, flexShrink: 0 }}>🔧</span>}
                        </div>
                        {tag && <div style={{ fontSize: 12, color: '#6366f1', fontWeight: 600, marginTop: 2 }}>@{tag}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => fileRef.current?.click()} style={{ flex: 1, padding: '8px', background: primaryGrad(), color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{t('Change photo')}</button>
                        {(avatarUrl || currentAvatar) && !confirmRemove && (
                            <button onClick={() => setConfirmRemove(true)} style={{ flex: 1, padding: '8px', background: !dm ? '#fff0f0' : (getIsOled() ? '#0d0005' : '#2a1a1a'), color: '#ef4444', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{t('Delete')}</button>
                        )}
                    </div>
                    {confirmRemove && (
                        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                            <button onClick={handleRemoveAvatar} disabled={saving} style={{ flex: 1, padding: '8px', background: '#ef4444', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{t('Delete')}</button>
                            <button onClick={() => setConfirmRemove(false)} style={{ flex: 1, padding: '8px', background: inputBg, color: subCol, border: inputBorder, borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>{t('Cancel')}</button>
                        </div>
                    )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarFile} style={{ display: 'none' }} />
            </div>

            <label style={lbl}>{t('Username')}</label>
            <input style={inp} value={username} onChange={e => setUsername(e.target.value)} maxLength={50} placeholder={t('Enter name')} />

            <label style={lbl}>{t('Tag')}</label>
            <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: subCol, fontSize: 14 }}>@</span>
                <input style={{ ...inp, paddingLeft: 28 }} value={tag} onChange={e => setTag(e.target.value.replace(/^@/,'').toLowerCase())} maxLength={30} placeholder={t('your_tag')} />
            </div>

            <label style={lbl}>{t('About yourself')}</label>
            <textarea style={{ ...inp, resize: 'vertical', minHeight: 68 }} value={status} onChange={e => setStatus(e.target.value)} placeholder={t('About yourself') + '...'} maxLength={150} />

            <label style={lbl}>{t('Avatar color') || 'Avatar color'}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {['#6366f1','#8b5cf6','#06b6d4','#22c55e','#f43f5e','#f59e0b','#ec4899','#64748b'].map(c => (
                    <div key={c} onClick={() => setAvatarColor(c)} style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: c, cursor: 'pointer', border: avatarColor === c ? '3px solid white' : '3px solid transparent', boxShadow: avatarColor === c ? `0 0 0 2px ${c}` : 'none', transition: 'all 0.15s' }} />
                ))}
                <input type="color" value={avatarColor} onChange={e => setAvatarColor(e.target.value)} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 2 }} title="Custom color" />
            </div>

            <label style={lbl}>{t('Birthday')}</label>
            <input type="date" style={inp} value={birthday} onChange={e => setBirthday(e.target.value)} />

            <label style={lbl}>{t('Phone')}</label>
            <input
                style={{ ...inp, borderColor: phone && phone.replace(/\D/g, '').length < 11 ? '#ef4444' : undefined }}
                value={phone}
                onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '');
                    let local = digits;
                    if (local.startsWith('8')) local = local.slice(1);
                    else if (local.startsWith('7')) local = local.slice(1);
                    local = local.slice(0, 10);
                    if (!local) { setPhone(''); return; }
                    let fmt = '+7 (';
                    fmt += local.slice(0, Math.min(3, local.length));
                    if (local.length >= 3) fmt += ') ' + local.slice(3, Math.min(6, local.length));
                    if (local.length >= 6) fmt += '-' + local.slice(6, Math.min(8, local.length));
                    if (local.length >= 8) fmt += '-' + local.slice(8, 10);
                    setPhone(fmt);
                }}
                placeholder="+7 (___) ___-__-__"
                maxLength={18}
                inputMode="tel"
            />

            <button onClick={handleSave} disabled={saving} style={{ marginTop: 20, width: '100%', padding: '12px', background: primaryGrad(), color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600, boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}>
                {saving ? `⏳ ${t('Saving...')}` : `💾 ${t('Save')}`}
            </button>
            {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.startsWith('✓') ? '#10b981' : '#ef4444', textAlign: 'center', fontWeight: 600 }}>{msg}</div>}
            {cropSrc && <AvatarCropper src={cropSrc} isDark={dm} onApply={handleCropApply} onCancel={handleCropCancel} />}
        </SubModal>
    );
};

// ─── Blocked users sub-modal ──────────────────────────────────────────────────

interface BlockedUsersSubProps { token: string; theme: ThemeSettings; onBack: () => void; }
const BlockedUsersSubModal: React.FC<BlockedUsersSubProps> = ({ token, theme, onBack }) => {
    const { lang } = useLang();
    const dm = theme.darkMode;
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const cardBg = dmC(dm, '#1a1a2e', '#fafbff', '#050508');
    const borderCol = dmC(dm, '#2a2a3d', '#ede9fe', 'rgba(167,139,250,0.12)');

    const [blocked, setBlocked] = useState<Array<{ id: number; username: string; tag: string; avatar?: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [unlocking, setUnlocking] = useState<number | null>(null);

    useEffect(() => {
        api.getBlockedUsers(token).then(r => {
            if (r.success) setBlocked(r.blocked || []);
        }).catch(() => {}).finally(() => setLoading(false));
    }, [token]);

    const handleUnblock = async (userId: number) => {
        setUnlocking(userId);
        try {
            await api.unblockUser(token, userId);
            setBlocked(prev => prev.filter(u => u.id !== userId));
        } catch {} finally { setUnlocking(null); }
    };

    return (
        <SubModal title={lang === 'en' ? 'Blocked users' : 'Заблокированные'} onBack={onBack} dm={dm}>
            {loading ? (
                <div style={{ textAlign: 'center', padding: 32, color: subCol, fontSize: 14 }}>
                    {lang === 'en' ? 'Loading...' : 'Загрузка...'}
                </div>
            ) : blocked.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: subCol, fontSize: 14 }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>🚫</div>
                    {lang === 'en' ? 'No blocked users' : 'Нет заблокированных пользователей'}
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {blocked.map(u => (
                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, backgroundColor: cardBg, border: `1px solid ${borderCol}` }}>
                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 16, flexShrink: 0, overflow: 'hidden' }}>
                                {u.avatar ? <img src={u.avatar} alt={u.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                {u.tag && <div style={{ fontSize: 12, color: subCol }}>@{u.tag}</div>}
                            </div>
                            <button
                                onClick={() => handleUnblock(u.id)}
                                disabled={unlocking === u.id}
                                style={{ padding: '6px 14px', borderRadius: 8, background: dm ? 'rgba(99,102,241,0.15)' : '#ede9fe', color: '#6366f1', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, flexShrink: 0 }}
                            >
                                {unlocking === u.id ? '...' : (lang === 'en' ? 'Unblock' : 'Разблок.')}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </SubModal>
    );
};

// ─── Privacy sub-modal ────────────────────────────────────────────────────────

interface PrivacySubProps { token: string; theme: ThemeSettings; onBack: () => void; onLogout: () => void; }
const PrivacySubModal: React.FC<PrivacySubProps> = ({ token, theme, onBack, onLogout }) => {
    const { t, lang } = useLang();
    const dm = theme.darkMode;
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const cardBg = dmC(dm, '#1a1a2e', '#fafbff', '#050508');
    const borderCol = dmC(dm, '#2a2a3d', '#ede9fe', 'rgba(167,139,250,0.12)');

    const [showEmail, setShowEmail] = useState(true);
    const [showBirthday, setShowBirthday] = useState(true);
    const [showPhone, setShowPhone] = useState(true);
    const [showStatus, setShowStatus] = useState(true);
    const [showLastSeen, setShowLastSeen] = useState(true);
    const [allowMessages, setAllowMessages] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [showBlocked, setShowBlocked] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        api.getProfile(token).then(res => {
            if (res.success && res.user) {
                try {
                    const p = JSON.parse(res.user.privacy_settings || '{}');
                    setShowEmail(p.show_email !== false);
                    setShowBirthday(p.show_birthday !== false);
                    setShowPhone(p.show_phone !== false);
                    setShowStatus(p.show_status !== false);
                    setShowLastSeen(p.show_last_seen !== false);
                    setAllowMessages(p.allow_messages !== false);
                } catch {}
            }
        }).catch(() => {});
    }, [token]);

    const handleDeleteAccount = async () => {
        setDeleting(true);
        try {
            await api.deleteOwnAccount(token);
            onLogout();
        } catch { setDeleting(false); }
    };

    const handleSave = async () => {
        setSaving(true); setMsg('');
        try {
            const r = await api.updateProfile(token, {
                privacy_settings: JSON.stringify({
                    show_email: showEmail,
                    show_birthday: showBirthday,
                    show_phone: showPhone,
                    show_status: showStatus,
                    show_last_seen: showLastSeen,
                    allow_messages: allowMessages,
                })
            });
            setMsg(r.success ? t('Changes saved') : (r.detail || t('Error')));
        } catch { setMsg(t('Error')); } finally { setSaving(false); }
    };

    const visibilityItems = [
        { label: t('Email'), icon: '📧', value: showEmail, set: setShowEmail },
        { label: t('Birthday'), icon: '🎂', value: showBirthday, set: setShowBirthday },
        { label: t('Phone'), icon: '📱', value: showPhone, set: setShowPhone },
        { label: t('Status'), icon: '💬', value: showStatus, set: setShowStatus },
        { label: t('Last seen'), icon: '🕐', value: showLastSeen, set: setShowLastSeen },
    ];

    if (showBlocked) {
        return <BlockedUsersSubModal token={token} theme={theme} onBack={() => setShowBlocked(false)} />;
    }

    return (
        <SubModal title={t('Privacy')} onBack={onBack} dm={dm}>
            {/* Visibility section */}
            <div style={{ padding: '10px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}`, marginBottom: 8, fontSize: 12, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                {lang === 'en' ? 'What others see' : 'Видимость данных'}
            </div>
            {visibilityItems.map(item => (
                <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 14px', borderRadius: 12, backgroundColor: cardBg, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 20 }}>{item.icon}</span>
                        <span style={{ fontSize: 14, color: col, fontWeight: 500 }}>{item.label}</span>
                    </div>
                    <Toggle value={item.value} onChange={item.set} />
                </div>
            ))}

            {/* Messages section */}
            <div style={{ padding: '10px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}`, marginTop: 8, marginBottom: 8, fontSize: 12, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                {lang === 'en' ? 'Messages' : 'Сообщения'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 14px', borderRadius: 12, backgroundColor: cardBg, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>✉️</span>
                    <div>
                        <div style={{ fontSize: 14, color: col, fontWeight: 500 }}>{lang === 'en' ? 'Accept messages' : 'Принимать сообщения'}</div>
                        <div style={{ fontSize: 11, color: subCol, marginTop: 2 }}>{lang === 'en' ? 'From everyone' : 'От всех пользователей'}</div>
                    </div>
                </div>
                <Toggle value={allowMessages} onChange={setAllowMessages} />
            </div>

            {/* Blocked users */}
            <button
                onClick={() => setShowBlocked(true)}
                style={{ width: '100%', padding: '12px 14px', borderRadius: 12, backgroundColor: cardBg, border: `1px solid ${borderCol}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', color: col, fontSize: 14, fontWeight: 500, marginBottom: 14, textAlign: 'left' as const }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>🚫</span>
                    <span>{lang === 'en' ? 'Blocked users' : 'Заблокированные пользователи'}</span>
                </div>
                <span style={{ color: subCol, fontSize: 16 }}>›</span>
            </button>

            <button onClick={handleSave} disabled={saving} style={{ width: '100%', padding: '12px', background: primaryGrad(), color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600, boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}>
                {saving ? `⏳ ${t('Saving...')}` : `💾 ${t('Save')}`}
            </button>
            {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.startsWith('✓') ? '#10b981' : '#ef4444', textAlign: 'center', fontWeight: 600 }}>{msg}</div>}

            {/* Delete account */}
            <div style={{ marginTop: 20, borderTop: `1px solid ${borderCol}`, paddingTop: 16 }}>
                {!confirmDelete ? (
                    <button onClick={() => setConfirmDelete(true)} style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1.5px solid rgba(239,68,68,0.4)', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                        🗑 {lang === 'en' ? 'Delete account' : 'Удалить аккаунт'}
                    </button>
                ) : (
                    <div style={{ background: cardBg, border: `1.5px solid rgba(239,68,68,0.4)`, borderRadius: 12, padding: '14px' }}>
                        <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 600, marginBottom: 4 }}>
                            {lang === 'en' ? '⚠️ Delete account?' : '⚠️ Удалить аккаунт?'}
                        </div>
                        <div style={{ fontSize: 12, color: subCol, marginBottom: 12 }}>
                            {lang === 'en' ? 'This action is irreversible. All your data will be removed.' : 'Это действие необратимо. Все данные будут удалены.'}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={handleDeleteAccount} disabled={deleting} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#ef4444', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                                {deleting ? '...' : (lang === 'en' ? 'Yes, delete' : 'Да, удалить')}
                            </button>
                            <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${borderCol}`, background: 'none', color: subCol, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                {lang === 'en' ? 'Cancel' : 'Отмена'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </SubModal>
    );
};

// ─── Chat settings sub-modal ──────────────────────────────────────────────────

interface ChatSettingsSubProps { theme: ThemeSettings; onThemeChange: (t: ThemeSettings) => void; onBack: () => void; }
const ChatSettingsSubModal: React.FC<ChatSettingsSubProps> = ({ theme, onThemeChange, onBack }) => {
    const { t } = useLang();
    const dm = theme.darkMode;
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const cardBg = dmC(dm, '#1a1a2e', '#fafbff', '#050508');
    const borderCol = dmC(dm, '#2a2a3d', '#ede9fe', 'rgba(167,139,250,0.12)');
    const inputBg = dmC(dm, '#1e1e30', '#f5f3ff', '#050508');
    const inputBorder = !dm ? '1.5px solid #ede9fe' : (getIsOled() ? '1.5px solid rgba(167,139,250,0.2)' : '1.5px solid #3a3a55');

    const [localTheme, setLocalTheme] = useState({ ...theme });
    const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
    const [noAnimations, setNoAnimations] = useState(() => localStorage.getItem('aurora_no_animations') === '1');
    const [savedMsg, setSavedMsg] = useState('');

    const handleNoAnimations = (val: boolean) => {
        setNoAnimations(val);
        localStorage.setItem('aurora_no_animations', val ? '1' : '0');
        document.documentElement.classList.toggle('no-animations', val);
    };

    const applyThemeSettings = (th: ThemeSettings, id?: string) => { setLocalTheme(th); onThemeChange(th); if (id !== undefined) setSelectedThemeId(id); setSavedMsg(`✓ ${t('Applied')}`); setTimeout(() => setSavedMsg(''), 2000); };

    const THEME_ICONS: Record<string, string> = { light: '☀️', dark: '🌙', oled: '✦' };

    return (
        <SubModal title={t('Chat settings')} onBack={onBack} dm={dm}>
            {/* Animations */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>✨</span>
                    <div>
                        <div style={{ fontSize: 14, color: col, fontWeight: 500 }}>{t('Animations')}</div>
                        <div style={{ fontSize: 12, color: subCol }}>{t('Interface animations')}</div>
                    </div>
                </div>
                <Toggle value={!noAnimations} onChange={v => handleNoAnimations(!v)} />
            </div>

            {/* Font size */}
            <div style={{ padding: '13px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 14, color: col, fontWeight: 600 }}>{t('Font size')}</span>
                    <span style={{ fontSize: 13, color: '#6366f1', fontWeight: 700 }}>{localTheme.fontSize}px</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: subCol, fontWeight: 700 }}>A</span>
                    <input type="range" min={11} max={20} value={localTheme.fontSize} onChange={e => setLocalTheme(t => ({ ...t, fontSize: Number(e.target.value) }))} style={{ flex: 1, accentColor: '#6366f1' }} />
                    <span style={{ fontSize: 18, color: subCol, fontWeight: 700 }}>A</span>
                </div>
            </div>

            {/* Preset themes — 3 cards */}
            <div style={{ padding: '13px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>{t('Theme')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                    {PRESET_THEMES.map(th => {
                        const isActive = selectedThemeId ? selectedThemeId === th.id : localTheme.chatBg === th.bg;
                        const isOled = th.id === 'oled';
                        const isLight = th.id === 'light';
                        return (
                            <button key={th.id} onClick={() => applyThemeSettings(THEME_TO_SETTINGS(th.id, localTheme), th.id)}
                                style={{
                                    backgroundColor: th.bg,
                                    border: isActive ? `2px solid ${th.accent}` : `2px solid ${isOled ? 'rgba(167,139,250,0.15)' : isLight ? '#e0e0f0' : 'rgba(255,255,255,0.07)'}`,
                                    borderRadius: 14,
                                    padding: '14px 8px 10px',
                                    cursor: 'pointer',
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                                    transition: 'all 0.18s',
                                    boxShadow: isActive
                                        ? `0 0 0 2px ${th.accent}50, 0 4px 20px ${th.accent}30`
                                        : isOled ? '0 2px 12px rgba(0,0,0,0.8)' : `0 2px 8px rgba(0,0,0,${isLight ? '0.06' : '0.2'})`,
                                    position: 'relative' as const,
                                    overflow: 'hidden',
                                }}>
                                {/* OLED: decorative shimmer dots */}
                                {isOled && (
                                    <>
                                        <div style={{ position: 'absolute', top: 6, left: 10, width: 2, height: 2, borderRadius: '50%', background: '#a78bfa', opacity: 0.6 }} />
                                        <div style={{ position: 'absolute', top: 12, right: 14, width: 1.5, height: 1.5, borderRadius: '50%', background: '#c4b5fd', opacity: 0.5 }} />
                                        <div style={{ position: 'absolute', top: 20, left: 18, width: 1, height: 1, borderRadius: '50%', background: '#e9d5ff', opacity: 0.4 }} />
                                        <div style={{ position: 'absolute', bottom: 18, right: 10, width: 2, height: 2, borderRadius: '50%', background: '#7c3aed', opacity: 0.5 }} />
                                    </>
                                )}
                                {/* Accent circle / icon */}
                                <div style={{
                                    width: 32, height: 32, borderRadius: '50%',
                                    background: isOled
                                        ? 'linear-gradient(135deg, #7c3aed, #a78bfa, #c4b5fd)'
                                        : th.accent,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 14,
                                    boxShadow: isOled ? '0 0 14px rgba(167,139,250,0.6)' : `0 2px 8px ${th.accent}55`,
                                    flexShrink: 0,
                                }}>
                                    <span style={{ filter: isOled ? 'none' : 'brightness(0) invert(1)', opacity: 0.9, fontSize: isOled ? 13 : 14 }}>{THEME_ICONS[th.id]}</span>
                                </div>
                                <span style={{
                                    fontSize: 12, fontWeight: 700,
                                    color: isLight ? '#4b5563' : isOled ? '#c4b5fd' : 'rgba(255,255,255,0.9)',
                                    letterSpacing: '0.2px',
                                }}>{t(th.labelKey)}</span>
                                {isOled && (
                                    <span style={{ fontSize: 9, color: 'rgba(167,139,250,0.6)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' as const }}>AMOLED</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Bubble colors */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1, padding: '12px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 8 }}>{t('Own bubble color')}</div>
                    <input type="color" value={localTheme.bubbleOwnColor} onChange={e => setLocalTheme(th => ({ ...th, bubbleOwnColor: e.target.value }))} style={{ border: inputBorder, borderRadius: 8, cursor: 'pointer', height: 36, width: '100%', padding: 2 }} />
                </div>
                <div style={{ flex: 1, padding: '12px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 8 }}>{t('Other bubble color')}</div>
                    <input type="color" value={localTheme.bubbleOtherColor} onChange={e => setLocalTheme(th => ({ ...th, bubbleOtherColor: e.target.value }))} style={{ border: inputBorder, borderRadius: 8, cursor: 'pointer', height: 36, width: '100%', padding: 2 }} />
                </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => applyThemeSettings(localTheme)} style={{ flex: 1, padding: '12px', background: primaryGrad(), color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600, boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}>✓ {t('Apply')}</button>
                <button onClick={() => {
                    const preset = selectedThemeId ? PRESET_THEMES.find(th => th.id === selectedThemeId) : null;
                    const def = { ...localTheme, fontSize: 14, bubbleOwnColor: preset ? preset.accent : '#6366f1', bubbleOtherColor: preset ? preset.otherBubble : (dm ? '#2a2a3d' : '#e8e8e8') };
                    setLocalTheme(def); onThemeChange(def);
                }} style={{ padding: '12px 18px', backgroundColor: inputBg, color: subCol, border: inputBorder, borderRadius: 12, cursor: 'pointer', fontSize: 14 }}>{t('Reset')}</button>
            </div>
            {savedMsg && <div style={{ marginTop: 10, fontSize: 13, color: '#10b981', textAlign: 'center', fontWeight: 600 }}>{savedMsg}</div>}
        </SubModal>
    );
};

// ─── Emoji & stickers sub-modal ───────────────────────────────────────────────

const LS_PACKS = 'aurora_sticker_packs';
const stickerUid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const loadPacksS = (): StickerPack[] => { try { return JSON.parse(localStorage.getItem(LS_PACKS) || '[]'); } catch { return []; } };
const savePacksS = (p: StickerPack[]) => localStorage.setItem(LS_PACKS, JSON.stringify(p));

interface EmojiSubProps { theme: ThemeSettings; onBack: () => void; onQuickReactionsChange: (r: string[]) => void; token: string; }
const EmojiSubModal: React.FC<EmojiSubProps> = ({ theme, onBack, onQuickReactionsChange, token }) => {
    const { t } = useLang();
    const dm = theme.darkMode;
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const cardBg = dmC(dm, '#1a1a2e', '#fafbff', '#050508');
    const borderCol = dmC(dm, '#2a2a3d', '#ede9fe', 'rgba(167,139,250,0.12)');
    const inputBg = dmC(dm, '#1e1e30', '#f5f3ff', '#050508');
    const inputBorder = !dm ? '1.5px solid #ede9fe' : (getIsOled() ? '1.5px solid rgba(167,139,250,0.2)' : '1.5px solid #3a3a55');

    // ── Emoji reactions state ──
    const [reactions, setReactions] = useState<string[]>(() => {
        try { return JSON.parse(localStorage.getItem('aurora_quick_reactions') || 'null') || QUICK_REACTIONS_DEFAULT; } catch { return QUICK_REACTIONS_DEFAULT; }
    });
    const [showPicker, setShowPicker] = useState(false);
    const [editPickerIdx, setEditPickerIdx] = useState<number | null>(null);
    const [savedMsg, setSavedMsg] = useState('');

    const saveReactions = (r: string[]) => {
        setReactions(r);
        localStorage.setItem('aurora_quick_reactions', JSON.stringify(r));
        onQuickReactionsChange(r);
        setSavedMsg(t('Changes saved')); setTimeout(() => setSavedMsg(''), 2000);
    };
    const removeReaction = (i: number) => saveReactions(reactions.filter((_, idx) => idx !== i));
    const primaryEmoji = reactions[0] || '👍';

    // ── Sticker packs state ──
    const [packs, setPacks] = useState<StickerPack[]>(loadPacksS);
    const [expandedPackId, setExpandedPackId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [newPackName, setNewPackName] = useState('');
    const [newPackEmoji, setNewPackEmoji] = useState('🎭');
    const [editingPackId, setEditingPackId] = useState<string | null>(null);
    const [editingPackName, setEditingPackName] = useState('');
    const [uploadingFor, setUploadingFor] = useState<string | null>(null);
    const stickerFileRef = useRef<HTMLInputElement>(null);

    const persistPacks = (next: StickerPack[]) => { setPacks(next); savePacksS(next); };

    const createPack = () => {
        if (!newPackName.trim()) return;
        const pack: StickerPack = { id: stickerUid(), name: newPackName.trim(), emoji: newPackEmoji, stickers: [] };
        persistPacks([...packs, pack]);
        setExpandedPackId(pack.id);
        setCreateOpen(false);
        setNewPackName(''); setNewPackEmoji('🎭');
    };

    const deletePack = (id: string) => {
        persistPacks(packs.filter(p => p.id !== id));
        if (expandedPackId === id) setExpandedPackId(null);
    };

    const savePackRename = () => {
        if (!editingPackId || !editingPackName.trim()) return;
        persistPacks(packs.map(p => p.id === editingPackId ? { ...p, name: editingPackName.trim() } : p));
        setEditingPackId(null);
    };

    const deleteSticker = (packId: string, stickerId: string) => {
        persistPacks(packs.map(p => p.id === packId ? { ...p, stickers: p.stickers.filter(s => s.id !== stickerId) } : p));
    };

    const addStickerFile = async (packId: string, file: File) => {
        if (!file.type.startsWith('image/')) return;
        setUploadingFor(packId);
        try {
            const res = await api.uploadFile(token, file);
            if (res.file_path) {
                const fullUrl = config.fileUrl(res.file_path) || res.file_path;
                persistPacks(packs.map(p =>
                    p.id === packId ? { ...p, stickers: [...p.stickers, { id: stickerUid(), url: fullUrl }] } : p
                ));
            }
        } catch {}
        setUploadingFor(null);
    };

    return (
        <SubModal title={t('Emoji & stickers')} onBack={onBack} dm={dm}>
            {/* ── Quick reactions ── */}
            <div style={{ padding: '13px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}`, marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>{t('Quick reactions')}</div>
                <div style={{ fontSize: 12, color: subCol, marginBottom: 12 }}>{t('First emoji is set by double-clicking a message')}</div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                    {reactions.map((r, i) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, position: 'relative' }}>
                            <div onClick={() => { setEditPickerIdx(i); setShowPicker(false); setTimeout(() => setShowPicker(true), 0); }}
                                style={{ fontSize: 28, cursor: 'pointer', padding: '6px 10px', borderRadius: 12, background: inputBg, border: i === 0 ? '2px solid #6366f1' : inputBorder, boxShadow: i === 0 ? '0 0 0 2px rgba(99,102,241,0.25)' : 'none', transition: 'all 0.15s', lineHeight: 1 }}
                                title={i === 0 ? t('Primary reaction') : t('Click emoji to replace · first one set by double-click')}>
                                {r}
                                {i === 0 && <div style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg></div>}
                            </div>
                            <button onClick={() => removeReaction(i)} style={{ fontSize: 10, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
                        </div>
                    ))}
                    {reactions.length < 16 && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <button onClick={() => { setEditPickerIdx(null); setShowPicker(p => !p); }}
                                style={{ fontSize: 22, width: 48, height: 48, borderRadius: 12, background: showPicker && editPickerIdx === null ? primaryGrad() : inputBg, border: inputBorder, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: showPicker && editPickerIdx === null ? 'white' : subCol, fontWeight: 700, transition: 'all 0.15s' }}>+</button>
                            <span style={{ fontSize: 10, color: subCol }}>{t('Add')}</span>
                        </div>
                    )}
                </div>

                {showPicker && ReactDOM.createPortal(
                    <div onClick={() => setShowPicker(false)} style={{ position: 'fixed', inset: 0, zIndex: 5500 }}>
                        <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 5600 }}>
                            <EmojiPicker isDark={dm} onSelect={emoji => {
                                if (editPickerIdx !== null) { const r = [...reactions]; r[editPickerIdx] = emoji; saveReactions(r); }
                                else { if (!reactions.includes(emoji)) saveReactions([...reactions, emoji]); }
                                setShowPicker(false); setEditPickerIdx(null);
                            }} onClose={() => { setShowPicker(false); setEditPickerIdx(null); }} />
                        </div>
                    </div>,
                    document.body
                )}
                <div style={{ fontSize: 12, color: subCol }}>{t('Click emoji to replace · first one set by double-click')}</div>
            </div>

            {/* Primary reaction preview */}
            <div style={{ padding: '13px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}`, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 32 }}>{primaryEmoji}</div>
                <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: col }}>{t('Primary reaction')}</div>
                    <div style={{ fontSize: 12, color: subCol }}>{t('Set by double-clicking a message')}</div>
                </div>
            </div>

            {savedMsg && <div style={{ marginBottom: 12, fontSize: 13, color: '#10b981', textAlign: 'center', fontWeight: 600 }}>{savedMsg}</div>}

            {/* ── Sticker packs ── */}
            <div style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>{t('My sticker packs')}</div>

            {packs.length === 0 && !createOpen && (
                <div style={{ padding: '20px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}`, textAlign: 'center', color: subCol, fontSize: 13, marginBottom: 10 }}>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>🎭</div>
                    {t('No packs yet')}
                </div>
            )}

            {packs.map(pack => (
                <div key={pack.id} style={{ backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}`, marginBottom: 8, overflow: 'hidden' }}>
                    {/* Pack header row */}
                    {editingPackId === pack.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
                            <input value={newPackEmoji} onChange={e => setNewPackEmoji(e.target.value)} style={{ width: 38, textAlign: 'center', fontSize: 20, border: `1.5px solid ${dm ? (getIsOled() ? 'rgba(167,139,250,0.2)' : '#3a3a55') : '#c4b5fd'}`, borderRadius: 8, background: inputBg, color: col, outline: 'none', padding: '4px 2px', fontFamily: 'inherit' }} maxLength={2} />
                            <input autoFocus value={editingPackName} onChange={e => setEditingPackName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') savePackRename(); if (e.key === 'Escape') setEditingPackId(null); }}
                                style={{ flex: 1, padding: '7px 10px', border: `1.5px solid ${dm ? (getIsOled() ? 'rgba(167,139,250,0.2)' : '#3a3a55') : '#c4b5fd'}`, borderRadius: 8, background: inputBg, color: col, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
                            <button onClick={savePackRename} style={{ padding: '7px 12px', background: primaryGrad(), color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}>✓</button>
                            <button onClick={() => setEditingPackId(null)} style={{ padding: '7px 10px', background: 'none', border: `1.5px solid ${borderCol}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, color: subCol, fontFamily: 'inherit' }}>✕</button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}
                            onClick={() => setExpandedPackId(expandedPackId === pack.id ? null : pack.id)}>
                            <span style={{ fontSize: 24, flexShrink: 0 }}>{pack.emoji}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pack.name}</div>
                                <div style={{ fontSize: 11, color: subCol }}>{pack.stickers.length} {t('stickers')}</div>
                            </div>
                            <button onClick={e => { e.stopPropagation(); setEditingPackId(pack.id); setEditingPackName(pack.name); setNewPackEmoji(pack.emoji); }}
                                style={{ background: 'none', border: 'none', fontSize: 15, cursor: 'pointer', color: subCol, padding: '4px 6px', borderRadius: 6, lineHeight: 1 }} title={t('Rename')}>✏️</button>
                            <button onClick={e => { e.stopPropagation(); if (window.confirm(`${t('Delete')} «${pack.name}»?`)) deletePack(pack.id); }}
                                style={{ background: 'none', border: 'none', fontSize: 15, cursor: 'pointer', color: '#ef4444', padding: '4px 6px', borderRadius: 6, lineHeight: 1 }} title={t('Delete')}>🗑️</button>
                            <span style={{ color: subCol, fontSize: 13, transform: expandedPackId === pack.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
                        </div>
                    )}

                    {/* Expanded sticker grid */}
                    {expandedPackId === pack.id && editingPackId !== pack.id && (
                        <div style={{ borderTop: `1px solid ${borderCol}`, padding: 10 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: pack.stickers.length > 0 ? 10 : 0 }}>
                                {pack.stickers.map(s => (
                                    <div key={s.id} style={{ position: 'relative', width: 72, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', flexShrink: 0 }}
                                        title={t('Remove')}>
                                        <img src={s.url} alt="sticker" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4, boxSizing: 'border-box' }} />
                                        <button onClick={() => deleteSticker(pack.id, s.id)}
                                            style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(239,68,68,0.85)', border: 'none', color: 'white', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>✕</button>
                                    </div>
                                ))}
                                {pack.stickers.length === 0 && <div style={{ color: subCol, fontSize: 12, padding: '6px 0' }}>{t('Add first sticker →')}</div>}
                            </div>
                            {/* Add sticker button */}
                            <button
                                onClick={() => { setExpandedPackId(pack.id); stickerFileRef.current?.setAttribute('data-pack', pack.id); stickerFileRef.current?.click(); }}
                                disabled={uploadingFor === pack.id}
                                style={{ width: '100%', padding: '8px 0', background: uploadingFor === pack.id ? dmC(dm, '#2a2a3d', '#e5e7eb', '#0a0a14') : primaryGrad(), color: uploadingFor === pack.id ? subCol : 'white', border: 'none', borderRadius: 8, cursor: uploadingFor === pack.id ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
                                {uploadingFor === pack.id ? `${t('Loading...')}` : `+ ${t('Add sticker')}`}
                            </button>
                        </div>
                    )}
                </div>
            ))}

            {/* Create pack form */}
            {createOpen ? (
                <div style={{ padding: '12px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: col, marginBottom: 10 }}>{t('New pack')}</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        <input value={newPackEmoji} onChange={e => setNewPackEmoji(e.target.value)}
                            style={{ width: 44, textAlign: 'center', fontSize: 22, border: `1.5px solid ${dm ? (getIsOled() ? 'rgba(167,139,250,0.2)' : '#3a3a55') : '#c4b5fd'}`, borderRadius: 10, background: inputBg, color: col, outline: 'none', padding: '6px 4px', fontFamily: 'inherit' }} maxLength={2} placeholder="🎭" />
                        <input autoFocus value={newPackName} onChange={e => setNewPackName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') createPack(); if (e.key === 'Escape') setCreateOpen(false); }}
                            placeholder={t('Pack name')} style={{ flex: 1, padding: '8px 12px', border: `1.5px solid ${dm ? (getIsOled() ? 'rgba(167,139,250,0.2)' : '#3a3a55') : '#c4b5fd'}`, borderRadius: 10, background: inputBg, color: col, fontSize: 13, outline: 'none', fontFamily: 'inherit' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={createPack} style={{ flex: 1, padding: '8px 0', background: primaryGrad(), color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>{t('Create')}</button>
                        <button onClick={() => setCreateOpen(false)} style={{ padding: '8px 16px', background: 'none', border: `1.5px solid ${borderCol}`, borderRadius: 10, cursor: 'pointer', fontSize: 13, color: subCol, fontFamily: 'inherit' }}>{t('Cancel')}</button>
                    </div>
                </div>
            ) : (
                <button onClick={() => setCreateOpen(true)}
                    style={{ width: '100%', padding: '10px 0', background: 'none', border: `2px dashed ${dm ? (getIsOled() ? 'rgba(167,139,250,0.2)' : '#3a3a55') : '#c4b5fd'}`, borderRadius: 12, cursor: 'pointer', fontSize: 13, color: subCol, fontFamily: 'inherit', marginBottom: 4 }}>
                    + {t('Create pack')}
                </button>
            )}

            {/* Hidden file input for sticker upload */}
            <input ref={stickerFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => {
                    const packId = stickerFileRef.current?.getAttribute('data-pack');
                    const file = e.target.files?.[0];
                    if (packId && file) addStickerFile(packId, file);
                    e.target.value = '';
                }} />
        </SubModal>
    );
};

// ─── Language sub-modal ───────────────────────────────────────────────────────

interface LangSubProps { theme: ThemeSettings; onBack: () => void; }
const LanguageSubModal: React.FC<LangSubProps> = ({ theme, onBack }) => {
    const dm = theme.darkMode;
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const cardBg = dmC(dm, '#1a1a2e', '#fafbff', '#050508');
    const borderCol = dmC(dm, '#2a2a3d', '#ede9fe', 'rgba(167,139,250,0.12)');

    const { lang, t } = useLang();

    const LANGS = [
        { id: 'ru', label: 'Русский', native: 'Русский', flag: '🇷🇺' },
        { id: 'en', label: 'English', native: 'English', flag: '🇬🇧' },
    ];

    const selectLang = (id: string) => {
        setGlobalLang(id as 'ru' | 'en');
    };

    return (
        <SubModal title={t('Language')} onBack={onBack} dm={dm}>
            <div style={{ marginBottom: 12, fontSize: 13, color: subCol, lineHeight: 1.6 }}>
                {t('Choose interface language. Full translation coming in next update.')}
            </div>
            {LANGS.map(l => (
                <div key={l.id} onClick={() => selectLang(l.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderRadius: 12, backgroundColor: cardBg, border: lang === l.id ? '1.5px solid #6366f1' : `1px solid ${borderCol}`, marginBottom: 8, cursor: 'pointer', transition: 'all 0.15s', boxShadow: lang === l.id ? '0 0 0 2px rgba(99,102,241,0.15)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 26 }}>{l.flag}</span>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: col }}>{l.label}</div>
                            <div style={{ fontSize: 12, color: subCol }}>{l.native}</div>
                        </div>
                    </div>
                    {lang === l.id && <div style={{ width: 20, height: 20, borderRadius: '50%', background: primaryGrad(), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'white' }}>✓</div>}
                </div>
            ))}
        </SubModal>
    );
};

// ─── About sub-modal ──────────────────────────────────────────────────────────

interface AboutSubProps { theme: ThemeSettings; onBack: () => void; }
const AboutSubModal: React.FC<AboutSubProps> = ({ theme, onBack }) => {
    const dm = theme.darkMode;
    const { t, lang } = useLang();
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const cardBg = dmC(dm, '#1a1a2e', '#fafbff', '#050508');
    const borderCol = dmC(dm, '#2a2a3d', '#ede9fe', 'rgba(167,139,250,0.12)');
    const inputBg = dmC(dm, '#1e1e30', '#f5f3ff', '#050508');
    const inputBorder = !dm ? '1.5px solid #ede9fe' : (getIsOled() ? '1.5px solid rgba(167,139,250,0.2)' : '1.5px solid #3a3a55');
    const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', border: inputBorder, borderRadius: 10, fontSize: 13, outline: 'none', backgroundColor: inputBg, color: col, boxSizing: 'border-box', fontFamily: 'inherit' };

    const [contactName, setContactName] = useState('');
    const [contactEmail, setContactEmail] = useState('');
    const [contactMsg, setContactMsg] = useState('');
    const [sent, setSent] = useState(false);

    const handleSend = () => {
        if (!contactMsg.trim()) return;
        const subject = encodeURIComponent(lang === 'en' ? `Aurora — message${contactName ? ` from ${contactName}` : ''}` : `Aurora — обращение${contactName ? ` от ${contactName}` : ''}`);
        const body = encodeURIComponent(lang === 'en'
            ? `${contactName ? `Name: ${contactName}\n` : ''}${contactEmail ? `Email: ${contactEmail}\n` : ''}\n${contactMsg}`
            : `${contactName ? `Имя: ${contactName}\n` : ''}${contactEmail ? `Email: ${contactEmail}\n` : ''}\n${contactMsg}`);
        window.open(`mailto:bender.rodrigez2016@gmail.com?subject=${subject}&body=${body}`, '_blank');
        setSent(true); setTimeout(() => setSent(false), 4000);
    };

    return (
        <SubModal title={t('About')} onBack={onBack} dm={dm}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                <img src="/logo192.png" alt="Aurora" style={{ width: 80, height: 80, borderRadius: 22, boxShadow: '0 8px 28px rgba(99,102,241,0.3)' }} />
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 32, fontWeight: 900, color: col, letterSpacing: -1 }}>Aurora</div>
                    <div style={{ marginTop: 6, display: 'inline-block', padding: '3px 14px', borderRadius: 20, background: dmC(dm, '#2a2a3d', '#ede9fe', 'rgba(167,139,250,0.1)'), color: '#a78bfa', fontSize: 13, fontWeight: 700, border: dm && getIsOled() ? '1px solid rgba(167,139,250,0.2)' : 'none' }}>beta v0.6</div>
                </div>
                <div style={{ fontSize: 13, color: subCol, textAlign: 'center', lineHeight: 1.6 }}>{lang === 'en' ? 'Modern open-source messenger' : 'Современный мессенджер с открытым исходным кодом'}</div>
                <a href="https://github.com/kayanoooo/aurora" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 14, backgroundColor: cardBg, border: `1px solid ${borderCol}`, textDecoration: 'none', color: col, fontSize: 14, fontWeight: 600, width: '100%', justifyContent: 'center', boxSizing: 'border-box' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill={col}><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.48 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.94 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02.01 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.62-2.81 5.63-5.49 5.93.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/></svg>
                    GitHub — kayanoooo/aurora
                </a>
                <div style={{ width: '100%', padding: '14px', backgroundColor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 14, boxSizing: 'border-box' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: col, marginBottom: 10 }}>✉️ {lang === 'en' ? 'Contact developer' : 'Написать разработчику'}</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder={lang === 'en' ? 'Your name' : 'Ваше имя'} style={{ ...inp, flex: 1 }} />
                        <input value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder={lang === 'en' ? 'Reply email' : 'Email для ответа'} style={{ ...inp, flex: 1 }} />
                    </div>
                    <textarea value={contactMsg} onChange={e => setContactMsg(e.target.value)} placeholder={lang === 'en' ? 'Message, bug report, suggestion...' : 'Сообщение, баг-репорт, предложение...'} rows={3} style={{ ...inp, resize: 'none', marginBottom: 10 }} />
                    <button onClick={handleSend} disabled={!contactMsg.trim()} style={{ width: '100%', padding: '10px 0', background: contactMsg.trim() ? primaryGrad() : dmC(dm, '#2a2a3d', '#e5e7eb', '#0a0a14'), color: contactMsg.trim() ? 'white' : subCol, border: 'none', borderRadius: 10, cursor: contactMsg.trim() ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 600 }}>
                        {sent ? (lang === 'en' ? '✓ Opened in mail client' : '✓ Открыто в почтовом клиенте') : `📨 ${t('Send')}`}
                    </button>
                </div>
                <div style={{ fontSize: 11, color: subCol }}>© 2026 Aurora. MIT License</div>
            </div>
        </SubModal>
    );
};

// ─── Main SettingsModal (drawer panel) ────────────────────────────────────────

interface SettingsModalProps {
    token: string;
    currentUsername: string;
    currentUserTag?: string;
    currentAvatar?: string;
    currentStatus?: string;
    isOnline?: boolean;
    theme: ThemeSettings;
    onThemeChange: (theme: ThemeSettings) => void;
    onProfileUpdate: (username: string, avatar?: string, status?: string, tag?: string) => void;
    onLogout: () => void;
    onOpenFolders: () => void;
    onOpenFavorites: () => void;
    onOpenArchive: () => void;
    onOpenSupport: () => void;
    onOpenAdmin: () => void;
    onClose: () => void;
}

type SubSection = 'profile' | 'privacy' | 'chat' | 'emoji' | 'language' | 'about' | null;

const SettingsModal: React.FC<SettingsModalProps> = ({
    token, currentUsername, currentUserTag, currentAvatar, currentStatus, isOnline,
    theme, onThemeChange, onProfileUpdate, onLogout, onOpenFolders, onOpenFavorites, onOpenArchive, onOpenSupport, onOpenAdmin, onClose
}) => {
    const [activeSub, setActiveSub] = useState<SubSection>(null);
    const [closing, setClosing] = useState(false);

    const { t, lang } = useLang();
    const dm = theme.darkMode;
    const panelBg = dmC(dm, '#13131f', '#ffffff', '#000000');
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const borderCol = dmC(dm, '#2a2a3d', '#eeeeee', 'rgba(167,139,250,0.12)');
    const hoverBg = dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)';
    const avatarColor = theme.avatarColor || '#6366f1';
    const avatarUrl = currentAvatar ? config.fileUrl(currentAvatar) : null;
    const initials = currentUsername[0]?.toUpperCase() || '?';

    const close = useCallback(() => {
        if (activeSub) { setActiveSub(null); return; }
        setClosing(true); setTimeout(onClose, 220);
    }, [activeSub, onClose]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [close]);

    // Apply no-animations on mount
    useEffect(() => {
        const noAnim = localStorage.getItem('aurora_no_animations') === '1';
        document.documentElement.classList.toggle('no-animations', noAnim);
    }, []);

    // Extract first hex color from gradient string for OLED border/glow
    const accentOf = (grad: string) => { const m = grad.match(/#[0-9a-fA-F]{6}/); return m ? m[0] : '#6366f1'; };

    interface MenuItemDef { icon: string; label: string; hint?: string; onClick?: () => void; right?: React.ReactNode; color?: string; }

    const MenuItem: React.FC<MenuItemDef> = ({ icon, label, hint, onClick, right, color = primaryGrad() }) => {
        const [hover, setHover] = useState(false);
        const oled = getIsOled();
        const accent = accentOf(color);
        const iconBg = oled ? '#000000' : color;
        const iconFilter = oled ? 'none' : (dm ? 'brightness(0.72) saturate(0.88)' : 'none');
        const iconBorder = oled ? `1.5px solid ${accent}55` : 'none';
        const iconShadow = oled
            ? `0 0 10px ${accent}33, 0 2px 16px rgba(0,0,0,0.9), inset 0 1px 0 ${accent}22`
            : dm ? '0 2px 10px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.18)';
        return (
            <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '10px 14px', cursor: onClick ? 'pointer' : 'default', borderRadius: 12, margin: '1px 8px', backgroundColor: hover && onClick ? hoverBg : 'transparent', transition: 'background 0.12s' }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, flexShrink: 0, boxShadow: iconShadow, filter: iconFilter, border: iconBorder, transition: 'all 0.15s' }}>{icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: col, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                    {hint && <div style={{ fontSize: 11, color: subCol, marginTop: 1 }}>{hint}</div>}
                </div>
                {right || (onClick ? <span style={{ color: subCol, fontSize: 18, lineHeight: 1 }}>›</span> : null)}
            </div>
        );
    };

    const SectionDivider: React.FC<{ label?: string }> = ({ label }) => (
        <div style={{ margin: label ? '8px 0 4px' : '6px 0', padding: label ? '0 22px' : '0', borderTop: label ? 'none' : `1px solid ${borderCol}` }}>
            {label && <span style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</span>}
        </div>
    );

    return ReactDOM.createPortal(
        <>
            {/* Overlay */}
            <div
                onClick={() => { setClosing(true); setTimeout(onClose, 220); }}
                className={closing ? 'modal-backdrop-exit' : 'settings-overlay-enter'}
                style={{ position: 'fixed', inset: 0, zIndex: 3000, backgroundColor: 'rgba(15,10,40,0.45)', pointerEvents: closing ? 'none' : undefined }}
            />

            {/* Panel */}
            <div style={{
                position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 3100,
                width: 'min(340px, 100vw)', backgroundColor: panelBg,
                boxShadow: '4px 0 32px rgba(0,0,0,0.25)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                transform: closing ? 'translateX(-100%)' : undefined,
                transition: closing ? 'transform 0.22s cubic-bezier(0.4,0,0.2,1)' : undefined,
                borderRight: `1px solid ${borderCol}`,
            }}
                className={`settings-main-panel${closing ? '' : ' settings-panel-enter'}`}
            >
                {/* Header / User profile */}
                <div style={{ background: !dm ? 'linear-gradient(160deg,#5b4fcf 0%,#7c3aed 60%,#6366f1 100%)' : (getIsOled() ? 'linear-gradient(160deg,#0a0014 0%,#150030 60%,#000000 100%)' : 'linear-gradient(160deg,#1e1840 0%,#2d1f6e 60%,#1a1a3e 100%)'), padding: '32px 20px 16px', position: 'relative', overflow: 'hidden' }}>
                    {/* Background decoration */}
                    <div style={{ position: 'absolute', top: -30, right: -30, width: 130, height: 130, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', bottom: -20, left: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />

                    <button onClick={() => { setClosing(true); setTimeout(onClose, 220); }} style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', color: 'rgba(255,255,255,0.85)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>✕</button>

                    {/* Avatar */}
                    <div style={{ position: 'relative', width: 70, height: 70, marginBottom: 14 }}>
                        <div style={{ width: 70, height: 70, borderRadius: '50%', backgroundColor: avatarUrl ? 'transparent' : avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '3px solid rgba(255,255,255,0.35)', boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}>
                            {avatarUrl ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'white', fontSize: 26, fontWeight: 800 }}>{initials}</span>}
                        </div>
                        {isOnline && <div style={{ position: 'absolute', bottom: 2, right: 2, width: 14, height: 14, borderRadius: '50%', backgroundColor: '#4ade80', border: '2px solid rgba(255,255,255,0.9)', boxShadow: '0 0 6px #4ade80' }} />}
                    </div>

                    {/* Name + tag + status */}
                    <div style={{ fontSize: 19, fontWeight: 800, color: 'white', letterSpacing: -0.3, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {currentUsername}
                        {(currentUserTag === 'kayano' || currentUserTag === 'durov') && <span title={t('developer of Aurora')} style={{ fontSize: 17, cursor: 'default', lineHeight: 1 }}>🔧</span>}
                    </div>
                    {currentUserTag && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginBottom: 6 }}>@{currentUserTag}</div>}
                    <div style={{ fontSize: 12, color: isOnline ? '#86efac' : 'rgba(255,255,255,0.45)', fontWeight: 500 }}>{isOnline ? `● ${t('Online')}` : `○ ${t('Offline')}`}</div>

                    {/* Quick actions */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                        <button onClick={() => { setClosing(true); setTimeout(() => { onClose(); onOpenFavorites(); }, 200); }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, cursor: 'pointer', color: 'white', fontSize: 12, fontWeight: 600, backdropFilter: 'blur(4px)' }}>⭐ {t('Favorites')}</button>
                        <button onClick={() => { setClosing(true); setTimeout(() => { onClose(); onOpenArchive(); }, 200); }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, cursor: 'pointer', color: 'white', fontSize: 12, fontWeight: 600, backdropFilter: 'blur(4px)' }}>🗂️ {t('Archive')}</button>
                    </div>
                </div>

                {/* Menu */}
                <div style={{ flex: 1, paddingTop: 10, paddingBottom: 16, overflowY: 'auto' }}>
                    <SectionDivider label={t('Account')} />
                    <MenuItem icon="👤" label={t('Profile')} hint={t('Name, tag, photo, about')} color="linear-gradient(135deg,#f59e0b,#f97316)" onClick={() => setActiveSub('profile')} />
                    <MenuItem icon="🔒" label={t('Privacy')} hint={t('What others see')} color="linear-gradient(135deg,#10b981,#059669)" onClick={() => setActiveSub('privacy')} />

                    <SectionDivider label={t('Appearance')} />
                    <MenuItem icon="🎨" label={t('Chat settings')} hint={t('Themes, wallpapers, animations')} color="linear-gradient(135deg,#3b82f6,#6366f1)" onClick={() => setActiveSub('chat')} />
                    <MenuItem icon="😊" label={t('Emoji & stickers')} hint={t('Quick reactions, packs')} color="linear-gradient(135deg,#ec4899,#f43f5e)" onClick={() => setActiveSub('emoji')} />
                    <MenuItem icon="🌐" label={t('Language')} hint={lang === 'en' ? 'English' : 'Русский'} color="linear-gradient(135deg,#06b6d4,#0891b2)" onClick={() => setActiveSub('language')} />

                    <SectionDivider label={t('Chats')} />
                    <MenuItem icon="📁" label={t('Chat folders')} hint={t('Manage folders')} color="linear-gradient(135deg,#f59e0b,#eab308)" onClick={() => { onClose(); setTimeout(onOpenFolders, 100); }} />

                    <SectionDivider label={lang === 'en' ? 'Help' : 'Помощь'} />
                    <MenuItem icon="🎧" label={lang === 'en' ? 'Support' : 'Поддержка'} hint={lang === 'en' ? 'Chat with support team' : 'Написать в поддержку'} color="linear-gradient(135deg,#06b6d4,#0284c7)" onClick={() => { setClosing(true); setTimeout(() => { onClose(); onOpenSupport(); }, 200); }} />
                    {(currentUserTag === 'kayano' || currentUserTag === 'durov') && (
                        <MenuItem icon="🔑" label={lang === 'en' ? 'Admin panel' : 'Панель администратора'} hint={lang === 'en' ? 'Stats, users, support inbox' : 'Статистика, пользователи, поддержка'} color="linear-gradient(135deg,#ef4444,#dc2626)" onClick={() => { setClosing(true); setTimeout(() => { onClose(); onOpenAdmin(); }, 200); }} />
                    )}

                    <SectionDivider />
                    <MenuItem icon={dm ? '🌙' : '☀️'} label={t('Night mode')} color={dm ? 'linear-gradient(135deg,#4f46e5,#312e81)' : 'linear-gradient(135deg,#f59e0b,#f97316)'} right={<Toggle value={dm} onChange={v => onThemeChange({ ...theme, darkMode: v, chatBg: v ? '#0f0f1a' : '#f8f9ff', bubbleOtherColor: v ? '#2a2a3d' : '#e8e8e8', bubbleOwnColor: '#6366f1' })} />} />
                    <MenuItem icon="ℹ️" label={t('About')} color="linear-gradient(135deg,#8b5cf6,#7c3aed)" onClick={() => setActiveSub('about')} />
                    {config.isElectron() && (
                        <MenuItem icon="🖥️" label="Server" hint="Connection address" color="linear-gradient(135deg,#64748b,#475569)" onClick={() => setActiveSub('about')} />
                    )}

                    {/* Logout */}
                    <div style={{ margin: '12px 16px 0' }}>
                        <button onClick={onLogout} style={{ width: '100%', padding: '12px', backgroundColor: !dm ? '#fff5f5' : (getIsOled() ? '#0d0005' : '#2a1a1a'), color: '#ef4444', border: `1px solid ${!dm ? '#fecaca' : (getIsOled() ? 'rgba(239,68,68,0.2)' : '#5a2020')}`, borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                            🚪 {t('Log out')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Sub-modals */}
            {activeSub === 'profile' && (
                <ProfileSubModal token={token} currentUsername={currentUsername} currentAvatar={currentAvatar} currentStatus={currentStatus} theme={theme} onThemeChange={onThemeChange} onProfileUpdate={onProfileUpdate} onBack={() => setActiveSub(null)} />
            )}
            {activeSub === 'privacy' && (
                <PrivacySubModal token={token} theme={theme} onBack={() => setActiveSub(null)} onLogout={onLogout} />
            )}
            {activeSub === 'chat' && (
                <ChatSettingsSubModal theme={theme} onThemeChange={onThemeChange} onBack={() => setActiveSub(null)} />
            )}
            {activeSub === 'emoji' && (
                <EmojiSubModal theme={theme} onBack={() => setActiveSub(null)} onQuickReactionsChange={r => { localStorage.setItem('aurora_quick_reactions', JSON.stringify(r)); }} token={token} />
            )}
            {activeSub === 'language' && (
                <LanguageSubModal theme={theme} onBack={() => setActiveSub(null)} />
            )}
            {activeSub === 'about' && (
                <AboutSubModal theme={theme} onBack={() => setActiveSub(null)} />
            )}
        </>,
        document.body
    );
};

export default SettingsModal;
