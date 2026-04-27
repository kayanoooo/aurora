import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../services/api';
import { User, Group } from '../types';
import { useLang } from '../i18n';

interface ChatFolder {
    id: number;
    name: string;
    color: string;
    chats: { chat_type: string; chat_id: number }[];
}

interface FolderManagerProps {
    token: string;
    folders: ChatFolder[];
    users: User[];
    groups: Group[];
    isDark: boolean;
    baseUrl: string;
    onClose: () => void;
    onBack?: () => void;
    onFoldersChange: (folders: ChatFolder[]) => void;
}

const COLORS = ['#6366f1','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];

const FolderManager: React.FC<FolderManagerProps> = ({
    token, folders, users, groups, isDark: dm, baseUrl, onClose, onBack, onFoldersChange,
}) => {
    const { t, lang } = useLang();
    const [selectedId, setSelectedId] = useState<number | null>(folders[0]?.id ?? null);
    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState('#6366f1');
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingName, setEditingName] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
    const [closing, setClosing] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 600);
    const [mobileView, setMobileView] = useState<'folders' | 'chats'>('folders');
    const nameRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 600);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const isOled = dm && document.body.classList.contains('oled-theme');

    // Theme — single unified background, OLED = pure black
    const bg        = isOled ? '#000000' : dm ? '#13131f' : '#ffffff';
    const bgLeft    = bg;
    const text      = isOled ? '#e2e0ff' : dm ? '#e2e8f0' : '#1e1b4b';
    const sub       = isOled ? '#4a3a6a' : dm ? '#4a4a7a' : '#9ca3af';
    const accent    = isOled ? '#a78bfa' : '#6366f1';
    const divider   = 'transparent'; // no visible dividers anywhere
    const activeRow = isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.06)';
    const hoverRow  = isOled ? 'rgba(167,139,250,0.04)' : dm ? 'rgba(99,102,241,0.05)' : 'rgba(99,102,241,0.03)';

    const close = () => { setClosing(true); setTimeout(onClose, 180); };
    const selected = folders.find(f => f.id === selectedId) ?? null;

    const selectFolder = (id: number) => {
        setSelectedId(id);
        if (isMobile) setMobileView('chats');
    };

    const createFolder = async () => {
        const name = newName.trim();
        if (!name) return;
        const res = await api.createFolder(token, name, newColor);
        const f = { id: res.id, name: res.name, color: res.color, chats: [] };
        onFoldersChange([...folders, f]);
        setSelectedId(f.id);
        setNewName('');
        if (isMobile) setMobileView('chats');
    };

    const deleteFolder = async (id: number) => {
        await api.deleteFolder(token, id);
        const updated = folders.filter(f => f.id !== id);
        onFoldersChange(updated);
        if (selectedId === id) setSelectedId(updated[0]?.id ?? null);
        setConfirmDeleteId(null);
        if (isMobile) setMobileView('folders');
    };

    const saveEdit = async () => {
        if (!editingId || !editingName.trim()) return;
        const color = folders.find(f => f.id === editingId)?.color ?? '#6366f1';
        await api.updateFolder(token, editingId, editingName.trim(), color);
        onFoldersChange(folders.map(f => f.id === editingId ? { ...f, name: editingName.trim() } : f));
        setEditingId(null);
    };

    const toggleChat = async (chatType: string, chatId: number) => {
        if (!selected) return;
        const inFolder = selected.chats.some(c => c.chat_type === chatType && c.chat_id === chatId);
        if (inFolder) {
            await api.removeChatFromFolder(token, selected.id, chatType, chatId);
            onFoldersChange(folders.map(f => f.id === selected.id
                ? { ...f, chats: f.chats.filter(c => !(c.chat_type === chatType && c.chat_id === chatId)) }
                : f));
        } else {
            await api.addChatToFolder(token, selected.id, chatType, chatId);
            onFoldersChange(folders.map(f => f.id === selected.id
                ? { ...f, chats: [...f.chats, { chat_type: chatType, chat_id: chatId }] }
                : f));
        }
    };

    // ─── Folder list panel ───────────────────────────────────────────────────
    const folderPanel = (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {folders.length === 0 && (
                    <div style={{ fontSize: 13, color: sub, padding: '24px 20px', textAlign: 'center' }}>
                        {t('No folders yet')}
                    </div>
                )}
                {folders.map(f => (
                    <div
                        key={f.id}
                        onClick={() => selectFolder(f.id)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: isMobile ? '12px 16px' : '9px 16px 9px 14px',
                            cursor: 'pointer',
                            background: selectedId === f.id ? activeRow : 'transparent',
                            borderLeft: selectedId === f.id ? `3px solid ${f.color}` : '3px solid transparent',
                            transition: 'all 0.12s',
                        }}
                        onMouseEnter={e => { if (selectedId !== f.id) e.currentTarget.style.background = hoverRow; }}
                        onMouseLeave={e => { e.currentTarget.style.background = selectedId === f.id ? activeRow : 'transparent'; }}
                    >
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: f.color, flexShrink: 0 }} />
                        {editingId === f.id ? (
                            <input
                                ref={nameRef}
                                value={editingName}
                                onChange={e => setEditingName(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                                onClick={e => e.stopPropagation()}
                                style={{ flex: 1, fontSize: 14, padding: '3px 6px', background: isOled ? 'rgba(255,255,255,0.05)' : dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', border: 'none', borderRadius: 6, color: text, outline: 'none' }}
                            />
                        ) : (
                            <span
                                onDoubleClick={() => { setEditingId(f.id); setEditingName(f.name); setTimeout(() => nameRef.current?.focus(), 30); }}
                                style={{ flex: 1, fontSize: isMobile ? 15 : 14, color: selectedId === f.id ? (isOled ? '#c4b5fd' : accent) : text, fontWeight: selectedId === f.id ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                                {f.name}
                            </span>
                        )}
                        {isMobile && <span style={{ fontSize: 11, color: sub }}>{f.chats.length}</span>}
                        <button
                            onClick={e => { e.stopPropagation(); setConfirmDeleteId(f.id); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: sub, padding: '2px 4px', opacity: 0.5, lineHeight: 1, fontSize: 14 }}
                        >✕</button>
                    </div>
                ))}
            </div>

            {/* New folder */}
            <div style={{ padding: '12px 16px' }}>
                <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') createFolder(); }}
                    placeholder={'+ ' + t('New folder')}
                    maxLength={30}
                    style={{ width: '100%', fontSize: 13, padding: isMobile ? '8px 12px' : '7px 10px', background: isOled ? 'rgba(255,255,255,0.04)' : dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', border: 'none', borderRadius: 8, color: text, outline: 'none', boxSizing: 'border-box' }}
                />
                {/* Color picker */}
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    {COLORS.map(c => (
                        <button
                            key={c}
                            onClick={() => setNewColor(c)}
                            style={{
                                width: isMobile ? 28 : 22, height: isMobile ? 28 : 22,
                                minWidth: isMobile ? 28 : 22, minHeight: isMobile ? 28 : 22,
                                borderRadius: '50%', background: c, border: 'none',
                                cursor: 'pointer', padding: 0, flexShrink: 0,
                                outline: newColor === c ? `2px solid ${c}` : 'none',
                                outlineOffset: 2,
                                opacity: newColor === c ? 1 : 0.6,
                                transform: newColor === c ? 'scale(1.2)' : 'scale(1)',
                                transition: 'all 0.12s',
                                boxSizing: 'content-box',
                            }}
                        />
                    ))}
                </div>
                <button
                    onClick={createFolder}
                    disabled={!newName.trim()}
                    style={{
                        marginTop: 10, width: '100%', padding: isMobile ? '10px' : '7px',
                        borderRadius: 8, border: 'none',
                        background: newName.trim() ? newColor : (isOled ? 'rgba(255,255,255,0.04)' : dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
                        color: newName.trim() ? 'white' : sub,
                        cursor: newName.trim() ? 'pointer' : 'default',
                        fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                        opacity: newName.trim() ? 1 : 0.6,
                    }}
                >
                    {t('Create')}
                </button>
            </div>
        </div>
    );

    // ─── Chat list panel ─────────────────────────────────────────────────────
    const chatPanel = selected && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
            {groups.length > 0 && (
                <>
                    <div style={{ fontSize: 10, fontWeight: 700, color: sub, padding: '14px 16px 6px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                        {'Groups'}
                    </div>
                    {groups.map(g => {
                        const inFolder = selected.chats.some(c => c.chat_type === 'group' && c.chat_id === g.id);
                        return (
                            <div
                                key={g.id}
                                onClick={() => toggleChat('group', g.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '11px 16px' : '8px 16px', cursor: 'pointer', background: inFolder ? activeRow : 'transparent', transition: 'background 0.1s' }}
                                onMouseEnter={e => { if (!inFolder) e.currentTarget.style.background = hoverRow; }}
                                onMouseLeave={e => { e.currentTarget.style.background = inFolder ? activeRow : 'transparent'; }}
                            >
                                <div style={{ width: 34, height: 34, borderRadius: '50%', backgroundColor: '#6366f1', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {g.avatar
                                        ? <img src={`${baseUrl}${g.avatar}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>{g.name[0]?.toUpperCase()}</span>}
                                </div>
                                <span style={{ flex: 1, fontSize: isMobile ? 15 : 14, color: text }}>{g.name}</span>
                                {/* Checkmark */}
                                <div style={{ width: 20, height: 20, borderRadius: '50%', background: inFolder ? selected.color : 'transparent', border: `2px solid ${inFolder ? selected.color : (isOled ? 'rgba(167,139,250,0.2)' : dm ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)')}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                                    {inFolder && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                </div>
                            </div>
                        );
                    })}
                </>
            )}
            {users.length > 0 && (
                <>
                    <div style={{ fontSize: 10, fontWeight: 700, color: sub, padding: '14px 16px 6px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                        {'Contacts'}
                    </div>
                    {users.map(u => {
                        const inFolder = selected.chats.some(c => c.chat_type === 'private' && c.chat_id === u.id);
                        return (
                            <div
                                key={u.id}
                                onClick={() => toggleChat('private', u.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '11px 16px' : '8px 16px', cursor: 'pointer', background: inFolder ? activeRow : 'transparent', transition: 'background 0.1s' }}
                                onMouseEnter={e => { if (!inFolder) e.currentTarget.style.background = hoverRow; }}
                                onMouseLeave={e => { e.currentTarget.style.background = inFolder ? activeRow : 'transparent'; }}
                            >
                                <div style={{ width: 34, height: 34, borderRadius: '50%', backgroundColor: u.avatar_color || '#1a73e8', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {u.avatar
                                        ? <img src={`${baseUrl}${u.avatar}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>{u.username[0]?.toUpperCase()}</span>}
                                </div>
                                <span style={{ flex: 1, fontSize: isMobile ? 15 : 14, color: text }}>{u.username}</span>
                                <div style={{ width: 20, height: 20, borderRadius: '50%', background: inFolder ? selected.color : 'transparent', border: `2px solid ${inFolder ? selected.color : (isOled ? 'rgba(167,139,250,0.2)' : dm ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)')}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                                    {inFolder && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                </div>
                            </div>
                        );
                    })}
                </>
            )}
            {groups.length === 0 && users.length === 0 && (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: sub, fontSize: 13 }}>
                    {t('No results found')}
                </div>
            )}
        </div>
    );

    // ─── Modal ───────────────────────────────────────────────────────────────
    return (
        <>
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 3000, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}
            className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            onClick={close}
        >
            <div
                style={{ background: bg, borderRadius: isMobile ? '20px 20px 0 0' : 18, width: isMobile ? '100%' : 560, maxHeight: isMobile ? '92svh' : '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 60px rgba(124,58,237,0.28), 0 30px 80px rgba(0,0,0,0.95)' : dm ? '0 0 50px rgba(99,102,241,0.22), 0 30px 80px rgba(0,0,0,0.65)' : '0 0 40px rgba(99,102,241,0.13), 0 20px 60px rgba(0,0,0,0.12)', paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0 }}
                className={(closing ? 'modal-exit' : 'modal-enter') + (isMobile ? ' mobile-bottom-sheet' : '')}
                onClick={e => e.stopPropagation()}
            >
                {/* Drag handle */}
                {isMobile && <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}><div style={{ width: 36, height: 4, borderRadius: 2, background: dm ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' }} /></div>}

                {/* Header — matches SubModal style */}
                <div style={{ padding: isMobile ? '8px 16px 10px' : '16px 20px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'}` }}>
                    {isMobile && (
                        <button
                            onClick={mobileView === 'chats'
                                ? () => setMobileView('folders')
                                : (onBack ? () => { setClosing(true); setTimeout(onBack, 180); } : close)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: accent, padding: '4px 8px 4px 0', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                        </button>
                    )}
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: isMobile ? 17 : 16, color: text }}>
                            {isMobile && mobileView === 'chats' && selected ? selected.name : t('Chat folders')}
                        </div>
                        {isMobile && mobileView === 'chats' && selected && (
                            <div style={{ fontSize: 12, color: sub, marginTop: 1 }}>
                                {selected.chats.length} {t('chats')}
                            </div>
                        )}
                    </div>
                    {!isMobile && (
                        <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sub, display: 'flex', alignItems: 'center', padding: 4 }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    )}
                </div>

                {/* Body */}
                {isMobile ? (
                    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {mobileView === 'folders' ? folderPanel : chatPanel}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                        {/* Left */}
                        <div style={{ width: 210, display: 'flex', flexDirection: 'column' }}>
                            {folderPanel}
                        </div>
                        {/* Right */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: bg }}>
                            {!selected ? (
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: sub, fontSize: 13 }}>
                                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                                    {t('Chat folders')}
                                </div>
                            ) : (
                                <>
                                    {/* Selected folder info — subtle, no border */}
                                    <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: selected.color, flexShrink: 0 }} />
                                        <span style={{ fontSize: 12, color: sub, flex: 1 }}>{selected.name} · {selected.chats.length} {t('selected')}</span>
                                    </div>
                                    {chatPanel}
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>

        {/* Delete confirm */}
        {confirmDeleteId !== null && ReactDOM.createPortal(
            <div onClick={() => setConfirmDeleteId(null)} className="modal-backdrop-enter"
                style={{ position: 'fixed', inset: 0, zIndex: 4000, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                <div onClick={e => e.stopPropagation()} className="modal-enter"
                    style={{ background: bg, borderRadius: 18, width: '100%', maxWidth: 300, padding: '24px 20px', boxShadow: isOled ? '0 0 40px rgba(124,58,237,0.2), 0 20px 60px rgba(0,0,0,0.95)' : dm ? '0 0 30px rgba(99,102,241,0.2), 0 20px 60px rgba(0,0,0,0.6)' : '0 0 24px rgba(99,102,241,0.1), 0 12px 40px rgba(0,0,0,0.1)', textAlign: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: text, marginBottom: 6 }}>{t('Delete') + ' folder?'}</div>
                    <div style={{ fontSize: 13, color: sub, marginBottom: 20 }}>«{folders.find(f => f.id === confirmDeleteId)?.name}»</div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={() => setConfirmDeleteId(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: isOled ? '#111' : dm ? '#1e1e3a' : '#f5f5f5', color: text, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{t('Cancel')}</button>
                        <button onClick={() => deleteFolder(confirmDeleteId!)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#e53935,#ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{t('Delete')}</button>
                    </div>
                </div>
            </div>,
            document.body
        )}
        </>
    );
};

export default FolderManager;
