import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../services/api';
import { Group, GroupMember, User } from '../types';
import { config } from '../config';

const BASE_URL = config.BASE_URL;

const formatMembers = (n: number, type: 'member' | 'subscriber' = 'member'): string => {
    const abs = Math.abs(n);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (type === 'subscriber') {
        if (mod10 === 1 && mod100 !== 11) return `${n} подписчик`;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} подписчика`;
        return `${n} подписчиков`;
    }
    if (mod10 === 1 && mod100 !== 11) return `${n} участник`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} участника`;
    return `${n} участников`;
};

const isImg = (n: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(n);
const isVid = (n: string) => /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(n);
const isAud = (n: string) => /\.(mp3|ogg|wav|flac|aac|m4a|opus|weba)$/i.test(n);

const formatSize = (b?: number) => {
    if (!b) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
};

interface GroupInfoProps {
    token: string;
    groupId: number;
    currentUserId: number;
    isDark?: boolean;
    liveGroupAvatar?: string;
    liveUsers?: User[];
    messages?: any[];
    onClose: () => void;
    onInvite: () => void;
    onUserClick?: (user: { id: number; username: string; email: string; avatar?: string; avatar_color?: string; created_at: string }) => void;
    onGroupAvatarUpdated?: (groupId: number, avatar: string) => void;
    onGroupUpdated?: (groupId: number, name: string, description: string) => void;
    onGroupDeleted?: (groupId: number) => void;
    onGroupLeft?: (groupId: number) => void;
    onGoToMessage?: (id: number) => void;
}

const GroupInfo: React.FC<GroupInfoProps> = ({
    token, groupId, currentUserId, isDark = false, liveGroupAvatar, liveUsers, messages = [],
    onClose, onInvite, onUserClick, onGroupAvatarUpdated, onGroupUpdated, onGroupDeleted, onGroupLeft, onGoToMessage
}) => {
    const dm = isDark;
    const [closing, setClosing] = useState(false);
    const close = () => { setClosing(true); setTimeout(onClose, 180); };
    const [group, setGroup] = useState<Group | null>(null);
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editSaving, setEditSaving] = useState(false);
    const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // Channel-specific state
    const [showMembersModal, setShowMembersModal] = useState(false);
    const [showAdminsModal, setShowAdminsModal] = useState(false);
    const [showAddMembersModal, setShowAddMembersModal] = useState(false);
    const [inviteLink, setInviteLink] = useState<string | null>(null);
    const [inviteCopied, setInviteCopied] = useState(false);
    const [generatingLink, setGeneratingLink] = useState(false);
    const [channelSettings, setChannelSettings] = useState(false);
    const [editChannelType, setEditChannelType] = useState<'public' | 'private'>('public');
    const [editChannelTag, setEditChannelTag] = useState('');
    const [channelSettingsSaving, setChannelSettingsSaving] = useState(false);
    const [addMembersSearch, setAddMembersSearch] = useState('');
    const [addMembersResults, setAddMembersResults] = useState<any[]>([]);
    const [addMembersLoading, setAddMembersLoading] = useState(false);
    const addMembersSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Media panel
    const [mediaExpanded, setMediaExpanded] = useState(false);
    const [mediaTab, setMediaTab] = useState<'images' | 'video' | 'audio' | 'files'>('images');
    const [lightbox, setLightbox] = useState<{ src: string; filename: string; isVideo: boolean } | null>(null);

    useEffect(() => { loadGroupInfo(); }, [groupId]);

    useEffect(() => {
        if (liveGroupAvatar !== undefined) {
            setGroup(g => g ? { ...g, avatar: liveGroupAvatar } : g);
        }
    }, [liveGroupAvatar]);

    useEffect(() => {
        if (!liveUsers?.length) return;
        setMembers(prev => prev.map(m => {
            const live = liveUsers.find(u => u.id === m.id);
            return live ? { ...m, avatar: live.avatar || m.avatar } : m;
        }));
    }, [liveUsers]);

    const loadGroupInfo = async () => {
        setLoading(true);
        try {
            const response = await api.getGroupInfo(token, groupId);
            if (response.group) {
                setGroup(response.group);
                setMembers(response.members);
                setEditName(response.group.name);
                setEditDesc(response.group.description || '');
            }
        } catch (error) {
            console.error('Failed to load group info:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { alert('Файл больше 5MB'); return; }
        setUploadingAvatar(true);
        try {
            const res = await api.uploadGroupAvatar(token, groupId, file);
            if (res.success) { setGroup(g => g ? { ...g, avatar: res.avatar } : g); onGroupAvatarUpdated?.(groupId, res.avatar); }
        } catch {}
        finally { setUploadingAvatar(false); }
    };

    const handleSaveEdit = async () => {
        if (!editName.trim()) return;
        setEditSaving(true);
        try {
            const res = await api.updateGroup(token, groupId, editName.trim(), editDesc.trim());
            if (res.success) {
                setGroup(g => g ? { ...g, name: editName.trim(), description: editDesc.trim() } : g);
                onGroupUpdated?.(groupId, editName.trim(), editDesc.trim());
                setEditing(false);
            } else alert(res.detail || 'Ошибка сохранения');
        } catch { alert('Ошибка соединения'); }
        finally { setEditSaving(false); }
    };

    const handleDeleteGroup = () => {
        setConfirm({ message: `Удалить группу «${group?.name}»? Это действие необратимо.`, onConfirm: async () => { setConfirm(null); try { const res = await api.deleteGroup(token, groupId); if (res.success) onGroupDeleted?.(groupId); } catch {} } });
    };

    const handleLeaveGroup = () => {
        setConfirm({ message: `Покинуть группу «${group?.name}»?`, onConfirm: async () => { setConfirm(null); try { const res = await api.removeMember(token, groupId, currentUserId); if (res.success) onGroupLeft?.(groupId); } catch {} } });
    };

    const handleRemoveMember = (userId: number, username: string) => {
        setConfirm({ message: `Удалить ${username} из группы?`, onConfirm: async () => { setConfirm(null); try { const res = await api.removeMember(token, groupId, userId); if (res.success) { setMembers(prev => prev.filter(m => m.id !== userId)); setGroup(g => g ? { ...g, member_count: g.member_count - 1 } : g); } } catch {} } });
    };

    const handleSetMemberRole = async (userId: number, role: 'admin' | 'member') => {
        try {
            const res = await api.setMemberRole(token, groupId, userId, role);
            if (res.success) setMembers(prev => prev.map(m => m.id === userId ? { ...m, role } : m));
        } catch {}
    };

    const handleGenerateInviteLink = async () => {
        if (inviteLink) { navigator.clipboard.writeText(inviteLink).then(() => { setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000); }); return; }
        setGeneratingLink(true);
        try {
            const res = await api.generateInviteLink(token, groupId);
            if (res.invite_link) {
                setInviteLink(res.invite_link);
                setGroup(g => g ? { ...g, invite_link: res.invite_link } : g);
                navigator.clipboard.writeText(res.invite_link).then(() => { setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000); });
            }
        } catch {} finally { setGeneratingLink(false); }
    };

    const handleSaveChannelSettings = async () => {
        setChannelSettingsSaving(true);
        try {
            const res = await api.updateChannelSettings(token, groupId, editChannelType, editChannelType === 'public' ? editChannelTag : undefined);
            if (res.success) {
                setGroup(g => g ? { ...g, channel_type: editChannelType, channel_tag: editChannelType === 'public' ? editChannelTag : null, invite_link: editChannelType === 'public' ? g.invite_link : null } : g);
                setChannelSettings(false);
                if (editChannelType === 'public') setInviteLink(null);
            } else alert(res.detail || 'Ошибка');
        } catch { alert('Ошибка соединения'); } finally { setChannelSettingsSaving(false); }
    };

    const searchAddMembers = (q: string) => {
        setAddMembersSearch(q);
        if (addMembersSearchTimer.current) clearTimeout(addMembersSearchTimer.current);
        const clean = q.trim().replace(/^@/, '');
        if (!clean) { setAddMembersResults([]); return; }
        addMembersSearchTimer.current = setTimeout(async () => {
            setAddMembersLoading(true);
            try {
                const r = await api.searchUsers(token, clean);
                // filter to only tag matches (not username-only matches)
                const filtered = (r.users || []).filter((u: any) =>
                    u.tag?.toLowerCase().startsWith(clean.toLowerCase()) &&
                    !members.find(m => m.id === u.id)
                );
                setAddMembersResults(filtered);
            }
            catch {} finally { setAddMembersLoading(false); }
        }, 300);
    };

    const handleAddMember = async (userId: number, tag: string) => {
        try {
            const res = await api.inviteToGroup(token, groupId, tag);
            if (res.success) { await loadGroupInfo(); setAddMembersResults(prev => prev.filter(u => u.id !== userId)); }
        } catch {}
    };

    // Extract media from messages
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
        { key: 'images' as const, icon: '🖼', label: 'Фото', count: imgs.length },
        { key: 'video' as const, icon: '🎬', label: 'Видео', count: vids.length },
        { key: 'audio' as const, icon: '🎵', label: 'Аудио', count: auds.length },
        { key: 'files' as const, icon: '📄', label: 'Файлы', count: files.length },
    ];

    const currentTabData = mediaTab === 'images' ? imgs : mediaTab === 'video' ? vids : mediaTab === 'audio' ? auds : files;
    const hasMedia = messages.length > 0;

    const openMediaTab = (tab: typeof mediaTab) => { setMediaTab(tab); setMediaExpanded(true); };

    const t = tokens(dm);
    const border = dm ? 'rgba(99,102,241,0.25)' : '#ede9fe';
    const bg = dm ? '#13132a' : '#ffffff';
    const sub = dm ? '#6060a0' : '#9ca3af';

    if (loading) {
        return (
            <div style={t.overlay} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
                <div style={{ ...t.modalShell }} className={closing ? 'modal-exit' : 'modal-enter'} onClick={e => e.stopPropagation()}>
                    <div style={{ width: 460, padding: '24px 24px 20px' }}>
                        <div style={{ textAlign: 'center', padding: 40, color: dm ? '#9999bb' : '#9ca3af' }}>Загрузка...</div>
                    </div>
                </div>
            </div>
        );
    }

    const isAdmin = members.find(m => m.id === currentUserId)?.role === 'admin';
    const groupAvatarUrl = config.fileUrl(group?.avatar);
    const isChannel = !!group?.is_channel;
    const resolvedInviteLink = inviteLink ?? group?.invite_link ?? null;

    // Channel sub-modal helper
    const renderMemberRow = (member: GroupMember, showRoleActions: boolean) => (
        <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, backgroundColor: dm ? '#1a1a30' : '#f8f9ff', border: dm ? '1px solid rgba(255,255,255,0.04)' : '1px solid #ede9fe' }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', backgroundColor: member.avatar ? (dm ? '#1a1a30' : '#f8f9ff') : '#6366f1', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, overflow: 'hidden', flexShrink: 0, cursor: onUserClick ? 'pointer' : 'default' }}
                onClick={() => onUserClick?.({ id: member.id, username: member.username, email: member.email, avatar: member.avatar, created_at: member.joined_at })}>
                {member.avatar ? <img src={config.fileUrl(member.avatar) ?? undefined} alt={member.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : member.username[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {member.username}
                    {member.tag === 'kayano' || member.tag === 'durov' && <span title="разработчик Aurora" style={{ fontSize: 12, cursor: 'default' }}>🔧</span>}
                </div>
                <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 2 }}>{member.role === 'admin' ? '👑 Администратор' : '👤 Участник'}</div>
            </div>
            {isAdmin && member.id !== currentUserId && showRoleActions && (
                <div style={{ display: 'flex', gap: 4 }}>
                    {member.role === 'member'
                        ? <button onClick={() => handleSetMemberRole(member.id, 'admin')} style={{ padding: '4px 8px', borderRadius: 8, background: dm ? 'rgba(99,102,241,0.15)' : '#ede9fe', border: 'none', color: '#6366f1', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>+ Админ</button>
                        : <button onClick={() => handleSetMemberRole(member.id, 'member')} style={{ padding: '4px 8px', borderRadius: 8, background: dm ? 'rgba(239,68,68,0.1)' : '#fff0f0', border: 'none', color: '#f87171', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>− Права</button>
                    }
                    <button onClick={() => handleRemoveMember(member.id, member.username)} style={{ width: 28, height: 28, background: dm ? 'rgba(239,68,68,0.1)' : '#fff0f0', border: dm ? '1px solid rgba(239,68,68,0.3)' : '1px solid #ffcdd2', color: '#f87171', borderRadius: 8, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
                </div>
            )}
        </div>
    );

    const channelSubModal = (title: string, onCloseModal: () => void, children: React.ReactNode) => ReactDOM.createPortal(
        <div onClick={onCloseModal} className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 1500, backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} className="modal-enter" style={{ background: dm ? '#13132a' : '#ffffff', borderRadius: 20, width: 420, maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3)' : '0 0 40px rgba(99,102,241,0.12)', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe' }}>
                <div style={{ padding: '18px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${border}` }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b' }}>{title}</span>
                    <button onClick={onCloseModal} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: dm ? '#9999bb' : '#9ca3af' }}>✕</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );

    return (
        <>
        <div style={t.overlay} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
            <div
                style={{
                    ...t.modalShell,
                    width: mediaExpanded ? Math.min(840, window.innerWidth * 0.94) : 460,
                    transition: 'width 0.32s cubic-bezier(0.4,0,0.2,1)',
                }}
                className={closing ? 'modal-exit' : 'modal-enter'}
                onClick={e => e.stopPropagation()}
            >
                {/* Left panel — group info */}
                <div style={{ width: 460, flexShrink: 0, padding: '24px 24px 20px', boxSizing: 'border-box', overflowY: 'auto', maxHeight: '88vh' }}>

                    {/* Header — close button only when media panel closed */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b' }}>{editing ? 'Редактирование' : group?.name}</span>
                        {!mediaExpanded && (
                            <button onClick={close} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: dm ? '#9999bb' : '#9ca3af' }}>✕</button>
                        )}
                    </div>

                    {/* Avatar */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
                        <div
                            style={{ width: 90, height: 90, borderRadius: '50%', background: groupAvatarUrl ? (dm ? '#1a1a30' : '#f8f9ff') : 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', boxShadow: '0 0 24px rgba(99,102,241,0.45)', cursor: groupAvatarUrl ? 'zoom-in' : 'default' }}
                            onClick={() => { if (groupAvatarUrl) setLightbox({ src: groupAvatarUrl, filename: group?.name || 'avatar', isVideo: false }); }}
                        >
                            {uploadingAvatar
                                ? <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 24, height: 24, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /></div>
                                : groupAvatarUrl
                                    ? <img src={groupAvatarUrl} alt="group" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                                    : <span style={{ fontSize: 34, color: 'white', fontWeight: 700 }}>{group?.name[0]?.toUpperCase()}</span>
                            }
                        </div>
                        <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
                    </div>

                    {/* Edit form */}
                    {editing ? (
                        <div style={{ marginBottom: 16 }}>
                            <button onClick={() => fileRef.current?.click()} style={{ width: '100%', padding: '9px', marginBottom: 14, background: dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', color: '#a5b4fc', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #c4b5fd', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                Изменить аватар
                            </button>
                            <label style={{ fontSize: 11, fontWeight: 700, color: dm ? '#7c7caa' : '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Название группы</label>
                            <input style={t.input} value={editName} onChange={e => setEditName(e.target.value)} maxLength={60} />
                            <label style={{ fontSize: 11, fontWeight: 700, color: dm ? '#7c7caa' : '#6b7280', display: 'block', marginBottom: 4, marginTop: 10, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Описание</label>
                            <textarea style={{ ...t.input, height: 60, resize: 'vertical' as const }} value={editDesc} onChange={e => setEditDesc(e.target.value)} maxLength={255} />
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button onClick={handleSaveEdit} disabled={editSaving || !editName.trim()} style={t.btnPrimary}>{editSaving ? 'Сохранение...' : 'Сохранить'}</button>
                                <button onClick={() => setEditing(false)} style={t.btnCancel}>Отмена</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {group?.description && (
                                <div style={{ backgroundColor: dm ? '#1e1e3a' : '#f5f3ff', border: dm ? '1px solid rgba(99,102,241,0.15)' : '1px solid #ede9fe', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
                                    <span style={{ color: dm ? '#7c7caa' : '#6b7280', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Описание</span>
                                    <div style={{ color: dm ? '#c0c0d8' : '#374151', fontSize: 14, marginTop: 4 }}>{group.description}</div>
                                </div>
                            )}

                            {/* Stats */}
                            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                                <div style={{ ...t.statCard }}>
                                    <span style={{ fontSize: 18 }}>👥</span>
                                    <span style={{ fontSize: 15, fontWeight: 700, color: dm ? '#e0e0f0' : '#1e1b4b' }}>{group?.member_count ?? 0}</span>
                                    <span style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{group?.member_count ? formatMembers(group.member_count, group.is_channel ? 'subscriber' : 'member').replace(/^\d+ /, '') : (group?.is_channel ? 'подписчиков' : 'участников')}</span>
                                </div>
                                <div style={{ ...t.statCard }}>
                                    <span style={{ fontSize: 18 }}>📅</span>
                                    <span style={{ fontSize: 15, fontWeight: 700, color: dm ? '#e0e0f0' : '#1e1b4b' }}>{new Date(group?.created_at || '').toLocaleDateString('ru-RU')}</span>
                                    <span style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>создана</span>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                                {isAdmin && <>
                                    <button onClick={() => setEditing(true)} style={t.btnEdit}>✏️ Редактировать</button>
                                    <button onClick={handleDeleteGroup} style={t.btnDelete}>🗑️ {isChannel ? 'Удалить канал' : 'Удалить группу'}</button>
                                </>}
                                <button onClick={handleLeaveGroup} style={{ ...t.btnDelete, flex: isAdmin ? '0 0 100%' : 1 }}>🚪 {isChannel ? 'Покинуть канал' : 'Покинуть группу'}</button>
                            </div>

                            {/* Channel: invite link for public */}
                            {isChannel && group?.channel_type === 'public' && (
                                <div style={{ backgroundColor: dm ? '#1e1e3a' : '#f5f3ff', border: dm ? '1px solid rgba(99,102,241,0.15)' : '1px solid #ede9fe', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: dm ? '#7c7caa' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>Пригласительная ссылка</div>
                                    {resolvedInviteLink ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ flex: 1, fontSize: 12, color: dm ? '#a5b4fc' : '#6366f1', wordBreak: 'break-all', background: dm ? '#252540' : '#ede9fe', padding: '6px 10px', borderRadius: 8 }}>{resolvedInviteLink}</div>
                                            <button onClick={handleGenerateInviteLink} style={{ padding: '6px 12px', borderRadius: 8, background: inviteCopied ? '#22c55e' : 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0, transition: 'background 0.2s' }}>{inviteCopied ? '✓ Скопировано' : 'Копировать'}</button>
                                        </div>
                                    ) : (
                                        <button onClick={handleGenerateInviteLink} disabled={generatingLink} style={{ width: '100%', padding: '8px', borderRadius: 10, background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{generatingLink ? 'Генерация...' : 'Создать ссылку'}</button>
                                    )}
                                </div>
                            )}

                            {/* Channel settings */}
                            {isAdmin && isChannel && (
                                <div style={{ marginBottom: 14 }}>
                                    {channelSettings ? (
                                        <div style={{ backgroundColor: dm ? '#1e1e3a' : '#f5f3ff', border: dm ? '1px solid rgba(99,102,241,0.15)' : '1px solid #ede9fe', borderRadius: 12, padding: '12px 14px' }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: dm ? '#7c7caa' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10 }}>Настройки канала</div>
                                            <div style={{ display: 'flex', gap: 8, marginBottom: editChannelType === 'public' ? 10 : 0 }}>
                                                {(['public', 'private'] as const).map(typ => (
                                                    <button key={typ} onClick={() => setEditChannelType(typ)}
                                                        style={{ flex: 1, padding: '8px', borderRadius: 10, border: editChannelType === typ ? '2px solid #6366f1' : dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', background: editChannelType === typ ? (dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)') : 'transparent', color: editChannelType === typ ? '#6366f1' : (dm ? '#9090b0' : '#6b7280'), cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                                        {typ === 'public' ? '🌐 Публичный' : '🔒 Частный'}
                                                    </button>
                                                ))}
                                            </div>
                                            {editChannelType === 'public' && (
                                                <div>
                                                    <label style={{ fontSize: 11, color: dm ? '#7c7caa' : '#6b7280', display: 'block', marginBottom: 4 }}>Тег канала (без @)</label>
                                                    <input style={t.input} value={editChannelTag} onChange={e => setEditChannelTag(e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase())} placeholder="my_channel" maxLength={32} />
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                                <button onClick={handleSaveChannelSettings} disabled={channelSettingsSaving || (editChannelType === 'public' && !editChannelTag.trim())} style={t.btnPrimary}>{channelSettingsSaving ? 'Сохранение...' : 'Сохранить'}</button>
                                                <button onClick={() => setChannelSettings(false)} style={t.btnCancel}>Отмена</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button onClick={() => { setChannelSettings(true); setEditChannelType(group?.channel_type || 'public'); setEditChannelTag(group?.channel_tag || ''); }}
                                            style={{ width: '100%', padding: 10, background: dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', color: '#a5b4fc', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #c4b5fd', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                            ⚙️ Настройки канала
                                        </button>
                                    )}
                                </div>
                            )}
                        </>
                    )}


                    {/* Media shortcut buttons */}
                    {hasMedia && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                            {mediaTabs.map(tab => (
                                <button key={tab.key} onClick={() => openMediaTab(tab.key)}
                                    style={{
                                        padding: '10px 8px', borderRadius: 12,
                                        border: `1px solid ${mediaExpanded && mediaTab === tab.key ? '#6366f1' : border}`,
                                        background: mediaExpanded && mediaTab === tab.key
                                            ? dm ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.08)'
                                            : dm ? '#1e1e3a' : '#f5f3ff',
                                        cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                                        transition: 'all 0.18s',
                                    }}>
                                    <span style={{ fontSize: 18 }}>{tab.icon}</span>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: mediaExpanded && mediaTab === tab.key ? '#6366f1' : sub }}>{tab.label}</span>
                                    {tab.count > 0 && <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700 }}>{tab.count}</span>}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Members — channel shows buttons, group shows inline */}
                    {isChannel ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {[
                                { icon: '👥', label: group?.member_count ? formatMembers(group.member_count, isChannel ? 'subscriber' : 'member') : 'Участники', action: () => setShowMembersModal(true) },
                                { icon: '👑', label: `Администраторы (${members.filter(m => m.role === 'admin').length})`, action: () => setShowAdminsModal(true) },
                                { icon: '➕', label: 'Добавить участников', action: () => { setShowAddMembersModal(true); setAddMembersSearch(''); setAddMembersResults([]); } },
                            ].map(item => (
                                <button key={item.label} onClick={item.action}
                                    style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: dm ? '1px solid rgba(99,102,241,0.2)' : '1px solid #ede9fe', background: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#e0e0f0' : '#1e1b4b', cursor: 'pointer', fontSize: 14, fontWeight: 600, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ fontSize: 18 }}>{item.icon}</span>
                                    {item.label}
                                    <span style={{ marginLeft: 'auto', color: sub, fontSize: 16 }}>›</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <span style={{ color: dm ? '#e0e0f0' : '#1e1b4b', fontWeight: 700, fontSize: 14 }}>Участники</span>
                            {isAdmin && <button onClick={onInvite} style={t.btnInvite}>+ Пригласить</button>}
                        </div>
                        <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {members.map(member => (
                                <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, backgroundColor: dm ? '#1a1a30' : '#f8f9ff', border: dm ? '1px solid rgba(255,255,255,0.04)' : '1px solid #ede9fe' }}>
                                    <div
                                        style={{ width: 38, height: 38, borderRadius: '50%', backgroundColor: member.avatar ? (dm ? '#1a1a30' : '#f8f9ff') : '#6366f1', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, overflow: 'hidden', flexShrink: 0, cursor: onUserClick ? 'pointer' : 'default' }}
                                        onClick={() => onUserClick?.({ id: member.id, username: member.username, email: member.email, avatar: member.avatar, created_at: member.joined_at })}
                                    >
                                        {member.avatar
                                            ? <img src={config.fileUrl(member.avatar) ?? undefined} alt={member.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                                            : member.username[0].toUpperCase()
                                        }
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', cursor: onUserClick ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                                            onClick={() => onUserClick?.({ id: member.id, username: member.username, email: member.email, avatar: member.avatar, created_at: member.joined_at })}
                                        >
                                            {member.username}
                                            {member.tag === 'kayano' || member.tag === 'durov' && <span title="разработчик Aurora" style={{ fontSize: 12, cursor: 'default', flexShrink: 0 }}>🔧</span>}
                                        </div>
                                        <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span>{member.role === 'admin' ? '👑 Администратор' : '👤 Участник'}</span>
                                            {(() => {
                                                const lu = liveUsers?.find(u => u.id === member.id);
                                                if (member.id === currentUserId || lu?.is_online) return <span style={{ color: '#22c55e', fontWeight: 600 }}>· 🟢 в сети</span>;
                                                if (lu?.last_seen && lu.last_seen !== 'hidden') {
                                                    try {
                                                        const d = new Date(lu.last_seen);
                                                        const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
                                                        let txt = '';
                                                        if (diffMin < 1) txt = 'только что';
                                                        else if (diffMin < 60) txt = `${diffMin} мин. назад`;
                                                        else if (diffMin < 1440) txt = `${Math.floor(diffMin / 60)} ч. назад`;
                                                        else txt = `${Math.floor(diffMin / 1440)} дн. назад`;
                                                        return <span>· {txt}</span>;
                                                    } catch { return null; }
                                                }
                                                return null;
                                            })()}
                                        </div>
                                    </div>
                                    {isAdmin && member.id !== currentUserId && (
                                        <button onClick={() => handleRemoveMember(member.id, member.username)} style={{ background: dm ? 'rgba(239,68,68,0.1)' : '#fff0f0', border: dm ? '1px solid rgba(239,68,68,0.3)' : '1px solid #ffcdd2', color: '#f87171', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} title="Удалить из группы">✕</button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                    )}
                </div>

                {/* Right panel — media */}
                <div style={{
                    width: mediaExpanded ? 380 : 0,
                    flexShrink: 0,
                    borderLeft: mediaExpanded ? `1px solid ${border}` : 'none',
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                    transition: 'width 0.32s cubic-bezier(0.4,0,0.2,1)',
                    maxHeight: '88vh',
                }}>
                    {/* Tab bar + collapse/close buttons */}
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
                        {/* Collapse panel */}
                        <button onClick={() => setMediaExpanded(false)} title="Свернуть"
                            style={{ padding: '0 10px', border: 'none', background: 'none', cursor: 'pointer', color: sub, fontSize: 16, borderBottom: '2px solid transparent', flexShrink: 0 }}>‹</button>
                        {/* Close modal */}
                        <button onClick={close} title="Закрыть"
                            style={{ padding: '0 10px', border: 'none', background: 'none', cursor: 'pointer', color: sub, fontSize: 18, borderBottom: '2px solid transparent', flexShrink: 0, borderLeft: `1px solid ${border}` }}>✕</button>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: (mediaTab === 'images' || mediaTab === 'video') ? 8 : 0 }}>
                        {currentTabData.length === 0 ? (
                            <div style={{ padding: 32, textAlign: 'center', color: sub, fontSize: 13 }}>Нет файлов</div>
                        ) : (mediaTab === 'images' || mediaTab === 'video') ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                                {currentTabData.map((f: any, i: number) => (
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
                                {currentTabData.map((f: any, i: number) => (
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
                                                style={{ width: 28, height: 28, borderRadius: 8, background: dm ? '#252540' : '#f0f0ff', border: 'none', cursor: 'pointer', color: '#6366f1', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Перейти к сообщению">→</button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* Confirm dialog portal */}
        {confirm && ReactDOM.createPortal(
            <div onClick={() => setConfirm(null)} className="modal-backdrop-enter"
                style={{ position: 'fixed', inset: 0, zIndex: 2000, backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div onClick={e => e.stopPropagation()} className="modal-enter"
                    style={{ background: dm ? '#13132a' : '#ffffff', borderRadius: 20, width: 320, padding: '28px 28px 22px', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe', textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', marginBottom: 8 }}>Это нельзя будет отменить</div>
                    <div style={{ fontSize: 14, color: dm ? '#9090b0' : '#6b7280', marginBottom: 24 }}>{confirm.message}</div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={() => setConfirm(null)} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', background: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#c0c0d8' : '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Отмена</button>
                        <button onClick={confirm.onConfirm} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e53935, #ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(229,57,53,0.35)' }}>Удалить</button>
                    </div>
                </div>
            </div>,
            document.body
        )}

        {/* Channel: Members modal */}
        {showMembersModal && channelSubModal(group?.member_count ? formatMembers(group.member_count, isChannel ? 'subscriber' : 'member') : 'Участники', () => setShowMembersModal(false),
            members.map(m => renderMemberRow(m, false))
        )}

        {/* Channel: Admins modal */}
        {showAdminsModal && channelSubModal(`Администраторы`, () => setShowAdminsModal(false),
            <>
                {members.filter(m => m.role === 'admin').map(m => renderMemberRow(m, true))}
                {members.filter(m => m.role !== 'admin').length > 0 && (
                    <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: dm ? '#7c7caa' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', marginTop: 8, marginBottom: 4 }}>Участники</div>
                        {members.filter(m => m.role !== 'admin').map(m => renderMemberRow(m, true))}
                    </>
                )}
            </>
        )}

        {/* Channel: Add Members modal */}
        {showAddMembersModal && channelSubModal('Добавить участников', () => setShowAddMembersModal(false),
            <>
                <input
                    type="text"
                    placeholder="@тег пользователя"
                    value={addMembersSearch}
                    onChange={e => searchAddMembers(e.target.value)}
                    style={{ ...t.input, marginBottom: 8 }}
                    autoFocus
                />
                {group?.channel_type === 'public' && resolvedInviteLink && (
                    <button onClick={handleGenerateInviteLink} style={{ width: '100%', padding: '10px', borderRadius: 10, background: dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', color: '#a5b4fc', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #c4b5fd', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                        🔗 {inviteCopied ? 'Ссылка скопирована!' : 'Пригласить по ссылке'}
                    </button>
                )}
                {addMembersLoading && <div style={{ textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13 }}>Поиск...</div>}
                {addMembersResults.map((u: any) => (
                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, backgroundColor: dm ? '#1a1a30' : '#f8f9ff', border: dm ? '1px solid rgba(255,255,255,0.04)' : '1px solid #ede9fe' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: u.avatar ? (dm ? '#1a1a30' : '#f8f9ff') : '#6366f1', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, overflow: 'hidden', flexShrink: 0 }}>
                            {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt={u.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.username[0].toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                            {u.tag && <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>@{u.tag}</div>}
                        </div>
                        <button onClick={() => handleAddMember(u.id, u.tag)} style={{ padding: '6px 14px', borderRadius: 8, background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Добавить</button>
                    </div>
                ))}
                {!addMembersLoading && addMembersSearch && addMembersResults.length === 0 && (
                    <div style={{ textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13 }}>Не найдено</div>
                )}
            </>
        )}

        {/* Lightbox */}
        {lightbox && ReactDOM.createPortal(
            <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
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

const tokens = (dm: boolean) => ({
    overlay: { position: 'fixed' as const, inset: 0, backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    modalShell: { backgroundColor: dm ? '#13132a' : '#ffffff', borderRadius: 20, maxWidth: '94vw', maxHeight: '88vh', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe', display: 'flex', overflow: 'hidden', position: 'relative' as const },
    input: { width: '100%', padding: '10px 14px', border: dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', borderRadius: 12, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const, backgroundColor: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#e0e0f0' : '#1e1b4b', marginBottom: 0 },
    statCard: { flex: 1, backgroundColor: dm ? '#1e1e3a' : '#f5f3ff', border: dm ? '1px solid rgba(99,102,241,0.12)' : '1px solid #ede9fe', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 2 },
    btnPrimary: { flex: 1, padding: 10, background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
    btnCancel: { flex: 1, padding: 10, backgroundColor: dm ? '#252538' : '#f0f2f5', color: dm ? '#9999bb' : '#555', border: dm ? '1.5px solid #3a3a5e' : '1px solid #ddd', borderRadius: 12, cursor: 'pointer', fontSize: 13 },
    btnEdit: { flex: 1, padding: 10, background: dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', color: '#a5b4fc', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #c4b5fd', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
    btnDelete: { flex: 1, padding: 10, background: dm ? 'rgba(239,68,68,0.1)' : '#fff0f0', color: '#f87171', border: dm ? '1px solid rgba(239,68,68,0.25)' : '1px solid #ffcdd2', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
    btnInvite: { padding: '8px 16px', background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, boxShadow: '0 0 10px rgba(99,102,241,0.25)' },
});

export default GroupInfo;
