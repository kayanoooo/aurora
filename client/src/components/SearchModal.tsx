import React, { useState } from 'react';
import { config } from '../config';

interface SearchResult {
    id: number;
    message_text: string;
    sender_name: string;
    timestamp: string;
}

interface SearchModalProps {
    token: string;
    currentUserId: number;
    isDark?: boolean;
    activeChatId?: number;
    activeChatType?: 'private' | 'group';
    onClose: () => void;
    onSelectMessage: (chatType: 'private' | 'group', chatId: number, messageId: number) => void;
}

const SearchModal: React.FC<SearchModalProps> = ({
    token, isDark = false, activeChatId, activeChatType, onClose, onSelectMessage
}) => {
    const dm = isDark;
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchType, setSearchType] = useState<'current' | 'all'>('current');
    const [closing, setClosing] = useState(false);
    const close = () => { setClosing(true); setTimeout(onClose, 180); };

    const handleSearch = async () => {
        if (!query.trim()) return;
        setLoading(true);
        try {
            let url;
            if (searchType === 'current' && activeChatId && activeChatType) {
                url = `${config.API_URL}/search?token=${token}&query=${encodeURIComponent(query)}&chat_type=${activeChatType}&chat_id=${activeChatId}`;
            } else {
                url = `${config.API_URL}/search?token=${token}&query=${encodeURIComponent(query)}`;
            }
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
        if (!search) return text;
        const parts = text.split(new RegExp(`(${search})`, 'gi'));
        return parts.map((part, i) =>
            part.toLowerCase() === search.toLowerCase()
                ? <mark key={i} style={{ backgroundColor: '#6c47d4', color: '#fff', padding: '0 2px', borderRadius: 3 }}>{part}</mark>
                : part
        );
    };

    const t = tokens(dm);

    return (
        <div style={t.overlay} className={closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'} onClick={close}>
            <div style={t.modal} className={closing ? 'modal-exit' : 'modal-enter'} onClick={e => e.stopPropagation()}>
                <div style={t.header}>
                    <span>Поиск сообщений</span>
                    <button onClick={close} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: dm ? '#9999bb' : '#9ca3af' }}>✕</button>
                </div>

                <div style={t.searchArea}>
                    <input
                        type="text"
                        placeholder="Введите текст для поиска..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                        style={t.input}
                        autoFocus
                    />
                    <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 14, color: dm ? '#9999bb' : '#6b7280' }}>
                        <label>
                            <input type="radio" value="current" checked={searchType === 'current'} onChange={() => setSearchType('current')} disabled={!activeChatId} />
                            {' '}В текущем чате
                        </label>
                        <label>
                            <input type="radio" value="all" checked={searchType === 'all'} onChange={() => setSearchType('all')} />
                            {' '}Во всех чатах
                        </label>
                    </div>
                    <button onClick={handleSearch} style={t.searchBtn} disabled={loading}>
                        {loading ? 'Поиск...' : '🔍 Найти'}
                    </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                    {results.length === 0 && !loading && query && (
                        <div style={{ textAlign: 'center', color: dm ? '#9999bb' : '#9ca3af', padding: 40 }}>Ничего не найдено</div>
                    )}
                    {results.map(result => (
                        <div
                            key={result.id}
                            style={t.resultItem}
                            onClick={() => { if (activeChatId) { onSelectMessage(activeChatType || 'private', activeChatId, result.id); close(); } }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: dm ? '#e0e0f0' : '#1e1b4b' }}>
                                <strong>{result.sender_name}</strong>
                                <span style={{ color: dm ? '#9999bb' : '#9ca3af' }}>{new Date(result.timestamp).toLocaleString()}</span>
                            </div>
                            <div style={{ fontSize: 14, wordBreak: 'break-word', color: dm ? '#c0c0d8' : '#374151' }}>
                                {highlightText(result.message_text, query)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const tokens = (dm: boolean) => ({
    overlay: { position: 'fixed' as const, inset: 0, backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
    modal: { backgroundColor: dm ? '#13132a' : '#ffffff', borderRadius: 20, width: 600, maxWidth: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' as const, boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: dm ? '1px solid rgba(255,255,255,0.06)' : '1px solid #ede9fe', color: dm ? '#ffffff' : '#1e1b4b', fontWeight: 700, fontSize: 18 },
    searchArea: { padding: '16px 24px', borderBottom: dm ? '1px solid rgba(255,255,255,0.06)' : '1px solid #ede9fe' },
    input: { width: '100%', padding: '11px 16px', fontSize: 14, border: dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', borderRadius: 12, marginBottom: 12, boxSizing: 'border-box' as const, backgroundColor: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#e0e0f0' : '#1e1b4b', outline: 'none' },
    searchBtn: { width: '100%', padding: 11, background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
    resultItem: { padding: 12, borderBottom: dm ? '1px solid rgba(255,255,255,0.05)' : '1px solid #f0f0f8', cursor: 'pointer', borderRadius: 8, transition: 'background-color 0.15s' },
});

export default SearchModal;
