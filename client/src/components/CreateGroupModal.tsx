import React, { useState } from 'react';
import { api } from '../services/api';
import { useLang } from '../i18n';
import { useIsMobile } from '../hooks/useMediaQuery';

interface CreateGroupModalProps {
    token: string;
    isDark?: boolean;
    onClose: () => void;
    onGroupCreated: () => void;
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ token, isDark = false, onClose, onGroupCreated }) => {
    const { t } = useLang();
    const dm = isDark;
    const isMobile = useIsMobile();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [closing, setClosing] = useState(false);

    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setLoading(true);
        setError('');
        try {
            const response = await api.createGroup(token, name.trim(), description);
            if (response.success) { onGroupCreated(); close(); }
            else setError('Failed to create group');
        } catch (err) { setError('Network error'); console.error(err); }
        finally { setLoading(false); }
    };

    const isOled = dm && document.body.classList.contains('oled-theme');
    const tk = tokens(dm, isOled, isMobile);

    return (
        <div style={tk.overlay} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
            <div style={tk.modal} className={`${isMobile ? 'mobile-fullscreen ' : ''}${closing ? 'modal-exit' : 'modal-enter'}`} onClick={e => e.stopPropagation()}>
                <h3 style={{ margin: '0 0 20px', textAlign: 'center', color: dm ? '#ffffff' : '#1e1b4b', fontWeight: 700, fontSize: 18 }}>{t('Create group')}</h3>
                <form onSubmit={handleSubmit}>
                    <input type="text" placeholder={t('Group name')} value={name} onChange={e => setName(e.target.value)} style={tk.input} autoFocus={!isMobile} required />
                    <textarea placeholder={t('Description (optional)')} value={description} onChange={e => setDescription(e.target.value)} style={{ ...tk.input, resize: 'vertical' as const, fontFamily: 'inherit' }} rows={3} />
                    {error && <div style={{ color: '#f44336', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>{error}</div>}
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                        <button type="button" onClick={close} style={tk.cancelBtn}>{t('Cancel')}</button>
                        <button type="submit" disabled={loading} style={tk.primaryBtn}>{loading ? t('Creating...') : t('Create')}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const tokens = (dm: boolean, o = false, mobile = false) => ({
    overlay: { position: 'fixed' as const, inset: 0, backgroundColor: o ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.85)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: mobile ? 'stretch' : 'center', justifyContent: 'center', zIndex: 1000 },
    modal: { backgroundColor: o ? '#000000' : (dm ? '#1a1a2e' : '#ffffff'), padding: mobile ? 'max(20px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom))' : 28, borderRadius: mobile ? 0 : 20, width: mobile ? '100%' : 400, maxWidth: mobile ? 'none' : '90%', height: mobile ? '100dvh' : undefined, maxHeight: mobile ? '100dvh' : '90vh', overflowY: 'auto' as const, boxSizing: 'border-box' as const, boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: mobile ? 'none' : o ? '1px solid rgba(167,139,250,0.2)' : (dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe') },
    input: { width: '100%', padding: '11px 16px', marginBottom: 12, border: o ? '1.5px solid rgba(167,139,250,0.2)' : (dm ? '1.5px solid rgba(99,102,241,0.25)' : '1.5px solid #ede9fe'), borderRadius: 12, fontSize: 14, boxSizing: 'border-box' as const, backgroundColor: o ? '#050508' : (dm ? '#12122a' : '#f5f3ff'), color: dm ? '#e0e0f0' : '#1e1b4b', outline: 'none' },
    primaryBtn: { padding: '11px 20px', background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
    cancelBtn: { padding: '11px 20px', backgroundColor: o ? '#0a0a10' : (dm ? '#252538' : '#f0f2f5'), color: dm ? '#9999bb' : '#555', border: o ? '1.5px solid rgba(167,139,250,0.15)' : (dm ? '1.5px solid rgba(99,102,241,0.2)' : '1px solid #ddd'), borderRadius: 12, cursor: 'pointer', fontSize: 14 },
});

export default CreateGroupModal;
