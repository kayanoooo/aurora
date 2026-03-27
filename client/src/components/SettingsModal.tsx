import React, { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';
import { ThemeSettings } from '../types';
import { config } from '../config';

interface SettingsModalProps {
    token: string;
    currentUsername: string;
    currentAvatar?: string;
    currentStatus?: string;
    theme: ThemeSettings;
    onThemeChange: (theme: ThemeSettings) => void;
    onProfileUpdate: (username: string, avatar?: string, status?: string) => void;
    onLogout: () => void;
    onClose: () => void;
}

const BASE_URL = config.BASE_URL;

const SettingsModal: React.FC<SettingsModalProps> = ({
    token, currentUsername, currentAvatar, currentStatus,
    theme, onThemeChange, onProfileUpdate, onLogout, onClose
}) => {
    type Tab = 'account' | 'profile' | 'privacy' | 'appearance' | 'server';
    const [activeTab, setActiveTab] = useState<Tab>('account');
    const [closing, setClosing] = useState(false);
    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const [username, setUsername] = useState(currentUsername);
    const [status, setStatus] = useState(currentStatus || '');
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const [birthday, setBirthday] = useState('');
    const [phone, setPhone] = useState('');
    const [profileLoaded, setProfileLoaded] = useState(false);
    const [confirmRemoveAvatar, setConfirmRemoveAvatar] = useState(false);

    const [privShowBirthday, setPrivShowBirthday] = useState(true);
    const [privShowPhone, setPrivShowPhone] = useState(true);
    const [privShowStatus, setPrivShowStatus] = useState(true);
    const [privShowEmail, setPrivShowEmail] = useState(true);
    const [privShowLastSeen, setPrivShowLastSeen] = useState(true);

    const [localTheme, setLocalTheme] = useState<ThemeSettings>({ ...theme });

    const [serverHost, setServerHost] = useState(() =>
        localStorage.getItem('maxServerHost') || 'localhost'
    );
    const [serverSaved, setServerSaved] = useState(false);
    const handleSaveServer = () => {
        const host = serverHost.trim() || 'localhost';
        setServerHost(host);
        config.setServerHost(host);
        setServerSaved(true);
        setTimeout(() => setServerSaved(false), 2000);
    };

    useEffect(() => {
        if (profileLoaded) return;
        api.getProfile(token).then(res => {
            if (res.success && res.user) {
                const u = res.user;
                setBirthday(u.birthday || '');
                setPhone(u.phone || '');
                if (u.avatar_color) setLocalTheme(t => ({ ...t, avatarColor: u.avatar_color }));
                try {
                    const priv = JSON.parse(u.privacy_settings || '{}');
                    setPrivShowBirthday(priv.show_birthday !== false);
                    setPrivShowPhone(priv.show_phone !== false);
                    setPrivShowStatus(priv.show_status !== false);
                    setPrivShowEmail(priv.show_email !== false);
                    setPrivShowLastSeen(priv.show_last_seen !== false);
                } catch {}
            }
            setProfileLoaded(true);
        }).catch(() => setProfileLoaded(true));
    }, [token, profileLoaded]);

    const hasAvatar = !!(avatarPreview || currentAvatar);
    const avatarUrl = avatarPreview ? avatarPreview : currentAvatar ? `${BASE_URL}${currentAvatar}` : null;
    const initials = (username || currentUsername)[0]?.toUpperCase() || '?';

    const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { alert('Файл больше 5MB'); return; }
        setAvatarFile(file);
        setAvatarPreview(URL.createObjectURL(file));
    };

    const handleRemoveAvatar = async () => {
        setSaving(true); setConfirmRemoveAvatar(false);
        try {
            await api.removeAvatar(token);
            setAvatarPreview(null); setAvatarFile(null);
            onProfileUpdate(username, undefined, status || undefined);
            setSaveMsg('✓ Аватарка удалена');
        } catch { setSaveMsg('Ошибка'); }
        finally { setSaving(false); }
    };

    const handleSaveAccount = async () => {
        setSaving(true); setSaveMsg('');
        try {
            let newAvatar = currentAvatar;
            if (avatarFile) {
                const res = await api.uploadAvatar(token, avatarFile);
                if (res.success) newAvatar = res.avatar;
                else { setSaveMsg('Ошибка загрузки аватарки'); setSaving(false); return; }
            }
            const profileData: any = {};
            if (username !== currentUsername) profileData.username = username;
            profileData.status = status;
            if (localTheme.avatarColor) profileData.avatar_color = localTheme.avatarColor;
            if (Object.keys(profileData).length > 0 || avatarFile) {
                if (Object.keys(profileData).length > 0) {
                    const res = await api.updateProfile(token, profileData);
                    if (!res.success) { setSaveMsg(res.detail || 'Ошибка'); setSaving(false); return; }
                }
                if (localTheme.avatarColor) onThemeChange({ ...theme, avatarColor: localTheme.avatarColor });
                onProfileUpdate(username, newAvatar || undefined, status || undefined);
                setSaveMsg('✓ Сохранено');
                setAvatarFile(null);
                if (avatarPreview) { URL.revokeObjectURL(avatarPreview); setAvatarPreview(null); }
            } else { setSaveMsg('Нет изменений'); }
        } catch { setSaveMsg('Ошибка соединения'); }
        finally { setSaving(false); }
    };

    const handleSaveProfile = async () => {
        setSaving(true); setSaveMsg('');
        try {
            const res = await api.updateProfile(token, { birthday: birthday || undefined, phone: phone || undefined });
            if (res.success) setSaveMsg('✓ Сохранено');
            else setSaveMsg(res.detail || 'Ошибка');
        } catch { setSaveMsg('Ошибка соединения'); }
        finally { setSaving(false); }
    };

    const handleSavePrivacy = async () => {
        setSaving(true); setSaveMsg('');
        try {
            const priv = JSON.stringify({ show_birthday: privShowBirthday, show_phone: privShowPhone, show_status: privShowStatus, show_email: privShowEmail, show_last_seen: privShowLastSeen });
            const res = await api.updateProfile(token, { privacy_settings: priv });
            if (res.success) setSaveMsg('✓ Сохранено');
            else setSaveMsg(res.detail || 'Ошибка');
        } catch { setSaveMsg('Ошибка'); }
        finally { setSaving(false); }
    };

    const handleSaveAppearance = async () => {
        onThemeChange(localTheme);
        try { await api.updateProfile(token, { avatar_color: localTheme.avatarColor }); } catch {}
        setSaveMsg('✓ Применено');
        setTimeout(() => setSaveMsg(''), 2000);
    };

    const resetTheme = () => {
        const def: ThemeSettings = { fontSize: 14, bubbleOwnColor: '#6366f1', bubbleOtherColor: '#e8e8e8', chatBg: '#f8f9ff', darkMode: localTheme.darkMode, avatarColor: '#6366f1' };
        setLocalTheme(def); onThemeChange(def);
    };

    const isBgDark = (hex: string): boolean => {
        try {
            const c = hex.replace('#', '');
            const r = parseInt(c.slice(0, 2), 16) / 255;
            const g = parseInt(c.slice(2, 4), 16) / 255;
            const b = parseInt(c.slice(4, 6), 16) / 255;
            const lum = (x: number) => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            return 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b) < 0.35;
        } catch { return false; }
    };

    const dm = theme.darkMode;
    const bg = dm ? '#13131f' : 'white';
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const inputBg = dm ? '#1e1e30' : '#f5f3ff';
    const inputBorder = dm ? '1.5px solid #3a3a55' : '1.5px solid #ede9fe';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const borderCol = dm ? '#2a2a3d' : '#ede9fe';
    const cardBg = dm ? '#1a1a2e' : '#fafbff';

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '11px 14px', border: inputBorder,
        borderRadius: 12, fontSize: 14, outline: 'none', backgroundColor: inputBg,
        color: col, boxSizing: 'border-box', transition: 'border-color 0.2s',
    };
    const labelStyle: React.CSSProperties = {
        fontSize: 11, fontWeight: 700, color: subCol, marginBottom: 6,
        marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'block',
    };
    const saveBtn: React.CSSProperties = {
        marginTop: 20, padding: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer',
        fontSize: 14, fontWeight: 600, width: '100%', boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
    };

    const TABS: { key: Tab; label: string; icon: string }[] = [
        { key: 'account', label: 'Аккаунт', icon: '👤' },
        { key: 'profile', label: 'Профиль', icon: '📋' },
        { key: 'privacy', label: 'Приватность', icon: '🔒' },
        { key: 'appearance', label: 'Вид', icon: '🎨' },
        ...(config.isElectron() ? [{ key: 'server' as Tab, label: 'Сервер', icon: '🖥️' }] : []),
    ];

    return (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,10,40,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
            <div style={{ backgroundColor: bg, borderRadius: 24, width: 500, maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 30px 80px rgba(99,102,241,0.2)', border: `1px solid ${borderCol}` }} className={closing ? 'modal-exit' : 'modal-enter'} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', padding: '22px 24px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: 'white', letterSpacing: 0.3 }}>Настройки</div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{currentUsername}</div>
                    </div>
                    <button onClick={close} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', width: 34, height: 34, borderRadius: 10, cursor: 'pointer', color: 'white', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', backgroundColor: cardBg, borderBottom: `1px solid ${borderCol}`, padding: '0 12px' }}>
                    {TABS.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => { setActiveTab(tab.key); setSaveMsg(''); }}
                            style={{
                                flex: 1, padding: '12px 4px', background: 'none', border: 'none',
                                borderBottom: activeTab === tab.key ? '2.5px solid #6366f1' : '2.5px solid transparent',
                                cursor: 'pointer', fontSize: 12, color: activeTab === tab.key ? '#6366f1' : subCol,
                                fontWeight: activeTab === tab.key ? 700 : 500, transition: 'all 0.15s',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                            }}
                        >
                            <span style={{ fontSize: 16 }}>{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 8px', display: 'flex', flexDirection: 'column' }}>

                    {/* ACCOUNT */}
                    {activeTab === 'account' && (
                        <>
                            {/* Avatar */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px', backgroundColor: cardBg, borderRadius: 16, border: `1px solid ${borderCol}`, marginBottom: 16 }}>
                                <div
                                    style={{ width: 76, height: 76, borderRadius: '50%', backgroundColor: avatarUrl ? 'transparent' : (localTheme.avatarColor || '#6366f1'), cursor: 'pointer', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', boxShadow: '0 4px 16px rgba(99,102,241,0.35)', flexShrink: 0 }}
                                    onClick={() => fileRef.current?.click()}
                                    onMouseEnter={e => (e.currentTarget.querySelector('[data-ov]') as HTMLElement)?.style.setProperty('opacity', '1')}
                                    onMouseLeave={e => (e.currentTarget.querySelector('[data-ov]') as HTMLElement)?.style.setProperty('opacity', '0')}
                                >
                                    {avatarUrl
                                        ? <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <span style={{ color: 'white', fontSize: 28, fontWeight: 800 }}>{initials}</span>
                                    }
                                    <div data-ov="" style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s', fontSize: 24, borderRadius: '50%' }}>📷</div>
                                </div>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0 }}>
                                    <div style={{ fontSize: 16, fontWeight: 700, color: col }}>{username}</div>
                                    <div style={{ fontSize: 12, color: subCol, marginTop: 2 }}>{status || 'Статус не задан'}</div>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 10, width: '100%' }}>
                                        <button onClick={() => fileRef.current?.click()} style={{ flex: 1, fontSize: 12, color: '#6366f1', background: '#ede9fe', border: 'none', borderRadius: 8, padding: '7px 0', cursor: 'pointer', fontWeight: 600 }}>
                                            Изменить фото
                                        </button>
                                        {hasAvatar && !confirmRemoveAvatar && (
                                            <button onClick={() => setConfirmRemoveAvatar(true)} disabled={saving} style={{ flex: 1, fontSize: 12, color: '#ef4444', background: dm ? '#2a1a1a' : '#fff0f0', border: 'none', borderRadius: 8, padding: '7px 0', cursor: 'pointer', fontWeight: 600 }}>
                                                Удалить
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarFile} style={{ display: 'none' }} />
                            </div>

                            {confirmRemoveAvatar && (
                                <div style={{ marginBottom: 12, padding: '14px', backgroundColor: dm ? '#2a1a1a' : '#fff5f5', border: `1px solid ${dm ? '#5a2020' : '#fecaca'}`, borderRadius: 14 }}>
                                    <div style={{ fontSize: 13, color: dm ? '#fca5a5' : '#dc2626', marginBottom: 10, fontWeight: 600 }}>Удалить аватарку?</div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button onClick={handleRemoveAvatar} disabled={saving} style={{ flex: 1, padding: '8px', background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Удалить</button>
                                        <button onClick={() => setConfirmRemoveAvatar(false)} style={{ flex: 1, padding: '8px', backgroundColor: inputBg, color: subCol, border: inputBorder, borderRadius: 10, cursor: 'pointer', fontSize: 13 }}>Отмена</button>
                                    </div>
                                </div>
                            )}

                            <label style={labelStyle}>Цвет аватарки</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', backgroundColor: cardBg, borderRadius: 12, border: `1px solid ${borderCol}` }}>
                                <div style={{ width: 38, height: 38, borderRadius: '50%', backgroundColor: localTheme.avatarColor || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>{initials}</div>
                                <input type="color" value={localTheme.avatarColor || '#6366f1'} onChange={e => setLocalTheme(t => ({ ...t, avatarColor: e.target.value }))} style={{ padding: 2, border: inputBorder, borderRadius: 8, cursor: 'pointer', height: 36, width: 52 }} />
                                <span style={{ fontSize: 12, color: subCol }}>Видна другим пользователям</span>
                            </div>

                            <label style={labelStyle}>Имя пользователя</label>
                            <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)} maxLength={50} placeholder="Введите имя" />

                            <label style={labelStyle}>Статус</label>
                            <input style={inputStyle} value={status} onChange={e => setStatus(e.target.value)} placeholder="Что у вас нового?" maxLength={150} />

                            <button onClick={handleSaveAccount} disabled={saving} style={saveBtn}>
                                {saving ? '⏳ Сохранение...' : '💾 Сохранить изменения'}
                            </button>
                            {saveMsg && <div style={{ marginTop: 10, fontSize: 13, color: saveMsg.startsWith('✓') ? '#10b981' : '#ef4444', textAlign: 'center', fontWeight: 600 }}>{saveMsg}</div>}
                        </>
                    )}

                    {/* PROFILE */}
                    {activeTab === 'profile' && (
                        <>
                            <div style={{ padding: '14px 16px', backgroundColor: cardBg, borderRadius: 14, border: `1px solid ${borderCol}`, marginBottom: 4 }}>
                                <div style={{ fontSize: 13, color: subCol, lineHeight: 1.5 }}>
                                    Эти данные видны другим пользователям согласно настройкам приватности.
                                </div>
                            </div>

                            <label style={labelStyle}>День рождения</label>
                            <input type="date" style={inputStyle} value={birthday} onChange={e => setBirthday(e.target.value)} />

                            <label style={labelStyle}>Номер телефона</label>
                            <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 (___) ___-__-__" maxLength={30} />

                            <button onClick={handleSaveProfile} disabled={saving} style={saveBtn}>
                                {saving ? '⏳ Сохранение...' : '💾 Сохранить'}
                            </button>
                            {saveMsg && <div style={{ marginTop: 10, fontSize: 13, color: saveMsg.startsWith('✓') ? '#10b981' : '#ef4444', textAlign: 'center', fontWeight: 600 }}>{saveMsg}</div>}
                        </>
                    )}

                    {/* PRIVACY */}
                    {activeTab === 'privacy' && (
                        <>
                            <div style={{ padding: '14px 16px', backgroundColor: cardBg, borderRadius: 14, border: `1px solid ${borderCol}`, marginBottom: 16 }}>
                                <div style={{ fontSize: 13, color: subCol, lineHeight: 1.5 }}>
                                    Выберите, что другие пользователи видят в вашем профиле.
                                </div>
                            </div>
                            {[
                                { label: 'Почта', icon: '📧', value: privShowEmail, set: setPrivShowEmail },
                                { label: 'День рождения', icon: '🎂', value: privShowBirthday, set: setPrivShowBirthday },
                                { label: 'Номер телефона', icon: '📱', value: privShowPhone, set: setPrivShowPhone },
                                { label: 'Статус', icon: '💬', value: privShowStatus, set: setPrivShowStatus },
                                { label: 'Время последнего визита', icon: '🕐', value: privShowLastSeen, set: setPrivShowLastSeen },
                            ].map(item => (
                                <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderRadius: 14, backgroundColor: cardBg, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{ fontSize: 20 }}>{item.icon}</span>
                                        <span style={{ fontSize: 14, color: col, fontWeight: 500 }}>{item.label}</span>
                                    </div>
                                    <Toggle value={item.value} onChange={item.set} />
                                </div>
                            ))}
                            <button onClick={handleSavePrivacy} disabled={saving} style={saveBtn}>
                                {saving ? '⏳ Сохранение...' : '💾 Сохранить'}
                            </button>
                            {saveMsg && <div style={{ marginTop: 10, fontSize: 13, color: saveMsg.startsWith('✓') ? '#10b981' : '#ef4444', textAlign: 'center', fontWeight: 600 }}>{saveMsg}</div>}
                        </>
                    )}

                    {/* APPEARANCE */}
                    {activeTab === 'appearance' && (
                        <>
                            {/* Dark mode */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', backgroundColor: cardBg, borderRadius: 14, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ fontSize: 22 }}>{localTheme.darkMode ? '🌙' : '☀️'}</span>
                                    <div>
                                        <div style={{ fontSize: 14, color: col, fontWeight: 600 }}>Ночной режим</div>
                                        <div style={{ fontSize: 12, color: subCol }}>{localTheme.darkMode ? 'Включён' : 'Выключен'}</div>
                                    </div>
                                </div>
                                <Toggle value={localTheme.darkMode} onChange={val => setLocalTheme(t => ({ ...t, darkMode: val, chatBg: val ? '#0f0f1a' : '#f8f9ff' }))} />
                            </div>

                            {/* Font size */}
                            <div style={{ padding: '14px 16px', backgroundColor: cardBg, borderRadius: 14, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                                    <span style={{ fontSize: 14, color: col, fontWeight: 600 }}>Размер шрифта</span>
                                    <span style={{ fontSize: 13, color: '#6366f1', fontWeight: 700 }}>{localTheme.fontSize}px</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ fontSize: 11, color: subCol, fontWeight: 700 }}>A</span>
                                    <input type="range" min={11} max={20} value={localTheme.fontSize} onChange={e => setLocalTheme(t => ({ ...t, fontSize: Number(e.target.value) }))} style={{ flex: 1, accentColor: '#6366f1' }} />
                                    <span style={{ fontSize: 18, color: subCol, fontWeight: 700 }}>A</span>
                                </div>
                            </div>

                            {/* Preview */}
                            <div style={{ padding: '14px 16px', backgroundColor: cardBg, borderRadius: 14, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>Предпросмотр</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <div style={{ alignSelf: 'flex-end', padding: '9px 14px', borderRadius: '18px 4px 18px 18px', background: `linear-gradient(135deg, ${localTheme.bubbleOwnColor}, #8b5cf6)`, fontSize: localTheme.fontSize, display: 'inline-block', color: 'white', boxShadow: '0 2px 8px rgba(99,102,241,0.25)' }}>
                                        Ваше сообщение ✓
                                    </div>
                                    <div style={{ alignSelf: 'flex-start', padding: '9px 14px', borderRadius: '4px 18px 18px 18px', backgroundColor: localTheme.bubbleOtherColor, fontSize: localTheme.fontSize, display: 'inline-block', color: isBgDark(localTheme.bubbleOtherColor) ? '#e2e8f0' : '#1e1b4b', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: isBgDark(localTheme.bubbleOtherColor) ? '#c4b5fd' : '#6366f1', marginBottom: 3 }}>Собеседник</div>
                                        Чужое сообщение
                                    </div>
                                </div>
                            </div>

                            {/* Colors */}
                            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                                <div style={{ flex: 1, padding: '12px 14px', backgroundColor: cardBg, borderRadius: 14, border: `1px solid ${borderCol}` }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>Мои сообщения</div>
                                    <input type="color" value={localTheme.bubbleOwnColor} onChange={e => setLocalTheme(t => ({ ...t, bubbleOwnColor: e.target.value }))} style={{ border: inputBorder, borderRadius: 8, cursor: 'pointer', height: 38, width: '100%', padding: 2 }} />
                                </div>
                                <div style={{ flex: 1, padding: '12px 14px', backgroundColor: cardBg, borderRadius: 14, border: `1px solid ${borderCol}` }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>Чужие сообщения</div>
                                    <input type="color" value={localTheme.bubbleOtherColor} onChange={e => setLocalTheme(t => ({ ...t, bubbleOtherColor: e.target.value }))} style={{ border: inputBorder, borderRadius: 8, cursor: 'pointer', height: 38, width: '100%', padding: 2 }} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                                <button onClick={handleSaveAppearance} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600, boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}>
                                    ✓ Применить
                                </button>
                                <button onClick={resetTheme} style={{ padding: '12px 20px', backgroundColor: inputBg, color: subCol, border: inputBorder, borderRadius: 12, cursor: 'pointer', fontSize: 14 }}>
                                    Сбросить
                                </button>
                            </div>
                            {saveMsg && <div style={{ marginTop: 10, fontSize: 13, color: '#10b981', textAlign: 'center', fontWeight: 600 }}>{saveMsg}</div>}
                        </>
                    )}
                    {/* SERVER (Electron only) */}
                    {activeTab === 'server' && (
                        <>
                            <div style={{ padding: '14px 16px', backgroundColor: cardBg, borderRadius: 14, border: `1px solid ${borderCol}`, marginBottom: 8 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12 }}>Адрес сервера</div>
                                <div style={{ fontSize: 13, color: subCol, marginBottom: 10 }}>
                                    Введите IP-адрес или домен сервера MAX Messenger.
                                </div>
                                <input
                                    value={serverHost}
                                    onChange={e => setServerHost(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSaveServer()}
                                    placeholder="localhost"
                                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: inputBorder, background: inputBg, color: col, fontSize: 14, boxSizing: 'border-box' }}
                                />
                                <div style={{ marginTop: 6, fontSize: 12, color: subCol }}>
                                    Текущий: <b style={{ color: '#6366f1' }}>http://{serverHost}:8000</b>
                                </div>
                            </div>
                            <button onClick={handleSaveServer} style={saveBtn}>
                                ✓ Сохранить и переподключиться
                            </button>
                            {serverSaved && <div style={{ marginTop: 10, fontSize: 13, color: '#10b981', textAlign: 'center', fontWeight: 600 }}>✓ Сохранено — переподключение...</div>}
                        </>
                    )}
                </div>

                {/* Logout */}
                <div style={{ padding: '14px 24px', borderTop: `1px solid ${borderCol}` }}>
                    <button onClick={onLogout} style={{ width: '100%', padding: '12px', backgroundColor: dm ? '#2a1a1a' : '#fff5f5', color: '#ef4444', border: `1px solid ${dm ? '#5a2020' : '#fecaca'}`, borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                        🚪 Выйти из аккаунта
                    </button>
                </div>
            </div>
        </div>
    );
};

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
    <div
        onClick={() => onChange(!value)}
        style={{ width: 48, height: 26, borderRadius: 13, cursor: 'pointer', background: value ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#d1d5db', position: 'relative', transition: 'background 0.2s', flexShrink: 0, boxShadow: value ? '0 2px 8px rgba(99,102,241,0.35)' : 'none' }}
    >
        <div style={{ position: 'absolute', top: 3, left: value ? 25 : 3, width: 20, height: 20, borderRadius: '50%', backgroundColor: 'white', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
    </div>
);

export default SettingsModal;
