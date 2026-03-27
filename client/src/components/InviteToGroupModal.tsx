import React, { useState } from 'react';
import { api } from '../services/api';

interface InviteToGroupModalProps {
    token: string;
    groupId: number;
    groupName: string;
    isDark?: boolean;
    onClose: () => void;
    onInvited: () => void;
}

const InviteToGroupModal: React.FC<InviteToGroupModalProps> = ({ token, groupId, groupName, isDark = false, onClose, onInvited }) => {
    const dm = isDark;
    const [username, setUsername] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [closing, setClosing] = useState(false);

    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username.trim()) return;
        setLoading(true); setError(''); setSuccess('');
        try {
            const response = await api.inviteToGroup(token, groupId, username.trim());
            if (response.success) {
                setSuccess(`Пользователь ${username} добавлен в группу`);
                setUsername('');
                setTimeout(() => { onInvited(); close(); }, 1500);
            } else setError(response.message || 'Failed to invite user');
        } catch (err) { setError('Network error'); console.error(err); }
        finally { setLoading(false); }
    };

    const t = tokens(dm);

    return (
        <div style={t.overlay} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
            <div style={t.modal} className={closing ? 'modal-exit' : 'modal-enter'} onClick={e => e.stopPropagation()}>
                <h3 style={{ margin: '0 0 8px', textAlign: 'center', color: dm ? '#ffffff' : '#1e1b4b', fontWeight: 700, fontSize: 18 }}>Пригласить в группу</h3>
                <p style={{ textAlign: 'center', marginBottom: 20, fontSize: 14, color: dm ? '#9999bb' : '#6b7280' }}>
                    Группа: <strong style={{ color: dm ? '#c4b5fd' : '#6366f1' }}>{groupName}</strong>
                </p>
                <form onSubmit={handleSubmit}>
                    <input type="text" placeholder="Имя пользователя" value={username} onChange={e => setUsername(e.target.value)} style={t.input} autoFocus required />
                    {error && <div style={{ color: '#f44336', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>{error}</div>}
                    {success && <div style={{ color: '#4caf50', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>{success}</div>}
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                        <button type="button" onClick={close} style={t.cancelBtn}>Отмена</button>
                        <button type="submit" disabled={loading} style={t.primaryBtn}>{loading ? 'Приглашение...' : 'Пригласить'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const tokens = (dm: boolean) => ({
    overlay: { position: 'fixed' as const, inset: 0, backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    modal: { backgroundColor: dm ? '#13132a' : '#ffffff', padding: 28, borderRadius: 20, width: 400, maxWidth: '90%', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe' },
    input: { width: '100%', padding: '11px 16px', marginBottom: 12, border: dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', borderRadius: 12, fontSize: 14, boxSizing: 'border-box' as const, backgroundColor: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#e0e0f0' : '#1e1b4b', outline: 'none' },
    primaryBtn: { padding: '11px 20px', background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
    cancelBtn: { padding: '11px 20px', backgroundColor: dm ? '#252538' : '#f0f2f5', color: dm ? '#9999bb' : '#555', border: dm ? '1.5px solid #3a3a5e' : '1px solid #ddd', borderRadius: 12, cursor: 'pointer', fontSize: 14 },
});

export default InviteToGroupModal;
