import React, { useState, useRef } from 'react';
import { api } from '../services/api';
import { config } from '../config';
import { useLang } from '../i18n';
import AvatarCropper from './AvatarCropper';

interface CreateChannelModalProps {
    token: string;
    isDark?: boolean;
    onClose: () => void;
    onChannelCreated: () => void;
}

const CreateChannelModal: React.FC<CreateChannelModalProps> = ({ token, isDark = false, onClose, onChannelCreated }) => {
    const dm = isDark;
    const { t } = useLang();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [channelType, setChannelType] = useState<'public' | 'private'>('public');
    const [channelTag, setChannelTag] = useState('');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [closing, setClosing] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setCropSrc(URL.createObjectURL(f));
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setLoading(true);
        setError('');
        try {
            const res = await api.createChannel(token, name.trim(), description, channelType, channelType === 'public' ? channelTag : undefined);
            if (res.success) {
                if (avatarFile && res.channel_id) {
                    await api.updateGroupAvatar(token, res.channel_id, avatarFile);
                }
                onChannelCreated();
                close();
            } else {
                setError(res.detail || t('Save error'));
            }
        } catch (err: any) {
            setError(t('Network error'));
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    // Style tokens
    const isOled = dm && document.body.classList.contains('oled-theme');
    const bg = isOled ? '#000000' : (dm ? '#1a1a2e' : '#ffffff');
    const col = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#7c7caa' : '#6b7280';
    const inputBg = isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff');
    const inputBorder = isOled ? '1.5px solid rgba(167,139,250,0.2)' : (dm ? '1.5px solid rgba(99,102,241,0.25)' : '1.5px solid #ede9fe');
    const cardBg = isOled ? '#050508' : (dm ? '#12122a' : '#fafbff');
    const borderCol = isOled ? 'rgba(167,139,250,0.2)' : (dm ? 'rgba(99,102,241,0.25)' : '#ede9fe');

    const inp: React.CSSProperties = { width: '100%', padding: '11px 14px', border: inputBorder, borderRadius: 12, fontSize: 14, boxSizing: 'border-box', backgroundColor: inputBg, color: col, outline: 'none', fontFamily: 'inherit' };

    return (
        <>
        <div
            style={{ position: 'fixed', inset: 0, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
            className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            onClick={close}
        >
            <div
                style={{ backgroundColor: bg, borderRadius: 24, width: 460, maxWidth: '95vw', maxHeight: '92vh', overflowY: 'auto', padding: 28, boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: `1px solid ${borderCol}` }}
                className={closing ? 'modal-exit' : 'modal-enter'}
                onClick={e => e.stopPropagation()}
            >
                <h3 style={{ margin: '0 0 22px', textAlign: 'center', color: col, fontWeight: 700, fontSize: 18 }}>{t('📢 Create channel')}</h3>

                <form onSubmit={handleSubmit}>
                    {/* Avatar */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
                        <div
                            onClick={() => fileRef.current?.click()}
                            style={{ width: 80, height: 80, borderRadius: '50%', background: avatarPreview ? 'transparent' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', boxShadow: '0 4px 16px rgba(99,102,241,0.3)', position: 'relative' }}
                        >
                            {avatarPreview
                                ? <img src={avatarPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <span style={{ fontSize: 32 }}>📢</span>
                            }
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.15s' }}
                                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                                onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>
                                <span style={{ color: 'white', fontSize: 20 }}>📷</span>
                            </div>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 11, color: subCol }}>{t('Click to add photo')}</div>
                        <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
                    </div>

                    {/* Name */}
                    <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'block', marginBottom: 5 }}>{t('Channel name')}</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('Enter name...')} style={inp} autoFocus required />
                    </div>

                    {/* Description */}
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'block', marginBottom: 5 }}>{t('Description')}</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t('What is this channel about?')} rows={3} style={{ ...inp, resize: 'vertical' }} />
                    </div>

                    {/* Type toggle */}
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'block', marginBottom: 8 }}>{t('Channel type')}</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {(['public', 'private'] as const).map(ct => (
                                <button
                                    key={ct}
                                    type="button"
                                    onClick={() => setChannelType(ct)}
                                    style={{ flex: 1, padding: '10px 0', border: channelType === ct ? '2px solid #6366f1' : `2px solid ${borderCol}`, borderRadius: 12, background: channelType === ct ? (dm ? 'rgba(99,102,241,0.15)' : '#f0efff') : cardBg, color: channelType === ct ? '#6366f1' : subCol, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                                >
                                    {ct === 'public' ? t('🌐 Public') : t('🔒 Private')}
                                </button>
                            ))}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: subCol, lineHeight: 1.5 }}>
                            {channelType === 'public'
                                ? t('Anyone can find and join by tag')
                                : t('Join by invite only')}
                        </div>
                    </div>

                    {/* Public tag */}
                    {channelType === 'public' && (
                        <div style={{ marginBottom: 16 }}>
                            <label style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'block', marginBottom: 5 }}>{t('Public tag')}</label>
                            <div style={{ position: 'relative' }}>
                                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#6366f1', fontWeight: 700, fontSize: 15 }}>@</span>
                                <input
                                    type="text"
                                    value={channelTag}
                                    onChange={e => setChannelTag(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                                    placeholder="channelname"
                                    style={{ ...inp, paddingLeft: 30 }}
                                />
                            </div>
                            <div style={{ marginTop: 4, fontSize: 11, color: subCol }}>
                                {t('Letters, numbers and _ only')}
                            </div>
                        </div>
                    )}

                    {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>{error}</div>}

                    <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                        <button type="button" onClick={close} style={{ flex: 1, padding: '11px 0', background: dm ? '#12122a' : '#f0f2f5', color: dm ? '#9999bb' : '#555', border: dm ? '1.5px solid rgba(99,102,241,0.25)' : '1px solid #ddd', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>
                            {t('Cancel')}
                        </button>
                        <button type="submit" disabled={loading || !name.trim()} style={{ flex: 2, padding: '11px 0', background: (loading || !name.trim()) ? (dm ? '#1e1e3a' : '#e5e7eb') : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: (loading || !name.trim()) ? subCol : 'white', border: 'none', borderRadius: 12, cursor: (loading || !name.trim()) ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, boxShadow: (loading || !name.trim()) ? 'none' : '0 4px 14px rgba(99,102,241,0.35)' }}>
                            {loading ? t('Creating...') : t('📢 Create channel')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
        {cropSrc && <AvatarCropper src={cropSrc} isDark={dm} onApply={handleCropApply} onCancel={handleCropCancel} />}
        </>
    );
};

export default CreateChannelModal;
