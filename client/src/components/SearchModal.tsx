import React, { useState, useRef } from 'react';
import { config } from '../config';
import { useLang } from '../i18n';

interface SearchResult {
    id: number;
    message_text: string;
    sender_name: string;
    timestamp: string;
    file_path?: string;
    filename?: string;
    chat_type?: string;
    chat_id?: number;
}

interface GroupMember { id: number; username: string; }

interface SearchModalProps {
    token: string;
    currentUserId: number;
    isDark?: boolean;
    activeChatId?: number;
    activeChatType?: 'private' | 'group';
    groupMembers?: GroupMember[];
    onClose: () => void;
    onSelectMessage: (chatType: 'private' | 'group', chatId: number, messageId: number) => void;
}

type ContentType = 'all' | 'text' | 'media' | 'links';

const SearchModal: React.FC<SearchModalProps> = ({
    token, isDark = false, activeChatId, activeChatType, groupMembers = [], onClose, onSelectMessage
}) => {
    const dm = isDark;
    const { t } = useLang();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchType, setSearchType] = useState<'current' | 'all'>('current');
    const [closing, setClosing] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [contentType, setContentType] = useState<ContentType>('all');
    const [senderId, setSenderId] = useState<number | ''>('');
    const inputRef = useRef<HTMLInputElement>(null);
    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const hasFilters = dateFrom || dateTo || contentType !== 'all' || (senderId !== '' && activeChatType === 'group');
    const clearFilters = () => { setDateFrom(''); setDateTo(''); setContentType('all'); setSenderId(''); };

    const handleSearch = async () => {
        if (!query.trim() && !hasFilters) return;
        setLoading(true);
        try {
            let url = `${config.API_URL}/search?token=${token}&query=${encodeURIComponent(query)}`;
            if (searchType === 'current' && activeChatId && activeChatType) {
                url += `&chat_type=${activeChatType}&chat_id=${activeChatId}`;
            }
            if (dateFrom) url += `&date_from=${dateFrom}`;
            if (dateTo) url += `&date_to=${dateTo}`;
            if (contentType !== 'all') url += `&content_type=${contentType}`;
            if (senderId && activeChatType === 'group') url += `&sender_id=${senderId}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setResults(data.results || []);
        } catch (error) {
            console.error('Search failed:', error);
            setResults([]);
        } finally {
            setLoading(false);
        }
    };

    const highlightText = (text: string, search: string) => {
        if (!search || !text) return text;
        const parts = text.split(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
        return parts.map((part, i) =>
            part.toLowerCase() === search.toLowerCase()
                ? <mark key={i} style={{ backgroundColor: '#6c47d4', color: '#fff', padding: '0 2px', borderRadius: 3 }}>{part}</mark>
                : part
        );
    };

    const isOled = dm && document.body.classList.contains('oled-theme');
    const bg = isOled ? '#000000' : (dm ? '#1a1a2e' : '#ffffff');
    const cardBg = isOled ? '#050508' : (dm ? '#12122a' : '#f8f7ff');
    const border = isOled ? 'rgba(167,139,250,0.2)' : (dm ? 'rgba(99,102,241,0.25)' : '#ede9fe');
    const inputBg = isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff');
    const textCol = dm ? '#e2e8f0' : '#1e1b4b';
    const subCol = dm ? '#9999bb' : '#6b7280';
    const accent = '#6366f1';
    const isMobile = window.innerWidth < 600;
    const shadow = dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)';

    const contentTypes: { id: ContentType; label: string; icon: string }[] = [
        { id: 'all', label: t('All'), icon: '🔍' },
        { id: 'text', label: t('Text'), icon: '💬' },
        { id: 'media', label: t('Media'), icon: '📎' },
        { id: 'links', label: t('Links'), icon: '🔗' },
    ];

    const panelStyle: React.CSSProperties = isMobile
        ? { position: 'fixed', left: 0, right: 0, bottom: 0, backgroundColor: bg, borderRadius: '20px 20px 0 0', maxHeight: '92svh', display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: 'env(safe-area-inset-bottom, 0px)', boxShadow: dm ? '0 0 50px rgba(99,102,241,0.22), 0 -4px 40px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.14), 0 -4px 30px rgba(0,0,0,0.15)' }
        : { backgroundColor: bg, borderRadius: 20, width: 600, maxWidth: '92vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: shadow, border: `1px solid ${border}` };

    return (
        <div
            style={{ position: 'fixed', inset: 0, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', zIndex: 2000 }}
            className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}
            onClick={close}
        >
            <div
                style={panelStyle}
                className={(closing ? 'modal-exit' : 'modal-enter') + (isMobile ? ' mobile-bottom-sheet' : '')}
                onClick={e => e.stopPropagation()}
            >
                {isMobile && <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px', flexShrink: 0 }}><div style={{ width: 36, height: 4, borderRadius: 2, background: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' }} /></div>}

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: isMobile ? '8px 16px 12px' : '18px 24px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: isMobile ? 16 : 18, color: textCol }}>{t('Search messages')}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                            onClick={() => setShowFilters(f => !f)}
                            style={{ background: showFilters ? (isOled ? 'rgba(139,92,246,0.2)' : 'rgba(99,102,241,0.12)') : 'none', border: `1px solid ${showFilters ? accent : border}`, borderRadius: 8, padding: '5px 10px', cursor: 'pointer', color: showFilters ? accent : subCol, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s' }}
                        >
                            ⚙ {t('Filters')}{hasFilters ? ' •' : ''}
                        </button>
                        <button onClick={close} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: subCol, padding: 4, lineHeight: 1 }}>✕</button>
                    </div>
                </div>

                {/* Search input + scope */}
                <div style={{ padding: isMobile ? '12px 16px 0' : '16px 24px 0', flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        <input
                            ref={inputRef}
                            type="text"
                            placeholder={t('Enter text to search...')}
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSearch()}
                            style={{ flex: 1, padding: '10px 14px', fontSize: 14, border: `1.5px solid ${border}`, borderRadius: 12, backgroundColor: inputBg, color: textCol, outline: 'none', fontFamily: 'inherit' }}
                            autoFocus
                        />
                        <button onClick={handleSearch} disabled={loading} style={{ padding: '10px 16px', background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600, flexShrink: 0, opacity: loading ? 0.7 : 1 }}>
                            {loading ? '...' : '🔍'}
                        </button>
                    </div>

                    {/* Scope */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        {(['current', 'all'] as const).map(s => (
                            <button key={s} onClick={() => setSearchType(s)} disabled={s === 'current' && !activeChatId}
                                style={{ padding: '5px 12px', borderRadius: 20, border: `1.5px solid ${searchType === s ? accent : border}`, background: searchType === s ? (isOled ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.1)') : 'none', color: searchType === s ? accent : subCol, fontSize: 12, fontWeight: 600, cursor: s === 'current' && !activeChatId ? 'not-allowed' : 'pointer', opacity: s === 'current' && !activeChatId ? 0.4 : 1, transition: 'all 0.15s' }}>
                                {s === 'current' ? t('In current chat') : t('In all chats')}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Filters panel */}
                {showFilters && (
                    <div style={{ padding: isMobile ? '0 16px 12px' : '0 24px 12px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
                        {/* Content type chips */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                            {contentTypes.map(ct => (
                                <button key={ct.id} onClick={() => setContentType(ct.id)}
                                    style={{ padding: '5px 12px', borderRadius: 20, border: `1.5px solid ${contentType === ct.id ? accent : border}`, background: contentType === ct.id ? (isOled ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.1)') : cardBg, color: contentType === ct.id ? accent : subCol, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}>
                                    {ct.icon} {ct.label}
                                </button>
                            ))}
                        </div>

                        {/* Date range */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: activeChatType === 'group' && groupMembers.length > 0 ? 10 : 0 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: subCol, marginBottom: 4, fontWeight: 600 }}>{t('From')}</div>
                                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                                    style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${border}`, backgroundColor: inputBg, color: textCol, fontSize: 13, outline: 'none', boxSizing: 'border-box', colorScheme: dm ? 'dark' : 'light' }} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: subCol, marginBottom: 4, fontWeight: 600 }}>{t('To')}</div>
                                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                                    style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${border}`, backgroundColor: inputBg, color: textCol, fontSize: 13, outline: 'none', boxSizing: 'border-box', colorScheme: dm ? 'dark' : 'light' }} />
                            </div>
                        </div>

                        {/* Sender (group only) */}
                        {activeChatType === 'group' && groupMembers.length > 0 && (
                            <div>
                                <div style={{ fontSize: 11, color: subCol, marginBottom: 4, fontWeight: 600 }}>{t('Sender')}</div>
                                <select value={senderId} onChange={e => setSenderId(e.target.value ? Number(e.target.value) : '')}
                                    style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${border}`, backgroundColor: inputBg, color: textCol, fontSize: 13, outline: 'none' }}>
                                    <option value="">{t('All participants')}</option>
                                    {groupMembers.map((m: GroupMember) => (
                                        <option key={m.id} value={m.id}>{m.username}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {hasFilters && (
                            <button onClick={clearFilters} style={{ marginTop: 8, padding: '4px 10px', background: 'none', border: `1px solid ${border}`, borderRadius: 8, color: subCol, fontSize: 12, cursor: 'pointer' }}>
                                ✕ {t('Clear filters')}
                            </button>
                        )}
                    </div>
                )}

                {/* Results */}
                <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '8px 16px 16px' : '12px 24px 20px' }}>
                    {loading && (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                            <div style={{ width: 24, height: 24, border: `2px solid ${dm ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.2)'}`, borderTopColor: accent, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                        </div>
                    )}
                    {!loading && results.length === 0 && (query || hasFilters) && (
                        <div style={{ textAlign: 'center', color: subCol, padding: 40 }}>
                            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                            {t('No results')}
                        </div>
                    )}
                    {!loading && results.map(result => (
                        <div
                            key={result.id}
                            style={{ padding: '10px 12px', marginBottom: 6, backgroundColor: cardBg, borderRadius: 12, cursor: 'pointer', border: `1px solid ${isOled ? 'rgba(167,139,250,0.08)' : (dm ? 'rgba(99,102,241,0.1)' : '#f0eeff')}`, transition: 'all 0.15s' }}
                            onClick={() => {
                                if (activeChatId && activeChatType) {
                                    onSelectMessage(activeChatType, activeChatId, result.id);
                                    close();
                                }
                            }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = accent)}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = isOled ? 'rgba(167,139,250,0.08)' : (dm ? 'rgba(99,102,241,0.1)' : '#f0eeff'))}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
                                <span style={{ fontWeight: 700, color: accent }}>{result.sender_name}</span>
                                <span style={{ color: subCol }}>{new Date(result.timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                            </div>
                            {result.message_text ? (
                                <div style={{ fontSize: 13, color: textCol, wordBreak: 'break-word', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                                    {highlightText(result.message_text, query)}
                                </div>
                            ) : result.filename ? (
                                <div style={{ fontSize: 13, color: subCol, display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span>📎</span> {result.filename}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default SearchModal;
