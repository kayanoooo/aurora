import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { config } from '../config';
import { useLang } from '../i18n';

const isImgFile = (filename?: string | null, path?: string | null) =>
    /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(filename || path?.split('/').pop() || '');
const isVideoFile = (filename?: string | null, path?: string | null) =>
    /\.(mp4|webm|mov|avi)$/i.test(filename || path?.split('/').pop() || '');

interface AdminPanelProps {
    token: string;
    isDark?: boolean;
    onClose: () => void;
    onBack?: () => void;
    newSupportMsg?: { user_id: number; message_text: string; msg_id: number; file_path?: string; filename?: string } | null;
}

interface Stats {
    total_users: number;
    messages_day: number; messages_week: number; messages_month: number;
    files_day: number; files_week: number; files_month: number;
    users_day: number; users_week: number; users_month: number;
    reg_chart: { date: string; count: number }[];
    online_now: number;
}

interface AdminUser {
    id: number; username: string; tag?: string; email: string;
    created_at: string; avatar?: string; status?: string; is_deleted?: number;
    is_banned?: number; ban_reason?: string;
    last_seen?: string; role?: string;
}

interface SupportThread {
    user_id: number; username: string; tag?: string; avatar?: string;
    last_message: string; last_time: string; is_admin_reply: number;
    unread_count: number;
}

interface SupportMessage {
    id: number; sender_id: number; message_text: string;
    is_admin_reply: number; created_at: string;
    sender_name: string; sender_tag?: string; sender_avatar?: string;
    file_path?: string; filename?: string;
}

const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });

