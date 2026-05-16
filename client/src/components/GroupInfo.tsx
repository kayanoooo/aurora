import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../services/api';
import { Group, GroupMember, User } from '../types';
import { config } from '../config';
import { useLang } from '../i18n';
import AvatarCropper from './AvatarCropper';

const BASE_URL = config.BASE_URL;

const formatMembers = (n: number, type: 'member' | 'subscriber' = 'member', lang = 'ru'): string => {
    if (lang === 'en') {
        return type === 'subscriber' ? `${n} subscriber${n !== 1 ? 's' : ''}` : `${n} member${n !== 1 ? 's' : ''}`;
    }
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
    onReport?: (type: 'group', id: number, name: string) => void;
}

const GroupInfo: React.FC<GroupInfoProps> = ({
    token, groupId, currentUserId, isDark = false, liveGroupAvatar, liveUsers, messages = [],
    onClose, onInvite, onUserClick, onGroupAvatarUpdated, onGroupUpdated, onGroupDeleted, onGroupLeft, onGoToMessage, onReport
}) => {
    const dm = isDark;
    const { t: tr, lang } = useLang();
    const [closing, setClosing] = useState(false);
    const close = () => { setClosing(true); setTimeout(onClose, 180); };
    const [group, setGroup] = useState<Group | null>(null);
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editWelcome, setEditWelcome] = useState('');
    const [editSaving, setEditSaving] = useState(false);
    const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
    const [saveError, setSaveError] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    // Channel-specific state
    const [showMembersModal, setShowMembersModal] = useState(false);
    const [showAdminsModal, setShowAdminsModal] = useState(false);
    const [showAddMembersModal, setShowAddMembersModal] = useState(false);
    const [channelSettings, setChannelSettings] = useState(false);
    const [groupSettings, setGroupSettings] = useState(false);
    const [editChannelType, setEditChannelType] = useState<'public' | 'private'>('public');
    const [slowMode, setSlowMode] = useState<number>(0);
    const [slowModeSaving, setSlowModeSaving] = useState(false);
    const [editChannelTag, setEditChannelTag] = useState('');
    const [channelSettingsSaving, setChannelSettingsSaving] = useState(false);
    const [groupSettingsSaving, setGroupSettingsSaving] = useState(false);
    const [addMembersSearch, setAddMembersSearch] = useState('');
    const [addMembersResults, setAddMembersResults] = useState<any[]>([]);
    const [addMembersLoading, setAddMembersLoading] = useState(false);
    const addMembersSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Stats
    const [showStats, setShowStats] = useState(false);
    const [stats, setStats] = useState<any>(null);
    const [statsLoading, setStatsLoading] = useState(false);

    const loadStats = async () => {
        setStatsLoading(true);
        try {
            const res = await fetch(`${config.API_URL}/groups/${groupId}/stats?token=${token}`);
            const data = await res.json();
            setStats(data);
        } catch {} finally { setStatsLoading(false); }
    };

    // Media panel
    const [mediaExpanded, setMediaExpanded] = useState(false);
    const [mediaTab, setMediaTab] = useState<'images' | 'video' | 'audio' | 'files'>('images');
    const [lightbox, setLightbox] = useState<{ src: string; filename: string; isVideo: boolean } | null>(null);
    const [mediaClosing, setMediaClosing] = useState(false);
    // Mobile: separate participants slide
    const [membersSlide, setMembersSlide] = useState<'members' | 'admins' | 'add' | null>(null);

    useEffect(() => { loadGroupInfo(); }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

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
                setEditWelcome(response.group.welcome_message || '');
                setSlowMode(response.group.slow_mode || 0);
            }
        } catch (error) {
            console.error('Failed to load group info:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setCropSrc(URL.createObjectURL(file));
    };

    const handleCropApply = async (blob: Blob) => {
        if (cropSrc) URL.revokeObjectURL(cropSrc);
        setCropSrc(null);
        const croppedFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
        setUploadingAvatar(true);
        try {
            const res = await api.uploadGroupAvatar(token, groupId, croppedFile);
            if (res.success) { setGroup(g => g ? { ...g, avatar: res.avatar } : g); onGroupAvatarUpdated?.(groupId, res.avatar); }
        } catch {}
        finally { setUploadingAvatar(false); }
    };

    const handleCropCancel = () => {
        if (cropSrc) URL.revokeObjectURL(cropSrc);
        setCropSrc(null);
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
            } else setSaveError(res.detail || tr('Save error'));
        } catch { setSaveError(tr('Connection error')); }
        finally { setEditSaving(false); }
    };

    const handleDeleteGroup = () => {
        const msg = lang === 'en' ? `Delete group "${group?.name}"? This cannot be undone.` : `Удалить группу «${group?.name}»? Это действие необратимо.`;
        setConfirm({ message: msg, onConfirm: async () => { setConfirm(null); try { const res = await api.deleteGroup(token, groupId); if (res.success) onGroupDeleted?.(groupId); } catch {} } });
    };

    const handleLeaveGroup = () => {
        const msg = lang === 'en' ? `Leave group "${group?.name}"?` : `Покинуть группу «${group?.name}»?`;
        setConfirm({ message: msg, onConfirm: async () => { setConfirm(null); try { const res = await api.removeMember(token, groupId, currentUserId); if (res.success) onGroupLeft?.(groupId); } catch {} } });
    };

    const handleRemoveMember = (userId: number, username: string) => {
        const msg = lang === 'en' ? `Remove ${username} from group?` : `Удалить ${username} из группы?`;
        setConfirm({ message: msg, onConfirm: async () => { setConfirm(null); try { const res = await api.removeMember(token, groupId, userId); if (res.success) { setMembers(prev => prev.filter(m => m.id !== userId)); setGroup(g => g ? { ...g, member_count: g.member_count - 1 } : g); } } catch {} } });
    };

    const handleSetMemberRole = async (userId: number, role: 'admin' | 'member') => {
        try {
            const res = await api.setMemberRole(token, groupId, userId, role);
            if (res.success) setMembers(prev => prev.map(m => m.id === userId ? { ...m, role } : m));
        } catch {}
    };

    const handleSetMemberTitle = async (userId: number, title: string) => {
        try {
            const res = await api.setMemberTitle(token, groupId, userId, title);
            if (res.success) setMembers(prev => prev.map(m => m.id === userId ? { ...m, custom_title: title || undefined } : m));
        } catch {}
    };

    const handleSaveChannelSettings = async () => {
        setChannelSettingsSaving(true);
        try {
            const res = await api.updateChannelSettings(token, groupId, editChannelType, editChannelType === 'public' ? editChannelTag : undefined);
            if (res.success) {
                setGroup(g => g ? { ...g, channel_type: editChannelType, channel_tag: editChannelType === 'public' ? editChannelTag : null, invite_link: editChannelType === 'public' ? g.invite_link : null } : g);
                setChannelSettings(false);
            } else setSaveError(res.detail || tr('Error'));
        } catch { setSaveError(tr('Connection error')); } finally { setChannelSettingsSaving(false); }
    };

    const handleSaveGroupSettings = async () => {
        setGroupSettingsSaving(true);
        try {
            if (editWelcome !== (group?.welcome_message || '')) {
                await fetch(`${config.API_URL}/groups/${groupId}/welcome-message?token=${token}&message=${encodeURIComponent(editWelcome)}`, { method: 'PATCH' });
                setGroup(g => g ? { ...g, welcome_message: editWelcome || null } : g);
            }
            setGroupSettings(false);
        } catch { setSaveError(tr('Connection error')); } finally { setGroupSettingsSaving(false); }
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
            if (res.success) {
                await loadGroupInfo();
                setAddMembersResults(prev => prev.filter(u => u.id !== userId));
                setShowAddMembersModal(false);
                setAddMembersSearch('');
                setAddMembersResults([]);
            }
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

    const mediaTabIcons = {
        images: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
        video: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
        audio: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
        files: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
    };
    const mediaTabs = [
        { key: 'images' as const, label: tr('Photo'), count: imgs.length },
        { key: 'video' as const, label: tr('Video'), count: vids.length },
        { key: 'audio' as const, label: tr('Audio'), count: auds.length },
        { key: 'files' as const, label: tr('Files'), count: files.length },
    ];

    const currentTabData = mediaTab === 'images' ? imgs : mediaTab === 'video' ? vids : mediaTab === 'audio' ? auds : files;
    const hasMedia = messages.length > 0;

    const openMediaTab = (tab: typeof mediaTab) => { setMediaTab(tab); setMediaExpanded(true); };

    const isOled = dm && document.body.classList.contains('oled-theme');
    const tk = tokens(dm, isOled);
    const border = !dm ? '#ede9fe' : (isOled ? 'rgba(167,139,250,0.2)' : 'rgba(99,102,241,0.25)');
    const bg = !dm ? '#ffffff' : (isOled ? '#000000' : '#1a1a2e');
    const cardBg = !dm ? '#f5f3ff' : (isOled ? '#050508' : '#12122a');
    const memberBg = !dm ? '#f8f9ff' : (isOled ? '#050508' : '#12122a');
    const sub = dm ? '#6060a0' : '#9ca3af';

    if (loading) {
        return (
            <div style={tk.overlay} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
                <div style={{ ...tk.modalShell }} className={closing ? 'modal-exit' : 'modal-enter'} onClick={e => e.stopPropagation()}>
                    <div style={{ width: 460, padding: '24px 24px 20px' }}>
                        <div style={{ textAlign: 'center', padding: 40, color: dm ? '#9999bb' : '#9ca3af' }}>{tr('Loading...')}</div>

                    </div>
                </div>
            </div>
        );
    }

    const isAdmin = members.find(m => m.id === currentUserId)?.role === 'admin';
    const groupAvatarUrl = config.fileUrl(group?.avatar);
    const isChannel = !!group?.is_channel;
    // Channel sub-modal helper
    const renderMemberRow = (member: GroupMember, showRoleActions: boolean) => (
        <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 14, background: 'transparent', transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.07)' : 'rgba(99,102,241,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: member.avatar ? 'transparent' : (member.role === 'admin' ? 'linear-gradient(135deg,#f59e0b,#f97316)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)'), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, overflow: 'hidden', flexShrink: 0, cursor: onUserClick ? 'pointer' : 'default' }}
                onClick={() => onUserClick?.({ id: member.id, username: member.username, email: member.email, avatar: member.avatar, created_at: member.joined_at })}>
                {member.avatar ? <img src={config.fileUrl(member.avatar) ?? undefined} alt={member.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : member.username[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5, cursor: onUserClick ? 'pointer' : 'default' }}
                    onClick={() => onUserClick?.({ id: member.id, username: member.username, email: member.email, avatar: member.avatar, created_at: member.joined_at })}>
                    {member.username}
                    {(member.tag === 'kayano' || member.tag === 'durov') && <span title={tr('developer of Aurora')} style={{ fontSize: 11, cursor: 'default' }}>🔧</span>}
                </div>
                <div style={{ fontSize: 11, color: member.custom_title ? (isOled ? '#a78bfa' : dm ? '#a5b4fc' : '#6366f1') : (dm ? '#5a5a8a' : '#9ca3af'), marginTop: 1 }}>
                    {member.custom_title
                        ? member.custom_title
                        : member.role === 'admin'
                            ? <span style={{ color: isOled ? '#a78bfa' : dm ? '#a5b4fc' : '#6366f1', fontWeight: 600 }}>★ {lang === 'en' ? 'Admin' : 'Администратор'}</span>
                            : (lang === 'en' ? 'Member' : 'Участник')}
                </div>
            </div>
            {isAdmin && member.id !== currentUserId && showRoleActions && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                        onClick={() => { const t = prompt(lang === 'en' ? 'Set role title (empty to reset)' : 'Введите роль (пусто — сбросить)', member.custom_title || ''); if (t !== null) handleSetMemberTitle(member.id, t.trim()); }}
                        style={{ width: 28, height: 28, borderRadius: 8, background: 'none', border: `1px solid ${dm ? 'rgba(99,102,241,0.25)' : '#ede9fe'}`, color: dm ? '#818cf8' : '#6366f1', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title={lang === 'en' ? 'Set role title' : 'Роль'}>🏷</button>
                    {member.role === 'member'
                        ? <button onClick={() => handleSetMemberRole(member.id, 'admin')} style={{ padding: '0 9px', height: 28, borderRadius: 8, background: isOled ? 'rgba(99,102,241,0.15)' : dm ? 'rgba(99,102,241,0.12)' : '#ede9fe', border: 'none', color: isOled ? '#a78bfa' : dm ? '#a5b4fc' : '#6366f1', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ {lang === 'en' ? 'Admin' : 'Админ'}</button>
                        : <button onClick={() => handleSetMemberRole(member.id, 'member')} style={{ padding: '0 9px', height: 28, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: 'none', color: '#f87171', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>− {lang === 'en' ? 'Rights' : 'Права'}</button>
                    }
                    <button onClick={() => handleRemoveMember(member.id, member.username)} style={{ width: 28, height: 28, background: 'rgba(239,68,68,0.08)', border: 'none', color: '#f87171', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>✕</button>
                </div>
            )}
        </div>
    );

    const channelSubModal = (title: string, onCloseModal: () => void, children: React.ReactNode) => ReactDOM.createPortal(
        <div onClick={onCloseModal} className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 1500, backgroundColor: isOled ? 'rgba(0,0,0,0.88)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.45)'), backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} className="modal-enter" style={{ background: isOled ? '#08080f' : bg, borderRadius: 22, width: 440, maxWidth: '94vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.12), 0 24px 60px rgba(0,0,0,0.98)' : dm ? '0 0 60px rgba(99,102,241,0.2), 0 24px 80px rgba(0,0,0,0.8)' : '0 0 40px rgba(99,102,241,0.1), 0 20px 60px rgba(0,0,0,0.12)', border: isOled ? '1px solid rgba(167,139,250,0.12)' : `1px solid ${border}`, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 17, fontWeight: 700, color: dm ? '#f1f5f9' : '#1e1b4b', letterSpacing: '-0.2px' }}>{title}</span>
                    <button onClick={onCloseModal} style={{ width: 28, height: 28, background: isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%', cursor: 'pointer', color: dm ? '#6060a0' : '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>✕</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 16px', display: 'flex', flexDirection: 'column' }}>
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );

    const isMobile = window.innerWidth <= 768;

    // ── Mobile fullscreen layout ────────────────────────────────────────────────
    if (isMobile) {
        const collapseMedia = () => { setMediaClosing(true); setTimeout(() => { setMediaExpanded(false); setMediaClosing(false); }, 220); };
        const profileLabel = isChannel ? (lang === 'en' ? 'Channel' : 'Канал') : (lang === 'en' ? 'Group' : 'Группа');

        return ReactDOM.createPortal(
            <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 3000, backgroundColor: isOled ? 'rgba(0,0,0,0.88)' : (dm ? 'rgba(15,10,40,0.6)' : 'rgba(15,10,40,0.3)'), backdropFilter: 'blur(10px)' }}
                className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close} />

            {/* Profile screen */}
            <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, top: 0, zIndex: 3001, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                className={closing ? 'mobile-profile-exit' : 'mobile-profile-enter'}
                onClick={e => e.stopPropagation()}>
                {/* Top bar */}
                <div style={{ display: 'flex', alignItems: 'center', padding: "14px 16px 10px", gap: 10, flexShrink: 0 }}>
                    <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: 4, display: 'flex', alignItems: 'center' }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <span style={{ fontWeight: 700, fontSize: 17, color: dm ? '#e2e8f0' : '#1e1b4b', flex: 1 }}>{profileLabel}</span>
                    {isAdmin && isChannel && <button onClick={() => { setShowStats(true); loadStats(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: 4, display: 'flex', alignItems: 'center' }} title={lang === 'en' ? 'Statistics' : 'Статистика'}>
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                    </button>}
                    {isAdmin && <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: 4, display: 'flex', alignItems: 'center' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 32px' }}>
                    {/* Avatar + name */}
                    <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <div style={{ width: 90, height: 90, borderRadius: '50%', background: groupAvatarUrl ? memberBg : 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', overflow: 'hidden', boxShadow: '0 0 24px rgba(99,102,241,0.4)', cursor: groupAvatarUrl ? 'zoom-in' : 'default' }}
                            onClick={() => groupAvatarUrl && setLightbox({ src: groupAvatarUrl, filename: group?.name || 'avatar', isVideo: false })}>
                            {groupAvatarUrl ? <img src={groupAvatarUrl} alt="group" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : <span style={{ fontSize: 34, color: 'white', fontWeight: 700 }}>{group?.name[0]?.toUpperCase()}</span>}
                        </div>
                        <h2 style={{ fontSize: 20, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', margin: '0 0 4px' }}>{group?.name}</h2>
                        <p style={{ fontSize: 13, color: sub, margin: 0 }}>{isChannel ? (lang === 'en' ? 'Channel' : 'Канал') : formatMembers(members.length, 'member', lang)}</p>
                    </div>

                    {/* Description */}
                    {group?.description && (
                        <div style={{ backgroundColor: cardBg, borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase' as const, letterSpacing: '0.6px', marginBottom: 4 }}>{tr('Description')}</div>
                            <div style={{ color: dm ? '#c0c0d8' : '#374151', fontSize: 14 }}>{group.description}</div>
                        </div>
                    )}

                    {/* Media tabs */}
                    {hasMedia && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                            {mediaTabs.map(tab => (
                                <button key={tab.key} onClick={() => openMediaTab(tab.key)}
                                    style={{ padding: '14px 8px', borderRadius: 14, border: 'none', boxShadow: isOled ? '0 2px 12px rgba(0,0,0,0.8)' : dm ? '0 2px 10px rgba(0,0,0,0.35)' : '0 2px 8px rgba(99,102,241,0.07)', background: isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff'), cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: sub }}>
                                    {React.cloneElement(mediaTabIcons[tab.key], { width: 20, height: 20 })}
                                    <span style={{ fontSize: 12, fontWeight: 600 }}>{tab.label}</span>
                                    {tab.count > 0 && <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 700 }}>{tab.count}</span>}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Members list (non-channel groups) */}
                    {!isChannel && members.length > 0 && (
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase' as const, letterSpacing: '0.6px', marginBottom: 8 }}>{lang === 'en' ? 'Members' : 'Участники'} ({members.length})</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {members.slice(0, 15).map(member => renderMemberRow(member, isAdmin))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Settings / edit panel — slides from right */}
            {editing && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 3002, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    className="mobile-media-enter" onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: "14px 16px 10px", gap: 10, flexShrink: 0 }}>
                        <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: 4, display: 'flex', alignItems: 'center' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        <span style={{ fontWeight: 700, fontSize: 17, color: dm ? '#e2e8f0' : '#1e1b4b', flex: 1 }}>
                            {isChannel ? (lang === 'en' ? 'Channel settings' : 'Настройки канала') : (lang === 'en' ? 'Group settings' : 'Настройки группы')}
                        </span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 32px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {/* Avatar */}
                        <div style={{ textAlign: 'center', marginBottom: 20 }}>
                            <div style={{ width: 80, height: 80, borderRadius: '50%', background: groupAvatarUrl ? memberBg : 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', overflow: 'hidden', boxShadow: '0 0 20px rgba(99,102,241,0.4)', cursor: 'pointer', position: 'relative' as const }}
                                onClick={() => fileRef.current?.click()}>
                                {groupAvatarUrl ? <img src={groupAvatarUrl} alt="group" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : <span style={{ fontSize: 30, color: 'white', fontWeight: 700 }}>{group?.name[0]?.toUpperCase()}</span>}
                                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                                </div>
                            </div>
                            <span style={{ fontSize: 12, color: sub }}>{lang === 'en' ? 'Tap to change photo' : 'Нажмите чтобы изменить фото'}</span>
                        </div>

                        {/* Name + description */}
                        <div style={{ backgroundColor: cardBg, borderRadius: 14, padding: '14px', marginBottom: 12, border: `1px solid ${border}` }}>
                            <label style={{ fontSize: 11, fontWeight: 700, color: sub, display: 'block', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.6px' }}>
                                {isChannel ? (lang === 'en' ? 'Channel name' : 'Название канала') : tr('Group name')}
                            </label>
                            <input style={{ ...tk.input, marginBottom: 12 }} value={editName} onChange={e => setEditName(e.target.value)} maxLength={60} />
                            <label style={{ fontSize: 11, fontWeight: 700, color: sub, display: 'block', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.6px' }}>{tr('Description')}</label>
                            <textarea style={{ ...tk.input, height: 80, resize: 'none' as const, marginBottom: 0 }} value={editDesc} onChange={e => setEditDesc(e.target.value)} maxLength={255} />
                        </div>
                        <button onClick={handleSaveEdit} disabled={editSaving || !editName.trim()}
                            style={{ width: '100%', padding: '13px', marginBottom: 20, background: 'linear-gradient(135deg,#6c47d4,#8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 700, opacity: editSaving || !editName.trim() ? 0.6 : 1 }}>
                            {editSaving ? tr('Saving...') : tr('Save')}
                        </button>

                        {/* Channel settings — type + tag */}
                        {isChannel && (
                            <div style={{ backgroundColor: cardBg, borderRadius: 14, padding: '14px', marginBottom: 12, border: `1px solid ${border}` }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase' as const, letterSpacing: '0.6px', marginBottom: 10 }}>
                                    {lang === 'en' ? 'Channel type' : 'Тип канала'}
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginBottom: editChannelType === 'public' ? 12 : 0 }}>
                                    {(['public', 'private'] as const).map(typ => (
                                        <button key={typ} onClick={() => setEditChannelType(typ)}
                                            style={{ flex: 1, padding: '10px', borderRadius: 10, border: editChannelType === typ ? '2px solid #6366f1' : `1.5px solid ${border}`, background: editChannelType === typ ? (dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)') : 'transparent', color: editChannelType === typ ? '#6366f1' : sub, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                            {typ === 'public' ? `🌐 ${lang === 'en' ? 'Public' : 'Публичный'}` : `🔒 ${lang === 'en' ? 'Private' : 'Приватный'}`}
                                        </button>
                                    ))}
                                </div>
                                {editChannelType === 'public' && (
                                    <>
                                        <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 6 }}>{lang === 'en' ? 'Channel tag (without @)' : 'Тег канала (без @)'}</label>
                                        <input style={tk.input} value={editChannelTag} onChange={e => setEditChannelTag(e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase())} placeholder="my_channel" maxLength={32} />
                                    </>
                                )}
                                <button onClick={handleSaveChannelSettings} disabled={channelSettingsSaving || (editChannelType === 'public' && !editChannelTag.trim())}
                                    style={{ width: '100%', padding: '11px', marginTop: 10, background: 'linear-gradient(135deg,#6c47d4,#8b5cf6)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: channelSettingsSaving || (editChannelType === 'public' && !editChannelTag.trim()) ? 0.6 : 1 }}>
                                    {channelSettingsSaving ? tr('Saving...') : `${lang === 'en' ? 'Save channel settings' : 'Сохранить настройки'}`}
                                </button>
                            </div>
                        )}

                        {/* Members — single nav row */}
                        {[
                            { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, label: isChannel ? (group?.member_count ? formatMembers(group.member_count, 'subscriber', lang) : (lang === 'en' ? 'Subscribers' : 'Подписчики')) : (formatMembers(members.length, 'member', lang)), action: () => setMembersSlide('members') },
                            { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>, label: `${lang === 'en' ? 'Admins' : 'Администраторы'} (${members.filter(m => m.role === 'admin').length})`, action: () => setMembersSlide('admins') },
                            ...(isAdmin ? [{ icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>, label: lang === 'en' ? 'Add members' : 'Добавить участников', action: () => { setMembersSlide('add'); setAddMembersSearch(''); setAddMembersResults([]); } }] : []),
                        ].map((item, i, arr) => (
                            <button key={i} onClick={item.action}
                                style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '14px 16px', background: cardBg, border: `1px solid ${border}`, borderRadius: 14, cursor: 'pointer', color: dm ? '#e0e0f0' : '#1e1b4b', fontSize: 14, fontWeight: 500, marginBottom: i < arr.length - 1 ? 8 : 12 }}>
                                <span style={{ color: '#6366f1', display: 'flex', alignItems: 'center' }}>{item.icon}</span>
                                <span style={{ flex: 1, textAlign: 'left' as const }}>{item.label}</span>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={sub} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                            </button>
                        ))}

                        {/* Leave / delete */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                            <button onClick={() => setConfirm({ message: lang === 'en' ? `Delete ${isChannel ? 'channel' : 'group'} "${group?.name}"?` : `Удалить ${isChannel ? 'канал' : 'группу'} «${group?.name}»?`, onConfirm: handleDeleteGroup })}
                                style={{ width: '100%', padding: '13px', background: dm ? 'rgba(239,68,68,0.1)' : '#fff0f0', color: '#ef4444', border: `1px solid ${dm ? 'rgba(239,68,68,0.3)' : '#ffcdd2'}`, borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                                🗑 {lang === 'en' ? `Delete ${isChannel ? 'channel' : 'group'}` : `Удалить ${isChannel ? 'канал' : 'группу'}`}
                            </button>
                            <button onClick={() => setConfirm({ message: lang === 'en' ? `Leave ${isChannel ? 'channel' : 'group'}?` : `Покинуть ${isChannel ? 'канал' : 'группу'}?`, onConfirm: handleLeaveGroup })}
                                style={{ width: '100%', padding: '13px', background: dm ? 'rgba(239,68,68,0.06)' : '#fff8f8', color: '#f87171', border: `1px solid ${dm ? 'rgba(239,68,68,0.2)' : '#fecaca'}`, borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                                🚪 {lang === 'en' ? `Leave ${isChannel ? 'channel' : 'group'}` : `Покинуть ${isChannel ? 'канал' : 'группу'}`}
                            </button>
                            {onReport && !isAdmin && (
                                <button onClick={() => onReport('group', groupId, group?.name || '')}
                                    style={{ width: '100%', padding: '11px', background: 'transparent', color: '#ef4444', border: `1.5px solid rgba(239,68,68,0.25)`, borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                                    {lang === 'en' ? `Report ${isChannel ? 'channel' : 'group'}` : `Пожаловаться на ${isChannel ? 'канал' : 'группу'}`}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Group settings panel — slides from right */}
            {groupSettings && !isChannel && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 3002, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    className="mobile-media-enter" onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 10px', gap: 10, flexShrink: 0 }}>
                        <button onClick={() => setGroupSettings(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: 4, display: 'flex', alignItems: 'center' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        <span style={{ fontWeight: 700, fontSize: 17, color: dm ? '#e2e8f0' : '#1e1b4b', flex: 1 }}>
                            {lang === 'en' ? 'Group settings' : 'Настройки группы'}
                        </span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 32px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {/* Slow mode */}
                        <div style={{ backgroundColor: cardBg, borderRadius: 14, padding: '14px', marginBottom: 12, border: `1px solid ${border}` }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase' as const, letterSpacing: '0.6px', marginBottom: 6 }}>
                                🐢 {lang === 'en' ? 'Slow mode' : 'Медленный режим'}
                            </div>
                            <div style={{ fontSize: 12, color: sub, marginBottom: 10 }}>
                                {lang === 'en' ? 'Limit how often members can send messages.' : 'Ограничьте частоту отправки сообщений участниками.'}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                                {([0, 10, 30, 60, 300, 3600] as const).map(s => (
                                    <button key={s} onClick={async () => {
                                        if (!isAdmin || slowModeSaving) return;
                                        setSlowModeSaving(true);
                                        try {
                                            const res = await fetch(`${config.API_URL}/groups/${groupId}/slow-mode?token=${token}&seconds=${s}`, { method: 'PATCH' });
                                            if ((await res.json()).success) setSlowMode(s);
                                        } catch {} finally { setSlowModeSaving(false); }
                                    }} style={{ padding: '6px 10px', borderRadius: 8, border: slowMode === s ? '2px solid #6366f1' : `1.5px solid ${border}`, background: slowMode === s ? (dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)') : 'transparent', color: slowMode === s ? '#6366f1' : sub, cursor: isAdmin ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}>
                                        {s === 0 ? (lang === 'en' ? 'Off' : 'Выкл') : s < 60 ? `${s}с` : s < 3600 ? `${s / 60}м` : `${s / 3600}ч`}
                                    </button>
                                ))}
                            </div>
                            {slowMode > 0 && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 8 }}>⏳ {lang === 'en' ? `Members can send 1 message every ${slowMode < 60 ? `${slowMode}s` : slowMode < 3600 ? `${slowMode / 60}m` : `${slowMode / 3600}h`}` : `Участники могут писать раз в ${slowMode < 60 ? `${slowMode}с` : slowMode < 3600 ? `${slowMode / 60}м` : `${slowMode / 3600}ч`}`}</div>}
                        </div>
                        {/* Welcome message */}
                        <div style={{ backgroundColor: cardBg, borderRadius: 14, padding: '14px', marginBottom: 12, border: `1px solid ${border}` }}>
                            <label style={{ fontSize: 11, fontWeight: 700, color: sub, display: 'block', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.6px' }}>
                                👋 {lang === 'en' ? 'Welcome message' : 'Приветственное сообщение'}
                            </label>
                            <div style={{ fontSize: 12, color: sub, marginBottom: 8 }}>
                                {lang === 'en' ? 'Sent automatically to new members. Use {name} for their username.' : 'Отправляется новым участникам. Используйте {name} для имени.'}
                            </div>
                            <textarea
                                value={editWelcome}
                                onChange={e => setEditWelcome(e.target.value)}
                                rows={3}
                                maxLength={500}
                                placeholder={lang === 'en' ? 'Welcome to the group, {name}!' : 'Добро пожаловать, {name}!'}
                                style={{ ...tk.input, resize: 'none' as const, lineHeight: 1.5 }}
                            />
                        </div>
                        {saveError && <div style={{ fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 10 }}>⚠ {saveError}</div>}
                        <button onClick={handleSaveGroupSettings} disabled={groupSettingsSaving}
                            style={{ width: '100%', padding: '13px', marginBottom: 20, background: 'linear-gradient(135deg,#6c47d4,#8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 700, opacity: groupSettingsSaving ? 0.6 : 1 }}>
                            {groupSettingsSaving ? tr('Saving...') : tr('Save')}
                        </button>
                    </div>
                </div>
            )}

            {/* Stats panel */}
            {showStats && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 3003, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    className="mobile-media-enter" onClick={e => e.stopPropagation()}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px 10px', gap: 10, flexShrink: 0, borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)'}` }}>
                        <button onClick={() => setShowStats(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: 4, display: 'flex', alignItems: 'center' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        <span style={{ fontWeight: 700, fontSize: 17, color: dm ? '#e2e8f0' : '#1e1b4b', flex: 1 }}>{lang === 'en' ? 'Statistics' : 'Статистика'}</span>
                        {statsLoading && <div style={{ width: 18, height: 18, border: `2px solid ${dm ? 'rgba(99,102,241,0.3)' : '#d0cbff'}`, borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {!stats && !statsLoading && <div style={{ textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', padding: 40 }}>{lang === 'en' ? 'No data' : 'Нет данных'}</div>}
                        {stats && (() => {
                            const cardBg2 = isOled ? '#0a0a14' : dm ? '#1a1a2e' : '#f5f3ff';
                            const accent = '#6366f1';
                            const Card = ({ children }: { children: React.ReactNode }) => (
                                <div style={{ background: cardBg2, borderRadius: 14, padding: '14px 16px', border: `1px solid ${isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.15)' : '#e8e4ff'}` }}>{children}</div>
                            );
                            const SectionLabel = ({ label }: { label: string }) => (
                                <div style={{ fontSize: 10, fontWeight: 700, color: isOled ? '#4a3a6a' : dm ? '#4a4a6a' : '#9ca3af', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 10 }}>{label}</div>
                            );
                            // Mini bar chart
                            const BarChart = ({ data, color }: { data: { date: string; count: number }[]; color: string }) => {
                                if (!data || !data.length) return <div style={{ fontSize: 12, color: dm ? '#5a5a8a' : '#9ca3af' }}>{lang === 'en' ? 'No data for last 30 days' : 'Нет данных за 30 дней'}</div>;
                                const max = Math.max(...data.map(d => d.count), 1);
                                return (
                                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 48, width: '100%' }}>
                                        {data.map((d, i) => (
                                            <div key={i} title={`${d.date}: ${d.count}`} style={{ flex: 1, minWidth: 2, background: color, opacity: 0.75, borderRadius: '2px 2px 0 0', height: `${Math.max(4, (d.count / max) * 100)}%`, transition: 'height 0.3s' }} />
                                        ))}
                                    </div>
                                );
                            };
                            return (
                                <>
                                    {/* KPI row */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                                        {[
                                            { label: lang === 'en' ? 'Subscribers' : 'Подписчики', value: stats.total_members, color: '#6366f1' },
                                            { label: lang === 'en' ? 'Posts' : 'Публикаций', value: stats.total_posts, color: '#8b5cf6' },
                                            { label: lang === 'en' ? 'Avg views' : 'Ср. охват', value: stats.avg_views, color: '#06b6d4' },
                                            { label: lang === 'en' ? 'Reactions' : 'Реакций', value: stats.total_reactions, color: '#f43f5e' },
                                        ].map(kpi => (
                                            <div key={kpi.label} style={{ background: cardBg2, borderRadius: 14, padding: '14px 16px', border: `1px solid ${isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}` }}>
                                                <div style={{ width: 3, height: 20, borderRadius: 2, background: kpi.color, marginBottom: 10 }} />
                                                <div style={{ fontSize: 26, fontWeight: 800, color: dm ? '#e2e8f0' : '#1e1b4b', lineHeight: 1, letterSpacing: '-0.5px' }}>{typeof kpi.value === 'number' ? kpi.value.toLocaleString() : (kpi.value ?? '—')}</div>
                                                <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 4, fontWeight: 500 }}>{kpi.label}</div>
                                            </div>
                                        ))}
                                    </div>
                                    {/* Growth chart */}
                                    <Card>
                                        <SectionLabel label={lang === 'en' ? 'Subscriber growth (30d)' : 'Рост подписчиков (30д)'} />
                                        <BarChart data={stats.growth_chart || []} color={accent} />
                                    </Card>
                                    {/* Posts activity */}
                                    <Card>
                                        <SectionLabel label={lang === 'en' ? 'Post activity (30d)' : 'Активность постов (30д)'} />
                                        <BarChart data={stats.posts_chart || []} color='#06b6d4' />
                                    </Card>
                                    {/* Peak hour */}
                                    {stats.peak_hour !== null && stats.peak_hour !== undefined && (
                                        <Card>
                                            <SectionLabel label={lang === 'en' ? 'Peak activity' : 'Пиковая активность'} />
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div style={{ fontSize: 28 }}>🕐</div>
                                                <div>
                                                    <div style={{ fontSize: 18, fontWeight: 700, color: dm ? '#e2e8f0' : '#1e1b4b' }}>{stats.peak_hour}:00 – {stats.peak_hour + 1}:00</div>
                                                    <div style={{ fontSize: 12, color: dm ? '#5a5a8a' : '#9ca3af' }}>{lang === 'en' ? 'Most posts published' : 'Больше всего публикаций'}</div>
                                                </div>
                                            </div>
                                        </Card>
                                    )}
                                    {/* Top posts */}
                                    {stats.top_posts?.length > 0 && (
                                        <Card>
                                            <SectionLabel label={lang === 'en' ? 'Top posts by views' : 'Топ постов по просмотрам'} />
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {stats.top_posts.map((p: any, i: number) => (
                                                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < stats.top_posts.length - 1 ? `1px solid ${isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.08)' : '#ede9fe'}` : 'none' }}>
                                                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: `${accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: accent, flexShrink: 0 }}>#{i + 1}</div>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{ fontSize: 12, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.text || `[${lang === 'en' ? 'Media' : 'Медиа'}]`}</div>
                                                            <div style={{ fontSize: 10, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 1 }}>{p.views} {lang === 'en' ? 'views' : 'просмотров'}</div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </Card>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Participants slide */}
            {membersSlide && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 3003, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    className="mobile-media-enter" onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: "14px 16px 10px", gap: 10, flexShrink: 0 }}>
                        <button onClick={() => setMembersSlide(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: 4, display: 'flex', alignItems: 'center' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        <span style={{ fontWeight: 700, fontSize: 17, color: dm ? '#e2e8f0' : '#1e1b4b', flex: 1 }}>
                            {membersSlide === 'admins' ? (lang === 'en' ? 'Admins' : 'Администраторы')
                             : membersSlide === 'add' ? (lang === 'en' ? 'Add members' : 'Добавить участников')
                             : (lang === 'en' ? (isChannel ? 'Subscribers' : 'Members') : (isChannel ? 'Подписчики' : 'Участники'))}
                        </span>
                        {membersSlide === 'members' && !isChannel && isAdmin && (
                            <button onClick={onInvite} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6366f1', padding: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600 }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                                {tr('Invite')}
                            </button>
                        )}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 32px' }}>
                        {membersSlide === 'add' ? (
                            <>
                                <input type="text" placeholder={tr('@user_tag')} value={addMembersSearch} onChange={e => searchAddMembers(e.target.value)}
                                    style={{ ...tk.input, margin: '12px 0 8px' }} autoFocus />
                                {addMembersLoading && <div style={{ textAlign: 'center', color: sub, padding: 16 }}>{tr('Searching...')}</div>}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {addMembersResults.map((u: any) => (
                                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, backgroundColor: memberBg, border: `1px solid ${border}` }}>
                                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: u.avatar ? memberBg : '#6366f1', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, overflow: 'hidden', flexShrink: 0 }}>
                                                {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt={u.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.username[0].toUpperCase()}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 14, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                                {u.tag && <div style={{ fontSize: 11, color: sub }}>@{u.tag}</div>}
                                            </div>
                                            <button onClick={() => handleAddMember(u.id, u.tag)} style={{ padding: '8px 16px', borderRadius: 10, background: 'linear-gradient(135deg,#6c47d4,#8b5cf6)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{tr('Add')}</button>
                                        </div>
                                    ))}
                                    {!addMembersLoading && addMembersSearch && addMembersResults.length === 0 && (
                                        <div style={{ textAlign: 'center', color: sub, padding: 32 }}>{lang === 'en' ? 'Not found' : 'Не найдено'}</div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
                                {(membersSlide === 'admins'
                                    ? members.filter(m => m.role === 'admin')
                                    : members
                                ).map(member => renderMemberRow(member, isAdmin && membersSlide !== 'members'))}
                                {membersSlide === 'members' && members.length === 0 && (
                                    <div style={{ textAlign: 'center', color: sub, padding: 32 }}>{lang === 'en' ? 'No members yet' : 'Участников пока нет'}</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Media panel — fullscreen slide from right */}
            {mediaExpanded && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 3002, backgroundColor: bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    className={mediaClosing ? 'mobile-media-exit' : 'mobile-media-enter'}
                    onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: "14px 16px 10px", gap: 10, flexShrink: 0 }}>
                        <button onClick={collapseMedia} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: 4, display: 'flex', alignItems: 'center' }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        <span style={{ fontWeight: 700, fontSize: 17, color: dm ? '#e2e8f0' : '#1e1b4b', flex: 1 }}>{mediaTabs.find(t => t.key === mediaTab)?.label || ''}</span>
                    </div>
                    <div style={{ display: 'flex', padding: '8px 12px', gap: 4, borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                        {mediaTabs.map(tab => {
                            const isActive = mediaTab === tab.key;
                            return <button key={tab.key} onClick={() => setMediaTab(tab.key)}
                                style={{ flex: 1, padding: '8px 4px', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 11, fontWeight: 700, background: isActive ? (isOled ? 'rgba(167,139,250,0.15)' : dm ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.1)') : 'transparent', color: isActive ? '#6366f1' : sub, transition: 'all 0.15s' }}>
                                {tab.label}{tab.count > 0 && <span style={{ marginLeft: 4, fontSize: 10 }}>({tab.count})</span>}
                            </button>;
                        })}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: (mediaTab === 'images' || mediaTab === 'video') ? 8 : 0 }}>
                        {currentTabData.length === 0 ? (
                            <div style={{ padding: 40, textAlign: 'center', color: sub, fontSize: 14 }}>{tr('No files')}</div>
                        ) : (mediaTab === 'images' || mediaTab === 'video') ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
                                {currentTabData.map((f: any, i: number) => (
                                    <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', cursor: 'pointer', background: dm ? '#252540' : '#f0f0f8' }}
                                        onClick={() => setLightbox({ src: f.src, filename: f.filename, isVideo: isVid(f.filename) })}>
                                        {isVid(f.filename) ? <video src={f.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={f.src} alt={f.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                        {isVid(f.filename) && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: 'white', fontSize: 12, marginLeft: 2 }}>▶</span></div></div>}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div>
                                {currentTabData.map((f: any, i: number) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)'}` }}>
                                        <div style={{ width: 40, height: 40, borderRadius: 10, background: dm ? '#252540' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#6366f1' }}>
                                            {mediaTab === 'audio' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> : <span style={{ fontSize: 10, fontWeight: 700 }}>{f.filename.split('.').pop()?.toUpperCase() || 'FILE'}</span>}
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

            {/* Sub-modals for members/admins/add — shared with desktop via portals */}
            {showMembersModal && channelSubModal(group?.member_count ? formatMembers(group.member_count, isChannel ? 'subscriber' : 'member', lang) : (lang === 'en' ? 'Members' : 'Участники'), () => setShowMembersModal(false), members.map(m => renderMemberRow(m, false)))}
            {showAdminsModal && channelSubModal(lang === 'en' ? 'Admins' : 'Администраторы', () => setShowAdminsModal(false),
                <>
                    {members.filter(m => m.role === 'admin').map(m => renderMemberRow(m, true))}
                    {members.filter(m => m.role !== 'admin').length > 0 && (<>
                        <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase' as const, letterSpacing: '0.6px', marginTop: 8, marginBottom: 4 }}>{lang === 'en' ? 'Members' : 'Участники'}</div>
                        {members.filter(m => m.role !== 'admin').map(m => renderMemberRow(m, true))}
                    </>)}
                </>
            )}
            {showAddMembersModal && channelSubModal(lang === 'en' ? 'Add members' : 'Добавить участников', () => setShowAddMembersModal(false),
                <>
                    <input type="text" placeholder={tr('@user_tag')} value={addMembersSearch} onChange={e => searchAddMembers(e.target.value)} style={{ ...tk.input, marginBottom: 8 }} autoFocus />
                    {addMembersLoading && <div style={{ textAlign: 'center', color: sub, fontSize: 13 }}>{tr('Searching...')}</div>}
                    {addMembersResults.map((u: any) => (
                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, backgroundColor: memberBg, border: !dm ? '1px solid #ede9fe' : '1px solid rgba(99,102,241,0.1)' }}>
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: u.avatar ? memberBg : '#6366f1', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, overflow: 'hidden', flexShrink: 0 }}>
                                {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt={u.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.username[0].toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                {u.tag && <div style={{ fontSize: 11, color: sub }}>@{u.tag}</div>}
                            </div>
                            <button onClick={() => handleAddMember(u.id, u.tag)} style={{ padding: '6px 14px', borderRadius: 8, background: 'linear-gradient(135deg,#6c47d4,#8b5cf6)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{tr('Add')}</button>
                        </div>
                    ))}
                    {!addMembersLoading && addMembersSearch && addMembersResults.length === 0 && <div style={{ textAlign: 'center', color: sub, fontSize: 13 }}>{lang === 'en' ? 'Not found' : 'Не найдено'}</div>}
                </>
            )}
            {confirm && ReactDOM.createPortal(
                <div onClick={() => setConfirm(null)} className="modal-backdrop-enter"
                    style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} className="modal-enter"
                        style={{ background: bg, borderRadius: 20, width: 320, maxWidth: '90vw', padding: '28px 24px 22px', boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.18), 0 8px 40px rgba(0,0,0,0.95)' : dm ? '0 0 40px rgba(99,102,241,0.3)' : '0 0 40px rgba(99,102,241,0.12)', border: `1px solid ${border}`, textAlign: 'center' }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', marginBottom: 8 }}>{tr('This cannot be undone.')}</div>
                        <div style={{ fontSize: 14, color: sub, marginBottom: 24 }}>{confirm.message}</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => setConfirm(null)} style={{ flex: 1, padding: '12px', borderRadius: 12, border: `1.5px solid ${border}`, background: cardBg, color: dm ? '#c0c0d8' : '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{tr('Cancel')}</button>
                            <button onClick={confirm.onConfirm} style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#e53935,#ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{tr('Delete')}</button>
                        </div>
                    </div>
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

    // ── Desktop layout ──────────────────────────────────────────────────────────
    return (
        <>
        <div style={tk.overlay} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
            <div
                style={{
                    ...tk.modalShell,
                    width: mediaExpanded ? Math.min(840, window.innerWidth * 0.94) : 460,
                    transition: 'width 0.32s cubic-bezier(0.4,0,0.2,1)',
                }}
                className={`group-info-shell ${closing ? 'modal-exit' : 'modal-enter'}`}
                onClick={e => e.stopPropagation()}
            >
                {/* Left panel — group info */}
                <div className="group-info-left" style={{ width: 460, flexShrink: 0, boxSizing: 'border-box', overflowY: 'auto', maxHeight: '88vh' }}>

                    {/* ── Hero section ── */}
                    <div style={{ position: 'relative', paddingBottom: 20 }}>
                        {/* Blurred avatar backdrop */}
                        {groupAvatarUrl && (
                            <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${groupAvatarUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(28px) brightness(0.4)', borderRadius: '20px 20px 0 0', opacity: 0.6, pointerEvents: 'none' }} />
                        )}
                        {!groupAvatarUrl && (
                            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(99,102,241,0.35),rgba(139,92,246,0.2))', borderRadius: '20px 20px 0 0', pointerEvents: 'none' }} />
                        )}

                        {/* Close + stats buttons */}
                        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px 0' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                                {isAdmin && isChannel && !editing && (
                                    <button onClick={() => { setShowStats(true); loadStats(); }} title={lang === 'en' ? 'Statistics' : 'Статистика'} style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', border: 'none', cursor: 'pointer', color: 'white', padding: '6px 8px', borderRadius: 10, display: 'flex', alignItems: 'center' }}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                                    </button>
                                )}
                            </div>
                            {!mediaExpanded && (
                                <button onClick={close} style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>✕</button>
                            )}
                        </div>

                        {/* Avatar */}
                        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16 }}>
                            <div
                                style={{ width: 96, height: 96, borderRadius: '50%', background: groupAvatarUrl ? 'transparent' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '3px solid rgba(255,255,255,0.15)', cursor: groupAvatarUrl ? 'zoom-in' : (isAdmin ? 'pointer' : 'default'), flexShrink: 0 }}
                                onClick={() => {
                                    if (groupAvatarUrl) setLightbox({ src: groupAvatarUrl, filename: group?.name || 'avatar', isVideo: false });
                                    else if (isAdmin) fileRef.current?.click();
                                }}
                            >
                                {uploadingAvatar
                                    ? <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 22, height: 22, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /></div>
                                    : groupAvatarUrl
                                        ? <img src={groupAvatarUrl} alt="group" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <span style={{ fontSize: 38, color: 'white', fontWeight: 700 }}>{group?.name[0]?.toUpperCase()}</span>
                                }
                            </div>
                            <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />

                            {/* Name + meta */}
                            <div style={{ textAlign: 'center', marginTop: 12, paddingInline: 16 }}>
                                <div style={{ fontSize: 20, fontWeight: 800, color: 'white', letterSpacing: '-0.3px', textShadow: '0 1px 8px rgba(0,0,0,0.4)' }}>{group?.name}</div>
                                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 3 }}>
                                    {group?.member_count ? formatMembers(group.member_count, isChannel ? 'subscriber' : 'member', lang) : ''}
                                    {group?.created_at && <span style={{ marginLeft: 6, opacity: 0.8 }}>· {new Date(group.created_at).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
                                </div>
                            </div>
                        </div>

                        {/* Admin quick-action pills */}
                        {isAdmin && !editing && (
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, paddingInline: 16, position: 'relative' }}>
                                <button onClick={() => setEditing(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    {tr('Edit')}
                                </button>
                                {isAdmin && (
                                    <button onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                                        {tr('Change photo')}
                                    </button>
                                )}
                                {isChannel && (
                                    <button onClick={() => { setChannelSettings(true); setEditChannelType(group?.channel_type || 'public'); setEditChannelTag(group?.channel_tag || ''); }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                                        {lang === 'en' ? 'Settings' : 'Настройки'}
                                    </button>
                                )}
                                {!isChannel && (
                                    <button onClick={() => { setGroupSettings(true); setEditWelcome(group?.welcome_message || ''); }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                                        {lang === 'en' ? 'Settings' : 'Настройки'}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── Content section ── */}
                    <div style={{ padding: '16px 20px 20px' }}>

                    {/* Edit form */}
                    {editing ? (
                        <div style={{ marginBottom: 16 }}>
                            <label style={{ fontSize: 11, fontWeight: 700, color: dm ? '#7c7caa' : '#6b7280', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{tr('Group name')}</label>
                            <input style={tk.input} value={editName} onChange={e => setEditName(e.target.value)} maxLength={60} />
                            <label style={{ fontSize: 11, fontWeight: 700, color: dm ? '#7c7caa' : '#6b7280', display: 'block', marginBottom: 4, marginTop: 10, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{tr('Description')}</label>
                            <textarea style={{ ...tk.input, height: 60, resize: 'vertical' as const }} value={editDesc} onChange={e => setEditDesc(e.target.value)} maxLength={255} />
                            {saveError && <div style={{ fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 8, padding: '6px 10px', marginTop: 8 }}>⚠ {saveError}</div>}
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                <button onClick={() => { setSaveError(''); handleSaveEdit(); }} disabled={editSaving || !editName.trim()} style={tk.btnPrimary}>{editSaving ? tr('Saving...') : tr('Save')}</button>
                                <button onClick={() => { setEditing(false); setSaveError(''); }} style={tk.btnCancel}>{tr('Cancel')}</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Description */}
                            {group?.description && (
                                <div style={{ fontSize: 14, color: dm ? '#c0c0d8' : '#374151', lineHeight: 1.5, marginBottom: 16, padding: '10px 14px', background: dm ? 'rgba(99,102,241,0.07)' : 'rgba(99,102,241,0.04)', borderRadius: 12, borderLeft: '3px solid rgba(99,102,241,0.4)' }}>
                                    {group.description}
                                </div>
                            )}

                            {/* Channel settings inline */}
                            {isAdmin && isChannel && channelSettings && (
                                <div style={{ backgroundColor: cardBg, border: !dm ? '1px solid #ede9fe' : ('1px solid rgba(99,102,241,0.15)'), borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: dm ? '#7c7caa' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10 }}>{lang === 'en' ? 'Channel settings' : 'Настройки канала'}</div>
                                    <div style={{ display: 'flex', gap: 8, marginBottom: editChannelType === 'public' ? 10 : 0 }}>
                                        {(['public', 'private'] as const).map(typ => (
                                            <button key={typ} onClick={() => setEditChannelType(typ)}
                                                style={{ flex: 1, padding: '8px', borderRadius: 10, border: editChannelType === typ ? '2px solid #6366f1' : dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', background: editChannelType === typ ? (dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)') : 'transparent', color: editChannelType === typ ? '#6366f1' : (dm ? '#9090b0' : '#6b7280'), cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                                {typ === 'public' ? tr('🌐 Public') : tr('🔒 Private')}
                                            </button>
                                        ))}
                                    </div>
                                    {editChannelType === 'public' && (
                                        <div>
                                            <label style={{ fontSize: 11, color: dm ? '#7c7caa' : '#6b7280', display: 'block', marginBottom: 4 }}>{lang === 'en' ? 'Channel tag (without @)' : 'Тег канала (без @)'}</label>
                                            <input style={tk.input} value={editChannelTag} onChange={e => setEditChannelTag(e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase())} placeholder="my_channel" maxLength={32} />
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                        <button onClick={handleSaveChannelSettings} disabled={channelSettingsSaving || (editChannelType === 'public' && !editChannelTag.trim())} style={tk.btnPrimary}>{channelSettingsSaving ? tr('Saving...') : tr('Save')}</button>
                                        <button onClick={() => setChannelSettings(false)} style={tk.btnCancel}>{tr('Cancel')}</button>
                                    </div>
                                </div>
                            )}

                            {/* Group settings inline */}
                            {isAdmin && !isChannel && groupSettings && (
                                <div style={{ backgroundColor: cardBg, border: !dm ? '1px solid #ede9fe' : '1px solid rgba(99,102,241,0.15)', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: dm ? '#7c7caa' : '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.6px', marginBottom: 10 }}>{lang === 'en' ? 'Group settings' : 'Настройки группы'}</div>
                                    {/* Slow mode */}
                                    <div style={{ fontSize: 11, fontWeight: 600, color: sub, marginBottom: 6 }}>🐢 {lang === 'en' ? 'Slow mode' : 'Медленный режим'}</div>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 12 }}>
                                        {([0, 10, 30, 60, 300, 3600] as const).map(s => (
                                            <button key={s} onClick={async () => {
                                                if (!isAdmin || slowModeSaving) return;
                                                setSlowModeSaving(true);
                                                try {
                                                    const res = await fetch(`${config.API_URL}/groups/${groupId}/slow-mode?token=${token}&seconds=${s}`, { method: 'PATCH' });
                                                    if ((await res.json()).success) setSlowMode(s);
                                                } catch {} finally { setSlowModeSaving(false); }
                                            }} style={{ padding: '5px 9px', borderRadius: 8, border: slowMode === s ? '2px solid #6366f1' : dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', background: slowMode === s ? (dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)') : 'transparent', color: slowMode === s ? '#6366f1' : (dm ? '#9090b0' : '#6b7280'), cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                                                {s === 0 ? (lang === 'en' ? 'Off' : 'Выкл') : s < 60 ? `${s}с` : s < 3600 ? `${s / 60}м` : `${s / 3600}ч`}
                                            </button>
                                        ))}
                                    </div>
                                    {slowMode > 0 && <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 12 }}>⏳ {lang === 'en' ? `Members can send 1 message every ${slowMode < 60 ? `${slowMode}s` : slowMode < 3600 ? `${slowMode / 60}m` : `${slowMode / 3600}h`}` : `Участники могут писать раз в ${slowMode < 60 ? `${slowMode}с` : slowMode < 3600 ? `${slowMode / 60}м` : `${slowMode / 3600}ч`}`}</div>}
                                    {/* Welcome message */}
                                    <div style={{ fontSize: 11, fontWeight: 600, color: sub, marginBottom: 6 }}>👋 {lang === 'en' ? 'Welcome message' : 'Приветственное сообщение'}</div>
                                    <textarea
                                        value={editWelcome}
                                        onChange={e => setEditWelcome(e.target.value)}
                                        rows={2}
                                        maxLength={500}
                                        placeholder={lang === 'en' ? 'Welcome to the group, {name}!' : 'Добро пожаловать, {name}!'}
                                        style={{ ...tk.input, resize: 'none' as const, lineHeight: 1.5, marginBottom: 10 }}
                                    />
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button onClick={handleSaveGroupSettings} disabled={groupSettingsSaving} style={tk.btnPrimary}>{groupSettingsSaving ? tr('Saving...') : tr('Save')}</button>
                                        <button onClick={() => setGroupSettings(false)} style={tk.btnCancel}>{tr('Cancel')}</button>
                                    </div>
                                </div>
                            )}

                            {/* Leave + Delete + Report — subtle list */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                                <button onClick={handleLeaveGroup} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, border: 'none', background: dm ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)', color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'left' as const }}>
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                                    {isChannel ? (lang === 'en' ? 'Leave channel' : 'Покинуть канал') : tr('Leave group')}
                                </button>
                                {isAdmin && (
                                    <button onClick={handleDeleteGroup} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, border: 'none', background: dm ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)', color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'left' as const }}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                                        {isChannel ? (lang === 'en' ? 'Delete channel' : 'Удалить канал') : tr('Delete group')}
                                    </button>
                                )}
                                {onReport && (
                                    <button onClick={() => onReport('group', groupId, group?.name || '')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, border: 'none', background: dm ? 'rgba(239,68,68,0.05)' : 'rgba(239,68,68,0.04)', color: dm ? '#f87171' : '#dc2626', cursor: 'pointer', fontSize: 13, fontWeight: 500, textAlign: 'left' as const, opacity: 0.8 }}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                                        {lang === 'en' ? `Report ${isChannel ? 'channel' : 'group'}` : `Пожаловаться на ${isChannel ? 'канал' : 'группу'}`}
                                    </button>
                                )}
                            </div>
                        </>
                    )}


                    {/* Media shortcut buttons */}
                    {hasMedia && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                            {mediaTabs.map(tab => {
                                const isActive = mediaExpanded && mediaTab === tab.key;
                                return (
                                <button key={tab.key} onClick={() => openMediaTab(tab.key)}
                                    style={{
                                        padding: '12px 8px', borderRadius: 14,
                                        border: 'none',
                                        boxShadow: isActive
                                            ? `0 0 0 2px #6366f1, 0 4px 16px rgba(99,102,241,0.25)`
                                            : isOled ? '0 2px 12px rgba(0,0,0,0.8)' : dm ? '0 2px 10px rgba(0,0,0,0.35)' : '0 2px 8px rgba(99,102,241,0.07)',
                                        background: isActive
                                            ? dm ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.08)'
                                            : isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff'),
                                        cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                                        transition: 'all 0.18s',
                                        color: isActive ? '#6366f1' : sub,
                                    }}>
                                    {mediaTabIcons[tab.key]}
                                    <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? '#6366f1' : sub }}>{tab.label}</span>
                                    {tab.count > 0 && <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700 }}>{tab.count}</span>}
                                </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Members — channel shows buttons, group shows inline */}
                    {isChannel ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {[
                                { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, label: group?.member_count ? formatMembers(group.member_count, isChannel ? 'subscriber' : 'member', lang) : (lang === 'en' ? 'Members' : 'Участники'), action: () => setShowMembersModal(true) },
                                { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>, label: `${lang === 'en' ? 'Admins' : 'Администраторы'} (${members.filter(m => m.role === 'admin').length})`, action: () => setShowAdminsModal(true) },
                                ...(isAdmin ? [{ icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>, label: lang === 'en' ? 'Add members' : 'Добавить участников', action: () => { setShowAddMembersModal(true); setAddMembersSearch(''); setAddMembersResults([]); } }] : []),
                            ].map((item, idx) => (
                                <button key={idx} onClick={item.action}
                                    style={{ width: '100%', padding: '11px 14px', borderRadius: 12, border: 'none', background: isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.07)' : 'rgba(99,102,241,0.05)', color: dm ? '#e0e0f0' : '#1e1b4b', cursor: 'pointer', fontSize: 14, fontWeight: 500, textAlign: 'left' as const, display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.15s' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.12)' : dm ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.1)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.07)' : 'rgba(99,102,241,0.05)')}>
                                    <span style={{ width: 32, height: 32, borderRadius: 10, background: isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.12)' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOled ? '#a78bfa' : '#6366f1', flexShrink: 0 }}>{item.icon}</span>
                                    {item.label}
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', color: sub, flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                                </button>
                            ))}
                        </div>
                    ) : (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ color: isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{lang === 'en' ? 'Members' : 'Участники'}</span>
                            {isAdmin && <button onClick={onInvite} style={{ ...tk.btnInvite, fontSize: 12, padding: '4px 10px' }}>+ {tr('Invite')}</button>}
                        </div>
                        <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                            {members.map(member => (
                                <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 8px', borderRadius: 12, transition: 'background 0.15s', cursor: onUserClick ? 'pointer' : 'default' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.07)' : 'rgba(99,102,241,0.05)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    onClick={() => onUserClick?.({ id: member.id, username: member.username, email: member.email, avatar: member.avatar, created_at: member.joined_at })}>
                                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: member.avatar ? 'transparent' : (member.role === 'admin' ? 'linear-gradient(135deg,#f59e0b,#f97316)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)'), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, overflow: 'hidden', flexShrink: 0 }}>
                                        {member.avatar
                                            ? <img src={config.fileUrl(member.avatar) ?? undefined} alt={member.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            : member.username[0].toUpperCase()
                                        }
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                                            {member.username}
                                            {(member.tag === 'kayano' || member.tag === 'durov') && <span title={tr('developer of Aurora')} style={{ fontSize: 11, cursor: 'default', flexShrink: 0 }}>🔧</span>}
                                        </div>
                                        <div style={{ fontSize: 11, color: member.role === 'admin' ? (isOled ? '#a78bfa' : dm ? '#a5b4fc' : '#6366f1') : (dm ? '#5a5a8a' : '#9ca3af'), marginTop: 1, display: 'flex', alignItems: 'center', gap: 5, fontWeight: member.role === 'admin' ? 600 : 400 }}>
                                            <span>{member.role === 'admin' ? `★ ${lang === 'en' ? 'Admin' : 'Администратор'}` : (lang === 'en' ? 'Member' : 'Участник')}</span>
                                            {(() => {
                                                const lu = liveUsers?.find(u => u.id === member.id);
                                                if (member.id === currentUserId || lu?.is_online) return <span style={{ color: '#22c55e', fontWeight: 600 }}>· 🟢 {tr('Online')}</span>;
                                                if (lu?.last_seen && lu.last_seen !== 'hidden') {
                                                    try {
                                                        const d = new Date(lu.last_seen);
                                                        const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
                                                        let txt = '';
                                                        if (diffMin < 1) txt = lang === 'en' ? 'just now' : 'только что';
                                                        else if (diffMin < 60) txt = lang === 'en' ? `${diffMin} min ago` : `${diffMin} мин. назад`;
                                                        else if (diffMin < 1440) txt = lang === 'en' ? `${Math.floor(diffMin / 60)} h ago` : `${Math.floor(diffMin / 60)} ч. назад`;
                                                        else txt = lang === 'en' ? `${Math.floor(diffMin / 1440)} days ago` : `${Math.floor(diffMin / 1440)} дн. назад`;
                                                        return <span>· {txt}</span>;
                                                    } catch { return null; }
                                                }
                                                return null;
                                            })()}
                                        </div>
                                    </div>
                                    {isAdmin && member.id !== currentUserId && (
                                        <button onClick={e => { e.stopPropagation(); handleRemoveMember(member.id, member.username); }} style={{ background: 'none', border: 'none', color: dm ? '#4a4a6a' : '#c0c0d0', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'color 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                                            onMouseLeave={e => (e.currentTarget.style.color = dm ? '#4a4a6a' : '#c0c0d0')}
                                            title={lang === 'en' ? 'Remove from group' : 'Удалить из группы'}>✕</button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                    )}
                    </div>{/* end padding content */}
                </div>

                {/* Right panel — media */}
                <div className="group-info-media" style={{
                    width: mediaExpanded ? 380 : 0,
                    flexShrink: 0,
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                    transition: 'width 0.32s cubic-bezier(0.4,0,0.2,1)',
                    maxHeight: '88vh',
                    background: isOled ? '#000' : dm ? 'rgba(255,255,255,0.02)' : 'rgba(99,102,241,0.02)',
                    boxShadow: mediaExpanded ? (isOled ? 'inset 1px 0 0 rgba(167,139,250,0.1)' : dm ? 'inset 1px 0 0 rgba(99,102,241,0.12)' : 'inset 1px 0 0 rgba(99,102,241,0.08)') : 'none',
                }}>
                    {/* Tab bar */}
                    <div style={{ display: 'flex', padding: '10px 12px 6px', flexShrink: 0, alignItems: 'center', gap: 4 }}>
                        {mediaTabs.map(tab => {
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
                                {React.cloneElement(mediaTabIcons[tab.key], { width: 13, height: 13 })}
                                {tab.label}
                                {tab.count > 0 && <span style={{ fontSize: 9, color: isActive ? (isOled ? '#a78bfa' : '#6366f1') : sub }}>({tab.count})</span>}
                            </button>
                            );
                        })}
                        <div style={{ flex: 1 }} />
                        {/* Collapse */}
                        <button onClick={() => setMediaExpanded(false)} title={lang === 'en' ? 'Collapse' : 'Свернуть'}
                            style={{ padding: '6px 8px', border: 'none', background: 'none', cursor: 'pointer', color: sub, flexShrink: 0, display: 'flex', alignItems: 'center', borderRadius: 8 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        {/* Close modal */}
                        <button onClick={close} title={tr('Close')}
                            style={{ padding: '6px 8px', border: 'none', background: 'none', cursor: 'pointer', color: sub, flexShrink: 0, display: 'flex', alignItems: 'center', borderRadius: 8 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: (mediaTab === 'images' || mediaTab === 'video') ? 8 : 0 }}>
                        {currentTabData.length === 0 ? (
                            <div style={{ padding: 32, textAlign: 'center', color: sub, fontSize: 13 }}>{tr('No files')}</div>
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
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)'}` }}>
                                        <div style={{ width: 36, height: 36, borderRadius: 10, background: dm ? '#252540' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#6366f1' }}>
                                            {mediaTab === 'audio'
                                                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                                                : <span style={{ fontSize: 9, fontWeight: 700 }}>{f.filename.split('.').pop()?.toUpperCase() || 'FILE'}</span>}
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

        {/* Confirm dialog portal */}
        {confirm && ReactDOM.createPortal(
            <div onClick={() => setConfirm(null)} className="modal-backdrop-enter"
                style={{ position: 'fixed', inset: 0, zIndex: 2000, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div onClick={e => e.stopPropagation()} className="modal-enter"
                    style={{ background: bg, borderRadius: 20, width: 320, padding: '28px 28px 22px', boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.18), 0 8px 40px rgba(0,0,0,0.95)' : dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: `1px solid ${border}`, textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', marginBottom: 8 }}>{tr('This cannot be undone.')}</div>
                    <div style={{ fontSize: 14, color: dm ? '#9090b0' : '#6b7280', marginBottom: 24 }}>{confirm.message}</div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={() => setConfirm(null)} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: !dm ? '1.5px solid #ede9fe' : ('1.5px solid rgba(99,102,241,0.25)'), background: cardBg, color: dm ? '#c0c0d8' : '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{tr('Cancel')}</button>
                        <button onClick={confirm.onConfirm} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e53935, #ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(229,57,53,0.35)' }}>{tr('Delete')}</button>
                    </div>
                </div>
            </div>,
            document.body
        )}

        {/* Channel: Members modal */}
        {showMembersModal && channelSubModal(group?.member_count ? formatMembers(group.member_count, isChannel ? 'subscriber' : 'member', lang) : (lang === 'en' ? 'Members' : 'Участники'), () => setShowMembersModal(false),
            members.map(m => renderMemberRow(m, false))
        )}

        {/* Channel: Admins modal */}
        {showAdminsModal && channelSubModal(lang === 'en' ? 'Admins' : 'Администраторы', () => setShowAdminsModal(false),
            <>
                {members.filter(m => m.role === 'admin').map(m => renderMemberRow(m, true))}
                {members.filter(m => m.role !== 'admin').length > 0 && (
                    <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: dm ? '#7c7caa' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', marginTop: 8, marginBottom: 4 }}>{lang === 'en' ? 'Members' : 'Участники'}</div>
                        {members.filter(m => m.role !== 'admin').map(m => renderMemberRow(m, true))}
                    </>
                )}
            </>
        )}

        {/* Channel: Add Members modal */}
        {showAddMembersModal && channelSubModal(lang === 'en' ? 'Add members' : 'Добавить участников', () => setShowAddMembersModal(false),
            <>
                <input
                    type="text"
                    placeholder={tr('@user_tag')}
                    value={addMembersSearch}
                    onChange={e => searchAddMembers(e.target.value)}
                    style={{ ...tk.input, marginBottom: 8 }}
                    autoFocus
                />
                {addMembersLoading && <div style={{ textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13 }}>{tr('Searching...')}</div>}
                {addMembersResults.map((u: any) => (
                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, backgroundColor: memberBg, border: !dm ? '1px solid #ede9fe' : ('1px solid rgba(99,102,241,0.1)') }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: u.avatar ? memberBg : '#6366f1', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, overflow: 'hidden', flexShrink: 0 }}>
                            {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt={u.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : u.username[0].toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                            {u.tag && <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>@{u.tag}</div>}
                        </div>
                        <button onClick={() => handleAddMember(u.id, u.tag)} style={{ padding: '6px 14px', borderRadius: 8, background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{tr('Add')}</button>
                    </div>
                ))}
                {!addMembersLoading && addMembersSearch && addMembersResults.length === 0 && (
                    <div style={{ textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13 }}>{lang === 'en' ? 'Not found' : 'Не найдено'}</div>
                )}
            </>
        )}

        {/* Lightbox */}
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
        {cropSrc && <AvatarCropper src={cropSrc} isDark={isDark} onApply={handleCropApply} onCancel={handleCropCancel} />}
        {showStats && ReactDOM.createPortal(
            <div className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 4000, background: isOled ? 'rgba(0,0,0,0.88)' : dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.45)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => setShowStats(false)}>
                <div className="modal-enter" style={{ background: bg, borderRadius: 20, width: 440, maxWidth: '94vw', maxHeight: '84vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.18), 0 8px 40px rgba(0,0,0,0.95)' : dm ? '0 0 40px rgba(99,102,241,0.25), 0 30px 80px rgba(0,0,0,0.7)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.15)' }}
                    onClick={e => e.stopPropagation()}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 12px', gap: 10, flexShrink: 0, borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)'}` }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: isOled ? 'rgba(167,139,250,0.12)' : dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isOled ? '#c4b5fd' : '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                        </div>
                        <span style={{ fontWeight: 700, fontSize: 16, color: dm ? '#e2e8f0' : '#1e1b4b', flex: 1 }}>{lang === 'en' ? 'Channel statistics' : 'Статистика канала'}</span>
                        {statsLoading && <div style={{ width: 16, height: 16, border: `2px solid ${dm ? 'rgba(99,102,241,0.3)' : '#d0cbff'}`, borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
                        <button onClick={() => setShowStats(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', padding: 4, display: 'flex' }}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {!stats && !statsLoading && <div style={{ textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', padding: 40, fontSize: 13 }}>{lang === 'en' ? 'No data' : 'Нет данных'}</div>}
                        {statsLoading && !stats && <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div style={{ width: 28, height: 28, border: `2px solid ${dm ? 'rgba(99,102,241,0.2)' : '#e0d9ff'}`, borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /></div>}
                        {stats && (() => {
                            const cardBg2 = isOled ? '#0a0a14' : dm ? '#1a1a2e' : '#f5f3ff';
                            const accent = '#6366f1';
                            const borderC = isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.15)' : '#e8e4ff';
                            const SectionLabel = ({ label }: { label: string }) => (
                                <div style={{ fontSize: 10, fontWeight: 700, color: isOled ? '#4a3a6a' : dm ? '#4a4a6a' : '#9ca3af', letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 10 }}>{label}</div>
                            );
                            const BarChart = ({ data, color }: { data: { date: string; count: number }[]; color: string }) => {
                                if (!data || !data.length) return <div style={{ fontSize: 12, color: dm ? '#5a5a8a' : '#9ca3af' }}>{lang === 'en' ? 'No data for last 30 days' : 'Нет данных за 30 дней'}</div>;
                                const max = Math.max(...data.map((d: any) => d.count), 1);
                                return (
                                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 52, width: '100%' }}>
                                        {data.map((d: any, i: number) => (
                                            <div key={i} title={`${d.date}: ${d.count}`} style={{ flex: 1, minWidth: 2, background: color, opacity: 0.8, borderRadius: '2px 2px 0 0', height: `${Math.max(4, (d.count / max) * 100)}%`, transition: 'height 0.3s' }} />
                                        ))}
                                    </div>
                                );
                            };
                            return (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                                        {[
                                            { label: lang === 'en' ? 'Subscribers' : 'Подписчики', value: stats.total_members?.toLocaleString(), icon: '👥' },
                                            { label: lang === 'en' ? 'Posts' : 'Публикаций', value: stats.total_posts?.toLocaleString(), icon: '📝' },
                                            { label: lang === 'en' ? 'Avg views' : 'Средний охват', value: stats.avg_views, icon: '👁' },
                                            { label: lang === 'en' ? 'Reactions' : 'Реакций', value: stats.total_reactions?.toLocaleString(), icon: '❤️' },
                                        ].map(kpi => (
                                            <div key={kpi.label} style={{ background: cardBg2, borderRadius: 12, padding: '12px 14px', border: `1px solid ${borderC}` }}>
                                                <div style={{ fontSize: 20, marginBottom: 4 }}>{kpi.icon}</div>
                                                <div style={{ fontSize: 22, fontWeight: 800, color: accent, lineHeight: 1 }}>{kpi.value ?? '—'}</div>
                                                <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 3 }}>{kpi.label}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ background: cardBg2, borderRadius: 14, padding: '14px 16px', border: `1px solid ${borderC}` }}>
                                        <SectionLabel label={lang === 'en' ? 'Subscriber growth (30d)' : 'Рост подписчиков (30д)'} />
                                        <BarChart data={stats.growth_chart || []} color={accent} />
                                    </div>
                                    <div style={{ background: cardBg2, borderRadius: 14, padding: '14px 16px', border: `1px solid ${borderC}` }}>
                                        <SectionLabel label={lang === 'en' ? 'Post activity (30d)' : 'Активность постов (30д)'} />
                                        <BarChart data={stats.posts_chart || []} color='#06b6d4' />
                                    </div>
                                    {stats.peak_hour !== null && stats.peak_hour !== undefined && (
                                        <div style={{ background: cardBg2, borderRadius: 14, padding: '14px 16px', border: `1px solid ${borderC}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{ fontSize: 28 }}>🕐</div>
                                            <div>
                                                <div style={{ fontSize: 16, fontWeight: 700, color: dm ? '#e2e8f0' : '#1e1b4b' }}>{stats.peak_hour}:00 – {stats.peak_hour + 1}:00</div>
                                                <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{lang === 'en' ? 'Most posts published at this time' : 'Пиковое время публикаций'}</div>
                                            </div>
                                        </div>
                                    )}
                                    {stats.top_posts?.length > 0 && (
                                        <div style={{ background: cardBg2, borderRadius: 14, padding: '14px 16px', border: `1px solid ${borderC}` }}>
                                            <SectionLabel label={lang === 'en' ? 'Top posts by views' : 'Топ постов по просмотрам'} />
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                                {stats.top_posts.map((p: any, i: number) => (
                                                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < stats.top_posts.length - 1 ? `1px solid ${borderC}` : 'none' }}>
                                                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: `${accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: accent, flexShrink: 0 }}>#{i + 1}</div>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{ fontSize: 12, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.text || `[${lang === 'en' ? 'Media' : 'Медиа'}]`}</div>
                                                            <div style={{ fontSize: 10, color: dm ? '#5a5a8a' : '#9ca3af' }}>{p.views} {lang === 'en' ? 'views' : 'просмотров'}</div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>
            </div>,
            document.body
        )}
        </>
    );
};

const tokens = (dm: boolean, o = false) => {
    const cardBg = !dm ? '#f5f3ff' : (o ? '#050508' : '#12122a');
    const cardBorder = !dm ? '1px solid #ede9fe' : (o ? '1px solid rgba(167,139,250,0.12)' : '1px solid rgba(99,102,241,0.15)');
    const primaryGrad = 'linear-gradient(135deg, #6c47d4, #8b5cf6)';
    const primaryShadow = '0 0 10px rgba(99,102,241,0.25)';
    return {
        overlay: { position: 'fixed' as const, inset: 0, backgroundColor: o ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
        modalShell: { backgroundColor: !dm ? '#ffffff' : (o ? '#000000' : '#1a1a2e'), borderRadius: 20, maxWidth: '94vw', maxHeight: '88vh', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: !dm ? '1px solid #ede9fe' : (o ? '1px solid rgba(167,139,250,0.2)' : '1px solid rgba(99,102,241,0.25)'), display: 'flex', overflow: 'hidden', position: 'relative' as const },
        input: { width: '100%', padding: '10px 14px', border: !dm ? '1.5px solid #ede9fe' : (o ? '1.5px solid rgba(167,139,250,0.2)' : '1.5px solid rgba(99,102,241,0.25)'), borderRadius: 12, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const, backgroundColor: cardBg, color: dm ? '#e0e0f0' : '#1e1b4b', marginBottom: 0 },
        statCard: { flex: 1, backgroundColor: cardBg, border: cardBorder, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 2 },
        btnPrimary: { flex: 1, padding: 10, background: primaryGrad, color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, boxShadow: primaryShadow },
        btnCancel: { flex: 1, padding: 10, backgroundColor: !dm ? '#f0f2f5' : (o ? '#0a0a14' : '#252538'), color: dm ? '#9999bb' : '#555', border: !dm ? '1px solid #ddd' : (o ? '1.5px solid rgba(167,139,250,0.15)' : '1.5px solid rgba(99,102,241,0.2)'), borderRadius: 12, cursor: 'pointer', fontSize: 13 },
        btnEdit: { flex: 1, padding: 10, background: !dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.12)', color: '#a5b4fc', border: !dm ? '1px solid #c4b5fd' : '1px solid rgba(99,102,241,0.25)', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
        btnDelete: { flex: 1, padding: 10, background: !dm ? '#fff0f0' : 'rgba(239,68,68,0.1)', color: '#f87171', border: !dm ? '1px solid #ffcdd2' : '1px solid rgba(239,68,68,0.25)', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
        btnInvite: { padding: '8px 16px', background: primaryGrad, color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, boxShadow: primaryShadow },
    };
};

export default GroupInfo;
