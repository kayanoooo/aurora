import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { config } from '../config';

interface AdminPanelProps {
    token: string;
    isDark?: boolean;
    onClose: () => void;
    newSupportMsg?: { user_id: number; message_text: string; msg_id: number } | null;
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
}

const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });

const AdminPanel: React.FC<AdminPanelProps> = ({ token, isDark = false, onClose, newSupportMsg }) => {
    const dm = isDark;
    const [tab, setTab] = useState<'stats' | 'users' | 'support'>('stats');
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

    // Support
    const [threads, setThreads] = useState<SupportThread[]>([]);
    const [threadsLoading, setThreadsLoading] = useState(false);
    const [activeThread, setActiveThread] = useState<number | null>(null);
    const [threadMsgs, setThreadMsgs] = useState<SupportMessage[]>([]);
    const [threadLoading, setThreadLoading] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [replying, setReplying] = useState(false);
    const threadBottomRef = useRef<HTMLDivElement>(null);

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
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_deleted: 1, username: 'Удалённый пользователь', tag: undefined, avatar: undefined } : u));
        } finally { setDeletingId(null); setConfirmDeleteId(null); }
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

    useEffect(() => { if (tab === 'stats') loadStats(); }, [tab]);
    useEffect(() => { if (tab === 'users') loadUsers(); }, [tab]);
    useEffect(() => { if (tab === 'support') loadThreads(); }, [tab]);
    useEffect(() => { threadBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [threadMsgs]);

    useEffect(() => {
        if (!newSupportMsg) return;
        if (tab === 'support') {
            loadThreads();
            if (activeThread === newSupportMsg.user_id) {
                const thread = threads.find(t => t.user_id === newSupportMsg.user_id);
                setThreadMsgs(prev => [...prev, {
                    id: newSupportMsg.msg_id,
                    sender_id: newSupportMsg.user_id,
                    message_text: newSupportMsg.message_text,
                    is_admin_reply: 0,
                    created_at: new Date().toISOString(),
                    sender_name: thread?.username || 'User',
                    sender_tag: thread?.tag || '',
                    sender_avatar: thread?.avatar,
                }]);
            }
        }
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
    const headerBg = isOled ? 'linear-gradient(135deg, #0a0014 0%, #12002a 100%)' : (dm ? 'linear-gradient(135deg, #1e1a3d 0%, #2d2060 100%)' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)');

    const StatCard = ({ icon, label, day, week, month }: { icon: string; label: string; day: number; week: number; month: number }) => (
        <div style={{ background: cardBg, borderRadius: 14, padding: '14px 16px', border: `1px solid ${border}`, boxShadow: isOled ? '0 2px 12px rgba(0,0,0,0.8)' : (dm ? '0 2px 12px rgba(0,0,0,0.3)' : '0 2px 8px rgba(99,102,241,0.07)') }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 18 }}>{icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                {[['День', day], ['Неделя', week], ['Месяц', month]].map(([lbl, val]) => (
                    <div key={String(lbl)} style={{ flex: 1, textAlign: 'center', background: isOled ? 'rgba(124,58,237,0.08)' : (dm ? 'rgba(99,102,241,0.08)' : '#f5f3ff'), borderRadius: 10, padding: '8px 4px' }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: accentCol }}>{val}</div>
                        <div style={{ fontSize: 10, color: subCol, marginTop: 2 }}>{lbl}</div>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 2000, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            onClick={close}
        >
            <div
                style={{ background: bg, borderRadius: 22, width: 780, maxWidth: '96vw', height: '88vh', maxHeight: 760, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 60px rgba(124,58,237,0.12), 0 30px 80px rgba(0,0,0,0.98)' : (dm ? '0 0 60px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.7)' : '0 0 40px rgba(99,102,241,0.15), 0 20px 60px rgba(0,0,0,0.15)'), border: `1px solid ${border}` }}
                className={closing ? 'modal-exit' : 'modal-enter'}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ background: headerBg, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🔑</div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: 16, color: 'white' }}>Панель администратора</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Aurora Messenger</div>
                    </div>
                    <button onClick={close} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, color: 'white', cursor: 'pointer', fontSize: 15, padding: '4px 9px' }}>✕</button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: `1px solid ${border}`, background: bg, flexShrink: 0 }}>
                    {([
                        { id: 'stats', label: '📊 Статистика' },
                        { id: 'users', label: '👥 Пользователи' },
                        { id: 'support', label: '🎧 Поддержка', badge: threads.reduce((s, t) => s + t.unread_count, 0) },
                    ] as const).map(t => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            style={{
                                flex: 1, padding: '12px 8px', border: 'none', borderBottom: tab === t.id ? `2px solid ${accentCol}` : '2px solid transparent',
                                background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
                                color: tab === t.id ? accentCol : subCol, transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}
                        >
                            {t.label}
                            {(t as any).badge > 0 && (
                                <span style={{ background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 700, borderRadius: 8, padding: '1px 5px', lineHeight: 1.4 }}>
                                    {(t as any).badge > 99 ? '99+' : (t as any).badge}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

                    {/* ─── Stats tab ─── */}
                    {tab === 'stats' && (
                        <div style={{ flex: 1, overflowY: 'auto', padding: 20, background: panelBg, display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {statsLoading ? (
                                <div style={{ textAlign: 'center', color: subCol, marginTop: 60 }}>Загрузка...</div>
                            ) : stats ? (
                                <>
                                    {/* Hero row */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                                        {[
                                            { icon: '👤', label: 'Пользователей', val: stats.total_users, sub: `+${stats.users_day} сегодня` },
                                            { icon: '🌐', label: 'Онлайн сейчас', val: stats.online_now, sub: 'активных сессий' },
                                            { icon: '📅', label: 'За месяц', val: stats.users_month, sub: 'новых пользователей' },
                                        ].map(c => (
                                            <div key={c.label} style={{ background: cardBg, borderRadius: 14, padding: '16px', border: `1px solid ${border}`, textAlign: 'center', boxShadow: isOled ? '0 2px 12px rgba(0,0,0,0.8)' : (dm ? '0 2px 12px rgba(0,0,0,0.3)' : '0 2px 8px rgba(99,102,241,0.07)') }}>
                                                <div style={{ fontSize: 26 }}>{c.icon}</div>
                                                <div style={{ fontSize: 28, fontWeight: 800, color: accentCol, marginTop: 4 }}>{c.val}</div>
                                                <div style={{ fontSize: 11, fontWeight: 600, color: textCol, marginTop: 2 }}>{c.label}</div>
                                                <div style={{ fontSize: 10, color: subCol, marginTop: 2 }}>{c.sub}</div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Stat cards */}
                                    <StatCard icon="💬" label="Сообщения" day={stats.messages_day} week={stats.messages_week} month={stats.messages_month} />
                                    <StatCard icon="📎" label="Файлы" day={stats.files_day} week={stats.files_week} month={stats.files_month} />
                                    <StatCard icon="🆕" label="Регистрации" day={stats.users_day} week={stats.users_week} month={stats.users_month} />

                                    {/* Mini chart */}
                                    {stats.reg_chart.length > 0 && (
                                        <div style={{ background: cardBg, borderRadius: 14, padding: '14px 16px', border: `1px solid ${border}` }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: subCol, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>📈 Регистрации (7 дней)</div>
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

                                    <button onClick={loadStats} style={{ alignSelf: 'center', padding: '8px 20px', border: `1px solid ${border}`, borderRadius: 10, background: 'none', color: accentCol, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                                        🔄 Обновить
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
                                    placeholder="🔍 Поиск по имени, тегу, email..."
                                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: `1.5px solid ${border}`, borderRadius: 10, background: isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff'), color: textCol, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                                />
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', background: panelBg }}>
                                {usersLoading ? (
                                    <div style={{ textAlign: 'center', color: subCol, marginTop: 40, fontSize: 13 }}>Загрузка...</div>
                                ) : users.map(u => {
                                    const avatarSrc = u.avatar ? config.fileUrl(u.avatar) : null;
                                    const isDeleted = !!u.is_deleted;
                                    const isConfirming = confirmDeleteId === u.id;
                                    const isDeleting = deletingId === u.id;
                                    return (
                                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.07)' : (dm ? 'rgba(99,102,241,0.08)' : '#f0f0f8')}`, opacity: isDeleted ? 0.5 : 1 }}>
                                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarSrc ? 'transparent' : (isDeleted ? '#6b7280' : '#6366f1'), flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {avatarSrc
                                                    ? <img src={avatarSrc ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    : <span style={{ color: 'white', fontWeight: 700, fontSize: 14 }}>{isDeleted ? '🗑' : u.username[0]?.toUpperCase()}</span>}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: isDeleted ? subCol : textCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: isDeleted ? 'italic' : 'normal' }}>{u.username}</span>
                                                    {u.tag && <span style={{ fontSize: 11, color: accentCol }}>@{u.tag}</span>}
                                                    {(u.tag === 'kayano' || u.tag === 'durov') && <span title="Разработчик">🔧</span>}
                                                </div>
                                                <div style={{ fontSize: 11, color: subCol }}>{u.email}</div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                                <div style={{ fontSize: 10, color: subCol, textAlign: 'right' }}>
                                                    <div>#{u.id}</div>
                                                    <div>{fmtDate(u.created_at)}</div>
                                                </div>
                                                {!isDeleted && (
                                                    isConfirming ? (
                                                        <div style={{ display: 'flex', gap: 4 }}>
                                                            <button onClick={() => deleteUser(u.id)} disabled={isDeleting} style={{ padding: '3px 8px', borderRadius: 6, border: 'none', background: '#ef4444', color: 'white', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                                                                {isDeleting ? '...' : '✓'}
                                                            </button>
                                                            <button onClick={() => setConfirmDeleteId(null)} style={{ padding: '3px 8px', borderRadius: 6, border: `1px solid ${border}`, background: 'none', color: subCol, cursor: 'pointer', fontSize: 11 }}>✕</button>
                                                        </div>
                                                    ) : (
                                                        <button onClick={() => setConfirmDeleteId(u.id)} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.35)', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                                                            🗑
                                                        </button>
                                                    )
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
                                    <button onClick={loadThreads} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: subCol }}>🔄</button>
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
                                        <span style={{ fontSize: 36 }}>🎧</span>
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
                                                        <div style={{ maxWidth: '70%' }}>
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
                                                            <div style={{ fontSize: 9, color: subCol, marginTop: 2, textAlign: isAdmin ? 'right' : 'left' }}>
                                                                {isAdmin ? 'Поддержка' : msg.sender_name} · {fmt(msg.created_at)}
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
                                                    placeholder="Ответить пользователю..."
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
                </div>
            </div>
        </div>
    );
};

export default AdminPanel;
