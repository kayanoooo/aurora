import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { config } from '../config';
import { useLang } from '../i18n';

const isImage = (filename?: string | null, path?: string | null) =>
    /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(filename || path?.split('/').pop() || '');
const isVideo = (filename?: string | null, path?: string | null) =>
    /\.(mp4|webm|mov|avi)$/i.test(filename || path?.split('/').pop() || '');

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
    onBack?: () => void;
    newReply?: { msg_id: number; message_text: string; admin_id: number } | null;
}

const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const RESOLVE_MARKER = '__SUPPORT_RESOLVE__';
const CONFIRM_MARKER = '__SUPPORT_CONFIRMED__';

const SupportChat: React.FC<SupportChatProps> = ({ token, currentUserId, isDark = false, onClose, onBack, newReply }) => {
    const dm = isDark;
    const { t } = useLang();
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [closing, setClosing] = useState(false);
    const [showResolveDialog, setShowResolveDialog] = useState(false);
    const [resolveMarkerId, setResolveMarkerId] = useState<number | null>(null);
    const [uploadingFile, setUploadingFile] = useState(false);
    const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
    const [lightboxType, setLightboxType] = useState<'image' | 'video'>('image');
    const fileInputRef = useRef<HTMLInputElement>(null);
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

    const send = async (filePath?: string, fileName?: string) => {
        const text = input.trim();
        if ((!text && !filePath) || sending) return;
        setSending(true);
        if (text) setInput('');
        const optimistic: any = {
            id: Date.now(),
            sender_id: currentUserId,
            message_text: text,
            is_admin_reply: 0,
            created_at: new Date().toISOString(),
            sender_name: 'Вы',
            sender_tag: '',
            file_path: filePath,
            filename: fileName,
        };
        setMessages(prev => [...prev, optimistic]);
        try {
            await api.sendSupportMessage(token, text, filePath, fileName);
        } catch {
            setMessages(prev => prev.filter(m => m.id !== optimistic.id));
            if (text) setInput(text);
        } finally {
            setSending(false);
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        setUploadingFile(true);
        try {
            const res = await api.uploadFile(token, file);
            if (res.success && res.file_path) {
                await send(res.file_path, res.filename || file.name);
            }
        } catch (err) { console.error('File upload error:', err); }
        finally { setUploadingFile(false); }
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

    const isMobile = window.innerWidth < 600;
    return (
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 2000, backgroundColor: overlayBg, backdropFilter: 'blur(10px)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}
            className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            onClick={close}
        >
            <div
                style={{ backgroundColor: bg, borderRadius: isMobile ? '20px 20px 0 0' : 22, width: isMobile ? '100%' : 480, maxWidth: isMobile ? '100%' : '95vw', height: isMobile ? '92svh' : '82vh', maxHeight: isMobile ? '92svh' : 680, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: shadow, border: 'none', position: 'relative', paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0 }}
                className={(closing ? 'modal-exit' : 'modal-enter') + (isMobile ? ' mobile-bottom-sheet' : '')}
                onClick={e => e.stopPropagation()}
            >
                {isMobile && <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}><div style={{ width: 36, height: 4, borderRadius: 2, background: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' }} /></div>}
                {/* Header */}
                <div style={{ background: bg, padding: isMobile ? '8px 16px 10px' : '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'}` }}>
                    {isMobile && (
                        <button onClick={onBack ? () => { setClosing(true); setTimeout(onBack, 180); } : close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isOled ? '#a78bfa' : '#6366f1', padding: '4px 8px 4px 0', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                        </button>
                    )}
                    <div style={{ width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                        <img src="/logo192.png" alt="Aurora" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: isMobile ? 17 : 15, color: textCol }}>{t('Aurora Support')}</div>
                        <div style={{ fontSize: 11, color: subCol, marginTop: 1 }}>{t('We will reply as soon as possible')}</div>
                    </div>
                    {messages.length > 0 && (
                        <button onClick={() => setMessages([])} style={{ background: isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)', border: 'none', borderRadius: 8, color: isOled ? '#a78bfa' : '#6366f1', cursor: 'pointer', fontSize: 12, padding: '5px 10px', fontWeight: 600 }}>{t('+ New')}</button>
                    )}
                    {!isMobile && (
                        <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: subCol, fontSize: 15, padding: '4px', display: 'flex', alignItems: 'center' }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    )}
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', background: chatBg, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', color: subCol, fontSize: 13, marginTop: 40 }}>{t('Loading...')}</div>
                    ) : messages.length === 0 ? (
                        <div style={{ textAlign: 'center', marginTop: 60 }}>
                            <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', margin: '0 auto 14px', boxShadow: isOled ? '0 0 24px rgba(124,58,237,0.45)' : '0 0 20px rgba(249,115,22,0.4)', border: isOled ? '2px solid rgba(167,139,250,0.2)' : 'none' }}>
                                <img src="/logo192.png" alt="Aurora" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: textCol, marginBottom: 6 }}>{t('Welcome to support')}</div>
                            <div style={{ fontSize: 12, color: subCol, maxWidth: 280, margin: '0 auto', lineHeight: 1.6 }}>
                                {t('Describe your problem or question and we will respond shortly.')}
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
                                                {t('Aurora Support')}
                                            </div>
                                        )}
                                        <div style={{ maxWidth: 280 }}>
                                            {/* Image */}
                                            {(msg as any).file_path && isImage((msg as any).filename, (msg as any).file_path) && (
                                                <div style={{ borderRadius: 14, overflow: 'hidden', cursor: 'pointer', marginBottom: msg.message_text ? 4 : 0, boxShadow: isOled ? '0 4px 20px rgba(124,58,237,0.3)' : '0 2px 12px rgba(0,0,0,0.15)' }}
                                                    onClick={() => { setLightboxSrc(config.fileUrl((msg as any).file_path) ?? null); setLightboxType('image'); }}>
                                                    <img src={config.fileUrl((msg as any).file_path) ?? undefined} alt={(msg as any).filename || 'image'}
                                                        style={{ display: 'block', maxWidth: 280, maxHeight: 240, objectFit: 'cover', width: '100%' }} />
                                                </div>
                                            )}
                                            {/* Video */}
                                            {(msg as any).file_path && isVideo((msg as any).filename, (msg as any).file_path) && (
                                                <div style={{ borderRadius: 14, overflow: 'hidden', cursor: 'pointer', marginBottom: msg.message_text ? 4 : 0, boxShadow: isOled ? '0 4px 20px rgba(124,58,237,0.3)' : '0 2px 12px rgba(0,0,0,0.15)', position: 'relative' }}
                                                    onClick={() => { setLightboxSrc(config.fileUrl((msg as any).file_path) ?? null); setLightboxType('video'); }}>
                                                    <video src={config.fileUrl((msg as any).file_path) ?? undefined}
                                                        style={{ maxWidth: 280, borderRadius: 14, display: 'block', pointerEvents: 'none' }} />
                                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                                                        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            {/* File */}
                                            {(msg as any).file_path && !isImage((msg as any).filename, (msg as any).file_path) && !isVideo((msg as any).filename, (msg as any).file_path) && (
                                                <a href={config.fileUrl((msg as any).file_path) ?? undefined} target="_blank" rel="noopener noreferrer"
                                                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', marginBottom: msg.message_text ? 4 : 0,
                                                        background: isOwn ? (isOled ? 'linear-gradient(135deg,#5b21b6,#7c3aed)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)') : adminBubble,
                                                        borderRadius: isOwn ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                                                        border: isOwn ? 'none' : `1px solid ${border}`,
                                                        textDecoration: 'none',
                                                        boxShadow: isOled ? (isOwn ? '0 2px 12px rgba(124,58,237,0.35)' : '0 2px 8px rgba(0,0,0,0.6)') : (dm ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.07)'),
                                                    }}>
                                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: isOwn ? 'rgba(255,255,255,0.15)' : (dm ? 'rgba(99,102,241,0.15)' : '#ede9fe'), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={isOwn ? 'white' : '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                                    </div>
                                                    <span style={{ fontSize: 12, color: isOwn ? 'rgba(255,255,255,0.9)' : textCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                                        {(msg as any).filename || 'Файл'}
                                                    </span>
                                                </a>
                                            )}
                                            {/* Text bubble */}
                                            {(msg.message_text || !(msg as any).file_path) && (
                                            <div style={{
                                                background: isOwn
                                                    ? (isOled ? 'linear-gradient(135deg, #5b21b6, #7c3aed)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)')
                                                    : adminBubble,
                                                color: isOwn ? 'white' : textCol,
                                                borderRadius: isOwn ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                                                padding: '9px 13px', fontSize: 13, lineHeight: 1.5,
                                                boxShadow: isOled ? (isOwn ? '0 2px 12px rgba(124,58,237,0.35)' : '0 2px 8px rgba(0,0,0,0.6)') : (dm ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.07)'),
                                                border: isOwn ? 'none' : `1px solid ${border}`,
                                                wordBreak: 'break-word',
                                            }}>
                                                {msg.message_text}
                                            </div>
                                            )}
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
                            <div style={{ fontSize: 16, fontWeight: 700, color: textCol, marginBottom: 8 }}>{t('Issue resolved?')}</div>
                            <div style={{ fontSize: 13, color: subCol, marginBottom: 24, lineHeight: 1.55 }}>{t('The administrator marked your issue as resolved. Is everything okay?')}</div>
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
                                >{t('Yes, thank you')}</button>
                                <button
                                    onClick={() => setShowResolveDialog(false)}
                                    style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: `1.5px solid ${border}`, background: 'none', color: subCol, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                                >{t('No')}</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Lightbox */}
                {lightboxSrc && (
                    <div
                        style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
                        onClick={() => setLightboxSrc(null)}
                        onKeyDown={e => e.key === 'Escape' && setLightboxSrc(null)}
                    >
                        {lightboxType === 'image'
                            ? <img src={lightboxSrc} alt="" style={{ maxWidth: '95vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.8)' }} onClick={e => e.stopPropagation()} />
                            : <video src={lightboxSrc} controls autoPlay style={{ maxWidth: '95vw', maxHeight: '90vh', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,0.8)' }} onClick={e => e.stopPropagation()} />
                        }
                        <button onClick={() => setLightboxSrc(null)} style={{ position: 'fixed', top: 18, right: 18, background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%', width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white', zIndex: 3001 }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                )}

                {/* Input */}
                <div style={{ padding: '10px 12px', borderTop: `1px solid ${border}`, background: bg, display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                    <input ref={fileInputRef} type="file" accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip,.rar" style={{ display: 'none' }} onChange={handleFileSelect} />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFile || sending}
                        title={t('Attach file')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: subCol, padding: '6px', borderRadius: 8, display: 'flex', alignItems: 'center', flexShrink: 0, opacity: (uploadingFile || sending) ? 0.4 : 1 }}
                    >
                        {uploadingFile
                            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                        }
                    </button>
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        placeholder={t('Write a message...')}
                        style={{ flex: 1, padding: '9px 13px', borderRadius: 12, border: `1.5px solid ${border}`, background: inputBg, color: textCol, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                        autoFocus
                    />
                    <button
                        onClick={() => send()}
                        disabled={(!input.trim() && !uploadingFile) || sending}
                        style={{ padding: '9px 16px', borderRadius: 12, border: 'none', background: (!input.trim() || sending) ? (isOled ? '#07070d' : (dm ? '#1e1e3a' : '#e5e7eb')) : (isOled ? 'linear-gradient(135deg, #5b21b6, #7c3aed)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)'), color: (!input.trim() || sending) ? subCol : 'white', cursor: (!input.trim() || sending) ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 700, boxShadow: (!input.trim() || sending) ? 'none' : (isOled ? '0 4px 14px rgba(124,58,237,0.4)' : '0 4px 14px rgba(99,102,241,0.35)'), flexShrink: 0 }}
                    >➤</button>
                </div>
            </div>
        </div>
    );
};

export default SupportChat;
