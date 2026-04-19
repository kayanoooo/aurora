import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { config } from '../config';

interface SupportMessage {
    id: number;
    sender_id: number;
    message_text: string;
    is_admin_reply: number;
    created_at: string;
    sender_name: string;
    sender_tag: string;
    sender_avatar?: string;
}

interface SupportChatProps {
    token: string;
    currentUserId: number;
    isDark?: boolean;
    onClose: () => void;
    newReply?: { msg_id: number; message_text: string; admin_id: number } | null;
}

const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const RESOLVE_MARKER = '__SUPPORT_RESOLVE__';
const CONFIRM_MARKER = '__SUPPORT_CONFIRMED__';

const SupportChat: React.FC<SupportChatProps> = ({ token, currentUserId, isDark = false, onClose, newReply }) => {
    const dm = isDark;
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [closing, setClosing] = useState(false);
    const [showResolveDialog, setShowResolveDialog] = useState(false);
    const [resolveMarkerId, setResolveMarkerId] = useState<number | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const resolveKey = `aurora_support_resolved_${currentUserId}`;

    const load = async () => {
        setLoading(true);
        try {
            const res = await api.getSupportMessages(token);
            const filtered = (res.messages || []).filter((m: SupportMessage) => m.message_text !== RESOLVE_MARKER && m.message_text !== CONFIRM_MARKER);
            const last = (res.messages || []).slice().reverse().find((m: SupportMessage) => m.is_admin_reply);
            if (last?.message_text === RESOLVE_MARKER) {
                const dismissedId = localStorage.getItem(resolveKey);
                if (dismissedId !== String(last.id)) { setShowResolveDialog(true); setResolveMarkerId(last.id); }
            }
            setMessages(filtered);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);
    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    useEffect(() => {
        if (!newReply) return;
        if (newReply.message_text === RESOLVE_MARKER) {
            const dismissedId = localStorage.getItem(`aurora_support_resolved_${currentUserId}`);
            if (dismissedId !== String(newReply.msg_id)) { setShowResolveDialog(true); setResolveMarkerId(newReply.msg_id); }
            return;
        }
        setMessages(prev => [...prev, {
            id: newReply.msg_id,
            sender_id: newReply.admin_id,
            message_text: newReply.message_text,
            is_admin_reply: 1,
            created_at: new Date().toISOString(),
            sender_name: 'Support',
            sender_tag: 'support',
        }]);
    }, [newReply]);

    const send = async () => {
        const text = input.trim();
        if (!text || sending) return;
        setSending(true);
        setInput('');
        const optimistic: SupportMessage = {
            id: Date.now(),
            sender_id: currentUserId,
            message_text: text,
            is_admin_reply: 0,
            created_at: new Date().toISOString(),
            sender_name: 'Вы',
            sender_tag: '',
        };
        setMessages(prev => [...prev, optimistic]);
        try {
            await api.sendSupportMessage(token, text);
        } catch {
            setMessages(prev => prev.filter(m => m.id !== optimistic.id));
            setInput(text);
        } finally {
            setSending(false);
        }
    };

    const isOled = dm && document.body.classList.contains('oled-theme');

    // Color tokens
    const bg        = isOled ? '#000000'                  : dm ? '#1a1a2e'       : '#ffffff';
    const headerBg  = isOled ? 'linear-gradient(135deg, #0a0014 0%, #18003a 100%)'
                             : dm ? 'linear-gradient(135deg, #1e1a3d 0%, #2d2060 100%)'
                             : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)';
    const chatBg    = isOled ? '#000000'                  : dm ? '#0e0e1f'       : '#f0f2f5';
    const inputBg   = isOled ? '#07070d'                  : dm ? '#12122a'       : '#f5f3ff';
    const border    = isOled ? 'rgba(167,139,250,0.18)'   : dm ? 'rgba(99,102,241,0.25)' : '#ede9fe';
    const textCol   = isOled ? '#e2e0ff'                  : dm ? '#e2e8f0'       : '#1e1b4b';
    const subCol    = isOled ? '#4a4a7a'                  : dm ? '#5a5a8a'       : '#9ca3af';
    const adminBubble = isOled ? '#0a0a18'                : dm ? '#1e1e3a'       : '#ffffff';
    const shadow    = isOled
        ? '0 0 60px rgba(124,58,237,0.12), 0 30px 80px rgba(0,0,0,0.97)'
        : dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)'
        : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)';
    const overlayBg = isOled ? 'rgba(0,0,0,0.88)' : dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)';

    return (
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 2000, backgroundColor: overlayBg, backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            onClick={close}
        >
            <div
                style={{ backgroundColor: bg, borderRadius: 22, width: 480, maxWidth: '95vw', height: '82vh', maxHeight: 680, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: shadow, border: `1px solid ${border}`, position: 'relative' }}
                className={closing ? 'modal-exit' : 'modal-enter'}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ background: headerBg, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: isOled ? '1px solid rgba(167,139,250,0.12)' : 'none' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, boxShadow: isOled ? '0 0 18px rgba(124,58,237,0.5)' : '0 0 14px rgba(249,115,22,0.5)', border: isOled ? '2px solid rgba(167,139,250,0.3)' : '2px solid rgba(255,255,255,0.3)' }}>
                        <img src="/logo192.png" alt="Aurora" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: isOled ? '#e2d9ff' : 'white' }}>Поддержка Aurora</div>
                        <div style={{ fontSize: 11, color: isOled ? 'rgba(196,181,253,0.6)' : 'rgba(255,255,255,0.65)' }}>Мы ответим как можно скорее</div>
                    </div>
                    {messages.length > 0 && (
                        <button
                            onClick={() => setMessages([])}
                            title="Новый чат"
                            style={{ background: isOled ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.15)', border: isOled ? '1px solid rgba(167,139,250,0.2)' : 'none', borderRadius: 8, color: isOled ? '#c4b5fd' : 'white', cursor: 'pointer', fontSize: 12, padding: '5px 10px', lineHeight: 1, fontWeight: 600 }}
                        >+ Новый</button>
                    )}
                    <button
                        onClick={close}
                        style={{ background: isOled ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.15)', border: isOled ? '1px solid rgba(167,139,250,0.2)' : 'none', borderRadius: 8, color: isOled ? '#c4b5fd' : 'white', cursor: 'pointer', fontSize: 15, padding: '4px 9px', lineHeight: 1 }}
                    >✕</button>
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', background: chatBg, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', color: subCol, fontSize: 13, marginTop: 40 }}>Загрузка...</div>
                    ) : messages.length === 0 ? (
                        <div style={{ textAlign: 'center', marginTop: 60 }}>
                            <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', margin: '0 auto 14px', boxShadow: isOled ? '0 0 24px rgba(124,58,237,0.45)' : '0 0 20px rgba(249,115,22,0.4)', border: isOled ? '2px solid rgba(167,139,250,0.2)' : 'none' }}>
                                <img src="/logo192.png" alt="Aurora" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: textCol, marginBottom: 6 }}>Добро пожаловать в поддержку</div>
                            <div style={{ fontSize: 12, color: subCol, maxWidth: 280, margin: '0 auto', lineHeight: 1.6 }}>
                                Опишите вашу проблему или вопрос, и мы ответим в ближайшее время.
                            </div>
                        </div>
                    ) : (
                        messages.map(msg => {
                            const isOwn = !msg.is_admin_reply;
                            const avatarSrc = msg.sender_avatar ? config.fileUrl(msg.sender_avatar) : null;
                            return (
                                <div key={msg.id} style={{ display: 'flex', flexDirection: isOwn ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8 }}>
                                    {!isOwn && (
                                        <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', boxShadow: isOled ? '0 0 10px rgba(124,58,237,0.4)' : '0 0 8px rgba(249,115,22,0.4)', border: isOled ? '1.5px solid rgba(167,139,250,0.25)' : 'none' }}>
                                            {avatarSrc
                                                ? <img src={avatarSrc ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : <img src="/logo192.png" alt="Aurora" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                        </div>
                                    )}
                                    <div style={{ maxWidth: '72%' }}>
                                        {!isOwn && (
                                            <div style={{ fontSize: 11, color: isOled ? '#a78bfa' : '#6366f1', fontWeight: 600, marginBottom: 3, paddingLeft: 4 }}>
                                                Поддержка Aurora
                                            </div>
                                        )}
                                        <div style={{
                                            background: isOwn
                                                ? (isOled ? 'linear-gradient(135deg, #5b21b6, #7c3aed)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)')
                                                : adminBubble,
                                            color: isOwn ? 'white' : textCol,
                                            borderRadius: isOwn ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                                            padding: '9px 13px',
                                            fontSize: 13,
                                            lineHeight: 1.5,
                                            boxShadow: isOled
                                                ? (isOwn ? '0 2px 12px rgba(124,58,237,0.35)' : '0 2px 8px rgba(0,0,0,0.6)')
                                                : (dm ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.07)'),
                                            border: isOwn ? 'none' : `1px solid ${border}`,
                                            wordBreak: 'break-word',
                                        }}>
                                            {msg.message_text}
                                        </div>
                                        <div style={{ fontSize: 10, color: subCol, marginTop: 3, textAlign: isOwn ? 'right' : 'left', paddingLeft: isOwn ? 0 : 4 }}>
                                            {formatTime(msg.created_at)}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={bottomRef} />
                </div>

                {/* Resolve dialog */}
                {showResolveDialog && (
                    <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: isOled ? 'rgba(0,0,0,0.9)' : (dm ? 'rgba(10,6,30,0.82)' : 'rgba(30,20,60,0.55)'), backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 22 }}>
                        <div style={{ background: isOled ? '#000000' : (dm ? '#1a1a2e' : '#ffffff'), borderRadius: 18, padding: '28px 28px 22px', width: 280, textAlign: 'center', boxShadow: isOled ? '0 0 40px rgba(124,58,237,0.2), 0 20px 60px rgba(0,0,0,0.95)' : (dm ? '0 0 40px rgba(99,102,241,0.35), 0 20px 60px rgba(0,0,0,0.7)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.15)'), border: `1px solid ${border}` }}>
                            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: textCol, marginBottom: 8 }}>Вопрос решён?</div>
                            <div style={{ fontSize: 13, color: subCol, marginBottom: 24, lineHeight: 1.55 }}>Администратор отметил ваш вопрос как решённый. Всё в порядке?</div>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button
                                    onClick={async () => {
                                        if (resolveMarkerId) localStorage.setItem(`aurora_support_resolved_${currentUserId}`, String(resolveMarkerId));
                                        try { await api.sendSupportMessage(token, CONFIRM_MARKER); } catch {}
                                        setShowResolveDialog(false);
                                        setMessages([]);
                                        close();
                                    }}
                                    style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(16,185,129,0.35)' }}
                                >Да, спасибо</button>
                                <button
                                    onClick={() => setShowResolveDialog(false)}
                                    style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: `1.5px solid ${border}`, background: 'none', color: subCol, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                                >Нет</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Input */}
                <div style={{ padding: '10px 12px', borderTop: `1px solid ${border}`, background: bg, display: 'flex', gap: 8, flexShrink: 0 }}>
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        placeholder="Напишите сообщение..."
                        style={{ flex: 1, padding: '9px 13px', borderRadius: 12, border: `1.5px solid ${border}`, background: inputBg, color: textCol, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                        autoFocus
                    />
                    <button
                        onClick={send}
                        disabled={!input.trim() || sending}
                        style={{ padding: '9px 16px', borderRadius: 12, border: 'none', background: (!input.trim() || sending) ? (isOled ? '#07070d' : (dm ? '#1e1e3a' : '#e5e7eb')) : (isOled ? 'linear-gradient(135deg, #5b21b6, #7c3aed)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)'), color: (!input.trim() || sending) ? subCol : 'white', cursor: (!input.trim() || sending) ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, boxShadow: (!input.trim() || sending) ? 'none' : (isOled ? '0 4px 14px rgba(124,58,237,0.4)' : '0 4px 14px rgba(99,102,241,0.35)'), flexShrink: 0 }}
                    >➤</button>
                </div>
            </div>
        </div>
    );
};

export default SupportChat;
