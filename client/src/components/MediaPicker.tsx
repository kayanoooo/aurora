import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { config } from '../config';
import { useLang } from '../i18n';

// ─── Emoji data ──────────────────────────────────────────────────────────────
export const EMOJI_CATEGORIES = [
    { label: '😀', name: 'Смайлы', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😋','😛','😝','😜','🤪','🧐','🤓','😎','😏','😒','😔','😟','😕','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😮','🥱','😴','😵','🤢','🤮','🤧','😷','🤒','🤕'] },
    { label: '👋', name: 'Жесты', emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','💅','🖕','✍️','🤳'] },
    { label: '❤️', name: 'Символы', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','✨','💫','⭐','🌟','🔥','💥','💢','💨','💦','💧','💤','🔔','🔕','💬','💭','‼️','⁉️','✅','❌','❎','💯','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤'] },
    { label: '🎉', name: 'Праздники', emojis: ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🥈','🥉','🏅','🎖️','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎮','🕹️','🎲','🎯','🎳','🃏','🀄','🎱','🎻'] },
    { label: '🐱', name: 'Животные', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐴','🦄','🐝','🦋','🐌','🐞','🐢','🐍','🦎','🐙','🐬','🐳','🐋','🦈','🦑','🐡','🐠','🐟','🦓','🦒','🦘','🐘','🦏','🐪','🦬','🦙'] },
    { label: '🍕', name: 'Еда', emojis: ['🍎','🍊','🍋','🍌','🍉','🍇','🍓','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🌽','🥕','🍕','🍔','🍟','🌭','🍿','🧂','🥓','🍗','🍖','🍣','🍱','🥟','🦪','🍜','🍝','🍛','🍲','🍳','🧇','🥞','🧈','🍞','🥐','🥯','🧀','🥚','🍰','🎂','🧁','🍩','🍪','🍫','🍬','🍭','🍺','🍻','🥂','🍷','🥃','🍸','🍹','☕','🍵','🧃','🥤','🧋'] },
    { label: '⚽', name: 'Разное', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🥍','🏑','🏏','⛳','🎿','🛷','🥌','🎯','🎳','🏹','🎣','🤿','🎽','🚗','🚕','🚙','🚌','🏎️','🚓','🚑','🚒','✈️','🚀','🛸','🚂','⛵','🛥️','🚁','🛺','🚲','🛵','🏠','🏡','🏢','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','🗼','🗽','⛪','🕌','⛩️','🌍','🌎','🌏','⛰️','🌋','🏕️','🏖️','🏜️','🏝️','🌅','🌄','🌠','🎇','🎆'] },
];

// ─── Types ────────────────────────────────────────────────────────────────────
export interface StickerItem { id: string; url: string; }
export interface StickerPack { id: string; name: string; emoji: string; stickers: StickerItem[]; }
interface SavedGif { id: string; url: string; previewUrl: string; }

const LS_PACKS = 'aurora_sticker_packs';
const LS_GIFS = 'aurora_saved_gifs';
const LS_GIPHY_KEY = 'aurora_giphy_key';
const DEFAULT_GIPHY_KEY = 'dc6zaTOxFJmzC';

const loadPacks = (): StickerPack[] => {
    try { return JSON.parse(localStorage.getItem(LS_PACKS) || '[]'); } catch { return []; }
};
const savePacks = (packs: StickerPack[]) => localStorage.setItem(LS_PACKS, JSON.stringify(packs));
const loadSavedGifs = (): SavedGif[] => {
    try { return JSON.parse(localStorage.getItem(LS_GIFS) || '[]'); } catch { return []; }
};
const saveSavedGifs = (gifs: SavedGif[]) => localStorage.setItem(LS_GIFS, JSON.stringify(gifs));

const LS_RECENT_STICKERS = 'aurora_recent_stickers';
const loadRecentStickers = (): string[] => {
    try { return JSON.parse(localStorage.getItem(LS_RECENT_STICKERS) || '[]'); } catch { return []; }
};
const addRecentSticker = (url: string) => {
    const prev = loadRecentStickers();
    const next = [url, ...prev.filter(u => u !== url)].slice(0, 20);
    localStorage.setItem(LS_RECENT_STICKERS, JSON.stringify(next));
};

const RECENT_PACK_ID = '__recent__';

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ─── Props ────────────────────────────────────────────────────────────────────
interface MediaPickerProps {
    onSelectEmoji: (emoji: string) => void;
    onSendSticker: (url: string) => void;
    onSendGif: (url: string) => void;
    onClose: () => void;
    isDark?: boolean;
    token: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
const MediaPicker: React.FC<MediaPickerProps> = ({
    onSelectEmoji, onSendSticker, onSendGif, onClose, isDark = false, token,
}) => {
    const { t } = useLang();
    const dm = isDark;
    const ref = useRef<HTMLDivElement>(null);
    const [closing, setClosing] = useState(false);

    // Tab: 0=Emoji, 1=Stickers, 2=GIF
    const [tab, setTab] = useState(0);

    // ── Emoji ──
    const [emojiCat, setEmojiCat] = useState(0);

    // ── Stickers ──
    const [packs, setPacks] = useState<StickerPack[]>(loadPacks);
    const [recentStickers, setRecentStickers] = useState<string[]>(loadRecentStickers);
    const [selectedPackId, setSelectedPackId] = useState<string>(RECENT_PACK_ID);
    const [packCtxMenu, setPackCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
    const [createPackOpen, setCreatePackOpen] = useState(false);
    const [newPackName, setNewPackName] = useState('');
    const [newPackEmoji, setNewPackEmoji] = useState('🎭');
    const [editPackId, setEditPackId] = useState<string | null>(null);
    const [editPackName, setEditPackName] = useState('');
    const [uploadingSticker, setUploadingSticker] = useState(false);
    const stickerFileRef = useRef<HTMLInputElement>(null);

    // ── GIF ──
    const [gifQuery, setGifQuery] = useState('');
    const [gifs, setGifs] = useState<any[]>([]);
    const [gifLoading, setGifLoading] = useState(false);
    const [savedGifs, setSavedGifs] = useState<SavedGif[]>(loadSavedGifs);
    const [gifSubTab, setGifSubTab] = useState<'trending' | 'saved'>('trending');
    const gifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const close = useCallback(() => {
        setClosing(true);
        setTimeout(onClose, 140);
    }, [onClose]);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) close();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [close]);

    // Close pack context menu on outside click
    useEffect(() => {
        if (!packCtxMenu) return;
        const handler = () => setPackCtxMenu(null);
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [packCtxMenu]);

    // Load GIFs
    const fetchGifs = useCallback(async (query: string) => {
        const key = localStorage.getItem(LS_GIPHY_KEY) || DEFAULT_GIPHY_KEY;
        setGifLoading(true);
        try {
            const endpoint = query.trim()
                ? `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(query)}&limit=24&rating=pg`
                : `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=24&rating=pg`;
            const res = await fetch(endpoint);
            const json = await res.json();
            setGifs(json.data || []);
        } catch { setGifs([]); }
        finally { setGifLoading(false); }
    }, []);

    useEffect(() => {
        if (tab !== 2) return;
        if (gifSubTab !== 'trending') return;
        if (gifTimerRef.current) clearTimeout(gifTimerRef.current);
        gifTimerRef.current = setTimeout(() => fetchGifs(gifQuery), gifQuery ? 600 : 0);
        return () => { if (gifTimerRef.current) clearTimeout(gifTimerRef.current); };
    }, [tab, gifQuery, gifSubTab, fetchGifs]);

    // Sticker helpers
    const persistPacks = (next: StickerPack[]) => { setPacks(next); savePacks(next); };

    const createPack = () => {
        if (!newPackName.trim()) return;
        const pack: StickerPack = { id: uid(), name: newPackName.trim(), emoji: newPackEmoji, stickers: [] };
        persistPacks([...packs, pack]);
        setSelectedPackId(pack.id);
        setNewPackName('');
        setNewPackEmoji('🎭');
        setCreatePackOpen(false);
    };

    const deletePack = (id: string) => {
        persistPacks(packs.filter(p => p.id !== id));
        if (selectedPackId === id) setSelectedPackId(RECENT_PACK_ID);
        setPackCtxMenu(null);
    };

    const renamePackSave = () => {
        if (!editPackId) return;
        persistPacks(packs.map(p => p.id === editPackId ? { ...p, name: editPackName } : p));
        setEditPackId(null);
    };

    const deleteSticker = (packId: string, stickerId: string) => {
        persistPacks(packs.map(p => p.id === packId ? { ...p, stickers: p.stickers.filter(s => s.id !== stickerId) } : p));
    };

    const addStickerFile = async (file: File) => {
        if (!selectedPackId) return;
        if (!file.type.startsWith('image/')) return;
        setUploadingSticker(true);
        try {
            const res = await api.uploadFile(token, file);
            if (res.file_path) {
                const fullUrl = config.fileUrl(res.file_path) || res.file_path;
                persistPacks(packs.map(p =>
                    p.id === selectedPackId
                        ? { ...p, stickers: [...p.stickers, { id: uid(), url: fullUrl }] }
                        : p
                ));
            }
        } catch {}
        setUploadingSticker(false);
    };

    // GIF helpers
    const saveGifEntry = (entry: GifEntry) => {
        if (savedGifs.some(g => g.id === entry.id)) return;
        const next = [{ id: entry.id, url: entry.url, previewUrl: entry.previewUrl }, ...savedGifs];
        setSavedGifs(next);
        saveSavedGifs(next);
    };
    const removeSavedGif = (id: string) => {
        const next = savedGifs.filter(g => g.id !== id);
        setSavedGifs(next);
        saveSavedGifs(next);
    };
    const isGifSaved = (id: string) => savedGifs.some(g => g.id === id);
    const toggleSavedGif = (entry: GifEntry) => {
        if (isGifSaved(entry.id)) removeSavedGif(entry.id);
        else saveGifEntry(entry);
    };

    // ─── Styles ────────────────────────────────────────────────────────────────
    const isOled = dm && document.body.classList.contains('oled-theme');
    const bg = isOled ? '#000000' : (dm ? '#1a1a2e' : '#ffffff');
    const sidebarBg = isOled ? '#050508' : (dm ? '#12122a' : '#f8f9fa');
    const inputBg2 = isOled ? '#050508' : (dm ? '#12122a' : '#f5f3ff');
    const border = isOled ? 'rgba(167,139,250,0.18)' : (dm ? 'rgba(99,102,241,0.2)' : '#e8e8f0');
    const text = dm ? '#e2e8f0' : '#1e1b4b';
    const subtext = dm ? '#888' : '#9ca3af';
    const accent = '#6366f1';

    const isMobileView = typeof window !== 'undefined' && window.innerWidth < 640;
    const panelStyle: React.CSSProperties = isMobileView ? {
        position: 'fixed',
        bottom: 64,
        left: 0,
        right: 0,
        width: '100vw',
        height: 380,
        backgroundColor: bg,
        borderRadius: '16px 16px 0 0',
        boxShadow: '0 -4px 32px rgba(0,0,0,0.4)',
        border: `1px solid ${border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 600,
    } : {
        position: 'absolute',
        bottom: 62,
        right: 0,
        width: 380,
        height: 460,
        backgroundColor: bg,
        borderRadius: 16,
        boxShadow: dm ? '0 8px 40px rgba(0,0,0,0.6)' : '0 8px 40px rgba(99,102,241,0.18)',
        border: `1px solid ${border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 600,
    };

    const tabBarStyle: React.CSSProperties = {
        display: 'flex',
        borderBottom: `1px solid ${border}`,
        flexShrink: 0,
    };

    const tabBtnStyle = (active: boolean): React.CSSProperties => ({
        flex: 1,
        padding: '10px 0',
        background: 'none',
        border: 'none',
        borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
        color: active ? accent : subtext,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        transition: 'all 0.15s',
        fontFamily: 'inherit',
    });

    const selectedPack = packs.find(p => p.id === selectedPackId) || null;

    // ─── Emoji tab ─────────────────────────────────────────────────────────────
    const renderEmojiTab = () => (
        <>
            {/* Category tabs */}
            <div style={{ display: 'flex', overflowX: 'auto', padding: '6px 8px', borderBottom: `1px solid ${border}`, gap: 2, flexShrink: 0 }}>
                {EMOJI_CATEGORIES.map((cat, i) => (
                    <button key={i} onClick={() => setEmojiCat(i)} className="emoji-btn" style={{ background: emojiCat === i ? (dm ? '#2d3a5a' : '#e8f0fe') : 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: 0, borderRadius: 6, flexShrink: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={cat.name}>
                        {cat.label}
                    </button>
                ))}
            </div>
            {/* Category name */}
            <div style={{ padding: '4px 12px', fontSize: 11, color: subtext, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', backgroundColor: sidebarBg, flexShrink: 0 }}>
                {EMOJI_CATEGORIES[emojiCat].name}
            </div>
            {/* Grid */}
            <div style={{ display: 'flex', flexWrap: 'wrap', padding: 8, overflowY: 'auto', flex: 1 }}>
                {EMOJI_CATEGORIES[emojiCat].emojis.map((emoji, i) => (
                    <button key={i} onClick={() => onSelectEmoji(emoji)} className="emoji-btn" style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', padding: 0, borderRadius: 6, lineHeight: 1, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={emoji}>
                        {emoji}
                    </button>
                ))}
            </div>
        </>
    );

    // ─── Stickers tab ──────────────────────────────────────────────────────────
    const renderStickersTab = () => (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Pack sidebar */}
            <div style={{ width: 52, borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0', gap: 4, overflowY: 'auto', flexShrink: 0, backgroundColor: sidebarBg }}>
                {/* Recent stickers button */}
                <button
                    title={t('Recent')}
                    onClick={() => setSelectedPackId(RECENT_PACK_ID)}
                    style={{ width: 38, height: 38, borderRadius: 10, border: `2px solid ${selectedPackId === RECENT_PACK_ID ? accent : 'transparent'}`, background: selectedPackId === RECENT_PACK_ID ? (dm ? 'rgba(99,102,241,0.2)' : '#ede9fe') : 'none', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.12s' }}
                >
                    🕐
                </button>
                {packs.map(pack => (
                    <button
                        key={pack.id}
                        title={pack.name}
                        onContextMenu={e => { e.preventDefault(); setPackCtxMenu({ id: pack.id, x: e.clientX, y: e.clientY }); }}
                        onClick={() => setSelectedPackId(pack.id)}
                        style={{ width: 38, height: 38, borderRadius: 10, border: `2px solid ${selectedPackId === pack.id ? accent : 'transparent'}`, background: selectedPackId === pack.id ? (dm ? 'rgba(99,102,241,0.2)' : '#ede9fe') : 'none', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.12s' }}
                    >
                        {pack.emoji}
                    </button>
                ))}
                {/* Add pack button */}
                <button
                    title={t('Create pack')}
                    onClick={() => setCreatePackOpen(true)}
                    style={{ width: 38, height: 38, borderRadius: 10, border: `2px dashed ${dm ? '#3a3a5a' : '#c4b5fd'}`, background: 'none', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: subtext, transition: 'all 0.12s', marginTop: 4 }}
                >
                    +
                </button>
            </div>

            {/* Sticker content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Recent stickers page */}
                {selectedPackId === RECENT_PACK_ID && !createPackOpen && !editPackId ? (
                    recentStickers.length === 0 ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: subtext }}>
                            <div style={{ fontSize: 40 }}>🕐</div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: text }}>{t('No recent stickers')}</div>
                            <div style={{ fontSize: 12, textAlign: 'center', padding: '0 20px' }}>{t('Send a sticker, it will appear here')}</div>
                        </div>
                    ) : (
                        <>
                            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                <span style={{ fontSize: 16 }}>🕐</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: text }}>{t('Recent')}</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', padding: 8, gap: 6, overflowY: 'auto', flex: 1 }}>
                                {recentStickers.map((url, i) => (
                                    <StickerThumb
                                        key={i}
                                        sticker={{ id: String(i), url }}
                                        dm={dm}
                                        thumbBg={inputBg2}
                                        onSend={() => {
                                            onSendSticker(url);
                                            addRecentSticker(url);
                                            setRecentStickers(loadRecentStickers());
                                            close();
                                        }}
                                        onDelete={() => {
                                            const next = recentStickers.filter(u => u !== url);
                                            localStorage.setItem(LS_RECENT_STICKERS, JSON.stringify(next));
                                            setRecentStickers(next);
                                        }}
                                    />
                                ))}
                            </div>
                        </>
                    )
                ) : createPackOpen ? (
                    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: text }}>{t('New pack')}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input
                                value={newPackEmoji}
                                onChange={e => setNewPackEmoji(e.target.value)}
                                style={{ width: 44, height: 38, textAlign: 'center', fontSize: 22, border: `1.5px solid ${border}`, borderRadius: 10, backgroundColor: inputBg2, color: text, fontFamily: 'inherit', outline: 'none' }}
                                maxLength={2}
                                placeholder="🎭"
                            />
                            <input
                                autoFocus
                                value={newPackName}
                                onChange={e => setNewPackName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') createPack(); if (e.key === 'Escape') setCreatePackOpen(false); }}
                                placeholder={t('Pack name')}
                                style={{ flex: 1, padding: '8px 12px', border: `1.5px solid ${border}`, borderRadius: 10, backgroundColor: inputBg2, color: text, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={createPack} style={{ flex: 1, padding: '8px 0', background: `linear-gradient(135deg, ${accent}, #8b5cf6)`, color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>{t('Create pack')}</button>
                            <button onClick={() => setCreatePackOpen(false)} style={{ padding: '8px 14px', background: 'none', border: `1.5px solid ${border}`, borderRadius: 10, cursor: 'pointer', fontSize: 13, color: subtext, fontFamily: 'inherit' }}>{t('Cancel')}</button>
                        </div>
                    </div>
                ) : editPackId ? (
                    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: text }}>{t('Rename pack')}</div>
                        <input
                            autoFocus
                            value={editPackName}
                            onChange={e => setEditPackName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') renamePackSave(); if (e.key === 'Escape') setEditPackId(null); }}
                            style={{ padding: '8px 12px', border: `1.5px solid ${border}`, borderRadius: 10, backgroundColor: inputBg2, color: text, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={renamePackSave} style={{ flex: 1, padding: '8px 0', background: `linear-gradient(135deg, ${accent}, #8b5cf6)`, color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>{t('Save')}</button>
                            <button onClick={() => setEditPackId(null)} style={{ padding: '8px 14px', background: 'none', border: `1.5px solid ${border}`, borderRadius: 10, cursor: 'pointer', fontSize: 13, color: subtext, fontFamily: 'inherit' }}>{t('Cancel')}</button>
                        </div>
                    </div>
                ) : !selectedPack ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: subtext }}>
                        <div style={{ fontSize: 48 }}>🎭</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: text }}>{t('No packs')}</div>
                        <div style={{ fontSize: 12, textAlign: 'center', padding: '0 20px' }}>{t('Press + to create a sticker pack')}</div>
                        <button onClick={() => setCreatePackOpen(true)} style={{ padding: '8px 20px', background: `linear-gradient(135deg, ${accent}, #8b5cf6)`, color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>{t('Create pack')}</button>
                    </div>
                ) : (
                    <>
                        {/* Pack header */}
                        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            <span style={{ fontSize: 20 }}>{selectedPack!.emoji}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedPack!.name}</span>
                            <button onClick={() => stickerFileRef.current?.click()} disabled={uploadingSticker} title={t('Add sticker')}
                                style={{ padding: '4px 10px', background: `linear-gradient(135deg, ${accent}, #8b5cf6)`, color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, flexShrink: 0, opacity: uploadingSticker ? 0.6 : 1, fontFamily: 'inherit' }}>
                                {uploadingSticker ? '...' : t('+ photo')}
                            </button>
                            <input ref={stickerFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) addStickerFile(f); e.target.value = ''; }} />
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', padding: 8, gap: 6, overflowY: 'auto', flex: 1 }}>
                            {selectedPack!.stickers.length === 0 ? (
                                <div style={{ width: '100%', textAlign: 'center', padding: '40px 0', color: subtext, fontSize: 13 }}>{t('Add first sticker →')}</div>
                            ) : selectedPack!.stickers.map(sticker => (
                                <StickerThumb key={sticker.id} sticker={sticker} dm={dm} thumbBg={inputBg2}
                                    onSend={() => { onSendSticker(sticker.url); addRecentSticker(sticker.url); setRecentStickers(loadRecentStickers()); close(); }}
                                    onDelete={() => deleteSticker(selectedPack!.id, sticker.id)} />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );

    // ─── GIF tab ───────────────────────────────────────────────────────────────
    const renderGifTab = () => (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {/* Search + subtabs */}
            <div style={{ padding: '8px 10px', borderBottom: `1px solid ${border}`, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                    value={gifQuery}
                    onChange={e => { setGifQuery(e.target.value); setGifSubTab('trending'); }}
                    placeholder={t('Search GIF...')}
                    style={{ width: '100%', padding: '7px 12px', border: `1.5px solid ${border}`, borderRadius: 10, backgroundColor: inputBg2, color: text, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                    {(['trending', 'saved'] as const).map(tab => (
                        <button key={tab} onClick={() => setGifSubTab(tab)} style={{ flex: 1, padding: '5px 0', background: gifSubTab === tab ? (dm ? 'rgba(99,102,241,0.2)' : '#ede9fe') : 'none', border: `1.5px solid ${gifSubTab === tab ? accent : border}`, borderRadius: 8, color: gifSubTab === tab ? accent : subtext, fontSize: 12, fontWeight: gifSubTab === tab ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                            {tab === 'trending' ? t('🔥 Trending') : t('🔖 Saved')}
                        </button>
                    ))}
                </div>
            </div>

            {/* GIF grid */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                {gifSubTab === 'saved' ? (
                    savedGifs.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: subtext, fontSize: 13 }}>
                            <div style={{ fontSize: 40, marginBottom: 10 }}>🔖</div>
                            {t('No saved GIFs')}
                        </div>
                    ) : (
                        <GifGrid
                            gifs={savedGifs.map(g => ({ id: g.id, previewUrl: g.previewUrl, url: g.url }))}
                            dm={dm}
                            gifBg={isOled ? '#050508' : (dm ? '#12122a' : '#f0f0f8')}
                            isSaved={id => isGifSaved(id)}
                            onSend={url => { onSendGif(url); close(); }}
                            onToggleSave={(gif) => removeSavedGif(gif.id)}
                        />
                    )
                ) : gifLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: subtext, fontSize: 13 }}>{t('Loading...')}</div>
                ) : gifs.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: subtext, fontSize: 13 }}>
                        <div style={{ fontSize: 40, marginBottom: 10 }}>🎞️</div>
                        {gifQuery ? t('No results') : t('Search GIF...')}
                    </div>
                ) : (
                    <GifGrid
                        gifs={gifs.map((g: any) => ({
                            id: g.id,
                            previewUrl: g.images?.fixed_height_small?.url || g.images?.fixed_height?.url || '',
                            url: g.images?.original?.url || g.images?.fixed_height?.url || '',
                        }))}
                        dm={dm}
                        gifBg={isOled ? '#050508' : (dm ? '#12122a' : '#f0f0f8')}
                        isSaved={id => isGifSaved(id)}
                        onSend={url => { onSendGif(url); close(); }}
                        onToggleSave={gif => toggleSavedGif(gif)}
                    />
                )}
            </div>

            {/* Giphy attribution */}
            {gifSubTab === 'trending' && (
                <div style={{ padding: '4px 8px', textAlign: 'right', fontSize: 10, color: subtext, borderTop: `1px solid ${border}`, flexShrink: 0 }}>
                    Powered by GIPHY
                </div>
            )}
        </div>
    );

    // ─── Pack context menu ─────────────────────────────────────────────────────
    const renderPackCtxMenu = () => {
        if (!packCtxMenu) return null;
        const pack = packs.find(p => p.id === packCtxMenu.id);
        if (!pack) return null;
        return (
            <div
                style={{ position: 'fixed', top: packCtxMenu.y, left: packCtxMenu.x, zIndex: 9999, backgroundColor: isOled ? '#000000' : (dm ? '#1a1a2e' : 'white'), border: `1px solid ${border}`, borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.25)', padding: '4px 0', minWidth: 160 }}
                onClick={e => e.stopPropagation()}
            >
                <button onClick={() => { setEditPackId(pack.id); setEditPackName(pack.name); setSelectedPackId(pack.id); setPackCtxMenu(null); }} style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: text, fontFamily: 'inherit' }}>✏️ {t('Rename')}</button>
                <button onClick={() => deletePack(pack.id)} style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#ef4444', fontFamily: 'inherit' }}>🗑️ {t('Delete')}</button>
            </div>
        );
    };

    return (
        <>
            <div ref={ref} style={panelStyle} className={closing ? 'floating-exit' : 'floating-enter'} onClick={e => e.stopPropagation()}>
                {/* Tab bar */}
                <div style={tabBarStyle}>
                    <button style={tabBtnStyle(tab === 0)} onClick={() => setTab(0)}>😀 {t('Emoji')}</button>
                    <button style={tabBtnStyle(tab === 1)} onClick={() => setTab(1)}>🎭 {t('Stickers')}</button>
                    <button style={tabBtnStyle(tab === 2)} onClick={() => setTab(2)}>GIF</button>
                </div>

                {/* Content */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {tab === 0 && renderEmojiTab()}
                    {tab === 1 && renderStickersTab()}
                    {tab === 2 && renderGifTab()}
                </div>
            </div>

            {/* Pack context menu (portaled outside picker) */}
            {renderPackCtxMenu()}
        </>
    );
};

// ─── StickerThumb ─────────────────────────────────────────────────────────────
const StickerThumb: React.FC<{
    sticker: StickerItem;
    dm: boolean;
    thumbBg: string;
    onSend: () => void;
    onDelete: () => void;
}> = ({ sticker, dm, thumbBg, onSend, onDelete }) => {
    const [hovered, setHovered] = useState(false);
    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ position: 'relative', width: 80, height: 80, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${hovered ? '#6366f1' : 'transparent'}`, transition: 'border-color 0.1s', backgroundColor: thumbBg }}
        >
            <img
                src={sticker.url}
                alt="sticker"
                onClick={onSend}
                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4, boxSizing: 'border-box' }}
                onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
            />
            {hovered && (
                <button
                    onClick={e => { e.stopPropagation(); onDelete(); }}
                    style={{ position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: '50%', background: 'rgba(239,68,68,0.85)', border: 'none', color: 'white', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0 }}
                >
                    ✕
                </button>
            )}
        </div>
    );
};

// ─── GifGrid ──────────────────────────────────────────────────────────────────
interface GifEntry { id: string; url: string; previewUrl: string; }
const GifGrid: React.FC<{
    gifs: GifEntry[];
    dm: boolean;
    gifBg: string;
    isSaved: (id: string) => boolean;
    onSend: (url: string) => void;
    onToggleSave: (gif: GifEntry) => void;
}> = ({ gifs, dm, gifBg, isSaved, onSend, onToggleSave }) => {
    // 3-column masonry layout
    const cols: GifEntry[][] = [[], [], []];
    gifs.forEach((g, i) => cols[i % 3].push(g));

    return (
        <div style={{ display: 'flex', gap: 4 }}>
            {cols.map((col, ci) => (
                <div key={ci} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {col.map(gif => (
                        <GifThumb key={gif.id} gif={gif} dm={dm} gifBg={gifBg} saved={isSaved(gif.id)} onSend={onSend} onToggleSave={onToggleSave} />
                    ))}
                </div>
            ))}
        </div>
    );
};

const GifThumb: React.FC<{
    gif: GifEntry;
    dm: boolean;
    gifBg: string;
    saved: boolean;
    onSend: (url: string) => void;
    onToggleSave: (gif: GifEntry) => void;
}> = ({ gif, dm, gifBg, saved, onSend, onToggleSave }) => {
    const { t } = useLang();
    const [hovered, setHovered] = useState(false);
    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', backgroundColor: gifBg }}
            onClick={() => onSend(gif.url)}
        >
            <img
                src={gif.previewUrl}
                alt="gif"
                style={{ width: '100%', display: 'block', borderRadius: 8 }}
                loading="lazy"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {hovered && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 4 }}>
                    <button
                        onClick={e => { e.stopPropagation(); onToggleSave(gif); }}
                        title={saved ? t('Remove saved GIF') : t('Save GIF')}
                        style={{ background: saved ? '#6366f1' : 'rgba(0,0,0,0.6)', border: saved ? 'none' : '1px solid rgba(255,255,255,0.5)', borderRadius: 6, color: 'white', fontSize: 14, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}
                    >
                        {saved ? '🔖' : '＋'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default MediaPicker;
