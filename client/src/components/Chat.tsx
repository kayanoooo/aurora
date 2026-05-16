import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo, lazy, Suspense } from 'react';
import { api } from '../services/api';
import { wsService, WsConnectionState } from '../services/websocket';
import { DevBadge, TesterBadge, TESTER_TAGS, DEV_TAGS } from './UserBadges';
import { User, Message, Group, GroupMessage, ChatItem, ThemeSettings, AccountEntry } from '../types';
import FileMessage, { ImageGrid, MediaGrid } from './FileMessage';
import CreateGroupModal from './CreateGroupModal';
import CreateChannelModal from './CreateChannelModal';
import InviteToGroupModal from './InviteToGroupModal';
import MediaPicker, { EMOJI_CATEGORIES } from './MediaPicker';
import PollCreator from './PollCreator';
import PollMessage from './PollMessage';
import { useLang } from '../i18n';
import { config } from '../config';
import { getOrCreateKeyPair, getOwnPublicKey, decryptMessage, isEncryptedMessage, cachePublicKey, getCachedPublicKey } from '../services/cryptoService';
import MediaPlayer, { MiniPlayer, Track, MediaStateChange, Playlist, PlaylistBubble, PlaylistShareData, parsePlaylistMsg, PLAYLIST_MSG_PREFIX } from './MediaPlayer';
import { useCall } from '../hooks/useCall';
import CallOverlay from './CallOverlay';

// Lazily loaded heavy modals — not needed until user opens them
const GroupInfo      = lazy(() => import('./GroupInfo'));
const SettingsModal  = lazy(() => import('./SettingsModal'));
const SearchModal    = lazy(() => import('./SearchModal'));
const UserProfileModal = lazy(() => import('./UserProfileModal'));
const FolderManager  = lazy(() => import('./FolderManager'));
const HelpModal      = lazy(() => import('./HelpModal'));
const SupportChat    = lazy(() => import('./SupportChat'));
const AdminPanel     = lazy(() => import('./AdminPanel'));
const ChatMediaPanel = lazy(() => import('./ChatMediaPanel'));
const LocationPicker = lazy(() => import('./LocationPicker'));
const ContactPicker  = lazy(() => import('./ContactPicker'));

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

interface ChatProps {
    token: string;
    currentUserId: number;
    currentUsername: string;
    currentUserAvatar?: string;
    currentUserStatus?: string;
    currentUserTag?: string;
    theme: ThemeSettings;
    onThemeChange: (theme: ThemeSettings) => void;
    onProfileUpdate: (username: string, avatar?: string, status?: string, tag?: string) => void;
    onLogout: () => void;
    onShowOnboarding?: () => void;
    accounts?: AccountEntry[];
    onSwitchAccount?: (acc: AccountEntry) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function renderTextWithLinks(text: string | null | undefined, onMentionClick?: (username: string) => void, mentionColor = '#6366f1'): React.ReactNode {
    if (!text) return null;
    const re = /(@\w+)|https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
        const chunk = m[0];
        if (chunk.startsWith('@') && onMentionClick) {
            const uname = chunk.slice(1);
            parts.push(<span key={m.index} style={{ color: mentionColor, fontWeight: 600, cursor: 'pointer', background: mentionColor === '#6366f1' ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.12)', borderRadius: 4, padding: '0 2px' }} onClick={e => { e.stopPropagation(); onMentionClick(uname); }}>@{uname}</span>);
        } else if (!chunk.startsWith('@')) {
            parts.push(<a key={m.index} href={chunk} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', wordBreak: 'break-all' }} onClick={e => e.stopPropagation()}>{chunk}</a>);
        } else {
            parts.push(chunk);
        }
        lastIndex = m.index + chunk.length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts.length > 0 ? <>{parts}</> : text;
}

// Highlight search query occurrences in plain text
function highlightSearchText(text: string, query: string, isActive: boolean): React.ReactNode {
    if (!query.trim()) return text;
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(re);
    if (parts.length <= 1) return text;
    return (
        <React.Fragment>
            {parts.map((p, i) =>
                re.test(p)
                    ? <mark key={i} style={{ background: isActive ? '#f59e0b' : 'rgba(251,191,36,0.45)', color: isActive ? '#000' : 'inherit', borderRadius: 2, padding: '0 1px' }}>{p}</mark>
                    : p
            )}
        </React.Fragment>
    );
}

// Inline markdown tokens: process text left-to-right, emit React nodes
function renderMarkdown(
    text: string | null | undefined,
    onMentionClick?: (username: string) => void,
    mentionColor = '#6366f1',
    isDark = false
): React.ReactNode {
    if (!text) return null;

    const nodes: React.ReactNode[] = [];
    let key = 0;

    // Code block (triple backtick)
    const codeBlockRe = /```([\s\S]*?)```/g;
    let last = 0;
    let cb: RegExpExecArray | null;
    while ((cb = codeBlockRe.exec(text)) !== null) {
        if (cb.index > last) nodes.push(...tokenize(text.slice(last, cb.index), key++, onMentionClick, mentionColor, isDark));
        nodes.push(
            <pre key={`cb${cb.index}`} style={{ background: isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.06)', borderRadius: 8, padding: '8px 12px', margin: '4px 0', fontSize: 12, fontFamily: '"Fira Code","Courier New",monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowX: 'auto', display: 'block' }}>
                <code>{cb[1].trimEnd()}</code>
            </pre>
        );
        last = cb.index + cb[0].length;
    }
    if (last < text.length) nodes.push(...tokenize(text.slice(last), key++, onMentionClick, mentionColor, isDark));

    return nodes.length === 0 ? null : nodes.length === 1 ? nodes[0] : <React.Fragment>{nodes}</React.Fragment>;
}

function tokenize(
    text: string,
    baseKey: number,
    onMentionClick?: (username: string) => void,
    mentionColor = '#6366f1',
    isDark = false
): React.ReactNode[] {
    if (!text) return [];
    // Regex: inline code > bold > italic > strikethrough > spoiler > url/mention
    const re = /(`[^`]+`)|(\*\*|__)([\s\S]+?)\2|([*_])([\s\S]+?)\4|(~~)([\s\S]+?)~~|(\|\|)([\s\S]+?)\|\||(@\w+)|https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const nodes: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) nodes.push(text.slice(last, m.index));
        const k = `${baseKey}_${m.index}`;
        if (m[1]) {
            // Inline code
            nodes.push(<code key={k} style={{ background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', borderRadius: 4, padding: '1px 5px', fontFamily: '"Fira Code","Courier New",monospace', fontSize: '0.88em' }}>{m[1].slice(1, -1)}</code>);
        } else if (m[2]) {
            // Bold
            nodes.push(<strong key={k}>{tokenize(m[3], baseKey + 1000, onMentionClick, mentionColor, isDark)}</strong>);
        } else if (m[4]) {
            // Italic
            nodes.push(<em key={k}>{tokenize(m[5], baseKey + 2000, onMentionClick, mentionColor, isDark)}</em>);
        } else if (m[6]) {
            // Strikethrough
            nodes.push(<s key={k}>{tokenize(m[7], baseKey + 3000, onMentionClick, mentionColor, isDark)}</s>);
        } else if (m[8]) {
            // Spoiler
            nodes.push(<SpoilerSpan key={k} isDark={isDark}>{m[9]}</SpoilerSpan>);
        } else if (m[10]?.startsWith('@') && onMentionClick) {
            const uname = m[10].slice(1);
            nodes.push(<span key={k} style={{ color: mentionColor, fontWeight: 600, cursor: 'pointer', background: mentionColor === '#6366f1' ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.12)', borderRadius: 4, padding: '0 2px' }} onClick={e => { e.stopPropagation(); onMentionClick(uname); }}>@{uname}</span>);
        } else {
            const chunk = m[0];
            if (chunk.startsWith('http')) {
                nodes.push(<a key={k} href={chunk} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', wordBreak: 'break-all' }} onClick={e => e.stopPropagation()}>{chunk}</a>);
            } else {
                nodes.push(chunk);
            }
        }
        last = m.index + m[0].length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
}

const SpoilerSpan: React.FC<{ children: React.ReactNode; isDark: boolean }> = ({ children, isDark }) => {
    const [revealed, setRevealed] = React.useState(false);
    return (
        <span
            onClick={e => { e.stopPropagation(); setRevealed(r => !r); }}
            style={{ filter: revealed ? 'none' : 'blur(5px)', cursor: 'pointer', userSelect: revealed ? 'text' : 'none', transition: 'filter 0.2s', background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', borderRadius: 3, padding: '0 2px' }}
        >{children}</span>
    );
};


const Chat: React.FC<ChatProps> = ({ token, currentUserId, currentUsername, currentUserAvatar, currentUserStatus, currentUserTag, theme, onThemeChange, onProfileUpdate, onLogout, onShowOnboarding, accounts, onSwitchAccount }) => {
    const { t, lang } = useLang();
    const { callInfo, startCall, acceptCall, rejectCall, endCall, toggleMute: callToggleMute, toggleCamera: callToggleCamera } = useCall();
    const callConnectedAtRef = useRef<number | null>(null);
    const callPeerIdRef = useRef<number | null>(null);
    const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);
    useEffect(() => { api.getServerInfo().then(r => { if (r) setServerInfo(r); }); }, []);

    // Global keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

            // Ctrl+F / Cmd+F — in-chat search
            if ((e.ctrlKey || e.metaKey) && e.key === 'f' && activeChatRef.current) {
                e.preventDefault();
                setChatSearchOpen(true);
                setTimeout(() => chatSearchInputRef.current?.focus(), 50);
                return;
            }
            // Ctrl+Shift+F — global message search
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                setGlobalMsgSearch(true);
                return;
            }
            // Ctrl+K / Cmd+K — focus sidebar search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                const sidebarInput = document.querySelector<HTMLInputElement>('.sidebar-search-input');
                sidebarInput?.focus();
                return;
            }
            // Esc — close modals / cancel editing / deselect
            if (e.key === 'Escape' && !inInput) {
                setMenuMessageId(null);
                setShowAttachMenu(false);
                setShowEmojiPicker(false);
                return;
            }
            // Ctrl+Enter — send message (alternative to Enter)
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && activeChatRef.current && inputRef.current === document.activeElement) {
                e.preventDefault();
                // sendMessage is called via the normal keydown handler on the textarea
                return;
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    // Track call connect time and send call-ended bubble
    useEffect(() => {
        if (callInfo.state === 'connected') {
            callConnectedAtRef.current = Date.now();
            callPeerIdRef.current = callInfo.peerId;
        } else if (callInfo.state === 'idle' && callConnectedAtRef.current !== null) {
            const dur = Math.round((Date.now() - callConnectedAtRef.current) / 1000);
            const peerId = callPeerIdRef.current;
            callConnectedAtRef.current = null;
            callPeerIdRef.current = null;
            if (peerId) {
                wsService.sendMessage(peerId, `__call_ended__${dur}`);
            }
        } else if (callInfo.state === 'idle') {
            callConnectedAtRef.current = null;
            callPeerIdRef.current = null;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [callInfo.state]);

    const [users, setUsers] = useState<User[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [activeChat, setActiveChat] = useState<ChatItem | null>(null);
    const [messages, setMessages] = useState<(Message | GroupMessage)[]>([]);
    const [hasMoreMessages, setHasMoreMessages] = useState(false);
    const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
    const [chatLoading, setChatLoading] = useState(false);
    const chatLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const messagesRef = useRef<(Message | GroupMessage)[]>([]);
    const [chatKey, setChatKey] = useState(0);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // IntersectionObserver: send read_group for visible non-own group messages
    useEffect(() => {
        if (!activeChat || activeChat.type !== 'group') return;
        const groupId = activeChat.id;
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const el = entry.target as HTMLElement;
                const msgId = parseInt(el.dataset.groupMsgId || '0', 10);
                if (!msgId || sentGroupReadRef.current.has(msgId)) continue;
                sentGroupReadRef.current.add(msgId);
                wsService.send({ type: 'read_group', group_id: groupId, message_id: msgId });
                observer.unobserve(el);
            }
        }, { threshold: 0.5 });
        // Observe all non-own group message elements
        const els = document.querySelectorAll('[data-group-msg-id]');
        els.forEach(el => observer.observe(el));
        return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, activeChat]);
    // Client-side auto-delete for disappearing messages
    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];
        messages.forEach(msg => {
            const da = (msg as any).disappear_after;
            if (!da) return;
            const elapsed = (Date.now() - new Date((msg as any).timestamp).getTime()) / 1000;
            const remaining = da - elapsed;
            if (remaining <= 0) {
                setMessages(prev => prev.filter(m => m.id !== msg.id));
            } else {
                timers.push(setTimeout(() => {
                    setMessages(prev => prev.filter(m => m.id !== msg.id));
                }, remaining * 1000));
            }
        });
        return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.map(m => m.id).join(',')]);

    const [typing, setTyping] = useState(false);
    const [typingUser, setTypingUser] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadingFileName, setUploadingFileName] = useState('');
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [showCreateChannel, setShowCreateChannel] = useState(false);
    const [showCreateDropdown, setShowCreateDropdown] = useState(false);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [showGroupInfo, setShowGroupInfo] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [showSupportChat, setShowSupportChat] = useState(false);
    const [showAdminPanel, setShowAdminPanel] = useState(false);
    const [showMediaPlayer, setShowMediaPlayer] = useState(false);
    const [miniTrack, setMiniTrack] = useState<Track | null>(null);
    const [miniIsPlaying, setMiniIsPlaying] = useState(false);
    const [miniVolume, setMiniVolume] = useState(0.8);
    const miniControlsRef = useRef<Omit<MediaStateChange, 'track' | 'isPlaying' | 'volume' | 'progress' | 'duration'> | null>(null);
    const miniWasPausedByAudio = useRef(false);
    const [miniProgress, setMiniProgress] = useState(0);
    const [miniDuration, setMiniDuration] = useState(0);
    const handleMediaStateChange = useCallback((s: MediaStateChange) => {
        setMiniTrack(s.track);
        setMiniIsPlaying(s.isPlaying);
        setMiniVolume(s.volume);
        setMiniProgress(s.progress);
        setMiniDuration(s.duration);
        miniControlsRef.current = { toggle: s.toggle, prev: s.prev, next: s.next, setVol: s.setVol };
        // Update current user's now_playing in local users state immediately (server doesn't echo back)
        setUsers(prev => prev.map(u =>
            u.id === currentUserId
                ? { ...u, now_playing: (s.track && s.isPlaying) ? (s.track.artist ? `${s.track.title} — ${s.track.artist}` : s.track.title) : null }
                : u
        ));
    }, [currentUserId]);
    const [playlistToShare, setPlaylistToShare] = useState<Playlist | null>(null);
    const [playlistShareSearch, setPlaylistShareSearch] = useState('');
    const [playlistPreview, setPlaylistPreview] = useState<PlaylistShareData | null>(null);
    const [playlistSaving, setPlaylistSaving] = useState(false);
    // Disappearing messages
    const [disappearSettings, setDisappearSettings] = useState<Record<string, number | null>>({});
    const [showDisappearDropdown, setShowDisappearDropdown] = useState(false);

    // Scheduled messages
    const [scheduledMessages, setScheduledMessages] = useState<any[]>([]);
    const [showSchedulePicker, setShowSchedulePicker] = useState(false);

    // Clear legacy wallpaper data
    React.useEffect(() => { localStorage.removeItem('aurora_chat_wallpapers'); }, []);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_groupSlowModes, setGroupSlowModes] = useState<Record<number, number>>({});
    const [slowModeCooldowns, setSlowModeCooldowns] = useState<Record<number, number>>({}); // groupId → remaining seconds
    const slowModeTimers = useRef<Record<number, ReturnType<typeof setInterval>>>({});
    const [scheduleDateTime, setScheduleDateTime] = useState('');
    const [sendWhenOnline, setSendWhenOnline] = useState(false);
    const [decryptedTexts, setDecryptedTexts] = useState<Record<number, string>>({});
    const [pollTitles, setPollTitles] = useState<Record<number, string>>({});
    const [newSupportReply, setNewSupportReply] = useState<{ msg_id: number; message_text: string; admin_id: number } | null>(null);
    const [newSupportMsg, setNewSupportMsg] = useState<{ user_id: number; message_text: string; msg_id: number; file_path?: string; filename?: string } | null>(null);
    const [favoritesLastMsg, setFavoritesLastMsg] = useState<{ text?: string | null; time?: string | null; file?: string | null; filename?: string | null } | null>(null);
    const showSupportChatRef = useRef(false);
    const showAdminPanelRef = useRef(false);
    useEffect(() => { showSupportChatRef.current = showSupportChat; }, [showSupportChat]);
    useEffect(() => { showAdminPanelRef.current = showAdminPanel; }, [showAdminPanel]);
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
    const [menuMessageId, setMenuMessageId] = useState<number | null>(null);
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
    const [menuClampedPos, setMenuClampedPos] = useState({ x: 0, y: 0 });
    const [replyTo, setReplyTo] = useState<any>(null);
    const [selectedUserForProfile, setSelectedUserForProfile] = useState<User | null>(null);
    const [profileFromGroupInfo, setProfileFromGroupInfo] = useState(false);
    const [favoritesMessages, setFavoritesMessages] = useState<any[]>([]);
    const [showPollCreator, setShowPollCreator] = useState(false);
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const attachBtnRef = useRef<HTMLButtonElement>(null);
    const [attachMenuPos, setAttachMenuPos] = useState({ x: 0, bottom: 0 });
    const [showLocationPicker, setShowLocationPicker] = useState(false);
    const [showContactPicker, setShowContactPicker] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const [typingChats, setTypingChats] = useState<Record<string, string>>({});
    const typingChatsTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const [recentUsers, setRecentUsers] = useState<User[]>([]);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMsgIds, setSelectedMsgIds] = useState<Set<number>>(new Set());
    const [forwardingMessages, setForwardingMessages] = useState<any[] | null>(null);
    const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
    const [reportTarget, setReportTarget] = useState<{ type: 'user' | 'group' | 'message'; id: number; name: string } | null>(null);
    const [reportReason, setReportReason] = useState('');
    const [reportComment, setReportComment] = useState('');
    const [reportSent, setReportSent] = useState(false);
    const [reportLoading, setReportLoading] = useState(false);
    const [previewGroup, setPreviewGroup] = useState<Group | null>(null); // channel being viewed but not yet joined

    // Channel comments panel
    const [commentPostId, setCommentPostId] = useState<number | null>(null);
    const [commentText, setCommentText] = useState('');
    const [commentReplyTo, setCommentReplyTo] = useState<any>(null);
    const [hoveredCommentId, setHoveredCommentId] = useState<number | null>(null);
    const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
    const [editingCommentText, setEditingCommentText] = useState('');
    const [commentPendingFile, setCommentPendingFile] = useState<File | null>(null);
    const [commentUploading, setCommentUploading] = useState(false);
    const [commentShowEmoji, setCommentShowEmoji] = useState(false);
    const commentFileInputRef = useRef<HTMLInputElement>(null);
    const commentInputRef = useRef<HTMLTextAreaElement>(null);

    interface ToastItem {
        id: number;
        title: string;
        body: string;
        chatType: 'private' | 'group';
        chatId: number;
        senderId?: number;
        groupId?: number;
        avatarLetter: string;
        avatarColor: string;
        avatarSrc?: string;
        exiting?: boolean;
    }
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const [toastReplies, setToastReplies] = useState<Record<number, string>>({});
    const toastIdRef = useRef(0);
    // Ref so WebSocket handler always calls the latest showInAppToast (avoids stale closure)
    const showInAppToastRef = useRef<((t: Omit<ToastItem, 'id' | 'exiting'>) => void) | null>(null);

    // Sidebar search
    const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
    const [sidebarSearchFocused, setSidebarSearchFocused] = useState(false);
    const [sidebarSearchResults, setSidebarSearchResults] = useState<User[]>([]);
    const [sidebarMsgResults, setSidebarMsgResults] = useState<any[]>([]);
    const [sidebarChannelResults, setSidebarChannelResults] = useState<any[]>([]);
    const [sidebarSearchLoading, setSidebarSearchLoading] = useState(false);
    const sidebarSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const sidebarLocalMatches = React.useMemo(() => {
        const q = sidebarSearchQuery.trim().toLowerCase();
        if (!q) return { users: [] as User[], groups: [] as Group[] };
        return {
            users: users.filter(u => u.username.toLowerCase().includes(q) || u.tag?.toLowerCase().includes(q)),
            groups: groups.filter(g => g.name.toLowerCase().includes(q)),
        };
    }, [sidebarSearchQuery, users, groups]);
    const [searchHistory, setSearchHistory] = useState<User[]>(() => {
        try { return JSON.parse(localStorage.getItem('userSearchHistory') || '[]'); } catch { return []; }
    });

    const addToSearchHistory = (u: User) => {
        setSearchHistory(prev => {
            const next = [u, ...prev.filter(x => x.id !== u.id)].slice(0, 5);
            localStorage.setItem('userSearchHistory', JSON.stringify(next));
            return next;
        });
    };

    // Inline message edit
    const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
    const [editingText, setEditingText] = useState('');

    // Media picker (Emoji / Stickers / GIF)
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    // Clear chat confirmation
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    // Sidebar state: full | compact | hidden
    type SidebarState = 'full' | 'compact' | 'minimal' | 'hidden';
    const [sidebarState, setSidebarState] = useState<SidebarState>('full');
    const sidebarHidden = sidebarState === 'hidden'; // compat
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _cycleSidebar = () => setSidebarState(s => s === 'full' ? 'compact' : s === 'compact' ? 'minimal' : s === 'minimal' ? 'hidden' : 'full');
    const sidebarCompact = sidebarState === 'compact';
    const sidebarMinimal = sidebarState === 'minimal';
    const [wsConnState, setWsConnState] = useState<WsConnectionState>('connecting');
    const [globalMsgSearch, setGlobalMsgSearch] = useState(false);
    const [globalMsgQuery, setGlobalMsgQuery] = useState('');
    const [globalMsgResults, setGlobalMsgResults] = useState<any[]>([]);
    const [globalMsgLoading, setGlobalMsgLoading] = useState(false);
    useEffect(() => wsService.onConnectionState(setWsConnState), []);

    const runGlobalMsgSearch = React.useCallback(async (q: string) => {
        if (!q.trim() || q.trim().length < 2) { setGlobalMsgResults([]); return; }
        setGlobalMsgLoading(true);
        try {
            const res = await fetch(`${config.API_URL}/search/global?token=${token}&query=${encodeURIComponent(q)}&limit=30`);
            const data = await res.json();
            setGlobalMsgResults(data.results || []);
        } catch {} finally { setGlobalMsgLoading(false); }
    }, [token]);

    useEffect(() => {
        if (!globalMsgQuery.trim()) { setGlobalMsgResults([]); return; }
        const tid = setTimeout(() => runGlobalMsgSearch(globalMsgQuery), 400);
        return () => clearTimeout(tid);
    }, [globalMsgQuery, runGlobalMsgSearch]);
    const [sidebarWidth, setSidebarWidth] = useState(340);
    const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
    const sidebarIsDragging = useRef(false);

    // Chat folders
    interface ChatFolder { id: number; name: string; color: string; chats: {chat_type: string; chat_id: number}[]; }
    const [folders, setFolders] = useState<ChatFolder[]>([]);
    const [activeFolder, setActiveFolder] = useState<number | null>(null); // null = all chats
    const [showFolderManager, setShowFolderManager] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _folderTabsRef = useRef<HTMLDivElement>(null);

    // Per-user localStorage key helper
    const lsKey = (name: string) => `aurora_${name}_${currentUserId}`;

    // Pinned chats
    const [pinnedChats, setPinnedChats] = useState<Set<string>>(() => {
        try { return new Set(JSON.parse(localStorage.getItem(`aurora_pinned_${currentUserId}`) || '[]')); }
        catch { return new Set(); }
    });
    const [pinMenu, setPinMenu] = useState<{ x: number; y: number; key: string } | null>(null);
    const togglePin = (key: string) => {
        setPinnedChats(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            localStorage.setItem(lsKey('pinned'), JSON.stringify(Array.from(next)));
            return next;
        });
        setPinMenu(null);
    };

    // Muted chats
    const [mutedChats, setMutedChats] = useState<Set<string>>(() => {
        try { return new Set(JSON.parse(localStorage.getItem(`aurora_muted_${currentUserId}`) || '[]')); }
        catch { return new Set(); }
    });
    const mutedChatsRef = useRef<Set<string>>(new Set());
    useEffect(() => { mutedChatsRef.current = mutedChats; }, [mutedChats]);
    const toggleMute = (key: string) => {
        setMutedChats(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            localStorage.setItem(lsKey('muted'), JSON.stringify(Array.from(next)));
            return next;
        });
        setPinMenu(null);
    };

    // Archived chats
    const [archivedChats, setArchivedChats] = useState<Set<string>>(() => {
        try { return new Set(JSON.parse(localStorage.getItem(`aurora_archived_${currentUserId}`) || '[]')); }
        catch { return new Set(); }
    });
    const archivedChatsRef = useRef<Set<string>>(new Set());
    useEffect(() => { archivedChatsRef.current = archivedChats; }, [archivedChats]);

    // Hidden/deleted chats (persisted so they don't reappear on reload)
    const [hiddenChats, setHiddenChats] = useState<Set<string>>(() => {
        try { return new Set(JSON.parse(localStorage.getItem(`aurora_hidden_${currentUserId}`) || '[]')); }
        catch { return new Set(); }
    });
    const hideChat = (key: string) => {
        setHiddenChats(prev => {
            const next = new Set(prev);
            next.add(key);
            localStorage.setItem(lsKey('hidden'), JSON.stringify(Array.from(next)));
            return next;
        });
    };
    const unhideChat = React.useCallback((key: string) => {
        setHiddenChats(prev => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            localStorage.setItem(`aurora_hidden_${currentUserId}`, JSON.stringify(Array.from(next)));
            return next;
        });
    }, [currentUserId]);
    const unhideChatRef = useRef(unhideChat);
    useEffect(() => { unhideChatRef.current = unhideChat; }, [unhideChat]);
    const [showArchive, setShowArchive] = useState(false);
    const toggleArchive = (key: string) => {
        setArchivedChats(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            localStorage.setItem(lsKey('archived'), JSON.stringify(Array.from(next)));
            return next;
        });
        setPinMenu(null);
    };

    // Pinned messages within chats (localStorage only)
    const [pinnedMessages, setPinnedMessages] = useState<Record<string, Array<{ id: number; text: string; sender: string }>>>(() => {
        try {
            const raw = JSON.parse(localStorage.getItem(`aurora_pinned_msgs_${currentUserId}`) || '{}');
            // Migrate old format (single object) to array format
            const migrated: Record<string, Array<{ id: number; text: string; sender: string }>> = {};
            for (const k of Object.keys(raw)) {
                const v = raw[k];
                if (!v) continue;
                migrated[k] = Array.isArray(v) ? v : [v];
            }
            return migrated;
        } catch { return {}; }
    });
    const [pinnedMsgIdx, setPinnedMsgIdx] = useState<Record<string, number>>({});

    const togglePinMessage = (chatKey: string, msg: any) => {
        const pinEntry = { id: msg.id, text: msg.message_text || (lang === 'en' ? '[file]' : '[файл]'), sender: (msg as any).sender_name || t('You') };
        setPinnedMessages(prev => {
            const list = prev[chatKey] || [];
            const exists = list.findIndex(p => p.id === msg.id);
            const next = exists >= 0
                ? { ...prev, [chatKey]: list.filter(p => p.id !== msg.id) }
                : { ...prev, [chatKey]: [...list, pinEntry] };
            localStorage.setItem(lsKey('pinned_msgs'), JSON.stringify(next));
            return next;
        });
        setMenuMessageId(null);
    };

    // Folder context menu
    const [folderCtxMenu, setFolderCtxMenu] = useState<{ x: number; y: number; folderId: number } | null>(null);
    const [allChatsCtxMenu, setAllChatsCtxMenu] = useState<{ x: number; y: number } | null>(null);
    // "Add to folder" submenu key within chat context menu
    const [addToFolderKey, setAddToFolderKey] = useState<string | null>(null);

    // Blocked users
    const [blockedUserIds, setBlockedUserIds] = useState<Set<number>>(new Set());
    const loadBlockedUsers = useCallback(async () => {
        try {
            const r = await api.getBlockedUsers(token);
            if (r.success) setBlockedUserIds(new Set((r.blocked || []).map((u: any) => u.id as number)));
        } catch {}
    }, [token]);

    const handleBlockUser = async (userId: number) => {
        try {
            await api.blockUser(token, userId);
            setBlockedUserIds(prev => { const s = new Set(prev); s.add(userId); return s; });
            loadUsers();
        } catch {}
        setPinMenu(null);
    };

    const handleUnblockUser = async (userId: number) => {
        try {
            await api.unblockUser(token, userId);
            setBlockedUserIds(prev => { const s = new Set(prev); s.delete(userId); return s; });
            loadUsers();
        } catch {}
        setPinMenu(null);
    };

    const handleDeleteChat = async (key: string) => {
        const parts = key.split('-');
        const type = parts[0];
        const id = parseInt(parts[1]);
        // Clear messages on server first
        try {
            if (type === 'private') { await api.clearConversation(token, id); }
            else { await api.clearGroupMessages(token, id); }
        } catch {}
        hideChat(key);
        scrollPositions.current.delete(key);
        if (type === 'private') {
            if (activeChat?.type === 'private' && activeChat.id === id) { setActiveChat(null); setMessages([]); }
        } else {
            if (activeChat?.type === 'group' && activeChat.id === id) { setActiveChat(null); setMessages([]); }
        }
        setUnreadCounts(prev => { const n = { ...prev }; delete n[key]; return n; });
        if (pinnedChats.has(key)) togglePin(key);
        if (archivedChats.has(key)) toggleArchive(key);
        setPinMenu(null);
    };

    const addChatToFolder = async (folderId: number, chatKey: string) => {
        const parts = chatKey.split('-');
        const chatType = parts[0];
        const chatId = parseInt(parts[1]);
        try {
            await api.addChatToFolder(token, folderId, chatType, chatId);
            const res = await api.getFolders(token);
            if (res.folders) setFolders(res.folders);
        } catch {}
        setAddToFolderKey(null);
        setPinMenu(null);
    };

    // Media panel
    const [showMediaPanel, setShowMediaPanel] = useState(false);
    const [serverInfo, setServerInfo] = useState<{ storage: string; max_file_mb: number; max_image_mb: number; max_video_mb: number } | null>(null);

    // Voice recording
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const recordingTimeRef = useRef(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Global mini player
    interface NowPlayingItem { src: string; filename: string; index: number; }
    const [nowPlaying, setNowPlaying] = useState<NowPlayingItem | null>(null);

    // Floating video player
    interface NowPlayingVideo { src: string; filename: string; }
    const [nowPlayingVideo, setNowPlayingVideo] = useState<NowPlayingVideo | null>(null);
    const floatingVideoRef = useRef<HTMLVideoElement>(null);
    const [videoPos, setVideoPos] = useState({ x: 24, y: 80 });
    const videoDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
    const [globalPlaying, setGlobalPlaying] = useState(false);
    const [globalCurrentTime, setGlobalCurrentTime] = useState(0);
    const [globalDuration, setGlobalDuration] = useState(0);
    const globalAudioRef = useRef<HTMLAudioElement>(null);
    const knownAudioDurations = useRef<Map<string, number>>(new Map());

    // Reactions: messageId → [{emoji, user_id}]
    const [reactions, setReactions] = useState<Record<number, {emoji: string; user_id: number}[]>>({});
    const [reactionPickerMsgId, setReactionPickerMsgId] = useState<number | null>(null);
    const [showFullReactionPicker, setShowFullReactionPicker] = useState(false);
    const [stickerPackPreview, setStickerPackPreview] = useState<{ url: string; pack?: { id: string; name: string; emoji: string; stickers: string[] } } | null>(null);
    const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);

    // @mention autocomplete
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [groupMembersCache, setGroupMembersCache] = useState<Record<number, { id: number; username: string; tag?: string; avatar?: string }[]>>({});

    // Post views
    const [postViews, setPostViews] = useState<Record<number, number>>({});
    // Group message read counts: msgId → count
    const [groupReadCounts, setGroupReadCounts] = useState<Record<number, number>>({});
    // Group read receipts: msgId → list of readers (id, name)
    const [groupReadReceipts, setGroupReadReceipts] = useState<Record<number, {id: number, name: string}[]>>({});
    // Track which group messages we've already sent read_group for (to avoid duplicates)
    const sentGroupReadRef = useRef<Set<number>>(new Set());
    // Popover showing reader names: msgId or null
    const [readersPopoverMsgId, setReadersPopoverMsgId] = useState<number | null>(null);

    // Sidebar read receipts (✓✓)
    const [lastReadByOther, setLastReadByOther] = useState<Record<number, boolean>>({});

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [showScrollDown, setShowScrollDown] = useState(false);
    const [newMsgWhileScrolled, setNewMsgWhileScrolled] = useState(0);
    const showScrollDownRef = useRef(false);
    const [inputCharCount, setInputCharCount] = useState(0);
    useEffect(() => { showScrollDownRef.current = showScrollDown; }, [showScrollDown]);
    const scrollPositions = useRef<Map<string, number>>(new Map());
    const currentUploadXHR = useRef<XMLHttpRequest | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const mentionAnchorPos = useRef<number>(0);
    const menuContainerRef = useRef<HTMLDivElement>(null);
    const autoResize = (el: HTMLTextAreaElement) => {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 150) + 'px';
    };
    const activeChatRef = useRef<ChatItem | null>(null);
    const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Draft text per chat: key = "type-id", persisted in localStorage
    const _loadDrafts = (): Record<string, string> => {
        try { return JSON.parse(localStorage.getItem('aurora_drafts') || '{}'); } catch { return {}; }
    };
    const chatDrafts = useRef<Map<string, string>>(new Map(Object.entries(_loadDrafts())));
    const [draftsState, setDraftsState] = useState<Record<string, string>>(_loadDrafts);
    const typingUserTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const usersRef = useRef<User[]>([]);
    const groupsRef = useRef<Group[]>([]);
    const notificationClickHandlerRef = useRef<((data: any) => void) | null>(null);
    const notificationReplyHandlerRef = useRef<((data: any) => void) | null>(null);

    const menuMessage = menuMessageId !== null
        ? messages.find(m => m.id === menuMessageId) ?? null
        : null;

    const avatarBg = theme.avatarColor || '#1a73e8';

    // === Voice recording ===

    const startRecording = async () => {
        if (isRecording) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showInAppToast({ title: t('Microphone unavailable'), body: t('To record voice open the site via HTTPS or localhost.'), chatType: 'private', chatId: 0, avatarLetter: '🎤', avatarColor: '#ef4444' });
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/ogg;codecs=opus';
            const mr = new MediaRecorder(stream, { mimeType });
            recordingChunksRef.current = [];
            mr.ondataavailable = e => { if (e.data.size > 0) recordingChunksRef.current.push(e.data); };
            mr.onstop = () => {
                const ext = mimeType.includes('webm') ? 'weba' : 'ogg';
                const blob = new Blob(recordingChunksRef.current, { type: mimeType });
                sendVoiceBlob(blob, ext, recordingTimeRef.current);
                stream.getTracks().forEach(t => t.stop());
                if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
                recordingTimeRef.current = 0;
                setRecordingTime(0);
            };
            mr.start();
            mediaRecorderRef.current = mr;
            setIsRecording(true);
            // Notify peers about voice recording
            const recChat = activeChatRef.current;
            if (recChat) {
                if (recChat.type === 'private' && recChat.id !== currentUserId) wsService.send({ type: 'typing', receiver_id: recChat.id, action: 'recording' });
                else if (recChat.type === 'group') wsService.send({ type: 'group_typing', group_id: recChat.id, action: 'recording' });
            }
            recordingTimeRef.current = 0;
            recordingTimerRef.current = setInterval(() => {
                recordingTimeRef.current += 1;
                setRecordingTime(t => t + 1);
            }, 1000);
        } catch {
            showInAppToast({ title: t('Microphone'), body: t('No microphone access. Check browser permissions.'), chatType: 'private', chatId: 0, avatarLetter: '🎤', avatarColor: '#ef4444' });
        }
    };

    const pauseRecording = () => {
        const mr = mediaRecorderRef.current;
        if (!mr || !isRecording) return;
        if (mr.state === 'recording') {
            mr.pause();
            setIsPaused(true);
            if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        } else if (mr.state === 'paused') {
            mr.resume();
            setIsPaused(false);
            recordingTimerRef.current = setInterval(() => {
                recordingTimeRef.current += 1;
                setRecordingTime(recordingTimeRef.current);
            }, 1000);
        }
    };

    const stopRecording = () => {
        if (!isRecording || !mediaRecorderRef.current) return;
        if (mediaRecorderRef.current.state === 'paused') mediaRecorderRef.current.resume();
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
        setIsRecording(false);
        setIsPaused(false);
    };

    const cancelRecording = () => {
        if (!mediaRecorderRef.current) return;
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
        recordingChunksRef.current = [];
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
        recordingTimeRef.current = 0;
        setRecordingTime(0);
        setIsRecording(false);
        setIsPaused(false);
    };

    // === Global audio mini player ===

    const mediaPlaylist = React.useMemo(() => {
        const list: { src: string; filename: string }[] = [];
        const addFile = (fp: string, fn: string) => {
            if (/\.(mp3|ogg|wav|flac|aac|m4a|opus|weba|mp4|webm|mov|avi|mkv)$/i.test(fn)) {
                const src = fp.startsWith('http') ? fp : `${BASE_URL}${fp}`;
                if (!list.some(x => x.src === src)) list.push({ src, filename: fn });
            }
        };
        for (const msg of messages) {
            const m = msg as any;
            if (m.file_path && m.filename) addFile(m.file_path, m.filename);
            if (m.files) {
                const arr = typeof m.files === 'string' ? (() => { try { return JSON.parse(m.files); } catch { return []; } })() : m.files;
                if (Array.isArray(arr)) arr.forEach((f: any) => { if (f.file_path && f.filename) addFile(f.file_path, f.filename); });
            }
        }
        return list;
    }, [messages]);

    const visibleMessages = React.useMemo(
        () => messages.filter(m => !m.is_deleted),
        [messages]
    );

    const channelCommentCounts = React.useMemo(() => {
        const map: Record<number, number> = {};
        for (const m of messages) {
            const rid = (m as any).reply_to_id;
            if (rid && !m.is_deleted) map[rid] = (map[rid] || 0) + 1;
        }
        return map;
    }, [messages]);

    const activePostComments = React.useMemo(
        () => commentPostId === null ? [] : messages.filter(m => (m as any).reply_to_id === commentPostId && !m.is_deleted),
        [messages, commentPostId]
    );

    const playGlobalAudio = React.useCallback((src: string, filename: string) => {
        // Pause music player while chat audio is playing
        if (miniControlsRef.current && miniIsPlaying) {
            miniControlsRef.current.toggle();
            miniWasPausedByAudio.current = true;
        }
        const index = mediaPlaylist.findIndex(x => x.src === src);
        setNowPlaying({ src, filename, index: index >= 0 ? index : 0 });
        const cachedDur = knownAudioDurations.current.get(src);
        setGlobalDuration(cachedDur && cachedDur > 0 ? cachedDur : 0);
        setGlobalCurrentTime(0);
        setGlobalPlaying(false);
        const audio = globalAudioRef.current;
        if (!audio) return;
        audio.src = src;
        audio.load();
        audio.play().catch(() => {});
    }, [mediaPlaylist, miniIsPlaying]);

    const handleDurationKnown = React.useCallback((src: string, duration: number) => {
        knownAudioDurations.current.set(src, duration);
        if (nowPlaying?.src === src) setGlobalDuration(duration);
    }, [nowPlaying?.src]);

    const prevTrack = () => {
        if (!nowPlaying || mediaPlaylist.length === 0) return;
        const idx = (nowPlaying.index - 1 + mediaPlaylist.length) % mediaPlaylist.length;
        playGlobalAudio(mediaPlaylist[idx].src, mediaPlaylist[idx].filename);
    };

    const nextTrack = () => {
        if (!nowPlaying || mediaPlaylist.length === 0) return;
        const idx = (nowPlaying.index + 1) % mediaPlaylist.length;
        playGlobalAudio(mediaPlaylist[idx].src, mediaPlaylist[idx].filename);
    };

    const resumeMiniIfNeeded = () => {
        if (miniWasPausedByAudio.current && miniControlsRef.current) {
            miniWasPausedByAudio.current = false;
            miniControlsRef.current.toggle();
        }
    };

    // Stop global audio without resuming music (used when music track starts)
    const stopGlobalOnly = React.useCallback(() => {
        globalAudioRef.current?.pause();
        setNowPlaying(null);
        setGlobalPlaying(false);
        setGlobalCurrentTime(0);
        setGlobalDuration(0);
        miniWasPausedByAudio.current = false;
    }, []);

    const stopGlobal = () => {
        globalAudioRef.current?.pause();
        setNowPlaying(null);
        setGlobalPlaying(false);
        setGlobalCurrentTime(0);
        setGlobalDuration(0);
        resumeMiniIfNeeded();
    };

    const toggleGlobalPlay = () => {
        if (!globalAudioRef.current) return;
        if (globalPlaying) { globalAudioRef.current.pause(); setGlobalPlaying(false); }
        else { globalAudioRef.current.play().catch(() => {}); setGlobalPlaying(true); }
    };

    const seekGlobal = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!globalAudioRef.current) return;
        const dur = isFinite(globalAudioRef.current.duration) ? globalAudioRef.current.duration : 0;
        if (!dur) return;
        const rect = e.currentTarget.getBoundingClientRect();
        globalAudioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * dur;
    };

    // Sticker / GIF / Poll helpers
    const isSticker = (text?: string | null) => !!text?.startsWith('__sticker__');
    const isGif = (text?: string | null) => !!text?.startsWith('__gif__');
    const isPoll = (text?: string | null) => !!text?.startsWith('__poll__:');
    const getPollId = (text?: string | null) => { const m = text?.match(/^__poll__:(\d+)$/); return m ? parseInt(m[1]) : null; };
    const isCallEnded = (text?: string | null) => !!text?.startsWith('__call_ended__');
    const getCallDuration = (text?: string | null) => { const m = text?.match(/^__call_ended__(\d+)$/); return m ? parseInt(m[1]) : 0; };
    const isGeo = (text?: string | null) => !!text?.startsWith('__geo__:');
    const getGeo = (text?: string | null) => { try { return JSON.parse(text!.slice(8)); } catch { return null; } };
    const isContact = (text?: string | null) => !!text?.startsWith('__contact__:');
    const getContact = (text?: string | null) => { try { return JSON.parse(text!.slice(12)); } catch { return null; } };
    const isSpecialMsg = (text?: string | null) => isSticker(text) || isGif(text);

    // Single emoji detection — renders big
    const isSingleEmoji = (text: string | null | undefined): boolean => {
        if (!text) return false;
        const t = text.trim();
        if (!t || t.length > 14) return false;
        // Strip all emoji and emoji-modifier codepoints; nothing must remain
        const withoutEmoji = t.replace(/\p{Emoji}/gu, '').replace(/[\u{FE0F}\u{200D}\u{20E3}\u{FE0E}]/gu, '');
        if (withoutEmoji.length > 0) return false;
        // Ensure exactly one grapheme cluster using Intl.Segmenter if available
        try {
            const seg = new (Intl as any).Segmenter('en', { granularity: 'grapheme' });
            return Array.from(seg.segment(t) as Iterable<unknown>).length === 1;
        } catch {
            return t.length <= 4;
        }
    };
    const specialUrl = (text: string): string => {
        if (text.startsWith('__gif__')) return text.slice('__gif__'.length);
        if (text.startsWith('__sticker__')) {
            const raw = text.slice('__sticker__'.length);
            if (raw.startsWith('{')) { try { return JSON.parse(raw).url; } catch {} }
            return raw;
        }
        return text;
    };
    const parseStickerData = (text: string): { url: string; pack?: { id: string; name: string; emoji: string; stickers: string[] } } => {
        const raw = text.slice('__sticker__'.length);
        if (raw.startsWith('{')) { try { return JSON.parse(raw); } catch {} }
        return { url: raw };
    };

    // ─── E2E decryption ─────────────────────────────────────────────────────────
    const [decryptedPreviews, setDecryptedPreviews] = useState<Record<number, string>>({});

    const decryptAndCache = useCallback(async (msgId: number, raw: string, partnerId: number) => {
        if (decryptedTexts[msgId] !== undefined) return;
        const partnerPubKey = getCachedPublicKey(partnerId);
        if (!partnerPubKey) return;
        const { text } = await decryptMessage(raw, partnerPubKey);
        setDecryptedTexts(prev => ({ ...prev, [msgId]: text }));
    }, [decryptedTexts]);

    // Decrypt sidebar last-message previews for private chats
    useEffect(() => {
        users.forEach(u => {
            const raw = u.last_msg_text;
            if (!raw || !isEncryptedMessage(raw)) return;
            const pubKey = getCachedPublicKey(u.id);
            if (!pubKey) return;
            decryptMessage(raw, pubKey).then(({ text }) => {
                setDecryptedPreviews(prev => prev[u.id] === text ? prev : { ...prev, [u.id]: text });
            });
        });
    }, [users]);

    // Load poll titles for sidebar previews
    useEffect(() => {
        const ids = new Set<number>();
        const extract = (txt: string | null | undefined) => {
            if (!txt) return;
            const raw = txt.startsWith('↪️ ') ? (() => { const nl = txt.indexOf('\n'); return nl !== -1 ? txt.slice(nl + 1).trim() : ''; })() : txt;
            const m = raw.match(/^__poll__:(\d+)$/);
            if (m) ids.add(parseInt(m[1]));
        };
        users.forEach(u => extract(u.last_msg_text));
        groups.forEach(g => extract(g.last_msg_text));
        ids.forEach(id => {
            if (pollTitles[id] !== undefined) return;
            api.getPoll(token, id).then((data: any) => {
                if (data?.question) setPollTitles(prev => ({ ...prev, [id]: data.question }));
            }).catch(() => {});
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [users, groups]);

    // Resolve display text (decrypt if needed)
    const getDisplayText = (msg: any, partnerId: number): string => {
        if (!isEncryptedMessage(msg.message_text)) return msg.message_text || '';
        if (decryptedTexts[msg.id] !== undefined) return decryptedTexts[msg.id];
        // Trigger async decryption (will re-render once done)
        decryptAndCache(msg.id, msg.message_text, partnerId);
        return '🔒';
    };

    // True when a message is purely visual media with no text (image or video, no caption)
    const isMediaOnlyMsg = (msg: any): boolean => {
        if (msg.message_text) return false; // has text/caption → keep bubble
        const imgExts = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/i;
        const vidExts = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;
        if (msg.file_path && msg.filename) {
            return imgExts.test(msg.filename) || vidExts.test(msg.filename);
        }
        if (msg.files) {
            const arr: any[] = (() => { try { return typeof msg.files === 'string' ? JSON.parse(msg.files) : msg.files; } catch { return []; } })();
            if (arr.length === 0) return false;
            return arr.every((f: any) => imgExts.test(f.filename || '') || vidExts.test(f.filename || ''));
        }
        return false;
    };

    // True when message has an image/video AND text caption — needs special zero-padding bubble
    const hasMediaWithCaption = (msg: any): boolean => {
        if (!msg.message_text?.trim()) return false;
        const imgExts = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/i;
        const vidExts = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;
        if (msg.file_path && msg.filename && (imgExts.test(msg.filename) || vidExts.test(msg.filename))) return true;
        if (msg.files) {
            const arr: any[] = (() => { try { return typeof msg.files === 'string' ? JSON.parse(msg.files) : msg.files; } catch { return []; } })();
            return arr.some((f: any) => imgExts.test(f.filename || '') || vidExts.test(f.filename || ''));
        }
        return false;
    };

    const formatLastSeen = (lastSeen: string | null | undefined): string => {
        const recently = lang === 'en' ? 'last seen recently' : 'был(а) недавно';
        if (!lastSeen || lastSeen === 'hidden') return recently;
        try {
            const date = new Date(lastSeen);
            if (isNaN(date.getTime())) return recently;
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const justNow = lang === 'en' ? 'just now' : 'только что';
            if (diffMs < 0) return justNow;
            const diffMin = Math.floor(diffMs / 60000);
            if (diffMin < 1) return justNow;
            if (diffMin < 60) return lang === 'en' ? `${diffMin} min ago` : `${diffMin} мин. назад`;
            const diffH = Math.floor(diffMin / 60);
            if (diffH < 6) return lang === 'en' ? `${diffH} h ago` : `${diffH} ч. назад`;
            const today = new Date(); today.setHours(0,0,0,0);
            const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
            const msgDay = new Date(date); msgDay.setHours(0,0,0,0);
            const hhmm = date.toLocaleTimeString(lang === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
            if (msgDay.getTime() === today.getTime()) return lang === 'en' ? `today at ${hhmm}` : `сегодня в ${hhmm}`;
            if (msgDay.getTime() === yesterday.getTime()) return lang === 'en' ? `yesterday at ${hhmm}` : `вчера в ${hhmm}`;
            const diffDays = Math.floor(diffMs / 86400000);
            if (diffDays < 7) return lang === 'en' ? `${diffDays} days ago` : `${diffDays} дн. назад`;
            return lang === 'en' ? 'long ago' : 'давно';
        } catch { return recently; }
    };

    // === Загрузка данных ===

    const loadUsers = useCallback(async () => {
        try {
            const res = await api.getUsers(token);
            if (res.users) setUsers(res.users);
        } catch (e) { console.error(e); }
    }, [token]);

    const loadGroups = useCallback(async () => {
        try {
            const res = await api.getMyGroups(token);
            if (res.groups) setGroups(res.groups);
        } catch (e) { console.error(e); }
    }, [token]);

    const loadPrivateMessages = useCallback(async (userId: number) => {
        try {
            const res = await api.getConversation(token, userId);
            if (res.messages) {
                // Guard against race: discard if user switched chat before response arrived
                if (activeChatRef.current?.type !== 'private' || activeChatRef.current?.id !== userId) return;
                setMessages(res.messages);
                setHasMoreMessages(res.has_more ?? false);
                if (chatLoadingTimerRef.current) { clearTimeout(chatLoadingTimerRef.current); chatLoadingTimerRef.current = null; }
                setChatLoading(false);
                const rxMap: Record<number, {emoji: string; user_id: number}[]> = {};
                for (const msg of res.messages) {
                    if (msg.reactions?.length) rxMap[msg.id] = msg.reactions;
                }
                setReactions(prev => ({ ...prev, ...rxMap }));
                restoreOrBottom();
                wsService.markRead(userId);
            }
        } catch (e) { console.error(e); if (chatLoadingTimerRef.current) { clearTimeout(chatLoadingTimerRef.current); chatLoadingTimerRef.current = null; } setChatLoading(false); }
    }, [token]);

    const loadGroupMessages = useCallback(async (groupId: number) => {
        try {
            const res = await api.getGroupMessages(token, groupId);
            if (res.messages) {
                if (activeChatRef.current?.type !== 'group' || activeChatRef.current?.id !== groupId) return;
                setMessages(res.messages);
                setHasMoreMessages(res.has_more ?? false);
                if (chatLoadingTimerRef.current) { clearTimeout(chatLoadingTimerRef.current); chatLoadingTimerRef.current = null; }
                setChatLoading(false);
                const rxMap: Record<number, {emoji: string; user_id: number}[]> = {};
                const viewMap: Record<number, number> = {};
                const rcMap: Record<number, number> = {};
                for (const msg of res.messages) {
                    if (msg.reactions?.length) rxMap[msg.id] = msg.reactions;
                    if (msg.view_count != null) viewMap[msg.id] = msg.view_count;
                    if (msg.read_count != null) rcMap[msg.id] = msg.read_count;
                }
                setReactions(prev => ({ ...prev, ...rxMap }));
                setPostViews(prev => ({ ...prev, ...viewMap }));
                setGroupReadCounts(prev => ({ ...prev, ...rcMap }));
                restoreOrBottom();
                if (chatLoadingTimerRef.current) { clearTimeout(chatLoadingTimerRef.current); chatLoadingTimerRef.current = null; }
                setChatLoading(false);
            }
        } catch (e) { console.error(e); if (chatLoadingTimerRef.current) { clearTimeout(chatLoadingTimerRef.current); chatLoadingTimerRef.current = null; } setChatLoading(false); }
    }, [token]);

    const MSG_LIMIT = 1000;

    const loadMoreMessages = useCallback(async () => {
        if (loadingMoreMessages || !hasMoreMessages || !activeChat) return;
        if (messagesRef.current.length >= MSG_LIMIT) { setHasMoreMessages(false); return; }
        const firstId = messagesRef.current[0]?.id;
        if (!firstId) return;
        setLoadingMoreMessages(true);
        const container = messagesContainerRef.current;
        const prevScrollHeight = container?.scrollHeight ?? 0;
        try {
            let res: any;
            if (activeChat.type === 'private') {
                res = await api.getConversation(token, activeChat.id, firstId);
            } else {
                res = await api.getGroupMessages(token, activeChat.id, firstId);
            }
            if (res.messages?.length) {
                setMessages(prev => {
                    const combined = [...res.messages, ...prev];
                    return combined.length > MSG_LIMIT ? combined.slice(combined.length - MSG_LIMIT) : combined;
                });
                const newTotal = messagesRef.current.length + res.messages.length;
                setHasMoreMessages((res.has_more ?? false) && newTotal < MSG_LIMIT);
                if (activeChat.type === 'group') {
                    const rxMap: Record<number, {emoji: string; user_id: number}[]> = {};
                    const viewMap: Record<number, number> = {};
                    for (const msg of res.messages) {
                        if (msg.reactions?.length) rxMap[msg.id] = msg.reactions;
                        if (msg.view_count != null) viewMap[msg.id] = msg.view_count;
                    }
                    setReactions(prev => ({ ...prev, ...rxMap }));
                    setPostViews(prev => ({ ...prev, ...viewMap }));
                } else {
                    const rxMap: Record<number, {emoji: string; user_id: number}[]> = {};
                    for (const msg of res.messages) {
                        if (msg.reactions?.length) rxMap[msg.id] = msg.reactions;
                    }
                    setReactions(prev => ({ ...prev, ...rxMap }));
                }
                // restore scroll position after prepend
                requestAnimationFrame(() => {
                    if (container) container.scrollTop = container.scrollHeight - prevScrollHeight;
                });
            } else {
                setHasMoreMessages(false);
            }
        } catch (e) { console.error(e); }
        finally { setLoadingMoreMessages(false); }
    }, [loadingMoreMessages, hasMoreMessages, activeChat, token]);

    const loadGroupMembers = useCallback(async (groupId: number) => {
        if (groupMembersCache[groupId]) return;
        try {
            const res = await api.getGroupInfo(token, groupId);
            if (res.members) {
                setGroupMembersCache(prev => ({ ...prev, [groupId]: res.members }));
            }
        } catch {}
    }, [token, groupMembersCache]);

    useEffect(() => {
        if (selectedUserForProfile?.id === currentUserId) {
            api.getConversation(token, currentUserId).then(res => {
                if (res.messages) setFavoritesMessages(res.messages);
            }).catch(() => {});
        }
    }, [selectedUserForProfile?.id, currentUserId, token]);

    // === Инициализация ===

    useEffect(() => {
        loadUsers();
        loadGroups();
        api.getFolders(token).then(res => { if (res.folders) setFolders(res.folders); }).catch(() => {});
        loadBlockedUsers();
        api.getConversation(token, currentUserId).then(res => {
            if (res.messages?.length) {
                const last = res.messages[res.messages.length - 1];
                setFavoritesLastMsg({ text: last.message_text, time: last.timestamp, file: last.file_path, filename: last.filename });
            } else {
                setFavoritesLastMsg({});
            }
        }).catch(() => setFavoritesLastMsg({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadUsers, loadGroups, loadBlockedUsers]);

    useEffect(() => {
        const id = setInterval(loadGroups, 30000);
        return () => clearInterval(id);
    }, [loadGroups]);

    // === In-chat search ===
    const [chatSearchOpen, setChatSearchOpen] = useState(false);
    const [chatSearchQuery, setChatSearchQuery] = useState('');
    const [chatSearchIdx, setChatSearchIdx] = useState(0);
    const chatSearchInputRef = useRef<HTMLInputElement>(null);
    const [chatSearchFiltersOpen, setChatSearchFiltersOpen] = useState(false);
    const [chatSearchContentType, setChatSearchContentType] = useState<'all'|'text'|'media'|'links'>('all');
    const [chatSearchDateFrom, setChatSearchDateFrom] = useState('');
    const [chatSearchDateTo, setChatSearchDateTo] = useState('');
    const [chatSearchSenderId, setChatSearchSenderId] = useState<number|''>('');
    const [chatSearchServerResults, setChatSearchServerResults] = useState<any[]>([]);
    const [chatSearchLoading, setChatSearchLoading] = useState(false);
    const chatSearchHasFilters = chatSearchContentType !== 'all' || !!chatSearchDateFrom || !!chatSearchDateTo || chatSearchSenderId !== '';

    // IDs of messages currently in DOM (loaded in memory)
    const loadedMessageIds = React.useMemo(() => new Set(messages.map(m => m.id)), [messages]);

    // Server results filtered to only loaded messages
    const chatSearchMatchesAll = React.useMemo(() => chatSearchServerResults.map(r => r.id), [chatSearchServerResults]);
    const chatSearchMatchesLoaded = React.useMemo(() => chatSearchMatchesAll.filter(id => loadedMessageIds.has(id)), [chatSearchMatchesAll, loadedMessageIds]);
    const chatSearchNotLoaded = chatSearchMatchesAll.length - chatSearchMatchesLoaded.length;

    const chatSearchMatches = React.useMemo(() => {
        if (chatSearchHasFilters) return chatSearchMatchesLoaded;
        if (!chatSearchQuery.trim()) return [];
        const q = chatSearchQuery.toLowerCase();
        return messages
            .filter(msg => msg.message_text?.toLowerCase().includes(q))
            .map(msg => msg.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, chatSearchQuery, chatSearchHasFilters, chatSearchServerResults]);

    const goToChatSearchMatch = (idx: number) => {
        if (!chatSearchMatches.length) return;
        const safeIdx = ((idx % chatSearchMatches.length) + chatSearchMatches.length) % chatSearchMatches.length;
        setChatSearchIdx(safeIdx);
        goToMessage(chatSearchMatches[safeIdx]);
    };

    const runChatServerSearch = React.useCallback(async (
        overrides?: { ct?: string; df?: string; dt?: string; sid?: number | '' }
    ) => {
        if (!activeChat) return;
        setChatSearchLoading(true);
        const ct = overrides?.ct ?? chatSearchContentType;
        const df = overrides?.df ?? chatSearchDateFrom;
        const dt = overrides?.dt ?? chatSearchDateTo;
        const sid = overrides?.sid ?? chatSearchSenderId;
        try {
            let url = `${config.API_URL}/search?token=${token}&query=${encodeURIComponent(chatSearchQuery)}&chat_type=${activeChat.type}&chat_id=${activeChat.id}`;
            if (ct !== 'all') url += `&content_type=${ct}`;
            if (df) url += `&date_from=${df}`;
            if (dt) url += `&date_to=${dt}`;
            if (sid) url += `&sender_id=${sid}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            const data = await res.json();
            setChatSearchServerResults(data.results || []);
            setChatSearchIdx(0);
        } catch (e: any) {
            if (e?.name !== 'AbortError') setChatSearchServerResults([]);
        } finally { setChatSearchLoading(false); }
    }, [activeChat, token, chatSearchQuery, chatSearchContentType, chatSearchDateFrom, chatSearchDateTo, chatSearchSenderId]);

    useEffect(() => {
        activeChatRef.current = activeChat;
        setShowClearConfirm(false);
        setShowMediaPanel(false);
        setChatSearchOpen(false);
        setChatSearchQuery('');
        setChatSearchIdx(0);
        setChatSearchFiltersOpen(false);
        setChatSearchContentType('all');
        setChatSearchDateFrom('');
        setChatSearchDateTo('');
        setChatSearchSenderId('');
        setChatSearchServerResults([]);
    }, [activeChat]);

    const goToMessage = (messageId: number) => {
        const el = document.getElementById(`msg-${messageId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.style.transition = 'background 0.3s';
            el.style.background = 'rgba(99,102,241,0.18)';
            setTimeout(() => { el.style.background = ''; }, 1500);
        }
    };

    useEffect(() => { usersRef.current = users; }, [users]);
    useEffect(() => { groupsRef.current = groups; }, [groups]);

    // Request browser notification permission once on mount
    useEffect(() => {
        if ('Notification' in window && (window as any).Notification.permission === 'default') {
            (window as any).Notification.requestPermission();
        }
        const ea = (window as any).electronAPI;
        if (!ea) return;
        ea.onNotificationReply?.((data: any) => {
            notificationReplyHandlerRef.current?.(data);
        });
        ea.onNotificationClick?.((data: any) => {
            notificationClickHandlerRef.current?.(data);
        });

        const handleOpenServerSettings = () => setShowSettings(true);
        window.addEventListener('electron:open-server-settings', handleOpenServerSettings);
        return () => window.removeEventListener('electron:open-server-settings', handleOpenServerSettings);
    }, []);

    useEffect(() => {
        if (!menuMessageId) return;
        const close = () => { setMenuMessageId(null); setShowFullReactionPicker(false); };
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, [menuMessageId]);

    useEffect(() => {
        if (!showDisappearDropdown) return;
        const close = () => setShowDisappearDropdown(false);
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, [showDisappearDropdown]);

    // Online/offline based on tab visibility and window focus
    useEffect(() => {
        let offlineTimer: ReturnType<typeof setTimeout> | null = null;
        const goOnline = () => {
            if (offlineTimer) { clearTimeout(offlineTimer); offlineTimer = null; }
            wsService.sendSetOnline();
        };
        const scheduleOffline = () => {
            if (offlineTimer) return;
            offlineTimer = setTimeout(() => {
                wsService.sendSetOffline();
                offlineTimer = null;
            }, 30000);
        };
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') goOnline();
            else scheduleOffline();
        };
        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('focus', goOnline);
        window.addEventListener('blur', scheduleOffline);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('focus', goOnline);
            window.removeEventListener('blur', scheduleOffline);
            if (offlineTimer) clearTimeout(offlineTimer);
        };
    }, []);

    // Keep notification handlers current (runs every render)
    useEffect(() => {
        notificationReplyHandlerRef.current = (data: any) => {
            if (!data.text) return;
            if (data.chatType === 'private' && data.senderId != null) {
                wsService.sendMessage(data.senderId, data.text);
            } else if (data.chatType === 'group' && data.groupId != null) {
                wsService.sendGroupMessage(data.groupId, data.text);
            }
        };
        notificationClickHandlerRef.current = (data: any) => {
            if (data.chatType === 'private') {
                const user = usersRef.current.find((u: User) => u.id === data.chatId);
                if (user) selectPrivateChat(user);
            } else if (data.chatType === 'group') {
                const group = groupsRef.current.find((g: Group) => g.id === data.chatId);
                if (group) selectGroupChat(group);
            }
        };
    });

    // === E2E Encryption init ===
    useEffect(() => {
        getOrCreateKeyPair()
            .then(() => getOwnPublicKey())
            .then(pubKey => api.updatePublicKey(token, pubKey))
            .catch(() => {});
    }, [token]);

    // === Scheduled messages: load when chat changes ===
    const loadScheduled = useCallback(async (chat: typeof activeChat) => {
        if (!chat) return;
        try {
            const res = chat.type === 'private'
                ? await api.getScheduledMessages(token, chat.id)
                : await api.getScheduledMessages(token, undefined, chat.id);
            setScheduledMessages(res.scheduled || []);
        } catch {}
    }, [token]);

    // === WebSocket ===

    useEffect(() => {
        wsService.connect(token);

        const unsubscribe = wsService.onMessage((data) => {
            const chat = activeChatRef.current;

            if (data.type === 'message') {
                // Own scheduled message echoed back to sender
                if (data.data.is_own && chat?.type === 'private' && chat.id === data.data.receiver_id) {
                    setMessages(prev =>
                        prev.some(m => m.id === data.data.id) ? prev : [...prev, { ...data.data, reactions: [] }]
                    );
                    if (data.data.scheduled_id) {
                        setScheduledMessages(prev => prev.filter(m => m.id !== data.data.scheduled_id));
                    }
                    if (chat) scrollPositions.current.delete(`${chat.type}-${chat.id}`);
                    scrollToBottom(true);
                } else if (chat?.type === 'private' && chat.id === data.data.sender_id) {
                    setMessages(prev =>
                        prev.some(m => m.id === data.data.id) ? prev : [...prev, { ...data.data, reactions: [] }]
                    );
                    if (showScrollDownRef.current) { setNewMsgWhileScrolled(n => n + 1); } else { scrollToBottom(true); }
                    wsService.markRead(data.data.sender_id);
                } else if (data.data.sender_id !== currentUserId) {
                    const key = `private-${data.data.sender_id}`;
                    if (!archivedChatsRef.current.has(key)) {
                        setUnreadCounts(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
                    }
                }
                // Add sender to contacts if not present, update last message
                const senderId = data.data.sender_id;
                if (senderId && senderId !== currentUserId) {
                    // Un-hide if this chat was previously deleted
                    unhideChatRef.current(`private-${senderId}`);
                    setUsers(prev => {
                        if (!prev.some(u => u.id === senderId)) { loadUsers(); return prev; }
                        const u = prev.find(u => u.id === senderId)!;
                        const _f0 = data.data.files?.[0];
                        const updated = { ...u, last_msg_text: data.data.message_text || null, last_msg_file: data.data.file_path || _f0?.file_path || null, last_msg_filename: data.data.filename || _f0?.filename || null, last_msg_time: data.data.timestamp, last_msg_sender_id: data.data.sender_id };
                        return [updated, ...prev.filter(x => x.id !== senderId)];
                    });
                }
                // Show in-app toast (after state update so errors here don't block setUsers)
                try {
                    const senderUser = usersRef.current.find((u: User) => u.id === data.data.sender_id);
                    const isChatActive = activeChatRef.current?.type === 'private' && activeChatRef.current?.id === data.data.sender_id;
                    if (!isChatActive && data.data.sender_id !== currentUserId && !mutedChatsRef.current.has(`private-${data.data.sender_id}`) && !archivedChatsRef.current.has(`private-${data.data.sender_id}`)) {
                        const senderDisplayName = senderUser?.username || data.data.sender_name || t('New message');
                        showInAppToastRef.current?.({
                            title: senderDisplayName,
                            body: getMsgPreview(data.data),
                            chatType: 'private',
                            chatId: data.data.sender_id,
                            senderId: data.data.sender_id,
                            avatarLetter: (senderUser?.username?.[0] || data.data.sender_name?.[0] || '?').toUpperCase(),
                            avatarColor: senderUser?.avatar_color || '#1a73e8',
                            avatarSrc: senderUser?.avatar,
                        });
                        if (!document.hasFocus()) {
                            const ns = (() => { try { const s = localStorage.getItem('aurora_notif_settings'); return s ? JSON.parse(s) : null; } catch { return null; } })();
                            if (!ns || ns.enabled !== false) {
                                if (!ns || ns.privateChats !== false) {
                                    const title = ns?.showName === false ? (lang === 'en' ? 'New message' : 'Новое сообщение') : senderDisplayName;
                                    const body = ns?.showText === false ? (lang === 'en' ? 'You have a new message' : 'У вас новое сообщение') : getMsgPreview(data.data);
                                    (window as any).electronAPI?.showNotification?.(title, body, { chatType: 'private', chatId: data.data.sender_id, senderId: data.data.sender_id });
                                    if ('Notification' in window && Notification.permission === 'granted' && !(window as any).electronAPI) {
                                        new Notification(title, { body, icon: '/logo192.png' });
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { console.error('toast error:', e); }

            } else if (data.type === 'message_sent') {
                if (chat?.type === 'private' && chat.id === data.data.receiver_id) {
                    setMessages(prev =>
                        prev.some(m => m.id === data.data.id) ? prev : [...prev, data.data]
                    );
                    if (chat) scrollPositions.current.delete(`${chat.type}-${chat.id}`);
                    scrollToBottom(true);
                }
                // Self-message (Favorites): update sidebar
                if (data.data.receiver_id === currentUserId) {
                    const _f0fav = data.data.files?.[0];
                    setFavoritesLastMsg({ text: data.data.message_text || null, time: data.data.timestamp, file: data.data.file_path || _f0fav?.file_path || null, filename: data.data.filename || _f0fav?.filename || null });
                }
                // Bring receiver to top, update last message
                const recvId = data.data.receiver_id;
                if (recvId && recvId !== currentUserId) {
                    // Un-hide if this chat was previously deleted
                    unhideChatRef.current(`private-${recvId}`);
                    setUsers(prev => {
                        if (!prev.some(u => u.id === recvId)) {
                            // New contact not yet in list — reload to add them
                            loadUsers();
                            return prev;
                        }
                        const u = prev.find(u => u.id === recvId)!;
                        const _f0s = data.data.files?.[0];
                        const updated = { ...u, last_msg_text: data.data.message_text || null, last_msg_file: data.data.file_path || _f0s?.file_path || null, last_msg_filename: data.data.filename || _f0s?.filename || null, last_msg_time: data.data.timestamp, last_msg_sender_id: currentUserId, last_msg_is_read: 0 };
                        return [updated, ...prev.filter(x => x.id !== recvId)];
                    });
                    // New unread message for receiver — clear read receipt until they read it
                    setLastReadByOther(prev => { const n = { ...prev }; delete n[recvId]; return n; });
                }

            } else if (data.type === 'group_message') {
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    setMessages(prev =>
                        prev.some(m => m.id === data.data.id) ? prev : [...prev, data.data]
                    );
                    if (data.data.sender_id === currentUserId) {
                        if (chat) scrollPositions.current.delete(`${chat.type}-${chat.id}`);
                        scrollToBottom(true);
                    } else if (showScrollDownRef.current) {
                        setNewMsgWhileScrolled(n => n + 1);
                    } else {
                        scrollToBottom(true);
                    }
                    // Auto-mark as read when message arrives while chat is open (like private messages do)
                    if (data.data.sender_id !== currentUserId) {
                        wsService.send({ type: 'group_mark_read', group_id: data.data.group_id });
                    }
                } else if (data.data.sender_id !== currentUserId) {
                    const key = `group-${data.data.group_id}`;
                    if (!archivedChatsRef.current.has(key)) {
                        setUnreadCounts(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
                    }
                }
                // Update group last message and bring to top
                setGroups(prev => {
                    const g = prev.find(g => g.id === data.data.group_id);
                    if (!g) return prev;
                    const _f0g = data.data.files?.[0];
                    const updated = { ...g, last_msg_text: data.data.message_text || null, last_msg_file: data.data.file_path || _f0g?.file_path || null, last_msg_filename: data.data.filename || _f0g?.filename || null, last_msg_time: data.data.timestamp, last_msg_sender_id: data.data.sender_id, last_msg_sender_name: data.data.sender_name || null };
                    return [updated, ...prev.filter(x => x.id !== data.data.group_id)];
                });
                // Show in-app toast for group messages not sent by self
                if (data.data.sender_id !== currentUserId) {
                    const isChatActive = activeChatRef.current?.type === 'group' && activeChatRef.current?.id === data.data.group_id;
                    const isMuted = mutedChatsRef.current.has(`group-${data.data.group_id}`);
                    const isArchived = archivedChatsRef.current.has(`group-${data.data.group_id}`);
                    const groupObj = groupsRef.current.find((g: Group) => g.id === data.data.group_id);
                    const groupName = groupObj?.name || t('Group');
                    const senderName = data.data.sender_name || t('Member');
                    // @all / @here ping — показываем даже если чат открыт
                    if (data.data.mention_ping && !isMuted && !isArchived) {
                        showInAppToastRef.current?.({
                            title: `🔔 ${groupName}`,
                            body: `${senderName}: ${getMsgPreview(data.data)}`,
                            chatType: 'group',
                            chatId: data.data.group_id,
                            senderId: data.data.sender_id,
                            groupId: data.data.group_id,
                            avatarLetter: (groupName[0] || '?').toUpperCase(),
                            avatarColor: '#8b5cf6',
                            avatarSrc: groupObj?.avatar,
                        });
                    }
                    if (!isChatActive && !isMuted && !isArchived) {
                        showInAppToastRef.current?.({
                            title: groupName,
                            body: `${senderName}: ${getMsgPreview(data.data)}`,
                            chatType: 'group',
                            chatId: data.data.group_id,
                            senderId: data.data.sender_id,
                            groupId: data.data.group_id,
                            avatarLetter: (groupName[0] || '?').toUpperCase(),
                            avatarColor: '#6366f1',
                            avatarSrc: groupObj?.avatar,
                        });
                        if (!document.hasFocus()) {
                            const ns2 = (() => { try { const s = localStorage.getItem('aurora_notif_settings'); return s ? JSON.parse(s) : null; } catch { return null; } })();
                            const isChannel = !!(groupsRef.current.find((g: Group) => g.id === data.data.group_id) as any)?.is_channel;
                            const typeKey = isChannel ? 'channels' : 'groups';
                            if (!ns2 || ns2.enabled !== false) {
                                if (!ns2 || ns2[typeKey] !== false) {
                                    const title = ns2?.showName === false ? (lang === 'en' ? 'New message' : 'Новое сообщение') : groupName;
                                    const body = ns2?.showText === false ? (lang === 'en' ? 'You have a new message' : 'У вас новое сообщение') : `${senderName}: ${getMsgPreview(data.data)}`;
                                    (window as any).electronAPI?.showNotification?.(title, body, { chatType: 'group', chatId: data.data.group_id, senderId: data.data.sender_id, groupId: data.data.group_id });
                                    if ('Notification' in window && Notification.permission === 'granted' && !(window as any).electronAPI) {
                                        new Notification(title, { body, icon: '/logo192.png' });
                                    }
                                }
                            }
                        }
                    }
                }

            } else if (data.type === 'message_edited') {
                const editedId = data.data.message_id as number;
                const newText = data.data.new_text as string;
                setMessages(prev => prev.map(msg =>
                    msg.id === editedId
                        ? { ...msg, message_text: newText, edited_at: new Date().toISOString() }
                        : msg
                ));
                // Update sidebar only if this was the last visible message in this chat
                const currentMsgs = messagesRef.current;
                const isLastMsg = currentMsgs.length > 0 && currentMsgs[currentMsgs.length - 1].id === editedId;
                const editedInGroup = data.data.group_id as number | undefined;
                if (editedInGroup) {
                    // Always update group sidebar when message in this group is edited (last msg check via sender)
                    setGroups(prev => prev.map(g => {
                        if (g.id !== editedInGroup) return g;
                        // Update if it's the last message (check by text+sender match, or via isLastMsg for active chat)
                        const isActiveChatGroup = activeChatRef.current?.type === 'group' && activeChatRef.current?.id === editedInGroup;
                        if (isActiveChatGroup && isLastMsg) return { ...g, last_msg_text: newText };
                        if (!isActiveChatGroup && g.last_msg_sender_id === data.data.sender_id) return { ...g, last_msg_text: newText };
                        return g;
                    }));
                } else {
                    const editSenderId = data.data.sender_id as number | undefined;
                    const editReceiverId = data.data.receiver_id as number | undefined;
                    const editOther = editSenderId === currentUserId ? editReceiverId : editSenderId;
                    if (editOther) {
                        setUsers(prev => prev.map(u => {
                            if (u.id !== editOther) return u;
                            const isActiveChatUser = activeChatRef.current?.type === 'private' && activeChatRef.current?.id === editOther;
                            if (isActiveChatUser && isLastMsg) return { ...u, last_msg_text: newText };
                            if (!isActiveChatUser && u.last_msg_sender_id === editSenderId) return { ...u, last_msg_text: newText };
                            return u;
                        }));
                    }
                }

            } else if (data.type === 'message_deleted') {
                const deletedId = data.data.message_id;
                const isGroup = data.data.is_group;
                setDeletingMsgIds(prev => new Set(prev).add(deletedId));
                setTimeout(() => {
                    setMessages(prev => prev.filter(msg => msg.id !== deletedId));
                    setDeletingMsgIds(prev => { const s = new Set(prev); s.delete(deletedId); return s; });
                    // Reload sidebar to reflect the new last message
                    if (isGroup) loadGroups(); else loadUsers();
                }, 320);

            } else if (data.type === 'typing') {
                if (chat?.type === 'private' && chat.id === data.data.user_id && data.data.user_id !== currentUserId) {
                    const action = data.data.action || 'typing';
                    const actionLabel = action === 'uploading' ? (lang === 'en' ? 'sending file...' : 'отправляет файл...') : action === 'recording' ? (lang === 'en' ? 'recording...' : 'записывает...') : t('is typing...');
                    setTypingUser(`${data.data.username || t('Contact')} ${actionLabel}`);
                    if (typingUserTimerRef.current) clearTimeout(typingUserTimerRef.current);
                    typingUserTimerRef.current = setTimeout(() => setTypingUser(null), 3000);
                }
                const tKey = `private-${data.data.user_id}`;
                setTypingChats(prev => ({ ...prev, [tKey]: data.data.username || '' }));
                if (typingChatsTimers.current[tKey]) clearTimeout(typingChatsTimers.current[tKey]);
                typingChatsTimers.current[tKey] = setTimeout(() => setTypingChats(prev => { const n = { ...prev }; delete n[tKey]; return n; }), 3000);

            } else if (data.type === 'group_typing') {
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    const action = data.data.action || 'typing';
                    const actionLabel = action === 'uploading' ? (lang === 'en' ? 'sending file...' : 'отправляет файл...') : action === 'recording' ? (lang === 'en' ? 'recording...' : 'записывает...') : t('is typing...');
                    setTypingUser(`${data.data.username || t('Member')} ${actionLabel}`);
                    if (typingUserTimerRef.current) clearTimeout(typingUserTimerRef.current);
                    typingUserTimerRef.current = setTimeout(() => setTypingUser(null), 3000);
                }
                const tKeyG = `group-${data.data.group_id}`;
                setTypingChats(prev => ({ ...prev, [tKeyG]: data.data.username || '' }));
                if (typingChatsTimers.current[tKeyG]) clearTimeout(typingChatsTimers.current[tKeyG]);
                typingChatsTimers.current[tKeyG] = setTimeout(() => setTypingChats(prev => { const n = { ...prev }; delete n[tKeyG]; return n; }), 3000);

            } else if (data.type === 'new_group') {
                const now = new Date().toISOString();
                const isChannel = !!data.data.is_channel;
                const systemText = isChannel ? (lang === 'en' ? 'Channel created' : 'Канал создан') : (lang === 'en' ? 'Group created' : 'Группа создана');
                // Immediately add the new group to top with system last message
                setGroups(prev => {
                    if (prev.some(g => g.id === data.data.group_id)) return prev;
                    const newGroup: any = { id: data.data.group_id, name: data.data.name, last_msg_text: systemText, last_msg_time: now, last_msg_sender_id: null, is_channel: data.data.is_channel || 0, member_count: 1, avatar: null };
                    return [newGroup, ...prev];
                });
                loadGroups();

            } else if (data.type === 'group_member_added') {
                loadGroups();
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    const targetGroup = groupsRef.current.find((g: Group) => g.id === data.data.group_id);
                    if (!targetGroup?.is_channel) {
                        setMessages(prev => [...prev, {
                            id: Date.now(),
                            is_system: true,
                            message_text: lang === 'en' ? `${data.data.username} joined the group` : `${data.data.username} вступил в группу`,
                            timestamp: new Date().toISOString(),
                            sender_id: 0,
                        } as any]);
                    }
                }

            } else if (data.type === 'group_updated') {
                setGroups(prev => prev.map(g =>
                    g.id === data.data.group_id ? { ...g, avatar: data.data.avatar } : g
                ));

            } else if (data.type === 'group_info_updated') {
                setGroups(prev => prev.map(g => {
                    if (g.id !== data.data.group_id) return g;
                    const patch: any = { name: data.data.name, description: data.data.description };
                    if (data.data.channel_type !== undefined) patch.channel_type = data.data.channel_type;
                    if (data.data.channel_tag !== undefined) patch.channel_tag = data.data.channel_tag;
                    if (data.data.invite_link !== undefined) patch.invite_link = data.data.invite_link;
                    if (data.data.slow_mode !== undefined) patch.slow_mode = data.data.slow_mode;
                    return { ...g, ...patch };
                }));
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    setActiveChat(prev => prev ? { ...prev, name: data.data.name } : prev);
                }

            } else if (data.type === 'group_deleted') {
                setGroups(prev => prev.filter(g => g.id !== data.data.group_id));
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    setActiveChat(null);
                    setMessages([]);
                }

            } else if (data.type === 'removed_from_group') {
                setGroups(prev => prev.filter(g => g.id !== data.data.group_id));
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    setActiveChat(null);
                    setMessages([]);
                }
                // Clear draft for the removed group
                const _draftKey = `group-${data.data.group_id}`;
                chatDrafts.current.delete(_draftKey);
                try { const _d = JSON.parse(localStorage.getItem('aurora_drafts') || '{}'); delete _d[_draftKey]; localStorage.setItem('aurora_drafts', JSON.stringify(_d)); } catch {}

            } else if (data.type === 'group_member_removed') {
                loadGroups();
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    setMessages(prev => [...prev, {
                        id: Date.now(),
                        is_system: true,
                        message_text: lang === 'en' ? `${data.data.username} left the group` : `${data.data.username} покинул группу`,
                        timestamp: new Date().toISOString(),
                        sender_id: 0,
                    } as any]);
                }

            } else if (data.type === 'chat_cleared') {
                if (data.data.is_group) {
                    if (chat?.type === 'group' && chat.id === data.data.group_id) {
                        setMessages([]);
                    }
                } else {
                    const otherId = data.data.user_id;
                    if (chat?.type === 'private' && (chat.id === otherId || otherId === currentUserId)) {
                        setMessages([]);
                    }
                }

            } else if (data.type === 'messages_read') {
                const { message_ids, reader_id } = data.data;
                setMessages(prev => prev.map(m =>
                    message_ids.includes(m.id) ? { ...m, is_read: 1 } : m
                ));
                if (reader_id) {
                    setLastReadByOther(prev => ({ ...prev, [reader_id]: true }));
                    setUsers(prev => prev.map(u => u.id === reader_id ? { ...u, last_msg_is_read: 1 } : u));
                }

            } else if (data.type === 'now_playing') {
                const { user_id, title, artist } = data.data;
                setUsers(prev => prev.map(u =>
                    u.id === user_id ? { ...u, now_playing: title ? (artist ? `${title} — ${artist}` : title) : null } : u
                ));

            } else if (data.type === 'group_messages_read') {
                const { message_ids, read_counts } = data.data;
                setMessages(prev => prev.map(m =>
                    message_ids.includes(m.id) ? { ...m, is_read: true } : m
                ));
                if (read_counts) {
                    setGroupReadCounts(prev => ({ ...prev, ...read_counts }));
                } else {
                    setGroupReadCounts(prev => {
                        const next = { ...prev };
                        message_ids.forEach((id: number) => { next[id] = (next[id] || 0) + 1; });
                        return next;
                    });
                }

            } else if (data.type === 'group_read_receipt') {
                const { message_id, reader_id, reader_name } = data.data;
                setGroupReadReceipts(prev => {
                    const existing = prev[message_id] || [];
                    if (existing.some(r => r.id === reader_id)) return prev;
                    return { ...prev, [message_id]: [...existing, { id: reader_id, name: reader_name }] };
                });

            } else if (data.type === 'reaction_update') {
                const { message_id, user_id, emoji, action } = data.data;
                setReactions(prev => {
                    const cur = prev[message_id] || [];
                    if (action === 'add') {
                        if (cur.some(r => r.user_id === user_id && r.emoji === emoji)) return prev;
                        return { ...prev, [message_id]: [...cur, { emoji, user_id }] };
                    } else {
                        return { ...prev, [message_id]: cur.filter(r => !(r.user_id === user_id && r.emoji === emoji)) };
                    }
                });

            } else if (data.type === 'visibility_update') {
                setUsers(prev => prev.map(u =>
                    u.id === data.data.user_id
                        ? {
                            ...u,
                            last_seen: data.data.last_seen === '__reset__' ? null : (data.data.last_seen !== undefined ? data.data.last_seen : u.last_seen),
                            is_online: data.data.last_seen === 'blocked_you' ? false : u.is_online,
                          }
                        : u
                ));

            } else if (data.type === 'user_status') {
                setUsers(prev => prev.map(u => {
                    if (u.id !== data.data.user_id) return u;
                    const patch: any = { is_online: data.data.is_online };
                    if (!data.data.is_online && data.data.last_seen) patch.last_seen = data.data.last_seen;
                    return { ...u, ...patch };
                }));

            } else if (data.type === 'profile_updated') {
                setUsers(prev => prev.map(u =>
                    u.id === data.data.user_id
                        ? { ...u, username: data.data.username, avatar: data.data.avatar, status: data.data.status, avatar_color: data.data.avatar_color }
                        : u
                ));
                if (chat?.type === 'private' && chat.id === data.data.user_id) {
                    setActiveChat(prev => prev ? { ...prev, name: data.data.username } : prev);
                }
                setMessages(prev => prev.map(m =>
                    (m as any).sender_id === data.data.user_id
                        ? { ...m, sender_avatar: data.data.avatar, sender_avatar_color: data.data.avatar_color, sender_name: data.data.username }
                        : m
                ));

            } else if (data.type === 'scheduled_sent') {
                const sid = data.data.scheduled_id;
                setScheduledMessages(prev => {
                    const msg = prev.find(m => m.id === sid);
                    if (msg) {
                        showInAppToastRef.current?.({
                            title: lang === 'en' ? '📅 Scheduled message sent' : '📅 Запланированное сообщение отправлено',
                            body: msg.message_text?.slice(0, 60) || '',
                            chatType: 'private',
                            chatId: 0,
                            avatarLetter: '📅',
                            avatarColor: '#6366f1',
                        });
                    }
                    return prev.filter(m => m.id !== sid);
                });

            } else if (data.type === 'account_deleted') {
                onLogout();
            } else if (data.type === 'account_banned') {
                const reason = data.data?.reason;
                const expiresAt = data.data?.expires_at;
                localStorage.setItem('aurora_banned_reason', reason || '');
                localStorage.setItem('aurora_banned_userid', String(currentUserId));
                if (expiresAt) localStorage.setItem('aurora_banned_expires_at', expiresAt);
                onLogout();

            } else if (data.type === 'support_reply') {
                // Admin replied to current user
                setNewSupportReply({ ...data.data });
                const _supportText = data.data.message_text;
                const _isMarker = _supportText === '__SUPPORT_RESOLVE__' || _supportText === '__SUPPORT_CONFIRMED__';
                if (!showSupportChatRef.current && !_isMarker) {
                    showInAppToastRef.current?.({
                        title: 'Поддержка Aurora',
                        body: _supportText,
                        chatType: 'private',
                        chatId: 0,
                        senderId: 0,
                        avatarLetter: '🎧',
                        avatarColor: '#6366f1',
                    });
                }

            } else if (data.type === 'support_message') {
                // User sent message to support — notify admin
                setNewSupportMsg({ ...data.data });
                if (!showAdminPanelRef.current) {
                    const supportName = data.data.username || `User #${data.data.user_id}`;
                    showInAppToast({
                        title: `Поддержка: ${supportName}`,
                        body: data.data.message_text.slice(0, 60),
                        chatType: 'private',
                        chatId: 0,
                        senderId: 0,
                        avatarLetter: '🎧',
                        avatarColor: '#ef4444',
                    });
                }
            } else if (data.type === 'new_report') {
                const targetLabels: Record<string, string> = { user: 'пользователь', group: 'группа', message: 'сообщение' };
                const targetLabel = targetLabels[data.data.target_type] || data.data.target_type;
                showInAppToastRef.current?.({
                    title: `🚨 Новая жалоба`,
                    body: `${data.data.reporter_name} → ${targetLabel} · ${data.data.reason}`,
                    chatType: 'private',
                    chatId: 0,
                    senderId: 0,
                    avatarLetter: '🚨',
                    avatarColor: '#ef4444',
                });
            } else if (data.type === 'disappear_setting_changed') {
                const key = `${data.data.chat_type}-${data.data.other_id}`;
                setDisappearSettings(prev => ({ ...prev, [key]: data.data.seconds }));

            } else if (data.type === 'slow_mode_updated') {
                const gid = data.data.group_id as number;
                setGroupSlowModes(prev => ({ ...prev, [gid]: data.data.slow_mode }));

            } else if (data.type === 'slow_mode_wait') {
                const gid = data.data.group_id as number;
                const wait = data.data.wait_seconds as number;
                setSlowModeCooldowns(prev => ({ ...prev, [gid]: wait }));
                if (slowModeTimers.current[gid]) clearInterval(slowModeTimers.current[gid]);
                slowModeTimers.current[gid] = setInterval(() => {
                    setSlowModeCooldowns(prev => {
                        const cur = (prev[gid] || 0) - 1;
                        if (cur <= 0) {
                            clearInterval(slowModeTimers.current[gid]);
                            delete slowModeTimers.current[gid];
                            const next = { ...prev }; delete next[gid]; return next;
                        }
                        return { ...prev, [gid]: cur };
                    });
                }, 1000);
            } else if (data.type === 'error') {
                showInAppToastRef.current?.({
                    title: lang === 'en' ? 'Error' : 'Ошибка',
                    body: data.data.message || '',
                    chatType: 'private', chatId: 0,
                    avatarLetter: '⚠️', avatarColor: '#ef4444',
                });
            }
        });

        return () => {
            unsubscribe();
            if (typingUserTimerRef.current) clearTimeout(typingUserTimerRef.current);
            if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, loadGroups, loadUsers, currentUserId]);

    // === Выбор чата ===

    const saveDraft = useCallback((chat: ChatItem | null) => {
        if (!chat) return;
        const key = `${chat.type}-${chat.id}`;
        const text = inputRef.current?.value || '';
        chatDrafts.current.set(key, text);
        setDraftsState(prev => {
            if (text === (prev[key] || '')) return prev;
            const next = text ? { ...prev, [key]: text } : (() => { const n = { ...prev }; delete n[key]; return n; })();
            try { localStorage.setItem('aurora_drafts', JSON.stringify(next)); } catch {}
            return next;
        });
    }, []);

    // Save current draft before page unload (handles F5 / Ctrl+R)
    useEffect(() => {
        const handler = () => saveDraft(activeChatRef.current);
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [saveDraft]);

    const pendingDraftKey = useRef<string | null>(null);

    const restoreDraft = useCallback((key: string) => {
        if (inputRef.current) {
            inputRef.current.value = chatDrafts.current.get(key) || '';
            autoResize(inputRef.current);
        } else {
            // textarea not yet in DOM (e.g. first chat open after reload) — defer to after render
            pendingDraftKey.current = key;
        }
    }, []);

    useEffect(() => {
        if (pendingDraftKey.current && inputRef.current) {
            inputRef.current.value = chatDrafts.current.get(pendingDraftKey.current) || '';
            autoResize(inputRef.current);
            pendingDraftKey.current = null;
        }
    }, [activeChat]);

    const selectPrivateChat = (user: User) => {
        saveDraft(activeChatRef.current);
        setReplyTo(null);
        setCommentPostId(null);
        setPreviewGroup(null);
        setShowScrollDown(false);
        setNewMsgWhileScrolled(0);
        setTypingUser(null);
        if (typingUserTimerRef.current) { clearTimeout(typingUserTimerRef.current); typingUserTimerRef.current = null; }
        sentGroupReadRef.current.clear();
        setEditingMessageId(null);
        setEditingText('');
        setReactionPickerMsgId(null);
        setShowFullReactionPicker(false);
        setDeletingMsgIds(new Set());
        setEditingCommentId(null);
        setEditingCommentText('');
        setCommentReplyTo(null);
        setScheduledMessages([]);
        setMessages([]);
        setHasMoreMessages(false);
        setShowAttachMenu(false);
        setShowEmojiPicker(false);
        if (chatLoadingTimerRef.current) clearTimeout(chatLoadingTimerRef.current);
        chatLoadingTimerRef.current = setTimeout(() => { setChatLoading(true); chatLoadingTimerRef.current = null; }, 150);
        setChatKey(k => k + 1);
        setActiveChat({ type: 'private', id: user.id, name: user.username });
        setUnreadCounts(prev => { const next = { ...prev }; delete next[`private-${user.id}`]; return next; });
        restoreDraft(`private-${user.id}`);
        // Add to contacts list if not present
        setUsers(prev => prev.some(u => u.id === user.id) ? prev : [...prev, user]);
        loadPrivateMessages(user.id);
        // Fetch partner public key for decrypting any old encrypted messages
        if (!getCachedPublicKey(user.id)) {
            api.getUserPublicKey(token, user.id).then(pk => {
                if (!pk) return;
                cachePublicKey(user.id, pk);
                // Trigger re-render so decryptAndCache runs with the new key
                setDecryptedTexts(prev => ({ ...prev }));
            }).catch(() => {});
        }
        loadScheduled({ type: 'private', id: user.id, name: user.username });
        api.getDisappearSetting(token, 'private', user.id).then(res => {
            if (res.seconds !== undefined) {
                setDisappearSettings(prev => ({ ...prev, [`private-${user.id}`]: res.seconds }));
            }
        }).catch(() => {});
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const selectGroupChat = (group: Group) => {
        saveDraft(activeChatRef.current);
        setReplyTo(null);
        setCommentPostId(null);
        setPreviewGroup(null);
        setShowScrollDown(false);
        setNewMsgWhileScrolled(0);
        setTypingUser(null);
        if (typingUserTimerRef.current) { clearTimeout(typingUserTimerRef.current); typingUserTimerRef.current = null; }
        sentGroupReadRef.current.clear();
        setEditingMessageId(null);
        setEditingText('');
        setReactionPickerMsgId(null);
        setShowFullReactionPicker(false);
        setDeletingMsgIds(new Set());
        setEditingCommentId(null);
        setEditingCommentText('');
        setCommentReplyTo(null);
        setScheduledMessages([]);
        setMessages([]);
        setHasMoreMessages(false);
        setShowAttachMenu(false);
        setShowEmojiPicker(false);
        if (chatLoadingTimerRef.current) clearTimeout(chatLoadingTimerRef.current);
        chatLoadingTimerRef.current = setTimeout(() => { setChatLoading(true); chatLoadingTimerRef.current = null; }, 150);
        setChatKey(k => k + 1);
        setActiveChat({ type: 'group', id: group.id, name: group.name });
        setUnreadCounts(prev => { const next = { ...prev }; delete next[`group-${group.id}`]; return next; });
        restoreDraft(`group-${group.id}`);
        wsService.send({ type: 'group_mark_read', group_id: group.id });
        loadGroupMessages(group.id);
        loadGroupMembers(group.id);
        loadScheduled({ type: 'group', id: group.id, name: group.name });
        api.getDisappearSetting(token, 'group', group.id).then(res => {
            if (res.seconds !== undefined) {
                setDisappearSettings(prev => ({ ...prev, [`group-${group.id}`]: res.seconds }));
            }
        }).catch(() => {});
        // Load slow mode setting
        if (group.slow_mode !== undefined) {
            setGroupSlowModes(prev => ({ ...prev, [group.id]: group.slow_mode as number }));
        } else {
            fetch(`${config.API_URL}/groups/${group.id}?token=${token}`)
                .then(r => r.json()).then(d => { if (d.slow_mode !== undefined) setGroupSlowModes(prev => ({ ...prev, [group.id]: d.slow_mode })); }).catch(() => {});
        }
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const openChannelPreview = (channel: any) => {
        saveDraft(activeChatRef.current);
        setReplyTo(null);
        setCommentPostId(null);
        setPreviewGroup({ ...channel, is_channel: 1, channel_type: 'public', my_role: null } as any);
        setActiveChat({ type: 'group', id: channel.id, name: channel.name });
        loadGroupMessages(channel.id);
    };

    const handleCreatePoll = async (question: string, options: string[], isAnonymous: boolean, isMultiChoice: boolean) => {
        if (!activeChat) return;
        try {
            const res = await api.createPoll(token, question, options, isAnonymous, isMultiChoice);
            if (res.poll_id) {
                const pollText = `__poll__:${res.poll_id}`;
                const targetReplyTo = replyTo;
                if (activeChat.type === 'private') {
                    wsService.sendMessage(activeChat.id, pollText, undefined, undefined, undefined,
                        targetReplyTo?.id, targetReplyTo?.message_text, targetReplyTo?.sender_name);
                } else if (activeChat.type === 'group') {
                    wsService.sendGroupMessage(activeChat.id, pollText, undefined, undefined, undefined,
                        targetReplyTo?.id, targetReplyTo?.message_text, targetReplyTo?.sender_name);
                }
                setReplyTo(null);
            }
        } catch {}
    };

    // === Отправка ===

    const sendMessage = async () => {
        // If in edit mode — submit edit instead of sending new message
        if (editingMessageId) {
            handleEditSubmit();
            return;
        }

        const text = (inputRef.current?.value || '').trim();
        const hasFiles = pendingFiles.length > 0;
        if (!text && !hasFiles) return;
        if (!activeChat) return;
        if (uploading) return;
        if (activeChat.type === 'private' && (usersById.get(activeChat.id) as any)?.is_deleted) return;

        const targetChat = { ...activeChat };
        const targetReplyTo = replyTo;

        if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = 'auto'; setInputCharCount(0); }
        setReplyTo(null);
        // Clear draft for this chat
        const draftKey = `${targetChat.type}-${targetChat.id}`;
        chatDrafts.current.set(draftKey, '');
        setDraftsState(prev => {
            if (!prev[draftKey]) return prev;
            const next = { ...prev }; delete next[draftKey];
            try { localStorage.setItem('aurora_drafts', JSON.stringify(next)); } catch {}
            return next;
        });

        // Text only — send immediately via WS
        if (text && !hasFiles) {
            if (targetChat.type === 'private') {
                wsService.sendMessage(targetChat.id, text, undefined, undefined, undefined,
                    targetReplyTo?.id, targetReplyTo?.message_text, targetReplyTo?.sender_name);
            } else {
                wsService.sendGroupMessage(targetChat.id, text, undefined, undefined, undefined,
                    targetReplyTo?.id, targetReplyTo?.message_text, targetReplyTo?.sender_name);
            }
            return;
        }

        // Files (possibly with text) — upload then send combined in one message
        if (hasFiles) {
            const filesToUpload = [...pendingFiles];
            setPendingFiles([]);
            setUploading(true);
            setUploadProgress(0);
            // Notify peers about file upload
            if (targetChat.type === 'private' && targetChat.id !== currentUserId) wsService.send({ type: 'typing', receiver_id: targetChat.id, action: 'uploading' });
            else if (targetChat.type === 'group') wsService.send({ type: 'group_typing', group_id: targetChat.id, action: 'uploading' });

            (async () => {
                try {
                    const totalSize = filesToUpload.reduce((sum, f) => sum + f.size, 0) || 1;
                    let uploadedSize = 0;
                    const results: any[] = [];
                    for (const f of filesToUpload) {
                        setUploadingFileName(f.name);
                        const sizeBefore = uploadedSize;
                        const result = await api.uploadFileWithProgress(token, f, (pct) => {
                            setUploadProgress(Math.round(((sizeBefore + f.size * pct / 100) / totalSize) * 100));
                        }, (xhr) => { currentUploadXHR.current = xhr; });
                        currentUploadXHR.current = null;
                        uploadedSize += f.size;
                        setUploadProgress(Math.round((uploadedSize / totalSize) * 100));
                        results.push(result);
                    }
                    const uploadedFiles = results
                        .filter(r => r.success)
                        .map(r => ({ file_path: r.file_path, filename: r.filename, file_size: r.file_size }));
                    if (uploadedFiles.length > 0) {
                        if (targetChat.type === 'private') {
                            wsService.sendMessage(targetChat.id, text, undefined, undefined, undefined,
                                targetReplyTo?.id, targetReplyTo?.message_text, targetReplyTo?.sender_name, uploadedFiles);
                        } else {
                            wsService.sendGroupMessage(targetChat.id, text, undefined, undefined, undefined,
                                targetReplyTo?.id, targetReplyTo?.message_text, targetReplyTo?.sender_name, uploadedFiles);
                        }
                    }
                } catch (e: any) {
                    if (e?.message !== 'Upload cancelled') {
                        showInAppToast({ title: t('Upload error'), body: t('Failed to upload file'), chatType: 'private', chatId: 0, avatarLetter: '⚠️', avatarColor: '#ef4444' });
                    }
                } finally {
                    setUploading(false);
                    setUploadProgress(0);
                    setUploadingFileName('');
                    currentUploadXHR.current = null;
                }
            })();
        }
    };

    const sendVoiceBlob = async (blob: Blob, ext: string, knownDuration?: number) => {
        const chat = activeChatRef.current;
        if (!chat) return;
        if (chat.type === 'private' && (usersById.get(chat.id) as any)?.is_deleted) return;
        const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: blob.type });
        setUploading(true);
        setUploadProgress(0);
        setUploadingFileName(file.name);
        try {
            const result = await api.uploadFileWithProgress(token, file, (pct) => {
                setUploadProgress(pct);
            }, (xhr) => { currentUploadXHR.current = xhr; });
            currentUploadXHR.current = null;
            if (result.success) {
                if (knownDuration && knownDuration > 0) {
                    const src = result.file_path.startsWith('http') ? result.file_path : `${BASE_URL}${result.file_path}`;
                    knownAudioDurations.current.set(src, knownDuration);
                }
                const uploaded = [{ file_path: result.file_path, filename: result.filename, file_size: result.file_size }];
                if (chat.type === 'private') wsService.sendMessage(chat.id, '', undefined, undefined, undefined, undefined, undefined, undefined, uploaded);
                else wsService.sendGroupMessage(chat.id, '', undefined, undefined, undefined, undefined, undefined, undefined, uploaded);
            }
        } catch {
            showInAppToast({ title: t('Upload error'), body: t('Failed to upload file'), chatType: 'private', chatId: 0, avatarLetter: '⚠️', avatarColor: '#ef4444' });
        } finally {
            setUploading(false);
            setUploadProgress(0);
            setUploadingFileName('');
            currentUploadXHR.current = null;
        }
    };

    const sendGeoMessage = (geo: { lat: number; lon: number; name: string; address: string }) => {
        if (!activeChat) return;
        if (activeChat.type === 'private' && (isDeletedUser || isBlockedByMeInput)) return;
        const text = `__geo__:${JSON.stringify(geo)}`;
        if (activeChat.type === 'private') { wsService.sendMessage(activeChat.id, text); loadUsers(); }
        else wsService.sendGroupMessage(activeChat.id, text);
    };

    const sendContactMessage = (contact: { id: number; username: string; avatar?: string; avatar_color?: string }) => {
        if (!activeChat) return;
        if (activeChat.type === 'private' && (isDeletedUser || isBlockedByMeInput)) return;
        const text = `__contact__:${JSON.stringify(contact)}`;
        if (activeChat.type === 'private') { wsService.sendMessage(activeChat.id, text); loadUsers(); }
        else wsService.sendGroupMessage(activeChat.id, text);
    };

    // Send sticker or GIF as a special message (no file upload needed — URL already known)
    const sendSpecialMessage = (text: string) => {
        if (!activeChat) return;
        if (activeChat.type === 'private') {
            wsService.sendMessage(activeChat.id, text);
            loadUsers();
        } else {
            wsService.sendGroupMessage(activeChat.id, text);
        }
    };

    // === Scheduled message ===
    const sendScheduled = async () => {
        const text = (inputRef.current?.value || '').trim();
        if (!text || !activeChat) return;
        if (!sendWhenOnline && !scheduleDateTime) return;
        if (isDeletedUser || isBlockedByMeInput) return;
        try {
            const isoTime = sendWhenOnline ? undefined : new Date(scheduleDateTime).toISOString();
            const res = activeChat.type === 'private'
                ? await api.scheduleMessage(token, text, isoTime, activeChat.id, undefined, sendWhenOnline)
                : await api.scheduleMessage(token, text, isoTime, undefined, activeChat.id, sendWhenOnline);
            if (res.success) {
                const newItem = {
                    id: res.id,
                    sender_id: currentUserId,
                    message_text: text,
                    scheduled_at: res.scheduled_at,
                    send_when_online: sendWhenOnline,
                    receiver_id: activeChat.type === 'private' ? activeChat.id : null,
                    group_id: activeChat.type === 'group' ? activeChat.id : null,
                };
                setScheduledMessages(prev => [...prev, newItem]);
                if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = 'auto'; setInputCharCount(0); }
            }
        } catch {}
        setShowSchedulePicker(false);
        setScheduleDateTime('');
        setSendWhenOnline(false);
    };

    const cancelScheduled = async (id: number) => {
        await api.deleteScheduledMessage(token, id);
        setScheduledMessages(prev => prev.filter(m => m.id !== id));
    };

    // Send a sticker, embedding the pack metadata so recipients can add the pack
    const sendStickerMessage = (url: string) => {
        try {
            const packs: any[] = JSON.parse(localStorage.getItem('aurora_sticker_packs') || '[]');
            const pack = packs.find((p: any) => p.stickers?.some((s: any) => s.url === url));
            if (pack) {
                const data = { url, pack: { id: pack.id, name: pack.name, emoji: pack.emoji, stickers: pack.stickers.map((s: any) => s.url) } };
                sendSpecialMessage('__sticker__' + JSON.stringify(data));
                return;
            }
        } catch {}
        sendSpecialMessage('__sticker__' + url);
    };

    const addPendingFiles = (files: FileList | File[]) => {
        const arr = Array.from(files).filter(f => {
            if (f.size > 5 * 1024 * 1024 * 1024) {
                showInAppToast({ title: lang === 'en' ? 'File too large' : 'Файл слишком большой', body: lang === 'en' ? `"${f.name}" exceeds the 5 GB limit` : `"${f.name}" превышает лимит 5 ГБ`, chatType: 'private', chatId: 0, avatarLetter: '📎', avatarColor: '#ef4444' });
                return false;
            }
            return true;
        });
        setPendingFiles(prev => {
            const combined = [...prev, ...arr];
            if (combined.length > 10) {
                showInAppToast({ title: t('File limit'), body: t('Max 10 files allowed'), chatType: 'private', chatId: 0, avatarLetter: '📎', avatarColor: '#6366f1' });
                return combined.slice(0, 10);
            }
            return combined;
        });
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) addPendingFiles(e.target.files);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleTyping = () => {
        if (uploading || pendingFiles.length > 0) return; // suppress during file upload
        if (!typing && activeChat) {
            setTyping(true);
            if (activeChat.type === 'private' && activeChat.id !== currentUserId) wsService.sendTyping(activeChat.id);
            else if (activeChat.type === 'group') wsService.sendGroupTyping(activeChat.id);
            if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
            typingTimerRef.current = setTimeout(() => setTyping(false), 2000);
        }
    };

    // === Clear chat ===

    const handleClearChat = () => {
        if (!activeChat) return;
        setShowClearConfirm(true);
    };

    const confirmClearChat = async () => {
        if (!activeChat) return;
        setShowClearConfirm(false);
        try {
            if (activeChat.type === 'private') {
                await api.clearConversation(token, activeChat.id);
                setMessages([]);
                setActiveChat(null);
            } else {
                const res = await api.clearGroupMessages(token, activeChat.id);
                if (res.success) { setMessages([]); setActiveChat(null); }
            }
        } catch {
            // silently fail
        }
    };

    // === Меню сообщения ===

    const handleContextMenu = (e: React.MouseEvent, msg: any) => {
        if (selectionMode) { toggleMsgSelection(msg.id); return; }
        e.preventDefault();
        e.stopPropagation();
        setMenuMessageId(msg.id);
        setMenuPosition({ x: e.clientX, y: e.clientY });
        setMenuClampedPos({ x: e.clientX, y: e.clientY });
    };

    // Long-press for iOS/touch devices (context menu via touch)
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressMoved = useRef(false);

    // ── Swipe-to-reply (mobile) ──────────────────────────────────────────────
    const [swipingMsgId, setSwipingMsgId] = useState<number | null>(null);
    const [swipeOffset, setSwipeOffset] = useState(0);
    const swipeTouchRef = useRef<{ id: number; startX: number; startY: number; locked: boolean } | null>(null);

    const handleMsgTouchStart = useCallback((e: React.TouchEvent, msgId: number) => {
        const t = e.touches[0];
        swipeTouchRef.current = { id: msgId, startX: t.clientX, startY: t.clientY, locked: false };
    }, []);

    const handleMsgTouchMove = useCallback((e: React.TouchEvent, msgId: number) => {
        const ref = swipeTouchRef.current;
        if (!ref || ref.id !== msgId) return;
        const t = e.touches[0];
        const dx = t.clientX - ref.startX;
        const dy = Math.abs(t.clientY - ref.startY);
        if (!ref.locked) {
            if (dy > Math.abs(dx)) { swipeTouchRef.current = null; return; } // vertical scroll
            if (Math.abs(dx) > 8) ref.locked = true;
        }
        if (!ref.locked) return;
        const offset = Math.max(0, Math.min(dx, 72)); // right swipe only, cap 72px
        if (offset > 0) {
            setSwipingMsgId(msgId);
            setSwipeOffset(offset);
        }
    }, []);

    const handleMsgTouchEnd = useCallback((msg: any) => {
        const ref = swipeTouchRef.current;
        swipeTouchRef.current = null;
        if (!ref) return;
        if (swipeOffset > 52) {
            setReplyTo({ id: msg.id, text: msg.message_text || '', sender: (msg as any).sender_name || (lang === 'en' ? 'You' : 'Вы'), file_path: msg.file_path, filename: msg.filename });
            if ('vibrate' in navigator) navigator.vibrate(10);
        }
        setSwipingMsgId(null);
        setSwipeOffset(0);
    }, [swipeOffset, lang]);

    const makeLongPressHandlers = (msg: any) => ({
        onTouchStart: (e: React.TouchEvent) => {
            longPressMoved.current = false;
            handleMsgTouchStart(e, msg.id);
            longPressTimer.current = setTimeout(() => {
                if (!longPressMoved.current) {
                    const touch = e.touches[0];
                    setMenuMessageId(msg.id);
                    setMenuPosition({ x: touch.clientX, y: touch.clientY });
                    setMenuClampedPos({ x: touch.clientX, y: touch.clientY });
                }
            }, 500);
        },
        onTouchMove: (e: React.TouchEvent) => {
            longPressMoved.current = true;
            if (longPressTimer.current) clearTimeout(longPressTimer.current);
            handleMsgTouchMove(e, msg.id);
        },
        onTouchEnd: () => {
            if (longPressTimer.current) clearTimeout(longPressTimer.current);
            handleMsgTouchEnd(msg);
        },
        onTouchCancel: () => {
            if (longPressTimer.current) clearTimeout(longPressTimer.current);
            setSwipingMsgId(null);
            setSwipeOffset(0);
            swipeTouchRef.current = null;
        },
    });

    // Clamp context menu inside viewport after it renders
    useLayoutEffect(() => {
        if (!menuMessage || !menuContainerRef.current || isMobile) return;
        const el = menuContainerRef.current;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 8;
        const x = Math.max(margin, Math.min(menuPosition.x, vw - rect.width - margin));
        const y = Math.max(margin, Math.min(menuPosition.y, vh - rect.height - margin));
        setMenuClampedPos({ x, y });
    }, [menuMessage, menuPosition, isMobile, showFullReactionPicker]);

    const handleEdit = (messageId: number, currentText: string) => {
        setEditingMessageId(messageId);
        setEditingText(currentText);
        setMenuMessageId(null);
        // Move text to main input
        if (inputRef.current) {
            inputRef.current.value = currentText;
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + 'px';
            inputRef.current.focus();
        }
    };

    const handleEditSubmit = (messageId?: number) => {
        const id = messageId ?? editingMessageId;
        const text = (inputRef.current?.value || editingText).trim();
        if (!text) return; // block empty edit — server also rejects it
        if (id) {
            wsService.sendRaw({
                type: 'edit_message',
                message_id: id,
                new_text: text,
                is_group: activeChatRef.current?.type === 'group',
            });
        }
        setEditingMessageId(null);
        setEditingText('');
        if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = 'auto'; setInputCharCount(0); }
    };

    const [deleteConfirmId, setDeleteConfirmId] = useState<{ id: number; senderId: number } | null>(null);
    const [deletingMsgIds, setDeletingMsgIds] = useState<Set<number>>(new Set());
    const [forwardingMessage, setForwardingMessage] = useState<any | null>(null);

    const handleDelete = (messageId: number) => {
        setMenuMessageId(null);
        const isFavorites = activeChat?.type === 'private' && activeChat.id === currentUserId;
        if (isFavorites) {
            // In Favorites, delete immediately without confirmation
            wsService.sendRaw({ type: 'delete_message', message_id: messageId, is_group: false, for_self: false });
            return;
        }
        const msg = messages.find(m => m.id === messageId);
        setDeleteConfirmId({ id: messageId, senderId: msg?.sender_id ?? currentUserId });
    };

    // One reaction per user: if user already has a different emoji, swap it; same emoji = toggle off
    const toggleReaction = (msgId: number, isGroup: boolean, emoji: string) => {
        const msgRx = reactions[msgId] || [];
        const myExisting = msgRx.find(r => r.user_id === currentUserId);
        if (myExisting) {
            wsService.removeReaction(msgId, isGroup, myExisting.emoji);
            if (myExisting.emoji !== emoji) wsService.addReaction(msgId, isGroup, emoji);
        } else {
            wsService.addReaction(msgId, isGroup, emoji);
        }
    };

    const confirmDelete = (forSelf: boolean) => {
        if (deleteConfirmId === null) return;
        wsService.sendRaw({
            type: 'delete_message',
            message_id: deleteConfirmId.id,
            is_group: activeChatRef.current?.type === 'group',
            for_self: forSelf,
        });
        setDeleteConfirmId(null);
    };

    const toggleMsgSelection = (id: number) => {
        setSelectedMsgIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const enterSelectionMode = (msg: any) => {
        setMenuMessageId(null);
        setSelectionMode(true);
        setSelectedMsgIds(new Set([msg.id]));
    };

    const exitSelectionMode = () => {
        setSelectionMode(false);
        setSelectedMsgIds(new Set());
    };

    const handleBulkDelete = (forSelf: boolean) => {
        selectedMsgIds.forEach(id => {
            wsService.sendRaw({
                type: 'delete_message',
                message_id: id,
                is_group: activeChatRef.current?.type === 'group',
                for_self: forSelf,
            });
        });
        setBulkDeleteConfirm(false);
        exitSelectionMode();
    };

    const handleBulkForward = () => {
        const msgs = messages.filter(m => selectedMsgIds.has(m.id) && !m.is_deleted);
        setForwardingMessages(msgs);
        exitSelectionMode();
    };

    const handleGroupAvatarUpdated = (groupId: number, avatar: string) => {
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, avatar } : g));
    };

    const handleGroupUpdated = (groupId: number, name: string, description: string) => {
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, name, description } : g));
        if (activeChatRef.current?.type === 'group' && activeChatRef.current.id === groupId) {
            setActiveChat(prev => prev ? { ...prev, name } : prev);
        }
    };

    const handleGroupDeleted = (groupId: number) => {
        setGroups(prev => prev.filter(g => g.id !== groupId));
        if (activeChatRef.current?.type === 'group' && activeChatRef.current.id === groupId) {
            setActiveChat(null);
            setMessages([]);
        }
        setShowGroupInfo(false);
    };

    // === Утилиты ===

    // Parses `↩ author: quote...\nactual text` format used in comments
    const parseCommentReplyPrefix = (text: string): { replyAuthor?: string; replyQuote?: string; mainText: string } => {
        const match = text.match(/^↩ ([^:]+): ([\s\S]*?)\.\.\.\n([\s\S]*)$/);
        if (match) return { replyAuthor: match[1], replyQuote: match[2], mainText: match[3] };
        return { mainText: text };
    };
    const stripCommentReplyPrefix = (text: string | null | undefined): string => {
        if (!text) return '';
        const parsed = parseCommentReplyPrefix(text);
        return parsed.mainText;
    };

    // restoreOrBottom: on initial chat load — restore saved scroll position if exists, else go to bottom
    const restoreOrBottom = () => {
        setTimeout(() => {
            const chat = activeChatRef.current;
            if (chat) {
                const key = `${chat.type}-${chat.id}`;
                const saved = scrollPositions.current.get(key);
                if (saved !== undefined) {
                    const el = messagesContainerRef.current;
                    if (el) { el.scrollTop = saved; return; }
                }
            }
            messagesEndRef.current?.scrollIntoView();
        }, 40);
    };

    const scrollToBottom = (smooth = false) => {
        setNewMsgWhileScrolled(0);
        setTimeout(() => {
            if (!messagesEndRef.current) return;
            if (smooth) {
                messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
            } else {
                messagesEndRef.current.scrollIntoView();
            }
        }, 30);
    };

    const getMsgPreview = (d: any): string => {
        const text = d.message_text?.trim() || '';
        if (isEncryptedMessage(text)) return lang === 'en' ? 'Message' : 'Сообщение';
        if (text.startsWith('__gif__')) return lang === 'en' ? '🎞 GIF' : '🎞 GIF';
        if (text.startsWith('__sticker__')) return lang === 'en' ? '🎭 Sticker' : '🎭 Стикер';
        if (text.startsWith('__poll__:')) { const pid = parseInt(text.slice(9)); return `📊 ${pollTitles[pid] || (lang === 'en' ? 'Poll' : 'Опрос')}`; }
        if (text.startsWith('__call_ended__')) return lang === 'en' ? '📞 Call ended' : '📞 Звонок завершён';
        if (text.startsWith('__geo__:')) { try { const g = JSON.parse(text.slice(8)); return `📍 ${g.name || (lang === 'en' ? 'Location' : 'Геопозиция')}`; } catch { return `📍 ${lang === 'en' ? 'Location' : 'Геопозиция'}`; } }
        if (text.startsWith('__contact__:')) { try { const c = JSON.parse(text.slice(12)); return `👤 ${c.username}`; } catch { return '👤 Контакт'; } }
        if (text.startsWith(PLAYLIST_MSG_PREFIX)) { try { const p = JSON.parse(text.slice(PLAYLIST_MSG_PREFIX.length)); return `🎵 ${p.name || (lang === 'en' ? 'Playlist' : 'Плейлист')}`; } catch { return `🎵 ${lang === 'en' ? 'Playlist' : 'Плейлист'}`; } }
        const files: any[] = d.files?.length ? d.files : d.file_path ? [{ filename: d.filename || t('File') }] : [];
        if (!files.length) return text || '...';
        if (files.length === 1) return text ? `📎 ${text}` : `📎 ${files[0].filename || t('File')}`;
        return text ? `📎 ${text}` : lang === 'en' ? `📎 ${files.length} files` : `📎 ${files.length} файла(-ов)`;
    };


    const isImageFile = (filename: string | null | undefined, filePath: string | null | undefined): boolean => {
        const name = filename || filePath?.split('/').pop() || '';
        return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name);
    };

    const renderSidebarSub = (
        typingText: string | undefined,
        text: string | null | undefined,
        file: string | null | undefined,
        filename: string | null | undefined,
        fallback: string,
        prefix?: string,
        userId?: number
    ) => {
        const subColor = isOled ? '#7c7caa' : dm ? '#5a5a8a' : '#9ca3af';
        const subStyle: React.CSSProperties = { fontSize: 13, color: subColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 };
        if (typingText) return <span style={{ ...subStyle, color: '#6366f1', fontStyle: 'italic' }}>{typingText}</span>;
        if (file && !text?.trim()) {
            const fname = filename || file.split('/').pop() || '';
            const isGifFile = /\.gif$/i.test(fname);
            const isImg = !isGifFile && isImageFile(filename, file);
            const isVideo = /\.(mp4|webm|mov)$/i.test(fname);
            const isAudio = /\.(ogg|mp3|wav|weba|opus|m4a|aac|flac)$/i.test(fname);
            const rawLabel = filename || file.split('/').pop() || (lang === 'en' ? 'File' : 'Файл');
            const fileLabel = isAudio && /^voice_/i.test(rawLabel) ? t('Voice message') : rawLabel;
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', minWidth: 0 }}>
                    {prefix && <span style={{ color: subColor, fontSize: 13, flexShrink: 0 }}>{prefix.trimEnd()}</span>}
                    {(() => {
                        const ic = isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1';
                        const sp = (svg: React.ReactNode) => <span style={{ flexShrink: 0, display: 'inline-flex', color: ic }}>{svg}</span>;
                        if (isGifFile) return sp(<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>);
                        if (isImg) return <img src={config.fileUrl(file) ?? undefined} alt="" style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />;
                        if (isVideo) return sp(<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>);
                        if (isAudio) return sp(<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>);
                        return sp(<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>);
                    })()}
                    <span style={subStyle}>{isGifFile ? 'GIF' : fileLabel}</span>
                </div>
            );
        }
        // File + text (caption): show media icon before the caption text
        if (file && text?.trim()) {
            const fname = filename || file.split('/').pop() || '';
            const isGifFile = /\.gif$/i.test(fname);
            const isImg = !isGifFile && isImageFile(filename, file);
            const isVideo = /\.(mp4|webm|mov)$/i.test(fname);
            const isAudio = /\.(ogg|mp3|wav|weba|opus|m4a|aac|flac)$/i.test(fname);
            const ic = isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1';
            const iconEl = (() => {
                const sp = (svg: React.ReactNode) => <span style={{ flexShrink: 0, display: 'inline-flex', color: ic, marginRight: 3 }}>{svg}</span>;
                if (isGifFile) return sp(<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>);
                if (isImg) return <img src={config.fileUrl(file) ?? undefined} alt="" style={{ width: 18, height: 18, objectFit: 'cover', borderRadius: 3, flexShrink: 0, marginRight: 3 }} />;
                if (isVideo) return sp(<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>);
                if (isAudio) return sp(<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>);
                return null;
            })();
            if (iconEl) return (
                <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0 }}>
                    {prefix && <span style={{ color: subColor, fontSize: 13, flexShrink: 0 }}>{prefix.trimEnd()}</span>}
                    {iconEl}
                    <span style={subStyle}>{text.trim()}</span>
                </div>
            );
        }

        const rawPreview = text?.trim() || fallback;
        let preview: string;
        if (isEncryptedMessage(rawPreview)) {
            if (userId && decryptedPreviews[userId]) preview = decryptedPreviews[userId];
            else return <span style={subStyle}>{prefix ? `${prefix}${fallback}` : fallback}</span>;
        } else if (rawPreview.startsWith('__gif__')) preview = '🎞 GIF';
        else if (rawPreview.startsWith('__sticker__')) preview = `🎭 ${t('Stickers')}`;
        else if (rawPreview.startsWith('__poll__:')) { const pid = parseInt(rawPreview.slice(9)); preview = `📊 ${pollTitles[pid] || (lang === 'en' ? 'Poll' : 'Опрос')}`; }
        else if (rawPreview.startsWith('__call_ended__')) preview = `📞 ${lang === 'en' ? 'Call ended' : 'Звонок завершён'}`;
        else if (rawPreview.startsWith('__geo__:')) { try { const g = JSON.parse(rawPreview.slice(8)); preview = `📍 ${g.name || (lang === 'en' ? 'Location' : 'Геопозиция')}`; } catch { preview = `📍 ${lang === 'en' ? 'Location' : 'Геопозиция'}`; } }
        else if (rawPreview.startsWith('__contact__:')) { try { const c = JSON.parse(rawPreview.slice(12)); preview = `👤 ${c.username}`; } catch { preview = '👤 Контакт'; } }
        else if (rawPreview.startsWith(PLAYLIST_MSG_PREFIX)) {
            try { const d = JSON.parse(rawPreview.slice(PLAYLIST_MSG_PREFIX.length)); preview = `🎵 ${d.name || (lang === 'en' ? 'Playlist' : 'Плейлист')}`; }
            catch { preview = `🎵 ${lang === 'en' ? 'Playlist' : 'Плейлист'}`; }
        } else if (rawPreview.startsWith('↪️ ')) {
            const nl = rawPreview.indexOf('\n');
            const body = nl !== -1 ? rawPreview.slice(nl + 1).trim() : '';
            const fwdLabel = (() => {
                if (!body) return lang === 'en' ? 'Forwarded message' : 'Пересланное сообщение';
                if (body.startsWith('__gif__')) return '🎞 GIF';
                if (body.startsWith('__sticker__')) return `🎭 ${t('Stickers')}`;
                if (body.startsWith('__poll__:')) { const pid = parseInt(body.slice(9)); return `📊 ${pollTitles[pid] || (lang === 'en' ? 'Poll' : 'Опрос')}`; }
                if (body.startsWith('__geo__:')) { try { const g = JSON.parse(body.slice(8)); return `📍 ${g.name || (lang === 'en' ? 'Location' : 'Геопозиция')}`; } catch { return `📍 ${lang === 'en' ? 'Location' : 'Геопозиция'}`; } }
                if (body.startsWith('__contact__:')) { try { const c = JSON.parse(body.slice(12)); return `👤 ${c.username}`; } catch { return '👤 Контакт'; } }
                if (body.startsWith('__call_ended__')) return `📞 ${lang === 'en' ? 'Call ended' : 'Звонок завершён'}`;
                return body;
            })();
            const ic = isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1';
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden', minWidth: 0, flex: 1 }}>
                    {prefix && <span style={{ color: subColor, fontSize: 13, flexShrink: 0 }}>{prefix.trimEnd()}</span>}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ic} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <polyline points="15 10 20 15 15 20"/>
                        <path d="M4 4v7a4 4 0 0 0 4 4h12"/>
                    </svg>
                    <span style={{ ...subStyle, color: ic, fontWeight: 500, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{fwdLabel}</span>
                </div>
            );
        } else preview = rawPreview;
        return <span style={subStyle}>{prefix ? `${prefix}${preview}` : preview}</span>;
    };

    const formatSidebarTime = (timestamp: string | null | undefined): string => {
        if (!timestamp) return '';
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);
        const locale = lang === 'en' ? 'en-US' : 'ru';
        if (diffDays === 0) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        if (diffDays === 1) return lang === 'en' ? 'yesterday' : 'вчера';
        if (diffDays < 7) return d.toLocaleDateString(locale, { weekday: 'short' });
        return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    };

    // Returns true if the hex color is "dark" (luminance < 0.35)
    const isBgDark = (hex: string): boolean => {
        try {
            const c = hex.replace('#', '');
            const r = parseInt(c.slice(0, 2), 16) / 255;
            const g = parseInt(c.slice(2, 4), 16) / 255;
            const b = parseInt(c.slice(4, 6), 16) / 255;
            // Relative luminance (WCAG)
            const lum = (x: number) => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            return 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b) < 0.35;
        } catch { return false; }
    };

    const dismissToast = (id: number) => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 220);
    };

    // Toast swipe state (mobile)
    const toastSwipeRef = useRef<{ id: number; startX: number; startY: number } | null>(null);
    const [toastSwipeOffsets, setToastSwipeOffsets] = useState<Record<number, number>>({});

    const handleToastTouchStart = (e: React.TouchEvent, id: number) => {
        toastSwipeRef.current = { id, startX: e.touches[0].clientX, startY: e.touches[0].clientY };
    };
    const handleToastTouchMove = (e: React.TouchEvent, id: number) => {
        if (!toastSwipeRef.current || toastSwipeRef.current.id !== id) return;
        const dx = e.touches[0].clientX - toastSwipeRef.current.startX;
        const dy = e.touches[0].clientY - toastSwipeRef.current.startY;
        // Mobile: vertical swipe up to dismiss; Desktop: horizontal swipe
        const delta = isMobile ? Math.min(dy, 0) : dx; // only up on mobile
        if (Math.abs(delta) > 5) {
            setToastSwipeOffsets(prev => ({ ...prev, [id]: delta }));
        }
    };
    const handleToastTouchEnd = (id: number) => {
        const offset = toastSwipeOffsets[id] || 0;
        if (Math.abs(offset) > (isMobile ? 60 : 80)) {
            dismissToast(id);
        }
        setToastSwipeOffsets(prev => { const n = { ...prev }; delete n[id]; return n; });
        toastSwipeRef.current = null;
    };

    const notifAudioCtxRef = useRef<AudioContext | null>(null);
    const playNotificationSound = () => {
        try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            if (!notifAudioCtxRef.current || notifAudioCtxRef.current.state === 'closed') {
                notifAudioCtxRef.current = new AudioCtx();
            }
            const ctx = notifAudioCtxRef.current;
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.22, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.35);
        } catch {}
    };

    const showInAppToast = (toast: Omit<ToastItem, 'id' | 'exiting'>) => {
        const id = ++toastIdRef.current;
        setToasts(prev => {
            // Replace existing toast from the same sender instead of stacking
            const filtered = prev.filter(t =>
                !(t.chatType === toast.chatType && t.chatId === toast.chatId && t.senderId === toast.senderId)
            );
            return [...filtered.slice(-3), { ...toast, id }];
        });
        playNotificationSound();
        setTimeout(() => dismissToast(id), 5000);
    };
    // Keep ref current so WebSocket handler (stale closure) always fires the latest toast
    showInAppToastRef.current = showInAppToast;

    const replyFromToast = (toast: ToastItem, text: string) => {
        if (!text.trim()) return;
        if (toast.chatType === 'private' && toast.senderId != null) {
            const sender = usersRef.current.find((u: User) => u.id === toast.senderId);
            if (sender && (sender as any).is_deleted) return;
            if (toast.senderId && blockedUserIds.has(toast.senderId)) return;
            wsService.sendMessage(toast.senderId, text.trim());
        } else if (toast.chatType === 'group' && toast.groupId != null) {
            wsService.sendGroupMessage(toast.groupId, text.trim());
        }
        setToastReplies(prev => { const n = { ...prev }; delete n[toast.id]; return n; });
        dismissToast(toast.id);
    };

    const formatTime = (timestamp: string) => {
        if (!timestamp) return '';
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        } catch { return ''; }
    };

    const getDateLabel = (timestamp: string): string => {
        if (!timestamp) return '';
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return '';
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            const isSameDay = (a: Date, b: Date) =>
                a.getFullYear() === b.getFullYear() &&
                a.getMonth() === b.getMonth() &&
                a.getDate() === b.getDate();
            if (isSameDay(date, today)) return lang === 'en' ? 'Today' : 'Сегодня';
            if (isSameDay(date, yesterday)) return lang === 'en' ? 'Yesterday' : 'Вчера';
            return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        } catch { return ''; }
    };

    const getMsgDay = (timestamp: string): string => {
        if (!timestamp) return '';
        try {
            const d = new Date(timestamp);
            return isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        } catch { return ''; }
    };

    // Check if current user is group admin
    const activeGroup = activeChat?.type === 'group'
        ? (groups.find(g => g.id === activeChat.id) ?? (previewGroup?.id === activeChat.id ? previewGroup : null))
        : null;
    // O(1) user lookup map — rebuilt only when users list changes
    const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

    // Current user as User object (for Favorites profile)
    const currentUserObj = useMemo<any>(() => ({
        id: currentUserId, username: currentUsername, email: '', created_at: '',
        avatar: currentUserAvatar || null, avatar_color: '#f97316', tag: currentUserTag || '',
        status: currentUserStatus || '', is_online: true,
    }), [currentUserId, currentUsername, currentUserAvatar, currentUserTag, currentUserStatus]);

    const isGroupAdmin = activeGroup ? (activeGroup.my_role === 'admin' || activeGroup.creator_id === currentUserId) : false;
    const isChannelChat = !!(activeGroup?.is_channel);
    const isChannelMember = isChannelChat && groups.some(g => g.id === activeChat?.id);
    const isDeletedUser = activeChat?.type === 'private' && (() => {
        const u = usersById.get(activeChat.id) as any;
        return !!(u?.is_deleted) || u?.username === 'Удалённый пользователь';
    })();
    const isBlockedByMeInput = !!(activeChat?.type === 'private' && activeChat.id !== currentUserId && blockedUserIds.has(activeChat.id));
    const isBlockedByThemInput = !!(activeChat?.type === 'private' && usersById.get(activeChat.id)?.last_seen === 'blocked_you');

    // === Рендер ===

    const dm = theme.darkMode;
    const isOled = dm && theme.chatBg === '#000000';

    // OLED-aware color palette — memoized so it only rebuilds when theme changes
    const C = useMemo(() => ({
        bg0:  isOled ? '#000000' : '#0f0f1a',
        bg1:  isOled ? '#000000' : '#13131f',
        bg2:  isOled ? '#050508' : '#1a1a2e',
        bg3:  isOled ? '#08080f' : '#1e1e2e',
        bg4:  isOled ? '#0a0a14' : '#1e1e30',
        bg5:  isOled ? '#0d0d1a' : '#252540',
        bg6:  isOled ? '#0d0d12' : '#2a2a3a',
        bdr1: isOled ? 'rgba(167,139,250,0.12)' : '#2a2a3d',
        bdr2: isOled ? 'rgba(167,139,250,0.18)' : '#3a3a5e',
        bdr3: isOled ? 'rgba(167,139,250,0.14)' : '#3a3a55',
    }), [isOled]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const darkStyles = useMemo(() => ({
        sidebar: { ...styles.sidebar, backgroundColor: dm ? C.bg1 : '#f7f8fc', boxShadow: isOled ? 'none' : dm ? '2px 0 12px rgba(99,102,241,0.05)' : '2px 0 12px rgba(99,102,241,0.05)', borderRight: 'none' },
        chatArea: { ...styles.chatArea, backgroundColor: theme.chatBg || (dm ? C.bg0 : '#f2f4f8') },
        chatHeader: { ...styles.chatHeader, borderBottom: 'none', gap: isMobile ? 6 : 10, background: dm ? (isOled ? 'linear-gradient(90deg, #1a0038 0%, #000000 320px)' : `linear-gradient(135deg, ${C.bg1} 0%, #1a1830 100%)`) : '#f7f8fc', backgroundAttachment: (isOled && !isMobile) ? 'fixed' : undefined },
        inputArea: { ...styles.inputArea, backgroundColor: dm ? C.bg1 : '#f7f8fc', borderTop: 'none', boxShadow: isMobile ? 'none' : (isOled ? '0 -4px 24px rgba(139,92,246,0.06)' : dm ? '0 -2px 12px rgba(0,0,0,0.18)' : '0 -2px 10px rgba(99,102,241,0.07)'), padding: '0 12px', minHeight: 60, gap: 8 },
        input: { ...styles.input, backgroundColor: 'transparent', border: 'none', boxShadow: 'none', padding: '8px 4px', color: dm ? '#e2e8f0' : 'inherit', flex: '1 1 0', minWidth: 0, fontSize: 14 },
        inputPill: { display: 'flex' as const, alignItems: 'center' as const, gap: 0, flex: 1, minWidth: 0, background: isOled ? '#08080f' : dm ? C.bg4 : '#eef0f8', borderRadius: 24, border: 'none', padding: '4px 4px 4px 12px' },
        pillBtn: { background: 'none' as const, border: 'none' as const, cursor: 'pointer' as const, padding: '5px 6px', borderRadius: 8, color: dm ? (isOled ? '#6b5fa0' : '#5a5a7a') : '#b0b0c8', lineHeight: 0, flexShrink: 0, alignSelf: 'center' as const, display: 'flex' as const, alignItems: 'center' as const, justifyContent: 'center' as const, transition: 'color 0.15s' as const },
        sendBtn2: { width: 40, height: 40, borderRadius: 20, background: isOled ? 'linear-gradient(135deg,#5b21b6,#7c3aed)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex' as const, alignItems: 'center' as const, justifyContent: 'center' as const, flexShrink: 0, alignSelf: 'center' as const, boxShadow: isOled ? '0 2px 12px rgba(124,58,237,0.45)' : '0 2px 10px rgba(99,102,241,0.4)', transition: 'all 0.15s' as const },
        chatName: { ...styles.chatName, color: dm ? '#e2e8f0' : '#1e1b4b' },
        chatItem: { ...styles.chatItem },
        sectionTitle: { ...styles.sectionTitle, color: dm ? (isOled ? 'rgba(167,139,250,0.45)' : '#4c4c7a') : '#a5b4fc' },
        headerText: { color: dm ? '#e2e8f0' : 'inherit' },
        profileCard: { ...styles.profileCard, backgroundColor: dm ? (isOled ? '#000000' : '#161625') : '#f0f1f8', borderTop: 'none', padding: '0 16px', boxShadow: isOled ? '0 -4px 20px rgba(139,92,246,0.07)' : dm ? '0 -2px 12px rgba(0,0,0,0.18)' : '0 -2px 10px rgba(99,102,241,0.07)' },
        profileName: { ...styles.profileName, color: dm ? '#e2e8f0' : '#1e1b4b' },
        sidebarScroll: { ...styles.sidebarScroll, backgroundColor: dm ? C.bg1 : '#f7f8fc' },
        noChat: { ...styles.noChat, color: dm ? C.bdr3 : '#c4b5fd' },
        activeChatItem: {
            background: isOled
                ? 'radial-gradient(ellipse 100% 100% at 0% 50%, rgba(167,139,250,0.22) 0%, rgba(139,92,246,0.07) 55%, transparent 80%)'
                : dm
                    ? 'radial-gradient(ellipse 100% 100% at 0% 50%, rgba(99,102,241,0.26) 0%, rgba(99,102,241,0.08) 55%, transparent 80%)'
                    : 'radial-gradient(ellipse 100% 100% at 0% 50%, rgba(99,102,241,0.28) 0%, rgba(139,92,246,0.12) 55%, transparent 85%)',
        },
        iconBtn: { ...styles.iconBtn, background: isOled ? 'rgba(167,139,250,0.07)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)', border: 'none', color: dm ? (isOled ? '#c4b5fd' : '#a5b4fc') : '#6366f1', borderRadius: isMobile ? 10 : 12, padding: '0', width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.12), 0 2px 10px rgba(139,92,246,0.1)' : dm ? '0 0 0 1px rgba(99,102,241,0.18)' : '0 0 0 1px rgba(99,102,241,0.14)' },
        fileBtn: { ...styles.fileBtn, backgroundColor: dm ? (isOled ? '#0a0a12' : C.bg4) : '#eef0f8', border: 'none', boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.12)' : dm ? '0 0 0 1.5px rgba(99,102,241,0.2)' : '0 0 0 1.5px rgba(99,102,241,0.15)', color: dm ? (isOled ? '#a78bfa' : '#7c7caa') : '#6366f1' },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [isOled, dm, isMobile, theme, C]);

    const archivedList = useMemo(() => {
        const archGroups = groups.filter(g => archivedChats.has(`group-${g.id}`));
        const archUsers = users.filter(u => archivedChats.has(`private-${u.id}`));
        return [
            ...archGroups.map(g => ({ type: 'group' as const, item: g })),
            ...archUsers.map(u => ({ type: 'user' as const, item: u })),
        ].sort((a, b) => {
            const ta = (a.item as any).last_msg_time || '';
            const tb = (b.item as any).last_msg_time || '';
            return tb.localeCompare(ta);
        });
    }, [groups, users, archivedChats]);

    const folderUnreadMap = useMemo(() => {
        const map: Record<string, number> = {};
        for (const f of folders) {
            map[f.id] = f.chats.reduce((sum, c) => sum + (unreadCounts[`${c.chat_type}-${c.chat_id}`] || 0), 0);
        }
        return map;
    }, [folders, unreadCounts]);

    // Memoized sidebar lists — recalculate only when data actually changes
    const sidebarFolder = useMemo(
        () => activeFolder !== null ? folders.find(f => f.id === activeFolder) : null,
        [activeFolder, folders]
    );
    const sidebarFolderGroupIds = useMemo(
        () => sidebarFolder ? new Set(sidebarFolder.chats.filter(c => c.chat_type === 'group').map(c => c.chat_id)) : null,
        [sidebarFolder]
    );
    const sidebarFolderUserIds = useMemo(
        () => sidebarFolder ? new Set(sidebarFolder.chats.filter(c => c.chat_type === 'private').map(c => c.chat_id)) : null,
        [sidebarFolder]
    );
    const sidebarVisibleGroups = useMemo(
        () => (sidebarFolderGroupIds ? groups.filter(g => sidebarFolderGroupIds.has(g.id)) : groups)
            .filter(g => !archivedChats.has(`group-${g.id}`) && !hiddenChats.has(`group-${g.id}`)),
        [groups, sidebarFolderGroupIds, archivedChats, hiddenChats]
    );
    const sidebarVisibleUsers = useMemo(
        () => (sidebarFolderUserIds ? users.filter(u => sidebarFolderUserIds.has(u.id)) : users)
            .filter(u => !archivedChats.has(`private-${u.id}`) && !hiddenChats.has(`private-${u.id}`)),
        [users, sidebarFolderUserIds, archivedChats, hiddenChats]
    );
    const favKey = `private-${currentUserId}`;
    const sidebarSorted = useMemo(() => {
        const showFav = !archivedChats.has(favKey) && !hiddenChats.has(favKey)
            && (!sidebarFolderUserIds || sidebarFolderUserIds.has(currentUserId));
        type CE = { kind: 'group'; data: Group } | { kind: 'user'; data: User } | { kind: 'favorites' };
        const entries: CE[] = [
            ...(showFav ? [{ kind: 'favorites' as const }] : []),
            ...sidebarVisibleGroups.map(g => ({ kind: 'group' as const, data: g })),
            ...sidebarVisibleUsers.map(u => ({ kind: 'user' as const, data: u })),
        ];
        const getKey = (e: CE) => e.kind === 'favorites' ? favKey : e.kind === 'group' ? `group-${(e.data as Group).id}` : `private-${(e.data as User).id}`;
        const getTime = (e: CE) => {
            if (e.kind === 'favorites') return favoritesLastMsg?.time ? new Date(favoritesLastMsg.time).getTime() : 0;
            const t = e.kind === 'group' ? (e.data as Group).last_msg_time : (e.data as User).last_msg_time;
            return t ? new Date(t).getTime() : 0;
        };
        return [...entries].sort((a, b) => {
            const pa = pinnedChats.has(getKey(a)) ? 1 : 0;
            const pb = pinnedChats.has(getKey(b)) ? 1 : 0;
            if (pa !== pb) return pb - pa;
            return getTime(b) - getTime(a);
        });
    }, [sidebarVisibleGroups, sidebarVisibleUsers, archivedChats, hiddenChats, pinnedChats, favoritesLastMsg, sidebarFolderUserIds, currentUserId, favKey]);

    return (
        <div className={isMobile ? 'mobile-root-container' : undefined} style={{ ...styles.container, backgroundColor: dm ? C.bg0 : '#eef0f5', ...(isMobile ? { position: 'relative' as const, overflow: 'hidden' } : {}) }}>
            {/* Persistent audio element */}
            <audio
                ref={globalAudioRef}
                preload="auto"
                onPlay={() => setGlobalPlaying(true)}
                onPause={() => setGlobalPlaying(false)}
                onEnded={() => { setNowPlaying(null); setGlobalPlaying(false); setGlobalCurrentTime(0); setGlobalDuration(0); resumeMiniIfNeeded(); }}
                onLoadedMetadata={e => {
                    const a = e.target as HTMLAudioElement;
                    if (isFinite(a.duration) && a.duration > 0) {
                        setGlobalDuration(a.duration);
                        if (a.src) knownAudioDurations.current.set(a.src, a.duration);
                    }
                }}
                onDurationChange={e => {
                    const a = e.target as HTMLAudioElement;
                    if (isFinite(a.duration) && a.duration > 0) { setGlobalDuration(a.duration); if (a.src) knownAudioDurations.current.set(a.src, a.duration); }
                }}
                onTimeUpdate={e => {
                    const a = e.target as HTMLAudioElement;
                    setGlobalCurrentTime(a.currentTime);
                    if (isFinite(a.duration) && a.duration > 0) {
                        setGlobalDuration(a.duration);
                        if (a.src) knownAudioDurations.current.set(a.src, a.duration);
                    } else if (a.src) {
                        // Duration is Infinity (webm MediaRecorder) — poll cache for resolved duration
                        const cached = knownAudioDurations.current.get(a.src);
                        if (cached && cached > 0) setGlobalDuration(cached);
                    }
                }}
            />

            {/* Drag-to-resize handle */}
            {!isMobile && !sidebarHidden && (
            <div
                style={{ position: 'absolute', left: sidebarMinimal ? 52 : sidebarCompact ? 64 : sidebarWidth, top: 0, bottom: 0, width: 4, zIndex: 30, cursor: 'col-resize', userSelect: 'none' as const }}
                onMouseDown={e => {
                    e.preventDefault();
                    sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarCompact ? 64 : sidebarWidth };
                    sidebarIsDragging.current = true;
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                    const onMove = (me: MouseEvent) => {
                        if (!sidebarDragRef.current || !sidebarIsDragging.current) return;
                        const newW = Math.max(240, Math.min(520, sidebarDragRef.current.startWidth + (me.clientX - sidebarDragRef.current.startX)));
                        if (newW < 80) { setSidebarState('hidden'); return; }
                        if (newW < 130) { setSidebarState('minimal'); return; }
                        if (newW < 180) { setSidebarState('compact'); return; }
                        setSidebarState('full');
                        setSidebarWidth(newW);
                    };
                    const onUp = () => {
                        sidebarIsDragging.current = false;
                        sidebarDragRef.current = null;
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                }}
            >
                {/* Visual indicator on hover */}
                <div style={{ position: 'absolute', left: 1, top: '50%', transform: 'translateY(-50%)', width: 2, height: 40, borderRadius: 2, background: isOled ? 'rgba(167,139,250,0.3)' : dm ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.2)', opacity: 0, transition: 'opacity 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                />
            </div>
            )}

            {/* Боковая панель */}
            <div className={isOled ? 'oled-sidebar' : undefined} style={{
                ...darkStyles.sidebar,
                ...(isMobile ? {
                    position: 'absolute' as const,
                    top: 0, left: 0, bottom: 0,
                    width: '100%',
                    zIndex: 20,
                    transform: activeChat ? 'translateX(-100%)' : 'translateX(0)',
                    transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
                    overflow: 'hidden',
                    visibility: 'visible',
                    willChange: 'transform',
                } : {
                    width: sidebarHidden ? 0 : sidebarMinimal ? 52 : sidebarCompact ? 64 : sidebarWidth,
                    minWidth: 0,
                    transition: sidebarIsDragging.current ? 'none' : 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
                    overflow: 'hidden',
                    visibility: sidebarHidden ? 'hidden' : 'visible',
                }),
            }}>
                {showArchive ? (
                    <div style={{
                        ...styles.sidebarHeader,
                        background: !dm ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' : (isOled ? 'linear-gradient(90deg, #1a0038 0%, #000000 320px)' : 'linear-gradient(135deg, #1e1a3d 0%, #2d2060 100%)'),
                        backgroundAttachment: (isOled && !isMobile) ? 'fixed' : undefined,
                        justifyContent: sidebarCompact ? 'center' : undefined,
                        padding: sidebarCompact ? '16px 0' : '16px',
                    }}>
                        <button
                            onClick={() => setShowArchive(false)}
                            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 10, color: 'white', cursor: 'pointer', padding: '6px 10px', fontWeight: 700, flexShrink: 0, display: 'flex', alignItems: 'center' }}
                        ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
                        {!sidebarCompact && (
                            <div style={{ flex: 1, lineHeight: 1.1, paddingLeft: 8 }}>
                                <span style={{ fontWeight: 800, fontSize: 18, color: 'white' }}>{lang === 'en' ? 'Archive' : 'Архив'}</span>
                            </div>
                        )}
                    </div>
                ) : sidebarMinimal ? null : (
                <div style={{
                    ...styles.sidebarHeader,
                    background: !dm ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' : (isOled ? 'linear-gradient(90deg, #1a0038 0%, #000000 320px)' : 'linear-gradient(135deg, #1e1a3d 0%, #2d2060 100%)'),
                    backgroundAttachment: (isOled && !isMobile) ? 'fixed' : undefined,
                    justifyContent: sidebarCompact ? 'center' : undefined,
                    padding: sidebarCompact ? '16px 0' : '16px',
                }}>
                    <img src={dm ? '/logo-dark.png' : '/logo-light.png'} alt="Aurora" style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, objectFit: 'cover' }} />
                    {!sidebarCompact && <>
                        <div style={{ flex: 1, lineHeight: 1.1 }}>
                            {wsConnState !== 'connected' ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${isOled ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.3)'}`, borderTopColor: isOled ? '#a78bfa' : 'white', animation: 'spin 0.9s linear infinite', flexShrink: 0 }} />
                                    <span style={{ fontWeight: 600, fontSize: 14, color: isOled ? '#c4b5fd' : 'rgba(255,255,255,0.85)' }}>
                                        {wsConnState === 'waiting' ? (lang === 'en' ? 'Waiting for network...' : 'Ожидание сети...') : (lang === 'en' ? 'Connecting...' : 'Подключение...')}
                                    </span>
                                </div>
                            ) : (
                                <span style={isOled
                                    ? { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', color: '#d8b4fe' }
                                    : dm
                                        ? { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', background: 'linear-gradient(90deg, #e0c4ff 0%, #a78bfa 55%, #818cf8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }
                                        : { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', color: 'white' }
                                }>Aurora</span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button
                                onClick={() => setShowMediaPlayer(v => !v)}
                                style={{ padding: '6px 7px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, backgroundColor: miniTrack ? (isOled ? 'rgba(167,139,250,0.25)' : (dm ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.3)')) : (isOled ? 'rgba(167,139,250,0.1)' : (dm ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.18)')), color: dm ? '#c4b5fd' : 'white', border: isOled ? '1px solid rgba(167,139,250,0.3)' : (dm ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.3)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 4, boxShadow: isOled ? '0 0 8px rgba(167,139,250,0.08)' : 'none' }}
                                title={lang === 'en' ? 'Media Player' : 'Медиаплеер'}
                            ><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></button>
                            <button
                                onClick={() => setShowHelp(true)}
                                style={{ padding: '6px 7px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, backgroundColor: isOled ? 'rgba(167,139,250,0.1)' : (dm ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.18)'), color: dm ? '#c4b5fd' : 'white', border: isOled ? '1px solid rgba(167,139,250,0.3)' : (dm ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.3)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 4, boxShadow: isOled ? '0 0 8px rgba(167,139,250,0.08)' : 'none' }}
                                title={lang === 'en' ? "What's new" : 'Что нового'}
                            ><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>
                        <div style={{ position: 'relative' }}>
                            <button
                                onClick={() => setShowCreateDropdown(v => !v)}
                                style={{ padding: '6px 7px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, backgroundColor: isOled ? 'rgba(167,139,250,0.1)' : (dm ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.18)'), color: dm ? '#c4b5fd' : 'white', border: isOled ? '1px solid rgba(167,139,250,0.3)' : (dm ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.3)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 4, boxShadow: isOled ? '0 0 8px rgba(167,139,250,0.08)' : 'none' }}
                                title={lang === 'en' ? 'New chat' : 'Новый чат'}
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            </button>
                            {showCreateDropdown && (
                                <>
                                <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setShowCreateDropdown(false)} />
                                <div
                                    className="floating-enter"
                                    style={{ position: 'absolute', top: '110%', right: 0, zIndex: 300, background: isOled ? '#080810' : (dm ? C.bg2 : 'white'), borderRadius: 14, boxShadow: isOled ? '0 0 30px rgba(124,58,237,0.3), 0 16px 40px rgba(0,0,0,0.9)' : dm ? '0 0 24px rgba(99,102,241,0.2), 0 12px 36px rgba(0,0,0,0.5)' : '0 0 20px rgba(99,102,241,0.1), 0 8px 28px rgba(0,0,0,0.14)', minWidth: 180, overflow: 'hidden', padding: '4px 0' }}
                                >
                                    {[
                                        { svg: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, label: t('Create group'), action: () => { setShowCreateDropdown(false); setShowCreateGroup(true); } },
                                        { svg: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 8.01c0-2.18-2.24-3.93-5-3.93-1.33 0-2.54.43-3.43 1.13C12.68 4.51 11.47 4.08 10.14 4.08c-2.76 0-5 1.75-5 3.93 0 .69.23 1.34.62 1.9L3 16.51l3.5-1.17c.85.52 1.9.83 3.03.83 1.33 0 2.54-.43 3.43-1.13.89.7 2.1 1.13 3.43 1.13 1.13 0 2.18-.31 3.03-.83L23 16.51l-2.76-6.6c.39-.56.62-1.21.62-1.9z"/></svg>, label: t('Create channel'), action: () => { setShowCreateDropdown(false); setShowCreateChannel(true); } },
                                    ].map(item => (
                                        <div
                                            key={item.label}
                                            onClick={item.action}
                                            style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: dm ? '#e0e0f0' : '#1e1b4b', fontWeight: 500 }}
                                            onMouseEnter={e => (e.currentTarget.style.background = dm ? 'rgba(99,102,241,0.12)' : '#f5f3ff')}
                                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        >
                                            <span style={{ color: isOled ? '#a78bfa' : (dm ? '#a5b4fc' : '#6366f1') }}>{item.svg}</span>
                                            {item.label}
                                        </div>
                                    ))}
                                </div>
                                </>
                            )}
                        </div>
                        </div>
                    </>}
                </div>
                )}

                {/* Sidebar search */}
                {!sidebarCompact && !sidebarMinimal && !showArchive && <div style={{ padding: '8px 10px', borderBottom: 'none', position: 'relative' }}>
                    <input
                        type="text"
                        className="sidebar-search-input"
                        placeholder={`🔍 ${t('Search users...')}`}
                        value={sidebarSearchQuery}
                        onFocus={() => {
                            setSidebarSearchFocused(true);
                            if (!sidebarSearchQuery) {
                                api.getRecentUsers(token).then(r => { if (r.users) setRecentUsers(r.users); }).catch(() => {});
                            }
                        }}
                        onBlur={() => setTimeout(() => setSidebarSearchFocused(false), 150)}
                        onChange={e => {
                            const q = e.target.value;
                            setSidebarSearchQuery(q);
                            if (sidebarSearchTimerRef.current) clearTimeout(sidebarSearchTimerRef.current);
                            if (!q.trim()) { setSidebarSearchResults([]); setSidebarChannelResults([]); setSidebarMsgResults([]); return; }
                            sidebarSearchTimerRef.current = setTimeout(async () => {
                                setSidebarSearchLoading(true);
                                try {
                                    const [userRes, chanRes, msgRes] = await Promise.all([
                                        api.searchUsers(token, q.trim()),
                                        api.searchChannels(token, q.trim()),
                                        q.trim().length >= 2
                                            ? fetch(`${config.API_URL}/search/global?token=${token}&query=${encodeURIComponent(q.trim())}&limit=5`).then(r => r.json())
                                            : Promise.resolve({ results: [] }),
                                    ]);
                                    setSidebarSearchResults(userRes.users || []);
                                    setSidebarChannelResults(chanRes.channels || []);
                                    setSidebarMsgResults(msgRes.results || []);
                                } catch { setSidebarSearchResults([]); setSidebarChannelResults([]); setSidebarMsgResults([]); }
                                finally { setSidebarSearchLoading(false); }
                            }, 300);
                        }}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '7px 12px', borderRadius: 10, border: 'none', background: !dm ? '#f5f3ff' : (isOled ? C.bg4 : '#1e1e3a'), color: dm ? '#e0e0f0' : '#1e1b4b', fontSize: 13, outline: 'none', boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.14), 0 2px 10px rgba(139,92,246,0.08)' : dm ? '0 0 0 1px rgba(99,102,241,0.2)' : '0 0 0 1px rgba(99,102,241,0.2)', transition: 'box-shadow 0.15s' }}
                    />
                    {sidebarSearchFocused && (sidebarLocalMatches.users.length > 0 || sidebarLocalMatches.groups.length > 0 || sidebarSearchResults.length > 0 || sidebarChannelResults.length > 0 || sidebarMsgResults.length > 0 || sidebarSearchLoading || (!sidebarSearchQuery && (searchHistory.length > 0 || recentUsers.length > 0))) && (
                        <div className="sidebar-search-dropdown" style={{ position: 'absolute', top: '100%', left: 10, right: 10, zIndex: 200, background: dm ? C.bg2 : 'white', border: `1px solid ${dm ? C.bdr2 : '#ede9fe'}`, borderRadius: 12, boxShadow: isOled ? '0 8px 32px rgba(0,0,0,0.8), 0 0 0 1px rgba(167,139,250,0.1)' : '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden', maxHeight: 420, overflowY: 'auto' }}>
                            {sidebarSearchQuery ? (
                                <>
                                    {/* My chats — local matches from users + groups */}
                                    {(sidebarLocalMatches.users.length > 0 || sidebarLocalMatches.groups.length > 0) && (
                                        <>
                                            <div style={{ padding: '6px 12px 4px', fontSize: 11, fontWeight: 600, color: dm ? '#5a5a8a' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{lang === 'en' ? 'My chats' : 'Мои чаты'}</div>
                                            {sidebarLocalMatches.users.map(u => {
                                                const avatarBg = (u as any).avatar_color || '#6366f1';
                                                return (
                                                    <div key={`lu-${u.id}`}
                                                        onMouseDown={() => { selectPrivateChat(u); setSidebarSearchQuery(''); setSidebarSearchResults([]); setSidebarChannelResults([]); setSidebarSearchFocused(false); }}
                                                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                        className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: u.avatar ? (dm ? C.bg1 : '#f7f8fc') : avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                            {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                                        </div>
                                                        <div style={{ minWidth: 0, flex: 1 }}>
                                                            <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                                            <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{u.tag ? `@${u.tag}` : (u.is_online ? `🟢 ${t('Online')}` : t('Offline'))}</div>
                                                        </div>
                                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={dm ? '#5a5a8a' : '#c4b5fd'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                                    </div>
                                                );
                                            })}
                                            {sidebarLocalMatches.groups.map(g => {
                                                return (
                                                    <div key={`lg-${g.id}`}
                                                        onMouseDown={() => { selectGroupChat(g); setSidebarSearchQuery(''); setSidebarSearchResults([]); setSidebarChannelResults([]); setSidebarSearchFocused(false); }}
                                                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                        className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: g.avatar ? (dm ? C.bg1 : '#f7f8fc') : '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                            {g.avatar ? <img src={config.fileUrl(g.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : g.name[0]?.toUpperCase()}
                                                        </div>
                                                        <div style={{ minWidth: 0, flex: 1 }}>
                                                            <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                                                            <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{g.is_channel ? (lang === 'en' ? 'Channel' : 'Канал') : (lang === 'en' ? 'Group' : 'Группа')} · {g.member_count ?? ''} {lang === 'en' ? 'members' : 'участников'}</div>
                                                        </div>
                                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={dm ? '#5a5a8a' : '#c4b5fd'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                                    </div>
                                                );
                                            })}
                                            {(sidebarSearchResults.length > 0 || sidebarChannelResults.length > 0 || sidebarSearchLoading) && (
                                                <div style={{ height: 1, background: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)', margin: '4px 0' }} />
                                            )}
                                        </>
                                    )}
                                    {sidebarSearchLoading && (
                                        <div style={{ padding: '10px 12px', fontSize: 13, color: dm ? '#5a5a8a' : '#9ca3af', textAlign: 'center' }}>{t('Searching...')}</div>
                                    )}
                                    {!sidebarSearchLoading && sidebarSearchResults.length === 0 && sidebarChannelResults.length === 0 && sidebarLocalMatches.users.length === 0 && sidebarLocalMatches.groups.length === 0 && (
                                        <div style={{ padding: '10px 12px', fontSize: 13, color: dm ? '#5a5a8a' : '#9ca3af', textAlign: 'center' }}>{t('No results found')}</div>
                                    )}
                                    {sidebarChannelResults.length > 0 && (
                                        <>
                                            <div style={{ padding: '6px 12px 4px', fontSize: 11, fontWeight: 600, color: dm ? '#5a5a8a' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('Channels')}</div>
                                            {sidebarChannelResults.map(ch => (
                                                <div key={ch.id} onMouseDown={() => { openChannelPreview(ch); setSidebarSearchQuery(''); setSidebarSearchResults([]); setSidebarChannelResults([]); setSidebarSearchFocused(false); }}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: ch.avatar ? (dm ? C.bg1 : '#f7f8fc') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                        {ch.avatar ? <img src={config.fileUrl(ch.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (ch.name?.[0]?.toUpperCase() || '📢')}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            {ch.name}
                                                            {ch.channel_tag === 'auroramessenger' && (
                                                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', flexShrink: 0 }}>
                                                                    <svg width="7" height="7" viewBox="0 0 12 12" fill="none"><path d="M2 6.5L4.5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{ch.channel_tag ? `@${ch.channel_tag}` : ''}{ch.member_count ? ` · ${formatMembers(ch.member_count, 'subscriber', lang)}` : ''}</div>
                                                    </div>
                                                    {ch.is_member ? <span style={{ color: '#22c55e', display: 'inline-flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span> : null}
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {sidebarSearchResults.length > 0 && (
                                        <>
                                            {sidebarChannelResults.length > 0 && <div style={{ padding: '6px 12px 4px', fontSize: 11, fontWeight: 600, color: dm ? '#5a5a8a' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('Users')}</div>}
                                            {sidebarSearchResults.map(u => (
                                                <div key={u.id} onMouseDown={() => { addToSearchHistory(u); setSelectedUserForProfile(u); setSidebarSearchQuery(''); setSidebarSearchResults([]); setSidebarChannelResults([]); setSidebarSearchFocused(false); }}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: u.avatar ? (dm ? C.bg1 : '#f7f8fc') : ((u as any).avatar_color || '#6366f1'), display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
                                                            {DEV_TAGS.includes(u.tag || '') && <DevBadge />}{TESTER_TAGS.includes(u.tag || '') && <TesterBadge />}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{u.tag ? `@${u.tag}` : ((users.find(lu => lu.id === u.id) ?? u).is_online ? `🟢 ${t('Online')}` : t('Offline'))}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {/* Message search results */}
                                    {sidebarMsgResults.length > 0 && (
                                        <>
                                            <div style={{ padding: '6px 12px 4px', fontSize: 11, fontWeight: 600, color: dm ? '#5a5a8a' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                {lang === 'en' ? 'Messages' : 'Сообщения'}
                                            </div>
                                            {sidebarMsgResults.map((r, i) => (
                                                <div key={i} onMouseDown={() => {
                                                    const chat = r.chat_type === 'group' ? groups.find(g => g.id === r.chat_id) : users.find(u => u.id === r.chat_id);
                                                    if (chat) { r.chat_type === 'group' ? selectGroupChat(chat as any) : selectPrivateChat(chat as any); setTimeout(() => goToMessage(r.message_id), 300); }
                                                    setSidebarSearchQuery(''); setSidebarSearchFocused(false); setSidebarMsgResults([]);
                                                }}
                                                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={dm ? '#6366f1' : '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontSize: 12, fontWeight: 600, color: isOled ? '#c4b5fd' : '#6366f1', marginBottom: 1 }}>{r.chat_name}</div>
                                                        <div style={{ fontSize: 12, color: dm ? '#e2e8f0' : '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.message_text}</div>
                                                        <div style={{ fontSize: 10, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 1 }}>{r.sender_name} · {new Date(r.timestamp).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: 'short' })}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    {searchHistory.length > 0 && (
                                        <>
                                            <div style={{ padding: '6px 12px 4px', fontSize: 11, fontWeight: 600, color: dm ? '#5a5a8a' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span>{t('History')}</span>
                                                <button onMouseDown={e => { e.preventDefault(); setSearchHistory([]); localStorage.removeItem('userSearchHistory'); }}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: dm ? '#5a5a8a' : '#9ca3af', padding: '0 2px' }}>{t('Clear')}</button>
                                            </div>
                                            {searchHistory.map(u => (
                                                <div key={u.id} onMouseDown={() => { addToSearchHistory(u); setSelectedUserForProfile(u); setSidebarSearchFocused(false); }}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: u.avatar ? (dm ? C.bg1 : '#f7f8fc') : ((u as any).avatar_color || '#6366f1'), display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
                                                            {DEV_TAGS.includes(u.tag || '') && <DevBadge />}{TESTER_TAGS.includes(u.tag || '') && <TesterBadge />}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: (users.find(lu => lu.id === u.id) ?? u).is_online ? '#22c55e' : (dm ? '#5a5a8a' : '#9ca3af') }}>{(users.find(lu => lu.id === u.id) ?? u).is_online ? `🟢 ${t('Online')}` : t('Offline')}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {recentUsers.length > 0 && (
                                        <>
                                            <div style={{ padding: '6px 12px 4px', fontSize: 11, fontWeight: 600, color: dm ? '#5a5a8a' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('New users')}</div>
                                            {recentUsers.slice(0, 3).map(u => (
                                                <div key={u.id} onMouseDown={() => { addToSearchHistory(u); setSelectedUserForProfile(u); setSidebarSearchFocused(false); }}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: u.avatar ? (dm ? C.bg1 : '#f7f8fc') : ((u as any).avatar_color || '#6366f1'), display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
                                                            {DEV_TAGS.includes(u.tag || '') && <DevBadge />}{TESTER_TAGS.includes(u.tag || '') && <TesterBadge />}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: (users.find(lu => lu.id === u.id) ?? u).is_online ? '#22c55e' : (dm ? '#5a5a8a' : '#9ca3af') }}>{(users.find(lu => lu.id === u.id) ?? u).is_online ? `🟢 ${t('Online')}` : t('Offline')}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>}

                {/* Sidebar body: folder strip (absolute left) + chat list */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

                {/* ── Vertical folder strip (Telegram-style, absolute) ── */}
                {!sidebarCompact && !isMobile && folders.length > 0 && (
                    <div style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0, width: 60,
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none',
                        background: isOled ? '#000000' : dm ? '#111128' : '#ececf7',
                        borderRight: isOled ? 'none' : `1px solid ${dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)'}`,
                        zIndex: 2, paddingTop: 6, paddingBottom: 8, gap: 2,
                    }}>
                        {/* All chats */}
                        {(() => {
                            const active = activeFolder === null;
                            const totalUnread = Object.values(unreadCounts).reduce((s, n) => s + n, 0);
                            return (
                                <button onClick={() => setActiveFolder(null)} onContextMenu={e => { e.preventDefault(); setAllChatsCtxMenu({ x: e.clientX, y: e.clientY }); }} style={{ width: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 4px', borderRadius: 12, border: 'none', cursor: 'pointer', background: active ? (isOled ? 'rgba(124,58,237,0.25)' : dm ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.14)') : 'none', position: 'relative', transition: 'background 0.15s', fontFamily: 'inherit' }}>
                                    {active && <div style={{ position: 'absolute', left: -6, top: '50%', transform: 'translateY(-50%)', width: 3, height: 20, borderRadius: '0 3px 3px 0', background: isOled ? '#a78bfa' : '#6366f1' }} />}
                                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: active ? (isOled ? 'linear-gradient(135deg,#7c3aed,#a78bfa)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)') : (isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.1)'), display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', flexShrink: 0 }}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={active ? 'white' : (isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1')} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                        {totalUnread > 0 && !active && <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 8, background: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', lineHeight: 1 }}>{totalUnread > 99 ? '99+' : totalUnread}</span>}
                                    </div>
                                    <span style={{ fontSize: 10, fontWeight: 600, color: active ? (isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1') : (isOled ? '#4a3a6a' : dm ? '#4a4a6a' : '#8b8bb0'), lineHeight: 1.2, textAlign: 'center', maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lang === 'en' ? 'All' : 'Все'}</span>
                                </button>
                            );
                        })()}

                        {/* Folder items */}
                        {folders.map(f => {
                            const active = activeFolder === f.id;
                            const folderUnread = folderUnreadMap[f.id] || 0;
                            const label = f.name.length > 7 ? f.name.slice(0, 7) + '…' : f.name;
                            return (
                                <button key={f.id} onClick={() => setActiveFolder(f.id)} onContextMenu={e => { e.preventDefault(); setFolderCtxMenu({ x: e.clientX, y: e.clientY, folderId: f.id }); }}
                                    style={{ width: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 4px', borderRadius: 12, border: 'none', cursor: 'pointer', background: active ? (isOled ? 'rgba(124,58,237,0.2)' : dm ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.12)') : 'none', position: 'relative', transition: 'background 0.15s', fontFamily: 'inherit' }}
                                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)'; }}
                                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none'; }}
                                >
                                    {active && <div style={{ position: 'absolute', left: -6, top: '50%', transform: 'translateY(-50%)', width: 3, height: 20, borderRadius: '0 3px 3px 0', background: f.color }} />}
                                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: active ? f.color : (isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.1)'), display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', flexShrink: 0 }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={active ? 'white' : (isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1')} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                                        {folderUnread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 9, background: active ? '#ef4444' : f.color, color: 'white', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', lineHeight: 1, boxShadow: '0 1px 4px rgba(0,0,0,0.3)', border: `2px solid ${isOled ? '#000' : dm ? '#111128' : '#ececf7'}` }}>{folderUnread > 99 ? '99+' : folderUnread}</span>}
                                    </div>
                                    <span style={{ fontSize: 10, fontWeight: 600, color: active ? (isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1') : (isOled ? '#4a3a6a' : dm ? '#4a4a6a' : '#8b8bb0'), lineHeight: 1.2, textAlign: 'center', maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* ── Horizontal folder tabs (mobile only) ── */}
                {isMobile && folders.length > 0 && (
                    <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0, background: isOled ? '#000' : dm ? '#111128' : '#ececf7', borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)'}`, paddingInline: 6, gap: 4, paddingTop: 4, paddingBottom: 4 }}>
                        {/* All chats tab */}
                        {(() => {
                            const active = activeFolder === null;
                            const totalUnread = Object.values(unreadCounts).reduce((s, n) => s + n, 0);
                            return (
                                <button onClick={() => setActiveFolder(null)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', flexShrink: 0, background: active ? (isOled ? 'rgba(124,58,237,0.3)' : dm ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.15)') : 'transparent', fontFamily: 'inherit', position: 'relative' }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={active ? (isOled ? '#c4b5fd' : '#6366f1') : (isOled ? '#4a3a6a' : dm ? '#4a4a6a' : '#8b8bb0')} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                    <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? (isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1') : (isOled ? '#4a3a6a' : dm ? '#4a4a6a' : '#8b8bb0'), whiteSpace: 'nowrap' }}>{lang === 'en' ? 'All' : 'Все'}</span>
                                    {totalUnread > 0 && !active && <span style={{ background: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 9, fontWeight: 700, borderRadius: 8, padding: '1px 4px', lineHeight: 1.4 }}>{totalUnread > 99 ? '99+' : totalUnread}</span>}
                                </button>
                            );
                        })()}
                        {/* Folder tabs */}
                        {folders.map(f => {
                            const active = activeFolder === f.id;
                            const folderUnread = folderUnreadMap[f.id] || 0;
                            return (
                                <button key={f.id} onClick={() => setActiveFolder(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', flexShrink: 0, background: active ? `${f.color}22` : 'transparent', fontFamily: 'inherit' }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={active ? f.color : (isOled ? '#4a3a6a' : dm ? '#4a4a6a' : '#8b8bb0')} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                                    <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? f.color : (isOled ? '#4a3a6a' : dm ? '#4a4a6a' : '#8b8bb0'), whiteSpace: 'nowrap' }}>{f.name}</span>
                                    {folderUnread > 0 && <span style={{ background: active ? f.color : (dm ? '#3a3a5a' : '#d1d5db'), color: active ? 'white' : (dm ? '#9090b0' : '#6b7280'), fontSize: 9, fontWeight: 700, borderRadius: 8, padding: '1px 4px', lineHeight: 1.4 }}>{folderUnread > 99 ? '99+' : folderUnread}</span>}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div style={{ ...darkStyles.sidebarScroll, paddingLeft: (!sidebarCompact && !isMobile && folders.length > 0) ? 60 : 0 }} onClick={() => pinMenu && setPinMenu(null)}>

                    {/* ─── Archive mode list ─── */}
                    {showArchive && (() => {
                        const allArch = archivedList;
                        if (allArch.length === 0) return (
                            <div style={{ textAlign: 'center', padding: '48px 20px', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13 }}>
                                🗄️<br /><br />{lang === 'en' ? 'Archive is empty' : 'Архив пуст'}
                            </div>
                        );
                        return (
                            <div>
                                {allArch.map(({ type, item }) => {
                                    const key = `${type === 'group' ? 'group' : 'private'}-${item.id}`;
                                    const isActive = type === 'group'
                                        ? (activeChat?.type === 'group' && activeChat.id === item.id)
                                        : (activeChat?.type === 'private' && activeChat.id === item.id);
                                    const unread = unreadCounts[key] || 0;
                                    const avatarSrc = (item as any).avatar ? config.fileUrl((item as any).avatar) : null;
                                    const displayName = (item as any).username || (item as any).name || '';
                                    const lastTime = (item as any).last_msg_time;
                                    const lastText = (item as any).last_msg_text;
                                    const lastFile = (item as any).last_msg_file;
                                    const lastFilename = (item as any).last_msg_filename;
                                    return (
                                        <div
                                            key={key}
                                            onClick={() => type === 'group' ? selectGroupChat(item as any) : selectPrivateChat(item as any)}
                                            onContextMenu={e => { e.preventDefault(); setPinMenu({ x: e.clientX, y: e.clientY, key }); }}
                                            className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}
                                            style={{ ...darkStyles.chatItem, ...(isActive ? darkStyles.activeChatItem : {}), position: 'relative' }}
                                        >
                                            <div style={{ ...styles.avatar, backgroundColor: avatarSrc ? (dm ? C.bg1 : '#f7f8fc') : '#6366f1', overflow: 'hidden', flexShrink: 0 }}>
                                                {avatarSrc
                                                    ? <img src={avatarSrc ?? undefined} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    : <span style={{ fontSize: 18, color: 'white', fontWeight: 700 }}>{displayName[0]?.toUpperCase()}</span>
                                                }
                                            </div>
                                            <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                                                    <span style={{ ...darkStyles.chatName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{displayName}</span>
                                                    {lastTime && <span style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatSidebarTime(lastTime)}</span>}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0, height: 18 }}>
                                                    {(() => {
                                                        const draftKey = type === 'user' ? `private-${item.id}` : `group-${(item as any).id}`;
                                                        const draftText = !isActive ? draftsState[draftKey] : undefined;
                                                        if (draftText) {
                                                            return (
                                                                <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isOled ? '#f87171' : '#ef4444' }}>
                                                                    <span style={{ fontWeight: 600 }}>{lang === 'en' ? 'Draft: ' : 'Черновик: '}</span>
                                                                    <span style={{ color: dm ? '#7c7caa' : '#6b7280', fontWeight: 400 }}>{draftText}</span>
                                                                </span>
                                                            );
                                                        }
                                                        const lastSenderId = (item as any).last_msg_sender_id;
                                                        const isOwnMsg = lastSenderId === currentUserId;
                                                        let archPrefix: string | undefined;
                                                        if (type === 'user') {
                                                            archPrefix = isOwnMsg ? (lang === 'en' ? 'You: ' : 'Вы: ') : undefined;
                                                        } else {
                                                            const g = item as any;
                                                            archPrefix = g.is_channel ? undefined : (isOwnMsg ? (lang === 'en' ? 'You: ' : 'Вы: ') : (g.last_msg_sender_name ? `${g.last_msg_sender_name}: ` : undefined));
                                                        }
                                                        return renderSidebarSub(undefined, lastText, lastFile, lastFilename, lang === 'en' ? 'No messages' : 'Нет сообщений', archPrefix, type === 'user' ? item.id : undefined);
                                                    })()}
                                                </div>
                                            </div>
                                            {unread > 0 && (
                                                <div className="badge-pop unread-badge" style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0, boxShadow: isOled ? '0 0 6px rgba(167,139,250,0.4)' : 'none' }}>
                                                    {unread > 99 ? '99+' : unread}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    {!showArchive && (() => {
                        const sorted = sidebarSorted;

                        return (
                        <div>
                            {sorted.map(entry => {
                            if (entry.kind === 'favorites') { return (
                                <div
                                    key="favorites"
                                    onClick={() => {
                                        saveDraft(activeChatRef.current);
                                        restoreDraft(`private-${currentUserId}`);
                                        setReplyTo(null);
                                        setActiveChat({ type: 'private', id: currentUserId, name: lang === 'en' ? '⭐ Favorites' : '⭐ Избранные' });
                                        loadPrivateMessages(currentUserId);
                                    }}
                                    onContextMenu={e => { e.preventDefault(); setPinMenu({ x: e.clientX, y: e.clientY, key: favKey }); }}
                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}
                                    style={{ ...darkStyles.chatItem, ...(activeChat?.type === 'private' && activeChat.id === currentUserId ? darkStyles.activeChatItem : {}), ...((sidebarCompact || sidebarMinimal) ? { justifyContent: 'center', padding: '6px 0' } : {}), position: 'relative' }}
                                >
                                    <div style={{ position: 'relative', flexShrink: 0 }}>
                                        <div style={{ ...styles.avatar, background: 'linear-gradient(135deg,#f59e0b,#f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', color: 'white' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>
                                        {pinnedChats.has(favKey) && <div style={{ position: 'absolute', top: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: dm ? C.bg4 : 'white', border: `1.5px solid ${dm ? C.bg1 : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, color: '#6366f1' }}><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg></div>}
                                    </div>
                                    {!sidebarCompact && !sidebarMinimal && <>
                                        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                                                <div style={{ ...darkStyles.chatName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{lang === 'en' ? 'Favorites' : 'Избранное'}</div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0, height: 18 }}>
                                                {renderSidebarSub(undefined, favoritesLastMsg?.text, favoritesLastMsg?.file, favoritesLastMsg?.filename, lang === 'en' ? 'Your saved messages' : 'Ваши сохранённые сообщения')}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0, minHeight: 38, paddingBottom: 1 }}>
                                            <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', whiteSpace: 'nowrap' }}>
                                                {favoritesLastMsg?.time && formatSidebarTime(favoritesLastMsg.time)}
                                            </div>
                                            {unreadCounts[favKey] > 0
                                                ? <div className="badge-pop" style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', boxShadow: isOled ? '0 0 6px rgba(167,139,250,0.4)' : 'none' }}>{unreadCounts[favKey] > 99 ? '99+' : unreadCounts[favKey]}</div>
                                                : <div style={{ height: 20 }} />
                                            }
                                        </div>
                                    </>}
                                    {(sidebarCompact || sidebarMinimal) && unreadCounts[favKey] > 0 && <div className="badge-pop" style={{ position: 'absolute', top: 4, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{unreadCounts[favKey] > 99 ? '99+' : unreadCounts[favKey]}</div>}
                                </div>
                            ); } else if (entry.kind === 'group') { const group = entry.data; return (
                                <div
                                    key={`g-${group.id}`}
                                    onClick={() => selectGroupChat(group)}
                                    onContextMenu={e => { e.preventDefault(); setPinMenu({ x: e.clientX, y: e.clientY, key: `group-${group.id}` }); }}
                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}
                                    style={{
                                        ...darkStyles.chatItem,
                                        ...(activeChat?.type === 'group' && activeChat.id === group.id ? darkStyles.activeChatItem : {}),
                                        ...(sidebarCompact ? { justifyContent: 'center', padding: '6px 0' } : {}),
                                        position: 'relative',
                                    }}
                                >
                                    <div style={{ position: 'relative', flexShrink: 0 }}>
                                        <div style={{ ...styles.avatar, backgroundColor: group.avatar ? (dm ? C.bg1 : '#f7f8fc') : '#6366f1', overflow: 'hidden' }}>
                                            {group.avatar
                                                ? <img src={config.fileUrl(group.avatar) ?? undefined} alt={group.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : <span style={{ fontSize: 18, color: 'white', fontWeight: 700 }}>{group.name[0]?.toUpperCase()}</span>
                                            }
                                        </div>
                                        {pinnedChats.has(`group-${group.id}`) && (
                                            <div style={{ position: 'absolute', top: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: dm ? C.bg4 : 'white', border: `1.5px solid ${dm ? C.bg1 : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, color: '#6366f1' }}><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg></div>
                                        )}
                                        {mutedChats.has(`group-${group.id}`) && (
                                            <div style={{ position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: '50%', background: dm ? C.bg6 : '#e0e0e0', border: `1.5px solid ${dm ? C.bg1 : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: dm ? '#9090b0' : '#6b7280' }}><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg></div>
                                        )}
                                    </div>
                                    {!sidebarCompact && !sidebarMinimal && <>
                                        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                                                {/* name + inline badges, no flex:1 on name so badges stay next to it */}
                                                <span style={{ ...darkStyles.chatName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, fontWeight: 600, fontSize: 14 }}>{group.name}</span>
                                                {group.is_channel
                                                    ? <span title={lang === 'en' ? 'Channel' : 'Канал'} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: isOled ? 'rgba(99,102,241,0.18)' : dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.12)', flexShrink: 0 }}>
                                                        <svg width="9" height="9" viewBox="0 0 20 20" fill={isOled ? '#a78bfa' : '#6366f1'}><path fillRule="evenodd" d="M18 3a1 1 0 00-1.447-.894L8.763 6H5a3 3 0 000 6h.28l1.771 5.316A1 1 0 008 18h1a1 1 0 001-1v-4.382l6.553 3.276A1 1 0 0018 15V3z" clipRule="evenodd"/></svg>
                                                    </span>
                                                    : <span title={lang === 'en' ? 'Group' : 'Группа'} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: isOled ? 'rgba(124,58,237,0.12)' : dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.08)', flexShrink: 0 }}>
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                                    </span>
                                                }
                                                {!!group.is_channel && group.channel_tag === 'auroramessenger' && (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 15, height: 15, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', flexShrink: 0 }}>
                                                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M2 6.5L4.5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0, height: 18 }}>
                                                {(() => {
                                                    const isGroupActive = activeChat?.type === 'group' && activeChat.id === group.id;
                                                    const draftText = !isGroupActive ? draftsState[`group-${group.id}`] : undefined;
                                                    if (draftText) return (
                                                        <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isOled ? '#f87171' : '#ef4444' }}>
                                                            <span style={{ fontWeight: 600 }}>{lang === 'en' ? 'Draft: ' : 'Черновик: '}</span>
                                                            <span style={{ color: dm ? '#7c7caa' : '#6b7280', fontWeight: 400 }}>{draftText}</span>
                                                        </span>
                                                    );
                                                    const typing = !group.is_channel ? typingChats[`group-${group.id}`] : undefined;
                                                    const isSystemMsg = group.last_msg_text === 'Группа создана' || group.last_msg_text === 'Канал создан' || group.last_msg_text === 'Group created' || group.last_msg_text === 'Channel created';
                                                    const senderLabel = (group.is_channel || isSystemMsg) ? '' : (group.last_msg_sender_id === currentUserId ? 'Вы: ' : group.last_msg_sender_name ? `${group.last_msg_sender_name}: ` : '');
                                                    if (isSystemMsg && group.last_msg_text) {
                                                        return <span style={{ fontSize: 13, color: isOled ? '#7c7caa' : dm ? '#5a5a8a' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontStyle: 'italic' }}>{group.last_msg_text}</span>;
                                                    }
                                                    return renderSidebarSub(
                                                        typing ? `✍️ ${typing} ${t('is typing...')}` : undefined,
                                                        group.last_msg_text, group.last_msg_file, group.last_msg_filename,
                                                        group.last_msg_time ? '' : (group.member_count ? formatMembers(group.member_count, group.is_channel ? 'subscriber' : 'member', lang) : ''),
                                                        group.last_msg_time ? senderLabel : undefined
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0, minHeight: 38, paddingBottom: 1 }}>
                                            <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', whiteSpace: 'nowrap' }}>
                                                {group.last_msg_sender_id === currentUserId && group.last_msg_time && (
                                                    <span style={{ marginRight: 2, display: 'inline-flex', alignItems: 'center' }}>
                                                        {group.last_msg_is_read ? (
                                                            <svg width="18" height="11" viewBox="0 0 18 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke={isOled ? '#7c6aaa' : (dm ? '#5a5a8a' : '#9ca3af')} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke={isOled ? '#a78bfa' : '#93c5fd'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                        ) : (
                                                            <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5L4.5 8.5L11 1.5" stroke={isOled ? '#6b5a8a' : (dm ? '#5a5a8a' : '#a5b4fc')} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                        )}
                                                    </span>
                                                )}
                                                {group.last_msg_time && formatSidebarTime(group.last_msg_time)}
                                            </div>
                                            {unreadCounts[`group-${group.id}`] > 0
                                                ? <div className="badge-pop" style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: mutedChats.has(`group-${group.id}`) ? (dm ? '#3a3a5a' : '#a0a0b0') : (isOled ? '#7c3aed' : '#6366f1'), color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{unreadCounts[`group-${group.id}`] > 99 ? '99+' : unreadCounts[`group-${group.id}`]}</div>
                                                : mutedChats.has(`group-${group.id}`)
                                                    ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={dm ? '#5a5a8a' : '#9ca3af'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                                    : <div style={{ height: 20 }} />
                                            }
                                        </div>
                                    </>}
                                    {(sidebarCompact || sidebarMinimal) && unreadCounts[`group-${group.id}`] > 0 && <div className="badge-pop" style={{ position: 'absolute', top: 4, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', boxShadow: isOled ? '0 0 6px rgba(167,139,250,0.4)' : 'none' }}>{unreadCounts[`group-${group.id}`] > 99 ? '99+' : unreadCounts[`group-${group.id}`]}</div>}
                                </div>
                            ); } else { const user = entry.data as User; return (
                                <div
                                    key={`u-${user.id}`}
                                    onClick={() => selectPrivateChat(user)}
                                    onContextMenu={e => { e.preventDefault(); setPinMenu({ x: e.clientX, y: e.clientY, key: `private-${user.id}` }); }}
                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}
                                    style={{ ...darkStyles.chatItem, ...(activeChat?.type === 'private' && activeChat.id === user.id ? darkStyles.activeChatItem : {}), ...((sidebarCompact || sidebarMinimal) ? { justifyContent: 'center', padding: '6px 0' } : {}), position: 'relative' }}
                                >
                                    {(() => {
                                        const isBlockedByMe = blockedUserIds.has(user.id);
                                        const isBlockedByThem = user.last_seen === 'blocked_you';
                                        const isBlocked = isBlockedByMe || isBlockedByThem;
                                        const liveUser = users.find(lu => lu.id === user.id) ?? user;
                                        return (
                                        <div style={{ position: 'relative', flexShrink: 0 }}>
                                            <div style={{ ...styles.avatar, backgroundColor: isBlocked ? (dm ? C.bg6 : '#e5e7eb') : (user.avatar ? (dm ? C.bg1 : '#f7f8fc') : (user.avatar_color || '#6366f1')), overflow: 'hidden', color: isBlocked ? (dm ? '#6b7280' : '#9ca3af') : 'white', fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {!isBlocked && user.avatar
                                                    ? <img src={config.fileUrl(user.avatar) ?? undefined} alt={user.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    : isBlocked ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> : <span style={{ fontSize: 16 }}>{user.username[0]?.toUpperCase()}</span>}
                                            </div>
                                            {pinnedChats.has(`private-${user.id}`) && <div style={{ position: 'absolute', top: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: dm ? C.bg4 : 'white', border: `1.5px solid ${dm ? C.bg1 : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, color: '#6366f1' }}><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg></div>}
                                            {isBlockedByMe && <div style={{ position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: '50%', background: dm ? C.bg6 : '#f3f4f6', border: `1.5px solid ${dm ? C.bg1 : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></div>}
                                            {!isBlocked && liveUser.is_online && <div style={{ position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: '50%', background: '#22c55e', border: `2px solid ${dm ? C.bg1 : 'white'}` }} />}
                                            {!isBlockedByMe && mutedChats.has(`private-${user.id}`) && <div style={{ position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: '50%', background: dm ? C.bg6 : '#e0e0e0', border: `1.5px solid ${dm ? C.bg1 : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: dm ? '#9090b0' : '#6b7280' }}><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg></div>}
                                        </div>
                                        );
                                    })()}
                                    {!sidebarCompact && !sidebarMinimal && <>
                                        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                                                <span style={{ ...darkStyles.chatName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{user.username}</span>
                                                {user.is_developer && <DevBadge />}{(user as any).is_tester && <TesterBadge />}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0, height: 18 }}>
                                                {(() => {
                                                    const isUserActive = activeChat?.type === 'private' && activeChat.id === user.id;
                                                    const draftText = !isUserActive ? draftsState[`private-${user.id}`] : undefined;
                                                    if (draftText) return (
                                                        <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isOled ? '#f87171' : '#ef4444' }}>
                                                            <span style={{ fontWeight: 600 }}>{lang === 'en' ? 'Draft: ' : 'Черновик: '}</span>
                                                            <span style={{ color: dm ? '#7c7caa' : '#6b7280', fontWeight: 400 }}>{draftText}</span>
                                                        </span>
                                                    );
                                                    return renderSidebarSub(
                                                        (typingChats[`private-${user.id}`] && user.id !== currentUserId) ? `✍️ ${t('is typing...')}` : undefined,
                                                        user.last_msg_text, user.last_msg_file, user.last_msg_filename,
                                                        user.last_msg_time ? '' : blockedUserIds.has(user.id) ? (lang === 'en' ? '🚫 Blocked' : '🚫 Заблокирован') : user.last_seen === 'blocked_you' ? (lang === 'en' ? 'last seen a long time ago' : 'был(а) давно') : (user.is_online ? `🟢 ${t('Online')}` : user.last_seen === 'hidden' ? t('last seen recently') : user.last_seen ? `${t('last seen')} ${formatLastSeen(user.last_seen)}` : user.status || t('private chat')),
                                                        undefined,
                                                        user.id
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', flexShrink: 0, minHeight: 38, paddingBottom: 1 }}>
                                            <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 2 }}>
                                                {user.last_msg_sender_id === currentUserId && user.last_msg_time && (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                        {(lastReadByOther[user.id] || user.last_msg_is_read) ? (
                                                            <svg width="18" height="11" viewBox="0 0 18 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke={isOled ? '#7c6aaa' : (dm ? '#5a5a8a' : '#9ca3af')} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke={isOled ? '#a78bfa' : '#93c5fd'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                        ) : (
                                                            <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5L4.5 8.5L11 1.5" stroke={isOled ? '#6b5a8a' : (dm ? '#5a5a8a' : '#a5b4fc')} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                        )}
                                                    </span>
                                                )}
                                                {user.last_msg_time && formatSidebarTime(user.last_msg_time)}
                                            </div>
                                            {unreadCounts[`private-${user.id}`] > 0
                                                ? <div className="badge-pop" style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: mutedChats.has(`private-${user.id}`) ? (dm ? '#3a3a5a' : '#a0a0b0') : (isOled ? '#7c3aed' : '#6366f1'), color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{unreadCounts[`private-${user.id}`] > 99 ? '99+' : unreadCounts[`private-${user.id}`]}</div>
                                                : mutedChats.has(`private-${user.id}`)
                                                    ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={dm ? '#5a5a8a' : '#9ca3af'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                                    : <div style={{ height: 20 }} />
                                            }
                                        </div>
                                    </>}
                                    {(sidebarCompact || sidebarMinimal) && unreadCounts[`private-${user.id}`] > 0 && <div className="badge-pop" style={{ position: 'absolute', top: 4, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', boxShadow: isOled ? '0 0 6px rgba(167,139,250,0.4)' : 'none' }}>{unreadCounts[`private-${user.id}`] > 99 ? '99+' : unreadCounts[`private-${user.id}`]}</div>}
                                </div>
                            ); } })}
                        </div>
                        );
                    })()}
                </div>

                </div>{/* end sidebar body wrapper */}

                {/* Mini player dock — music + chat audio */}
                {(miniTrack || nowPlaying) && !sidebarHidden && (
                    <MiniPlayer
                        track={miniTrack}
                        isPlaying={miniIsPlaying}
                        volume={miniVolume}
                        trackProgress={miniProgress}
                        trackDuration={miniDuration}
                        dm={dm}
                        isOled={isOled}
                        onToggle={() => miniControlsRef.current?.toggle()}
                        onPrev={() => miniControlsRef.current?.prev()}
                        onNext={() => miniControlsRef.current?.next()}
                        onVolume={v => { setMiniVolume(v); miniControlsRef.current?.setVol(v); }}
                        onOpen={() => setShowMediaPlayer(true)}
                        chatAudio={nowPlaying ? { filename: nowPlaying.filename, currentTime: globalCurrentTime, duration: globalDuration } : null}
                        chatAudioPlaying={globalPlaying}
                        onChatAudioToggle={toggleGlobalPlay}
                        onChatAudioStop={stopGlobal}
                        onChatAudioPrev={mediaPlaylist.length > 1 ? prevTrack : undefined}
                        onChatAudioNext={mediaPlaylist.length > 1 ? nextTrack : undefined}
                    />
                )}

                {/* Profile card */}
                {(() => {
                    const totalUnreadProfile = Object.values(unreadCounts).reduce((s, n) => s + n, 0);
                    const isOnline = wsConnState === 'connected';
                    const statusText = currentUserStatus?.trim();
                    return (
                    <div className="sidebar-profile-card" style={{ ...darkStyles.profileCard, ...((sidebarCompact || sidebarMinimal) ? { justifyContent: 'center', padding: '8px 0' } : {}), ...(sidebarMinimal ? { display: 'none' } : {}) }}>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                            <div style={{ ...styles.profileAvatar, backgroundColor: currentUserAvatar ? (dm ? C.bg1 : '#f7f8fc') : avatarBg, cursor: 'pointer' }} onClick={() => setShowSettings(true)}>
                                {currentUserAvatar
                                    ? <img src={config.fileUrl(currentUserAvatar) ?? undefined} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                                    : <span style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>{currentUsername[0]?.toUpperCase()}</span>
                                }
                            </div>
                            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: '50%', background: isOnline ? '#22c55e' : (isOled ? '#4a3a6a' : dm ? '#3a3a5a' : '#c0c0d0'), border: `2px solid ${isOled ? '#000' : dm ? '#161625' : '#f0f1f8'}` }} />
                        </div>
                        {!sidebarCompact && <>
                            <div style={{ ...styles.profileInfo, minWidth: 0, flex: 1 }} onClick={() => setShowSettings(true)}>
                                <div style={{ ...darkStyles.profileName, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUsername}</span>
                                    {DEV_TAGS.includes(currentUserTag || '') && <DevBadge />}{TESTER_TAGS.includes(currentUserTag || '') && <TesterBadge />}
                                </div>
                                <div style={{ fontSize: 11, color: isOled ? '#6b5fa0' : dm ? '#5a5a7a' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                                    {statusText
                                        ? <span style={{ color: isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1' }}>{statusText}</span>
                                        : currentUserTag ? `@${currentUserTag}` : (lang === 'en' ? 'Online' : 'В сети')}
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                {totalUnreadProfile > 0 && (
                                    <div style={{ minWidth: 18, height: 18, borderRadius: 9, background: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                                        {totalUnreadProfile > 99 ? '99+' : totalUnreadProfile}
                                    </div>
                                )}
                                <button onClick={() => setShowSettings(true)} style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    width: 28, height: 28, padding: 0, flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    borderRadius: 8,
                                    color: isOled ? '#6b5fa0' : dm ? '#5a5a7a' : '#b0b0c8',
                                    transition: 'color 0.15s',
                                }} title={t('Settings')}
                                    onMouseEnter={e => (e.currentTarget.style.color = isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1')}
                                    onMouseLeave={e => (e.currentTarget.style.color = isOled ? '#6b5fa0' : dm ? '#5a5a7a' : '#b0b0c8')}
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                                    </svg>
                                </button>
                            </div>
                        </>}
                    </div>
                    );
                })()}
            </div>

            {/* Область чата */}
            <div
                style={{ ...darkStyles.chatArea, position: 'relative' }}
                onDragEnter={e => { e.preventDefault(); dragCounterRef.current++; setDragOver(true); }}
                onDragLeave={() => { dragCounterRef.current--; if (dragCounterRef.current === 0) setDragOver(false); }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                    e.preventDefault();
                    dragCounterRef.current = 0;
                    setDragOver(false);
                    if (e.dataTransfer.files?.length && activeChat) {
                        addPendingFiles(e.dataTransfer.files);
                    }
                }}
            >
                {dragOver && activeChat && (
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 200,
                        background: dm ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.10)',
                        border: '2px dashed #6366f1',
                        borderRadius: 16,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        pointerEvents: 'none',
                    }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ color: '#6366f1' }}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></div>
                            <div style={{ fontSize: 16, fontWeight: 600, color: '#6366f1', marginTop: 8 }}>{t('Drop files to send')}</div>
                        </div>
                    </div>
                )}
                {activeChat ? (
                    <>
                        {/* Шапка */}
                        <div className={isMobile ? 'mobile-chat-header' : undefined} style={{ ...darkStyles.chatHeader, ...(isMobile ? { padding: '0 10px', height: 56, minHeight: 56, maxHeight: 56 } : {}), position: 'relative' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flex: 1, minWidth: 0 }}>
                                {/* Кнопка назад (мобильная) */}
                                {isMobile && (
                                    <button
                                        onClick={() => setActiveChat(null)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: '4px 4px 4px 0', borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center' }}
                                    ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
                                )}
                                {/* Аватар активного чата */}
                                {(() => {
                                    const isSelf = activeChat.type === 'private' && activeChat.id === currentUserId;
                                    const chatUser = activeChat.type === 'private' ? usersById.get(activeChat.id) : null;
                                    const chatGroup = activeChat.type === 'group' ? groups.find(g => g.id === activeChat.id) : null;
                                    const isBlockedByMe = activeChat.type === 'private' && !isSelf && blockedUserIds.has(activeChat.id);
                                    const isBlockedByThem = chatUser?.last_seen === 'blocked_you';
                                    const isBlocked = isBlockedByMe || isBlockedByThem;
                                    const bg = isSelf ? '#f97316' : isBlocked ? (dm ? C.bg6 : '#e5e7eb') : activeChat.type === 'group' ? '#6366f1' : (chatUser?.avatar_color || '#1a73e8');
                                    const src = (!isBlocked && !isSelf) ? (chatUser?.avatar ? config.fileUrl(chatUser.avatar) : chatGroup?.avatar ? config.fileUrl(chatGroup.avatar) : null) : null;
                                    const initial = isSelf ? '⭐' : isBlocked ? '👤' : activeChat.name[0]?.toUpperCase();
                                    const canClick = activeChat.type === 'private' && !isSelf;
                                    const canClickGroup = activeChat.type === 'group';
                                    return (
                                        <div
                                            style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: '50%', background: isSelf ? 'linear-gradient(135deg,#f59e0b,#f97316)' : (src ? 'transparent' : bg), display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, cursor: (canClick || canClickGroup || isSelf) ? 'pointer' : 'default', boxShadow: isBlocked ? 'none' : `0 0 10px ${bg}66` }}
                                            onClick={() => {
                                                if (canClick) { const u = usersById.get(activeChat.id); if (u) setSelectedUserForProfile(u); }
                                                if (canClickGroup) { setSelectedGroupId(activeChat.id); setShowGroupInfo(true); }
                                                if (isSelf) setSelectedUserForProfile(currentUserObj);
                                            }}
                                        >
                                            {src
                                                ? <img src={src} alt={activeChat.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : <span style={{ color: isBlocked ? (dm ? '#6b7280' : '#9ca3af') : 'white', fontSize: isSelf ? 20 : isBlocked ? 20 : 18, fontWeight: 700 }}>{initial}</span>
                                            }
                                        </div>
                                    );
                                })()}
                                {chatSearchOpen ? (
                                    <>
                                        {/* Search row — stays within header height */}
                                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                            <input
                                                ref={chatSearchInputRef}
                                                autoFocus
                                                value={chatSearchQuery}
                                                onChange={e => { setChatSearchQuery(e.target.value); setChatSearchIdx(0); if (!chatSearchHasFilters) setChatSearchServerResults([]); }}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSearchHasFilters ? runChatServerSearch() : goToChatSearchMatch(chatSearchIdx + 1); }
                                                    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); goToChatSearchMatch(chatSearchIdx - 1); }
                                                    if (e.key === 'Escape') { setChatSearchOpen(false); setChatSearchQuery(''); setChatSearchFiltersOpen(false); }
                                                }}
                                                placeholder={t('Search in chat...')}
                                                style={{ flex: 1, padding: '7px 12px', borderRadius: 10, border: 'none', background: dm ? (isOled ? '#0a0a12' : C.bg4) : '#eef0f8', color: dm ? '#e2e8f0' : '#1e1b4b', fontSize: 14, outline: 'none', minWidth: 0, boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.14)' : dm ? '0 0 0 1.5px rgba(99,102,241,0.2)' : '0 0 0 1.5px rgba(99,102,241,0.15)', fontFamily: 'inherit' }}
                                            />
                                            {/* Filters toggle */}
                                            <button onClick={() => setChatSearchFiltersOpen(p => !p)} title={lang === 'en' ? 'Filters' : 'Фильтры'}
                                                style={{ ...darkStyles.iconBtn, ...(chatSearchFiltersOpen || chatSearchHasFilters ? { background: isOled ? 'rgba(139,92,246,0.2)' : 'rgba(99,102,241,0.15)', color: '#6366f1' } : {}), flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', position: 'relative' }}>
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                                                {chatSearchHasFilters && <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: '#6366f1' }} />}
                                            </button>
                                            {/* Counter / spinner */}
                                            {chatSearchLoading
                                                ? <div style={{ width: 14, height: 14, border: `2px solid ${isOled ? 'rgba(167,139,250,0.3)' : 'rgba(99,102,241,0.3)'}`, borderTopColor: isOled ? '#a78bfa' : '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                                                : (chatSearchQuery.length > 0 || chatSearchHasFilters) && (
                                                    <span style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }} title={chatSearchNotLoaded > 0 ? `${chatSearchNotLoaded} результатов вне загруженной истории` : undefined}>
                                                        {chatSearchMatches.length > 0
                                                            ? `${chatSearchIdx + 1}/${chatSearchMatches.length}${chatSearchNotLoaded > 0 ? ` (+${chatSearchNotLoaded})` : ''}`
                                                            : chatSearchMatchesAll.length > 0 ? `0 в истории (+${chatSearchNotLoaded})` : '—'}
                                                    </span>
                                                )
                                            }
                                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                                <button onClick={() => goToChatSearchMatch(chatSearchIdx - 1)} disabled={chatSearchMatches.length === 0} style={darkStyles.iconBtn} title="Предыдущий"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                                                <button onClick={() => chatSearchHasFilters ? runChatServerSearch() : goToChatSearchMatch(chatSearchIdx + 1)} disabled={chatSearchLoading} style={darkStyles.iconBtn} title="Следующий / Найти"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                                                <button onClick={() => { setChatSearchOpen(false); setChatSearchQuery(''); setChatSearchFiltersOpen(false); setChatSearchServerResults([]); }} style={darkStyles.iconBtn}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                            </div>
                                        </div>

                                        {/* Filters panel — absolute dropdown below header */}
                                        {chatSearchFiltersOpen && (() => {
                                            const panelBg = isOled ? '#000000' : dm ? '#13131f' : '#f7f8fc';
                                            const borderCol = isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.12)';
                                            const panelShadow = isOled
                                                ? '0 4px 24px rgba(0,0,0,0.8)'
                                                : dm ? '0 4px 16px rgba(0,0,0,0.4)' : '0 4px 12px rgba(99,102,241,0.08)';
                                            const inputSt: React.CSSProperties = { background: isOled ? '#0d0d18' : dm ? '#1a1a2e' : '#eef0f8', color: dm ? '#e2e8f0' : '#1e1b4b', border: `1px solid ${borderCol}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', colorScheme: dm ? 'dark' : 'light' };
                                            const chip = (active: boolean): React.CSSProperties => ({ padding: '4px 12px', borderRadius: 20, border: `1.5px solid ${active ? (isOled ? '#a78bfa' : '#6366f1') : borderCol}`, background: active ? (isOled ? 'rgba(167,139,250,0.18)' : dm ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.12)') : 'transparent', color: active ? (isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1') : (dm ? '#5a5a8a' : '#9ca3af'), fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', flexShrink: 0 });
                                            const groupMembers = activeChat?.type === 'group' ? (groupMembersCache[activeChat.id] || []) : [];
                                            const labelSt: React.CSSProperties = { fontSize: 10, color: dm ? '#4a4a6a' : '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5, display: 'block' };

                                            const handleChip = (ct: 'all'|'text'|'media'|'links') => {
                                                setChatSearchContentType(ct);
                                                runChatServerSearch({ ct });
                                            };
                                            const handleDateFrom = (v: string) => {
                                                setChatSearchDateFrom(v);
                                            };
                                            const handleDateTo = (v: string) => {
                                                setChatSearchDateTo(v);
                                            };
                                            const handleSender = (v: number | '') => {
                                                setChatSearchSenderId(v);
                                                runChatServerSearch({ sid: v });
                                            };
                                            return (
                                                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, background: panelBg, borderTop: `1px solid ${borderCol}`, borderBottom: `1px solid ${borderCol}`, boxShadow: panelShadow, padding: '10px 16px 12px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
                                                    {/* Content type */}
                                                    <div>
                                                        <span style={labelSt}>{lang === 'en' ? 'Type' : 'Тип'}</span>
                                                        <div style={{ display: 'flex', gap: 5 }}>
                                                            {(['all', 'text', 'media', 'links'] as const).map(ct => (
                                                                <button key={ct} onClick={() => handleChip(ct)} style={chip(chatSearchContentType === ct)}>
                                                                    {ct === 'all' ? (lang === 'en' ? 'All' : 'Все') : ct === 'text' ? (lang === 'en' ? 'Text' : 'Текст') : ct === 'media' ? (lang === 'en' ? 'Media' : 'Медиа') : (lang === 'en' ? 'Links' : 'Ссылки')}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    {/* Date from */}
                                                    <div style={{ minWidth: 110 }}>
                                                        <span style={labelSt}>{lang === 'en' ? 'From date' : 'С даты'}</span>
                                                        <input type="date" value={chatSearchDateFrom} onChange={e => handleDateFrom(e.target.value)} style={inputSt} />
                                                    </div>
                                                    {/* Date to */}
                                                    <div style={{ minWidth: 110 }}>
                                                        <span style={labelSt}>{lang === 'en' ? 'To date' : 'По дату'}</span>
                                                        <input type="date" value={chatSearchDateTo} onChange={e => handleDateTo(e.target.value)} style={inputSt} />
                                                    </div>
                                                    {/* Sender (group) */}
                                                    {groupMembers.length > 0 && (
                                                        <div style={{ minWidth: 130 }}>
                                                            <span style={labelSt}>{lang === 'en' ? 'From user' : 'Участник'}</span>
                                                            <select value={chatSearchSenderId} onChange={e => handleSender(e.target.value ? Number(e.target.value) : '')} style={inputSt}>
                                                                <option value="">{lang === 'en' ? 'All' : 'Все'}</option>
                                                                {groupMembers.map((m: any) => <option key={m.id} value={m.id}>{m.username}</option>)}
                                                            </select>
                                                        </div>
                                                    )}
                                                    {/* Clear */}
                                                    {chatSearchHasFilters && (
                                                        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 1 }}>
                                                            <button onClick={() => { setChatSearchContentType('all'); setChatSearchDateFrom(''); setChatSearchDateTo(''); setChatSearchSenderId(''); setChatSearchServerResults([]); runChatServerSearch({ ct: 'all', df: '', dt: '', sid: '' }); }} style={{ background: 'none', border: `1px solid ${borderCol}`, borderRadius: 8, padding: '5px 10px', color: '#5a5a8a', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', transition: 'all 0.15s' }}
                                                                onMouseEnter={e => (e.currentTarget.style.color = '#e2e8f0')}
                                                                onMouseLeave={e => (e.currentTarget.style.color = '#5a5a8a')}
                                                            >✕ {lang === 'en' ? 'Clear' : 'Сбросить'}</button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </>
                                ) : (
                                    <>
                                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: dm ? '#e2e8f0' : '#1e1b4b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {activeChat.name.replace(/^⭐\s*/, '')}
                                                {activeChat.type === 'private' && usersById.get(activeChat.id)?.is_developer && <DevBadge size={15} />}{activeChat.type === 'private' && (usersById.get(activeChat.id) as any)?.is_tester && <TesterBadge size={15} />}
                                                {!!isChannelChat && activeGroup?.channel_tag === 'auroramessenger' && (
                                                    <span title={t('Official Aurora channel')} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', flexShrink: 0 }}>
                                                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6.5L4.5 9L10 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                    </span>
                                                )}
                                            </h3>
                                            <div style={{ fontSize: 12, color: dm ? '#7c7caa' : '#6b7280', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
                                                {activeChat.type === 'group'
                                                    ? (() => { const cnt = activeGroup?.member_count; return cnt ? formatMembers(cnt, activeGroup?.is_channel ? 'subscriber' : 'member', lang) : ''; })()
                                                    : activeChat.id === currentUserId
                                                    ? t('saved messages')
                                                    : (() => {
                                                        const u = usersById.get(activeChat.id);
                                                        if (!u) return t('private chat');
                                                        if (blockedUserIds.has(activeChat.id)) return lang === 'en' ? '🚫 Blocked' : '🚫 Заблокирован';
                                                        if (u.last_seen === 'blocked_you') return lang === 'en' ? 'last seen a long time ago' : 'был(а) давно';
                                                        if (u.now_playing) return `🎵 ${u.now_playing}`;
                                                        if (u.is_online) return t('Online');
                                                        if (u.last_seen === 'hidden') return t('last seen recently');
                                                        if (u.last_seen) return `${t('last seen')} ${formatLastSeen(u.last_seen)}`;
                                                        return u.status || t('private chat');
                                                    })()
                                                }
                                            </div>
                                        </div>
                                        {typingUser && !isChannelChat && (
                                            <span style={styles.typing}>
                                                {typingUser}
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: isMobile ? 4 : 8 }}>
                                {/* Call buttons — only for DM (not self, not blocked) */}
                                {!chatSearchOpen && activeChat.type === 'private' && activeChat.id !== currentUserId && !blockedUserIds.has(activeChat.id) && usersById.get(activeChat.id)?.last_seen !== 'blocked_you' && callInfo.state === 'idle' && (
                                    <>
                                        <button
                                            onClick={() => startCall(activeChat.id, activeChat.name, 'audio')}
                                            style={darkStyles.iconBtn}
                                            title={lang === 'en' ? 'Audio call' : 'Аудиозвонок'}
                                        >
                                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                                        </button>
                                        <button
                                            onClick={() => startCall(activeChat.id, activeChat.name, 'video')}
                                            style={darkStyles.iconBtn}
                                            title={lang === 'en' ? 'Video call' : 'Видеозвонок'}
                                        >
                                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                                        </button>
                                    </>
                                )}
                                {/* Active call indicator */}
                                {!chatSearchOpen && callInfo.state !== 'idle' && (
                                    <button
                                        onClick={callInfo.state === 'ringing' ? acceptCall : endCall}
                                        style={{ ...darkStyles.iconBtn, background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: 'white', border: 'none' }}
                                        title={callInfo.state === 'ringing' ? (lang === 'en' ? 'Answer' : 'Ответить') : (lang === 'en' ? 'Return to call' : 'Вернуться в звонок')}
                                    >
                                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                                    </button>
                                )}
                                <button onClick={() => { setChatSearchOpen(p => !p); setChatSearchQuery(''); setChatSearchIdx(0); }} style={{ ...darkStyles.iconBtn, ...(chatSearchOpen ? { background: dm ? 'rgba(99,102,241,0.2)' : '#ede9fe', color: '#6366f1' } : {}) }} title={t('Search in chat...')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
                                {!chatSearchOpen && activeChat.type === 'group' && isGroupAdmin && !isChannelChat && (
                                    <button onClick={() => { setSelectedGroupId(activeChat.id); setShowInviteModal(true); }} style={darkStyles.iconBtn} title={t('Invite')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg></button>
                                )}
                            </div>
                        </div>



                        {/* Disappearing messages banner */}
                        {(() => {
                            const dKey = `${activeChat.type}-${activeChat.id}`;
                            const dSec = disappearSettings[dKey];
                            if (!dSec) return null;
                            const dLabel = dSec >= 604800 ? (lang === 'en' ? '1 week' : '1 неделя') : dSec >= 86400 ? (lang === 'en' ? '1 day' : '1 день') : dSec >= 3600 ? (lang === 'en' ? '1 hour' : '1 час') : dSec >= 300 ? (lang === 'en' ? '5 minutes' : '5 минут') : (lang === 'en' ? '30 seconds' : '30 секунд');
                            return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px', background: isOled ? 'rgba(245,158,11,0.1)' : dm ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.08)', borderBottom: `1px solid ${isOled ? 'rgba(245,158,11,0.2)' : dm ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.15)'}`, flexShrink: 0 }}>
                                    <span style={{ fontSize: 13, color: dm ? '#fbbf24' : '#b45309', flex: 1 }}>⏳ {lang === 'en' ? `Messages disappear after ${dLabel}` : `Сообщения исчезают через ${dLabel}`}</span>
                                    <button onClick={async () => {
                                        const chatType = activeChat.type as 'private' | 'group';
                                        await api.setDisappearSetting(token, chatType, activeChat.id, null);
                                        setDisappearSettings(prev => ({ ...prev, [dKey]: null }));
                                    }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#fbbf24' : '#b45309', padding: '0 2px', display: 'flex', alignItems: 'center', fontSize: 16, lineHeight: 1 }}>×</button>
                                </div>
                            );
                        })()}

                        {/* Закреплённые сообщения */}
                        {(() => {
                            const chatKey = `${activeChat.type}-${activeChat.id}`;
                            const pins = pinnedMessages[chatKey];
                            if (!pins || pins.length === 0) return null;
                            const idx = Math.min(pinnedMsgIdx[chatKey] || 0, pins.length - 1);
                            const pinned = pins[idx];
                            const goNext = () => setPinnedMsgIdx(prev => ({ ...prev, [chatKey]: (idx + 1) % pins.length }));
                            const scrollTo = () => { const el = document.getElementById(`msg-${pinned.id}`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.transition = 'background 0.3s'; el.style.background = 'rgba(99,102,241,0.18)'; setTimeout(() => { el.style.background = ''; }, 1500); } };
                            return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', background: isOled ? '#000000' : (dm ? '#181828' : '#f5f3ff'), borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.15)' : (dm ? 'rgba(99,102,241,0.18)' : '#ede9fe')}`, cursor: 'pointer', flexShrink: 0 }}
                                    onClick={() => { scrollTo(); if (pins.length > 1) goNext(); }}>
                                    {/* Progress bars for multiple pins */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                                        {pins.map((_, i) => (
                                            <div key={i} style={{ width: 3, height: pins.length === 1 ? 32 : Math.max(6, 32 / pins.length - 2), borderRadius: 2, background: i === idx ? '#6366f1' : (dm ? '#3a3a5a' : '#c4b5fd'), transition: 'background 0.2s' }} />
                                        ))}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: '#6366f1', display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                                            {t('Pinned message')}{pins.length > 1 && <span style={{ opacity: 0.7, fontWeight: 400 }}> {idx + 1}/{pins.length}</span>}
                                        </div>
                                        <div style={{ fontSize: 12, color: dm ? '#9090b0' : '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pinned.text}</div>
                                    </div>
                                    <button onClick={e => { e.stopPropagation(); togglePinMessage(chatKey, { id: pinned.id, message_text: pinned.text }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#aaa', padding: '0 2px', display: 'flex', alignItems: 'center' }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                </div>
                            );
                        })()}

                        {/* Chat skeleton */}
                        {chatLoading && (() => {
                            const skeletonClass = isOled ? 'skeleton-bubble-oled' : dm ? 'skeleton-bubble-dark' : 'skeleton-bubble-light';
                            const rows: { own: boolean; w: string; h?: number }[] = [
                                { own: false, w: '52%' }, { own: true, w: '38%' },
                                { own: false, w: '68%' }, { own: false, w: '44%', h: 28 },
                                { own: true, w: '55%' }, { own: true, w: '32%', h: 28 },
                                { own: false, w: '60%' }, { own: true, w: '42%' },
                            ];
                            return (
                                <div className="skeleton-container" style={{ flex: 1, overflowY: 'hidden', padding: isMobile ? '12px 10px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: 10, backgroundColor: dm ? C.bg0 : '#f2f4f8' }}>
                                    {rows.map((r, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: r.own ? 'flex-end' : 'flex-start', animationDelay: `${i * 0.04}s` }}>
                                            {!r.own && <div style={{ width: 28, height: 28, borderRadius: '50%', marginRight: 8, flexShrink: 0, alignSelf: 'flex-end' }} className={`skeleton-bubble ${skeletonClass}`} />}
                                            <div className={`skeleton-bubble ${skeletonClass}`} style={{ width: r.w, height: r.h ?? 36, borderRadius: r.own ? '18px 4px 18px 18px' : '4px 18px 18px 18px', animationDelay: `${i * 0.07}s` }} />
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

                        {/* Сообщения */}
                        <div
                            key={chatKey}
                            ref={messagesContainerRef}
                            className={chatLoading ? undefined : 'messages-reveal'}
                            style={{ ...styles.messagesArea, backgroundColor: dm ? C.bg0 : '#f2f4f8', overflowAnchor: 'none', paddingRight: isMobile ? 10 : 24, paddingLeft: isMobile ? 10 : 24, paddingTop: isMobile ? 12 : 20, position: 'relative', display: chatLoading ? 'none' : undefined }}
                            onScroll={e => {
                                const el = e.currentTarget;
                                const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                                const atBottom = distFromBottom <= 200;
                                setShowScrollDown(!atBottom);
                                if (atBottom) setNewMsgWhileScrolled(0);
                                if (activeChat) scrollPositions.current.set(`${activeChat.type}-${activeChat.id}`, el.scrollTop);
                                if (el.scrollTop < 120 && hasMoreMessages && !loadingMoreMessages) loadMoreMessages();
                            }}
                        >
                            {messages.length >= MSG_LIMIT && !loadingMoreMessages && (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
                                    <span style={{ fontSize: 11, color: isOled ? '#5a5a8a' : dm ? '#4a4a6a' : '#c4b5fd', background: isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.07)', borderRadius: 10, padding: '3px 12px' }}>
                                        {lang === 'en' ? `Showing last ${MSG_LIMIT} messages` : `Показаны последние ${MSG_LIMIT} сообщений`}
                                    </span>
                                </div>
                            )}
                            {loadingMoreMessages && (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
                                    <div style={{ width: 20, height: 20, border: `2px solid ${dm ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.2)'}`, borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                </div>
                            )}
                            {(() => {
                                const filtered = visibleMessages;
                                let lastDay = '';
                                const items: React.ReactNode[] = [];
                                filtered.forEach(msg => {
                                    // Skip comments in channel feed — they belong to the comments panel
                                    const willSkip = isChannelChat && !!(msg as any).reply_to_id;
                                    const day = getMsgDay(msg.timestamp);
                                    if (!willSkip && day && day !== lastDay) {
                                        lastDay = day;
                                        items.push(
                                            <div key={`sep-${day}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '10px 0' }}>
                                                <span style={{ fontSize: 11, color: isOled ? 'rgba(167,139,250,0.55)' : (dm ? '#888' : '#aaa'), whiteSpace: 'nowrap', padding: '2px 10px', backgroundColor: isOled ? 'rgba(167,139,250,0.06)' : (dm ? C.bg6 : '#efefef'), borderRadius: 10, border: isOled ? '1px solid rgba(167,139,250,0.12)' : 'none' }}>
                                                    {getDateLabel(msg.timestamp)}
                                                </span>
                                            </div>
                                        );
                                    }
                                    if ((msg as any).is_system) {
                                        items.push(
                                            <div key={msg.id} className="msg-in" style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                                                <span style={{ fontSize: 12, color: dm ? '#888' : '#aaa', backgroundColor: dm ? C.bg6 : '#efefef', padding: '3px 12px', borderRadius: 10 }}>
                                                    {msg.message_text}
                                                </span>
                                            </div>
                                        );
                                        return;
                                    }

                                    // === Channel post rendering ===
                                    if (isChannelChat) {
                                        if ((msg as any).reply_to_id) return; // skip comments, shown in panel
                                        const commentCount = channelCommentCounts[msg.id] || 0;
                                        const isActive = commentPostId === msg.id;
                                        const senderName = activeGroup?.name || (msg as any).sender_name || currentUsername;
                                        const avatarSrc = activeGroup?.avatar ? config.fileUrl(activeGroup.avatar) : null;
                                        const filesArr: any[] = (() => { try { const f = (msg as any).files; return f ? (typeof f === 'string' ? JSON.parse(f) : f) : []; } catch { return []; } })();
                                        const isImgFile = (n: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test(n);
                                        items.push(
                                            <div key={msg.id} id={`msg-${msg.id}`} className="msg-in"
                                                onMouseEnter={() => setHoveredMsgId(msg.id)}
                                                onMouseLeave={() => setHoveredMsgId(null)}
                                                style={{ position: 'relative', margin: '0 auto 12px auto', maxWidth: 600,
                                                    background: isOled
                                                        ? (isActive ? 'linear-gradient(150deg, #12103a, #1a1650)' : 'linear-gradient(150deg, #0a0818, #0f0c22)')
                                                        : dm
                                                            ? (isActive ? 'linear-gradient(150deg, #1e1c52, #252268)' : 'linear-gradient(150deg, #16153a, #1e1c48)')
                                                            : (isActive ? 'linear-gradient(150deg, #ede9fe, #e8e2ff)' : 'linear-gradient(150deg, #f8f6ff, #f0edff)'),
                                                    borderRadius: 18, padding: '14px 16px',
                                                    boxShadow: isActive
                                                        ? isOled
                                                            ? '0 0 0 1.5px rgba(167,139,250,0.55), 0 8px 36px rgba(124,58,237,0.35), 0 2px 8px rgba(0,0,0,0.5)'
                                                            : dm
                                                                ? '0 0 0 1.5px rgba(99,102,241,0.5), 0 8px 32px rgba(99,102,241,0.28), 0 2px 6px rgba(0,0,0,0.3)'
                                                                : '0 0 0 1.5px rgba(99,102,241,0.35), 0 6px 28px rgba(99,102,241,0.18)'
                                                        : isOled
                                                            ? '0 4px 24px rgba(109,40,217,0.22), 0 0 0 1px rgba(139,92,246,0.16), 0 2px 8px rgba(0,0,0,0.6)'
                                                            : dm
                                                                ? '0 4px 20px rgba(99,102,241,0.18), 0 0 0 1px rgba(99,102,241,0.13), 0 2px 6px rgba(0,0,0,0.25)'
                                                                : '0 4px 18px rgba(99,102,241,0.12), 0 0 0 1px rgba(99,102,241,0.09)',
                                                    transition: 'all 0.2s' }}>
                                                {/* Post header */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarSrc ? (dm ? '#16162a' : 'white') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'white', fontSize: 13, overflow: 'hidden', flexShrink: 0 }}>
                                                        {avatarSrc ? <img src={avatarSrc} alt={senderName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : senderName[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontWeight: 700, fontSize: 14, color: isOled ? '#c4b5fd' : (dm ? '#e0e0f0' : '#1e1b4b') }}>{senderName}</div>
                                                        <div style={{ fontSize: 11, color: isOled ? '#5a4a7a' : (dm ? '#5a5a8a' : '#9ca3af') }}>{new Date(msg.timestamp).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{msg.edited_at && <span style={{ marginLeft: 6, color: isOled ? '#5a4a7a' : (dm ? '#5a5a8a' : '#bbb') }}>{t('edited')}</span>}</div>
                                                    </div>
                                                    {/* Hover action buttons */}
                                                    {(isGroupAdmin || msg.sender_id === currentUserId) && hoveredMsgId === msg.id && editingMessageId !== msg.id && (
                                                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                                            {(isGroupAdmin || msg.sender_id === currentUserId) && (
                                                                <button onClick={e => { e.stopPropagation(); handleEdit(msg.id, msg.message_text ?? ''); }}
                                                                    style={{ background: dm ? 'rgba(99,102,241,0.15)' : '#f0eeff', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={t('Edit')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                                                            )}
                                                            {(isGroupAdmin || msg.sender_id === currentUserId) && (
                                                                <button onClick={e => { e.stopPropagation(); handleDelete(msg.id); }}
                                                                    style={{ background: dm ? 'rgba(239,68,68,0.1)' : '#fff0f0', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={t('Delete')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Post content */}
                                                <div style={editingMessageId === msg.id ? { outline: `2px solid ${isOled ? '#a78bfa' : '#6366f1'}`, borderRadius: 12, outlineOffset: 2 } : {}}>
                                                    {filesArr.length > 0 && (
                                                        <div style={{ marginBottom: msg.message_text ? 8 : 0 }}>
                                                            {filesArr.filter((f: any) => isImgFile(f.filename || '')).length > 0
                                                                ? <ImageGrid images={filesArr.filter((f: any) => isImgFile(f.filename || '')).map((f: any) => ({ url: f.file_path?.startsWith('http') ? f.file_path : `${BASE_URL}${f.file_path}`, name: f.filename || '' }))} />
                                                                : filesArr.map((f: any, i: number) => <FileMessage key={i} filePath={f.file_path} filename={f.filename || ''} fileSize={f.file_size} isOwn={false} isDark={dm} />)
                                                            }
                                                        </div>
                                                    )}
                                                    {!filesArr.length && msg.file_path && <FileMessage filePath={msg.file_path} filename={msg.filename || ''} fileSize={msg.file_size} isOwn={false} isDark={dm} />}
                                                    {msg.message_text && (isSticker(msg.message_text)
                                                        ? <img src={specialUrl(msg.message_text)} alt={lang === 'en' ? 'sticker' : 'стикер'} style={{ maxWidth: 160, maxHeight: 160, display: 'block', objectFit: 'contain', borderRadius: 8 }} />
                                                        : isGif(msg.message_text)
                                                        ? <img src={specialUrl(msg.message_text)} alt="GIF" style={{ maxWidth: 240, borderRadius: 10, display: 'block' }} />
                                                        : isPoll(msg.message_text)
                                                        ? (() => { const pid = getPollId(msg.message_text); return pid ? <PollMessage key={`poll-${pid}`} pollId={pid} token={token} isDark={dm} isOled={isOled} isOwn={false} /> : null; })()
                                                        : isGeo(msg.message_text)
                                                        ? (() => { const geo = getGeo(msg.message_text); if (!geo) return null; const mapsUrl = `https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=15/${geo.lat}/${geo.lon}`; const mapSrc = `https://static-maps.yandex.ru/1.x/?lang=ru_RU&ll=${geo.lon},${geo.lat}&z=15&l=map&size=560,220&pt=${geo.lon},${geo.lat},pm2rdl`; return (<a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textDecoration: 'none', borderRadius: 14, overflow: 'hidden', margin: '-11px -15px 0', width: 'calc(100% + 30px)', maxWidth: isMobile ? '100%' : 300 }}><div style={{ position: 'relative', height: 148 }}><img src={mapSrc} alt="map" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /><div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-60%)', width: 22, height: 22, borderRadius: '50%', background: '#ef4444', border: '3px solid white', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }} /></div><div style={{ padding: '9px 13px 24px', background: dm ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={dm ? '#a5b4fc' : '#6366f1'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span style={{ fontSize: 13, fontWeight: 700, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{geo.name}</span></div>{geo.address && geo.address !== geo.name && <div style={{ fontSize: 11, color: dm ? '#7c7caa' : '#6b7280', marginTop: 3, marginLeft: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{geo.address}</div>}</div></a>); })()
                                                        : isContact(msg.message_text)
                                                        ? (() => { const ct = getContact(msg.message_text); if (!ct) return null; const avatarSrc = ct.avatar ? config.fileUrl(ct.avatar) : null; return (<div onClick={() => { const u = users.find((u: any) => u.id === ct.id); if (u) setSelectedUserForProfile(u); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', cursor: 'pointer' }}><div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: ct.avatar_color || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{avatarSrc ? <img src={avatarSrc} alt={ct.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'white', fontWeight: 700, fontSize: 17 }}>{ct.username[0]?.toUpperCase()}</span>}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ct.username}</div><div style={{ fontSize: 11, color: dm ? '#7c7caa' : '#6b7280', marginTop: 1 }}>{lang === 'en' ? 'Contact' : 'Контакт'}</div></div><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={dm ? '#5a5a8a' : '#9ca3af'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>); })()
                                                        : <div style={{ fontSize: 14, color: dm ? '#d0d0e8' : '#374151', lineHeight: 1.55, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{msg.message_text}</div>
                                                    )}
                                                </div>
                                                {/* Footer: reactions + comment button */}
                                                {editingMessageId !== msg.id && (
                                                    <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${isOled ? 'rgba(167,139,250,0.07)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)'}` }}>
                                                        {/* Reaction bubbles */}
                                                        {reactions[msg.id]?.length > 0 && (() => {
                                                            const grouped: Record<string, number[]> = {};
                                                            for (const r of reactions[msg.id]) {
                                                                if (!grouped[r.emoji]) grouped[r.emoji] = [];
                                                                grouped[r.emoji].push(r.user_id);
                                                            }
                                                            return (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                                                                    {Object.entries(grouped).map(([emoji, userIds]) => (
                                                                        <button key={emoji} onClick={() => toggleReaction(msg.id, true, emoji)}
                                                                            style={{ padding: '3px 8px', borderRadius: 12, border: `1px solid ${userIds.includes(currentUserId) ? '#6366f1' : (dm ? C.bdr2 : '#e0e0f0')}`, background: userIds.includes(currentUserId) ? (dm ? 'rgba(99,102,241,0.2)' : '#ede9fe') : (dm ? C.bg5 : 'white'), cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                            {emoji}<span style={{ fontSize: 11, color: dm ? '#a5b4fc' : '#6366f1', fontWeight: 600 }}>{userIds.length}</span>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })()}
                                                        {/* Action buttons row */}
                                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                            {/* View count */}
                                                            <PostViewTracker
                                                                messageId={msg.id}
                                                                groupId={activeChat!.id}
                                                                token={token}
                                                                currentUserId={currentUserId}
                                                                senderId={msg.sender_id}
                                                                initialCount={postViews[msg.id] ?? (msg as any).view_count ?? 0}
                                                                isDark={dm}
                                                                onView={count => setPostViews(prev => ({ ...prev, [msg.id]: count }))}
                                                            />
                                                            <button
                                                                onClick={() => setCommentPostId(isActive ? null : msg.id)}
                                                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 10, border: 'none', background: isActive ? (isOled ? 'rgba(167,139,250,0.15)' : 'rgba(99,102,241,0.12)') : 'transparent', cursor: 'pointer', color: isActive ? (isOled ? '#a78bfa' : '#6366f1') : (dm ? '#5a5a8a' : '#9ca3af'), fontSize: 13, fontWeight: isActive ? 700 : 500, transition: 'all 0.15s' }}>
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                                                {commentCount > 0 ? (lang === 'en' ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : `${commentCount} комментар${commentCount === 1 ? 'ий' : commentCount < 5 ? 'ия' : 'иев'}`) : (lang === 'en' ? 'Comment' : 'Комментировать')}
                                                            </button>
                                                            {/* Emoji picker button */}
                                                            {(() => {
                                                                const quickReactions = (() => { try { return JSON.parse(localStorage.getItem('aurora_quick_reactions') || 'null') || ['👍','❤️','😂','😮','😢','🔥','🎉','👏']; } catch { return ['👍','❤️','😂','😮','😢','🔥','🎉','👏']; } })();
                                                                const msgRx = reactions[msg.id] || [];
                                                                const [showPostFullPicker, setShowPostFullPicker] = [reactionPickerMsgId === msg.id && showFullReactionPicker, (v: boolean) => { if (v) { setReactionPickerMsgId(msg.id); setShowFullReactionPicker(true); } else setShowFullReactionPicker(false); }];
                                                                return (
                                                                <div style={{ position: 'relative', marginLeft: 'auto' }}>
                                                                    <button
                                                                        onClick={e => { e.stopPropagation(); setReactionPickerMsgId(p => p === msg.id ? null : msg.id); setShowFullReactionPicker(false); }}
                                                                        style={{ background: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                        😊
                                                                    </button>
                                                                    {reactionPickerMsgId === msg.id && (
                                                                        <div className="reaction-picker-enter" onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: 36, right: 0, background: dm ? C.bg4 : 'white', border: `1px solid ${dm ? C.bdr2 : '#ede9fe'}`, borderRadius: 12, zIndex: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', overflow: 'hidden', width: showPostFullPicker ? 280 : 'auto' }}>
                                                                            {showPostFullPicker ? (
                                                                                <>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: `1px solid ${dm ? C.bdr2 : '#ede9fe'}` }}>
                                                                                        <button onClick={() => setShowPostFullPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: '2px 6px', display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
                                                                                        <span style={{ fontSize: 12, fontWeight: 600, color: dm ? '#e2e8f0' : '#1e1b4b' }}>Реакция</span>
                                                                                    </div>
                                                                                    <FullReactionPicker dm={dm} onSelect={emoji => { toggleReaction(msg.id, true, emoji); setReactionPickerMsgId(null); setShowFullReactionPicker(false); }} onClose={() => setReactionPickerMsgId(null)} />
                                                                                </>
                                                                            ) : (
                                                                                <div style={{ display: 'flex', alignItems: 'center', padding: '6px 6px', gap: 2 }}>
                                                                                    {quickReactions.slice(0, 7).map((emoji: string) => {
                                                                                        const active = msgRx.some(r => r.user_id === currentUserId && r.emoji === emoji);
                                                                                        return (
                                                                                            <button key={emoji} onClick={() => { toggleReaction(msg.id, true, emoji); setReactionPickerMsgId(null); }}
                                                                                                style={{ background: active ? (dm ? 'rgba(99,102,241,0.25)' : '#ede9fe') : 'none', border: active ? '1.5px solid #6366f1' : '1.5px solid transparent', borderRadius: 10, cursor: 'pointer', fontSize: 20, padding: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s' }}
                                                                                                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.25)')}
                                                                                                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}>
                                                                                                {emoji}
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                    <button onClick={() => setShowPostFullPicker(true)}
                                                                                        style={{ background: 'none', border: '1.5px solid transparent', borderRadius: 10, cursor: 'pointer', fontSize: 18, padding: '3px 5px', color: dm ? '#a5b4fc' : '#6366f1', marginLeft: 2 }}
                                                                                        title={lang === 'en' ? 'All emoji' : 'Все эмодзи'}>
                                                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                                                                                    </button>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                        return;
                                    }

                                    const isOwn = msg.sender_id === currentUserId;
                                    const senderUser = !isOwn ? (usersById.get(msg.sender_id) || groupMembersCache[activeChat.id]?.find(u => u.id === msg.sender_id) as any) : null;
                                    const senderAvatar = ('sender_avatar' in msg ? (msg as any).sender_avatar : null) || senderUser?.avatar || null;
                                    const senderAvatarColor = (msg as any).sender_avatar_color || senderUser?.avatar_color || '#6366f1';
                                    const senderInitial = ((msg as any).sender_name || senderUser?.username || '?')[0]?.toUpperCase() || '?';
                                    const hasReactions = (reactions[msg.id]?.length || 0) > 0;
                                    const isSelected = selectedMsgIds.has(msg.id);
                                    const isSwiping = isMobile && swipingMsgId === msg.id;
                                    const msgSwipeX = isSwiping ? swipeOffset : 0;
                                    items.push(
                                    <div
                                        key={msg.id}
                                        id={`msg-${msg.id}`}
                                        {...(!isOwn ? { 'data-group-msg-id': msg.id } : {})}
                                        className={deletingMsgIds.has(msg.id) ? 'msg-delete' : (isOwn ? 'msg-in-own' : 'msg-in-other')}
                                        onMouseEnter={() => !selectionMode && setHoveredMsgId(msg.id)}
                                        onMouseLeave={() => { setHoveredMsgId(null); setReactionPickerMsgId(null); }}
                                        onClick={selectionMode ? () => toggleMsgSelection(msg.id) : undefined}
                                        onDoubleClick={selectionMode ? undefined : () => {
                                            const primaryReaction = (() => { try { return JSON.parse(localStorage.getItem('aurora_quick_reactions') || 'null')?.[0]; } catch { return null; } })() || '👍';
                                            const isGroup = activeChat.type === 'group';
                                            toggleReaction(msg.id, isGroup, primaryReaction);
                                        }}
                                        style={{
                                            display: 'flex',
                                            justifyContent: isOwn ? 'flex-end' : 'flex-start',
                                            alignItems: selectionMode ? 'center' : 'flex-end',
                                            gap: 6,
                                            marginBottom: 12,
                                            cursor: selectionMode ? 'pointer' : 'default',
                                            transform: msgSwipeX > 0 ? `translateX(${msgSwipeX}px)` : undefined,
                                            transition: isSwiping ? 'background-color 0.1s' : 'transform 0.2s cubic-bezier(0.4,0,0.2,1), background-color 0.1s',
                                            position: 'relative' as const,
                                            backgroundColor: selectionMode && isSelected
                                                ? (dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.07)')
                                                : (chatSearchQuery.trim() && chatSearchMatches[chatSearchIdx] === msg.id)
                                                ? (dm ? 'rgba(234,179,8,0.15)' : 'rgba(234,179,8,0.12)')
                                                : (chatSearchQuery.trim() && chatSearchMatches.includes(msg.id))
                                                ? (dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)')
                                                : 'transparent',
                                            borderRadius: 10,
                                            padding: selectionMode ? '2px 6px' : '0',
                                        }}
                                    >
                                        {/* Swipe-to-reply indicator */}
                                        {isSwiping && msgSwipeX > 8 && (
                                            <div style={{ position: 'absolute', left: isOwn ? undefined : -36, right: isOwn ? -36 : undefined, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: Math.min(msgSwipeX / 52, 1), zIndex: 0 }}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                                            </div>
                                        )}
                                        {selectionMode && (
                                            <div style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', border: `2px solid ${isSelected ? '#6366f1' : (dm ? '#5a5a8a' : '#c4b5fd')}`, backgroundColor: isSelected ? '#6366f1' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', order: 0 }}>
                                                {isSelected && <svg width="12" height="12" viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                            </div>
                                        )}
                                        {!isOwn && (
                                            <div
                                                style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: senderAvatar ? (dm ? C.bg2 : '#f3f4f6') : senderAvatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', fontSize: 12, color: 'white', fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-end', marginBottom: hasReactions ? 32 : 2 }}
                                                onClick={() => { setSelectedUserForProfile(senderUser ?? { id: msg.sender_id, username: (msg as any).sender_name || '', email: '', created_at: '', avatar: senderAvatar || undefined, avatar_color: senderAvatarColor }); }}
                                                title={`${t('Profile')} ${(msg as any).sender_name || senderUser?.username || ''}`}
                                            >
                                                {senderAvatar
                                                    ? <img src={config.fileUrl(senderAvatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    : senderInitial
                                                }
                                            </div>
                                        )}

                                        <div style={{ position: 'relative', display: 'inline-block', maxWidth: isMediaOnlyMsg(msg) ? (isMobile ? '88%' : '72%') : hasMediaWithCaption(msg) ? (isMobile ? 'min(300px, 78vw)' : 380) : (isMobile ? '82%' : '62%') }}>
                                        {/* Media pre-bubble: фото/видео отдельным пузырём когда есть и не-медиа файлы */}
                                        {(() => {
                                            const filesRaw = (msg as any).files;
                                            if (!filesRaw) return null;
                                            const filesArr = typeof filesRaw === 'string' ? JSON.parse(filesRaw) : filesRaw;
                                            if (!Array.isArray(filesArr) || filesArr.length === 0) return null;
                                            const IS_MEDIA = (fn: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|webm|mov|avi|mkv|m4v)$/i.test(fn);
                                            const mediaFiles = filesArr.filter((f: any) => IS_MEDIA(f.filename || ''));
                                            const nonMediaFiles = filesArr.filter((f: any) => !IS_MEDIA(f.filename || ''));
                                            if (mediaFiles.length === 0 || nonMediaFiles.length === 0) return null;
                                            const IS_VID = (fn: string) => /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(fn);
                                            const IS_IMG = (fn: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fn);
                                            const toUrl = (fp: string) => fp?.startsWith('http') ? fp : `${BASE_URL}${fp}`;
                                            const playVideo = (src: string, fn: string) => { setNowPlayingVideo({ src, filename: fn }); setTimeout(() => { if (floatingVideoRef.current) { floatingVideoRef.current.src = src; floatingVideoRef.current.play().catch(() => {}); } }, 100); };
                                            return (
                                                <div style={{ borderRadius: isOwn ? '18px 4px 18px 18px' : '4px 18px 18px 18px', overflow: 'hidden', display: 'block', marginBottom: 4, maxWidth: isMobile ? 300 : 340 }}>
                                                    {mediaFiles.length === 1 ? (
                                                        <FileMessage
                                                            filePath={mediaFiles[0].file_path} filename={mediaFiles[0].filename || 'file'} fileSize={mediaFiles[0].file_size}
                                                            isOwn={isOwn} isGroup={activeChat.type === 'group'} isDark={dm}
                                                            inBubble={false} hasCaption={false}
                                                            onPlay={playGlobalAudio} onPlayVideo={playVideo}
                                                            nowPlayingSrc={nowPlaying?.src} globalPlaying={globalPlaying} globalCurrentTime={globalCurrentTime} globalDuration={globalDuration} onGlobalSeek={seekGlobal} onGlobalToggle={toggleGlobalPlay} onDurationKnown={handleDurationKnown}
                                                            knownDuration={knownAudioDurations.current.get(mediaFiles[0].file_path?.startsWith('http') ? mediaFiles[0].file_path : `${BASE_URL}${mediaFiles[0].file_path}`)}
                                                        />
                                                    ) : (
                                                        <MediaGrid items={mediaFiles.map((f: any) => ({ url: toUrl(f.file_path), name: f.filename || 'file', type: IS_IMG(f.filename || '') ? 'image' as const : 'video' as const, onPlayVideo: IS_VID(f.filename || '') ? playVideo : undefined }))} />
                                                    )}
                                                </div>
                                            );
                                        })()}
                                        <div
                                            onContextMenu={(e) => handleContextMenu(e, msg)}
                                            {...(isMobile ? makeLongPressHandlers(msg) : {})}
                                            style={(() => {
                                                const noBubble = isSpecialMsg(msg.message_text) || isMediaOnlyMsg(msg);
                                                if (noBubble) return {
                                                    maxWidth: '100%',
                                                    padding: 0,
                                                    background: 'transparent',
                                                    backgroundColor: 'transparent',
                                                    boxShadow: 'none',
                                                    borderRadius: 0,
                                                    fontSize: theme.fontSize,
                                                    wordBreak: 'break-word' as const,
                                                    position: 'relative' as const, // keep absolute timestamp inside the image, not the outer container
                                                };
                                                const mediaCap = hasMediaWithCaption(msg);
                                                const geoMsg = isGeo(msg.message_text);
                                                const ownInsetShadow = isOled
                                                    ? ', inset 0 1px 0 rgba(255,255,255,0.08)'
                                                    : dm ? ', inset 0 1px 0 rgba(255,255,255,0.1)' : '';
                                                return {
                                                    maxWidth: '100%',
                                                    padding: '10px 14px',
                                                    borderRadius: isOwn ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
                                                    overflow: geoMsg ? ('hidden' as const) : undefined,
                                                    wordBreak: 'break-word' as const,
                                                    fontSize: theme.fontSize,
                                                    boxShadow: isOwn
                                                        ? isOled
                                                            ? `0 4px 16px rgba(109,40,217,0.38), 0 2px 6px rgba(0,0,0,0.5)${mediaCap ? '' : ownInsetShadow}`
                                                            : dm
                                                                ? `0 4px 14px rgba(99,102,241,0.24), 0 2px 5px rgba(0,0,0,0.3)${mediaCap ? '' : ownInsetShadow}`
                                                                : '0 3px 11px rgba(99,102,241,0.19), 0 1px 3px rgba(99,102,241,0.1)'
                                                        : isOled
                                                            ? '0 3px 14px rgba(109,40,217,0.23), 0 2px 8px rgba(0,0,0,0.6)'
                                                            : dm
                                                                ? '0 3px 11px rgba(99,102,241,0.17), 0 2px 6px rgba(0,0,0,0.3)'
                                                                : '0 2px 8px rgba(0,0,0,0.07)',
                                                    ...(isOwn
                                                        ? { background: isOled
                                                                ? `linear-gradient(150deg, #5b21b6 0%, #7c3aed 60%, #6d28d9 100%)`
                                                                : `linear-gradient(150deg, ${theme.bubbleOwnColor} 0%, #8b5cf6 60%, #7c3aed 100%)`,
                                                            color: 'white' }
                                                        : isOled
                                                            ? { background: `linear-gradient(150deg, #17122e 0%, #1f1840 60%, #251e4a 100%)`, color: '#e2d9ff' }
                                                            : dm
                                                                ? { background: theme.bubbleOtherColor === '#e8e8e8' ? `linear-gradient(150deg, #252048 0%, #2d2960 60%, #322e6a 100%)` : `linear-gradient(150deg, ${theme.bubbleOtherColor}, ${theme.bubbleOtherColor}cc)`, color: '#ede8ff' }
                                                                : { background: theme.bubbleOtherColor === '#e8e8e8' ? `linear-gradient(150deg, #f8f6ff, #ede9fe)` : `linear-gradient(150deg, ${theme.bubbleOtherColor}ee, ${theme.bubbleOtherColor})`, color: '#1e1b4b' }
                                                    ),
                                                };
                                            })()}
                                        >
                                            {!isOwn && 'sender_name' in msg && (() => {
                                                const bubbleBg = isOled ? '#17122e' : dm
                                                    ? (theme.bubbleOtherColor === '#e8e8e8' ? '#252048' : theme.bubbleOtherColor)
                                                    : (theme.bubbleOtherColor === '#e8e8e8' ? '#f5f3ff' : theme.bubbleOtherColor);
                                                const nameColor = isBgDark(bubbleBg) ? '#c4b5fd' : '#6366f1';
                                                return <div style={{ ...styles.senderName, color: nameColor, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    {msg.sender_name}
                                                    {((msg as any).sender_is_developer || usersById.get((msg as any).sender_id)?.is_developer) && <DevBadge size={14} />}{(usersById.get((msg as any).sender_id) as any)?.is_tester && <TesterBadge size={14} />}
                                                </div>;
                                            })()}

                                            {msg.reply_to_id && (() => {
                                                const rfp = (msg as any).reply_to_file_path;
                                                const replyThumb = rfp && /\.(jpg|jpeg|png|gif|webp)$/i.test(rfp) ? config.fileUrl(rfp) : null;
                                                return (
                                                    <div onClick={() => goToMessage(msg.reply_to_id!)} style={{
                                                        borderLeft: `3px solid ${isOwn ? 'rgba(255,255,255,0.6)' : (isOled ? '#a78bfa' : '#6366f1')}`,
                                                        backgroundColor: isOwn ? 'rgba(255,255,255,0.13)' : (isOled ? 'rgba(167,139,250,0.12)' : (dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.07)')),
                                                        borderRadius: 6,
                                                        padding: '4px 10px',
                                                        marginBottom: 6,
                                                        fontSize: 12,
                                                        cursor: 'pointer',
                                                        transition: 'opacity 0.15s',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                    }} onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')} onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                                                        {replyThumb && <img src={replyThumb} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />}
                                                        <div>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: isOwn ? 'rgba(255,255,255,0.8)' : (isOled ? '#c4b5fd' : '#8b5cf6'), marginBottom: 2 }}>
                                                                {msg.reply_to_sender || (lang === 'en' ? 'someone' : 'кто-то')}
                                                            </div>
                                                            <div style={{ color: isOwn ? 'rgba(255,255,255,0.75)' : (isOled ? '#9090b8' : (dm ? '#9090b8' : '#6b7280')), fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                                                                {msg.reply_to_text ? msg.reply_to_text : `📎 ${lang === 'en' ? 'attachment' : 'вложение'}`}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            {/* Editing highlight handled by input bar */}

                                            {/* Forwarded-from banner — always at the top, before file content */}
                                            {msg.message_text?.startsWith('↪️ ') && (() => {
                                                const nl = msg.message_text.indexOf('\n');
                                                const headline = nl !== -1 ? msg.message_text.slice(0, nl) : msg.message_text;
                                                const from = headline.slice('↪️ '.length).replace(/^(Переслано от |Forwarded from )/, '').trim();
                                                return (
                                                    <div style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                                        padding: '3px 10px 3px 7px', borderRadius: 8, marginBottom: 4,
                                                        borderLeft: `2px solid ${isOwn ? 'rgba(255,255,255,0.45)' : (isOled ? '#a78bfa' : '#8b5cf6')}`,
                                                        background: isOwn ? 'rgba(255,255,255,0.1)' : (isOled ? 'rgba(167,139,250,0.07)' : dm ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.06)'),
                                                        maxWidth: 'fit-content',
                                                    }}>
                                                        <span style={{ opacity: 0.65, display: 'inline-flex' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg></span>
                                                        <span style={{ fontSize: 11.5, fontStyle: 'italic', fontWeight: 500, color: isOwn ? 'rgba(255,255,255,0.72)' : (isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#7c3aed') }}>
                                                            {lang === 'en' ? 'Forwarded from' : 'Переслано от'}&nbsp;
                                                            <strong style={{ fontWeight: 700, fontStyle: 'normal' }}>{from}</strong>
                                                        </span>
                                                    </div>
                                                );
                                            })()}
                                            {(() => {
                                                // true when there's sender name / reply / forward banner rendered above the media
                                                const hasSenderName = !isOwn && 'sender_name' in msg && !!(msg as any).sender_name;
                                                const hasAboveContent = hasSenderName || !!msg.reply_to_id || !!msg.message_text?.startsWith('↪️ ');
                                                if (!('file_path' in msg) || !msg.file_path) return null;
                                                return (
                                                <FileMessage
                                                    filePath={msg.file_path}
                                                    filename={msg.filename || 'file'}
                                                    fileSize={msg.file_size}
                                                    isOwn={isOwn}
                                                    messageId={msg.id}
                                                    isGroup={activeChat.type === 'group'}
                                                    isDark={dm}
                                                    inBubble={!isMediaOnlyMsg(msg)}
                                                    hasCaption={!isMediaOnlyMsg(msg) && !!msg.message_text?.trim()}
                                                    hasAboveContent={hasAboveContent}
                                                    onPlay={playGlobalAudio}
                                                    onPlayVideo={(src, fn) => { setNowPlayingVideo({ src, filename: fn }); setTimeout(() => { if (floatingVideoRef.current) { floatingVideoRef.current.src = src; floatingVideoRef.current.play().catch(() => {}); } }, 100); }}
                                                    nowPlayingSrc={nowPlaying?.src}
                                                    globalPlaying={globalPlaying}
                                                    globalCurrentTime={globalCurrentTime}
                                                    globalDuration={globalDuration}
                                                    onGlobalSeek={seekGlobal}
                                                    onGlobalToggle={toggleGlobalPlay}
                                                    onDurationKnown={handleDurationKnown}
                                                    knownDuration={knownAudioDurations.current.get(msg.file_path.startsWith('http') ? msg.file_path : `${BASE_URL}${msg.file_path}`)}
                                                    token={token}
                                                />
                                                );
                                            })()}
                                            {(() => {
                                                const filesRaw = (msg as any).files;
                                                if (!filesRaw) return null;
                                                const filesArr = typeof filesRaw === 'string' ? JSON.parse(filesRaw) : filesRaw;
                                                if (!Array.isArray(filesArr) || filesArr.length === 0) return null;
                                                const IS_IMG = (fn: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fn);
                                                const IS_VID = (fn: string) => /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(fn);
                                                const IS_AUD = (fn: string) => /\.(mp3|ogg|wav|flac|aac|m4a|opus|weba)$/i.test(fn);
                                                const toUrl = (fp: string) => fp?.startsWith('http') ? fp : `${BASE_URL}${fp}`;
                                                const playVideo = (src: string, fn: string) => { setNowPlayingVideo({ src, filename: fn }); setTimeout(() => { if (floatingVideoRef.current) { floatingVideoRef.current.src = src; floatingVideoRef.current.play().catch(() => {}); } }, 100); };
                                                // Split into 3 groups preserving order
                                                const mediaFiles = filesArr.filter((f: any) => IS_IMG(f.filename || '') || IS_VID(f.filename || ''));
                                                const audioFiles = filesArr.filter((f: any) => IS_AUD(f.filename || ''));
                                                const docFiles = filesArr.filter((f: any) => { const fn = f.filename || ''; return !IS_IMG(fn) && !IS_VID(fn) && !IS_AUD(fn); });
                                                // Media rendered in pre-bubble above when mixed with non-media
                                                const isMixed = mediaFiles.length > 0 && (audioFiles.length > 0 || docFiles.length > 0);
                                                const showMediaHere = !isMixed && mediaFiles.length > 0;
                                                const hasMedia = showMediaHere;
                                                const hasSenderNameFiles = !isOwn && 'sender_name' in msg && !!(msg as any).sender_name;
                                                const hasAboveContentFiles = hasSenderNameFiles || !!msg.reply_to_id || !!msg.message_text?.startsWith('↪️ ');
                                                return (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: hasMedia ? 0 : 4 }}>
                                                        {/* Media grid only when NOT mixed (mixed = rendered in pre-bubble) */}
                                                        {showMediaHere && (mediaFiles.length === 1 ? (
                                                            <FileMessage
                                                                filePath={mediaFiles[0].file_path}
                                                                filename={mediaFiles[0].filename || 'file'}
                                                                fileSize={mediaFiles[0].file_size}
                                                                isOwn={isOwn} isGroup={activeChat.type === 'group'} isDark={dm}
                                                                inBubble={!isMediaOnlyMsg(msg)} hasCaption={!isMediaOnlyMsg(msg) && !!msg.message_text?.trim()}
                                                                hasAboveContent={hasAboveContentFiles}
                                                                onPlay={playGlobalAudio} onPlayVideo={playVideo}
                                                                nowPlayingSrc={nowPlaying?.src} globalPlaying={globalPlaying} globalCurrentTime={globalCurrentTime} globalDuration={globalDuration} onGlobalSeek={seekGlobal} onGlobalToggle={toggleGlobalPlay} onDurationKnown={handleDurationKnown}
                                                            />
                                                        ) : (
                                                            <MediaGrid items={mediaFiles.map((f: any) => ({ url: toUrl(f.file_path), name: f.filename || 'file', type: IS_IMG(f.filename || '') ? 'image' as const : 'video' as const, onPlayVideo: IS_VID(f.filename || '') ? playVideo : undefined }))} />
                                                        ))}
                                                        {/* Audio players */}
                                                        {audioFiles.map((f: any, i: number) => (
                                                            <FileMessage key={`a${i}`}
                                                                filePath={f.file_path} filename={f.filename || 'file'} fileSize={f.file_size}
                                                                isOwn={isOwn} isGroup={activeChat.type === 'group'} isDark={dm}
                                                                inBubble={false} hasCaption={false}
                                                                onPlay={playGlobalAudio} onPlayVideo={playVideo}
                                                                nowPlayingSrc={nowPlaying?.src} globalPlaying={globalPlaying} globalCurrentTime={globalCurrentTime} globalDuration={globalDuration} onGlobalSeek={seekGlobal} onGlobalToggle={toggleGlobalPlay} onDurationKnown={handleDurationKnown}
                                                                knownDuration={knownAudioDurations.current.get(f.file_path?.startsWith('http') ? f.file_path : `${BASE_URL}${f.file_path}`)}
                                                            />
                                                        ))}
                                                        {/* Documents */}
                                                        {docFiles.map((f: any, i: number) => (
                                                            <FileMessage key={`d${i}`}
                                                                filePath={f.file_path} filename={f.filename || 'file'} fileSize={f.file_size}
                                                                isOwn={isOwn} isGroup={activeChat.type === 'group'} isDark={dm}
                                                                inBubble={false} hasCaption={false}
                                                                onPlay={playGlobalAudio} onPlayVideo={playVideo}
                                                                nowPlayingSrc={nowPlaying?.src} globalPlaying={globalPlaying} globalCurrentTime={globalCurrentTime} globalDuration={globalDuration} onGlobalSeek={seekGlobal} onGlobalToggle={toggleGlobalPlay} onDurationKnown={handleDurationKnown}
                                                            />
                                                        ))}
                                                    </div>
                                                );
                                            })()}

                                            {msg.message_text && (() => {
                                                const isRead = (msg as any).is_read;
                                                const isSearchMatch = chatSearchOpen && chatSearchQuery.length > 0 && chatSearchMatches.includes(msg.id);
                                                const isActiveSearchMatch = isSearchMatch && chatSearchMatches[chatSearchIdx] === msg.id;
                                                // Shared time+tick overlay for stickers/GIFs
                                                const timeOverlay = (
                                                    <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 8, padding: '2px 7px', pointerEvents: 'none' }}>
                                                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.92)', fontFamily: 'inherit' }}>{formatTime(msg.timestamp)}</span>
                                                        {isOwn && (isRead ? (
                                                            <svg width="16" height="10" viewBox="0 0 18 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke="#93c5fd" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                        ) : (
                                                            <svg width="11" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5L4.5 8.5L11 1.5" stroke="rgba(255,255,255,0.75)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                        ))}
                                                    </div>
                                                );

                                                const isPrivate = activeChat?.type === 'private';
                                                const isBeingEdited = editingMessageId === msg.id;
                                                const rawText = isBeingEdited ? (editingText || msg.message_text || '') : (msg.message_text || '');
                                                const displayText = isBeingEdited ? rawText : (isPrivate ? getDisplayText(msg, activeChat!.id) : rawText);
                                                const encLocked = isEncryptedMessage(msg.message_text) && displayText === '🔒';

                                                const playlistData = !encLocked ? parsePlaylistMsg(displayText) : null;
                                                if (playlistData) {
                                                    return (
                                                        <PlaylistBubble
                                                            data={playlistData}
                                                            isOwn={isOwn}
                                                            dm={dm}
                                                            isOled={isOled}
                                                            onClick={() => setPlaylistPreview(playlistData)}
                                                        />
                                                    );
                                                }

                                                if (!encLocked && (isSticker(msg.message_text) || isGif(msg.message_text))) {
                                                    const stickerIsSt = isSticker(msg.message_text);
                                                    const stickerData = stickerIsSt ? parseStickerData(msg.message_text!) : null;
                                                    return (
                                                        <div
                                                            style={{ position: 'relative', display: 'inline-block', borderRadius: 16, overflow: 'hidden', cursor: stickerIsSt ? 'pointer' : 'default' }}
                                                            onClick={stickerIsSt ? () => setStickerPackPreview(stickerData) : undefined}
                                                        >
                                                            <img
                                                                src={specialUrl(msg.message_text)}
                                                                alt={stickerIsSt ? (lang === 'en' ? 'sticker' : 'стикер') : 'GIF'}
                                                                style={{ maxWidth: 220, maxHeight: 220, display: 'block', objectFit: 'contain', borderRadius: 16 }}
                                                            />
                                                            {timeOverlay}
                                                        </div>
                                                    );
                                                }
                                                if (!encLocked && isPoll(msg.message_text)) {
                                                    const pid = getPollId(msg.message_text);
                                                    if (pid) return <PollMessage key={`poll-${pid}`} pollId={pid} token={token} isDark={dm} isOled={isOled} isOwn={isOwn} />;
                                                }
                                                if (!encLocked && isGeo(msg.message_text)) {
                                                    const geo = getGeo(msg.message_text);
                                                    if (geo) {
                                                        const mapSrc = `https://static-maps.yandex.ru/1.x/?lang=ru_RU&ll=${geo.lon},${geo.lat}&z=15&l=map&size=560,220&pt=${geo.lon},${geo.lat},pm2rdl`;
                                                        const mapsUrl = `https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=15/${geo.lat}/${geo.lon}`;
                                                        const geoIsRead = !!(msg as any).is_read;
                                                        const geoHasAbove = (!isOwn && 'sender_name' in msg && !!(msg as any).sender_name) || !!msg.reply_to_id;
                                                        return (
                                                            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textDecoration: 'none', margin: `${geoHasAbove ? '0' : '-10px'} -14px -10px`, minWidth: isMobile ? 220 : 260 }}>
                                                                <div style={{ position: 'relative', height: isMobile ? 130 : 160, background: dm ? '#1a1a2e' : '#e5e7eb' }}>
                                                                    <img src={mapSrc} alt="map" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-60%)' }}>
                                                                        <svg width="28" height="36" viewBox="0 0 28 36" fill="none">
                                                                            <path d="M14 0C6.27 0 0 6.27 0 14c0 9.94 14 22 14 22S28 23.94 28 14C28 6.27 21.73 0 14 0z" fill="#ef4444"/>
                                                                            <circle cx="14" cy="14" r="6" fill="white"/>
                                                                        </svg>
                                                                    </div>
                                                                </div>
                                                                <div style={{ padding: '8px 10px 9px', background: isOwn ? 'rgba(0,0,0,0.18)' : (dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)') }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={isOwn ? 'rgba(255,255,255,0.85)' : (dm ? '#a5b4fc' : '#6366f1')} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                                                        <span style={{ fontSize: 12, fontWeight: 700, color: isOwn ? 'white' : (dm ? '#e2e8f0' : '#1e1b4b'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{geo.name}</span>
                                                                    </div>
                                                                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
                                                                        <div style={{ fontSize: 10, color: isOwn ? 'rgba(255,255,255,0.6)' : (dm ? '#7c7caa' : '#6b7280'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                                                            {geo.address && geo.address !== geo.name ? geo.address : `${Number(geo.lat).toFixed(5)}, ${Number(geo.lon).toFixed(5)}`}
                                                                        </div>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, fontSize: 10, color: isOwn ? 'rgba(255,255,255,0.7)' : (dm ? '#7c7caa' : '#9ca3af') }}>
                                                                            {formatTime(msg.timestamp)}
                                                                            {isOwn && (geoIsRead
                                                                                ? <svg width="16" height="10" viewBox="0 0 18 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke="#93c5fd" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                                                : <svg width="11" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5L4.5 8.5L11 1.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </a>
                                                        );
                                                    }
                                                }
                                                if (!encLocked && isContact(msg.message_text)) {
                                                    const ct = getContact(msg.message_text);
                                                    if (ct) {
                                                        const avatarSrc = ct.avatar ? config.fileUrl(ct.avatar) : null;
                                                        const ctIsRead = !!(msg as any).is_read;
                                                        return (
                                                            <div onClick={() => { const u = users.find(u => u.id === ct.id); if (u) setSelectedUserForProfile(u); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0', cursor: 'pointer' }}>
                                                                <div style={{ width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: ct.avatar_color || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                    {avatarSrc ? <img src={avatarSrc} alt={ct.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'white', fontWeight: 700, fontSize: 17 }}>{ct.username[0]?.toUpperCase()}</span>}
                                                                </div>
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <div style={{ fontSize: 14, fontWeight: 700, color: isOwn ? 'white' : (dm ? '#e2e8f0' : '#1e1b4b'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ct.username}</div>
                                                                    <div style={{ fontSize: 11, color: isOwn ? 'rgba(255,255,255,0.6)' : (dm ? '#7c7caa' : '#6b7280'), marginTop: 2 }}>{lang === 'en' ? 'Contact' : 'Контакт'}</div>
                                                                </div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, flexShrink: 0, alignSelf: 'stretch' }}>
                                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isOwn ? 'rgba(255,255,255,0.6)' : (dm ? '#5a5a8a' : '#9ca3af')} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: isOwn ? 'rgba(255,255,255,0.6)' : (dm ? '#7c7caa' : '#9ca3af') }}>
                                                                        {formatTime(msg.timestamp)}
                                                                        {isOwn && (ctIsRead ? <svg width="16" height="10" viewBox="0 0 18 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke="#93c5fd" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg width="11" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5L4.5 8.5L11 1.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                }
                                                if (!encLocked && isCallEnded(msg.message_text)) {
                                                    const dur = getCallDuration(msg.message_text);
                                                    const mins = Math.floor(dur / 60), secs = dur % 60;
                                                    const durStr = dur > 0 ? ` · ${mins > 0 ? `${mins} мин ` : ''}${secs} сек` : '';
                                                    const callIsRead = !!(msg as any).is_read;
                                                    return (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isOwn ? 'rgba(255,255,255,0.85)' : (dm ? '#a5b4fc' : '#6366f1')} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l1.8-1.8a2 2 0 0 1 2.11-.45c.9.32 1.85.55 2.81.68a2 2 0 0 1 1.72 2.03z"/></svg>
                                                            <span style={{ fontSize: 13, fontWeight: 500, color: isOwn ? 'rgba(255,255,255,0.85)' : (dm ? '#a5b4fc' : '#6366f1'), flex: 1 }}>{lang === 'en' ? 'Call ended' : 'Звонок завершён'}{durStr}</span>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: isOwn ? 'rgba(255,255,255,0.6)' : (dm ? '#7c7caa' : '#9ca3af'), flexShrink: 0 }}>
                                                                {formatTime(msg.timestamp)}
                                                                {isOwn && (callIsRead ? <svg width="16" height="10" viewBox="0 0 18 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke="#93c5fd" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg width="11" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5L4.5 8.5L11 1.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>)}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                if (!encLocked && isSingleEmoji(displayText)) {
                                                    return <div style={{ fontSize: 52, lineHeight: 1.1, marginTop: (('file_path' in msg && msg.file_path) || (msg as any).files?.length) ? 6 : 0, userSelect: 'none' }}>{displayText}</div>;
                                                }
                                                const hasFile = ('file_path' in msg && msg.file_path) || (msg as any).files?.length;
                                                const fwdMatch = !encLocked && displayText.startsWith('↪️ ');
                                                // Banner already rendered above file; extract only the body text
                                                let fwdBody = '';
                                                if (fwdMatch) {
                                                    const nl = displayText.indexOf('\n');
                                                    const after = nl !== -1 ? displayText.slice(nl + 1).trim() : '';
                                                    fwdBody = after.startsWith('📎') ? '' : after;
                                                    if (!fwdBody) return null; // nothing left to show
                                                }
                                                const previewUrl = !encLocked && !fwdMatch ? extractFirstUrl(displayText) : null;
                                                return (
                                                    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: hasFile ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                        {encLocked ? (
                                                            <span style={{ opacity: 0.7, fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Зашифровано</span>
                                                        ) : fwdMatch ? (
                                                            isPoll(fwdBody)
                                                                ? (() => { const pid = getPollId(fwdBody); return pid ? <PollMessage key={`fwd-poll-${pid}`} pollId={pid} token={token} isDark={dm} isOled={isOled} isOwn={isOwn} /> : null; })()
                                                            : isSticker(fwdBody) || isGif(fwdBody)
                                                                ? <img src={fwdBody.replace(/^__(sticker|gif)__:/, '')} alt={isGif(fwdBody) ? 'GIF' : 'Sticker'} style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, display: 'block' }} />
                                                            : isGeo(fwdBody)
                                                                ? (() => { const geo = getGeo(fwdBody); if (!geo) return null; const mapSrc = `https://static-maps.yandex.ru/1.x/?lang=ru_RU&ll=${geo.lon},${geo.lat}&z=15&l=map&size=560,220&pt=${geo.lon},${geo.lat},pm2rdl`; const mapsUrl = `https://www.openstreetmap.org/?mlat=${geo.lat}&mlon=${geo.lon}#map=15/${geo.lat}/${geo.lon}`; return <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textDecoration: 'none', margin: '-10px -14px -10px', minWidth: isMobile ? 220 : 260 }}><div style={{ position: 'relative', height: isMobile ? 130 : 160 }}><img src={mapSrc} alt="map" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /><div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-60%)', width: 20, height: 20, borderRadius: '50%', background: '#ef4444', border: '3px solid white', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }} /></div><div style={{ padding: '9px 12px 10px', background: isOwn ? 'rgba(0,0,0,0.15)' : (dm ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)') }}><span style={{ fontSize: 13, fontWeight: 700, color: isOwn ? 'white' : (dm ? '#e2e8f0' : '#1e1b4b') }}>{geo.name}</span></div></a>; })()
                                                            : isContact(fwdBody)
                                                                ? (() => { const ct = getContact(fwdBody); if (!ct) return null; const avatarSrc = ct.avatar ? config.fileUrl(ct.avatar) : null; return <div onClick={() => { const u = users.find(u => u.id === ct.id); if (u) setSelectedUserForProfile(u); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px 6px', cursor: 'pointer', margin: '-4px 0' }}><div style={{ width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: ct.avatar_color || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{avatarSrc ? <img src={avatarSrc} alt={ct.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'white', fontWeight: 700, fontSize: 17 }}>{ct.username[0]?.toUpperCase()}</span>}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: isOwn ? 'white' : (dm ? '#e2e8f0' : '#1e1b4b') }}>{ct.username}</div><div style={{ fontSize: 11, color: isOwn ? 'rgba(255,255,255,0.6)' : (dm ? '#7c7caa' : '#6b7280'), marginTop: 1 }}>{lang === 'en' ? 'Contact' : 'Контакт'}</div></div></div>; })()
                                                            : isSearchMatch
                                                                ? highlightSearchText(fwdBody, chatSearchQuery, isActiveSearchMatch)
                                                                : renderMarkdown(fwdBody, (uname => { const u = users.find(x => x.tag === uname || x.username === uname) || (groupMembersCache[activeChat!.id]?.find(x => (x as any).tag === uname || x.username === uname) as any); if (u) setSelectedUserForProfile(u as any); }), isOwn ? 'rgba(255,255,255,0.9)' : (isOled ? '#c4b5fd' : (dm ? '#a78bfa' : '#6366f1')), dm)
                                                        ) : isSearchMatch ? highlightSearchText(displayText, chatSearchQuery, isActiveSearchMatch) : (
                                                            renderMarkdown(displayText, (uname => { const u = users.find(x => x.tag === uname || x.username === uname) || (groupMembersCache[activeChat!.id]?.find(x => (x as any).tag === uname || x.username === uname) as any); if (u) setSelectedUserForProfile(u as any); }), isOwn ? 'rgba(255,255,255,0.9)' : (isOled ? '#c4b5fd' : (dm ? '#a78bfa' : '#6366f1')), dm)
                                                        )}
                                                        {previewUrl && <LinkPreviewCard key={previewUrl} url={previewUrl} token={token} isDark={dm} isOled={isOled} isOwn={isOwn} />}
                                                    </div>
                                                );
                                            })()}

                                            {!isSpecialMsg(msg.message_text) && !isGeo(msg.message_text) && !isContact(msg.message_text) && !isCallEnded(msg.message_text) && (
                                            <div style={{ ...styles.timestamp, display: 'flex', alignItems: 'center', gap: 4, justifyContent: isOwn ? 'flex-end' : 'flex-start', ...(isMediaOnlyMsg(msg) ? { position: 'absolute' as const, bottom: 6, right: 10, backgroundColor: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.92)', borderRadius: 8, padding: '2px 7px', opacity: 1 } : {}) }}>
                                                {msg.edited_at && <span style={{ opacity: 0.6, marginRight: 4 }}>{t('edited')}</span>}
                                                {(msg as any).disappear_after && (() => {
                                                    const elapsed = (Date.now() - new Date((msg as any).timestamp).getTime()) / 1000;
                                                    const remaining = Math.max(0, (msg as any).disappear_after - elapsed);
                                                    const label = remaining > 3600 ? `${Math.floor(remaining/3600)}h` : remaining > 60 ? `${Math.floor(remaining/60)}m` : `${Math.floor(remaining)}s`;
                                                    return <span title={lang === 'en' ? 'Disappears in' : 'Исчезнет через'} style={{ fontSize: 10, opacity: 0.7 }}>⏳ {label}</span>;
                                                })()}
                                                {formatTime(msg.timestamp)}
                                                {isOwn && (() => {
                                                    const isGroup = activeChat?.type === 'group';
                                                    const rc = isGroup ? (groupReadCounts[msg.id] ?? (msg as any).read_count ?? 0) : 0;
                                                    const isRead = isGroup ? rc > 0 : !!(msg as any).is_read;
                                                    const receipts = isGroup ? (groupReadReceipts[msg.id] || []) : [];
                                                    const receiptsCount = receipts.length;
                                                    return (
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                                                            <span title={isRead ? (lang === 'en' ? 'Read' : 'Прочитано') : (lang === 'en' ? 'Delivered' : 'Доставлено')} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                                {isRead ? (
                                                                    <svg width="18" height="11" viewBox="0 0 18 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke="#93c5fd" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                                ) : (
                                                                    <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5L4.5 8.5L11 1.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                                )}
                                                            </span>
                                                            {isGroup && rc > 0 && (
                                                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{rc}</span>
                                                            )}
                                                            {isGroup && receiptsCount > 0 && (
                                                                <span
                                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'pointer', position: 'relative' as const }}
                                                                    onClick={e => { e.stopPropagation(); setReadersPopoverMsgId(readersPopoverMsgId === msg.id ? null : msg.id); }}
                                                                >
                                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                                                                    </svg>
                                                                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{receiptsCount}</span>
                                                                    {readersPopoverMsgId === msg.id && (
                                                                        <div style={{ position: 'absolute' as const, bottom: '100%', right: 0, marginBottom: 4, background: dm ? '#2d2b5a' : 'white', border: `1px solid ${dm ? 'rgba(99,102,241,0.3)' : '#e0e0f0'}`, borderRadius: 10, padding: '6px 10px', minWidth: 120, maxWidth: 220, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 50 }}>
                                                                            <div style={{ fontSize: 11, fontWeight: 600, color: dm ? '#a5b4fc' : '#6366f1', marginBottom: 4 }}>{lang === 'en' ? 'Read by' : 'Прочитали'}</div>
                                                                            {receipts.map(r => (
                                                                                <div key={r.id} style={{ fontSize: 12, color: dm ? '#d1d5db' : '#374151', padding: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </span>
                                                            )}
                                                        </span>
                                                    );
                                                })()}
                                            </div>
                                            )}

                                        </div>

                                    {/* Reactions display — outside bubble so they never overlap the timestamp */}
                                    {reactions[msg.id]?.length > 0 && (() => {
                                        const grouped: Record<string, number[]> = {};
                                        for (const r of reactions[msg.id]) {
                                            if (!grouped[r.emoji]) grouped[r.emoji] = [];
                                            grouped[r.emoji].push(r.user_id);
                                        }
                                        return (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, justifyContent: isOwn ? 'flex-end' : 'flex-start' }}>
                                                {Object.entries(grouped).map(([emoji, userIds]) => {
                                                    const mine = userIds.includes(currentUserId);
                                                    const chipBg = mine
                                                        ? (isOled ? 'rgba(167,139,250,0.18)' : dm ? 'rgba(99,102,241,0.22)' : '#ede9fe')
                                                        : (isOled ? 'rgba(255,255,255,0.04)' : dm ? C.bg5 : 'white');
                                                    const chipBorder = mine
                                                        ? (isOled ? 'rgba(167,139,250,0.55)' : '#6366f1')
                                                        : (isOled ? 'rgba(167,139,250,0.2)' : dm ? C.bdr2 : '#e0e0f0');
                                                    const chipGlow = mine && isOled ? '0 0 8px rgba(167,139,250,0.3)' : 'none';
                                                    return (
                                                        <button key={emoji} onClick={() => toggleReaction(msg.id, activeChat.type === 'group', emoji)}
                                                            style={{ padding: '3px 9px', borderRadius: 14, border: `1px solid ${chipBorder}`, background: chipBg, boxShadow: chipGlow, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', gap: 4, transition: 'transform 0.1s', lineHeight: 1 }}
                                                            onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.08)')}
                                                            onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                                                        >
                                                            {emoji}
                                                            <span style={{ fontSize: 11, color: isOled ? '#c4b5fd' : (dm ? '#a5b4fc' : '#6366f1'), fontWeight: 700 }}>{userIds.length}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                    </div>
                                    {isOwn && !selectionMode && (
                                        <div
                                            style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: currentUserAvatar ? (dm ? C.bg2 : '#f3f4f6') : avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', fontSize: 12, color: 'white', fontWeight: 700, alignSelf: 'flex-end', marginBottom: hasReactions ? 32 : 2 }}
                                        >
                                            {currentUserAvatar
                                                ? <img src={config.fileUrl(currentUserAvatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : currentUsername[0]?.toUpperCase()
                                            }
                                        </div>
                                    )}
                                    </div>
                                    );
                                });

                                // Render scheduled messages after regular ones (only for this chat)
                                const currentScheduled = scheduledMessages.filter(sm =>
                                    activeChat.type === 'private' ? sm.receiver_id === activeChat.id : sm.group_id === activeChat.id
                                );
                                if (currentScheduled.length > 0) {
                                    items.push(
                                        <div key="sched-sep" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
                                            <div style={{ flex: 1, height: 1, backgroundColor: dm ? '#3a3a4a' : '#e0e0e0' }} />
                                            <span style={{ fontSize: 11, color: dm ? '#888' : '#aaa', whiteSpace: 'nowrap', padding: '2px 10px', backgroundColor: dm ? C.bg6 : '#efefef', borderRadius: 10 }}>
                                                {lang === 'en' ? 'Scheduled' : 'Отложенные'}
                                            </span>
                                            <div style={{ flex: 1, height: 1, backgroundColor: dm ? '#3a3a4a' : '#e0e0e0' }} />
                                        </div>
                                    );
                                    currentScheduled.forEach(sm => {
                                        items.push(
                                            <div key={`sched-${sm.id}`} className="msg-scheduled" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                                                <div style={{ maxWidth: '72%', background: dm ? 'linear-gradient(135deg,#4338ca,#7c3aed)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', borderRadius: '18px 18px 4px 18px', padding: '8px 14px 6px', color: 'white', position: 'relative' }}>
                                                    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14 }}>{sm.message_text}</div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 4 }}>
                                                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
                                                            {sm.send_when_online
                                                                ? (lang === 'en' ? '⚡ When online' : '⚡ Когда онлайн')
                                                                : new Date(sm.scheduled_at).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                        {/* Animated clock icon */}
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round">
                                                            <circle cx="12" cy="12" r="10"/>
                                                            <line x1="12" y1="12" x2="12" y2="7" className="clock-minute-hand" stroke="rgba(255,255,255,0.9)" strokeWidth="2"/>
                                                            <line x1="12" y1="12" x2="16" y2="12" className="clock-hour-hand" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5"/>
                                                        </svg>
                                                        <button
                                                            onClick={() => cancelScheduled(sm.id)}
                                                            title={lang === 'en' ? 'Cancel' : 'Отменить'}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', padding: '0 0 0 4px', display: 'flex', alignItems: 'center' }}
                                                        ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    });
                                }

                                return items;
                            })()}
                            <div ref={messagesEndRef} />
                            {/* Scroll to bottom button */}
                            {showScrollDown && (
                                <div style={{ position: 'sticky', bottom: 16, display: 'flex', justifyContent: 'flex-end', paddingRight: 16, pointerEvents: 'none', zIndex: 10 }}>
                                    <button
                                        onClick={() => scrollToBottom(true)}
                                        style={{ pointerEvents: 'all', width: 40, height: 40, borderRadius: '50%', background: isOled ? '#050508' : (dm ? '#2d2b5a' : 'white'), border: `1.5px solid ${isOled ? 'rgba(167,139,250,0.35)' : (dm ? 'rgba(99,102,241,0.35)' : '#d0caff')}`, boxShadow: isOled ? '0 4px 16px rgba(0,0,0,0.8), 0 0 0 1px rgba(167,139,250,0.1)' : '0 4px 16px rgba(99,102,241,0.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: isOled ? '#c4b5fd' : (dm ? '#a5b4fc' : '#6366f1'), transition: 'opacity 0.2s', position: 'relative' as const }}
                                        title={lang === 'en' ? 'Scroll to latest' : 'К последнему сообщению'}
                                    >
                                        ↓
                                        {newMsgWhileScrolled > 0 && (
                                            <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, background: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', boxShadow: '0 2px 6px rgba(99,102,241,0.5)' }}>
                                                {newMsgWhileScrolled > 99 ? '99+' : newMsgWhileScrolled}
                                            </span>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Channel: Comments overlay */}
                        {isChannelChat && commentPostId !== null && (() => {
                            const post = messages.find(m => m.id === commentPostId);
                            const comments = activePostComments;
                            const border2 = isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.12)';
                            const panelBg = isOled ? '#000000' : dm ? '#0b0b18' : '#f8f7ff';
                            const sendComment = async () => {
                                if (!commentText.trim() && !commentPendingFile) return;
                                if (commentPendingFile) {
                                    setCommentUploading(true);
                                    try {
                                        const result = await api.uploadFileWithProgress(token, commentPendingFile, () => {}, () => {});
                                        if (result.success) {
                                            wsService.sendGroupMessage(activeChat!.id, commentText.trim(), result.file_path, result.filename, result.file_size, commentPostId!);
                                        }
                                    } finally {
                                        setCommentUploading(false);
                                        setCommentPendingFile(null);
                                    }
                                } else {
                                    const text = commentReplyTo ? `↩ ${commentReplyTo.name}: ${commentReplyTo.text?.slice(0, 60) || ''}...\n${commentText.trim()}` : commentText.trim();
                                    wsService.sendGroupMessage(activeChat!.id, text, undefined, undefined, undefined, commentPostId!);
                                }
                                setCommentText(''); setCommentReplyTo(null);
                            };
                            return (
                                <div className="panel-slide-in" style={{ position: 'absolute', inset: 0, background: panelBg, display: 'flex', flexDirection: 'column', zIndex: 200, alignItems: 'center' }}>
                                <input ref={commentFileInputRef} type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) setCommentPendingFile(f); e.target.value = ''; }} />
                                <div style={{ width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                                    {/* Header */}
                                    <div style={{ flexShrink: 0, padding: '12px 16px 0' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10 }}>
                                            <button onClick={() => { setCommentPostId(null); setCommentReplyTo(null); setEditingCommentId(null); setEditingCommentText(''); setCommentPendingFile(null); setCommentShowEmoji(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 700, fontSize: 16, color: dm ? '#e0e0f0' : '#1e1b4b' }}>{lang === 'en' ? 'Comments' : 'Комментарии'}</div>
                                                {comments.length > 0 && <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 1 }}>{comments.length} {lang === 'en' ? (comments.length === 1 ? 'comment' : 'comments') : (comments.length === 1 ? 'комментарий' : comments.length < 5 ? 'комментария' : 'комментариев')}</div>}
                                            </div>
                                        </div>
                                        {post && (
                                            <div style={{ marginBottom: 6, padding: '8px 12px', borderRadius: 12, background: isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(255,255,255,0.04)' : 'rgba(99,102,241,0.05)', borderLeft: `3px solid ${isOled ? '#7c3aed' : dm ? '#6366f1' : '#8b5cf6'}` }}>
                                                <div style={{ fontSize: 10, color: isOled ? '#7c6aaa' : dm ? '#7c7caa' : '#9ca3af', marginBottom: 2, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' as const }}>{lang === 'en' ? 'Post' : 'Пост'}</div>
                                                <div style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, lineHeight: 1.4 }}>{
                                                    isSticker(post.message_text) ? `🎭 ${lang === 'en' ? 'Sticker' : 'Стикер'}`
                                                    : isGif(post.message_text) ? `🎞 GIF`
                                                    : isPoll(post.message_text) ? `📊 ${lang === 'en' ? 'Poll' : 'Опрос'}`
                                                    : post.message_text || `📎 ${lang === 'en' ? 'File' : 'Файл'}`
                                                }</div>
                                            </div>
                                        )}
                                    </div>
                                    {/* Comments list */}
                                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {comments.length === 0 && (
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 10, opacity: 0.5, paddingTop: 40 }}>
                                                <div style={{ color: dm ? '#3a3a5a' : '#c4b5fd' }}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
                                                <div style={{ fontSize: 14, color: dm ? '#5a5a8a' : '#9ca3af', fontWeight: 500 }}>{lang === 'en' ? 'No comments yet' : 'Пока нет комментариев'}</div>
                                                <div style={{ fontSize: 12, color: dm ? '#3a3a5a' : '#c0bcd8' }}>{lang === 'en' ? 'Be the first!' : 'Будьте первым!'}</div>
                                            </div>
                                        )}
                                        {(() => {
                                            let lastCommentDay = '';
                                            return comments.map(c => {
                                            const isOwn2 = c.sender_id === currentUserId;
                                            const canEdit = isOwn2;
                                            const canDelete = isOwn2 || isGroupAdmin;
                                            const cName = (c as any).sender_name || (isOwn2 ? currentUsername : '?');
                                            const cAvatar = (c as any).sender_avatar ? config.fileUrl((c as any).sender_avatar) : null;
                                            const isEditingThis = editingCommentId === c.id;
                                            const cDay = getMsgDay(c.timestamp);
                                            const showDay = cDay && cDay !== lastCommentDay;
                                            if (showDay) lastCommentDay = cDay;
                                            const sepEl = showDay ? (
                                                <div key={`csep-${cDay}`} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 2px' }}>
                                                    <div style={{ flex: 1, height: 1, backgroundColor: border2 }} />
                                                    <span style={{ fontSize: 10, color: isOled ? 'rgba(167,139,250,0.55)' : (dm ? '#888' : '#aaa'), whiteSpace: 'nowrap', padding: '2px 10px', backgroundColor: isOled ? 'rgba(167,139,250,0.06)' : (dm ? C.bg6 : '#efefef'), borderRadius: 8 }}>
                                                        {getDateLabel(c.timestamp)}
                                                    </span>
                                                    <div style={{ flex: 1, height: 1, backgroundColor: border2 }} />
                                                </div>
                                            ) : null;
                                            const openProfile = () => setSelectedUserForProfile({ id: c.sender_id, username: cName, email: '', created_at: '', avatar: (c as any).sender_avatar || undefined, avatar_color: (c as any).sender_avatar_color });
                                            const ownBubbleBg = isOled ? 'linear-gradient(150deg,#5b21b6,#7c3aed,#6d28d9)' : `linear-gradient(150deg,${theme.bubbleOwnColor},#8b5cf6,#7c3aed)`;
                                            const otherBubbleBg = isOled ? 'linear-gradient(150deg,#17122e,#1f1840,#251e4a)' : (dm ? 'linear-gradient(150deg,#252048,#2d2960,#322e6a)' : 'rgba(255,255,255,0.95)');
                                            const otherBubbleBorder = 'none';
                                            const otherBubbleShadow = isOled ? '0 3px 14px rgba(109,40,217,0.23), 0 2px 8px rgba(0,0,0,0.6)' : dm ? '0 3px 11px rgba(99,102,241,0.17), 0 2px 6px rgba(0,0,0,0.3)' : '0 2px 8px rgba(99,102,241,0.08)';
                                            return (
                                                <React.Fragment key={c.id}>
                                                {sepEl}
                                                <div
                                                    style={{ display: 'flex', flexDirection: isOwn2 ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end', position: 'relative' }}
                                                    onMouseEnter={() => setHoveredCommentId(c.id)}
                                                    onMouseLeave={() => setHoveredCommentId(null)}
                                                >
                                                    {!isOwn2 && <div onClick={openProfile} style={{ width: 30, height: 30, borderRadius: '50%', background: cAvatar ? 'transparent' : ((c as any).sender_avatar_color || '#6366f1'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'white', fontSize: 12, overflow: 'hidden', flexShrink: 0, cursor: 'pointer', alignSelf: 'flex-start', marginTop: 2, boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>
                                                        {cAvatar ? <img src={cAvatar} alt={cName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : cName[0]?.toUpperCase()}
                                                    </div>}
                                                    <div style={{ maxWidth: '72%', minWidth: 0, background: isOwn2 ? ownBubbleBg : otherBubbleBg, borderRadius: isOwn2 ? '18px 18px 4px 18px' : '18px 18px 18px 4px', padding: '8px 12px', color: isOwn2 ? 'white' : (isOled ? '#c4b5fd' : dm ? '#dde0f8' : '#1e1b4b'), border: isOwn2 ? 'none' : otherBubbleBorder, boxShadow: isOwn2 ? '0 4px 16px rgba(99,102,241,0.3)' : otherBubbleShadow }}>
                                                        {!isOwn2 && <div onClick={openProfile} style={{ fontSize: 11, fontWeight: 700, color: isOled ? '#c4b5fd' : (dm ? '#a5b4fc' : '#6366f1'), marginBottom: 3, cursor: 'pointer' }}>{cName}</div>}
                                                        {isEditingThis ? (
                                                            <div style={{ display: 'flex', gap: 6 }}>
                                                                <input autoFocus value={editingCommentText} onChange={e => setEditingCommentText(e.target.value)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter' && editingCommentText.trim()) { wsService.sendRaw({ type: 'edit_message', message_id: c.id, new_text: editingCommentText.trim(), is_group: true }); setEditingCommentId(null); setEditingCommentText(''); }
                                                                        if (e.key === 'Escape') { setEditingCommentId(null); setEditingCommentText(''); }
                                                                    }}
                                                                    style={{ flex: 1, padding: '5px 8px', borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.2)', color: 'inherit', fontSize: 13, outline: 'none' }}
                                                                />
                                                                <button onClick={() => { if (editingCommentText.trim()) wsService.sendRaw({ type: 'edit_message', message_id: c.id, new_text: editingCommentText.trim(), is_group: true }); setEditingCommentId(null); setEditingCommentText(''); }} style={{ padding: '4px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.2)', color: 'inherit', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
                                                                <button onClick={() => { setEditingCommentId(null); setEditingCommentText(''); }} style={{ padding: '4px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.15)', color: 'inherit', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                {c.message_text && (() => {
                                                                    const txt = c.message_text;
                                                                    if (isSticker(txt)) {
                                                                        const sd = parseStickerData(txt);
                                                                        return <img src={sd.url} alt="стикер" style={{ maxWidth: 140, maxHeight: 140, display: 'block', objectFit: 'contain', borderRadius: 8, cursor: sd.pack ? 'pointer' : 'default' }} onClick={sd.pack ? () => setStickerPackPreview(sd) : undefined} />;
                                                                    }
                                                                    if (isGif(txt)) {
                                                                        return <img src={specialUrl(txt)} alt="GIF" style={{ maxWidth: 220, borderRadius: 10, display: 'block' }} />;
                                                                    }
                                                                    if (isPoll(txt)) {
                                                                        const pid = getPollId(txt);
                                                                        return pid ? <PollMessage key={`cpoll-${pid}`} pollId={pid} token={token} isDark={dm} isOled={isOled} isOwn={isOwn2} /> : null;
                                                                    }
                                                                    const parsed = parseCommentReplyPrefix(txt);
                                                                    return <>
                                                                        {parsed.replyAuthor && <div style={{ borderLeft: '3px solid rgba(255,255,255,0.4)', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 6, padding: '3px 8px', marginBottom: 5 }}>
                                                                            <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 1, opacity: 0.9 }}>↩ {parsed.replyAuthor}</div>
                                                                            <div style={{ fontSize: 11, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{parsed.replyQuote}</div>
                                                                        </div>}
                                                                        <div style={{ fontSize: 13, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{parsed.mainText}{(c as any).edited_at && <span style={{ fontSize: 10, opacity: 0.55, marginLeft: 4 }}>{t('edited')}</span>}</div>
                                                                    </>;
                                                                })()}
                                                                {c.file_path && <FileMessage filePath={c.file_path} filename={(c as any).filename || ''} fileSize={(c as any).file_size} isOwn={isOwn2} isDark={dm} onPlay={playGlobalAudio} nowPlayingSrc={nowPlaying?.src} globalPlaying={globalPlaying} globalCurrentTime={globalCurrentTime} knownDuration={knownAudioDurations.current.get(c.file_path?.startsWith('http') ? c.file_path : `${BASE_URL}${c.file_path}`)} />}
                                                            </>
                                                        )}
                                                        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: isOwn2 ? 'right' : 'left' }}>{new Date(c.timestamp).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
                                                    </div>
                                                    {hoveredCommentId === c.id && !isEditingThis && (
                                                        <div style={{ position: 'absolute', [isOwn2 ? 'left' : 'right']: 40, bottom: 0, display: 'flex', gap: 2, background: isOled ? '#0a0a14' : dm ? C.bg3 : 'white', border: `1px solid ${dm ? C.bdr2 : '#e0deff'}`, borderRadius: 10, padding: '3px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 5 }}>
                                                            <button title={t('Reply')} onClick={() => setCommentReplyTo({ id: c.id, name: cName, text: stripCommentReplyPrefix(c.message_text) })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', color: dm ? '#a5b4fc' : '#6366f1', display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></button>
                                                            <button title={lang === 'en' ? 'Forward' : 'Переслать'} onClick={() => setForwardingMessages([{ ...c, message_text: stripCommentReplyPrefix(c.message_text) }])} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', color: dm ? '#a5b4fc' : '#6366f1', display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg></button>
                                                            {canEdit && <button title={t('Edit')} onClick={() => { setEditingCommentId(c.id); setEditingCommentText(stripCommentReplyPrefix(c.message_text) || ''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', color: dm ? '#a5b4fc' : '#6366f1', display: 'flex', alignItems: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>}
                                                            {canDelete && <button title={t('Delete')} onClick={() => { setDeleteConfirmId({ id: c.id, senderId: c.sender_id ?? currentUserId }); setMenuMessageId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', color: '#ef4444', display: 'flex', alignItems: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>}
                                                        </div>
                                                    )}
                                                </div>
                                                </React.Fragment>
                                            );
                                        });
                                        })()}
                                    </div>
                                    {/* Emoji picker for comments */}
                                    {commentShowEmoji && (
                                        <div style={{ flexShrink: 0 }}>
                                            <MediaPicker
                                                onSelectEmoji={emoji => { setCommentText(t => t + emoji); setCommentShowEmoji(false); commentInputRef.current?.focus(); }}
                                                onSendSticker={(url: string) => { wsService.sendGroupMessage(activeChat!.id, `__sticker__${url}`, undefined, undefined, undefined, commentPostId!); setCommentShowEmoji(false); }}
                                                onSendGif={(url: string) => { wsService.sendGroupMessage(activeChat!.id, `__gif__${url}`, undefined, undefined, undefined, commentPostId!); setCommentShowEmoji(false); }}
                                                onClose={() => setCommentShowEmoji(false)}
                                                isDark={dm} token={token}
                                            />
                                        </div>
                                    )}
                                    {/* Pending file / reply bars */}
                                    {commentPendingFile && (
                                        <div style={{ padding: '5px 16px', background: isOled ? 'rgba(167,139,250,0.05)' : dm ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.04)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                                            <span style={{ display: 'inline-flex', color: dm ? '#a5b4fc' : '#6366f1' }}>{/\.(jpg|jpeg|png|gif|webp)$/i.test(commentPendingFile.name) ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> : /\.(mp4|webm|mov)$/i.test(commentPendingFile.name) ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> : /\.(mp3|wav|ogg|flac)$/i.test(commentPendingFile.name) ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}</span>
                                            <span style={{ flex: 1, fontSize: 12, color: dm ? '#c0c0d8' : '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commentPendingFile.name}</span>
                                            <button onClick={() => setCommentPendingFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', display: 'flex', alignItems: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                        </div>
                                    )}
                                    {commentReplyTo && (
                                        <div style={{ padding: '5px 16px', background: isOled ? 'rgba(167,139,250,0.05)' : dm ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderLeft: '3px solid #6366f1', flexShrink: 0 }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: '#8b5cf6' }}>↩ {commentReplyTo.name}</div>
                                                <div style={{ fontSize: 12, color: dm ? '#9090b8' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commentReplyTo.text?.slice(0, 80) || `📎 файл`}</div>
                                            </div>
                                            <button onClick={() => setCommentReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', display: 'flex', alignItems: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                        </div>
                                    )}
                                    {/* Input — same pill as main chat */}
                                    <div style={{ ...darkStyles.inputArea, padding: '8px 12px' }}>
                                        <div style={darkStyles.inputPill}>
                                            <button onClick={() => setCommentShowEmoji(v => !v)} style={{ ...darkStyles.pillBtn, color: commentShowEmoji ? (dm ? '#a5b4fc' : '#6366f1') : (dm ? (isOled ? '#a78bfa' : '#7c7caa') : '#9ca3af') }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>
                                            <textarea
                                                ref={commentInputRef}
                                                value={commentText}
                                                onChange={e => setCommentText(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); } }}
                                                placeholder={lang === 'en' ? 'Write a comment...' : 'Написать комментарий...'}
                                                rows={1}
                                                style={{ ...darkStyles.input }}
                                            />
                                            <button onClick={() => commentFileInputRef.current?.click()} style={{ ...darkStyles.pillBtn, color: commentPendingFile ? '#6366f1' : (dm ? (isOled ? '#a78bfa' : '#7c7caa') : '#9ca3af') }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
                                        </div>
                                        <button
                                            onClick={sendComment}
                                            disabled={(!commentText.trim() && !commentPendingFile) || commentUploading}
                                            style={{ ...darkStyles.sendBtn2, opacity: (!commentText.trim() && !commentPendingFile) || commentUploading ? 0.5 : 1 }}>
                                            {commentUploading ? (
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2 2"/></svg>
                                            ) : (
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                </div>
                                </div>
                            );
                        })()}

                        {/* Edit indicator above input */}
                        {/* Slow mode cooldown bar */}
                        {activeChat?.type === 'group' && slowModeCooldowns[activeChat.id] > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', background: isOled ? '#000' : dm ? C.bg2 : '#fff8ec', borderTop: `1px solid ${isOled ? 'rgba(251,191,36,0.15)' : dm ? 'rgba(251,191,36,0.2)' : '#fde68a'}`, borderLeft: '3px solid #f59e0b' }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                <span style={{ fontSize: 12, color: dm ? '#fbbf24' : '#92400e', fontWeight: 600 }}>
                                    {lang === 'en' ? `Slow mode: wait ${slowModeCooldowns[activeChat.id]}s` : `Медленный режим: подождите ${slowModeCooldowns[activeChat.id]}с`}
                                </span>
                            </div>
                        )}
                        {editingMessageId && (
                            <div className="bar-enter" style={{ padding: '8px 14px', backgroundColor: isOled ? '#000000' : dm ? C.bg2 : '#f0efff', borderTop: `1px solid ${isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.15)' : '#e0d9ff'}`, borderLeft: `3px solid ${isOled ? '#a78bfa' : '#6366f1'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isOled ? '#a78bfa' : '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: isOled ? '#a78bfa' : '#6366f1', marginBottom: 1 }}>{lang === 'en' ? 'Editing message' : 'Редактирование'}</div>
                                        <div style={{ fontSize: 12, color: dm ? '#9090b8' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editingText.slice(0, 80)}</div>
                                    </div>
                                </div>
                                <button onClick={() => { setEditingMessageId(null); setEditingText(''); if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = 'auto'; setInputCharCount(0); } }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', padding: '2px 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                            </div>
                        )}

                        {/* Панель ответа */}
                        {replyTo && (() => {
                            const replyFilePath = replyTo.file_path || (replyTo.files && (typeof replyTo.files === 'string' ? JSON.parse(replyTo.files) : replyTo.files)?.[0]?.file_path);
                            const replyFilename = replyTo.filename || (replyTo.files && (typeof replyTo.files === 'string' ? JSON.parse(replyTo.files) : replyTo.files)?.[0]?.filename) || '';
                            const replyIsImg = replyFilePath && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(replyFilename || replyFilePath);
                            const replyIsVoice = replyFilename && /^voice_/i.test(replyFilename);
                            const replyIsAudio = replyFilename && /\.(mp3|ogg|wav|weba|opus|m4a|flac|aac)$/i.test(replyFilename);
                            const replyIsVideo = replyFilename && /\.(mp4|webm|mov|avi)$/i.test(replyFilename);
                            const replyImgSrc = replyIsImg ? (config.fileUrl(replyFilePath) ?? null) : null;
                            let replyFileLabel = '';
                            if (replyIsVoice) replyFileLabel = `🎤 ${t('Voice message')}`;
                            else if (replyIsAudio) replyFileLabel = `🎵 ${replyFilename}`;
                            else if (replyIsVideo) replyFileLabel = `🎬 ${replyFilename}`;
                            else if (replyIsImg) replyFileLabel = `🖼️ ${t('Photo')}`;
                            else if (replyFilename) replyFileLabel = `📄 ${replyFilename}`;
                            else if (replyFilePath) replyFileLabel = `📎 ${lang === 'en' ? 'file' : 'файл'}`;
                            return (
                                <div className="bar-enter" style={{ padding: '8px 16px', background: isOled ? '#000000' : dm ? '#13131f' : '#f7f8fc', borderTop: `1px solid ${isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.12)'}`, borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.12)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                        {replyImgSrc && <img src={replyImgSrc} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />}
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{replyTo.sender_name || t('Reply')}</div>
                                            <div style={{ fontSize: 12, color: isOled ? '#6b6b9a' : dm ? '#9090b8' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {replyTo.message_text?.slice(0, 80) || replyFileLabel || `📎 ${lang === 'en' ? 'file' : 'файл'}`}
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isOled ? '#4a4a6a' : dm ? '#5a5a8a' : '#9ca3af', padding: '2px 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                </div>
                            );
                        })()}

                        {/* Staging area */}
                        {pendingFiles.length > 0 && (
                            <div className="bar-enter" style={{
                                padding: '10px 14px 8px',
                                background: isOled ? '#000000' : dm ? C.bg1 : '#f7f8fc',
                                boxShadow: isOled
                                    ? '0 -6px 24px rgba(139,92,246,0.12)'
                                    : dm
                                        ? '0 -4px 20px rgba(99,102,241,0.1)'
                                        : '0 -4px 20px rgba(99,102,241,0.08)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase', color: isOled ? '#8b7dc8' : dm ? '#7c7caa' : '#9ca3af', display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                        {pendingFiles.length} / 10&nbsp;{lang === 'en' ? `file${pendingFiles.length === 1 ? '' : 's'}` : `файл${pendingFiles.length === 1 ? '' : pendingFiles.length < 5 ? 'а' : 'ов'}`}
                                    </span>
                                    <button onClick={() => setPendingFiles([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isOled ? '#7c6ab8' : dm ? '#5a5a8a' : '#a5b4fc', fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 6, letterSpacing: '0.2px', transition: 'color 0.15s' }}>
                                        {lang === 'en' ? 'Clear all' : 'Очистить'}
                                    </button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 8, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' as any }}>
                                    {pendingFiles.map((f, i) => {
                                        const isImg = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.name);
                                        const isVid = /\.(mp4|webm|mov|avi|mkv)$/i.test(f.name);
                                        const isAud = /\.(mp3|ogg|wav|flac|aac|m4a|opus|weba)$/i.test(f.name);
                                        const previewUrl = isImg ? URL.createObjectURL(f) : null;
                                        const sz = 60;
                                        return (
                                            <div key={i} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 6 }}>
                                                <div style={{ position: 'relative', width: sz, height: sz }}>
                                                    <div style={{
                                                        width: sz, height: sz,
                                                        borderRadius: 12,
                                                        background: isOled ? '#120f24' : dm ? C.bg5 : 'white',
                                                        border: `1.5px solid ${isOled ? 'rgba(167,139,250,0.18)' : dm ? C.bdr2 : '#e0dbff'}`,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        overflow: 'hidden',
                                                        boxShadow: dm ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(99,102,241,0.1)',
                                                    }}>
                                                        {isImg && previewUrl
                                                            ? <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onLoad={() => URL.revokeObjectURL(previewUrl)} />
                                                            : isVid
                                                                ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                                                                : isAud
                                                                    ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                                                                    : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                                        }
                                                    </div>
                                                    <div
                                                        onClick={e => { e.stopPropagation(); setPendingFiles(prev => prev.filter((_, j) => j !== i)); }}
                                                        style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', backdropFilter: 'blur(4px)', flexShrink: 0 }}
                                                    >
                                                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                    </div>
                                                </div>
                                                <span style={{ fontSize: 10, color: isOled ? '#8b7dc8' : dm ? '#7c7caa' : '#9ca3af', width: sz, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', lineHeight: 1.2 }}>{f.name.replace(/\.[^.]+$/, '')}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Upload progress */}
                        {uploading && (
                            <div style={{ padding: '8px 16px 6px', borderTop: `1px solid ${dm ? C.bdr1 : '#ede9fe'}`, backgroundColor: dm ? C.bg1 : 'white' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                                    <span style={{ fontSize: 12, color: dm ? '#9090b8' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '68%', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> {uploadingFileName}
                                    </span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#6366f1' }}>{uploadProgress}%</span>
                                        <button onClick={() => { currentUploadXHR.current?.abort(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#7070a0' : '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }} title={lang === 'en' ? 'Cancel upload' : 'Отменить загрузку'}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                    </div>
                                </div>
                                <div style={{ height: 3, backgroundColor: dm ? C.bdr1 : '#e0e0f0', borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', borderRadius: 3, transition: 'width 0.1s ease' }} />
                                </div>
                            </div>
                        )}

                        {/* Режим выбора сообщений */}
                        {selectionMode && (
                            <div className="bar-enter" style={{ ...darkStyles.inputArea, justifyContent: 'space-between', padding: '10px 16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <button onClick={exitSelectionMode} style={{ background: 'none', border: `1.5px solid ${dm ? C.bdr2 : '#ede9fe'}`, borderRadius: 10, padding: '7px 14px', cursor: 'pointer', color: dm ? '#c0c0d8' : '#6b7280', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> {t('Cancel')}</button>
                                    <span style={{ fontSize: 13, color: dm ? '#a0a0c0' : '#6b7280', fontWeight: 500 }}>{t('selected')}: {selectedMsgIds.size}</span>
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        onClick={handleBulkForward}
                                        disabled={selectedMsgIds.size === 0}
                                        style={{ padding: '8px 14px', background: dm ? '#1e1e3a' : '#f5f3ff', color: '#6366f1', border: `1.5px solid ${dm ? C.bdr2 : '#ede9fe'}`, borderRadius: 10, cursor: selectedMsgIds.size === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: selectedMsgIds.size === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
                                    ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg> {t('Forward')}</button>
                                    <button
                                        onClick={() => {
                                            const isFav = activeChatRef.current?.type === 'private' && activeChatRef.current?.id === currentUserId;
                                            if (isFav) { handleBulkDelete(false); } else { setBulkDeleteConfirm(true); }
                                        }}
                                        disabled={selectedMsgIds.size === 0}
                                        style={{ padding: '8px 14px', background: 'none', color: '#ef4444', border: '1.5px solid #fca5a5', borderRadius: 10, cursor: selectedMsgIds.size === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: selectedMsgIds.size === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
                                    ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> {t('Delete')}</button>
                                </div>
                            </div>
                        )}

                        {/* Ввод */}
                        {!selectionMode && isChannelChat && !isChannelMember && (
                            <div style={{ padding: '14px 18px', borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.15)' : '#ede9fe'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, background: dm ? C.bg1 : '#f7f8fc' }}>
                                <button
                                    onClick={async () => {
                                        if (!activeChat) return;
                                        const res = await api.joinGroup(token, activeChat.id);
                                        if (res.success || res.already_member) {
                                            await loadGroups();
                                            setPreviewGroup(null);
                                        }
                                    }}
                                    style={{ padding: '10px 28px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none', borderRadius: 14, cursor: 'pointer', fontSize: 14, fontWeight: 700, boxShadow: '0 2px 12px rgba(99,102,241,0.35)', transition: 'opacity 0.15s', display: 'flex', alignItems: 'center', gap: 8 }}
                                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5.882V19.24a1.76 1.76 0 0 1-3.417.592l-2.147-6.15M18 13a4 4 0 0 0 0-8M5 6.236A15.7 15.7 0 0 1 16 2v20a15.7 15.7 0 0 1-11-5.764"/></svg> {t('Subscribe')}
                                </button>
                            </div>
                        )}
                        {!selectionMode && isChannelChat && isChannelMember && !isGroupAdmin && (() => {
                            const muteKey = `group_${activeChat!.id}`;
                            const isMuted = mutedChats.has(muteKey);
                            return (
                                <div style={{
                                    padding: '8px 16px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: isOled
                                        ? 'linear-gradient(180deg, rgba(0,0,0,0) 0%, #000000 100%)'
                                        : dm
                                            ? `linear-gradient(180deg, rgba(22,22,37,0) 0%, ${C.bg1} 100%)`
                                            : 'linear-gradient(180deg, rgba(247,248,252,0) 0%, #f7f8fc 100%)',
                                    boxShadow: isOled
                                        ? '0 -8px 32px rgba(139,92,246,0.08)'
                                        : dm
                                            ? '0 -6px 24px rgba(0,0,0,0.2)'
                                            : '0 -6px 20px rgba(99,102,241,0.06)',
                                    minHeight: 56,
                                    position: 'relative',
                                }}>
                                    {/* Subtle ambient glow behind button */}
                                    <div style={{
                                        position: 'absolute', inset: 0, pointerEvents: 'none',
                                        background: isOled
                                            ? 'radial-gradient(ellipse 60% 80% at 50% 100%, rgba(139,92,246,0.12) 0%, transparent 70%)'
                                            : dm
                                                ? 'radial-gradient(ellipse 60% 80% at 50% 100%, rgba(99,102,241,0.1) 0%, transparent 70%)'
                                                : 'radial-gradient(ellipse 60% 80% at 50% 100%, rgba(99,102,241,0.07) 0%, transparent 70%)',
                                    }} />
                                    <button
                                        onClick={() => toggleMute(muteKey)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            padding: '10px 22px',
                                            background: isMuted
                                                ? (isOled ? 'rgba(167,139,250,0.07)' : dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.06)')
                                                : (isOled
                                                    ? 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(167,139,250,0.15))'
                                                    : dm
                                                        ? 'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(139,92,246,0.12))'
                                                        : 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.07))'),
                                            border: `1px solid ${isMuted
                                                ? (isOled ? 'rgba(167,139,250,0.12)' : dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.1)')
                                                : (isOled ? 'rgba(167,139,250,0.35)' : dm ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.25)')}`,
                                            borderRadius: 24,
                                            color: isMuted
                                                ? (isOled ? '#6b5fa0' : dm ? '#5a5a8a' : '#9ca3af')
                                                : (isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1'),
                                            fontSize: 13, fontWeight: 600,
                                            cursor: 'pointer',
                                            boxShadow: isMuted
                                                ? 'none'
                                                : (isOled
                                                    ? '0 0 24px rgba(167,139,250,0.25), 0 2px 12px rgba(124,58,237,0.2), inset 0 1px 0 rgba(255,255,255,0.05)'
                                                    : dm
                                                        ? '0 0 18px rgba(99,102,241,0.2), 0 2px 10px rgba(99,102,241,0.15)'
                                                        : '0 0 14px rgba(99,102,241,0.15), 0 2px 8px rgba(99,102,241,0.1)'),
                                            transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
                                            backdropFilter: 'blur(8px)',
                                            letterSpacing: 0.1,
                                            position: 'relative',
                                        }}
                                    >
                                        {isMuted ? (
                                            <>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                                {lang === 'en' ? 'Unmute' : 'Включить уведомления'}
                                            </>
                                        ) : (
                                            <>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                                                {lang === 'en' ? 'Mute notifications' : 'Отключить уведомления'}
                                            </>
                                        )}
                                    </button>
                                </div>
                            );
                        })()}
                        {!selectionMode && isDeletedUser && (
                            <div style={{ padding: '14px 18px', textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13, borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}`, background: dm ? C.bg1 : '#f7f8fc' }}>
                                🗑 {lang === 'en' ? 'This account has been deleted' : 'Этот аккаунт был удалён'}
                            </div>
                        )}
                        {!selectionMode && !isDeletedUser && isBlockedByMeInput && (
                            <div style={{ padding: '12px 18px', borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}`, background: dm ? C.bg1 : '#f7f8fc', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13 }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                                    {lang === 'en'
                                        ? `You blocked ${usersById.get(activeChat!.id)?.username || 'this user'}`
                                        : `Вы заблокировали ${usersById.get(activeChat!.id)?.username || 'пользователя'}`}
                                </div>
                                <button
                                    onClick={() => handleUnblockUser(activeChat!.id)}
                                    style={{ padding: '6px 14px', borderRadius: 20, border: '1.5px solid rgba(99,102,241,0.4)', background: 'none', color: dm ? '#a5b4fc' : '#6366f1', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                    {lang === 'en' ? 'Unblock' : 'Разблокировать'}
                                </button>
                            </div>
                        )}
                        {!selectionMode && !isDeletedUser && !isBlockedByMeInput && isBlockedByThemInput && (
                            <div style={{ padding: '14px 18px', textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13, borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}`, background: dm ? C.bg1 : '#f7f8fc' }}>
                                🚫 {lang === 'en' ? 'You can\'t send messages to this user' : 'Вы не можете отправлять сообщения этому пользователю'}
                            </div>
                        )}
                        {!selectionMode && !isDeletedUser && !isBlockedByMeInput && !isBlockedByThemInput && (!isChannelChat || isGroupAdmin) && <div className="chat-input-area" style={{ ...darkStyles.inputArea, position: 'relative' }}>
                            {showEmojiPicker && (
                                <MediaPicker
                                    onSelectEmoji={emoji => { if (inputRef.current) { inputRef.current.value += emoji; autoResize(inputRef.current); inputRef.current.focus(); } }}
                                    onSendSticker={url => { sendStickerMessage(url); setShowEmojiPicker(false); }}
                                    onSendGif={url => { sendSpecialMessage('__gif__' + url); setShowEmojiPicker(false); }}
                                    onClose={() => setShowEmojiPicker(false)}
                                    isDark={theme.darkMode}
                                    token={token}
                                />
                            )}
                            {/* Schedule picker */}
                            {showSchedulePicker && (
                                <div className="floating-enter" style={{ position: 'absolute', bottom: '100%', left: 0, right: isMobile ? 0 : 'auto', maxWidth: isMobile ? '100%' : 340, zIndex: 200, background: isOled ? '#000000' : dm ? C.bg2 : 'white', border: `1px solid ${isOled ? 'rgba(167,139,250,0.22)' : dm ? C.bdr2 : '#ede9fe'}`, borderRadius: isMobile ? '16px 16px 0 0' : 16, boxShadow: isOled ? '0 -12px 60px rgba(124,58,237,0.25), 0 -4px 20px rgba(0,0,0,0.95), 0 0 0 1px rgba(167,139,250,0.12)' : dm ? '0 -8px 32px rgba(0,0,0,0.5)' : '0 -4px 24px rgba(99,102,241,0.12)', padding: '16px 16px 12px', marginBottom: isMobile ? 0 : 4 }}>
                                    {/* Header */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: isOled ? 'rgba(167,139,250,0.12)' : dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isOled ? '#c4b5fd' : '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                        </div>
                                        <span style={{ fontSize: 14, fontWeight: 700, color: isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1' }}>
                                            {lang === 'en' ? 'Schedule message' : 'Отложить сообщение'}
                                        </span>
                                        <button onClick={() => { setShowSchedulePicker(false); setScheduleDateTime(''); setSendWhenOnline(false); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', padding: 2, display: 'flex' }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                        </button>
                                    </div>
                                    {/* Send when online toggle */}
                                    {activeChat?.type === 'private' && (
                                        <div onClick={() => setSendWhenOnline(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, cursor: 'pointer', userSelect: 'none' as const, padding: '8px 10px', borderRadius: 10, background: sendWhenOnline ? (isOled ? 'rgba(99,102,241,0.15)' : dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.07)') : 'transparent', border: `1px solid ${sendWhenOnline ? (isOled ? 'rgba(167,139,250,0.2)' : 'rgba(99,102,241,0.2)') : (dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)')}`, transition: 'background 0.2s' }}>
                                            <div style={{ width: 36, height: 20, borderRadius: 10, background: sendWhenOnline ? '#6366f1' : (dm ? '#3a3a5a' : '#d1d5db'), position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                                                <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'white', position: 'absolute', top: 2, left: sendWhenOnline ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 600, color: sendWhenOnline ? (isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1') : (dm ? '#9090b0' : '#6b7280') }}>
                                                    ⚡ {lang === 'en' ? 'Send when online' : 'Когда собеседник онлайн'}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {!sendWhenOnline && (
                                        <input
                                            type="datetime-local"
                                            value={scheduleDateTime}
                                            min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                                            onChange={e => setScheduleDateTime(e.target.value)}
                                            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${isOled ? 'rgba(167,139,250,0.2)' : dm ? C.bdr2 : '#e0d9ff'}`, background: isOled ? '#080812' : dm ? C.bg1 : '#f5f3ff', color: dm ? '#e0e0f0' : '#1e1b4b', fontSize: 14, boxSizing: 'border-box' as const, marginBottom: 12, outline: 'none', colorScheme: dm ? 'dark' : 'light' as any }}
                                        />
                                    )}
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button onClick={() => { setShowSchedulePicker(false); setScheduleDateTime(''); setSendWhenOnline(false); }} style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1.5px solid ${isOled ? 'rgba(167,139,250,0.15)' : dm ? C.bdr2 : '#e0e0f0'}`, background: 'transparent', color: dm ? '#9ca3af' : '#6b7280', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                                            {lang === 'en' ? 'Cancel' : 'Отмена'}
                                        </button>
                                        <button onClick={sendScheduled} disabled={!sendWhenOnline && !scheduleDateTime} style={{ flex: 2, padding: '10px', borderRadius: 10, border: 'none', background: (sendWhenOnline || scheduleDateTime) ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : (isOled ? '#1a1a2e' : dm ? '#2a2a4a' : '#f0eeff'), color: (sendWhenOnline || scheduleDateTime) ? 'white' : (dm ? '#5a5a8a' : '#9ca3af'), cursor: (sendWhenOnline || scheduleDateTime) ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, boxShadow: (sendWhenOnline || scheduleDateTime) ? '0 4px 14px rgba(99,102,241,0.35)' : 'none', transition: 'all 0.15s' }}>
                                            {lang === 'en' ? 'Schedule' : 'Запланировать'}
                                        </button>
                                    </div>
                                </div>
                            )}
                            {/* @mention dropdown */}
                            {mentionQuery !== null && activeChat?.type === 'group' && (() => {
                                const members = groupMembersCache[activeChat.id] || [];
                                const q = mentionQuery.toLowerCase();

                                // Специальные упоминания
                                const specials = [
                                    { id: '__all__', handle: 'all', username: lang === 'en' ? 'All members' : 'Все участники', desc: lang === 'en' ? 'Notify everyone' : 'Уведомить всех', icon: '👥' },
                                    { id: '__here__', handle: 'here', username: lang === 'en' ? 'Online members' : 'Онлайн-участники', desc: lang === 'en' ? 'Notify online users' : 'Уведомить онлайн', icon: '🟢' },
                                ].filter(s => s.handle.startsWith(q) || s.username.toLowerCase().includes(q));

                                const filtered = members.filter(m =>
                                    (m.username.toLowerCase().includes(q) || (m.tag || '').toLowerCase().includes(q))
                                ).slice(0, 6);

                                const allItems = [...specials, ...filtered];
                                if (allItems.length === 0) return null;

                                const insertMention = (handle: string) => {
                                    if (!inputRef.current) return;
                                    const val = inputRef.current.value;
                                    const pos = mentionAnchorPos.current;
                                    const before = val.slice(0, pos);
                                    const match = before.match(/@(\w*)$/);
                                    if (match) {
                                        const start = pos - match[0].length;
                                        inputRef.current.value = val.slice(0, start) + `@${handle} ` + val.slice(pos);
                                        const cur = start + handle.length + 2;
                                        inputRef.current.setSelectionRange(cur, cur);
                                        autoResize(inputRef.current);
                                    } else {
                                        inputRef.current.value += `@${handle} `;
                                        autoResize(inputRef.current);
                                    }
                                    setMentionQuery(null);
                                    inputRef.current.focus();
                                };

                                return (
                                    <div className="floating-enter" style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 100, background: isOled ? '#000000' : dm ? C.bg2 : 'white', border: `1px solid ${isOled ? 'rgba(167,139,250,0.18)' : dm ? C.bdr2 : '#ede9fe'}`, borderRadius: 12, boxShadow: isOled ? '0 8px 40px rgba(0,0,0,0.95), 0 0 0 1px rgba(167,139,250,0.12)' : '0 -4px 24px rgba(0,0,0,0.18)', overflow: 'hidden', marginBottom: 4 }}>
                                        {specials.map((s, i) => (
                                            <div key={s.id}
                                                onMouseDown={e => { e.preventDefault(); insertMention(s.handle); }}
                                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', background: i === mentionIndex ? (dm ? 'rgba(99,102,241,0.18)' : '#f0eeff') : 'transparent' }}
                                                onMouseEnter={() => setMentionIndex(i)}
                                            >
                                                <div style={{ width: 28, height: 28, borderRadius: '50%', background: isOled ? 'rgba(99,102,241,0.2)' : (dm ? 'rgba(99,102,241,0.15)' : '#ede9fe'), flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{s.icon}</div>
                                                <div>
                                                    <div style={{ fontSize: 13, fontWeight: 700, color: dm ? '#a5b4fc' : '#6366f1' }}>@{s.handle}</div>
                                                    <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{s.desc}</div>
                                                </div>
                                            </div>
                                        ))}
                                        {specials.length > 0 && filtered.length > 0 && <div style={{ height: 1, background: dm ? 'rgba(255,255,255,0.05)' : '#f0eeff', margin: '2px 0' }} />}
                                        {filtered.map((m, i) => (
                                            <div key={m.id}
                                                onMouseDown={e => {
                                                    e.preventDefault();
                                                    insertMention(m.tag || m.username);
                                                }}
                                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', background: (i + specials.length) === mentionIndex ? (dm ? 'rgba(99,102,241,0.18)' : '#f0eeff') : 'transparent' }}
                                                onMouseEnter={() => setMentionIndex(i + specials.length)}
                                            >
                                                <div style={{ width: 28, height: 28, borderRadius: '50%', background: m.avatar ? (dm ? C.bg1 : '#f7f8fc') : '#6366f1', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 13 }}>
                                                    {m.avatar ? <img src={config.fileUrl(m.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : m.username[0]?.toUpperCase()}
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b' }}>{m.username}</div>
                                                    {m.tag && <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>@{m.tag}</div>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                            {/* Input pill */}
                            <div style={darkStyles.inputPill}>
                                <button onClick={() => setShowEmojiPicker(p => !p)} style={{ ...darkStyles.pillBtn, color: showEmojiPicker ? (dm ? '#a5b4fc' : '#6366f1') : (dm ? (isOled ? '#a78bfa' : '#7c7caa') : '#9ca3af') }} title={lang === 'en' ? 'Emoji' : 'Эмодзи'}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>
                                <textarea
                                    ref={inputRef}
                                    rows={1}
                                    defaultValue=""
                                    onKeyDown={(e) => {
                                        if (mentionQuery !== null && activeChat?.type === 'group') {
                                            const members = groupMembersCache[activeChat.id] || [];
                                            const q = mentionQuery.toLowerCase();
                                            const specials = [{ handle: 'all' }, { handle: 'here' }].filter(s => s.handle.startsWith(q));
                                            const filtered = members.filter(m => (m.username.toLowerCase().includes(q) || (m.tag || '').toLowerCase().includes(q))).slice(0, 6);
                                            const allItems: { handle: string }[] = [...specials, ...filtered.map(m => ({ handle: m.tag || m.username }))];
                                            if (allItems.length > 0) {
                                                if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, allItems.length - 1)); return; }
                                                if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
                                                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                                                    e.preventDefault();
                                                    const item = allItems[mentionIndex];
                                                    if (item && inputRef.current) {
                                                        const val = inputRef.current.value;
                                                        const pos = mentionAnchorPos.current;
                                                        const before = val.slice(0, pos);
                                                        const match = before.match(/@(\w*)$/);
                                                        if (match) {
                                                            const start = pos - match[0].length;
                                                            inputRef.current.value = val.slice(0, start) + `@${item.handle} ` + val.slice(pos);
                                                            const cur = start + item.handle.length + 2;
                                                            inputRef.current.setSelectionRange(cur, cur);
                                                            autoResize(inputRef.current);
                                                        } else {
                                                            inputRef.current.value += `@${item.handle} `;
                                                            autoResize(inputRef.current);
                                                        }
                                                        setMentionQuery(null);
                                                    }
                                                    return;
                                                }
                                                if (e.key === 'Escape') { setMentionQuery(null); return; }
                                            }
                                        }
                                        if (e.key === 'Escape' && editingMessageId) { setEditingMessageId(null); setEditingText(''); if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = 'auto'; setInputCharCount(0); } return; }
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                                    }}
                                    onKeyUp={handleTyping}
                                    onInput={(e) => {
                                        autoResize(e.currentTarget);
                                        // Auto-save draft so it survives page reload
                                        if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
                                        draftSaveTimerRef.current = setTimeout(() => { saveDraft(activeChatRef.current); }, 800);
                                        if (activeChat?.type === 'group') {
                                            const val = e.currentTarget.value;
                                            const pos = e.currentTarget.selectionStart || 0;
                                            const before = val.slice(0, pos);
                                            const match = before.match(/@(\w*)$/);
                                            if (match) {
                                                mentionAnchorPos.current = pos;
                                                setMentionQuery(match[1]);
                                                setMentionIndex(0);
                                            } else {
                                                setMentionQuery(null);
                                            }
                                        }
                                    }}
                                    onBlur={() => setTimeout(() => setMentionQuery(null), 250)}
                                    onPaste={(e) => {
                                        const items = e.clipboardData?.items;
                                        if (!items) return;
                                        const imgs = Array.from(items).filter(i => i.kind === 'file' && i.type.startsWith('image/'));
                                        if (imgs.length > 0) {
                                            e.preventDefault();
                                            addPendingFiles(imgs.map(i => i.getAsFile()!).filter(Boolean));
                                        } else {
                                            setTimeout(() => { if (inputRef.current) { autoResize(inputRef.current); setInputCharCount(inputRef.current.value.length); } }, 0);
                                        }
                                    }}
                                    onChange={() => { if (inputRef.current) setInputCharCount(inputRef.current.value.length); }}
                                    placeholder={isChannelChat ? t('Write a post...') : t('Type a message...')}
                                    style={{ ...darkStyles.input, ...(isMobile ? { fontSize: 16 } : {}) }}
                                />
                                {inputCharCount > 500 && (
                                    <span style={{ position: 'absolute', bottom: 2, right: 8, fontSize: 10, color: inputCharCount > 4000 ? '#ef4444' : isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af', pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}>
                                        {inputCharCount}/4096
                                    </span>
                                )}
                                <div style={{ position: 'relative', alignSelf: 'center', display: 'flex' }}>
                                    <button ref={attachBtnRef} onClick={() => {
                                        if (!showAttachMenu && attachBtnRef.current) {
                                            const r = attachBtnRef.current.getBoundingClientRect();
                                            const menuW = 180;
                                            const x = Math.max(8, Math.min(r.left, window.innerWidth - menuW - 8));
                                            // bottom = расстояние от низа viewport до верха кнопки + зазор
                                            const vvHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                                            const bottom = vvHeight - r.top + 8;
                                            setAttachMenuPos({ x, bottom });
                                        }
                                        setShowAttachMenu(p => !p);
                                    }} style={{ ...darkStyles.pillBtn, color: showAttachMenu ? (dm ? '#a5b4fc' : '#6366f1') : (dm ? (isOled ? '#a78bfa' : '#7c7caa') : '#9ca3af') }}>
                                        {uploading ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>}
                                    </button>
                                {showAttachMenu && (() => {
                                    const attachItems = [
                                        { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>, label: lang === 'en' ? 'File' : 'Файл', color: '#6366f1', action: () => { setShowAttachMenu(false); setTimeout(() => fileInputRef.current?.click(), 80); } },
                                        ...(activeChat?.type === 'group' ? [{ icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>, label: lang === 'en' ? 'Poll' : 'Опрос', color: '#8b5cf6', action: () => { setShowAttachMenu(false); setShowPollCreator(true); } }] : []),
                                        { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>, label: lang === 'en' ? 'Location' : 'Геопозиция', color: '#10b981', action: () => { setShowAttachMenu(false); setShowLocationPicker(true); } },
                                        { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, label: lang === 'en' ? 'Contact' : 'Контакт', color: '#f97316', action: () => { setShowAttachMenu(false); setShowContactPicker(true); } },
                                    ];
                                    if (isMobile) {
                                        // Bottom sheet on mobile — avoids ghost-click and keyboard-shift issues
                                        return (
                                            <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={() => setShowAttachMenu(false)}>
                                                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }} />
                                                <div className="modal-enter mobile-bottom-sheet" style={{ position: 'relative', background: isOled ? '#0a0a14' : (dm ? '#1a1a2e' : 'white'), borderRadius: '20px 20px 0 0', padding: '8px 0 env(safe-area-inset-bottom,12px)', zIndex: 1 }} onClick={e => e.stopPropagation()}>
                                                    <div style={{ width: 36, height: 4, borderRadius: 2, background: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)', margin: '6px auto 12px' }} />
                                                    {attachItems.map((item, i) => (
                                                        <button key={i} onPointerUp={() => item.action()} style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '14px 22px', background: 'none', border: 'none', cursor: 'pointer', color: isOled ? '#c4b5fd' : (dm ? '#e2e8f0' : '#1e1b4b'), fontSize: 16, textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
                                                            <div style={{ width: 42, height: 42, borderRadius: '50%', background: `${item.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: item.color, flexShrink: 0 }}>
                                                                {item.icon}
                                                            </div>
                                                            <span style={{ fontWeight: 500 }}>{item.label}</span>
                                                        </button>
                                                    ))}
                                                    {serverInfo?.storage === 'cloudinary' && (
                                                        <div style={{ padding: '6px 22px 10px', fontSize: 12, color: dm ? '#6060a0' : '#9ca3af' }}>
                                                            ☁️ {lang === 'en' ? `Image ≤${serverInfo.max_image_mb} MB · Video ≤${serverInfo.max_video_mb} MB` : `Фото ≤${serverInfo.max_image_mb} МБ · Видео ≤${serverInfo.max_video_mb} МБ`}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    }
                                    // Desktop: floating popup above the button
                                    return (
                                        <>
                                        <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setShowAttachMenu(false)} />
                                        <div className="floating-enter" style={{ position: 'fixed', bottom: attachMenuPos.bottom, left: attachMenuPos.x, zIndex: 300, background: isOled ? '#0a0a14' : (dm ? '#1a1a2e' : 'white'), border: `1px solid ${isOled ? 'rgba(167,139,250,0.2)' : (dm ? 'rgba(99,102,241,0.25)' : '#e5e7eb')}`, borderRadius: 14, boxShadow: isOled ? '0 8px 40px rgba(0,0,0,0.95), 0 0 0 1px rgba(167,139,250,0.12)' : dm ? '0 8px 32px rgba(0,0,0,0.45)' : '0 8px 28px rgba(99,102,241,0.15)', overflow: 'hidden', minWidth: 180, padding: '4px 0' }}>
                                            {attachItems.map((item, i) => (
                                                <button key={i} onClick={() => item.action()} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer', color: isOled ? '#c4b5fd' : (dm ? '#e2e8f0' : '#1e1b4b'), fontSize: 14, textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}
                                                    onMouseEnter={e => { e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.07)' : dm ? 'rgba(99,102,241,0.08)' : '#f5f3ff'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
                                                    <span style={{ color: item.color, display: 'inline-flex' }}>{item.icon}</span>
                                                    {item.label}
                                                </button>
                                            ))}
                                            {serverInfo?.storage === 'cloudinary' && (
                                                <div style={{ padding: '6px 16px 10px', fontSize: 11, color: isOled ? 'rgba(167,139,250,0.5)' : (dm ? '#6060a0' : '#9ca3af'), borderTop: `1px solid ${isOled ? 'rgba(167,139,250,0.1)' : (dm ? 'rgba(99,102,241,0.12)' : '#f0eeff')}` }}>
                                                    ☁️ {lang === 'en' ? `Image ≤${serverInfo.max_image_mb} MB · Video ≤${serverInfo.max_video_mb} MB` : `Фото ≤${serverInfo.max_image_mb} МБ · Видео ≤${serverInfo.max_video_mb} МБ`}
                                                </div>
                                            )}
                                        </div>
                                        </>
                                    );
                                })()}
                            </div>
                            {isRecording ? (
                                <>
                                    {/* Cancel */}
                                    <button onClick={cancelRecording} style={{ ...darkStyles.pillBtn, color: dm ? '#5a5a8a' : '#9ca3af' }} title={lang === 'en' ? 'Cancel' : 'Отмена'}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                    {/* Timer */}
                                    <span style={{ fontWeight: 600, color: isPaused ? (dm ? '#7c7caa' : '#9ca3af') : '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, minWidth: 36 }}>
                                        {!isPaused && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite', display: 'inline-block' }} />}
                                        {recordingTime}s
                                    </span>
                                    {/* Pause/Resume */}
                                    <button onClick={pauseRecording} style={{ ...darkStyles.pillBtn, color: isPaused ? '#6366f1' : '#ef4444' }} title={isPaused ? (lang === 'en' ? 'Resume' : 'Продолжить') : (lang === 'en' ? 'Pause' : 'Пауза')}>
                                        {isPaused
                                            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                            : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                                        }
                                    </button>
                                    {/* Send */}
                                    <button onClick={stopRecording} style={{ ...darkStyles.pillBtn, color: '#ef4444' }} title={lang === 'en' ? 'Send voice' : 'Отправить'}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                                    </button>
                                </>
                            ) : (
                                <button onClick={startRecording} style={darkStyles.pillBtn} title={lang === 'en' ? 'Record voice' : 'Записать голосовое'}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                                </button>
                            )}
                            <button onClick={() => setShowSchedulePicker(p => !p)} title={lang === 'en' ? 'Schedule' : 'Запланировать'}
                                style={{ ...darkStyles.pillBtn, position: 'relative', color: showSchedulePicker ? (isOled ? '#c4b5fd' : '#6366f1') : scheduledMessages.length > 0 ? (isOled ? '#a78bfa' : '#6366f1') : (dm ? (isOled ? '#8b7dc8' : '#6b6b9a') : '#7c7caa') }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                {scheduledMessages.length > 0 && <span style={{ position: 'absolute', top: 1, right: 1, minWidth: 14, height: 14, borderRadius: 7, background: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', boxShadow: '0 0 4px rgba(99,102,241,0.5)' }}>{scheduledMessages.length}</span>}
                            </button>
                            </div>{/* end inputPill */}
                            <button onClick={sendMessage} disabled={uploading} className={isMobile ? 'chat-send-btn-mobile' : ''} style={isMobile ? undefined : { ...darkStyles.sendBtn2, opacity: uploading ? 0.45 : 1, cursor: uploading ? 'not-allowed' : 'pointer' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                                </svg>
                            </button>
                            <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />
                        </div>}
                    </>
                ) : (
                    <div className="fadein-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '32px 40px', gap: 32, overflowY: 'auto' }}>
                        {/* Logo + greeting */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 72, height: 72, borderRadius: '50%', background: isOled ? 'linear-gradient(135deg,rgba(124,58,237,0.2),rgba(167,139,250,0.1))' : dm ? 'linear-gradient(135deg,rgba(99,102,241,0.2),rgba(139,92,246,0.1))' : 'linear-gradient(135deg,#ede9fe,#f5f3ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: isOled ? '0 0 40px rgba(167,139,250,0.15)' : dm ? '0 4px 24px rgba(99,102,241,0.12)' : '0 4px 24px rgba(99,102,241,0.1)', color: isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1' }}>
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            </div>
                            <div>
                                <div style={{ fontWeight: 800, fontSize: 22, color: dm ? '#e2e8f0' : '#1e1b4b', textAlign: 'center', letterSpacing: -0.3 }}>Aurora</div>
                                <div style={{ fontSize: 13, color: dm ? '#5a5a8a' : '#9ca3af', textAlign: 'center', marginTop: 4 }}>{lang === 'en' ? 'Select a chat or start a new one' : 'Выберите чат или начните новый'}</div>
                            </div>
                        </div>

                        {/* Quick actions */}
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                            {[
                                { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>, label: lang === 'en' ? 'Search' : 'Поиск', action: () => setShowSearch(true) },
                                { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, label: lang === 'en' ? 'New group' : 'Группа', action: () => setShowCreateGroup(true) },
                                { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>, label: lang === 'en' ? 'Channel' : 'Канал', action: () => setShowCreateChannel(true) },
                                { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>, label: lang === 'en' ? 'Saved' : 'Избранное', action: () => { setActiveChat({ type: 'private', id: currentUserId, name: '⭐ Избранные' }); loadPrivateMessages(currentUserId); } },
                            ].map(({ icon, label, action }) => (
                                <button key={label} onClick={action} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 20, border: `1.5px solid ${isOled ? 'rgba(167,139,250,0.2)' : dm ? 'rgba(99,102,241,0.22)' : '#ede9fe'}`, background: isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.07)' : 'white', color: isOled ? '#c4b5fd' : dm ? '#a5b4fc' : '#6366f1', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', boxShadow: dm ? 'none' : '0 1px 6px rgba(99,102,241,0.08)' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.12)' : dm ? 'rgba(99,102,241,0.14)' : '#ede9fe'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.07)' : 'white'; }}
                                >
                                    {icon}{label}
                                </button>
                            ))}
                        </div>

                        {/* Recent chats */}
                        {(() => {
                            const allUnread = Object.values(unreadCounts).reduce((s, n) => s + n, 0);
                            const recentUsers = [...users].filter(u => u.last_msg_time && !hiddenChats.has(`private-${u.id}`)).sort((a, b) => new Date(b.last_msg_time!).getTime() - new Date(a.last_msg_time!).getTime()).slice(0, 4);
                            const recentGroups = [...groups].filter(g => g.last_msg_time && !hiddenChats.has(`group-${g.id}`)).sort((a, b) => new Date(b.last_msg_time!).getTime() - new Date(a.last_msg_time!).getTime()).slice(0, 4);
                            const favEntry = favoritesLastMsg?.time && !hiddenChats.has(`private-${currentUserId}`) ? [{ kind: 'favorites' as const, data: { last_msg_time: favoritesLastMsg.time, last_msg_text: favoritesLastMsg.text, last_msg_file: favoritesLastMsg.file, last_msg_filename: favoritesLastMsg.filename } }] : [];
                            const recent = [...favEntry, ...recentUsers.map(u => ({ kind: 'user' as const, data: u })), ...recentGroups.map(g => ({ kind: 'group' as const, data: g }))].sort((a, b) => new Date((b.data as any).last_msg_time!).getTime() - new Date((a.data as any).last_msg_time!).getTime()).slice(0, 5);
                            if (!recent.length) return null;
                            const cardBg = isOled ? '#050508' : dm ? '#12122a' : 'white';
                            const cardBorder = isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.12)' : '#f0eeff';
                            return (
                                <div style={{ width: '100%', maxWidth: 460 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{lang === 'en' ? 'Recent' : 'Недавние'}</span>
                                        {allUnread > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: isOled ? '#7c3aed' : '#6366f1', borderRadius: 10, padding: '2px 8px' }}>{allUnread} {lang === 'en' ? 'unread' : 'непрочитанных'}</span>}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {recent.map(({ kind, data }) => {
                                            const d = data as any;
                                            const isFav = kind === 'favorites';
                                            const name = isFav ? (lang === 'en' ? 'Favorites' : 'Избранное') : (d.username || d.name || '');
                                            const avatarSrc = !isFav && d.avatar ? config.fileUrl(d.avatar) : null;
                                            const avatarBgColor = isFav ? 'linear-gradient(135deg,#f59e0b,#f97316)' : (d.avatar_color || '#6366f1');
                                            const unread = isFav ? 0 : (unreadCounts[`${kind === 'user' ? 'private' : 'group'}-${d.id}`] || 0);
                                            const isOwnMsg = d.last_msg_sender_id === currentUserId;
                                            const prefix = kind === 'group' && !d.is_channel && d.last_msg_time
                                                ? (isOwnMsg ? (lang === 'en' ? 'You: ' : 'Вы: ') : (d.last_msg_sender_name ? `${d.last_msg_sender_name}: ` : undefined))
                                                : undefined;
                                            const handleClick = () => {
                                                if (isFav) { setActiveChat({ type: 'private', id: currentUserId, name: lang === 'en' ? '⭐ Favorites' : '⭐ Избранные' }); loadPrivateMessages(currentUserId); }
                                                else if (kind === 'user') selectPrivateChat(d);
                                                else selectGroupChat(d);
                                            };
                                            return (
                                                <div key={isFav ? 'favorites' : `${kind}-${d.id}`} onClick={handleClick}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, background: cardBg, border: `1px solid ${cardBorder}`, cursor: 'pointer', transition: 'all 0.15s' }}
                                                    onMouseEnter={e => { e.currentTarget.style.borderColor = isOled ? 'rgba(167,139,250,0.3)' : '#6366f1'; e.currentTarget.style.background = isOled ? '#0a0614' : dm ? '#16113a' : '#f8f5ff'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.borderColor = cardBorder; e.currentTarget.style.background = cardBg; }}
                                                >
                                                    <div style={{ width: 42, height: 42, borderRadius: '50%', background: avatarSrc ? 'transparent' : avatarBgColor, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: isFav ? 18 : 17 }}>
                                                        {avatarSrc ? <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : isFav ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> : name[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontSize: 14, fontWeight: 600, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                                        {(d.last_msg_text || d.last_msg_file) && (
                                                            <div style={{ fontSize: 12, marginTop: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0 }}>
                                                                {renderSidebarSub(undefined, d.last_msg_text, d.last_msg_file, d.last_msg_filename, '', prefix, !isFav && kind === 'user' ? d.id : undefined)}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {unread > 0 && <div style={{ minWidth: 20, height: 20, borderRadius: 10, background: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0 }}>{unread > 99 ? '99+' : unread}</div>}
                                                    {d.last_msg_time && <span style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', flexShrink: 0, marginLeft: unread ? 0 : 4 }}>{formatSidebarTime(d.last_msg_time)}</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}
            </div>

            {/* Контекстное меню */}
            {menuMessage && (
                <>
                {/* Backdrop for mobile bottom sheet */}
                {isMobile && <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.4)' }} onClick={() => setMenuMessageId(null)} />}
                <div
                    ref={menuContainerRef}
                    data-ctx-mobile={isMobile ? 'true' : undefined}
                    style={isMobile ? {
                        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
                        borderRadius: '20px 20px 0 0', overflow: 'hidden',
                    } : {
                        position: 'fixed',
                        top: menuClampedPos.y ?? menuPosition.y,
                        left: menuClampedPos.x ?? menuPosition.x,
                        zIndex: 9999,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {(() => {
                            const quickReactions = (() => { try { return JSON.parse(localStorage.getItem('aurora_quick_reactions') || 'null') || ['👍','❤️','😂','😮','😢','🔥','🎉','👏']; } catch { return ['👍','❤️','😂','😮','😢','🔥','🎉','👏']; } })();
                            const isGroup = activeChat?.type === 'group';
                            const msgReactions = reactions[menuMessage.id] || [];
                            const addReaction = (emoji: string) => {
                                toggleReaction(menuMessage.id, !!isGroup, emoji);
                                setMenuMessageId(null);
                                setShowFullReactionPicker(false);
                            };
                            const menuGlow = isOled ? '0 0 30px rgba(124,58,237,0.3), 0 16px 40px rgba(0,0,0,0.95)' : dm ? '0 0 24px rgba(99,102,241,0.2), 0 12px 36px rgba(0,0,0,0.5)' : '0 0 20px rgba(99,102,241,0.1), 0 8px 28px rgba(0,0,0,0.14)';
                            const menuBg = isOled ? '#080810' : dm ? C.bg3 : 'white';
                            if (showFullReactionPicker) {
                                return (
                                    <div style={{ backgroundColor: menuBg, boxShadow: menuGlow, overflow: 'hidden', borderRadius: isMobile ? '20px 20px 0 0' : 14, width: isMobile ? undefined : 320 }}>
                                        {/* Back header */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
                                            <button onClick={() => setShowFullReactionPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: '2px 6px', borderRadius: 8, display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e2e8f0' : '#1e1b4b' }}>{lang === 'en' ? 'React' : 'Реакция'}</span>
                                        </div>
                                        <FullReactionPicker dm={dm} onSelect={addReaction} onClose={() => setShowFullReactionPicker(false)} />
                                    </div>
                                );
                            }
                            return (
                    <div style={{ ...styles.menu, backgroundColor: menuBg, boxShadow: menuGlow, padding: 0, overflow: 'hidden', maxHeight: isMobile ? '75vh' : '80vh', overflowY: 'auto', borderRadius: isMobile ? '20px 20px 0 0' : 14 }}>
                        {/* Quick reactions row */}
                        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 8px 6px', gap: 2 }}>
                            {quickReactions.slice(0, 7).map((emoji: string) => {
                                const hasMyReaction = msgReactions.some(r => r.user_id === currentUserId && r.emoji === emoji);
                                return (
                                    <button key={emoji} onClick={() => addReaction(emoji)} className="emoji-btn"
                                        style={{ background: hasMyReaction ? (dm ? 'rgba(99,102,241,0.25)' : '#ede9fe') : 'none', border: hasMyReaction ? '1.5px solid #6366f1' : '1.5px solid transparent', borderRadius: 10, cursor: 'pointer', fontSize: 22, padding: 0, lineHeight: 1, transition: 'all 0.12s', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                        onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.25)')}
                                        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}>
                                        {emoji}
                                    </button>
                                );
                            })}
                            <button onClick={() => setShowFullReactionPicker(true)}
                                style={{ background: 'none', border: '1.5px solid transparent', borderRadius: 10, cursor: 'pointer', fontSize: 18, padding: '3px 6px', lineHeight: 1, color: dm ? '#a5b4fc' : '#6366f1', marginLeft: 'auto', transition: 'all 0.12s' }}
                                title={lang === 'en' ? 'All emoji' : 'Все эмодзи'}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                            </button>
                        </div>
                        <div style={{ padding: '4px 0' }}>
                        {activeChat && (() => {
                            const chatKey = `${activeChat.type}-${activeChat.id}`;
                            const isPinned = (pinnedMessages[chatKey] || []).some(p => p.id === menuMessage.id);
                            const canPin = activeChat.type === 'private' || isGroupAdmin;
                            if (!canPin) return null;
                            return (
                                <button onClick={() => togglePinMessage(chatKey, menuMessage)} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit', display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
                                    {isPinned ? t('Unpin') : t('Pin')}
                                </button>
                            );
                        })()}
                        <button onClick={() => enterSelectionMode(menuMessage)} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                            {t('Select message')}
                        </button>
                        {menuMessage.sender_id !== currentUserId && !menuMessage.is_deleted && (
                            <button onClick={() => { setReportTarget({ type: 'message', id: menuMessage.id, name: lang === 'en' ? 'this message' : 'это сообщение' }); setReportReason(''); setReportComment(''); setReportSent(false); setMenuMessageId(null); }} style={{ ...styles.menuItem, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 10 }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                                {lang === 'en' ? 'Report' : 'Пожаловаться'}
                            </button>
                        )}
                        {!menuMessage.is_deleted && (
                        <button onClick={() => { setReplyTo(menuMessage); setMenuMessageId(null); }} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                            {t('Reply')}
                        </button>
                        )}
                        {!menuMessage.is_deleted && <button onClick={() => { setForwardingMessage(menuMessage); setMenuMessageId(null); }} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>
                            {t('Forward')}
                        </button>}
                        <button onClick={() => {
                            const text = menuMessage.message_text ?? '';
                            if (navigator.clipboard?.writeText) {
                                navigator.clipboard.writeText(text);
                            } else {
                                const el = document.createElement('textarea');
                                el.value = text;
                                el.style.position = 'fixed';
                                el.style.opacity = '0';
                                document.body.appendChild(el);
                                el.select();
                                document.execCommand('copy');
                                document.body.removeChild(el);
                            }
                            setMenuMessageId(null);
                        }} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            {t('Copy text')}
                        </button>
                        {(() => {
                            // __gif__ prefix
                            if (isGif(menuMessage.message_text)) {
                                const gifUrl = specialUrl(menuMessage.message_text!);
                                const isSaved = (() => { try { return JSON.parse(localStorage.getItem('aurora_saved_gifs') || '[]').some((g: any) => g.url === gifUrl); } catch { return false; } })();
                                return (
                                    <button onClick={() => {
                                        try {
                                            const list = JSON.parse(localStorage.getItem('aurora_saved_gifs') || '[]');
                                            const next = isSaved ? list.filter((g: any) => g.url !== gifUrl) : [{ id: gifUrl, url: gifUrl, previewUrl: gifUrl }, ...list];
                                            localStorage.setItem('aurora_saved_gifs', JSON.stringify(next));
                                        } catch {}
                                        setMenuMessageId(null);
                                    }} style={{ ...styles.menuItem, color: isSaved ? '#6366f1' : (dm ? '#e0e0e0' : 'inherit'), display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                                        {isSaved ? t('Remove saved GIF') : t('Save GIF')}
                                    </button>
                                );
                            }
                            // Uploaded .gif file (stored in files[] array)
                            const filesRaw = (menuMessage as any).files;
                            if (filesRaw) {
                                const filesArr = (() => { try { return typeof filesRaw === 'string' ? JSON.parse(filesRaw) : filesRaw; } catch { return []; } })();
                                const gifFile = Array.isArray(filesArr) ? filesArr.find((f: any) => /\.gif$/i.test(f.filename || '')) : null;
                                if (gifFile?.file_path) {
                                    const gifUrl = gifFile.file_path.startsWith('http') ? gifFile.file_path : `${BASE_URL}${gifFile.file_path}`;
                                    const isSaved = (() => { try { return JSON.parse(localStorage.getItem('aurora_saved_gifs') || '[]').some((g: any) => g.url === gifUrl); } catch { return false; } })();
                                    return (
                                        <button onClick={() => {
                                            try {
                                                const list = JSON.parse(localStorage.getItem('aurora_saved_gifs') || '[]');
                                                const next = isSaved ? list.filter((g: any) => g.url !== gifUrl) : [{ id: gifUrl, url: gifUrl, previewUrl: gifUrl }, ...list];
                                                localStorage.setItem('aurora_saved_gifs', JSON.stringify(next));
                                            } catch {}
                                            setMenuMessageId(null);
                                        }} style={{ ...styles.menuItem, color: isSaved ? '#6366f1' : (dm ? '#e0e0e0' : 'inherit'), display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                                            {isSaved ? t('Remove saved GIF') : t('Save GIF')}
                                        </button>
                                    );
                                }
                            }
                            return null;
                        })()}
                        {'file_path' in menuMessage && menuMessage.file_path && (
                            <button onClick={async () => {
                                const isGroup = activeChat?.type === 'group';
                                const tokenParam = `?token=${encodeURIComponent(token)}`;
                                const url = isGroup
                                    ? `${BASE_URL}/files/group/download/${menuMessage.id}${tokenParam}`
                                    : `${BASE_URL}/files/download/${menuMessage.id}${tokenParam}`;
                                const filename = (menuMessage as any).filename || 'file';
                                try {
                                    const res = await fetch(url);
                                    const blob = await res.blob();
                                    const blobUrl = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = blobUrl;
                                    a.download = filename;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(blobUrl);
                                } catch {
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = filename;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                }
                                setMenuMessageId(null);
                            }} style={{ ...styles.menuItem, color: '#6366f1', display: 'flex', alignItems: 'center', gap: 10 }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                {t('Download')}
                            </button>
                        )}
                        {menuMessage.sender_id === currentUserId && !menuMessage.is_deleted && (
                            <>
                                {!isPoll(menuMessage.message_text) && !isGeo(menuMessage.message_text) && !isContact(menuMessage.message_text) && (
                                    <button onClick={() => handleEdit(menuMessage.id, menuMessage.message_text ?? '')} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit', display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                        {t('Edit message')}
                                    </button>
                                )}
                                <button onClick={() => handleDelete(menuMessage.id)} style={{ ...styles.menuItem, color: '#f44336', display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                                    {t('Delete message')}
                                </button>
                            </>
                        )}
                        {isEncryptedMessage(menuMessage.message_text) && (
                            <div style={{ ...styles.menuItem, color: dm ? '#7c7caa' : '#9ca3af', cursor: 'default', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
                                onClick={e => e.stopPropagation()}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                {lang === 'en' ? 'Message is encrypted' : 'Сообщение зашифровано'}
                            </div>
                        )}
                        <button onClick={() => setMenuMessageId(null)} style={{ ...styles.menuItem, color: dm ? '#aaa' : '#666', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            {t('Cancel')}
                        </button>
                        </div>
                    </div>
                    );
                })()}
                </div>
                </>
            )}

            {/* Sticker pack preview modal */}
            {stickerPackPreview && (
                <StickerPackPreviewModal
                    data={stickerPackPreview}
                    isDark={theme.darkMode}
                    onClose={() => setStickerPackPreview(null)}
                />
            )}

            {/* Модалки */}
            {showCreateGroup && (
                <CreateGroupModal token={token} isDark={theme.darkMode} onClose={() => setShowCreateGroup(false)} onGroupCreated={loadGroups} />
            )}
            {showCreateChannel && (
                <CreateChannelModal token={token} isDark={theme.darkMode} onClose={() => setShowCreateChannel(false)} onChannelCreated={loadGroups} />
            )}
            {showPollCreator && (
                <PollCreator
                    isDark={theme.darkMode}
                    onClose={() => setShowPollCreator(false)}
                    onCreate={handleCreatePoll}
                />
            )}
            {showLocationPicker && (
                <Suspense fallback={null}>
                    <LocationPicker
                        isDark={theme.darkMode}
                        onSend={sendGeoMessage}
                        onClose={() => setShowLocationPicker(false)}
                    />
                </Suspense>
            )}
            {showContactPicker && (
                <Suspense fallback={null}>
                    <ContactPicker
                        users={users}
                        currentUserId={currentUserId}
                        isDark={theme.darkMode}
                        onSend={sendContactMessage}
                        onClose={() => setShowContactPicker(false)}
                    />
                </Suspense>
            )}
            {/* Global message search */}
            {globalMsgSearch && (
                <div className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 4500, background: isOled ? 'rgba(0,0,0,0.88)' : dm ? 'rgba(15,10,40,0.8)' : 'rgba(15,10,40,0.45)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: isMobile ? 'flex-start' : 'flex-start', justifyContent: 'center', paddingTop: isMobile ? 0 : 80 }}
                    onClick={() => { setGlobalMsgSearch(false); setGlobalMsgQuery(''); setGlobalMsgResults([]); }}>
                    <div className="modal-enter" style={{ background: isOled ? '#000' : dm ? '#13131f' : 'white', borderRadius: isMobile ? 0 : 20, width: isMobile ? '100%' : 560, maxWidth: '96vw', maxHeight: isMobile ? '100svh' : '72vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.18), 0 24px 80px rgba(0,0,0,0.95)' : dm ? '0 24px 80px rgba(0,0,0,0.6)' : '0 24px 80px rgba(99,102,241,0.15)' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}` }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isOled ? '#c4b5fd' : '#6366f1'} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <input autoFocus value={globalMsgQuery} onChange={e => setGlobalMsgQuery(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Escape') { setGlobalMsgSearch(false); setGlobalMsgQuery(''); setGlobalMsgResults([]); } }}
                                placeholder={lang === 'en' ? 'Search in all chats...' : 'Поиск по всем чатам...'}
                                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 16, color: dm ? '#e2e8f0' : '#1e1b4b', fontFamily: 'inherit' }} />
                            {globalMsgLoading && <div style={{ width: 16, height: 16, border: `2px solid ${isOled ? 'rgba(167,139,250,0.3)' : 'rgba(99,102,241,0.3)'}`, borderTopColor: isOled ? '#a78bfa' : '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
                            {globalMsgQuery && !globalMsgLoading && <button onClick={() => { setGlobalMsgQuery(''); setGlobalMsgResults([]); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', padding: 2, display: 'flex' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
                            <button onClick={() => { setGlobalMsgSearch(false); setGlobalMsgQuery(''); setGlobalMsgResults([]); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', padding: 2, display: 'flex' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {globalMsgResults.length === 0 && globalMsgQuery.trim().length >= 2 && !globalMsgLoading && (
                                <div style={{ padding: 40, textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13 }}>{lang === 'en' ? 'No messages found' : 'Ничего не найдено'}</div>
                            )}
                            {globalMsgQuery.trim().length < 2 && !globalMsgLoading && (
                                <div style={{ padding: 40, textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13 }}>{lang === 'en' ? 'Enter at least 2 characters' : 'Введите минимум 2 символа'}</div>
                            )}
                            {globalMsgResults.map((r, i) => (
                                <div key={i} onClick={() => {
                                    const chat = r.chat_type === 'group' ? groups.find(g => g.id === r.chat_id) : users.find(u => u.id === r.chat_id);
                                    if (chat) {
                                        if (r.chat_type === 'group') selectGroupChat(chat as any);
                                        else selectPrivateChat(chat as any);
                                        setTimeout(() => goToMessage(r.message_id), 300);
                                    }
                                    setGlobalMsgSearch(false); setGlobalMsgQuery(''); setGlobalMsgResults([]);
                                }}
                                    style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 18px', cursor: 'pointer', borderBottom: `1px solid ${isOled ? 'rgba(255,255,255,0.03)' : dm ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}` }}
                                    onMouseEnter={e => (e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.04)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: isOled ? '#c4b5fd' : '#6366f1', marginBottom: 3 }}>{r.chat_name}</div>
                                        <div style={{ fontSize: 13, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, lineHeight: 1.5 }}>{r.message_text}</div>
                                        <div style={{ fontSize: 10, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 3 }}>{r.sender_name} · {new Date(r.timestamp).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {showInviteModal && selectedGroupId && activeChat?.type === 'group' && (
                <InviteToGroupModal
                    token={token}
                    groupId={selectedGroupId}
                    groupName={activeChat.name}
                    isDark={theme.darkMode}
                    onClose={() => setShowInviteModal(false)}
                    onInvited={() => {}}
                />
            )}
            {showGroupInfo && selectedGroupId && (
                <Suspense fallback={null}>
                <GroupInfo
                    token={token}
                    groupId={selectedGroupId}
                    currentUserId={currentUserId}
                    isDark={theme.darkMode}
                    liveGroupAvatar={groups.find(g => g.id === selectedGroupId)?.avatar}
                    liveUsers={users}
                    messages={activeChat?.type === 'group' ? messages : []}
                    onClose={() => setShowGroupInfo(false)}
                    onInvite={() => { setShowGroupInfo(false); setShowInviteModal(true); }}
                    onUserClick={user => { setShowGroupInfo(false); setSelectedUserForProfile(user as any); setProfileFromGroupInfo(true); }}
                    onGroupAvatarUpdated={handleGroupAvatarUpdated}
                    onGroupUpdated={handleGroupUpdated}
                    onGroupDeleted={handleGroupDeleted}
                    onGroupLeft={gId => {
                        setGroups(prev => prev.filter(g => g.id !== gId));
                        if (activeChat?.type === 'group' && activeChat.id === gId) setActiveChat(null);
                        setShowGroupInfo(false);
                    }}
                    onGoToMessage={id => { setShowGroupInfo(false); setTimeout(() => goToMessage(id), 50); }}
                    onReport={(type, id, name) => { setShowGroupInfo(false); setReportTarget({ type, id, name }); setReportReason(''); setReportComment(''); setReportSent(false); }}
                />
                </Suspense>
            )}
            {showFolderManager && (
                <Suspense fallback={null}>
                <FolderManager
                    token={token}
                    folders={folders}
                    users={users.filter(u => u.id !== currentUserId)}
                    groups={groups}
                    isDark={theme.darkMode}
                    baseUrl={BASE_URL}
                    onClose={() => setShowFolderManager(false)}
                    onBack={() => { setShowFolderManager(false); setTimeout(() => setShowSettings(true), 50); }}
                    onFoldersChange={updated => { setFolders(updated); }}
                />
                </Suspense>
            )}
            {showSettings && (
                <Suspense fallback={null}>
                <SettingsModal
                    token={token}
                    currentUsername={currentUsername}
                    currentUserTag={currentUserTag}
                    currentAvatar={currentUserAvatar}
                    currentStatus={currentUserStatus}
                    isOnline={true}
                    theme={theme}
                    onThemeChange={onThemeChange}
                    onProfileUpdate={onProfileUpdate}
                    onLogout={onLogout}
                    onOpenFolders={() => { setShowSettings(false); setTimeout(() => setShowFolderManager(true), 50); }}
                    onOpenFavorites={() => {
                        saveDraft(activeChatRef.current);
                        restoreDraft(`private-${currentUserId}`);
                        setReplyTo(null);
                        setActiveChat({ type: 'private', id: currentUserId, name: '⭐ Избранные' });
                        loadPrivateMessages(currentUserId);
                    }}
                    onOpenArchive={() => setShowArchive(true)}
                    onOpenSupport={() => setShowSupportChat(true)}
                    onOpenAdmin={() => setShowAdminPanel(true)}
                    onShowOnboarding={onShowOnboarding ? () => { setShowSettings(false); setTimeout(() => onShowOnboarding(), 200); } : undefined}
                    accounts={accounts}
                    currentUserId={currentUserId}
                    onSwitchAccount={onSwitchAccount}
                    onClose={() => setShowSettings(false)}
                />
                </Suspense>
            )}
            {showSupportChat && (
                <Suspense fallback={null}>
                <SupportChat
                    token={token}
                    currentUserId={currentUserId}
                    isDark={theme.darkMode}
                    onClose={() => setShowSupportChat(false)}
                    onBack={() => { setShowSupportChat(false); setTimeout(() => setShowSettings(true), 50); }}
                    newReply={newSupportReply}
                />
                </Suspense>
            )}
            {showAdminPanel && (
                <Suspense fallback={null}>
                <AdminPanel
                    token={token}
                    isDark={theme.darkMode}
                    onClose={() => setShowAdminPanel(false)}
                    onBack={() => { setShowAdminPanel(false); setTimeout(() => setShowSettings(true), 50); }}
                    newSupportMsg={newSupportMsg}
                />
                </Suspense>
            )}
            {showHelp && (
                <Suspense fallback={null}>
                <HelpModal
                    isDark={theme.darkMode}
                    initialTab="patchnotes"
                    onClose={() => setShowHelp(false)}
                />
                </Suspense>
            )}
            {showMediaPanel && activeChat && (
                <Suspense fallback={null}>
                <ChatMediaPanel
                    messages={messages}
                    isDark={theme.darkMode}
                    onClose={() => setShowMediaPanel(false)}
                    onGoToMessage={id => { setShowMediaPanel(false); setTimeout(() => goToMessage(id), 50); }}
                />
                </Suspense>
            )}
            {/* Report modal */}
            {reportTarget && (
                <div className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: isOled ? 'rgba(0,0,0,0.88)' : (dm ? 'rgba(15,10,40,0.8)' : 'rgba(15,10,40,0.45)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setReportTarget(null)}>
                    <div className="modal-enter" style={{ background: isOled ? '#000' : (dm ? '#13132a' : '#fff'), borderRadius: 20, width: 360, maxWidth: '92vw', padding: '24px 24px 20px', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: dm ? '1px solid rgba(99,102,241,0.2)' : '1px solid #ede9fe' }} onClick={e => e.stopPropagation()}>
                        {reportSent ? (
                            <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                                <div style={{ fontSize: 16, fontWeight: 700, color: dm ? '#e2e8f0' : '#1e1b4b', marginBottom: 8 }}>{lang === 'en' ? 'Report sent' : 'Жалоба отправлена'}</div>
                                <div style={{ fontSize: 13, color: dm ? '#7c7caa' : '#6b7280', marginBottom: 20 }}>{lang === 'en' ? 'Our moderators will review it.' : 'Наши модераторы рассмотрят её.'}</div>
                                <button onClick={() => setReportTarget(null)} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>OK</button>
                            </div>
                        ) : (
                            <>
                                <div style={{ fontSize: 16, fontWeight: 700, color: dm ? '#e2e8f0' : '#1e1b4b', marginBottom: 4 }}>{lang === 'en' ? 'Report' : 'Пожаловаться'}</div>
                                <div style={{ fontSize: 13, color: dm ? '#7c7caa' : '#6b7280', marginBottom: 16 }}>{lang === 'en' ? `Select the reason for reporting ${reportTarget.name}` : `Выберите причину жалобы`}</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                                    {[
                                        { id: 'spam', ru: 'Спам', en: 'Spam' },
                                        { id: 'violence', ru: 'Насилие или угрозы', en: 'Violence or threats' },
                                        { id: 'scam', ru: 'Мошенничество', en: 'Scam or fraud' },
                                        { id: 'nsfw', ru: 'Неприемлемый контент', en: 'Inappropriate content' },
                                        { id: 'harassment', ru: 'Оскорбления / харассмент', en: 'Harassment' },
                                        { id: 'other', ru: 'Другое', en: 'Other' },
                                    ].map(r => (
                                        <button key={r.id} onClick={() => setReportReason(r.id)}
                                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: reportReason === r.id ? '2px solid #6366f1' : `1.5px solid ${dm ? 'rgba(99,102,241,0.2)' : '#ede9fe'}`, background: reportReason === r.id ? (dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.06)') : 'transparent', cursor: 'pointer', color: reportReason === r.id ? '#6366f1' : (dm ? '#e2e8f0' : '#374151'), fontSize: 14, textAlign: 'left' as const, transition: 'all 0.15s' }}>
                                            <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${reportReason === r.id ? '#6366f1' : (dm ? '#4a4a6a' : '#d1d5db')}`, background: reportReason === r.id ? '#6366f1' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {reportReason === r.id && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }} />}
                                            </div>
                                            {lang === 'en' ? r.en : r.ru}
                                        </button>
                                    ))}
                                </div>
                                {reportReason === 'other' && (
                                    <textarea value={reportComment} onChange={e => setReportComment(e.target.value)} placeholder={lang === 'en' ? 'Describe the problem...' : 'Опишите проблему...'} maxLength={500} rows={3}
                                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${dm ? 'rgba(99,102,241,0.2)' : '#ede9fe'}`, background: dm ? 'rgba(255,255,255,0.04)' : '#f5f3ff', color: dm ? '#e2e8f0' : '#1e1b4b', fontSize: 13, resize: 'none' as const, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const, marginBottom: 10 }} />
                                )}
                                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                                    <button onClick={() => setReportTarget(null)} style={{ flex: 1, padding: '11px', borderRadius: 12, border: `1.5px solid ${dm ? 'rgba(99,102,241,0.2)' : '#ede9fe'}`, background: 'transparent', color: dm ? '#9090b0' : '#6b7280', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                                        {t('Cancel')}
                                    </button>
                                    <button disabled={!reportReason || reportLoading} onClick={async () => {
                                        if (!reportReason || reportLoading) return;
                                        setReportLoading(true);
                                        try {
                                            await fetch(`${config.API_URL}/reports?token=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_type: reportTarget.type, target_id: reportTarget.id, reason: reportReason, comment: reportComment }) });
                                            setReportSent(true);
                                            showInAppToast({ title: lang === 'en' ? 'Report sent' : 'Жалоба отправлена', body: lang === 'en' ? 'Thank you, we will review it.' : 'Спасибо, мы рассмотрим её.', chatType: 'private', chatId: 0, avatarLetter: '✅', avatarColor: '#22c55e' });
                                        } catch {} finally { setReportLoading(false); }
                                    }} style={{ flex: 1, padding: '11px', borderRadius: 12, border: 'none', background: reportReason ? 'linear-gradient(135deg,#ef4444,#dc2626)' : (dm ? 'rgba(255,255,255,0.08)' : '#f3f4f6'), color: reportReason ? 'white' : (dm ? '#5a5a8a' : '#9ca3af'), fontSize: 14, fontWeight: 700, cursor: reportReason ? 'pointer' : 'default', transition: 'all 0.15s' }}>
                                        {reportLoading ? '...' : (lang === 'en' ? 'Send report' : 'Отправить')}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Bulk delete confirmation modal */}
            {bulkDeleteConfirm && (
                <div className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setBulkDeleteConfirm(false)}>
                    <div className="modal-enter" style={{ background: dm ? '#13132a' : '#ffffff', borderRadius: 20, width: 320, padding: '28px 28px 22px', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', marginBottom: 8 }}>{t('Delete messages?')}</div>
                        <div style={{ fontSize: 14, color: dm ? '#9090b0' : '#6b7280', marginBottom: 20 }}>{t('This cannot be undone.')}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <button onClick={() => handleBulkDelete(false)} style={{ width: '100%', padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e53935, #ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{t('Delete for everyone')}</button>
                            <button onClick={() => handleBulkDelete(true)} style={{ width: '100%', padding: '11px 0', borderRadius: 12, border: dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', background: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#c0c0d8' : '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{t('Delete for me')}</button>
                            <button onClick={() => setBulkDeleteConfirm(false)} style={{ width: '100%', padding: '9px 0', borderRadius: 12, border: 'none', background: 'none', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13, cursor: 'pointer' }}>{t('Cancel')}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk forward modal */}
            {forwardingMessages && (() => {
                const fwdBg = isOled ? '#000000' : dm ? '#0d0d1a' : '#f7f6ff';
                const fwdCard = isOled ? '#050508' : dm ? '#13131f' : 'white';
                const fwdShadow = isOled ? '0 2px 16px rgba(0,0,0,0.9),0 0 0 1px rgba(167,139,250,0.07)' : dm ? '0 2px 12px rgba(0,0,0,0.4),0 0 0 1px rgba(99,102,241,0.08)' : '0 2px 8px rgba(99,102,241,0.07),0 0 0 1px rgba(99,102,241,0.05)';
                const fwdCol = dm ? '#e2e8f0' : '#1e1b4b';
                const fwdSub = isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af';
                const fwdSecLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: fwdSub, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'block', marginBottom: 6, marginTop: 10 };
                const fwdItem = (onClick: () => void, key: string, avatar: React.ReactNode, name: string, sub?: string) => (
                    <div key={key} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', background: fwdCard, borderRadius: 12, boxShadow: fwdShadow, marginBottom: 6 }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')} onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                        {avatar}
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, color: fwdCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                            {sub && <div style={{ fontSize: 11, color: fwdSub }}>{sub}</div>}
                        </div>
                    </div>
                );
                return (
                <div className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 4000, background: isOled ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.5)', backdropFilter: isOled ? 'blur(8px)' : 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setForwardingMessages(null)}>
                    <div className="modal-enter" style={{ background: fwdBg, borderRadius: 20, width: 360, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 60px rgba(124,58,237,0.25), 0 30px 80px rgba(0,0,0,0.9)' : dm ? '0 0 50px rgba(99,102,241,0.22), 0 24px 70px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.14), 0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
                        <div style={{ padding: '16px 18px 14px', background: fwdCard, boxShadow: `0 1px 0 ${isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 700, fontSize: 15, color: fwdCol }}>{lang === 'en' ? `Forward ${forwardingMessages.length} msg.` : `Переслать ${forwardingMessages.length} сообщ.`}</span>
                                <button onClick={() => setForwardingMessages(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: fwdSub, display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 14px' }}>
                            <span style={fwdSecLabel}>Избранное</span>
                            {fwdItem(() => { forwardingMessages!.forEach(msg => { const sn = (msg as any).sender_name || users.find((u: any) => u.id === msg.sender_id)?.username || 'Unknown'; const fp = `↪️ ${lang === 'en' ? 'Forwarded from' : 'Переслано от'} ${sn}\n`; const ft = (msg as any).message_text ? fp + (msg as any).message_text : fp + ((msg as any).filename ? `📎 ${(msg as any).filename}` : ''); const fa = (() => { try { const r = (msg as any).files; return r ? (typeof r === 'string' ? JSON.parse(r) : r) : null; } catch { return null; } })(); if (fa?.length) wsService.sendMessage(currentUserId, ft, undefined, undefined, undefined, undefined, undefined, undefined, fa); else wsService.sendMessage(currentUserId, ft, (msg as any).file_path, (msg as any).filename, (msg as any).file_size); }); setForwardingMessages(null); }, 'fav', <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#f59e0b,#f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>, lang === 'en' ? 'Favorites' : 'Избранное')}
                            {groups.filter(g => !g.is_channel || g.my_role === 'admin' || g.creator_id === currentUserId).length > 0 && <span style={fwdSecLabel}>Группы</span>}
                            {groups.filter(g => !g.is_channel || g.my_role === 'admin' || g.creator_id === currentUserId).map(g => fwdItem(() => { forwardingMessages!.forEach(msg => { const sn = (msg as any).sender_name || users.find((u: any) => u.id === msg.sender_id)?.username || 'Unknown'; const fp = `↪️ ${lang === 'en' ? 'Forwarded from' : 'Переслано от'} ${sn}\n`; const ft = (msg as any).message_text ? fp + (msg as any).message_text : fp + ((msg as any).filename ? `📎 ${(msg as any).filename}` : ''); const fa = (() => { try { const r = (msg as any).files; return r ? (typeof r === 'string' ? JSON.parse(r) : r) : null; } catch { return null; } })(); if (fa?.length) wsService.sendGroupMessage(g.id, ft, undefined, undefined, undefined, undefined, undefined, undefined, fa); else wsService.sendGroupMessage(g.id, ft, (msg as any).file_path, (msg as any).filename, (msg as any).file_size); }); setForwardingMessages(null); }, `fg-${g.id}`, <div style={{ width: 38, height: 38, borderRadius: 10, background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0, overflow: 'hidden' }}>{g.avatar ? <img src={config.fileUrl(g.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : g.name[0]?.toUpperCase()}</div>, g.name, g.is_channel ? '📢 Канал' : '👥 Группа'))}
                            {users.filter(u => !(u as any).is_deleted && u.username !== 'Удалённый пользователь').length > 0 && <span style={fwdSecLabel}>Люди</span>}
                            {users.filter(u => !(u as any).is_deleted && u.username !== 'Удалённый пользователь').map(u => fwdItem(() => { forwardingMessages.forEach(msg => { const sn = (msg as any).sender_name || users.find((uu: any) => uu.id === msg.sender_id)?.username || 'Unknown'; const fp = `↪️ ${lang === 'en' ? 'Forwarded from' : 'Переслано от'} ${sn}\n`; const ft = (msg as any).message_text ? fp + (msg as any).message_text : fp + ((msg as any).filename ? `📎 ${(msg as any).filename}` : ''); const fa = (() => { try { const r = (msg as any).files; return r ? (typeof r === 'string' ? JSON.parse(r) : r) : null; } catch { return null; } })(); if (fa?.length) wsService.sendMessage(u.id, ft, undefined, undefined, undefined, undefined, undefined, undefined, fa); else wsService.sendMessage(u.id, ft, (msg as any).file_path, (msg as any).filename, (msg as any).file_size); }); setForwardingMessages(null); }, `fu-${u.id}`, <div style={{ width: 38, height: 38, borderRadius: 10, background: (u as any).avatar_color || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 15 }}>{u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}</div>, u.username, u.tag ? `@${u.tag}` : undefined))}
                        </div>
                    </div>
                </div>
                );
            })()}

            {/* Clear chat confirmation modal */}
            {showClearConfirm && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    className="modal-backdrop-enter" onClick={() => setShowClearConfirm(false)}>
                    <div style={{ background: isOled ? '#000000' : (dm ? '#13132a' : '#ffffff'), borderRadius: 20, width: 320, padding: '28px 28px 22px', boxShadow: isOled ? '0 0 40px rgba(167,139,250,0.15), 0 30px 80px rgba(0,0,0,0.95)' : (dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)'), border: isOled ? '1px solid rgba(167,139,250,0.2)' : (dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe'), textAlign: 'center' }}
                        className="modal-enter" onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', marginBottom: 8 }}>{t('This cannot be undone.')}</div>
                        <div style={{ fontSize: 14, color: isOled ? '#7070a0' : (dm ? '#9090b0' : '#6b7280'), marginBottom: 24 }}>{lang === 'en' ? 'Clear all chat history?' : 'Очистить всю историю чата?'}</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => setShowClearConfirm(false)} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: isOled ? '1.5px solid rgba(167,139,250,0.2)' : (dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe'), background: isOled ? '#0a0a10' : (dm ? '#1e1e3a' : '#f5f3ff'), color: isOled ? '#c4b5fd' : (dm ? '#c0c0d8' : '#374151'), fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{t('Cancel')}</button>
                            <button onClick={confirmClearChat} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e53935, #ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(229,57,53,0.35)' }}>{t('Clear')}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete message confirmation modal */}
            {deleteConfirmId !== null && (
                <div
                    style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: isOled ? 'rgba(0,0,0,0.85)' : (dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    className="modal-backdrop-enter"
                    onClick={() => setDeleteConfirmId(null)}
                >
                    <div
                        style={{ background: isOled ? '#000000' : (dm ? '#13132a' : '#ffffff'), borderRadius: 20, width: 320, padding: '28px 28px 22px', boxShadow: isOled ? '0 0 40px rgba(167,139,250,0.15), 0 30px 80px rgba(0,0,0,0.9)' : (dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)'), border: isOled ? '1px solid rgba(167,139,250,0.2)' : (dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe'), textAlign: 'center' }}
                        className="modal-enter"
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ fontSize: 17, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', marginBottom: 8 }}>{t('Delete message')}</div>
                        <div style={{ fontSize: 14, color: isOled ? '#9090b0' : (dm ? '#9090b0' : '#6b7280'), marginBottom: 20 }}>{t('This cannot be undone.')}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                            <button
                                onClick={() => confirmDelete(false)}
                                style={{ width: '100%', padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e53935, #ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(229,57,53,0.35)' }}
                            >{t('Delete for everyone')}</button>
                            {deleteConfirmId?.senderId === currentUserId && (
                            <button
                                onClick={() => confirmDelete(true)}
                                style={{ width: '100%', padding: '11px 0', borderRadius: 12, border: isOled ? '1.5px solid rgba(167,139,250,0.2)' : (dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe'), background: isOled ? '#0a0a10' : (dm ? '#1e1e3a' : '#f5f3ff'), color: isOled ? '#c4b5fd' : (dm ? '#c0c0d8' : '#374151'), fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                            >{t('Delete for me')}</button>
                            )}
                            <button
                                onClick={() => setDeleteConfirmId(null)}
                                style={{ width: '100%', padding: '9px 0', borderRadius: 12, border: 'none', background: 'none', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13, cursor: 'pointer' }}
                            >{t('Cancel')}</button>
                        </div>
                    </div>
                </div>
            )}
            {showSearch && (
                <Suspense fallback={null}>
                <SearchModal
                    token={token}
                    currentUserId={currentUserId}
                    isDark={theme.darkMode}
                    activeChatId={activeChat?.id}
                    activeChatType={activeChat?.type}
                    groupMembers={activeChat?.type === 'group' ? (groupMembersCache[activeChat.id] ?? []) : []}
                    onClose={() => setShowSearch(false)}
                    onSelectMessage={(type, chatId, messageId) => {
                        if (type === 'private') {
                            const user = usersById.get(chatId);
                            if (user) selectPrivateChat(user);
                        } else {
                            const group = groups.find(g => g.id === chatId);
                            if (group) selectGroupChat(group);
                        }
                        setTimeout(() => {
                            document.getElementById(`msg-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 150);
                    }}
                />
                </Suspense>
            )}
            {selectedUserForProfile && (
                <Suspense fallback={null}>
                <UserProfileModal
                    user={selectedUserForProfile}
                    token={token}
                    isDark={theme.darkMode}
                    isSelf={selectedUserForProfile.id === currentUserId}
                    initialMediaOpen={selectedUserForProfile.id === currentUserId}
                    isOnline={selectedUserForProfile.id === currentUserId ? true : (blockedUserIds.has(selectedUserForProfile.id) ? false : (usersById.get(selectedUserForProfile.id)?.is_online ?? selectedUserForProfile.is_online))}
                    messages={
                        selectedUserForProfile.id === currentUserId
                            ? favoritesMessages
                            : activeChat?.type === 'private' && activeChat.id === selectedUserForProfile.id
                                ? messages
                                : activeChat?.type === 'group'
                                    ? messages.filter((m: any) => m.sender_id === selectedUserForProfile.id)
                                    : []
                    }
                    onClose={() => {
                        setSelectedUserForProfile(null);
                        if (profileFromGroupInfo) { setProfileFromGroupInfo(false); setShowGroupInfo(true); }
                    }}
                    onStartChat={() => {
                        if (selectedUserForProfile.id === currentUserId) {
                            setActiveChat({ type: 'private', id: currentUserId, name: lang === 'en' ? '⭐ Favorites' : '⭐ Избранные' });
                            loadPrivateMessages(currentUserId);
                        } else {
                            selectPrivateChat(selectedUserForProfile);
                        }
                        setSelectedUserForProfile(null);
                    }}
                    onGoToMessage={id => { setSelectedUserForProfile(null); setTimeout(() => goToMessage(id), 50); }}
                    onReport={(type, id, name) => { if (type === 'user' && id === currentUserId) return; setSelectedUserForProfile(null); setReportTarget({ type, id, name }); setReportReason(''); setReportComment(''); setReportSent(false); }}
                    onClearChat={selectedUserForProfile.id !== currentUserId ? () => { setSelectedUserForProfile(null); handleClearChat(); } : undefined}
                    onExportChat={selectedUserForProfile.id !== currentUserId ? () => { api.exportChat(token, 'private', selectedUserForProfile.id, 'json'); } : undefined}
                />
                </Suspense>
            )}

            {/* Forward message modal */}
            {forwardingMessage && (() => {
                const sfBg = isOled ? '#000000' : dm ? '#0d0d1a' : '#f7f6ff';
                const sfCard = isOled ? '#050508' : dm ? '#13131f' : 'white';
                const sfShadow = isOled ? '0 2px 16px rgba(0,0,0,0.9),0 0 0 1px rgba(167,139,250,0.07)' : dm ? '0 2px 12px rgba(0,0,0,0.4),0 0 0 1px rgba(99,102,241,0.08)' : '0 2px 8px rgba(99,102,241,0.07),0 0 0 1px rgba(99,102,241,0.05)';
                const sfCol = dm ? '#e2e8f0' : '#1e1b4b';
                const sfSub = isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af';
                const sfSecLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: sfSub, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'block', marginBottom: 6, marginTop: 10 };
                const sfItem = (onClick: () => void, key: string, avatar: React.ReactNode, name: string, sub?: string) => (
                    <div key={key} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', background: sfCard, borderRadius: 12, boxShadow: sfShadow, marginBottom: 6 }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')} onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                        {avatar}
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, color: sfCol, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                            {sub && <div style={{ fontSize: 11, color: sfSub }}>{sub}</div>}
                        </div>
                    </div>
                );
                const doFwd = (sendFn: (ft: string, fp?: string, fn?: string, fs?: number, fa?: any[]) => void) => {
                    const msg = forwardingMessage;
                    const sn = msg.sender_name || users.find((u: any) => u.id === msg.sender_id)?.username || (lang === 'en' ? 'Unknown' : 'Неизвестно');
                    const fp2 = `↪️ ${lang === 'en' ? 'Forwarded from' : 'Переслано от'} ${sn}\n`;
                    const ft2 = msg.message_text ? fp2 + msg.message_text : fp2 + (msg.filename ? `📎 ${msg.filename}` : '');
                    const fa2 = (() => { try { const r = msg.files; return r ? (typeof r === 'string' ? JSON.parse(r) : r) : null; } catch { return null; } })();
                    sendFn(ft2, msg.file_path, msg.filename, msg.file_size, fa2?.length ? fa2 : undefined);
                    setForwardingMessage(null);
                };
                return (
                <div className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 4000, background: isOled ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.5)', backdropFilter: isOled ? 'blur(8px)' : 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => setForwardingMessage(null)}>
                    <div className="modal-enter" style={{ background: sfBg, borderRadius: 20, width: 360, maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 60px rgba(124,58,237,0.25), 0 30px 80px rgba(0,0,0,0.9)' : dm ? '0 0 50px rgba(99,102,241,0.22), 0 24px 70px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.14), 0 20px 60px rgba(0,0,0,0.15)' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ padding: '16px 18px 14px', background: sfCard, boxShadow: `0 1px 0 ${isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <span style={{ fontWeight: 700, fontSize: 15, color: sfCol }}>{t('Forward to...')}</span>
                                <button onClick={() => setForwardingMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sfSub, display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                            <div style={{ background: isOled ? '#0a0a14' : dm ? '#1e1e38' : '#f5f3ff', borderRadius: 10, padding: '8px 12px', borderLeft: `3px solid ${isOled ? '#7c3aed' : '#6366f1'}` }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: isOled ? '#a78bfa' : '#6366f1', marginBottom: 2 }}>{forwardingMessage.sender_name || usersById.get(forwardingMessage.sender_id)?.username || (lang === 'en' ? 'Unknown' : 'Неизвестно')}</div>
                                <div style={{ fontSize: 12, color: sfSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{forwardingMessage.message_text || (forwardingMessage.filename ? `📎 ${forwardingMessage.filename}` : `📎 ${lang === 'en' ? 'attachment' : 'вложение'}`)}</div>
                            </div>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 14px' }}>
                            <span style={sfSecLabel}>Избранное</span>
                            {sfItem(() => doFwd((ft, fp, fn, fs, fa) => { if (fa) wsService.sendMessage(currentUserId, ft, undefined, undefined, undefined, undefined, undefined, undefined, fa); else wsService.sendMessage(currentUserId, ft, fp, fn, fs); }), 'fav', <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#f59e0b,#f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>, lang === 'en' ? 'Favorites' : 'Избранное')}
                            {groups.filter(g => !g.is_channel || g.my_role === 'admin' || g.creator_id === currentUserId).length > 0 && <span style={sfSecLabel}>Группы</span>}
                            {groups.filter(g => !g.is_channel || g.my_role === 'admin' || g.creator_id === currentUserId).map(g => sfItem(() => doFwd((ft, fp, fn, fs, fa) => { if (fa) wsService.sendGroupMessage(g.id, ft, undefined, undefined, undefined, undefined, undefined, undefined, fa); else wsService.sendGroupMessage(g.id, ft, fp, fn, fs); }), `fg-${g.id}`, <div style={{ width: 38, height: 38, borderRadius: 10, background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700 }}>{g.avatar ? <img src={config.fileUrl(g.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : g.name[0]?.toUpperCase()}</div>, g.name, g.is_channel ? '📢 Канал' : '👥 Группа'))}
                            {users.filter(u => !(u as any).is_deleted && u.username !== 'Удалённый пользователь').length > 0 && <span style={sfSecLabel}>Люди</span>}
                            {users.filter(u => !(u as any).is_deleted && u.username !== 'Удалённый пользователь').map(u => sfItem(() => doFwd((ft, fp, fn, fs, fa) => { if (fa) wsService.sendMessage(u.id, ft, undefined, undefined, undefined, undefined, undefined, undefined, fa); else wsService.sendMessage(u.id, ft, fp, fn, fs); }), `fu-${u.id}`, <div style={{ width: 38, height: 38, borderRadius: 10, background: (u as any).avatar_color || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700 }}>{u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}</div>, u.username, u.tag ? `@${u.tag}` : undefined))}
                        </div>
                    </div>
                </div>
                );
            })()}

            {/* Chat context menu (right-click on sidebar item) */}
            {pinMenu && (
                <div className="floating-enter" style={{ position: 'fixed', top: Math.min(pinMenu.y, window.innerHeight - 260), left: Math.min(pinMenu.x, window.innerWidth - 210), zIndex: 9999, background: isOled ? '#080810' : dm ? C.bg3 : 'white', borderRadius: 12, padding: 4, boxShadow: isOled ? '0 0 30px rgba(124,58,237,0.3), 0 16px 40px rgba(0,0,0,0.95)' : dm ? '0 0 24px rgba(99,102,241,0.2), 0 12px 36px rgba(0,0,0,0.5)' : '0 0 20px rgba(99,102,241,0.1), 0 8px 28px rgba(0,0,0,0.14)', minWidth: 192, maxHeight: '80vh', overflowY: 'auto' }}
                    onClick={e => e.stopPropagation()}>
                    {(() => {
                        const btnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#e0e0e0' : '#1e1b4b', fontSize: 13, borderRadius: 8, textAlign: 'left' as const };
                        const key = pinMenu.key;
                        const isMuted = mutedChats.has(key);
                        if (addToFolderKey === key) {
                            return (
                                <>
                                    <button onClick={() => setAddToFolderKey(null)} style={{ ...btnStyle, color: '#6366f1' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg> {t('Back')}</button>
                                    {folders.length === 0 && <div style={{ padding: '6px 14px', fontSize: 12, color: dm ? '#7070a0' : '#aaa' }}>{t('No folders')}</div>}
                                    {folders.map(f => (
                                        <button key={f.id} onClick={() => addChatToFolder(f.id, key)} style={{ ...btnStyle }}>
                                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: f.color, display: 'inline-block', flexShrink: 0 }} />
                                            {f.name}
                                        </button>
                                    ))}
                                </>
                            );
                        }
                        const isPrivate = key.startsWith('private-');
                        const privateUserId = isPrivate ? parseInt(key.split('-')[1]) : null;
                        const isBlocked = privateUserId !== null && blockedUserIds.has(privateUserId);
                        return (
                            <>
                                <button onClick={() => togglePin(key)} style={btnStyle}><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg> {pinnedChats.has(key) ? t('Unpin') : t('Pin')}</button>
                                {key !== `private-${currentUserId}` && <button onClick={() => toggleMute(key)} style={btnStyle}>{isMuted ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> {lang === 'en' ? 'Unmute' : 'Включить уведомления'}</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg> {lang === 'en' ? 'Mute' : 'Выключить уведомления'}</>}</button>}
                                {key !== `private-${currentUserId}` && <button onClick={() => { toggleArchive(key); }} style={btnStyle}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> {archivedChats.has(key) ? (lang === 'en' ? 'Unarchive' : 'Разархивировать') : (lang === 'en' ? 'Archive' : 'Архивировать')}</button>}
                                {key !== `private-${currentUserId}` && <button onClick={() => { setAddToFolderKey(key); }} style={btnStyle}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> {lang === 'en' ? 'Add to folder' : 'Добавить в папку'}</button>}
                                <div style={{ height: 1, background: dm ? C.bg6 : '#f0f0f0', margin: '4px 0' }} />
                                {isPrivate && privateUserId !== null && privateUserId !== currentUserId && (
                                    <button
                                        onClick={() => isBlocked ? handleUnblockUser(privateUserId) : handleBlockUser(privateUserId)}
                                        style={{ ...btnStyle, color: isBlocked ? '#22c55e' : '#f97316' }}
                                    >
                                        {isBlocked
                                            ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg> {lang === 'en' ? 'Unblock user' : 'Разблокировать'}</>
                                            : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> {lang === 'en' ? 'Block user' : 'Заблокировать'}</>}
                                    </button>
                                )}
                                {key !== `private-${currentUserId}` && (
                                    <button onClick={() => handleDeleteChat(key)} style={{ ...btnStyle, color: '#ef4444' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> {lang === 'en' ? 'Delete chat' : 'Удалить чат'}</button>
                                )}
                            </>
                        );
                    })()}
                </div>
            )}
            {pinMenu && <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => { setPinMenu(null); setAddToFolderKey(null); }} />}

            {/* Folder context menu */}
            {folderCtxMenu && (
                <div className="floating-enter" style={{ position: 'fixed', top: folderCtxMenu.y, left: folderCtxMenu.x, zIndex: 9999, background: isOled ? '#080810' : dm ? C.bg3 : 'white', borderRadius: 12, padding: 4, boxShadow: isOled ? '0 0 30px rgba(124,58,237,0.3), 0 16px 40px rgba(0,0,0,0.95)' : dm ? '0 0 24px rgba(99,102,241,0.2), 0 12px 36px rgba(0,0,0,0.5)' : '0 0 20px rgba(99,102,241,0.1), 0 8px 28px rgba(0,0,0,0.14)', minWidth: 180 }}
                    onClick={e => e.stopPropagation()}>
                    {(() => {
                        const btnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#e0e0e0' : '#1e1b4b', fontSize: 13, borderRadius: 8, textAlign: 'left' as const };
                        const ctxFolder = folders.find(f => f.id === folderCtxMenu.folderId);
                        const ctxUnread = ctxFolder ? (folderUnreadMap[ctxFolder.id] || 0) : 0;
                        return (
                            <>
                                {ctxUnread > 0 && ctxFolder && (
                                    <button onClick={() => {
                                        setUnreadCounts(prev => {
                                            const next = { ...prev };
                                            ctxFolder.chats.forEach(c => { delete next[`${c.chat_type}-${c.chat_id}`]; });
                                            return next;
                                        });
                                        ctxFolder.chats.forEach(c => {
                                            if (c.chat_type === 'private') wsService.markRead(c.chat_id);
                                            else wsService.send({ type: 'group_mark_read', group_id: c.chat_id });
                                        });
                                        setFolderCtxMenu(null);
                                    }} style={btnStyle}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M20 6L9 17l-5-5"/></svg>
                                        {lang === 'en' ? 'Mark all as read' : 'Пометить всё как прочитанное'}
                                    </button>
                                )}
                                <button onClick={() => { setShowFolderManager(true); setFolderCtxMenu(null); }} style={btnStyle}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> {t('Settings')}</button>
                                <button onClick={async () => {
                                    try { await api.deleteFolder(token, folderCtxMenu.folderId); } catch {}
                                    const res = await api.getFolders(token);
                                    if (res.folders) setFolders(res.folders);
                                    if (activeFolder === folderCtxMenu.folderId) setActiveFolder(null);
                                    setFolderCtxMenu(null);
                                }} style={{ ...btnStyle, color: '#ef4444' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> {lang === 'en' ? 'Delete folder' : 'Удалить папку'}</button>
                            </>
                        );
                    })()}
                </div>
            )}
            {folderCtxMenu && <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setFolderCtxMenu(null)} />}

            {/* All chats context menu */}
            {allChatsCtxMenu && (() => {
                const totalUnread = Object.values(unreadCounts).reduce((s, n) => s + n, 0);
                const btnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#e0e0e0' : '#1e1b4b', fontSize: 13, borderRadius: 8, textAlign: 'left' as const };
                return (
                    <>
                        <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setAllChatsCtxMenu(null)} />
                        <div className="floating-enter" style={{ position: 'fixed', top: allChatsCtxMenu.y, left: allChatsCtxMenu.x, zIndex: 9999, background: isOled ? '#080810' : dm ? C.bg3 : 'white', borderRadius: 12, padding: 4, boxShadow: isOled ? '0 0 30px rgba(124,58,237,0.3), 0 16px 40px rgba(0,0,0,0.95)' : dm ? '0 0 24px rgba(99,102,241,0.2), 0 12px 36px rgba(0,0,0,0.5)' : '0 0 20px rgba(99,102,241,0.1), 0 8px 28px rgba(0,0,0,0.14)', minWidth: 210 }}
                            onClick={e => e.stopPropagation()}>
                            {totalUnread > 0 && (
                                <button onClick={() => {
                                    setUnreadCounts({});
                                    users.forEach(u => wsService.markRead(u.id));
                                    groups.forEach(g => wsService.send({ type: 'group_mark_read', group_id: g.id }));
                                    setAllChatsCtxMenu(null);
                                }} style={btnStyle}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M20 6L9 17l-5-5"/></svg>
                                    {lang === 'en' ? 'Mark all as read' : 'Пометить всё как прочитанное'}
                                </button>
                            )}
                            <button onClick={() => { setShowFolderManager(true); setAllChatsCtxMenu(null); }} style={btnStyle}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                                {lang === 'en' ? 'Manage folders' : 'Управление папками'}
                            </button>
                        </div>
                    </>
                );
            })()}

            {/* In-app toast notifications */}
            {toasts.length > 0 && (
                <div style={{ position: 'fixed', ...(isMobile ? { top: 0, left: 0, right: 0, padding: '8px 10px 0', paddingTop: 'max(8px, env(safe-area-inset-top, 8px))' } : { bottom: 24, right: 24 }), zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 10, width: isMobile ? undefined : 320 }}>
                    {toasts.map(toast => {
                        const tSwipeX = isMobile ? 0 : (toastSwipeOffsets[toast.id] || 0);
                        const tSwipeY = isMobile ? (toastSwipeOffsets[toast.id] || 0) : 0;
                        const tSwiping = !!toastSwipeOffsets[toast.id];
                        const tOpacity = tSwiping ? Math.max(0.1, 1 - Math.abs(tSwipeX || tSwipeY) / 120) : 1;
                        // Always use live user data so avatar updates are reflected immediately
                        const liveToastUser = toast.senderId ? usersRef.current.find((u: User) => u.id === toast.senderId) : null;
                        const liveAvatarSrc = liveToastUser?.avatar ?? toast.avatarSrc;
                        const liveAvatarColor = liveToastUser?.avatar_color ?? toast.avatarColor;
                        const liveAvatarLetter = liveToastUser ? (liveToastUser.username[0]?.toUpperCase() ?? toast.avatarLetter) : toast.avatarLetter;
                        const openChat = () => {
                            if (toast.chatType === 'private') { const user = usersRef.current.find(u => u.id === toast.chatId); if (user) selectPrivateChat(user); }
                            else { const group = groupsRef.current.find(g => g.id === toast.chatId); if (group) selectGroupChat(group); }
                            dismissToast(toast.id);
                        };
                        return (
                        <div
                            key={toast.id}
                            className={toast.exiting ? (isMobile ? 'toast-mobile-exit' : 'toast-exit') : (isMobile ? 'toast-mobile-enter' : 'toast-enter')}
                            onTouchStart={e => handleToastTouchStart(e, toast.id)}
                            onTouchMove={e => handleToastTouchMove(e, toast.id)}
                            onTouchEnd={() => handleToastTouchEnd(toast.id)}
                            style={{
                                background: isOled ? 'rgba(10,8,20,0.96)' : (dm ? 'rgba(26,24,48,0.97)' : 'rgba(255,255,255,0.97)'),
                                borderRadius: isMobile ? 18 : 16,
                                boxShadow: isOled
                                    ? '0 12px 40px rgba(0,0,0,0.9), 0 0 0 1px rgba(167,139,250,0.18)'
                                    : dm
                                        ? '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.2)'
                                        : '0 8px 32px rgba(99,102,241,0.18), 0 0 0 1px rgba(99,102,241,0.1)',
                                backdropFilter: 'blur(20px)',
                                overflow: 'hidden',
                                transform: (tSwipeX !== 0 || tSwipeY !== 0) ? `translate(${tSwipeX}px, ${tSwipeY}px)` : undefined,
                                opacity: tOpacity,
                                transition: tSwiping ? 'opacity 0.05s' : 'transform 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.25s',
                            }}
                        >
                            {isMobile ? (
                                // ── Mobile compact toast ──────────────────────────────
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer' }} onClick={openChat}>
                                        <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: liveAvatarSrc ? 'transparent' : liveAvatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', fontSize: 16, color: 'white', fontWeight: 700, boxShadow: `0 2px 8px ${liveAvatarColor}66` }}>
                                            {liveAvatarSrc ? <img src={config.fileUrl(liveAvatarSrc) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : liveAvatarLetter}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 700, fontSize: 14, color: dm ? '#e2e8f0' : '#1e1b4b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{toast.title}</div>
                                            <div style={{ fontSize: 13, color: dm ? '#9090b8' : '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1, lineHeight: 1.3 }}>{toast.body}</div>
                                        </div>
                                        <button onClick={e => { e.stopPropagation(); dismissToast(toast.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#b0b0c8', padding: '4px', flexShrink: 0, display: 'flex', alignItems: 'center', borderRadius: '50%', marginLeft: 2 }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                        </button>
                                    </div>
                                    {/* Mobile quick-reply row */}
                                    <div style={{ display: 'flex', gap: 6, padding: '0 10px 10px' }} onClick={e => e.stopPropagation()}>
                                        <input
                                            type="text"
                                            placeholder={lang === 'en' ? 'Reply...' : 'Ответить...'}
                                            value={toastReplies[toast.id] || ''}
                                            onChange={e => setToastReplies(prev => ({ ...prev, [toast.id]: e.target.value }))}
                                            onKeyDown={e => { if (e.key === 'Enter') replyFromToast(toast, toastReplies[toast.id] || ''); }}
                                            style={{ flex: 1, padding: '8px 12px', borderRadius: 22, border: 'none', backgroundColor: dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)', color: dm ? '#e2e8f0' : '#1e1b4b', fontSize: 13, outline: 'none' }}
                                        />
                                        <button onClick={() => replyFromToast(toast, toastReplies[toast.id] || '')}
                                            style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', backgroundColor: '#6366f1', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                                        </button>
                                    </div>
                                    {/* Swipe hint pill */}
                                    <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 8 }}>
                                        <div style={{ width: 36, height: 3, borderRadius: 2, background: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
                                    </div>
                                    <div style={{ height: 2, backgroundColor: 'transparent' }}>
                                        <div style={{ height: '100%', borderRadius: '0 0 18px 18px', backgroundColor: '#6366f1', animation: 'toastProgress 5s linear forwards' }} />
                                    </div>
                                </>
                            ) : (
                                // ── Desktop toast (unchanged) ─────────────────────────
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 8px', cursor: 'pointer' }} onClick={openChat}>
                                        <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: liveAvatarSrc ? (dm ? C.bg2 : 'white') : liveAvatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', fontSize: 15, color: 'white', fontWeight: 700 }}>
                                            {liveAvatarSrc ? <img src={config.fileUrl(liveAvatarSrc) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : liveAvatarLetter}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 700, fontSize: 13, color: dm ? '#e2e8f0' : '#1e1b4b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.title}</div>
                                            <div style={{ fontSize: 12, color: dm ? '#7878aa' : '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{toast.body}</div>
                                        </div>
                                        <button onClick={e => { e.stopPropagation(); dismissToast(toast.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', padding: '0 2px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                        </button>
                                    </div>
                                    <div style={{ padding: '0 12px 8px', display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                                        <input type="text" placeholder={lang === 'en' ? 'Reply...' : 'Ответить...'} value={toastReplies[toast.id] || ''} onChange={e => setToastReplies(prev => ({ ...prev, [toast.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') replyFromToast(toast, toastReplies[toast.id] || ''); }} style={{ flex: 1, padding: '7px 11px', borderRadius: 10, border: `1.5px solid ${dm ? C.bdr3 : '#ede9fe'}`, backgroundColor: dm ? '#14142a' : '#f5f3ff', color: dm ? '#e2e8f0' : '#1e1b4b', fontSize: 13, outline: 'none' }} />
                                        <button onClick={() => replyFromToast(toast, toastReplies[toast.id] || '')} style={{ padding: '7px 13px', borderRadius: 10, border: 'none', backgroundColor: '#6366f1', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                                        </button>
                                    </div>
                                    <div style={{ padding: '0 12px 10px' }} onClick={e => e.stopPropagation()}>
                                        <button onClick={() => { const key = toast.chatType === 'private' ? `private-${toast.chatId}` : `group-${toast.chatId}`; setUnreadCounts(prev => { const next = { ...prev }; delete next[key]; return next; }); if (toast.chatType === 'private' && toast.senderId) wsService.markRead(toast.senderId); dismissToast(toast.id); }} style={{ width: '100%', padding: '6px 0', borderRadius: 10, border: `1px solid ${dm ? C.bdr3 : '#ede9fe'}`, backgroundColor: 'transparent', color: dm ? '#7878aa' : '#6b7280', fontSize: 12, cursor: 'pointer' }}>
                                            ✓ {lang === 'en' ? 'Mark as read' : 'Пометить как прочитанное'}
                                        </button>
                                    </div>
                                    <div style={{ height: 2, backgroundColor: dm ? C.bdr1 : '#ede9fe' }}>
                                        <div style={{ height: '100%', backgroundColor: '#6366f1', animation: 'toastProgress 5s linear forwards' }} />
                                    </div>
                                </>
                            )}
                        </div>
                    );
                    })}
                </div>
            )}

            {/* Floating video player */}
            {nowPlayingVideo && (
                <div
                    className="floating-enter"
                    style={{ position: 'fixed', left: videoPos.x, top: videoPos.y, zIndex: 99000, borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.5)', border: `2px solid ${dm ? C.bdr2 : '#ede9fe'}`, background: '#000', userSelect: 'none', cursor: 'grab' }}
                    onMouseDown={e => {
                        videoDragRef.current = { startX: e.clientX, startY: e.clientY, origX: videoPos.x, origY: videoPos.y };
                        const onMove = (ev: MouseEvent) => {
                            if (!videoDragRef.current) return;
                            setVideoPos({ x: videoDragRef.current.origX + ev.clientX - videoDragRef.current.startX, y: videoDragRef.current.origY + ev.clientY - videoDragRef.current.startY });
                        };
                        const onUp = () => { videoDragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                    }}
                >
                    <video
                        ref={floatingVideoRef}
                        src={nowPlayingVideo.src}
                        controls
                        style={{ display: 'block', width: 320, maxHeight: 240, background: '#000' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: dm ? C.bg1 : '#f8f7ff' }}>
                        <span style={{ fontSize: 11, color: dm ? '#9090b0' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{nowPlayingVideo.filename}</span>
                        <button onClick={() => { setNowPlayingVideo(null); if (floatingVideoRef.current) floatingVideoRef.current.pause(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#9999bb' : '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                </div>
            )}

            {/* ─── Playlist share: chat picker ─── */}
            {playlistToShare && (() => {
                const q = playlistShareSearch.toLowerCase();
                const filteredUsers = users.filter(u => u.username.toLowerCase().includes(q) || u.tag?.toLowerCase().includes(q));
                const filteredGroups = groups.filter(g => g.name.toLowerCase().includes(q));
                const sendPlaylistMsg = (chatType: 'private' | 'group', chatId: number) => {
                    const msgData: PlaylistShareData = {
                        id: playlistToShare.id,
                        name: playlistToShare.name,
                        cover: playlistToShare.cover,
                        tracks: playlistToShare.tracks.map(t => ({ title: t.title, artist: t.artist, duration: t.duration, file_path: t.file_path, cover_path: t.cover_path })),
                        total: playlistToShare.tracks.length,
                    };
                    const msgText = PLAYLIST_MSG_PREFIX + JSON.stringify(msgData);
                    if (chatType === 'private') wsService.sendMessage(chatId, msgText);
                    else wsService.sendGroupMessage(chatId, msgText);
                    setPlaylistToShare(null);
                };
                return (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 5500, background: isOled ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPlaylistToShare(null)}>
                        {(() => {
                        const mBg = isOled ? '#000000' : dm ? '#0d0d1a' : '#f7f6ff';
                        const cBg = isOled ? '#050508' : dm ? '#13131f' : 'white';
                        const cShadow = isOled ? '0 2px 16px rgba(0,0,0,0.9),0 0 0 1px rgba(167,139,250,0.07)' : dm ? '0 2px 12px rgba(0,0,0,0.4),0 0 0 1px rgba(99,102,241,0.08)' : '0 2px 8px rgba(99,102,241,0.07),0 0 0 1px rgba(99,102,241,0.05)';
                        const col = dm ? '#e2e8f0' : '#1e1b4b';
                        const sub = isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af';
                        const secLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.8px', margin: '8px 4px 6px', display: 'block' };
                        return (
                        <div style={{ background: mBg, borderRadius: 20, width: 380, maxHeight: '75vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 60px rgba(124,58,237,0.25), 0 30px 80px rgba(0,0,0,0.9)' : dm ? '0 0 50px rgba(99,102,241,0.22), 0 24px 70px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.14), 0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
                            <div style={{ padding: '16px 18px 12px', background: isOled ? '#050508' : dm ? '#13131f' : 'white', boxShadow: `0 1px 0 ${isOled ? 'rgba(167,139,250,0.08)' : dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 15, color: col }}>Поделиться плейлистом</div>
                                        <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>«{playlistToShare.name}»</div>
                                    </div>
                                    <button onClick={() => setPlaylistToShare(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sub, display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                </div>
                                <input autoFocus value={playlistShareSearch} onChange={e => setPlaylistShareSearch(e.target.value)} placeholder="🔍 Поиск чата..." style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: 'none', background: isOled ? '#0a0a14' : dm ? '#1e1e38' : '#f5f3ff', color: col, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const }} />
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                                {filteredUsers.length > 0 && <span style={secLabel}>Люди</span>}
                                {filteredUsers.map(u => (
                                    <div key={u.id} onClick={() => sendPlaylistMsg('private', u.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', background: cBg, borderRadius: 12, boxShadow: cShadow, marginBottom: 6 }}
                                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')} onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                                        <div style={{ width: 38, height: 38, borderRadius: 10, background: u.avatar_color || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0, overflow: 'hidden' }}>
                                            {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 14, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                            {u.tag && <div style={{ fontSize: 11, color: sub }}>@{u.tag}</div>}
                                        </div>
                                    </div>
                                ))}
                                {filteredGroups.length > 0 && <span style={{ ...secLabel, marginTop: filteredUsers.length > 0 ? 12 : 8 }}>Группы и каналы</span>}
                                {filteredGroups.map(g => (
                                    <div key={g.id} onClick={() => sendPlaylistMsg('group', g.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', background: cBg, borderRadius: 12, boxShadow: cShadow, marginBottom: 6 }}
                                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')} onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                                        <div style={{ width: 38, height: 38, borderRadius: 10, background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0, overflow: 'hidden' }}>
                                            {g.avatar ? <img src={config.fileUrl(g.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : g.name[0]?.toUpperCase()}
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 14, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                                            <div style={{ fontSize: 11, color: sub }}>{g.is_channel ? '📢 Канал' : '👥 Группа'}</div>
                                        </div>
                                    </div>
                                ))}
                                {filteredUsers.length === 0 && filteredGroups.length === 0 && (
                                    <div style={{ textAlign: 'center', color: sub, padding: '32px 0', fontSize: 14 }}>Ничего не найдено</div>
                                )}
                            </div>
                        </div>
                        );
                    })()}
                    </div>
                );
            })()}

            {/* ─── Playlist preview modal (recipient view) ─── */}
            {playlistPreview && (() => {
                const coverSrc = playlistPreview.cover ? (config.fileUrl(playlistPreview.cover) ?? playlistPreview.cover) : null;
                const fmt = (s?: number) => s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';
                const savePlaylist = async () => {
                    setPlaylistSaving(true);
                    try {
                        const newPl = await api.createPlaylist(token, playlistPreview.name);
                        if (newPl.id) {
                            // Set cover if exists
                            if (playlistPreview.cover) {
                                await api.setPlaylistCoverPath(token, newPl.id, playlistPreview.cover);
                            }
                            for (const t of playlistPreview.tracks) {
                                if (!t.file_path) continue;
                                await api.addTrack(token, { playlist_id: newPl.id, title: t.title, artist: t.artist, file_path: t.file_path, cover_path: t.cover_path, duration: t.duration });
                            }
                        }
                        setPlaylistPreview(null);
                    } finally { setPlaylistSaving(false); }
                };
                const accentC = isOled ? '#a78bfa' : '#6366f1';
                return (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 5500, background: isOled ? 'rgba(0,0,0,0.9)' : 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPlaylistPreview(null)}>
                        <div style={{ background: isOled ? '#000' : dm ? '#0f0f1a' : '#fff', borderRadius: 24, width: 420, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 32px 100px rgba(0,0,0,0.95), 0 0 0 1px rgba(167,139,250,0.14)' : '0 32px 100px rgba(0,0,0,0.3)', border: isOled ? '1px solid rgba(167,139,250,0.15)' : dm ? '1px solid rgba(99,102,241,0.2)' : '1px solid #ede9fe' }} onClick={e => e.stopPropagation()}>
                            {/* Cover header */}
                            <div style={{ position: 'relative', height: 180, background: coverSrc ? `url(${coverSrc}) center/cover` : `linear-gradient(135deg, ${accentC}, ${isOled ? '#5b21b6' : '#8b5cf6'})`, display: 'flex', alignItems: 'flex-end', padding: '0 20px 16px', flexShrink: 0 }}>
                                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
                                <div style={{ position: 'relative', zIndex: 1 }}>
                                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Плейлист</div>
                                    <div style={{ fontSize: 22, fontWeight: 800, color: 'white' }}>{playlistPreview.name}</div>
                                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 3 }}>{playlistPreview.total} {playlistPreview.total === 1 ? 'трек' : playlistPreview.total < 5 ? 'трека' : 'треков'}</div>
                                </div>
                                <button onClick={() => setPlaylistPreview(null)} style={{ position: 'absolute', top: 14, right: 14, zIndex: 2, background: 'rgba(0,0,0,0.4)', border: 'none', color: 'white', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                            {/* Track list */}
                            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', minHeight: 0 }}>
                                {playlistPreview.tracks.map((t, i) => {
                                    const tCover = t.cover_path ? (config.fileUrl(t.cover_path) ?? t.cover_path) : null;
                                    return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                                        {tCover
                                            ? <img src={tCover} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                                            : <span style={{ fontSize: 12, color: isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af', minWidth: 32, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                                            {t.artist && <div style={{ fontSize: 11, color: isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af' }}>{t.artist}</div>}
                                        </div>
                                        {t.duration && <span style={{ fontSize: 11, color: isOled ? '#7c6aaa' : dm ? '#5a5a8a' : '#9ca3af', flexShrink: 0 }}>{fmt(t.duration)}</span>}
                                    </div>
                                    );
                                })}
                            </div>
                            {/* Save button */}
                            <div style={{ padding: '14px 20px', borderTop: `1px solid ${isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.15)' : '#ede9fe'}`, flexShrink: 0 }}>
                                <button onClick={savePlaylist} disabled={playlistSaving} style={{ width: '100%', padding: '12px 0', background: `linear-gradient(135deg, ${accentC}, ${isOled ? '#7c3aed' : '#8b5cf6'})`, border: 'none', color: 'white', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 700, boxShadow: `0 4px 20px ${isOled ? 'rgba(139,92,246,0.4)' : 'rgba(99,102,241,0.35)'}` }}>
                                    {playlistSaving ? '...' : '💾 Сохранить плейлист'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Media Player — always mounted so audio keeps playing */}
            <MediaPlayer
                token={token}
                dm={dm}
                isOled={isOled}
                isMobile={isMobile}
                visible={showMediaPlayer}
                onClose={() => setShowMediaPlayer(false)}
                onNowPlaying={() => {}}
                onStateChange={handleMediaStateChange}
                onPlayStart={stopGlobalOnly}
                onSharePlaylist={pl => { setPlaylistToShare(pl); setShowMediaPlayer(false); setPlaylistShareSearch(''); }}
            />

            {/* Call overlay */}
            {callInfo.state !== 'idle' && (
                <CallOverlay
                    callInfo={callInfo}
                    onAccept={acceptCall}
                    onReject={rejectCall}
                    onEnd={endCall}
                    onToggleMute={callToggleMute}
                    onToggleCamera={callToggleCamera}
                    dm={dm}
                    isOled={isOled}
                    peerAvatar={callInfo.peerId ? (config.fileUrl(usersById.get(callInfo.peerId)?.avatar ?? null) ?? null) : null}
                    peerAvatarColor={callInfo.peerId ? (usersById.get(callInfo.peerId)?.avatar_color || 'linear-gradient(135deg,#6366f1,#8b5cf6)') : undefined}
                />
            )}
        </div>
    );
};

const styles: { [key: string]: React.CSSProperties } = {
    container: { display: 'flex', height: '100svh', backgroundColor: '#eef0f5' },
    sidebar: { width: 340, backgroundColor: '#f7f8fc', boxShadow: '2px 0 16px rgba(99,102,241,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 1 },
    sidebarScroll: { flex: 1, overflowY: 'auto' as const, backgroundColor: '#f7f8fc' },
    sidebarHeader: { padding: '16px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', color: 'white', display: 'flex', alignItems: 'center', gap: 8 },
    newChatBtn: { padding: '6px 10px', backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 10, cursor: 'pointer', fontSize: 14, backdropFilter: 'blur(4px)' },
    createGroupBtn: { padding: '6px 10px', backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 10, cursor: 'pointer', fontSize: 12, backdropFilter: 'blur(4px)' },
    profileCard: { padding: '0 16px', height: 60, borderTop: '1px solid #e4e5ef', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#f0f1f8', flexShrink: 0, boxSizing: 'border-box' as const },
    profileAvatar: { width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', overflow: 'hidden', boxShadow: '0 2px 8px rgba(99,102,241,0.3)' },
    profileInfo: { flex: 1, minWidth: 0 },
    profileName: { fontSize: 13, fontWeight: 600, color: '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    profileStatus: { fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 },
    settingsBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', padding: '6px', borderRadius: 10, color: '#9ca3af', flexShrink: 0 },
    sectionTitle: { padding: '14px 20px 6px', fontSize: 10, fontWeight: 700 as const, color: '#a5b4fc', textTransform: 'uppercase' as const, letterSpacing: 1.5 },
    chatItem: { display: 'flex', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', gap: 10, transition: 'background 0.15s', borderRadius: 12, margin: '1px 8px' },
    activeChatItem: { background: 'linear-gradient(90deg, rgba(99,102,241,0.22) 0%, rgba(139,92,246,0.10) 55%, transparent 100%)', boxShadow: 'inset 3px 0 0 #6366f1, 0 1px 10px rgba(99,102,241,0.18)' },
    avatar: { width: 40, height: 40, borderRadius: '50%', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 'bold' as const, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' },
    chatName: { fontSize: 14, fontWeight: 600 as const, color: '#1e1b4b', textAlign: 'left' as const },
    chatSub: { fontSize: 11, color: '#9ca3af', marginTop: 2, textAlign: 'left' as const },
    chatArea: { flex: 1, display: 'flex', flexDirection: 'column' as const, backgroundColor: '#f2f4f8', minWidth: 0 },
    chatHeader: { padding: '0 20px', borderBottom: '1px solid #e8e8ef', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f7f8fc', height: 68, minHeight: 68, maxHeight: 68, flexShrink: 0, boxSizing: 'border-box' as const },
    typing: { fontSize: 12, color: '#a5b4fc', fontStyle: 'italic' },
    iconBtn: { background: 'none', border: '1px solid #ede9fe', fontSize: 18, cursor: 'pointer', padding: '6px 10px', borderRadius: 10, color: '#6366f1', transition: 'all 0.15s' },
    messagesArea: { flex: 1, overflowY: 'auto' as const, paddingTop: 20, paddingBottom: 20, paddingLeft: 24, paddingRight: 24, backgroundColor: '#f2f4f8' },
    senderName: { fontSize: 11, fontWeight: 700 as const, color: '#6366f1', marginBottom: 4 },
    replyBlock: { backgroundColor: 'rgba(99,102,241,0.08)', borderLeft: '3px solid #6366f1', borderRadius: 8, padding: '5px 10px', marginBottom: 6, fontSize: 12 },
    replyBlockOwn: { borderLeftColor: 'rgba(255,255,255,0.6)', backgroundColor: 'rgba(255,255,255,0.15)' },
    replyAuthor: { fontSize: 11, color: '#a5b4fc', marginBottom: 2, fontWeight: 600 as const },
    replyText: { color: '#c4b5fd', fontStyle: 'italic' },
    timestamp: { fontSize: 10, marginTop: 5, opacity: 0.55 },
    replyBar: { padding: '10px 16px', background: 'linear-gradient(90deg, #ede9fe, #f5f3ff)', borderTop: '1px solid #ede9fe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    replyClose: { background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: '#a5b4fc', padding: '0 4px' },
    inputArea: { padding: '10px 16px', minHeight: 60, borderTop: '1px solid #e8e8ef', display: 'flex', gap: 8, alignItems: 'center', backgroundColor: '#f7f8fc', flexShrink: 0, boxSizing: 'border-box' as const },
    input: { flex: 1, padding: '10px 16px', fontSize: 14, border: '1.5px solid #dddde8', borderRadius: 16, outline: 'none', backgroundColor: '#eef0f8', transition: 'border-color 0.2s', resize: 'none' as const, lineHeight: '1.5', maxHeight: 150, overflowY: 'auto' as const, fontFamily: 'inherit' },
    fileBtn: { padding: '10px 13px', backgroundColor: '#eef0f8', border: '1.5px solid #dddde8', borderRadius: 12, cursor: 'pointer', fontSize: 16, color: '#6366f1', transition: 'all 0.15s' },
    sendBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none', borderRadius: 24, cursor: 'pointer', fontSize: 14, fontWeight: 600 as const, boxShadow: '0 2px 10px rgba(99,102,241,0.35)', transition: 'all 0.15s' },
    noChat: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', color: '#c4b5fd', fontSize: 16, gap: 12 },
    menu: { backgroundColor: 'white', borderRadius: 14, boxShadow: '0 0 20px rgba(99,102,241,0.1), 0 8px 28px rgba(0,0,0,0.14)', padding: '6px 0', minWidth: 170 },
    menuItem: { display: 'block', width: '100%', padding: '10px 18px', textAlign: 'left' as const, border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 },
    findOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,10,40,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 },
    findModal: { borderRadius: 20, padding: 28, width: 340, border: '1px solid rgba(99,102,241,0.25)' },
    findInput: { width: '100%', padding: '11px 16px', fontSize: 14, borderRadius: 12, outline: 'none', boxSizing: 'border-box' as const },
    findBtn: { flex: 1, padding: '11px 0', background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 as const },
    findCancelBtn: { flex: 1, padding: '11px 0', borderRadius: 12, cursor: 'pointer', fontSize: 14 },
};

// ─── FullReactionPicker ───────────────────────────────────────────────────────
const FullReactionPicker: React.FC<{
    dm: boolean;
    onSelect: (emoji: string) => void;
    onClose: () => void;
}> = ({ dm, onSelect, onClose }) => {
    const { t: tl } = useLang();
    const [query, setQuery] = useState('');
    const [activeCat, setActiveCat] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const isOled = dm && document.body.classList.contains('oled-theme');
    const bg = dm ? '#16162a' : '#ffffff';
    const border = dm ? (isOled ? '#0d0d12' : '#2a2a3a') : '#e8e8f0';
    const subtext = dm ? '#7c7caa' : '#9ca3af';

    const allEmojis = EMOJI_CATEGORIES.flatMap(c => c.emojis);
    const filtered = query.trim()
        ? allEmojis.filter(e => e.includes(query))
        : EMOJI_CATEGORIES[activeCat].emojis;

    return (
        <div
            ref={ref}
            onClick={e => e.stopPropagation()}
            style={{ backgroundColor: bg, borderBottom: `1px solid ${border}`, overflow: 'hidden' }}
        >
            {/* Search */}
            <div style={{ padding: '6px 8px 4px', borderBottom: `1px solid ${border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: dm ? (isOled ? '#0a0a14' : '#1e1e30') : '#f5f3ff', borderRadius: 8, padding: '5px 10px', border: `1px solid ${border}` }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={subtext} strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder={tl('Search emoji...')}
                        style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 12, color: dm ? '#e2e8f0' : '#1e1b4b', fontFamily: 'inherit' }}
                    />
                    {query && <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: subtext, padding: 0, display: 'flex', alignItems: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
                </div>
            </div>

            {/* Category tabs (hidden during search) */}
            {!query.trim() && (
                <div style={{ display: 'flex', overflowX: 'auto', padding: '4px 6px', borderBottom: `1px solid ${border}`, gap: 1 }}>
                    {EMOJI_CATEGORIES.map((cat, i) => (
                        <button key={i} onClick={() => setActiveCat(i)} className="emoji-btn"
                            style={{ background: activeCat === i ? (dm ? 'rgba(99,102,241,0.25)' : '#ede9fe') : 'none', border: activeCat === i ? '1.5px solid #6366f1' : '1.5px solid transparent', borderRadius: 7, fontSize: 20, cursor: 'pointer', padding: '3px 5px', flexShrink: 0, lineHeight: 1, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            title={cat.name}>
                            {cat.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Emoji grid */}
            <div style={{ display: 'flex', flexWrap: 'wrap', maxHeight: 180, overflowY: 'auto', padding: '4px 4px 6px' }}>
                {filtered.map((emoji, i) => (
                    <button key={i} onClick={() => onSelect(emoji)} className="emoji-btn"
                        style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', padding: '3px 4px', borderRadius: 6, lineHeight: 1, transition: 'transform 0.1s', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.3)')}
                        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}>
                        {emoji}
                    </button>
                ))}
                {filtered.length === 0 && <div style={{ padding: '20px 10px', color: subtext, fontSize: 12 }}>{tl('No results found')}</div>}
            </div>
        </div>
    );
};

// ─── Link Preview Card ────────────────────────────────────────────────────────
const _linkPreviewCache = new Map<string, any>();

const LinkPreviewCard: React.FC<{
    url: string; token: string; isDark: boolean; isOled: boolean; isOwn: boolean;
}> = ({ url, token, isDark, isOled, isOwn }) => {
    const dm = isDark;
    const [data, setData] = React.useState<any>(_linkPreviewCache.get(url) ?? null);
    const [loading, setLoading] = React.useState(!_linkPreviewCache.has(url));

    React.useEffect(() => {
        if (_linkPreviewCache.has(url)) { setData(_linkPreviewCache.get(url)); setLoading(false); return; }
        let alive = true;
        api.getLinkPreview(token, url).then(res => {
            if (!alive) return;
            if (res?.title || res?.description || res?.image) {
                _linkPreviewCache.set(url, res);
                setData(res);
            } else {
                _linkPreviewCache.set(url, null);
            }
            setLoading(false);
        });
        return () => { alive = false; };
    }, [url, token]);

    if (loading) return (
        <div style={{ marginTop: 8, borderRadius: 10, overflow: 'hidden', height: 60, background: isOwn ? 'rgba(255,255,255,0.1)' : (isOled ? 'rgba(255,255,255,0.03)' : dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'), animation: 'pulse 1.5s ease-in-out infinite' }} />
    );
    if (!data) return null;

    const bg = isOwn ? 'rgba(255,255,255,0.12)' : (isOled ? 'rgba(255,255,255,0.04)' : dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)');
    const border = isOwn ? 'rgba(255,255,255,0.2)' : (isOled ? 'rgba(167,139,250,0.2)' : dm ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.15)');
    const accent = isOwn ? 'rgba(255,255,255,0.7)' : (isOled ? '#a78bfa' : dm ? '#a5b4fc' : '#6366f1');
    const textCol = isOwn ? 'rgba(255,255,255,0.95)' : (dm ? '#e2e8f0' : '#1e1b4b');
    const subCol = isOwn ? 'rgba(255,255,255,0.6)' : (dm ? '#9ca3af' : '#6b7280');

    return (
        <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            style={{ display: 'block', marginTop: 8, borderRadius: 10, overflow: 'hidden', background: bg, border: `1px solid ${border}`, textDecoration: 'none', transition: 'opacity 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
            {data.image && (
                <img src={data.image} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            <div style={{ padding: '8px 10px' }}>
                {data.site_name && <div style={{ fontSize: 10, fontWeight: 600, color: accent, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{data.site_name}</div>}
                {data.title && <div style={{ fontSize: 13, fontWeight: 600, color: textCol, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{data.title}</div>}
                {data.description && <div style={{ fontSize: 11, color: subCol, marginTop: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{data.description}</div>}
            </div>
        </a>
    );
};

function extractFirstUrl(text: string | null | undefined): string | null {
    if (!text) return null;
    const m = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
    return m ? m[0] : null;
}

// ─── Sticker Pack Preview Modal ───────────────────────────────────────────────
const StickerPackPreviewModal: React.FC<{
    data: { url: string; pack?: { id: string; name: string; emoji: string; stickers: string[] } };
    isDark: boolean;
    onClose: () => void;
}> = ({ data, isDark, onClose }) => {
    const { t: tl, lang: language } = useLang();
    const dm = isDark;
    const isOled = dm && document.body.classList.contains('oled-theme');
    const text = dm ? '#e2e8f0' : '#1e1b4b';
    const subtext = dm ? '#888' : '#9ca3af';
    const ref = useRef<HTMLDivElement>(null);

    const isAlreadyAdded = () => {
        if (!data.pack) return false;
        try {
            const packs = JSON.parse(localStorage.getItem('aurora_sticker_packs') || '[]');
            return packs.some((p: any) => p.id === data.pack!.id);
        } catch { return false; }
    };
    const [added, setAdded] = useState(isAlreadyAdded);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    const handleAdd = () => {
        if (!data.pack || added) return;
        try {
            const packs = JSON.parse(localStorage.getItem('aurora_sticker_packs') || '[]');
            if (!packs.some((p: any) => p.id === data.pack!.id)) {
                const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
                const newPack = {
                    id: data.pack.id,
                    name: data.pack.name,
                    emoji: data.pack.emoji,
                    stickers: data.pack.stickers.map((url: string) => ({ id: uid(), url })),
                };
                packs.push(newPack);
                localStorage.setItem('aurora_sticker_packs', JSON.stringify(packs));
            }
            setAdded(true);
        } catch {}
    };

    const stickers = data.pack?.stickers || [data.url];
    const count = stickers.length;
    const countLabel = language === 'en'
        ? `sticker${count === 1 ? '' : 's'}`
        : (count === 1 ? 'стикер' : count <= 4 ? 'стикера' : 'стикеров');

    const modalBg = isOled
        ? '#000000'
        : dm
            ? 'linear-gradient(160deg, #16112a 0%, #1a1530 100%)'
            : 'linear-gradient(160deg, #faf9ff 0%, #f3f0ff 100%)';
    const glow = isOled
        ? '0 0 60px rgba(124,58,237,0.25), 0 30px 80px rgba(0,0,0,0.9)'
        : dm
            ? '0 0 0 1px rgba(99,102,241,0.18), 0 8px 40px rgba(99,102,241,0.28), 0 24px 60px rgba(0,0,0,0.7)'
            : '0 0 0 1px rgba(99,102,241,0.1), 0 8px 32px rgba(99,102,241,0.18), 0 16px 48px rgba(0,0,0,0.1)';
    const cellBg = isOled ? 'rgba(255,255,255,0.03)' : dm ? 'rgba(255,255,255,0.04)' : 'rgba(99,102,241,0.05)';

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(12px)' }}>
            <div ref={ref} className="floating-enter" style={{ background: modalBg, borderRadius: 24, boxShadow: glow, width: 340, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '18px 18px 14px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div style={{ width: 46, height: 46, borderRadius: 14, background: isOled ? 'rgba(139,92,246,0.18)' : dm ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
                        {data.pack?.emoji || '🎭'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.pack?.name || tl('Stickers')}</div>
                        <div style={{ fontSize: 12, color: subtext, marginTop: 2 }}>{count} {countLabel}</div>
                    </div>
                    <button onClick={onClose} style={{ width: 32, height: 32, background: isOled ? 'rgba(255,255,255,0.06)' : dm ? 'rgba(255,255,255,0.07)' : 'rgba(99,102,241,0.08)', border: 'none', borderRadius: 10, cursor: 'pointer', color: subtext, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = isOled ? 'rgba(255,255,255,0.1)' : dm ? 'rgba(255,255,255,0.12)' : 'rgba(99,102,241,0.14)')}
                        onMouseLeave={e => (e.currentTarget.style.background = isOled ? 'rgba(255,255,255,0.06)' : dm ? 'rgba(255,255,255,0.07)' : 'rgba(99,102,241,0.08)')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                {/* Sticker grid */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: '0 14px 14px' }}>
                    {stickers.map((url, i) => (
                        <div key={i} style={{ aspectRatio: '1', borderRadius: 14, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: cellBg, transition: 'background 0.15s', cursor: 'default' }}
                            onMouseEnter={e => (e.currentTarget.style.background = isOled ? 'rgba(139,92,246,0.12)' : dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.1)')}
                            onMouseLeave={e => (e.currentTarget.style.background = cellBg)}
                        >
                            <img src={url} alt="" style={{ width: '78%', height: '78%', objectFit: 'contain' }} />
                        </div>
                    ))}
                </div>

                {/* Footer */}
                {data.pack && (
                    <div style={{ padding: '10px 14px 16px', flexShrink: 0 }}>
                        <button
                            onClick={handleAdd}
                            disabled={added}
                            style={{ width: '100%', padding: '12px 0', background: added ? (isOled ? 'rgba(139,92,246,0.12)' : dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.08)') : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: added ? (isOled ? '#a78bfa' : dm ? '#a5b4fc' : '#6366f1') : 'white', border: 'none', borderRadius: 14, cursor: added ? 'default' : 'pointer', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', transition: 'all 0.18s', boxShadow: added ? 'none' : (isOled ? '0 4px 20px rgba(109,40,217,0.5)' : dm ? '0 4px 16px rgba(99,102,241,0.4)' : '0 4px 14px rgba(99,102,241,0.3)') }}
                            onMouseEnter={e => { if (!added) e.currentTarget.style.filter = 'brightness(1.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.filter = ''; }}
                        >
                            {added ? `✓ ${language === 'en' ? 'Pack added' : 'Набор добавлен'}` : (language === 'en' ? `Add ${count} sticker${count === 1 ? '' : 's'}` : `Добавить ${count} ${countLabel}`)}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── PostViewTracker ─────────────────────────────────────────────────────────
const PostViewTracker: React.FC<{
    messageId: number;
    groupId: number;
    token: string;
    currentUserId: number;
    senderId: number;
    initialCount: number;
    isDark: boolean;
    onView: (count: number) => void;
}> = ({ messageId, groupId, token, currentUserId, senderId, initialCount, isDark, onView }) => {
    const ref = useRef<HTMLDivElement>(null);
    const recordedRef = useRef(false);
    const [count, setCount] = useState(initialCount);

    useEffect(() => { setCount(initialCount); }, [initialCount]);

    useEffect(() => {
        if (senderId === currentUserId || recordedRef.current) return;
        const observer = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && !recordedRef.current) {
                recordedRef.current = true;
                api.viewPost(token, groupId, messageId).then(r => {
                    if (r.view_count != null) {
                        setCount(r.view_count);
                        onView(r.view_count);
                    }
                }).catch(() => {});
                observer.disconnect();
            }
        }, { threshold: 0.5 });
        if (ref.current) observer.observe(ref.current);
        return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messageId, groupId, token, currentUserId, senderId]);

    return (
        <div ref={ref} style={{ display: 'flex', alignItems: 'center', gap: 4, color: isDark ? '#5a5a8a' : '#9ca3af', fontSize: 12 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            {count > 0 ? (count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count) : ''}
        </div>
    );
};

export default Chat;
