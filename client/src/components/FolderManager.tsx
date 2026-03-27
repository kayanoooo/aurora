import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../services/api';
import { User, Group } from '../types';

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
    onFoldersChange: (folders: ChatFolder[]) => void;
}

const FOLDER_COLORS = ['#6366f1','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];

const FolderManager: React.FC<FolderManagerProps> = ({
    token, folders, users, groups, isDark: dm, baseUrl, onClose, onFoldersChange,
}) => {
    const [selectedFolderId, setSelectedFolderId] = useState<number | null>(folders[0]?.id ?? null);
    const [newFolderName, setNewFolderName] = useState('');
    const [newFolderColor, setNewFolderColor] = useState('#6366f1');
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingName, setEditingName] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
    const [closing, setClosing] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);

    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const selectedFolder = folders.find(f => f.id === selectedFolderId) ?? null;

    const createFolder = async () => {
        const name = newFolderName.trim();
        if (!name) return;
        const res = await api.createFolder(token, name, newFolderColor);
        const newFolder = { id: res.id, name: res.name, color: res.color, chats: [] };
        onFoldersChange([...folders, newFolder]);
        setSelectedFolderId(newFolder.id);
        setNewFolderName('');
    };

    const deleteFolder = async (folderId: number) => {
        await api.deleteFolder(token, folderId);
        const updated = folders.filter(f => f.id !== folderId);
        onFoldersChange(updated);
        if (selectedFolderId === folderId) setSelectedFolderId(updated[0]?.id ?? null);
        setConfirmDeleteId(null);
    };

    const startEdit = (f: ChatFolder) => {
        setEditingId(f.id);
        setEditingName(f.name);
        setTimeout(() => nameRef.current?.focus(), 50);
    };

    const saveEdit = async () => {
        if (!editingId || !editingName.trim()) return;
        await api.updateFolder(token, editingId, editingName.trim(), folders.find(f => f.id === editingId)?.color ?? '#6366f1');
        onFoldersChange(folders.map(f => f.id === editingId ? { ...f, name: editingName.trim() } : f));
        setEditingId(null);
    };

    const toggleChat = async (chatType: string, chatId: number) => {
        if (!selectedFolder) return;
        const inFolder = selectedFolder.chats.some(c => c.chat_type === chatType && c.chat_id === chatId);
        if (inFolder) {
            await api.removeChatFromFolder(token, selectedFolder.id, chatType, chatId);
            onFoldersChange(folders.map(f => f.id === selectedFolder.id
                ? { ...f, chats: f.chats.filter(c => !(c.chat_type === chatType && c.chat_id === chatId)) }
                : f));
        } else {
            await api.addChatToFolder(token, selectedFolder.id, chatType, chatId);
            onFoldersChange(folders.map(f => f.id === selectedFolder.id
                ? { ...f, chats: [...f.chats, { chat_type: chatType, chat_id: chatId }] }
                : f));
        }
    };

    const bg = dm ? '#13131f' : 'white';
    const bg2 = dm ? '#1a1a2e' : '#f8f8ff';
    const border = dm ? 'rgba(99,102,241,0.18)' : '#ede9fe';
    const text = dm ? '#e2e8f0' : '#1e1b4b';
    const sub = dm ? '#6060a0' : '#a5b4fc';

    return (
        <>
        <div style={{
            position: 'fixed', inset: 0, zIndex: 3000,
            backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)',
            backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
            <div style={{
                background: bg, borderRadius: 20, width: 560, maxHeight: '80vh',
                boxShadow: dm
                    ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)'
                    : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)',
                border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe',
                display: 'flex', flexDirection: 'column',
                overflow: 'hidden',
            }} className={closing ? 'modal-exit' : 'modal-enter'} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, fontSize: 16, color: text }}>📁 Папки чатов</span>
                    <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: sub, lineHeight: 1 }}>✕</button>
                </div>

                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                    {/* Left: folder list */}
                    <div style={{ width: 200, borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column', backgroundColor: bg2 }}>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                            {folders.length === 0 && (
                                <div style={{ fontSize: 12, color: sub, padding: '12px 14px', textAlign: 'center' }}>Нет папок</div>
                            )}
                            {folders.map(f => (
                                <div key={f.id}
                                    onClick={() => setSelectedFolderId(f.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', cursor: 'pointer',
                                        background: selectedFolderId === f.id ? (dm ? 'rgba(99,102,241,0.18)' : '#ede9fe') : 'transparent',
                                        borderLeft: selectedFolderId === f.id ? `3px solid ${f.color}` : '3px solid transparent',
                                        transition: 'background 0.1s',
                                    }}>
                                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: f.color, flexShrink: 0 }} />
                                    {editingId === f.id ? (
                                        <input ref={nameRef} value={editingName} onChange={e => setEditingName(e.target.value)}
                                            onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                                            onClick={e => e.stopPropagation()}
                                            style={{ flex: 1, fontSize: 13, padding: '2px 4px', borderRadius: 4, border: `1px solid ${f.color}`, background: bg, color: text, minWidth: 0, outline: 'none' }} />
                                    ) : (
                                        <span onDoubleClick={() => startEdit(f)} style={{ flex: 1, fontSize: 13, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                    )}
                                    <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(f.id); }}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 13, padding: '0 2px', flexShrink: 0, opacity: 0.6, lineHeight: 1 }}
                                        title="Удалить папку">🗑</button>
                                </div>
                            ))}
                        </div>

                        {/* Create folder */}
                        <div style={{ padding: '10px 12px', borderTop: `1px solid ${border}` }}>
                            <div style={{ fontSize: 11, color: sub, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Новая папка</div>
                            <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') createFolder(); }}
                                placeholder="Название..." maxLength={30}
                                style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 7, border: `1px solid ${border}`, background: bg, color: text, outline: 'none', boxSizing: 'border-box' }} />
                            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                                {FOLDER_COLORS.map(c => (
                                    <button key={c} onClick={() => setNewFolderColor(c)} style={{
                                        width: 18, height: 18, borderRadius: '50%', background: c, border: newFolderColor === c ? '2px solid white' : '2px solid transparent',
                                        cursor: 'pointer', padding: 0, outline: newFolderColor === c ? `2px solid ${c}` : 'none',
                                    }} />
                                ))}
                            </div>
                            <button onClick={createFolder} disabled={!newFolderName.trim()} style={{
                                marginTop: 8, width: '100%', padding: '6px', borderRadius: 8, border: 'none',
                                background: newFolderName.trim() ? newFolderColor : (dm ? '#2a2a3e' : '#e0e0f0'),
                                color: newFolderName.trim() ? 'white' : sub, cursor: newFolderName.trim() ? 'pointer' : 'default',
                                fontSize: 12, fontWeight: 600, transition: 'background 0.15s',
                            }}>Создать</button>
                        </div>
                    </div>

                    {/* Right: chats in folder */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {!selectedFolder ? (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: sub, fontSize: 13 }}>
                                Выберите папку слева
                            </div>
                        ) : (
                            <>
                                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: selectedFolder.color }} />
                                    <span style={{ fontWeight: 700, fontSize: 14, color: text }}>{selectedFolder.name}</span>
                                    <span style={{ fontSize: 12, color: sub }}>— {selectedFolder.chats.length} чатов</span>
                                </div>
                                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                                    {/* Groups */}
                                    {groups.length > 0 && (
                                        <>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: sub, padding: '4px 16px 6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Группы</div>
                                            {groups.map(g => {
                                                const inFolder = selectedFolder.chats.some(c => c.chat_type === 'group' && c.chat_id === g.id);
                                                return (
                                                    <div key={g.id} onClick={() => toggleChat('group', g.id)}
                                                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: 'pointer',
                                                            background: inFolder ? (dm ? 'rgba(99,102,241,0.1)' : '#f5f3ff') : 'transparent' }}>
                                                        <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: g.avatar ? 'transparent' : '#6366f1', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            {g.avatar
                                                                ? <img src={`${baseUrl}${g.avatar}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                                : <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>{g.name[0]?.toUpperCase()}</span>}
                                                        </div>
                                                        <span style={{ flex: 1, fontSize: 13, color: text }}>{g.name}</span>
                                                        <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${inFolder ? selectedFolder.color : border}`,
                                                            background: inFolder ? selectedFolder.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                            {inFolder && <span style={{ color: 'white', fontSize: 12, lineHeight: 1 }}>✓</span>}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </>
                                    )}
                                    {/* Users */}
                                    {users.length > 0 && (
                                        <>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: sub, padding: '8px 16px 6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Контакты</div>
                                            {users.map(u => {
                                                const inFolder = selectedFolder.chats.some(c => c.chat_type === 'private' && c.chat_id === u.id);
                                                return (
                                                    <div key={u.id} onClick={() => toggleChat('private', u.id)}
                                                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: 'pointer',
                                                            background: inFolder ? (dm ? 'rgba(99,102,241,0.1)' : '#f5f3ff') : 'transparent' }}>
                                                        <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: u.avatar ? 'transparent' : (u.avatar_color || '#1a73e8'), overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            {u.avatar
                                                                ? <img src={`${baseUrl}${u.avatar}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                                : <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>{u.username[0]?.toUpperCase()}</span>}
                                                        </div>
                                                        <span style={{ flex: 1, fontSize: 13, color: text }}>{u.username}</span>
                                                        <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${inFolder ? selectedFolder.color : border}`,
                                                            background: inFolder ? selectedFolder.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                            {inFolder && <span style={{ color: 'white', fontSize: 12, lineHeight: 1 }}>✓</span>}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </>
                                    )}
                                    {groups.length === 0 && users.length === 0 && (
                                        <div style={{ padding: '24px 16px', textAlign: 'center', color: sub, fontSize: 13 }}>Нет доступных чатов</div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* Confirm folder delete */}
        {confirmDeleteId !== null && ReactDOM.createPortal(
            <div onClick={() => setConfirmDeleteId(null)} className="modal-backdrop-enter"
                style={{ position: 'fixed', inset: 0, zIndex: 4000, backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div onClick={e => e.stopPropagation()} className="modal-enter"
                    style={{ background: dm ? '#13132a' : '#ffffff', borderRadius: 20, width: 320, padding: '28px 28px 22px', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe', textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', marginBottom: 8 }}>Это нельзя будет отменить</div>
                    <div style={{ fontSize: 14, color: dm ? '#9090b0' : '#6b7280', marginBottom: 24 }}>
                        Удалить папку «{folders.find(f => f.id === confirmDeleteId)?.name}»?
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={() => setConfirmDeleteId(null)} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', background: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#c0c0d8' : '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Отмена</button>
                        <button onClick={() => deleteFolder(confirmDeleteId!)} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e53935, #ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(229,57,53,0.35)' }}>Удалить</button>
                    </div>
                </div>
            </div>,
            document.body
        )}
        </>
    );
};

export default FolderManager;