const AdminPanel: React.FC<AdminPanelProps> = ({ token, isDark = false, onClose, onBack, newSupportMsg }) => {
    const dm = isDark;
    const { t, lang } = useLang();
    const [tab, setTab] = useState<'stats' | 'users' | 'support' | 'reports'>('stats');
    const [closing, setClosing] = useState(false);
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

    // Stats
    const [stats, setStats] = useState<Stats | null>(null);
    const [statsLoading, setStatsLoading] = useState(false);

    // Users
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [userSearch, setUserSearch] = useState('');
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
    const [banningId, setBanningId] = useState<number | null>(null);
    const [banModalUser, setBanModalUser] = useState<AdminUser | null>(null);
    const [banForm, setBanForm] = useState({ reason: '', temporary: false, expiresAt: '' });
    const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
    const [editForm, setEditForm] = useState({ username: '', email: '', tag: '', status: '' });
    const [editSaving, setEditSaving] = useState(false);
    const [editError, setEditError] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [passwordMsg, setPasswordMsg] = useState('');

    // Support
    const [threads, setThreads] = useState<SupportThread[]>([]);
    const [threadsLoading, setThreadsLoading] = useState(false);
    const [activeThread, setActiveThread] = useState<number | null>(null);
    const [threadMsgs, setThreadMsgs] = useState<SupportMessage[]>([]);
    const [threadLoading, setThreadLoading] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [replying, setReplying] = useState(false);
    const threadBottomRef = useRef<HTMLDivElement>(null);

    // Reports
    interface Report {
        id: number; reporter_id: number; reporter_name: string;
        target_type: 'user' | 'group' | 'message'; target_id: number;
        target_name?: string; target_deleted?: number;
        reason: string; comment: string; status: 'pending' | 'reviewed' | 'dismissed';
        created_at: string;
    }
    const [reports, setReports] = useState<Report[]>([]);
    const [reportsLoading, setReportsLoading] = useState(false);
    const [reportStatusFilter, setReportStatusFilter] = useState<'pending' | 'reviewed' | 'dismissed'>('pending');
    const [reportUpdating, setReportUpdating] = useState<number | null>(null);
    const [reportBanning, setReportBanning] = useState<number | null>(null);
    const [reportConfirmBan, setReportConfirmBan] = useState<Report | null>(null);

    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const loadStats = async () => {
        setStatsLoading(true);
        try { setStats(await api.getAdminStats(token)); }
        finally { setStatsLoading(false); }
    };

    const loadUsers = async (q = '') => {
        setUsersLoading(true);
        try { const r = await api.getAdminUsers(token, q); setUsers(r.users || []); }
        finally { setUsersLoading(false); }
    };

    const deleteUser = async (userId: number) => {
        setDeletingId(userId);
        try {
            await api.deleteAdminUser(token, userId);
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_deleted: 1, username: t('Deleted user'), tag: undefined, avatar: undefined } : u));
        } finally { setDeletingId(null); setConfirmDeleteId(null); }
    };

    const openEditUser = (u: AdminUser) => {
        setEditingUser(u);
        setEditForm({ username: u.username, email: u.email, tag: u.tag || '', status: u.status || '' });
        setEditError('');
        setNewPassword('');
        setPasswordMsg('');
    };

    const savePassword = async () => {
        if (!editingUser || newPassword.length < 6) return;
        setPasswordSaving(true);
        setPasswordMsg('');
        try {
            const res = await fetch(`${config.API_URL}/admin/users/${editingUser.id}/set-password?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: newPassword }),
            });
            if (res.ok) { setPasswordMsg('✅ Пароль изменён'); setNewPassword(''); }
            else { const j = await res.json(); setPasswordMsg(`❌ ${j.detail || 'Ошибка'}`); }
        } catch { setPasswordMsg('❌ Ошибка сети'); }
        finally { setPasswordSaving(false); }
    };

    const saveEditUser = async () => {
        if (!editingUser || editSaving) return;
        setEditSaving(true);
        setEditError('');
        try {
            const res = await api.updateAdminUser(token, editingUser.id, {
                username: editForm.username.trim(),
                email: editForm.email.trim(),
                tag: editForm.tag.trim(),
                status: editForm.status.trim(),
            });
            if (res.success) {
                setUsers(prev => prev.map(u => u.id === editingUser.id
                    ? { ...u, username: editForm.username.trim(), email: editForm.email.trim(), tag: editForm.tag.trim() || undefined, status: editForm.status.trim() || undefined }
                    : u));
                setEditingUser(null);
            } else {
                setEditError(res.detail || (lang === 'en' ? 'Save error' : 'Ошибка сохранения'));
            }
        } catch { setEditError(lang === 'en' ? 'Save error' : 'Ошибка сохранения'); }
        finally { setEditSaving(false); }
    };

    const openBanModal = (u: AdminUser) => {
        setBanModalUser(u);
        setBanForm({ reason: '', temporary: false, expiresAt: '' });
    };

    const executeBan = async () => {
        if (!banModalUser) return;
        setBanningId(banModalUser.id);
        const expiresAt = banForm.temporary && banForm.expiresAt ? new Date(banForm.expiresAt).toISOString() : undefined;
        await api.banAdminUser(token, banModalUser.id, banForm.reason, expiresAt);
        setUsers(prev => prev.map(x => x.id === banModalUser.id ? { ...x, is_banned: 1, ban_reason: banForm.reason } : x));
        setBanningId(null);
        setBanModalUser(null);
    };

    const fmtLastSeen = (iso?: string) => {
        if (!iso) return lang === 'en' ? 'never' : 'никогда';
        const d = new Date(iso);
        const now = new Date();
        const diff = (now.getTime() - d.getTime()) / 1000;
        if (diff < 60) return lang === 'en' ? 'just now' : 'только что';
        if (diff < 3600) return lang === 'en' ? `${Math.floor(diff / 60)} min ago` : `${Math.floor(diff / 60)} мин. назад`;
        if (diff < 86400) return lang === 'en' ? `${Math.floor(diff / 3600)} h ago` : `${Math.floor(diff / 3600)} ч. назад`;
        return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
    };

    const loadThreads = async () => {
        setThreadsLoading(true);
        try { const r = await api.getAdminSupport(token); setThreads(r.threads || []); }
        finally { setThreadsLoading(false); }
    };

    const openThread = async (userId: number) => {
        setActiveThread(userId);
        setThreadLoading(true);
        try {
            const r = await api.getAdminSupportThread(token, userId);
            setThreadMsgs(r.messages || []);
            setThreads(prev => prev.map(t => t.user_id === userId ? { ...t, unread_count: 0 } : t));
        } finally { setThreadLoading(false); }
    };

    const RESOLVE_MARKER = '__SUPPORT_RESOLVE__';
    const CONFIRM_MARKER = '__SUPPORT_CONFIRMED__';

    const sendReply = async () => {
        if (!replyText.trim() || replying || activeThread === null) return;
        setReplying(true);
        const text = replyText.trim();
        setReplyText('');
        const optimistic: SupportMessage = {
            id: Date.now(), sender_id: 0, message_text: text,
            is_admin_reply: 1, created_at: new Date().toISOString(),
            sender_name: 'Admin', sender_tag: '',
        };
        setThreadMsgs(prev => [...prev, optimistic]);
        try {
            await api.adminSupportReply(token, activeThread, text);
            setThreads(prev => prev.map(t => t.user_id === activeThread
                ? { ...t, last_message: text, last_time: new Date().toISOString(), is_admin_reply: 1 } : t));
        } finally { setReplying(false); }
    };

    const markResolved = async () => {
        if (activeThread === null) return;
        await api.adminSupportReply(token, activeThread, RESOLVE_MARKER);
        // Show locally as a system note
        setThreadMsgs(prev => [...prev, {
            id: Date.now(), sender_id: 0, message_text: RESOLVE_MARKER,
            is_admin_reply: 1, created_at: new Date().toISOString(),
            sender_name: 'Admin', sender_tag: '',
        }]);
        setThreads(prev => prev.map(t => t.user_id === activeThread
            ? { ...t, last_message: '✅ Вопрос решён', last_time: new Date().toISOString(), is_admin_reply: 1 } : t));
    };

    const loadReports = async (status = reportStatusFilter) => {
        setReportsLoading(true);
        try {
            const res = await fetch(`${config.API_URL}/admin/reports?token=${token}&status=${status}`);
            const data = await res.json();
            setReports(data.reports || []);
        } finally { setReportsLoading(false); }
    };

    const updateReport = async (id: number, status: 'reviewed' | 'dismissed') => {
        setReportUpdating(id);
        try {
            await fetch(`${config.API_URL}/admin/reports/${id}?token=${token}&status=${status}`, { method: 'PATCH' });
            setReports(prev => prev.filter(r => r.id !== id));
        } finally { setReportUpdating(null); }
    };

    const banAndResolve = async (report: Report) => {
        setReportBanning(report.id);
        try {
            await api.deleteAdminUser(token, report.target_id);
            await fetch(`${config.API_URL}/admin/reports/${report.id}?token=${token}&status=reviewed`, { method: 'PATCH' });
            // Close all pending reports targeting the same user
            setReports(prev => prev.filter(r => !(r.target_type === 'user' && r.target_id === report.target_id)));
        } finally { setReportBanning(null); setReportConfirmBan(null); }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (tab === 'stats') loadStats(); }, [tab]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (tab === 'users') loadUsers(); }, [tab]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (tab === 'support') loadThreads(); }, [tab]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (tab === 'reports') loadReports(reportStatusFilter); }, [tab, reportStatusFilter]);
    useEffect(() => { threadBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [threadMsgs]);

    useEffect(() => {
        if (!newSupportMsg) return;
        if (tab === 'support') {
            loadThreads();
            if (activeThread === newSupportMsg.user_id) {
                const thread = threads.find(t => t.user_id === newSupportMsg.user_id);
                setThreadMsgs(prev => {
                    if (prev.some(m => m.id === newSupportMsg.msg_id)) return prev; // deduplicate
                    return [...prev, {
                        id: newSupportMsg.msg_id,
                        sender_id: newSupportMsg.user_id,
                        message_text: newSupportMsg.message_text,
                        is_admin_reply: 0,
                        created_at: new Date().toISOString(),
                        sender_name: thread?.username || 'User',
                        sender_tag: thread?.tag || '',
                        sender_avatar: thread?.avatar,
                        file_path: newSupportMsg.file_path,
                        filename: newSupportMsg.filename,
                    }];
                });
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newSupportMsg]);

    // Colors
    const isOled = dm && typeof document !== 'undefined' && document.body.classList.contains('oled-theme');
    const bg        = isOled ? '#000000'                  : dm ? '#1a1a2e'       : '#ffffff';
    const panelBg   = isOled ? '#000000'                  : dm ? '#0e0e1f'       : '#f7f8fc';
    const cardBg    = isOled ? '#07070d'                  : dm ? '#12122a'       : '#ffffff';
    const border    = isOled ? 'rgba(167,139,250,0.18)'   : dm ? 'rgba(99,102,241,0.25)' : '#ede9fe';
    const textCol   = isOled ? '#e2e0ff'                  : dm ? '#e2e8f0'       : '#1e1b4b';
    const subCol    = isOled ? '#4a4a7a'                  : dm ? '#5a5a8a'       : '#9ca3af';
    const accentCol = isOled ? '#a78bfa'                  : '#6366f1';

    const StatCard = ({ icon, label, day, week, month, color = accentCol }: { icon: React.ReactNode; label: string; day: number; week: number; month: number; color?: string }) => (
        <div style={{ background: cardBg, borderRadius: 14, padding: '14px 16px', border: `1px solid ${border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.1)' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOled ? '#a78bfa' : '#6366f1', flexShrink: 0 }}>{icon}</div>
                <span style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                {[[t('Day'), day], [t('Week'), week], [t('Month'), month]].map(([lbl, val]) => (
                    <div key={String(lbl)} style={{ flex: 1, textAlign: 'center', background: isOled ? 'rgba(124,58,237,0.07)' : dm ? 'rgba(99,102,241,0.07)' : 'rgba(99,102,241,0.05)', borderRadius: 10, padding: '8px 4px' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color }}>{val}</div>
                        <div style={{ fontSize: 10, color: subCol, marginTop: 2 }}>{lbl}</div>
                    </div>
                ))}
            </div>
        </div>
    );

    const inputStyle = (extra?: React.CSSProperties): React.CSSProperties => ({
        width: '100%', boxSizing: 'border-box', padding: '8px 11px',
        border: `1.5px solid ${border}`, borderRadius: 10,
        background: isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff'),
        color: textCol, fontSize: 13, outline: 'none', fontFamily: 'inherit',
        ...extra,
    });

    return (
        <>
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 2000, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}
            className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            onClick={close}
        >
            <div
                style={{ background: bg, borderRadius: isMobile ? '20px 20px 0 0' : 22, width: isMobile ? '100%' : 780, maxWidth: isMobile ? '100%' : '96vw', height: isMobile ? '92svh' : '88vh', maxHeight: isMobile ? '92svh' : 760, display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0, boxShadow: isOled ? '0 0 60px rgba(124,58,237,0.28), 0 30px 80px rgba(0,0,0,0.98)' : (dm ? '0 0 50px rgba(99,102,241,0.22), 0 30px 80px rgba(0,0,0,0.7)' : '0 0 40px rgba(99,102,241,0.13), 0 20px 60px rgba(0,0,0,0.15)') }}
                className={(closing ? 'modal-exit' : 'modal-enter') + (isMobile ? ' mobile-bottom-sheet' : '')}
                onClick={e => e.stopPropagation()}
            >
                {isMobile && <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px', flexShrink: 0 }}><div style={{ width: 36, height: 4, borderRadius: 2, background: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' }} /></div>}
                {/* Header */}
                <div style={{ background: bg, padding: isMobile ? '8px 16px 10px' : '14px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'}` }}>
                    {isMobile && (
                        <button onClick={onBack ? () => { setClosing(true); setTimeout(onBack, 180); } : close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isOled ? '#a78bfa' : '#6366f1', padding: '4px 8px 4px 0', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                        </button>
                    )}
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.1)' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: isOled ? '#a78bfa' : '#6366f1' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: isMobile ? 17 : 16, color: isOled ? '#e2e0ff' : dm ? '#e2e8f0' : '#1e1b4b' }}>{t('Admin panel')}</div>
                    </div>
                    {!isMobile && (
                        <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: subCol, fontSize: 15, padding: '4px', display: 'flex', alignItems: 'center' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    )}
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: `1px solid ${border}`, background: bg, flexShrink: 0 }}>
                    {([
                        { id: 'stats', label: t('Statistics'), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
                        { id: 'users', label: t('Users'), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
                        { id: 'support', label: t('Support'), badge: threads.reduce((s, th) => s + th.unread_count, 0), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
                        { id: 'reports', label: lang === 'en' ? 'Reports' : 'Жалобы', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg> },
                    ] as const).map(tb => (
                        <button
                            key={tb.id}
                            onClick={() => setTab(tb.id)}
                            style={{
                                flex: 1, padding: isMobile ? '10px 4px' : '12px 8px', border: 'none', borderBottom: tab === tb.id ? `2px solid ${accentCol}` : '2px solid transparent',
                                background: 'none', cursor: 'pointer', fontSize: isMobile ? 11 : 12, fontWeight: tab === tb.id ? 700 : 500,
                                color: tab === tb.id ? accentCol : subCol, transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: 'inherit',
                            }}
                        >
                            {tb.icon}
                            {!isMobile && tb.label}
                            {(tb as any).badge > 0 && (
                                <span style={{ background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 700, borderRadius: 8, padding: '1px 5px', lineHeight: 1.4 }}>
                                    {(tb as any).badge > 99 ? '99+' : (tb as any).badge}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

                    {/* ─── Stats tab ─── */}
                    {tab === 'stats' && (
                        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 14px' : 20, background: panelBg, display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {statsLoading ? (
                                <div style={{ textAlign: 'center', color: subCol, marginTop: 60 }}>Загрузка...</div>
                            ) : stats ? (
                                <>
                                    {/* Hero row */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: isMobile ? 8 : 12 }}>
                                        {[
                                            { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>, label: t('Users'), val: stats.total_users, sub: `+${stats.users_day} ${t('today')}`, color: '#6366f1' },
                                            { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="12" opacity="0.15" fill="currentColor" stroke="none"/></svg>, label: t('Online now'), val: stats.online_now, sub: t('active sessions'), color: '#22c55e' },
                                            { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, label: t('Per month'), val: stats.users_month, sub: t('new users'), color: '#8b5cf6' },
                                        ].map(c => (
                                            <div key={c.label} style={{ background: cardBg, borderRadius: 14, padding: isMobile ? '12px 8px' : '16px', border: `1px solid ${border}`, textAlign: 'center' }}>
                                                <div style={{ width: 36, height: 36, borderRadius: 10, background: isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.1)' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px', color: c.color }}>{c.icon}</div>
                                                <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.val}</div>
                                                <div style={{ fontSize: isMobile ? 10 : 11, fontWeight: 600, color: textCol, marginTop: 4 }}>{c.label}</div>
                                                <div style={{ fontSize: 9, color: subCol, marginTop: 2 }}>{c.sub}</div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Stat cards */}
                                    <StatCard icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>} label={t('Messages')} day={stats.messages_day} week={stats.messages_week} month={stats.messages_month} />
                                    <StatCard icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>} label={t('Files')} day={stats.files_day} week={stats.files_week} month={stats.files_month} />
                                    <StatCard icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>} label={t('Registrations')} day={stats.users_day} week={stats.users_week} month={stats.users_month} />

                                    {/* Mini chart */}
                                    {stats.reg_chart.length > 0 && (
                                        <div style={{ background: cardBg, borderRadius: 14, padding: '14px 16px', border: `1px solid ${border}` }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>{lang === 'en' ? 'Registrations (7d)' : 'Регистрации (7 дней)'}</div>
                                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 60 }}>
                                                {(() => {
                                                    const max = Math.max(...stats.reg_chart.map(r => r.count), 1);
                                                    return stats.reg_chart.map(r => (
                                                        <div key={r.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                                            <div style={{ fontSize: 9, color: accentCol, fontWeight: 700 }}>{r.count}</div>
                                                            <div style={{ width: '100%', background: accentCol, borderRadius: '4px 4px 0 0', height: `${Math.max((r.count / max) * 44, 4)}px`, opacity: 0.85 }} />
                                                            <div style={{ fontSize: 8, color: subCol }}>
                                                                {new Date(r.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' })}
                                                            </div>
                                                        </div>
                                                    ));
                                                })()}
                                            </div>
                                        </div>
                                    )}

                                    <button onClick={loadStats} style={{ alignSelf: 'center', padding: '7px 16px', border: `1px solid ${border}`, borderRadius: 10, background: 'none', color: accentCol, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                                        {lang === 'en' ? 'Refresh' : 'Обновить'}
                                    </button>
                                </>
                            ) : null}
                        </div>
                    )}

                    {/* ─── Users tab ─── */}
                    {tab === 'users' && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${border}`, background: bg }}>
                                <input
                                    type="text"
                                    value={userSearch}
                                    onChange={e => {
                                        const q = e.target.value;
                                        setUserSearch(q);
                                        if (searchTimer.current) clearTimeout(searchTimer.current);
                                        searchTimer.current = setTimeout(() => loadUsers(q), 300);
                                    }}
                                    placeholder={`🔍 ${t('Search by name, tag, email...')}`}
                                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: `1.5px solid ${border}`, borderRadius: 10, background: isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff'), color: textCol, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                                />
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', background: panelBg }}>
                                {usersLoading ? (
                                    <div style={{ textAlign: 'center', color: subCol, marginTop: 40, fontSize: 13 }}>Загрузка...</div>
                                ) : users.map(u => {
                                    const avatarSrc = u.avatar ? config.fileUrl(u.avatar) : null;
                                    const isDeleted = !!u.is_deleted;
                                    const isBanned = !!u.is_banned && !isDeleted;
                                    const isConfirming = confirmDeleteId === u.id;
                                    const isDeleting = deletingId === u.id;
                                    const isBanning = banningId === u.id;
                                    return (
                                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.07)' : (dm ? 'rgba(99,102,241,0.08)' : '#f0f0f8')}`, opacity: isDeleted ? 0.45 : 1 }}>
                                            <div style={{ position: 'relative', flexShrink: 0 }}>
                                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarSrc ? 'transparent' : (isDeleted ? '#6b7280' : isBanned ? '#f97316' : '#6366f1'), overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    {avatarSrc && !isDeleted
                                                        ? <img src={avatarSrc ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        : <span style={{ color: 'white', fontWeight: 700, fontSize: 13 }}>{u.username[0]?.toUpperCase()}</span>}
                                                </div>
                                                {isBanned && <div style={{ position: 'absolute', bottom: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: '#ef4444', border: `2px solid ${dm ? '#1a1a2e' : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                </div>}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: isDeleted ? subCol : textCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: isDeleted ? 'italic' : 'normal' }}>{u.username}</span>
                                                    {u.tag && <span style={{ fontSize: 11, color: accentCol }}>@{u.tag}</span>}
                                                    {u.role === 'admin' && <span style={{ fontSize: 10, background: isOled ? 'rgba(167,139,250,0.15)' : 'rgba(99,102,241,0.12)', color: accentCol, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>admin</span>}
                                                    {isBanned && <span style={{ fontSize: 10, background: 'rgba(239,68,68,0.12)', color: '#ef4444', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{lang === 'en' ? 'banned' : 'забанен'}</span>}
                                                </div>
                                                <div style={{ fontSize: 11, color: subCol, display: 'flex', gap: 8 }}>
                                                    <span>{u.email}</span>
                                                    <span>·</span>
                                                    <span>{fmtLastSeen(u.last_seen)}</span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                                <div style={{ fontSize: 10, color: subCol, textAlign: 'right', marginRight: 2 }}>
                                                    <div>#{u.id}</div>
                                                    <div>{fmtDate(u.created_at)}</div>
                                                </div>
                                                {!isDeleted && (
                                                    <>
                                                        <button onClick={() => openEditUser(u)} title={lang === 'en' ? 'Edit' : 'Редактировать'} style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${border}`, background: 'none', color: accentCol, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                                        </button>
                                                        {isBanned ? (
                                                            <button onClick={async () => { setBanningId(u.id); await api.unbanAdminUser(token, u.id); setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_banned: 0 } : x)); setBanningId(null); }} disabled={isBanning} title={lang === 'en' ? 'Unban' : 'Разбанить'} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid rgba(34,197,94,0.4)', background: 'none', color: '#22c55e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                                            </button>
                                                        ) : (
                                                            <button onClick={() => openBanModal(u)} disabled={isBanning} title={lang === 'en' ? 'Ban' : 'Забанить'} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid rgba(249,115,22,0.4)', background: 'none', color: '#f97316', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                                                            </button>
                                                        )}
                                                        {isConfirming ? (
                                                            <div style={{ display: 'flex', gap: 3 }}>
                                                                <button onClick={() => deleteUser(u.id)} disabled={isDeleting} style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: '#ef4444', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                    {isDeleting ? '…' : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                                                </button>
                                                                <button onClick={() => setConfirmDeleteId(null)} style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${border}`, background: 'none', color: subCol, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✕</button>
                                                            </div>
                                                        ) : (
                                                            <button onClick={() => setConfirmDeleteId(u.id)} title={lang === 'en' ? 'Delete' : 'Удалить'} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid rgba(239,68,68,0.35)', background: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ─── Support tab ─── */}
                    {tab === 'support' && (
                        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                            {/* Thread list */}
                            <div style={{ width: isMobile ? '100%' : 240, flexShrink: 0, borderRight: `1px solid ${border}`, display: isMobile && activeThread !== null ? 'none' : 'flex', flexDirection: 'column', background: panelBg }}>
                                <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: subCol }}>ДИАЛОГИ</span>
                                    <button onClick={loadThreads} style={{ background: 'none', border: 'none', cursor: 'pointer', color: subCol, display: 'flex', alignItems: 'center', padding: 4 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
                                </div>
                                <div style={{ flex: 1, overflowY: 'auto' }}>
                                    {threadsLoading ? (
                                        <div style={{ textAlign: 'center', color: subCol, fontSize: 12, marginTop: 30 }}>Загрузка...</div>
                                    ) : threads.length === 0 ? (
                                        <div style={{ textAlign: 'center', color: subCol, fontSize: 12, marginTop: 40, padding: '0 16px' }}>
                                            Нет обращений
                                        </div>
                                    ) : threads.map(t => {
                                        const avatarSrc = t.avatar ? config.fileUrl(t.avatar) : null;
                                        const isActive = activeThread === t.user_id;
                                        return (
                                            <div
                                                key={t.user_id}
                                                onClick={() => openThread(t.user_id)}
                                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', cursor: 'pointer', borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.06)' : (dm ? 'rgba(99,102,241,0.06)' : '#f0f0f8')}`, background: isActive ? (isOled ? 'rgba(124,58,237,0.12)' : (dm ? 'rgba(99,102,241,0.15)' : '#f0eeff')) : 'transparent', borderLeft: isActive ? `3px solid ${accentCol}` : '3px solid transparent' }}
                                            >
                                                <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarSrc ? 'transparent' : '#6366f1', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                                    {avatarSrc
                                                        ? <img src={avatarSrc ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        : <span style={{ color: 'white', fontWeight: 700, fontSize: 13 }}>{t.username[0]?.toUpperCase()}</span>}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ fontSize: 12, fontWeight: 600, color: textCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.username}</span>
                                                        {t.unread_count > 0 && <span style={{ background: '#ef4444', color: 'white', fontSize: 9, fontWeight: 700, borderRadius: 6, padding: '1px 4px', flexShrink: 0 }}>{t.unread_count}</span>}
                                                    </div>
                                                    <div style={{ fontSize: 10, color: subCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {t.last_message === RESOLVE_MARKER ? '✅ Ожидает подтверждения' : t.last_message === CONFIRM_MARKER ? '✅ Вопрос решён' : (t.is_admin_reply ? '↩ ' : '') + t.last_message}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Thread messages */}
                            <div style={{ flex: 1, display: isMobile && activeThread === null ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                {activeThread === null ? (
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: subCol, background: panelBg }}>
                                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={subCol} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
                                        <span style={{ fontSize: 13 }}>Выберите диалог</span>
                                    </div>
                                ) : (
                                    <>
                                        {isMobile && (
                                            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                                                <button onClick={() => setActiveThread(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: accentCol, fontSize: 13, fontWeight: 600, padding: 0 }}>← Диалоги</button>
                                            </div>
                                        )}
                                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', background: isOled ? '#050508' : (dm ? '#12122a' : '#f0f2f5'), display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {threadLoading ? (
                                                <div style={{ textAlign: 'center', color: subCol, marginTop: 40, fontSize: 13 }}>Загрузка...</div>
                                            ) : threadMsgs.map(msg => {
                                                const isAdmin = msg.is_admin_reply === 1;
                                                const avatarSrc = msg.sender_avatar ? config.fileUrl(msg.sender_avatar) : null;
                                                // Hide the resolve marker sent by admin
                                                if (msg.message_text === RESOLVE_MARKER) return null;
                                                // Show confirmed note only when user clicked "Да"
                                                if (msg.message_text === CONFIRM_MARKER) {
                                                    return (
                                                        <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
                                                            <span style={{ fontSize: 11, color: '#10b981', background: dm ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, padding: '3px 12px', fontWeight: 600 }}>
                                                                ✅ Пользователь подтвердил решение · {fmt(msg.created_at)}
                                                            </span>
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <div key={msg.id} style={{ display: 'flex', flexDirection: isAdmin ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 6 }}>
                                                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: isAdmin ? '#6366f1' : (isOled ? '#0a0a14' : (dm ? '#2a2a3a' : '#e5e7eb')), flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            {avatarSrc
                                                                ? <img src={avatarSrc ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                                : <span style={{ fontSize: 11, color: isAdmin ? 'white' : subCol, fontWeight: 700 }}>{isAdmin ? '🔑' : msg.sender_name[0]?.toUpperCase()}</span>}
                                                        </div>
                                                        <div style={{ maxWidth: '72%' }}>
                                                            {/* File attachment */}
                                                            {(msg as any).file_path && isImgFile((msg as any).filename, (msg as any).file_path) && (
                                                                <div style={{ marginBottom: msg.message_text ? 4 : 0, borderRadius: 12, overflow: 'hidden', cursor: 'pointer', maxWidth: 220 }}
                                                                    onClick={() => window.open(config.fileUrl((msg as any).file_path) ?? undefined, '_blank')}>
                                                                    <img src={config.fileUrl((msg as any).file_path) ?? undefined} alt={(msg as any).filename || 'image'} style={{ display: 'block', width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12 }} />
                                                                </div>
                                                            )}
                                                            {(msg as any).file_path && isVideoFile((msg as any).filename, (msg as any).file_path) && (
                                                                <video src={config.fileUrl((msg as any).file_path) ?? undefined} controls style={{ maxWidth: 220, borderRadius: 12, display: 'block', marginBottom: msg.message_text ? 4 : 0 }} />
                                                            )}
                                                            {(msg as any).file_path && !isImgFile((msg as any).filename, (msg as any).file_path) && !isVideoFile((msg as any).filename, (msg as any).file_path) && (
                                                                <a href={config.fileUrl((msg as any).file_path) ?? undefined} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', marginBottom: msg.message_text ? 4 : 0, background: isAdmin ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : (isOled ? '#0a0a14' : (dm ? '#1e1e3a' : '#ffffff')), borderRadius: 10, textDecoration: 'none', border: isAdmin ? 'none' : `1px solid ${border}`, maxWidth: 220 }}>
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isAdmin ? 'white' : textCol} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                                                    <span style={{ fontSize: 11, color: isAdmin ? 'rgba(255,255,255,0.9)' : textCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(msg as any).filename || t('File')}</span>
                                                                </a>
                                                            )}
                                                            {/* Text bubble */}
                                                            {msg.message_text && (
                                                            <div style={{
                                                                background: isAdmin ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : (isOled ? '#0a0a14' : (dm ? '#1e1e3a' : '#ffffff')),
                                                                color: isAdmin ? 'white' : textCol,
                                                                borderRadius: isAdmin ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                                                                padding: '8px 11px', fontSize: 12, lineHeight: 1.5,
                                                                border: isAdmin ? 'none' : `1px solid ${border}`,
                                                                wordBreak: 'break-word',
                                                            }}>
                                                                {msg.message_text}
                                                            </div>
                                                            )}
                                                            <div style={{ fontSize: 9, color: subCol, marginTop: 2, textAlign: isAdmin ? 'right' : 'left' }}>
                                                                {isAdmin ? t('Support') : msg.sender_name} · {fmt(msg.created_at)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            <div ref={threadBottomRef} />
                                        </div>
                                        <div style={{ padding: '8px 10px', borderTop: `1px solid ${border}`, background: bg, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <input
                                                    type="text"
                                                    value={replyText}
                                                    onChange={e => setReplyText(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                                                    placeholder={t('Reply to user...')}
                                                    style={{ flex: 1, padding: '8px 11px', border: `1.5px solid ${border}`, borderRadius: 10, background: isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff'), color: textCol, fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
                                                />
                                                <button
                                                    onClick={sendReply}
                                                    disabled={!replyText.trim() || replying}
                                                    style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: (!replyText.trim() || replying) ? (dm ? '#2a2a3d' : '#e5e7eb') : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: (!replyText.trim() || replying) ? subCol : 'white', cursor: (!replyText.trim() || replying) ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}
                                                >
                                                    ➤
                                                </button>
                                            </div>
                                            <button
                                                onClick={markResolved}
                                                style={{ width: '100%', padding: '7px 0', borderRadius: 10, border: '1.5px solid rgba(16,185,129,0.4)', background: dm ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)', color: '#10b981', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.2px' }}
                                            >
                                                ✅ Вопрос решён
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ─── Reports tab ─── */}
                    {tab === 'reports' && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {/* Status filter */}
                            <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                                {(['pending', 'reviewed', 'dismissed'] as const).map(s => (
                                    <button key={s} onClick={() => setReportStatusFilter(s)} style={{ flex: 1, padding: '7px 4px', border: reportStatusFilter === s ? `2px solid ${accentCol}` : `1.5px solid ${border}`, borderRadius: 10, background: reportStatusFilter === s ? (dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.07)') : 'transparent', color: reportStatusFilter === s ? accentCol : subCol, fontSize: 12, fontWeight: reportStatusFilter === s ? 700 : 500, cursor: 'pointer' }}>
                                        {s === 'pending' ? (lang === 'en' ? 'Pending' : 'Ожидают') : s === 'reviewed' ? (lang === 'en' ? 'Reviewed' : 'Рассмотрены') : (lang === 'en' ? 'Dismissed' : 'Отклонены')}
                                    </button>
                                ))}
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {reportsLoading ? (
                                    <div style={{ textAlign: 'center', color: subCol, padding: 40, fontSize: 13 }}>{lang === 'en' ? 'Loading...' : 'Загрузка...'}</div>
                                ) : reports.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: 48 }}>
                                        <div style={{ fontSize: 36, marginBottom: 10 }}>🚩</div>
                                        <div style={{ color: subCol, fontSize: 13 }}>{lang === 'en' ? 'No reports' : 'Жалоб нет'}</div>
                                    </div>
                                ) : reports.map(r => {
                                    const reasonLabels: Record<string, string> = { spam: 'Спам', violence: 'Насилие / угрозы', scam: 'Мошенничество', nsfw: 'Неприемлемый контент', harassment: 'Оскорбления / харассмент', other: 'Другое' };
                                    const typeLabels: Record<string, string> = { user: 'Пользователь', group: 'Группа / канал', message: 'Сообщение' };
                                    const typeIcons: Record<string, React.ReactNode> = {
                                        user: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
                                        group: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
                                        message: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
                                    };
                                    const typeColors: Record<string, string> = { user: '#6366f1', group: '#06b6d4', message: '#f59e0b' };
                                    const isUpdating = reportUpdating === r.id;
                                    const isBanning = reportBanning === r.id;
                                    const alreadyDeleted = r.target_type === 'user' && r.target_deleted;
                                    return (
                                        <div key={r.id} style={{ background: cardBg, borderRadius: 14, border: `1px solid ${border}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {/* Header: type badge + date */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: `${typeColors[r.target_type]}18`, color: typeColors[r.target_type], display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    {typeIcons[r.target_type]} {typeLabels[r.target_type] || r.target_type}
                                                </span>
                                                <span style={{ fontSize: 10, fontWeight: 600, color: subCol, marginLeft: 'auto' }}>{fmtDate(r.created_at)} {fmt(r.created_at)}</span>
                                            </div>

                                            {/* Target info */}
                                            <div style={{ background: isOled ? '#07070d' : (dm ? 'rgba(255,255,255,0.03)' : '#f8f7ff'), borderRadius: 10, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 11, color: subCol, marginBottom: 1 }}>{typeLabels[r.target_type]} #{r.target_id}</div>
                                                    {r.target_name ? (
                                                        <div style={{ fontSize: 13, fontWeight: 700, color: alreadyDeleted ? subCol : textCol, textDecoration: alreadyDeleted ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {r.target_type === 'user' ? `@${r.target_name}` : r.target_name}
                                                        </div>
                                                    ) : (
                                                        <div style={{ fontSize: 12, color: subCol, fontStyle: 'italic' }}>нет данных</div>
                                                    )}
                                                </div>
                                                {alreadyDeleted && (
                                                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(239,68,68,0.12)', color: '#ef4444', flexShrink: 0 }}>удалён</span>
                                                )}
                                            </div>

                                            {/* Reason + comment */}
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: textCol }}>{reasonLabels[r.reason] || r.reason}</div>
                                                {r.comment && <div style={{ fontSize: 12, color: subCol, marginTop: 2, lineHeight: 1.5 }}>{r.comment}</div>}
                                            </div>

                                            {/* Reporter */}
                                            <div style={{ fontSize: 11, color: subCol }}>
                                                Жалоба от: <span style={{ color: textCol, fontWeight: 600 }}>@{r.reporter_name}</span>
                                            </div>

                                            {/* Actions */}
                                            {r.status === 'pending' && (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
                                                    {/* Ban button for user reports */}
                                                    {r.target_type === 'user' && !alreadyDeleted && (
                                                        <button onClick={() => setReportConfirmBan(r)} disabled={isBanning || isUpdating} style={{ width: '100%', padding: '9px', borderRadius: 10, border: 'none', background: (isBanning || isUpdating) ? (dm ? '#1a1a2e' : '#f3f4f6') : 'linear-gradient(135deg,#ef4444,#dc2626)', color: (isBanning || isUpdating) ? subCol : 'white', fontSize: 12, fontWeight: 700, cursor: (isBanning || isUpdating) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                                                            {isBanning ? 'Удаление...' : 'Удалить пользователя и закрыть'}
                                                        </button>
                                                    )}
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <button onClick={() => updateReport(r.id, 'reviewed')} disabled={isUpdating || isBanning} style={{ flex: 1, padding: '8px', borderRadius: 10, border: 'none', background: (isUpdating || isBanning) ? (dm ? '#1a1a2e' : '#f3f4f6') : 'linear-gradient(135deg,#10b981,#059669)', color: (isUpdating || isBanning) ? subCol : 'white', fontSize: 12, fontWeight: 700, cursor: (isUpdating || isBanning) ? 'default' : 'pointer' }}>
                                                            {isUpdating ? '...' : '✓ Рассмотрено'}
                                                        </button>
                                                        <button onClick={() => updateReport(r.id, 'dismissed')} disabled={isUpdating || isBanning} style={{ flex: 1, padding: '8px', borderRadius: 10, border: `1.5px solid ${dm ? 'rgba(239,68,68,0.25)' : '#fecaca'}`, background: 'transparent', color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: (isUpdating || isBanning) ? 'default' : 'pointer' }}>
                                                            {isUpdating ? '...' : '✕ Отклонить'}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                            {r.status !== 'pending' && (
                                                <div style={{ fontSize: 11, fontWeight: 600, color: r.status === 'reviewed' ? '#10b981' : subCol }}>
                                                    {r.status === 'reviewed' ? '✓ Рассмотрено' : '✕ Отклонено'}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Edit user modal */}
        {editingUser && (
            <div
                style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                onClick={() => setEditingUser(null)}
            >
                <div
                    style={{ background: bg, borderRadius: 18, padding: 24, width: '100%', maxWidth: 400, boxShadow: '0 8px 40px rgba(0,0,0,0.4)', border: `1px solid ${border}` }}
                    onClick={e => e.stopPropagation()}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                        <div style={{ width: 38, height: 38, borderRadius: '50%', background: editingUser.avatar ? 'transparent' : '#6366f1', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {editingUser.avatar
                                ? <img src={config.fileUrl(editingUser.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <span style={{ color: 'white', fontWeight: 700 }}>{editingUser.username[0]?.toUpperCase()}</span>}
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: textCol }}>Редактировать пользователя</div>
                            <div style={{ fontSize: 11, color: subCol }}>#{editingUser.id} · {lang === 'en' ? 'role' : 'роль'}: {editingUser.role === 'admin' ? (lang === 'en' ? 'Admin' : 'Администратор') : (lang === 'en' ? 'User' : 'Пользователь')}</div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: subCol, marginBottom: 4 }}>Имя</div>
                            <input style={inputStyle()} value={editForm.username} onChange={e => setEditForm(p => ({ ...p, username: e.target.value }))} />
                        </div>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: subCol, marginBottom: 4 }}>Email</div>
                            <input style={inputStyle()} value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} />
                        </div>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: subCol, marginBottom: 4 }}>Тег (@username)</div>
                            <input style={inputStyle()} value={editForm.tag} onChange={e => setEditForm(p => ({ ...p, tag: e.target.value.replace(/^@/, '') }))} placeholder="без @" />
                        </div>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: subCol, marginBottom: 4 }}>Статус</div>
                            <input style={inputStyle()} value={editForm.status} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))} placeholder="Статус пользователя" />
                        </div>

                        <div style={{ background: isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff'), borderRadius: 10, padding: '8px 12px', fontSize: 11, color: subCol }}>
                            <div>📧 Почта: <span style={{ color: textCol }}>{editingUser.email}</span></div>
                            <div>🕐 Последний заход: <span style={{ color: textCol }}>{fmtLastSeen(editingUser.last_seen)}</span></div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={subCol} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> {lang === 'en' ? 'Role' : 'Роль'}: <span style={{ color: textCol }}>{editingUser.role === 'admin' ? (lang === 'en' ? 'Admin' : 'Администратор') : (lang === 'en' ? 'User' : 'Пользователь')}</span></div>
                            <div>📅 Регистрация: <span style={{ color: textCol }}>{fmtDate(editingUser.created_at)}</span></div>
                        </div>

                        {editError && <div style={{ fontSize: 12, color: '#ef4444', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 8 }}>{editError}</div>}

                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                            <button onClick={() => setEditingUser(null)} style={{ flex: 1, padding: '9px', borderRadius: 10, border: `1px solid ${border}`, background: 'none', color: subCol, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                Отмена
                            </button>
                            <button onClick={saveEditUser} disabled={editSaving} style={{ flex: 2, padding: '9px', borderRadius: 10, border: 'none', background: editSaving ? (dm ? '#2a2a3d' : '#e5e7eb') : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: editSaving ? subCol : 'white', cursor: editSaving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
                                {editSaving ? 'Сохранение...' : 'Сохранить'}
                            </button>
                        </div>

                        {/* Password section */}
                        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${border}` }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Сменить пароль</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input
                                    type="text"
                                    placeholder="Новый пароль (мин. 6 символов)"
                                    value={newPassword}
                                    onChange={e => { setNewPassword(e.target.value); setPasswordMsg(''); }}
                                    style={{ ...inputStyle(), flex: 1, marginBottom: 0 }}
                                />
                                <button onClick={savePassword} disabled={passwordSaving || newPassword.length < 6}
                                    style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: newPassword.length >= 6 ? 'linear-gradient(135deg,#f59e0b,#f97316)' : (dm ? '#2a2a3d' : '#e5e7eb'), color: newPassword.length >= 6 ? 'white' : subCol, cursor: newPassword.length >= 6 ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                                    {passwordSaving ? '...' : 'Сохранить'}
                                </button>
                            </div>
                            {passwordMsg && <div style={{ fontSize: 12, marginTop: 6, color: passwordMsg.startsWith('✅') ? '#22c55e' : '#ef4444' }}>{passwordMsg}</div>}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Ban user modal */}
        {banModalUser && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                onClick={() => setBanModalUser(null)}>
                <div style={{ background: bg, borderRadius: 18, padding: '22px 22px 18px', maxWidth: 360, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', border: `1px solid ${border}` }}
                    onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(249,115,22,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                        </div>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: textCol }}>{lang === 'en' ? 'Ban user' : 'Заблокировать пользователя'}</div>
                            <div style={{ fontSize: 12, color: subCol }}>{banModalUser.username}{banModalUser.tag ? ` @${banModalUser.tag}` : ''}</div>
                        </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 5 }}>
                            {lang === 'en' ? 'Reason (shown to user)' : 'Причина (видна пользователю)'}
                        </label>
                        <textarea
                            value={banForm.reason}
                            onChange={e => setBanForm(f => ({ ...f, reason: e.target.value }))}
                            placeholder={lang === 'en' ? 'Spam, harassment, etc.' : 'Спам, оскорбления и т.д.'}
                            rows={2}
                            style={{ ...inputStyle(), resize: 'none' as const, display: 'block' }}
                        />
                    </div>

                    <div style={{ marginBottom: 14 }}>
                        <div
                            onClick={() => setBanForm(f => ({ ...f, temporary: !f.temporary, expiresAt: '' }))}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none', padding: '8px 10px', borderRadius: 10, background: banForm.temporary ? (dm ? 'rgba(249,115,22,0.1)' : 'rgba(249,115,22,0.06)') : 'transparent', border: `1px solid ${banForm.temporary ? 'rgba(249,115,22,0.3)' : border}`, transition: 'all 0.2s' }}
                        >
                            <div style={{ width: 34, height: 18, borderRadius: 9, background: banForm.temporary ? '#f97316' : (dm ? '#3a3a5a' : '#d1d5db'), position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                                <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'white', position: 'absolute', top: 2, left: banForm.temporary ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: banForm.temporary ? '#f97316' : subCol }}>
                                {lang === 'en' ? 'Temporary ban' : 'Временный бан'}
                            </div>
                        </div>
                        {banForm.temporary && (
                            <div style={{ marginTop: 8 }}>
                                <label style={{ fontSize: 11, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 5 }}>
                                    {lang === 'en' ? 'Ban until' : 'Заблокировать до'}
                                </label>
                                <input
                                    type="datetime-local"
                                    value={banForm.expiresAt}
                                    min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                                    onChange={e => setBanForm(f => ({ ...f, expiresAt: e.target.value }))}
                                    style={inputStyle()}
                                />
                            </div>
                        )}
                    </div>

                    {banForm.temporary && banForm.expiresAt && (
                        <div style={{ fontSize: 12, color: '#f97316', background: 'rgba(249,115,22,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 12 }}>
                            ⏱ {lang === 'en' ? 'Auto-unban on' : 'Авторазблокировка'}: {new Date(banForm.expiresAt).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setBanModalUser(null)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1.5px solid ${border}`, background: 'transparent', color: subCol, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                            {lang === 'en' ? 'Cancel' : 'Отмена'}
                        </button>
                        <button
                            onClick={executeBan}
                            disabled={banningId === banModalUser.id || (banForm.temporary && !banForm.expiresAt)}
                            style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: banningId === banModalUser.id ? (dm ? '#2a2a3d' : '#e5e7eb') : 'linear-gradient(135deg,#f97316,#ea580c)', color: banningId === banModalUser.id ? subCol : 'white', fontSize: 13, fontWeight: 700, cursor: banningId === banModalUser.id || (banForm.temporary && !banForm.expiresAt) ? 'not-allowed' : 'pointer' }}>
                            {banningId === banModalUser.id ? (lang === 'en' ? 'Banning...' : 'Блокировка...') : (lang === 'en' ? 'Ban' : 'Заблокировать')}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Ban confirm modal */}
        {reportConfirmBan && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                onClick={() => setReportConfirmBan(null)}>
                <div style={{ background: bg, borderRadius: 18, padding: '22px 22px 18px', maxWidth: 340, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: `1px solid ${border}` }}
                    onClick={e => e.stopPropagation()}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: textCol, textAlign: 'center', marginBottom: 6 }}>Удалить пользователя?</div>
                    <div style={{ fontSize: 12, color: subCol, textAlign: 'center', marginBottom: 18, lineHeight: 1.5 }}>
                        Аккаунт <span style={{ color: textCol, fontWeight: 600 }}>@{reportConfirmBan.target_name}</span> будет удалён, он мгновенно вылетит из приложения. Все жалобы на него закроются как рассмотренные.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setReportConfirmBan(null)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1.5px solid ${border}`, background: 'transparent', color: subCol, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                            Отмена
                        </button>
                        <button onClick={() => banAndResolve(reportConfirmBan)} disabled={reportBanning === reportConfirmBan.id} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                            {reportBanning === reportConfirmBan.id ? 'Удаление...' : 'Удалить'}
                        </button>
                    </div>
                </div>
            </div>
        )}
    </> );
};

export default AdminPanel;
