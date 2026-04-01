import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { wsService } from '../services/websocket';
import { User, Message, Group, GroupMessage, ChatItem, ThemeSettings } from '../types';
import FileMessage, { ImageGrid } from './FileMessage';
import CreateGroupModal from './CreateGroupModal';
import CreateChannelModal from './CreateChannelModal';
import InviteToGroupModal from './InviteToGroupModal';
import GroupInfo from './GroupInfo';
import SearchModal from './SearchModal';
import SettingsModal from './SettingsModal';
import UserProfileModal from './UserProfileModal';
import EmojiPicker from './EmojiPicker';
import FolderManager from './FolderManager';
import ChatMediaPanel from './ChatMediaPanel';
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

interface ChatProps {
    token: string;
    currentUserId: number;
    currentUsername: string;
    currentUserAvatar?: string;
    currentUserStatus?: string;
    currentUserTag?: string;
    theme: ThemeSettings;
    onThemeChange: (theme: ThemeSettings) => void;
    onProfileUpdate: (username: string, avatar?: string, status?: string) => void;
    onLogout: () => void;
}

const Chat: React.FC<ChatProps> = ({ token, currentUserId, currentUsername, currentUserAvatar, currentUserStatus, currentUserTag, theme, onThemeChange, onProfileUpdate, onLogout }) => {
    const [users, setUsers] = useState<User[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [activeChat, setActiveChat] = useState<ChatItem | null>(null);
    const [messages, setMessages] = useState<(Message | GroupMessage)[]>([]);
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
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
    const [menuMessageId, setMenuMessageId] = useState<number | null>(null);
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
    const [replyTo, setReplyTo] = useState<any>(null);
    const [selectedUserForProfile, setSelectedUserForProfile] = useState<User | null>(null);
    const [profileFromGroupInfo, setProfileFromGroupInfo] = useState(false);
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
    const [previewGroup, setPreviewGroup] = useState<Group | null>(null); // channel being viewed but not yet joined

    // Channel comments panel
    const [commentPostId, setCommentPostId] = useState<number | null>(null);
    const [commentText, setCommentText] = useState('');
    const [commentReplyTo, setCommentReplyTo] = useState<any>(null);
    const [hoveredCommentId, setHoveredCommentId] = useState<number | null>(null);
    const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
    const [editingCommentText, setEditingCommentText] = useState('');

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

    // Sidebar search
    const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
    const [sidebarSearchFocused, setSidebarSearchFocused] = useState(false);
    const [sidebarSearchResults, setSidebarSearchResults] = useState<User[]>([]);
    const [sidebarChannelResults, setSidebarChannelResults] = useState<any[]>([]);
    const [sidebarSearchLoading, setSidebarSearchLoading] = useState(false);
    const sidebarSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    // Emoji picker
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    // Clear chat confirmation
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    // Sidebar state: full | compact | hidden
    type SidebarState = 'full' | 'compact' | 'hidden';
    const [sidebarState, setSidebarState] = useState<SidebarState>('full');
    const sidebarHidden = sidebarState === 'hidden'; // compat
    const cycleSidebar = () => setSidebarState(s => s === 'full' ? 'compact' : s === 'compact' ? 'hidden' : 'full');
    const sidebarCompact = sidebarState === 'compact';

    // Chat folders
    interface ChatFolder { id: number; name: string; color: string; chats: {chat_type: string; chat_id: number}[]; }
    const [folders, setFolders] = useState<ChatFolder[]>([]);
    const [activeFolder, setActiveFolder] = useState<number | null>(null); // null = all chats
    const [showFolderManager, setShowFolderManager] = useState(false);
    const folderTabsRef = useRef<HTMLDivElement>(null);

    // Pinned chats
    const [pinnedChats, setPinnedChats] = useState<Set<string>>(() => {
        try { return new Set(JSON.parse(localStorage.getItem('aurora_pinned') || '[]')); }
        catch { return new Set(); }
    });
    const [pinMenu, setPinMenu] = useState<{ x: number; y: number; key: string } | null>(null);
    const togglePin = (key: string) => {
        setPinnedChats(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            localStorage.setItem('aurora_pinned', JSON.stringify(Array.from(next)));
            return next;
        });
        setPinMenu(null);
    };

    // Muted chats
    const [mutedChats, setMutedChats] = useState<Set<string>>(() => {
        try { return new Set(JSON.parse(localStorage.getItem('aurora_muted') || '[]')); }
        catch { return new Set(); }
    });
    const mutedChatsRef = useRef<Set<string>>(new Set());
    useEffect(() => { mutedChatsRef.current = mutedChats; }, [mutedChats]);
    const toggleMute = (key: string) => {
        setMutedChats(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            localStorage.setItem('aurora_muted', JSON.stringify(Array.from(next)));
            return next;
        });
        setPinMenu(null);
    };

    // Pinned messages within chats (localStorage only)
    const [pinnedMessages, setPinnedMessages] = useState<Record<string, { id: number; text: string; sender: string } | null>>(() => {
        try { return JSON.parse(localStorage.getItem('aurora_pinned_msgs') || '{}'); }
        catch { return {}; }
    });
    const togglePinMessage = (chatKey: string, msg: any) => {
        setPinnedMessages(prev => {
            const next = { ...prev, [chatKey]: prev[chatKey]?.id === msg.id ? null : { id: msg.id, text: msg.message_text || '[файл]', sender: (msg as any).sender_name || 'Вы' } };
            localStorage.setItem('aurora_pinned_msgs', JSON.stringify(next));
            return next;
        });
        setMenuMessageId(null);
    };

    // Folder context menu
    const [folderCtxMenu, setFolderCtxMenu] = useState<{ x: number; y: number; folderId: number } | null>(null);
    // "Add to folder" submenu key within chat context menu
    const [addToFolderKey, setAddToFolderKey] = useState<string | null>(null);

    const handleDeleteChat = (key: string) => {
        const parts = key.split('-');
        const type = parts[0];
        const id = parseInt(parts[1]);
        if (type === 'private') {
            setUsers(prev => prev.filter(u => u.id !== id));
            if (activeChat?.type === 'private' && activeChat.id === id) { setActiveChat(null); setMessages([]); }
        } else {
            setGroups(prev => prev.filter(g => g.id !== id));
            if (activeChat?.type === 'group' && activeChat.id === id) { setActiveChat(null); setMessages([]); }
        }
        setUnreadCounts(prev => { const n = { ...prev }; delete n[key]; return n; });
        if (pinnedChats.has(key)) togglePin(key);
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

    // Voice recording
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
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

    // Reactions: messageId → [{emoji, user_id}]
    const [reactions, setReactions] = useState<Record<number, {emoji: string; user_id: number}[]>>({});
    const [reactionPickerMsgId, setReactionPickerMsgId] = useState<number | null>(null);
    const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const currentUploadXHR = useRef<XMLHttpRequest | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const autoResize = (el: HTMLTextAreaElement) => {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 150) + 'px';
    };
    const activeChatRef = useRef<ChatItem | null>(null);
    // Draft text per chat: key = "type-id"
    const chatDrafts = useRef<Map<string, string>>(new Map());
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
            showInAppToast({ title: 'Микрофон недоступен', body: 'Для записи голоса откройте сайт через HTTPS или localhost.', chatType: 'private', chatId: 0, avatarLetter: '🎤', avatarColor: '#ef4444' });
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
                const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
                addPendingFiles([file]);
                stream.getTracks().forEach(t => t.stop());
                if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
                setRecordingTime(0);
            };
            mr.start();
            mediaRecorderRef.current = mr;
            setIsRecording(true);
            recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
        } catch {
            showInAppToast({ title: 'Микрофон', body: 'Нет доступа к микрофону. Проверьте разрешения браузера.', chatType: 'private', chatId: 0, avatarLetter: '🎤', avatarColor: '#ef4444' });
        }
    };

    const stopRecording = () => {
        if (!isRecording || !mediaRecorderRef.current) return;
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
        setIsRecording(false);
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

    const playGlobalAudio = React.useCallback((src: string, filename: string) => {
        const index = mediaPlaylist.findIndex(x => x.src === src);
        setNowPlaying({ src, filename, index: index >= 0 ? index : 0 });
        setGlobalDuration(0);
        setGlobalCurrentTime(0);
        setGlobalPlaying(false);
        const audio = globalAudioRef.current;
        if (!audio) return;
        audio.src = src;
        audio.load(); // force metadata load before play
        audio.play().catch(() => {});
    }, [mediaPlaylist]);

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

    const stopGlobal = () => {
        globalAudioRef.current?.pause();
        setNowPlaying(null);
        setGlobalPlaying(false);
        setGlobalCurrentTime(0);
        setGlobalDuration(0);
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

    // === Last seen formatter ===

    const renderTextWithLinks = (text: string | null | undefined): React.ReactNode => {
        if (!text) return null;
        const re = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
            const url = m[0];
            parts.push(<a key={m.index} href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', wordBreak: 'break-all' }} onClick={e => e.stopPropagation()}>{url}</a>);
            lastIndex = m.index + url.length;
        }
        if (lastIndex < text.length) parts.push(text.slice(lastIndex));
        return parts.length > 0 ? <>{parts}</> : text;
    };

    const formatLastSeen = (lastSeen: string | null | undefined): string => {
        if (!lastSeen || lastSeen === 'hidden') return 'был(а) недавно';
        try {
            const date = new Date(lastSeen);
            if (isNaN(date.getTime())) return 'был(а) недавно';
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            if (diffMs < 0) return 'только что'; // clock skew
            const diffMin = Math.floor(diffMs / 60000);
            if (diffMin < 1) return 'только что';
            if (diffMin < 60) return `${diffMin} мин. назад`;
            const diffH = Math.floor(diffMin / 60);
            if (diffH < 6) return `${diffH} ч. назад`;
            const today = new Date(); today.setHours(0,0,0,0);
            const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
            const msgDay = new Date(date); msgDay.setHours(0,0,0,0);
            const hhmm = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            if (msgDay.getTime() === today.getTime()) return `сегодня в ${hhmm}`;
            if (msgDay.getTime() === yesterday.getTime()) return `вчера в ${hhmm}`;
            const diffDays = Math.floor(diffMs / 86400000);
            if (diffDays < 7) return `${diffDays} дн. назад`;
            return 'давно';
        } catch { return 'был(а) недавно'; }
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
                setMessages(res.messages);
                // Populate reactions from loaded messages
                const rxMap: Record<number, {emoji: string; user_id: number}[]> = {};
                for (const msg of res.messages) {
                    if (msg.reactions?.length) rxMap[msg.id] = msg.reactions;
                }
                setReactions(prev => ({ ...prev, ...rxMap }));
                scrollToBottom();
                wsService.markRead(userId);
            }
        } catch (e) { console.error(e); }
    }, [token]);

    const loadGroupMessages = useCallback(async (groupId: number) => {
        try {
            const res = await api.getGroupMessages(token, groupId);
            if (res.messages) {
                setMessages(res.messages);
                const rxMap: Record<number, {emoji: string; user_id: number}[]> = {};
                for (const msg of res.messages) {
                    if (msg.reactions?.length) rxMap[msg.id] = msg.reactions;
                }
                setReactions(prev => ({ ...prev, ...rxMap }));
                scrollToBottom();
            }
        } catch (e) { console.error(e); }
    }, [token]);

    // === Инициализация ===

    useEffect(() => {
        loadUsers();
        loadGroups();
        api.getFolders(token).then(res => { if (res.folders) setFolders(res.folders); }).catch(() => {});
    }, [loadUsers, loadGroups]);

    useEffect(() => {
        const id = setInterval(loadGroups, 30000);
        return () => clearInterval(id);
    }, [loadGroups]);

    // === In-chat search ===
    const [chatSearchOpen, setChatSearchOpen] = useState(false);
    const [chatSearchQuery, setChatSearchQuery] = useState('');
    const [chatSearchIdx, setChatSearchIdx] = useState(0);
    const chatSearchInputRef = useRef<HTMLInputElement>(null);

    const chatSearchMatches = React.useMemo(() => {
        if (!chatSearchQuery.trim()) return [];
        const q = chatSearchQuery.toLowerCase();
        return messages
            .filter(msg => msg.message_text?.toLowerCase().includes(q))
            .map(msg => msg.id);
    }, [messages, chatSearchQuery]);

    const goToChatSearchMatch = (idx: number) => {
        if (!chatSearchMatches.length) return;
        const safeIdx = ((idx % chatSearchMatches.length) + chatSearchMatches.length) % chatSearchMatches.length;
        setChatSearchIdx(safeIdx);
        goToMessage(chatSearchMatches[safeIdx]);
    };

    useEffect(() => {
        activeChatRef.current = activeChat;
        setShowClearConfirm(false);
        setShowMediaPanel(false);
        setChatSearchOpen(false);
        setChatSearchQuery('');
        setChatSearchIdx(0);
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
    }, []);

    useEffect(() => {
        if (!menuMessageId) return;
        const close = () => setMenuMessageId(null);
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, [menuMessageId]);

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

    // === WebSocket ===

    useEffect(() => {
        wsService.connect(token);

        const unsubscribe = wsService.onMessage((data) => {
            const chat = activeChatRef.current;

            if (data.type === 'message') {
                if (chat?.type === 'private' && chat.id === data.data.sender_id) {
                    setMessages(prev =>
                        prev.some(m => m.id === data.data.id) ? prev : [...prev, { ...data.data, reactions: [] }]
                    );
                    scrollToBottom(true);
                    wsService.markRead(data.data.sender_id);
                } else {
                    const key = `private-${data.data.sender_id}`;
                    setUnreadCounts(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
                }
                // Show in-app toast
                const senderUser = usersRef.current.find((u: User) => u.id === data.data.sender_id);
                const isChatActive = activeChatRef.current?.type === 'private' && activeChatRef.current?.id === data.data.sender_id;
                if (!isChatActive && !mutedChatsRef.current.has(`private-${data.data.sender_id}`)) {
                    const senderDisplayName = senderUser?.username || data.data.sender_name || 'Новое сообщение';
                    showInAppToast({
                        title: senderDisplayName,
                        body: getMsgPreview(data.data),
                        chatType: 'private',
                        chatId: data.data.sender_id,
                        senderId: data.data.sender_id,
                        avatarLetter: (senderUser?.username?.[0] || data.data.sender_name?.[0] || '?').toUpperCase(),
                        avatarColor: senderUser?.avatar_color || '#1a73e8',
                        avatarSrc: senderUser?.avatar,
                    });
                    // Native notification when window not focused
                    if (!document.hasFocus()) {
                        (window as any).electronAPI?.showNotification?.(
                            senderDisplayName,
                            getMsgPreview(data.data),
                            { chatType: 'private', chatId: data.data.sender_id, senderId: data.data.sender_id }
                        );
                        if ('Notification' in window && Notification.permission === 'granted' && !(window as any).electronAPI) {
                            new Notification(senderDisplayName, {
                                body: getMsgPreview(data.data),
                                icon: '/logo192.png',
                            });
                        }
                    }
                }
                // Add sender to contacts if not present, update last message
                const senderId = data.data.sender_id;
                if (senderId && senderId !== currentUserId) {
                    setUsers(prev => {
                        if (!prev.some(u => u.id === senderId)) { loadUsers(); return prev; }
                        const u = prev.find(u => u.id === senderId)!;
                        const _f0 = data.data.files?.[0];
                        const updated = { ...u, last_msg_text: data.data.message_text || null, last_msg_file: data.data.file_path || _f0?.file_path || null, last_msg_filename: data.data.filename || _f0?.filename || null, last_msg_time: data.data.timestamp, last_msg_sender_id: data.data.sender_id };
                        return [updated, ...prev.filter(x => x.id !== senderId)];
                    });
                }

            } else if (data.type === 'message_sent') {
                if (chat?.type === 'private' && chat.id === data.data.receiver_id) {
                    setMessages(prev =>
                        prev.some(m => m.id === data.data.id) ? prev : [...prev, data.data]
                    );
                    scrollToBottom(true);
                }
                // Bring receiver to top, update last message
                const recvId = data.data.receiver_id;
                if (recvId && recvId !== currentUserId) {
                    setUsers(prev => {
                        if (!prev.some(u => u.id === recvId)) return prev;
                        const u = prev.find(u => u.id === recvId)!;
                        const _f0s = data.data.files?.[0];
                        const updated = { ...u, last_msg_text: data.data.message_text || null, last_msg_file: data.data.file_path || _f0s?.file_path || null, last_msg_filename: data.data.filename || _f0s?.filename || null, last_msg_time: data.data.timestamp, last_msg_sender_id: currentUserId };
                        return [updated, ...prev.filter(x => x.id !== recvId)];
                    });
                }

            } else if (data.type === 'group_message') {
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    setMessages(prev =>
                        prev.some(m => m.id === data.data.id) ? prev : [...prev, data.data]
                    );
                    scrollToBottom(true);
                } else if (data.data.sender_id !== currentUserId) {
                    const key = `group-${data.data.group_id}`;
                    setUnreadCounts(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
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
                    if (!isChatActive && !mutedChatsRef.current.has(`group-${data.data.group_id}`)) {
                        const groupObj = groupsRef.current.find((g: Group) => g.id === data.data.group_id);
                        const groupName = groupObj?.name || 'Группа';
                        const senderName = data.data.sender_name || 'Участник';
                        showInAppToast({
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
                            (window as any).electronAPI?.showNotification?.(
                                groupName,
                                `${senderName}: ${getMsgPreview(data.data)}`,
                                { chatType: 'group', chatId: data.data.group_id, senderId: data.data.sender_id, groupId: data.data.group_id }
                            );
                            if ('Notification' in window && Notification.permission === 'granted' && !(window as any).electronAPI) {
                                new Notification(groupName, {
                                    body: `${senderName}: ${getMsgPreview(data.data)}`,
                                    icon: '/logo192.png',
                                });
                            }
                        }
                    }
                }

            } else if (data.type === 'message_edited') {
                setMessages(prev => prev.map(msg =>
                    msg.id === data.data.message_id
                        ? { ...msg, message_text: data.data.new_text, edited_at: new Date().toISOString() }
                        : msg
                ));
                // Update sidebar if this was the last message
                const editedInGroup = data.data.group_id as number | undefined;
                if (editedInGroup) {
                    setGroups(prev => prev.map(g => g.id === editedInGroup && g.last_msg_sender_id === data.data.sender_id
                        ? { ...g, last_msg_text: data.data.new_text }
                        : g
                    ));
                } else {
                    const editSenderId = data.data.sender_id as number | undefined;
                    const editReceiverId = data.data.receiver_id as number | undefined;
                    const editOther = editSenderId === currentUserId ? editReceiverId : editSenderId;
                    if (editOther) {
                        setUsers(prev => prev.map(u => u.id === editOther && u.last_msg_sender_id === data.data.sender_id
                            ? { ...u, last_msg_text: data.data.new_text }
                            : u
                        ));
                    }
                }

            } else if (data.type === 'message_deleted') {
                const deletedId = data.data.message_id;
                const isGroup = data.data.is_group;
                const groupId = data.data.group_id as number | undefined;
                const otherUserId = data.data.other_user_id as number | undefined;
                setDeletingMsgIds(prev => new Set(prev).add(deletedId));
                setTimeout(() => {
                    setMessages(prev => prev.filter(msg => msg.id !== deletedId));
                    setDeletingMsgIds(prev => { const s = new Set(prev); s.delete(deletedId); return s; });
                    // Reload sidebar to reflect the new last message
                    if (isGroup) loadGroups(); else loadUsers();
                }, 320);

            } else if (data.type === 'typing') {
                if (chat?.type === 'private' && chat.id === data.data.user_id) {
                    setTypingUser(data.data.username || 'Собеседник');
                    if (typingUserTimerRef.current) clearTimeout(typingUserTimerRef.current);
                    typingUserTimerRef.current = setTimeout(() => setTypingUser(null), 1000);
                }
                const tKey = `private-${data.data.user_id}`;
                setTypingChats(prev => ({ ...prev, [tKey]: data.data.username || '' }));
                if (typingChatsTimers.current[tKey]) clearTimeout(typingChatsTimers.current[tKey]);
                typingChatsTimers.current[tKey] = setTimeout(() => setTypingChats(prev => { const n = { ...prev }; delete n[tKey]; return n; }), 3000);

            } else if (data.type === 'group_typing') {
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    setTypingUser(data.data.username || 'Участник');
                    if (typingUserTimerRef.current) clearTimeout(typingUserTimerRef.current);
                    typingUserTimerRef.current = setTimeout(() => setTypingUser(null), 1000);
                }
                const tKeyG = `group-${data.data.group_id}`;
                setTypingChats(prev => ({ ...prev, [tKeyG]: data.data.username || '' }));
                if (typingChatsTimers.current[tKeyG]) clearTimeout(typingChatsTimers.current[tKeyG]);
                typingChatsTimers.current[tKeyG] = setTimeout(() => setTypingChats(prev => { const n = { ...prev }; delete n[tKeyG]; return n; }), 3000);

            } else if (data.type === 'new_group') {
                loadGroups();

            } else if (data.type === 'group_member_added') {
                loadGroups();
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    setMessages(prev => [...prev, {
                        id: Date.now(),
                        is_system: true,
                        message_text: `${data.data.username} вступил в группу`,
                        timestamp: new Date().toISOString(),
                        sender_id: 0,
                    } as any]);
                }

            } else if (data.type === 'group_updated') {
                setGroups(prev => prev.map(g =>
                    g.id === data.data.group_id ? { ...g, avatar: data.data.avatar } : g
                ));

            } else if (data.type === 'group_info_updated') {
                setGroups(prev => prev.map(g =>
                    g.id === data.data.group_id
                        ? { ...g, name: data.data.name, description: data.data.description }
                        : g
                ));
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

            } else if (data.type === 'group_member_removed') {
                loadGroups();
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    setMessages(prev => [...prev, {
                        id: Date.now(),
                        is_system: true,
                        message_text: `${data.data.username} покинул группу`,
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
                const { message_ids } = data.data;
                setMessages(prev => prev.map(m =>
                    message_ids.includes(m.id) ? { ...m, is_read: 1 } : m
                ));

            } else if (data.type === 'group_messages_read') {
                const { message_ids } = data.data;
                setMessages(prev => prev.map(m =>
                    message_ids.includes(m.id) ? { ...m, is_read: true } : m
                ));

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

            } else if (data.type === 'user_status') {
                setUsers(prev => prev.map(u =>
                    u.id === data.data.user_id ? { ...u, is_online: data.data.is_online } : u
                ));

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
            }
        });

        return () => {
            unsubscribe();
            if (typingUserTimerRef.current) clearTimeout(typingUserTimerRef.current);
            if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        };
    }, [token, loadGroups, loadUsers, currentUserId]);

    // === Выбор чата ===

    const saveDraft = useCallback((chat: ChatItem | null) => {
        if (!chat) return;
        chatDrafts.current.set(`${chat.type}-${chat.id}`, inputRef.current?.value || '');
    }, []);

    const restoreDraft = useCallback((key: string) => {
        if (inputRef.current) {
            inputRef.current.value = chatDrafts.current.get(key) || '';
            autoResize(inputRef.current);
        }
    }, []);

    const selectPrivateChat = (user: User) => {
        saveDraft(activeChatRef.current);
        setReplyTo(null);
        setCommentPostId(null);
        setPreviewGroup(null);
        setActiveChat({ type: 'private', id: user.id, name: user.username });
        setUnreadCounts(prev => { const next = { ...prev }; delete next[`private-${user.id}`]; return next; });
        restoreDraft(`private-${user.id}`);
        // Add to contacts list if not present
        setUsers(prev => prev.some(u => u.id === user.id) ? prev : [...prev, user]);
        loadPrivateMessages(user.id);
    };

    const selectGroupChat = (group: Group) => {
        saveDraft(activeChatRef.current);
        setReplyTo(null);
        setCommentPostId(null);
        setPreviewGroup(null);
        setActiveChat({ type: 'group', id: group.id, name: group.name });
        setUnreadCounts(prev => { const next = { ...prev }; delete next[`group-${group.id}`]; return next; });
        restoreDraft(`group-${group.id}`);
        wsService.send({ type: 'group_mark_read', group_id: group.id });
        loadGroupMessages(group.id);
    };

    const openChannelPreview = (channel: any) => {
        saveDraft(activeChatRef.current);
        setReplyTo(null);
        setCommentPostId(null);
        setPreviewGroup({ ...channel, is_channel: 1, channel_type: 'public', my_role: null } as any);
        setActiveChat({ type: 'group', id: channel.id, name: channel.name });
        loadGroupMessages(channel.id);
    };

    // === Отправка ===

    const sendMessage = async () => {
        const text = (inputRef.current?.value || '').trim();
        const hasFiles = pendingFiles.length > 0;
        if (!text && !hasFiles) return;
        if (!activeChat) return;

        const targetChat = { ...activeChat };
        const targetReplyTo = replyTo;

        if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = 'auto'; }
        setReplyTo(null);

        // Text only — send immediately via WS
        if (text && !hasFiles) {
            if (targetChat.type === 'private') {
                wsService.sendMessage(targetChat.id, text, undefined, undefined, undefined,
                    targetReplyTo?.id, targetReplyTo?.message_text, targetReplyTo?.sender_name);
            } else {
                wsService.sendGroupMessage(targetChat.id, text, undefined, undefined, undefined,
                    targetReplyTo?.id, targetReplyTo?.message_text, targetReplyTo?.sender_name);
            }
            if (targetChat.type === 'private') loadUsers();
            return;
        }

        // Files (possibly with text) — upload then send combined in one message
        if (hasFiles) {
            const filesToUpload = [...pendingFiles];
            setPendingFiles([]);
            setUploading(true);
            setUploadProgress(0);

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
                        if (targetChat.type === 'private') loadUsers();
                    }
                } catch (e: any) {
                    if (e?.message !== 'Upload cancelled') {
                        showInAppToast({ title: 'Ошибка загрузки', body: 'Не удалось загрузить файл', chatType: 'private', chatId: 0, avatarLetter: '⚠️', avatarColor: '#ef4444' });
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

    const addPendingFiles = (files: FileList | File[]) => {
        const arr = Array.from(files).filter(f => {
            if (f.size > 1 * 1024 * 1024 * 1024) { alert(`Файл "${f.name}" больше 1 ГБ`); return false; }
            return true;
        });
        setPendingFiles(prev => {
            const combined = [...prev, ...arr];
            if (combined.length > 10) {
                showInAppToast({ title: 'Лимит файлов', body: 'Можно выбрать не более 10 файлов', chatType: 'private', chatId: 0, avatarLetter: '📎', avatarColor: '#6366f1' });
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
        if (!typing && activeChat) {
            setTyping(true);
            if (activeChat.type === 'private') wsService.sendTyping(activeChat.id);
            else wsService.sendGroupTyping(activeChat.id);
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
        const MENU_H = 180;
        const MENU_W = 170;
        const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8);
        const y = e.clientY + MENU_H > window.innerHeight
            ? e.clientY - MENU_H
            : e.clientY;
        setMenuPosition({ x, y });
    };

    const handleEdit = (messageId: number, currentText: string) => {
        setEditingMessageId(messageId);
        setEditingText(currentText);
        setMenuMessageId(null);
    };

    const handleEditSubmit = (messageId: number) => {
        if (editingText.trim()) {
            wsService.sendRaw({
                type: 'edit_message',
                message_id: messageId,
                new_text: editingText.trim(),
                is_group: activeChatRef.current?.type === 'group',
            });
        }
        setEditingMessageId(null);
        setEditingText('');
    };

    const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
    const [deletingMsgIds, setDeletingMsgIds] = useState<Set<number>>(new Set());
    const [forwardingMessage, setForwardingMessage] = useState<any | null>(null);

    const handleDelete = (messageId: number) => {
        setMenuMessageId(null);
        setDeleteConfirmId(messageId);
    };

    const confirmDelete = (forSelf: boolean) => {
        if (deleteConfirmId === null) return;
        wsService.sendRaw({
            type: 'delete_message',
            message_id: deleteConfirmId,
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
        const msgs = messages.filter(m => selectedMsgIds.has(m.id));
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

    const scrollToBottom = (smooth = false) => {
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
        const files: any[] = d.files?.length ? d.files : d.file_path ? [{ filename: d.filename || 'Файл' }] : [];
        if (!files.length) return text || '...';
        if (files.length === 1) return text ? `📎 ${text}` : `📎 ${files[0].filename || 'Файл'}`;
        return text ? `📎 ${text}` : `📎 ${files.length} файла(-ов)`;
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
        prefix?: string
    ) => {
        const subColor = dm ? '#5a5a8a' : '#9ca3af';
        const subStyle: React.CSSProperties = { fontSize: 13, color: subColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 };
        if (typingText) return <span style={{ ...subStyle, color: '#6366f1', fontStyle: 'italic' }}>{typingText}</span>;
        if (file && !text?.trim()) {
            const isImg = isImageFile(filename, file);
            const isVideo = /\.(mp4|webm|mov)$/i.test(filename || file.split('/').pop() || '');
            const isAudio = /\.(ogg|mp3|wav|weba|opus|m4a|aac|flac)$/i.test(filename || file.split('/').pop() || '');
            const rawLabel = filename || file.split('/').pop() || 'Файл';
            const fileLabel = isAudio && /^voice_/i.test(rawLabel) ? 'Голосовое сообщение' : rawLabel;
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', minWidth: 0 }}>
                    {prefix && <span style={{ color: subColor, fontSize: 13, flexShrink: 0 }}>{prefix}</span>}
                    {isImg ? (
                        <img src={config.fileUrl(file) ?? undefined} alt="" style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                    ) : isVideo ? (
                        <span style={{ fontSize: 14, flexShrink: 0 }}>🎬</span>
                    ) : isAudio ? (
                        <span style={{ fontSize: 14, flexShrink: 0 }}>🎤</span>
                    ) : (
                        <span style={{ fontSize: 14, flexShrink: 0 }}>📎</span>
                    )}
                    <span style={subStyle}>{fileLabel}</span>
                </div>
            );
        }
        const preview = text?.trim() || fallback;
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
        if (diffDays === 0) return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
        if (diffDays === 1) return 'вчера';
        if (diffDays < 7) return d.toLocaleDateString('ru', { weekday: 'short' });
        return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
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

    const showInAppToast = (toast: Omit<ToastItem, 'id' | 'exiting'>) => {
        const id = ++toastIdRef.current;
        setToasts(prev => [...prev.slice(-4), { ...toast, id }]);
        const timer = setTimeout(() => dismissToast(id), 5000);
        // Store timer to cancel on hover — handled via CSS animation instead
        return () => clearTimeout(timer);
    };

    const replyFromToast = (toast: ToastItem, text: string) => {
        if (!text.trim()) return;
        if (toast.chatType === 'private' && toast.senderId != null) {
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
            if (isSameDay(date, today)) return 'Сегодня';
            if (isSameDay(date, yesterday)) return 'Вчера';
            return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
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
    const isGroupAdmin = activeGroup ? (activeGroup.my_role === 'admin' || activeGroup.creator_id === currentUserId) : false;
    const isChannelChat = !!(activeGroup?.is_channel);
    const isChannelMember = isChannelChat && groups.some(g => g.id === activeChat?.id);

    // === Рендер ===

    const dm = theme.darkMode;
    const darkStyles = {
        sidebar: { ...styles.sidebar, backgroundColor: dm ? '#13131f' : '#f7f8fc', boxShadow: dm ? '2px 0 16px rgba(0,0,0,0.3)' : styles.sidebar.boxShadow },
        chatArea: { ...styles.chatArea, backgroundColor: dm ? '#0f0f1a' : '#f2f4f8' },
        chatHeader: { ...styles.chatHeader, borderBottom: `1px solid ${dm ? 'rgba(99,102,241,0.15)' : '#e8e8ef'}`, background: dm ? 'linear-gradient(135deg, #13131f 0%, #1a1830 100%)' : '#f7f8fc', boxShadow: dm ? '0 2px 24px rgba(99,102,241,0.08)' : styles.chatHeader.boxShadow },
        inputArea: { ...styles.inputArea, backgroundColor: dm ? '#13131f' : '#f7f8fc', borderTop: `1px solid ${dm ? '#2a2a3d' : '#e8e8ef'}` },
        input: { ...styles.input, backgroundColor: dm ? '#1e1e30' : '#eef0f8', border: `1.5px solid ${dm ? '#3a3a55' : '#dddde8'}`, color: dm ? '#e2e8f0' : 'inherit' },
        chatName: { ...styles.chatName, color: dm ? '#e2e8f0' : '#1e1b4b' },
        chatItem: { ...styles.chatItem },
        sectionTitle: { ...styles.sectionTitle, color: dm ? '#4c4c7a' : '#a5b4fc' },
        headerText: { color: dm ? '#e2e8f0' : 'inherit' },
        profileCard: { ...styles.profileCard, backgroundColor: dm ? '#161625' : '#f0f1f8', borderTop: `1px solid ${dm ? '#2a2a3d' : '#e4e5ef'}` },
        profileName: { ...styles.profileName, color: dm ? '#e2e8f0' : '#1e1b4b' },
        sidebarScroll: { ...styles.sidebarScroll, backgroundColor: dm ? '#13131f' : '#f7f8fc' },
        noChat: { ...styles.noChat, color: dm ? '#3a3a55' : '#c4b5fd' },
        activeChatItem: { background: dm ? 'linear-gradient(90deg, #1e1a3d 0%, #2a2545 100%)' : styles.activeChatItem.background, boxShadow: 'inset 3px 0 0 #6366f1' },
        iconBtn: { ...styles.iconBtn, background: dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.04)', border: `1px solid ${dm ? 'rgba(99,102,241,0.22)' : '#ede9fe'}`, color: dm ? '#a5b4fc' : '#6366f1', borderRadius: 12, padding: '8px 12px', boxShadow: dm ? '0 0 8px rgba(99,102,241,0.08)' : 'none' },
        fileBtn: { ...styles.fileBtn, backgroundColor: dm ? '#1e1e30' : '#eef0f8', border: `1.5px solid ${dm ? '#3a3a55' : '#dddde8'}`, color: dm ? '#7c7caa' : '#6366f1' },
    };

    return (
        <div style={{ ...styles.container }}>
            {/* Persistent audio element */}
            <audio
                ref={globalAudioRef}
                preload="auto"
                onPlay={() => setGlobalPlaying(true)}
                onPause={() => setGlobalPlaying(false)}
                onEnded={() => { setGlobalPlaying(false); setGlobalCurrentTime(0); }}
                onLoadedMetadata={e => {
                    const a = e.target as HTMLAudioElement;
                    if (isFinite(a.duration) && a.duration > 0) setGlobalDuration(a.duration);
                }}
                onDurationChange={e => {
                    const a = e.target as HTMLAudioElement;
                    if (isFinite(a.duration) && a.duration > 0) setGlobalDuration(a.duration);
                }}
                onTimeUpdate={e => {
                    const a = e.target as HTMLAudioElement;
                    setGlobalCurrentTime(a.currentTime);
                    if (isFinite(a.duration) && a.duration > 0) setGlobalDuration(a.duration);
                }}
            />

            {/* Кнопка-ручка на краю сайдбара */}
            <button
                onClick={cycleSidebar}
                title={sidebarState === 'full' ? 'Компактный режим' : sidebarState === 'compact' ? 'Скрыть панель' : 'Показать панель'}
                style={{ position: 'absolute', left: sidebarHidden ? 0 : sidebarCompact ? 64 : 320, top: '50%', transform: 'translateY(-50%)', zIndex: 30, width: 16, height: 48, borderRadius: '0 8px 8px 0', border: `1px solid ${dm ? 'rgba(99,102,241,0.3)' : '#ede9fe'}`, borderLeft: 'none', background: dm ? '#1e1a3d' : 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: dm ? '#a5b4fc' : '#6366f1', fontSize: 9, boxShadow: dm ? '2px 0 8px rgba(0,0,0,0.3)' : '2px 0 8px rgba(99,102,241,0.1)', padding: 0, transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)' }}
            >
                {sidebarState === 'full' ? '◀' : sidebarState === 'compact' ? '⊟' : '▶'}
            </button>

            {/* Боковая панель */}
            <div style={{ ...darkStyles.sidebar, width: sidebarCompact ? 64 : 320, display: sidebarHidden ? 'none' : 'flex', transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)', overflow: 'hidden' }}>
                <div style={{
                    ...styles.sidebarHeader,
                    background: dm ? 'linear-gradient(135deg, #1e1a3d 0%, #2d2060 100%)' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    justifyContent: sidebarCompact ? 'center' : undefined,
                    padding: sidebarCompact ? '16px 0' : '16px',
                }}>
                    <img src={dm ? '/logo-dark.png' : '/logo-light.png'} alt="Aurora" style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, objectFit: 'cover' }} />
                    {!sidebarCompact && <>
                        <div style={{ flex: 1, lineHeight: 1.1 }}>
                            <span style={dm ? { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', background: 'linear-gradient(90deg, #e0c4ff 0%, #a78bfa 55%, #818cf8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } : { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', color: 'white' }}>Aurora</span>
                        </div>
                        <div style={{ position: 'relative' }}>
                            <button
                                onClick={() => setShowCreateDropdown(v => !v)}
                                style={{ padding: '6px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, backgroundColor: dm ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.18)', color: dm ? '#c4b5fd' : 'white', border: dm ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                                + <span style={{ fontSize: 10, marginTop: 1, opacity: 0.7 }}>▾</span>
                            </button>
                            {showCreateDropdown && (
                                <div
                                    style={{ position: 'absolute', top: '110%', right: 0, zIndex: 300, background: dm ? '#1a1a2e' : 'white', border: `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.22)', minWidth: 170, overflow: 'hidden' }}
                                    onMouseLeave={() => setShowCreateDropdown(false)}
                                >
                                    {[
                                        { icon: '👥', label: 'Создать группу', action: () => { setShowCreateDropdown(false); setShowCreateGroup(true); } },
                                        { icon: '📢', label: 'Создать канал', action: () => { setShowCreateDropdown(false); setShowCreateChannel(true); } },
                                        { icon: theme.darkMode ? '☀️' : '🌙', label: theme.darkMode ? 'Светлая тема' : 'Тёмная тема', action: () => { setShowCreateDropdown(false); onThemeChange({ ...theme, darkMode: !theme.darkMode }); } },
                                    ].map(item => (
                                        <div
                                            key={item.label}
                                            onClick={item.action}
                                            style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: dm ? '#e0e0f0' : '#1e1b4b', fontWeight: 500 }}
                                            onMouseEnter={e => (e.currentTarget.style.background = dm ? 'rgba(99,102,241,0.1)' : '#f5f3ff')}
                                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        >
                                            <span style={{ fontSize: 15 }}>{item.icon}</span>
                                            {item.label}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>}
                </div>

                {/* Sidebar search */}
                {!sidebarCompact && <div style={{ padding: '8px 10px', borderBottom: `1px solid ${dm ? 'rgba(99,102,241,0.15)' : '#ede9fe'}`, position: 'relative' }}>
                    <input
                        type="text"
                        placeholder="🔍 Поиск пользователей..."
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
                            if (!q.trim()) { setSidebarSearchResults([]); setSidebarChannelResults([]); return; }
                            sidebarSearchTimerRef.current = setTimeout(async () => {
                                setSidebarSearchLoading(true);
                                try {
                                    const [userRes, chanRes] = await Promise.all([
                                        api.searchUsers(token, q.trim()),
                                        api.searchChannels(token, q.trim()),
                                    ]);
                                    setSidebarSearchResults(userRes.users || []);
                                    setSidebarChannelResults(chanRes.channels || []);
                                } catch { setSidebarSearchResults([]); setSidebarChannelResults([]); }
                                finally { setSidebarSearchLoading(false); }
                            }, 300);
                        }}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '7px 12px', borderRadius: 10, border: `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, background: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#e0e0f0' : '#1e1b4b', fontSize: 13, outline: 'none' }}
                    />
                    {sidebarSearchFocused && (sidebarSearchResults.length > 0 || sidebarChannelResults.length > 0 || sidebarSearchLoading || (!sidebarSearchQuery && (searchHistory.length > 0 || recentUsers.length > 0))) && (
                        <div style={{ position: 'absolute', top: '100%', left: 10, right: 10, zIndex: 200, background: dm ? '#1a1a2e' : 'white', border: `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden', maxHeight: 420, overflowY: 'auto' }}>
                            {sidebarSearchQuery ? (
                                <>
                                    {sidebarSearchLoading && (
                                        <div style={{ padding: '10px 12px', fontSize: 13, color: dm ? '#5a5a8a' : '#9ca3af', textAlign: 'center' }}>Поиск...</div>
                                    )}
                                    {!sidebarSearchLoading && sidebarSearchResults.length === 0 && sidebarChannelResults.length === 0 && (
                                        <div style={{ padding: '10px 12px', fontSize: 13, color: dm ? '#5a5a8a' : '#9ca3af', textAlign: 'center' }}>Не найдено</div>
                                    )}
                                    {sidebarChannelResults.length > 0 && (
                                        <>
                                            <div style={{ padding: '6px 12px 4px', fontSize: 11, fontWeight: 600, color: dm ? '#5a5a8a' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Каналы</div>
                                            {sidebarChannelResults.map(ch => (
                                                <div key={ch.id} onMouseDown={() => { openChannelPreview(ch); setSidebarSearchQuery(''); setSidebarSearchResults([]); setSidebarChannelResults([]); setSidebarSearchFocused(false); }}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: ch.avatar ? (dm ? '#13131f' : '#f7f8fc') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
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
                                                        <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{ch.channel_tag ? `@${ch.channel_tag}` : ''}{ch.member_count ? ` · ${formatMembers(ch.member_count, 'subscriber')}` : ''}</div>
                                                    </div>
                                                    {ch.is_member ? <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>✓</span> : null}
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {sidebarSearchResults.length > 0 && (
                                        <>
                                            {sidebarChannelResults.length > 0 && <div style={{ padding: '6px 12px 4px', fontSize: 11, fontWeight: 600, color: dm ? '#5a5a8a' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Пользователи</div>}
                                            {sidebarSearchResults.map(u => (
                                                <div key={u.id} onMouseDown={() => { addToSearchHistory(u); setSelectedUserForProfile(u); setSidebarSearchQuery(''); setSidebarSearchResults([]); setSidebarChannelResults([]); setSidebarSearchFocused(false); }}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: u.avatar ? (dm ? '#13131f' : '#f7f8fc') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                                        <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{u.tag ? `@${u.tag}` : ((users.find(lu => lu.id === u.id) ?? u).is_online ? '🟢 в сети' : 'не в сети')}</div>
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
                                                <span>История</span>
                                                <button onMouseDown={e => { e.preventDefault(); setSearchHistory([]); localStorage.removeItem('userSearchHistory'); }}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: dm ? '#5a5a8a' : '#9ca3af', padding: '0 2px' }}>Очистить</button>
                                            </div>
                                            {searchHistory.map(u => (
                                                <div key={u.id} onMouseDown={() => { addToSearchHistory(u); setSelectedUserForProfile(u); setSidebarSearchFocused(false); }}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: u.avatar ? (dm ? '#13131f' : '#f7f8fc') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                                        <div style={{ fontSize: 11, color: (users.find(lu => lu.id === u.id) ?? u).is_online ? '#22c55e' : (dm ? '#5a5a8a' : '#9ca3af') }}>{(users.find(lu => lu.id === u.id) ?? u).is_online ? '🟢 в сети' : 'не в сети'}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                    {recentUsers.length > 0 && (
                                        <>
                                            <div style={{ padding: '6px 12px 4px', fontSize: 11, fontWeight: 600, color: dm ? '#5a5a8a' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Новые пользователи</div>
                                            {recentUsers.slice(0, 3).map(u => (
                                                <div key={u.id} onMouseDown={() => { addToSearchHistory(u); setSelectedUserForProfile(u); setSidebarSearchFocused(false); }}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: u.avatar ? (dm ? '#13131f' : '#f7f8fc') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                                        <div style={{ fontSize: 11, color: (users.find(lu => lu.id === u.id) ?? u).is_online ? '#22c55e' : (dm ? '#5a5a8a' : '#9ca3af') }}>{(users.find(lu => lu.id === u.id) ?? u).is_online ? '🟢 в сети' : 'не в сети'}</div>
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

                {/* Folder tabs */}
                {!sidebarCompact && folders.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${dm ? 'rgba(99,102,241,0.15)' : '#ede9fe'}` }}>
                        <button onClick={() => { if (folderTabsRef.current) folderTabsRef.current.scrollLeft -= 120; }}
                            style={{ flexShrink: 0, width: 24, height: '100%', background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', fontSize: 14, padding: '0 2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                    <div ref={folderTabsRef} style={{ display: 'flex', overflowX: 'auto', gap: 4, padding: '6px 4px', flex: 1, scrollbarWidth: 'thin', scrollbarColor: dm ? '#3a3a5e transparent' : '#c4b5fd transparent' }}>
                        <button
                            onClick={() => setActiveFolder(null)}
                            style={{ flexShrink: 0, padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                background: activeFolder === null ? '#6366f1' : (dm ? 'rgba(99,102,241,0.12)' : '#f0f0ff'),
                                color: activeFolder === null ? 'white' : (dm ? '#a5b4fc' : '#6366f1') }}
                        >Все</button>
                        {folders.map(f => {
                            const folderUnread = f.chats.reduce((sum, c) => sum + (unreadCounts[`${c.chat_type}-${c.chat_id}`] || 0), 0);
                            return (
                            <button key={f.id}
                                onClick={() => setActiveFolder(f.id)}
                                onContextMenu={e => { e.preventDefault(); setFolderCtxMenu({ x: e.clientX, y: e.clientY, folderId: f.id }); }}
                                style={{ flexShrink: 0, padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                    background: activeFolder === f.id ? f.color : (dm ? 'rgba(99,102,241,0.12)' : '#f0f0ff'),
                                    color: activeFolder === f.id ? 'white' : (dm ? '#a5b4fc' : '#6366f1'),
                                    display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                                {f.name}
                                {folderUnread > 0 && <span style={{ background: activeFolder === f.id ? 'rgba(255,255,255,0.3)' : f.color, color: 'white', fontSize: 10, fontWeight: 700, borderRadius: 8, padding: '1px 5px', lineHeight: 1.4 }}>{folderUnread > 99 ? '99+' : folderUnread}</span>}
                            </button>
                            );
                        })}
                    </div>
                        <button onClick={() => { if (folderTabsRef.current) folderTabsRef.current.scrollLeft += 120; }}
                            style={{ flexShrink: 0, width: 24, height: '100%', background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', fontSize: 14, padding: '0 2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                    </div>
                )}

                <div style={darkStyles.sidebarScroll} onClick={() => pinMenu && setPinMenu(null)}>

                    {/* Saved Messages */}
                    <div
                        onClick={() => {
                            saveDraft(activeChatRef.current);
                            restoreDraft(`private-${currentUserId}`);
                            setReplyTo(null);
                            setActiveChat({ type: 'private', id: currentUserId, name: '⭐ Избранные' });
                            loadPrivateMessages(currentUserId);
                        }}
                        onContextMenu={e => { e.preventDefault(); setPinMenu({ x: e.clientX, y: e.clientY, key: `private-${currentUserId}` }); }}
                        className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}
                        style={{
                            ...darkStyles.chatItem,
                            ...(activeChat?.type === 'private' && activeChat.id === currentUserId ? darkStyles.activeChatItem : {}),
                            ...(sidebarCompact ? { justifyContent: 'center', padding: '6px 0' } : {}),
                        }}
                    >
                        <div style={{ ...styles.avatar, background: dm ? 'linear-gradient(135deg, #312e81 0%, #6c47d4 100%)' : 'linear-gradient(135deg, #6366f1 0%, #a78bfa 100%)', fontSize: 18, flexShrink: 0 }}>⭐</div>
                        {!sidebarCompact && <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                            <div style={{ ...darkStyles.chatName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Избранные</div>
                            <div style={styles.chatSub}>Сохранённые сообщения</div>
                        </div>}
                    </div>

                    {(() => {
                        const folder = activeFolder !== null ? folders.find(f => f.id === activeFolder) : null;
                        const folderGroupIds = folder ? new Set(folder.chats.filter(c => c.chat_type === 'group').map(c => c.chat_id)) : null;
                        const visibleGroups = folderGroupIds ? groups.filter(g => folderGroupIds.has(g.id)) : groups;
                        const sortedGroups = [...visibleGroups].sort((a, b) => {
                            const ap = pinnedChats.has(`group-${a.id}`) ? 1 : 0;
                            const bp = pinnedChats.has(`group-${b.id}`) ? 1 : 0;
                            return bp - ap;
                        });
                        if (sortedGroups.length === 0) return null;
                        return (
                        <div>
                            {sortedGroups.map(group => (
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
                                        <div style={{ ...styles.avatar, backgroundColor: group.avatar ? (dm ? '#13131f' : '#f7f8fc') : '#6366f1', overflow: 'hidden' }}>
                                            {group.avatar
                                                ? <img src={config.fileUrl(group.avatar) ?? undefined} alt={group.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : <span style={{ fontSize: 18, color: 'white', fontWeight: 700 }}>{group.name[0]?.toUpperCase()}</span>
                                            }
                                        </div>
                                        {pinnedChats.has(`group-${group.id}`) && (
                                            <div style={{ position: 'absolute', top: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: dm ? '#1e1e30' : 'white', border: `1.5px solid ${dm ? '#13131f' : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, lineHeight: 1, zIndex: 2 }}>📌</div>
                                        )}
                                        {mutedChats.has(`group-${group.id}`)
                                            ? <div style={{ position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: '50%', background: dm ? '#2a2a3a' : '#e0e0e0', border: `1.5px solid ${dm ? '#13131f' : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, lineHeight: 1 }}>🔕</div>
                                            : group.is_channel
                                                ? <div style={{ position: 'absolute', bottom: 1, right: 1, width: 14, height: 14, borderRadius: '50%', background: dm ? '#1e1e30' : 'white', border: `1.5px solid ${dm ? '#13131f' : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, lineHeight: 1 }}>📢</div>
                                                : <div style={{ position: 'absolute', bottom: 1, right: 1, width: 14, height: 14, borderRadius: '50%', background: dm ? '#1e1e30' : 'white', border: `1.5px solid ${dm ? '#13131f' : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <svg width="9" height="9" viewBox="0 0 16 16" fill={dm ? '#a5b4fc' : '#6366f1'}><path d="M8 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6a5 5 0 0 1 10 0H3zm10-9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm2 5a3 3 0 0 0-4-2.83A6 6 0 0 1 14 16h2a4 4 0 0 0-1-2.71z"/></svg>
                                                </div>
                                        }
                                    </div>
                                    {!sidebarCompact && <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                                            <div style={{ ...darkStyles.chatName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</span>
                                                {!!group.is_channel && group.channel_tag === 'auroramessenger' && (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', flexShrink: 0 }}>
                                                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M2 6.5L4.5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                    </span>
                                                )}
                                            </div>
                                            {group.last_msg_time && <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap' }}>{formatSidebarTime(group.last_msg_time)}</div>}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0, height: 18 }}>
                                            {(() => {
                                                const typing = typingChats[`group-${group.id}`];
                                                const senderLabel = group.is_channel ? '' : (group.last_msg_sender_id === currentUserId ? 'Вы: ' : group.last_msg_sender_name ? `${group.last_msg_sender_name}: ` : '');
                                                return renderSidebarSub(
                                                    typing ? `✍️ ${typing} печатает...` : undefined,
                                                    group.last_msg_text, group.last_msg_file, group.last_msg_filename,
                                                    group.last_msg_time ? '' : (group.member_count ? formatMembers(group.member_count, group.is_channel ? 'subscriber' : 'member') : ''),
                                                    group.last_msg_time ? senderLabel : undefined
                                                );
                                            })()}
                                        </div>
                                    </div>}
                                    {unreadCounts[`group-${group.id}`] > 0 && (
                                        sidebarCompact
                                            ? <div style={{ position: 'absolute', top: 4, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#6366f1', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                                                {unreadCounts[`group-${group.id}`] > 99 ? '99+' : unreadCounts[`group-${group.id}`]}
                                            </div>
                                            : <div style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#6366f1', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0 }}>
                                                {unreadCounts[`group-${group.id}`] > 99 ? '99+' : unreadCounts[`group-${group.id}`]}
                                            </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        );
                    })()}

                    <div>
                        {(() => {
                            const folder = activeFolder !== null ? folders.find(f => f.id === activeFolder) : null;
                            const folderUserIds = folder ? new Set(folder.chats.filter(c => c.chat_type === 'private').map(c => c.chat_id)) : null;
                            const visibleUsers = folderUserIds ? users.filter(u => folderUserIds.has(u.id)) : users;
                            return [...visibleUsers].sort((a, b) => {
                                const ap = pinnedChats.has(`private-${a.id}`) ? 1 : 0;
                                const bp = pinnedChats.has(`private-${b.id}`) ? 1 : 0;
                                return bp - ap;
                            });
                        })().map(user => (
                            <div
                                key={`u-${user.id}`}
                                onClick={() => selectPrivateChat(user)}
                                onContextMenu={e => { e.preventDefault(); setPinMenu({ x: e.clientX, y: e.clientY, key: `private-${user.id}` }); }}
                                className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}
                                style={{
                                    ...darkStyles.chatItem,
                                    ...(activeChat?.type === 'private' && activeChat.id === user.id ? darkStyles.activeChatItem : {}),
                                    ...(sidebarCompact ? { justifyContent: 'center', padding: '6px 0' } : {}),
                                    position: 'relative',
                                }}
                            >
                                <div style={{ position: 'relative', flexShrink: 0 }}>
                                    <div style={{ ...styles.avatar, backgroundColor: user.avatar ? (dm ? '#13131f' : '#f7f8fc') : '#6366f1', overflow: 'hidden' }}>
                                        {user.avatar
                                            ? <img src={config.fileUrl(user.avatar) ?? undefined} alt={user.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            : user.username[0].toUpperCase()
                                        }
                                    </div>
                                    {pinnedChats.has(`private-${user.id}`) && (
                                        <div style={{ position: 'absolute', top: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: dm ? '#1e1e30' : 'white', border: `1.5px solid ${dm ? '#13131f' : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, lineHeight: 1, zIndex: 2 }}>📌</div>
                                    )}
                                    {(users.find(lu => lu.id === user.id) ?? user).is_online && <div style={{ position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: '50%', background: '#22c55e', border: `2px solid ${dm ? '#13131f' : 'white'}` }} />}
                                    {mutedChats.has(`private-${user.id}`) && <div style={{ position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: '50%', background: dm ? '#2a2a3a' : '#e0e0e0', border: `1.5px solid ${dm ? '#13131f' : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, lineHeight: 1 }}>🔕</div>}
                                </div>
                                {!sidebarCompact && <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                                        <div style={{ ...darkStyles.chatName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.username}</span>
                                            {(user.tag === 'kayano' || user.tag === 'durov') && <span title="разработчик Aurora" style={{ fontSize: 12, flexShrink: 0, cursor: 'default', lineHeight: 1 }}>🔧</span>}
                                        </div>
                                        {user.last_msg_time && <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', flexShrink: 0, whiteSpace: 'nowrap' }}>{formatSidebarTime(user.last_msg_time)}</div>}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0, height: 18 }}>
                                        {renderSidebarSub(
                                            typingChats[`private-${user.id}`] ? '✍️ печатает...' : undefined,
                                            user.last_msg_text, user.last_msg_file, user.last_msg_filename,
                                            user.last_msg_time ? '' : (user.is_online ? '🟢 в сети' : user.last_seen === 'hidden' ? 'был(а) недавно' : user.last_seen ? `был(а) ${formatLastSeen(user.last_seen)}` : user.status || 'личный чат')
                                        )}
                                    </div>
                                </div>}
                                {unreadCounts[`private-${user.id}`] > 0 && (
                                    sidebarCompact
                                        ? <div style={{ position: 'absolute', top: 4, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#6366f1', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                                            {unreadCounts[`private-${user.id}`] > 99 ? '99+' : unreadCounts[`private-${user.id}`]}
                                        </div>
                                        : <div style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#6366f1', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0 }}>
                                            {unreadCounts[`private-${user.id}`] > 99 ? '99+' : unreadCounts[`private-${user.id}`]}
                                        </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Profile card */}
                <div style={{ ...darkStyles.profileCard, ...(sidebarCompact ? { justifyContent: 'center', padding: '8px 0' } : {}) }}>
                    <div style={{ ...styles.profileAvatar, backgroundColor: currentUserAvatar ? (dm ? '#13131f' : '#f7f8fc') : avatarBg }} onClick={() => setShowSettings(true)}>
                        {currentUserAvatar
                            ? <img src={config.fileUrl(currentUserAvatar) ?? undefined} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                            : <span style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>{currentUsername[0]?.toUpperCase()}</span>
                        }
                    </div>
                    {!sidebarCompact && <>
                        <div style={styles.profileInfo}>
                            <div style={{ ...darkStyles.profileName, display: 'flex', alignItems: 'center', gap: 4 }}>
                                {currentUsername}
                                {(currentUserTag === 'kayano' || currentUserTag === 'durov') && <span title="разработчик Aurora" style={{ fontSize: 12, cursor: 'default', lineHeight: 1 }}>🔧</span>}
                            </div>
                            {currentUserTag && <div style={styles.profileStatus}>@{currentUserTag}</div>}
                        </div>
                        <button onClick={() => setShowFolderManager(true)} style={{ ...styles.settingsBtn, marginRight: 4 }} title="Папки">📁</button>
                        <button onClick={() => setShowSettings(true)} style={styles.settingsBtn} title="Настройки">⚙️</button>
                    </>}
                </div>
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
                {showMediaPanel && activeChat && (
                    <ChatMediaPanel
                        messages={messages}
                        isDark={theme.darkMode}
                        onClose={() => setShowMediaPanel(false)}
                        onGoToMessage={goToMessage}
                    />
                )}
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
                            <div style={{ fontSize: 48 }}>📎</div>
                            <div style={{ fontSize: 16, fontWeight: 600, color: '#6366f1', marginTop: 8 }}>Отпустите для отправки</div>
                        </div>
                    </div>
                )}
                {activeChat ? (
                    <>
                        {/* Шапка */}
                        <div style={darkStyles.chatHeader}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                                {/* Аватар активного чата */}
                                {(() => {
                                    const isSelf = activeChat.type === 'private' && activeChat.id === currentUserId;
                                    const chatUser = activeChat.type === 'private' ? users.find(u => u.id === activeChat.id) : null;
                                    const chatGroup = activeChat.type === 'group' ? groups.find(g => g.id === activeChat.id) : null;
                                    const bg = isSelf ? '#f0a500' : activeChat.type === 'group' ? '#6366f1' : (chatUser?.avatar_color || '#1a73e8');
                                    const src = isSelf ? null : chatUser?.avatar ? config.fileUrl(chatUser.avatar) : chatGroup?.avatar ? config.fileUrl(chatGroup.avatar) : null;
                                    const initial = isSelf ? '⭐' : activeChat.name[0]?.toUpperCase();
                                    const canClick = activeChat.type === 'private' && !isSelf;
                                    const canClickGroup = activeChat.type === 'group';
                                    return (
                                        <div
                                            style={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: src ? 'transparent' : bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, cursor: (canClick || canClickGroup) ? 'pointer' : 'default', boxShadow: `0 0 14px ${bg}66` }}
                                            onClick={() => {
                                                if (canClick) { const u = users.find(u => u.id === activeChat.id); if (u) setSelectedUserForProfile(u); }
                                                if (canClickGroup) { setSelectedGroupId(activeChat.id); setShowGroupInfo(true); }
                                            }}
                                        >
                                            {src
                                                ? <img src={src} alt={activeChat.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : <span style={{ color: 'white', fontSize: isSelf ? 22 : 18, fontWeight: 700 }}>{initial}</span>
                                            }
                                        </div>
                                    );
                                })()}
                                {chatSearchOpen ? (
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                        <input
                                            ref={chatSearchInputRef}
                                            autoFocus
                                            value={chatSearchQuery}
                                            onChange={e => { setChatSearchQuery(e.target.value); setChatSearchIdx(0); }}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') { e.preventDefault(); goToChatSearchMatch(chatSearchIdx + (e.shiftKey ? -1 : 1)); }
                                                if (e.key === 'Escape') { setChatSearchOpen(false); setChatSearchQuery(''); }
                                            }}
                                            placeholder="Поиск в чате..."
                                            style={{ flex: 1, padding: '7px 12px', borderRadius: 10, border: `1.5px solid ${dm ? '#3a3a55' : '#dddde8'}`, background: dm ? '#1e1e30' : '#eef0f8', color: dm ? '#e2e8f0' : '#1e1b4b', fontSize: 14, outline: 'none', minWidth: 0 }}
                                        />
                                        {chatSearchQuery.trim() && (
                                            <span style={{ fontSize: 12, color: dm ? '#7c7caa' : '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                {chatSearchMatches.length > 0 ? `${chatSearchIdx + 1} / ${chatSearchMatches.length}` : '0 результатов'}
                                            </span>
                                        )}
                                        <button onClick={() => goToChatSearchMatch(chatSearchIdx - 1)} disabled={chatSearchMatches.length === 0} style={{ ...darkStyles.iconBtn, fontSize: 11 }} title="Предыдущий (Shift+Enter)">▲</button>
                                        <button onClick={() => goToChatSearchMatch(chatSearchIdx + 1)} disabled={chatSearchMatches.length === 0} style={{ ...darkStyles.iconBtn, fontSize: 11 }} title="Следующий (Enter)">▼</button>
                                        <button onClick={() => { setChatSearchOpen(false); setChatSearchQuery(''); }} style={darkStyles.iconBtn} title="Закрыть поиск">✕</button>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ minWidth: 0, overflow: 'hidden', cursor: 'pointer' }}
                                            onClick={() => setShowMediaPanel(p => !p)}
                                            title="Медиа и файлы">
                                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: dm ? '#e2e8f0' : '#1e1b4b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {activeChat.name}
                                                {activeChat.type === 'private' && (() => { const t = users.find(u => u.id === activeChat.id)?.tag; return (t === 'kayano' || t === 'durov') && <span title="разработчик Aurora" style={{ fontSize: 15, flexShrink: 0, cursor: 'default' }}>🔧</span>; })()}
                                                {!!isChannelChat && activeGroup?.channel_tag === 'auroramessenger' && (
                                                    <span title="Официальный канал Aurora" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', flexShrink: 0 }}>
                                                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6.5L4.5 9L10 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                    </span>
                                                )}
                                            </h3>
                                            <div style={{ fontSize: 12, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 2 }}>
                                                {activeChat.type === 'group'
                                                    ? (() => { const cnt = activeGroup?.member_count; return cnt ? formatMembers(cnt, activeGroup?.is_channel ? 'subscriber' : 'member') : ''; })()
                                                    : activeChat.id === currentUserId
                                                    ? 'сохранённые сообщения'
                                                    : (() => {
                                                        const u = users.find(u => u.id === activeChat.id);
                                                        if (!u) return 'личный чат';
                                                        if (u.is_online) return 'в сети';
                                                        if (u.last_seen === 'hidden') return 'был(а) недавно';
                                                        if (u.last_seen) return `был(а) ${formatLastSeen(u.last_seen)}`;
                                                        return u.status || 'личный чат';
                                                    })()
                                                }
                                            </div>
                                        </div>
                                        {typingUser && (
                                            <span style={styles.typing}>
                                                <span style={{ fontWeight: 600, fontStyle: 'normal' }}>{typingUser}</span> печатает...
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={cycleSidebar} style={darkStyles.iconBtn} title={sidebarState === 'full' ? 'Компактный режим' : sidebarState === 'compact' ? 'Скрыть панель' : 'Показать панель'}>
                                    {sidebarState === 'full' ? '◀' : sidebarState === 'compact' ? '⊟' : '▶'}
                                </button>
                                <button onClick={() => { setChatSearchOpen(p => !p); setChatSearchQuery(''); setChatSearchIdx(0); }} style={{ ...darkStyles.iconBtn, ...(chatSearchOpen ? { background: dm ? 'rgba(99,102,241,0.2)' : '#ede9fe', color: '#6366f1' } : {}) }} title="Поиск в чате">🔍</button>
                                {(activeChat.type === 'private' || isGroupAdmin) && (
                                    <button onClick={handleClearChat} style={darkStyles.iconBtn} title="Очистить чат">🗑️</button>
                                )}
                                {activeChat.type === 'group' && isGroupAdmin && !isChannelChat && (
                                    <button onClick={() => { setSelectedGroupId(activeChat.id); setShowInviteModal(true); }} style={darkStyles.iconBtn} title="Пригласить">➕</button>
                                )}
                            </div>
                        </div>


                        {/* Mini player */}
                        {nowPlaying && (() => {
                            const mpBg = dm ? '#1a1a2e' : 'white';
                            const mpBorder = dm ? 'rgba(99,102,241,0.2)' : '#ede9fe';
                            const mpText = dm ? 'white' : '#1e1b4b';
                            const mpSub = dm ? 'rgba(255,255,255,0.4)' : '#9ca3af';
                            const mpTrack = dm ? 'rgba(255,255,255,0.12)' : '#ddd9f7';
                            const mpBtn = dm ? 'rgba(255,255,255,0.08)' : '#f5f3ff';
                            const mpBtnColor = dm ? 'rgba(255,255,255,0.6)' : '#6366f1';
                            return (
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
                                    background: mpBg,
                                    borderBottom: `1px solid ${mpBorder}`,
                                    flexShrink: 0,
                                }}>
                                    <button onClick={prevTrack} style={{ background: 'none', border: 'none', color: mpBtnColor, cursor: 'pointer', fontSize: 15, padding: '0 2px' }}>⏮</button>
                                    <button onClick={toggleGlobalPlay} style={{ background: '#6366f1', border: 'none', color: 'white', cursor: 'pointer', fontSize: 14, width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        {globalPlaying ? '⏸' : '▶'}
                                    </button>
                                    <button onClick={nextTrack} style={{ background: 'none', border: 'none', color: mpBtnColor, cursor: 'pointer', fontSize: 15, padding: '0 2px' }}>⏭</button>
                                    <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={seekGlobal}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: mpText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{/^voice_/i.test(nowPlaying.filename) ? '🎤 Голосовое сообщение' : nowPlaying.filename}</div>
                                        <div style={{ height: 3, borderRadius: 3, background: mpTrack, position: 'relative' }}>
                                            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 3, background: '#6366f1', width: globalDuration ? `${(globalCurrentTime / globalDuration) * 100}%` : '0%', transition: 'width 0.2s linear' }} />
                                        </div>
                                    </div>
                                    <span style={{ fontSize: 11, color: mpSub, whiteSpace: 'nowrap' }}>
                                        {`${Math.floor(globalCurrentTime / 60)}:${String(Math.floor(globalCurrentTime % 60)).padStart(2,'0')}`}
                                        {globalDuration > 0 && ` / ${Math.floor(globalDuration / 60)}:${String(Math.floor(globalDuration % 60)).padStart(2,'0')}`}
                                    </span>
                                    <button onClick={stopGlobal} style={{ background: mpBtn, border: 'none', color: mpBtnColor, cursor: 'pointer', fontSize: 15, width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                                </div>
                            );
                        })()}

                        {/* Закреплённое сообщение */}
                        {(() => {
                            const chatKey = `${activeChat.type}-${activeChat.id}`;
                            const pinned = pinnedMessages[chatKey];
                            if (!pinned) return null;
                            return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', background: dm ? '#181828' : '#f5f3ff', borderBottom: `1px solid ${dm ? 'rgba(99,102,241,0.18)' : '#ede9fe'}`, cursor: 'pointer', flexShrink: 0 }}
                                    onClick={() => { const el = document.getElementById(`msg-${pinned.id}`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.transition = 'background 0.3s'; el.style.background = 'rgba(99,102,241,0.18)'; setTimeout(() => { el.style.background = ''; }, 1500); } }}>
                                    <div style={{ width: 3, height: 32, borderRadius: 2, background: '#6366f1', flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: '#6366f1' }}>📌 Закреплённое</div>
                                        <div style={{ fontSize: 12, color: dm ? '#9090b0' : '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pinned.text}</div>
                                    </div>
                                    <button onClick={e => { e.stopPropagation(); togglePinMessage(`${activeChat.type}-${activeChat.id}`, { id: pinned.id, message_text: pinned.text }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#aaa', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>✕</button>
                                </div>
                            );
                        })()}

                        {/* Сообщения */}
                        <div key={`${activeChat.type}-${activeChat.id}`} className="panel-slide-in" style={{ ...styles.messagesArea, backgroundColor: dm ? '#0f0f1a' : '#f2f4f8', overflowAnchor: 'none', paddingRight: (isChannelChat && commentPostId !== null) ? 354 : 24 }}>
                            {(() => {
                                const filtered = messages.filter(m => !m.is_deleted);
                                let lastDay = '';
                                const items: React.ReactNode[] = [];
                                filtered.forEach(msg => {
                                    const day = getMsgDay(msg.timestamp);
                                    if (day && day !== lastDay) {
                                        lastDay = day;
                                        items.push(
                                            <div key={`sep-${day}`} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
                                                <div style={{ flex: 1, height: 1, backgroundColor: dm ? '#3a3a4a' : '#e0e0e0' }} />
                                                <span style={{ fontSize: 11, color: dm ? '#888' : '#aaa', whiteSpace: 'nowrap', padding: '2px 10px', backgroundColor: dm ? '#2a2a3a' : '#efefef', borderRadius: 10 }}>
                                                    {getDateLabel(msg.timestamp)}
                                                </span>
                                                <div style={{ flex: 1, height: 1, backgroundColor: dm ? '#3a3a4a' : '#e0e0e0' }} />
                                            </div>
                                        );
                                    }
                                    if ((msg as any).is_system) {
                                        items.push(
                                            <div key={msg.id} className="msg-in" style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                                                <span style={{ fontSize: 12, color: dm ? '#888' : '#aaa', backgroundColor: dm ? '#2a2a3a' : '#efefef', padding: '3px 12px', borderRadius: 10 }}>
                                                    {msg.message_text}
                                                </span>
                                            </div>
                                        );
                                        return;
                                    }

                                    // === Channel post rendering ===
                                    if (isChannelChat) {
                                        if ((msg as any).reply_to_id) return; // skip comments, shown in panel
                                        const commentCount = messages.filter(m => (m as any).reply_to_id === msg.id && !m.is_deleted).length;
                                        const isActive = commentPostId === msg.id;
                                        const senderName = activeGroup?.name || (msg as any).sender_name || currentUsername;
                                        const avatarSrc = activeGroup?.avatar ? config.fileUrl(activeGroup.avatar) : null;
                                        const filesArr: any[] = (() => { try { const f = (msg as any).files; return f ? (typeof f === 'string' ? JSON.parse(f) : f) : []; } catch { return []; } })();
                                        const isImgFile = (n: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test(n);
                                        items.push(
                                            <div key={msg.id} id={`msg-${msg.id}`} className="msg-in"
                                                onMouseEnter={() => setHoveredMsgId(msg.id)}
                                                onMouseLeave={() => setHoveredMsgId(null)}
                                                style={{ position: 'relative', margin: '0 auto 10px auto', maxWidth: 600, background: dm ? (isActive ? '#1e1e40' : '#16162a') : (isActive ? '#f0eeff' : 'white'), borderRadius: 14, border: `1.5px solid ${isActive ? '#6366f1' : (dm ? 'rgba(99,102,241,0.15)' : '#ede9fe')}`, padding: '12px 14px', boxShadow: isActive ? '0 0 0 2px rgba(99,102,241,0.25)' : '0 2px 8px rgba(0,0,0,0.06)', transition: 'all 0.18s' }}>
                                                {/* Post header */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarSrc ? (dm ? '#16162a' : 'white') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'white', fontSize: 13, overflow: 'hidden', flexShrink: 0 }}>
                                                        {avatarSrc ? <img src={avatarSrc} alt={senderName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : senderName[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontWeight: 700, fontSize: 14, color: dm ? '#e0e0f0' : '#1e1b4b' }}>{senderName}</div>
                                                        <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{new Date(msg.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{msg.edited_at && <span style={{ marginLeft: 6, color: dm ? '#5a5a8a' : '#bbb' }}>изм.</span>}</div>
                                                    </div>
                                                    {/* Hover action buttons */}
                                                    {(isGroupAdmin || msg.sender_id === currentUserId) && hoveredMsgId === msg.id && editingMessageId !== msg.id && (
                                                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                                            {(isGroupAdmin || msg.sender_id === currentUserId) && (
                                                                <button onClick={e => { e.stopPropagation(); handleEdit(msg.id, msg.message_text ?? ''); }}
                                                                    style={{ background: dm ? 'rgba(99,102,241,0.15)' : '#f0eeff', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: '#6366f1', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Редактировать">✏️</button>
                                                            )}
                                                            {(isGroupAdmin || msg.sender_id === currentUserId) && (
                                                                <button onClick={e => { e.stopPropagation(); handleDelete(msg.id); }}
                                                                    style={{ background: dm ? 'rgba(239,68,68,0.1)' : '#fff0f0', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: '#f87171', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Удалить">🗑️</button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Post content / edit mode */}
                                                {editingMessageId === msg.id ? (
                                                    <div onClick={e => e.stopPropagation()}>
                                                        <textarea
                                                            autoFocus
                                                            value={editingText}
                                                            onChange={e => setEditingText(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSubmit(msg.id); }
                                                                if (e.key === 'Escape') { setEditingMessageId(null); setEditingText(''); }
                                                            }}
                                                            rows={Math.min(8, (editingText.match(/\n/g)?.length || 0) + 2)}
                                                            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid #6366f1`, fontSize: 14, outline: 'none', resize: 'none', fontFamily: 'inherit', backgroundColor: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#e0e0f0' : '#1e1b4b', boxSizing: 'border-box' as const, marginBottom: 8 }}
                                                        />
                                                        <div style={{ display: 'flex', gap: 8 }}>
                                                            <button onClick={() => handleEditSubmit(msg.id)} style={{ flex: 1, padding: '7px 0', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>✓ Сохранить</button>
                                                            <button onClick={() => { setEditingMessageId(null); setEditingText(''); }} style={{ padding: '7px 14px', background: 'none', border: `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, color: dm ? '#9090b0' : '#6b7280', borderRadius: 10, cursor: 'pointer', fontSize: 13 }}>Отмена</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {filesArr.length > 0 && (
                                                            <div style={{ marginBottom: msg.message_text ? 8 : 0 }}>
                                                                {filesArr.filter((f: any) => isImgFile(f.filename || '')).length > 0
                                                                    ? <ImageGrid images={filesArr.filter((f: any) => isImgFile(f.filename || '')).map((f: any) => ({ url: f.file_path?.startsWith('http') ? f.file_path : `${BASE_URL}${f.file_path}`, name: f.filename || '' }))} />
                                                                    : filesArr.map((f: any, i: number) => <FileMessage key={i} filePath={f.file_path} filename={f.filename || ''} fileSize={f.file_size} isOwn={false} isDark={dm} />)
                                                                }
                                                            </div>
                                                        )}
                                                        {!filesArr.length && msg.file_path && <FileMessage filePath={msg.file_path} filename={msg.filename || ''} fileSize={msg.file_size} isOwn={false} isDark={dm} />}
                                                        {msg.message_text && <div style={{ fontSize: 14, color: dm ? '#d0d0e8' : '#374151', lineHeight: 1.55, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{msg.message_text}</div>}
                                                    </>
                                                )}
                                                {/* Footer: reactions + comment button */}
                                                {editingMessageId !== msg.id && (
                                                    <div style={{ marginTop: 8, borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.15)' : '#ede9fe'}`, paddingTop: 8 }}>
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
                                                                        <button key={emoji} onClick={() => {
                                                                            if (userIds.includes(currentUserId)) wsService.removeReaction(msg.id, true, emoji);
                                                                            else wsService.addReaction(msg.id, true, emoji);
                                                                        }} style={{ padding: '3px 8px', borderRadius: 12, border: `1px solid ${userIds.includes(currentUserId) ? '#6366f1' : (dm ? '#3a3a5e' : '#e0e0f0')}`, background: userIds.includes(currentUserId) ? (dm ? 'rgba(99,102,241,0.2)' : '#ede9fe') : (dm ? '#252540' : 'white'), cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                            {emoji}<span style={{ fontSize: 11, color: dm ? '#a5b4fc' : '#6366f1', fontWeight: 600 }}>{userIds.length}</span>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })()}
                                                        {/* Action buttons row */}
                                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                            <button
                                                                onClick={() => setCommentPostId(isActive ? null : msg.id)}
                                                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8, border: 'none', background: isActive ? 'rgba(99,102,241,0.15)' : (dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'), cursor: 'pointer', color: isActive ? '#6366f1' : (dm ? '#9090b0' : '#6b7280'), fontSize: 13, fontWeight: isActive ? 700 : 400, transition: 'all 0.15s' }}>
                                                                💬 {commentCount > 0 ? `${commentCount} комментар${commentCount === 1 ? 'ий' : commentCount < 5 ? 'ия' : 'иев'}` : 'Комментировать'}
                                                            </button>
                                                            {/* Emoji picker button */}
                                                            <div style={{ position: 'relative', marginLeft: 'auto' }}>
                                                                <button
                                                                    onClick={e => { e.stopPropagation(); setReactionPickerMsgId(p => p === msg.id ? null : msg.id); }}
                                                                    style={{ background: dm ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                    😊
                                                                </button>
                                                                {reactionPickerMsgId === msg.id && (
                                                                    <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: 36, right: 0, background: dm ? '#1e1e30' : 'white', border: `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, borderRadius: 12, padding: 6, display: 'flex', gap: 4, flexWrap: 'wrap', width: 200, zIndex: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
                                                                        {['👍','❤️','😂','😮','😢','😡','🔥','👏','🎉','✅'].map(emoji => (
                                                                            <button key={emoji} onClick={() => {
                                                                                const myReaction = reactions[msg.id]?.find(r => r.user_id === currentUserId && r.emoji === emoji);
                                                                                if (myReaction) wsService.removeReaction(msg.id, true, emoji);
                                                                                else wsService.addReaction(msg.id, true, emoji);
                                                                                setReactionPickerMsgId(null);
                                                                            }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: 2, borderRadius: 6, lineHeight: 1 }}>
                                                                                {emoji}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                        return;
                                    }

                                    const isOwn = msg.sender_id === currentUserId;
                                    const senderAvatar = 'sender_avatar' in msg ? (msg as any).sender_avatar : null;
                                    const isSelected = selectedMsgIds.has(msg.id);
                                    items.push(
                                    <div
                                        key={msg.id}
                                        id={`msg-${msg.id}`}
                                        className={deletingMsgIds.has(msg.id) ? 'msg-delete' : 'msg-in'}
                                        onMouseEnter={() => !selectionMode && setHoveredMsgId(msg.id)}
                                        onMouseLeave={() => { setHoveredMsgId(null); setReactionPickerMsgId(null); }}
                                        onClick={selectionMode ? () => toggleMsgSelection(msg.id) : undefined}
                                        style={{
                                            display: 'flex',
                                            justifyContent: isOwn ? 'flex-end' : 'flex-start',
                                            alignItems: selectionMode ? 'center' : 'flex-end',
                                            gap: 6,
                                            marginBottom: 12,
                                            cursor: selectionMode ? 'pointer' : 'default',
                                            backgroundColor: selectionMode && isSelected
                                                ? (dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.07)')
                                                : (chatSearchQuery.trim() && chatSearchMatches[chatSearchIdx] === msg.id)
                                                ? (dm ? 'rgba(234,179,8,0.15)' : 'rgba(234,179,8,0.12)')
                                                : (chatSearchQuery.trim() && chatSearchMatches.includes(msg.id))
                                                ? (dm ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)')
                                                : 'transparent',
                                            borderRadius: 10,
                                            padding: selectionMode ? '2px 6px' : '0',
                                            transition: 'background-color 0.1s',
                                        }}
                                    >
                                        {selectionMode && (
                                            <div style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', border: `2px solid ${isSelected ? '#6366f1' : (dm ? '#5a5a8a' : '#c4b5fd')}`, backgroundColor: isSelected ? '#6366f1' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', order: 0 }}>
                                                {isSelected && <svg width="12" height="12" viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                            </div>
                                        )}
                                        {!isOwn && activeChat.type === 'group' && (
                                            <div
                                                style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: senderAvatar ? (dm ? '#1a1a2e' : '#f3f4f6') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', fontSize: 12, color: 'white', fontWeight: 700, cursor: 'pointer' }}
                                                onClick={() => setSelectedUserForProfile({ id: msg.sender_id, username: (msg as any).sender_name || '', email: '', created_at: '', avatar: senderAvatar || undefined, avatar_color: (msg as any).sender_avatar_color })}
                                                title={`Профиль ${(msg as any).sender_name}`}
                                            >
                                                {senderAvatar
                                                    ? <img src={config.fileUrl(senderAvatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    : (msg as any).sender_name?.[0]?.toUpperCase() || '?'
                                                }
                                            </div>
                                        )}

                                        <div style={{ position: 'relative', display: 'inline-block', maxWidth: '62%', marginRight: isOwn ? 10 : 0 }}>
                                        <div
                                            onContextMenu={(e) => handleContextMenu(e, msg)}
                                            style={{
                                                maxWidth: '100%',
                                                padding: '10px 14px',
                                                borderRadius: isOwn ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
                                                wordBreak: 'break-word',
                                                fontSize: theme.fontSize,
                                                boxShadow: isOwn ? '0 2px 10px rgba(99,102,241,0.25)' : `0 2px 8px rgba(0,0,0,${dm ? '0.2' : '0.07'})`,
                                                ...(isOwn
                                                    ? { background: `linear-gradient(135deg, ${theme.bubbleOwnColor}, #8b5cf6)`, color: 'white' }
                                                    : {
                                                        backgroundColor: dm
                                                            ? (theme.bubbleOtherColor === '#e8e8e8' ? '#1e1e30' : theme.bubbleOtherColor)
                                                            : theme.bubbleOtherColor,
                                                        color: dm ? '#e2e8f0' : '#1e1b4b'
                                                    }
                                                ),
                                            }}
                                        >
                                            {!isOwn && 'sender_name' in msg && (() => {
                                                const bubbleBg = dm
                                                    ? (theme.bubbleOtherColor === '#e8e8e8' ? '#1e1e30' : theme.bubbleOtherColor)
                                                    : theme.bubbleOtherColor;
                                                const nameColor = isBgDark(bubbleBg) ? '#c4b5fd' : '#6366f1';
                                                return <div style={{ ...styles.senderName, color: nameColor, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    {msg.sender_name}
                                                    {((msg as any).sender_tag === 'kayano' || (msg as any).sender_tag === 'durov') && <span title="разработчик Aurora" style={{ fontSize: 12, lineHeight: 1, cursor: 'default' }}>🔧</span>}
                                                </div>;
                                            })()}

                                            {msg.reply_to_id && (() => {
                                                const rfp = (msg as any).reply_to_file_path;
                                                const replyThumb = rfp && /\.(jpg|jpeg|png|gif|webp)$/i.test(rfp) ? config.fileUrl(rfp) : null;
                                                return (
                                                    <div onClick={() => goToMessage(msg.reply_to_id!)} style={{
                                                        borderLeft: `3px solid ${isOwn ? 'rgba(255,255,255,0.55)' : '#6366f1'}`,
                                                        backgroundColor: isOwn ? 'rgba(255,255,255,0.12)' : (dm ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.07)'),
                                                        borderRadius: 6,
                                                        padding: '4px 10px',
                                                        marginBottom: 6,
                                                        fontSize: 12,
                                                        cursor: 'pointer',
                                                        transition: 'opacity 0.15s',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                    }} onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')} onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                                                        {replyThumb && <img src={replyThumb} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />}
                                                        <div>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: isOwn ? 'rgba(255,255,255,0.75)' : '#8b5cf6', marginBottom: 2 }}>
                                                                {msg.reply_to_sender || 'кто-то'}
                                                            </div>
                                                            <div style={{ color: isOwn ? 'rgba(255,255,255,0.85)' : (dm ? '#9090b8' : '#6b7280'), fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                                                                {msg.reply_to_text ? msg.reply_to_text : '📎 вложение'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            {editingMessageId === msg.id ? (
                                                <div style={{ marginTop: 4 }} onClick={e => e.stopPropagation()}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: isOwn ? 'rgba(255,255,255,0.6)' : '#8b5cf6', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>✏️ Редактирование</div>
                                                    <textarea
                                                        autoFocus
                                                        value={editingText}
                                                        onChange={e => setEditingText(e.target.value)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSubmit(msg.id); }
                                                            if (e.key === 'Escape') { setEditingMessageId(null); setEditingText(''); }
                                                        }}
                                                        rows={Math.min(5, (editingText.match(/\n/g)?.length || 0) + 1)}
                                                        style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: isOwn ? '1.5px solid rgba(255,255,255,0.4)' : `1.5px solid ${dm ? '#3a3a5e' : '#c4b5fd'}`, fontSize: theme.fontSize, outline: 'none', minWidth: 160, resize: 'none', fontFamily: 'inherit', backgroundColor: isOwn ? 'rgba(255,255,255,0.12)' : (dm ? '#1e1e30' : '#f5f3ff'), color: isOwn ? 'white' : (dm ? '#e2e8f0' : '#1e1b4b'), boxSizing: 'border-box' as const }}
                                                    />
                                                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                                        <button onClick={() => handleEditSubmit(msg.id)} style={{ flex: 1, padding: '6px 0', background: isOwn ? 'rgba(255,255,255,0.25)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✓ Сохранить</button>
                                                        <button onClick={() => { setEditingMessageId(null); setEditingText(''); }} style={{ padding: '6px 10px', backgroundColor: 'transparent', border: isOwn ? '1px solid rgba(255,255,255,0.3)' : `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, color: isOwn ? 'rgba(255,255,255,0.7)' : (dm ? '#9090b0' : '#6b7280'), borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>✕</button>
                                                    </div>
                                                    <div style={{ fontSize: 10, color: isOwn ? 'rgba(255,255,255,0.4)' : (dm ? '#5a5a8a' : '#c4b5fd'), marginTop: 4, textAlign: 'right' }}>Enter — сохранить, Esc — отмена</div>
                                                </div>
                                            ) : null}

                                            {'file_path' in msg && msg.file_path && (
                                                <FileMessage
                                                    filePath={msg.file_path}
                                                    filename={msg.filename || 'file'}
                                                    fileSize={msg.file_size}
                                                    isOwn={isOwn}
                                                    messageId={msg.id}
                                                    isGroup={activeChat.type === 'group'}
                                                    isDark={dm}
                                                    onPlay={playGlobalAudio}
                                                    onPlayVideo={(src, fn) => { setNowPlayingVideo({ src, filename: fn }); setTimeout(() => { if (floatingVideoRef.current) { floatingVideoRef.current.src = src; floatingVideoRef.current.play().catch(() => {}); } }, 100); }}
                                                    nowPlayingSrc={nowPlaying?.src}
                                                    globalPlaying={globalPlaying}
                                                    globalCurrentTime={globalCurrentTime}
                                                    globalDuration={globalDuration}
                                                    onGlobalSeek={seekGlobal}
                                                    onGlobalToggle={toggleGlobalPlay}
                                                />
                                            )}
                                            {(() => {
                                                const filesRaw = (msg as any).files;
                                                if (!filesRaw) return null;
                                                const filesArr = typeof filesRaw === 'string' ? JSON.parse(filesRaw) : filesRaw;
                                                if (!Array.isArray(filesArr) || filesArr.length === 0) return null;
                                                const imgFiles = filesArr.filter((f: any) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(f.filename || ''));
                                                const otherFiles = filesArr.filter((f: any) => !/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(f.filename || ''));
                                                return (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                                                        {imgFiles.length > 1 ? (
                                                            <ImageGrid images={imgFiles.map((f: any) => ({ url: f.file_path?.startsWith('http') ? f.file_path : `${BASE_URL}${f.file_path}`, name: f.filename || 'image' }))} />
                                                        ) : imgFiles.length === 1 ? (
                                                            <FileMessage
                                                                filePath={imgFiles[0].file_path}
                                                                filename={imgFiles[0].filename || 'file'}
                                                                fileSize={imgFiles[0].file_size}
                                                                isOwn={isOwn}
                                                                isGroup={activeChat.type === 'group'}
                                                                isDark={dm}
                                                                onPlay={playGlobalAudio}
                                                                onPlayVideo={(src, fn) => { setNowPlayingVideo({ src, filename: fn }); setTimeout(() => { if (floatingVideoRef.current) { floatingVideoRef.current.src = src; floatingVideoRef.current.play().catch(() => {}); } }, 100); }}
                                                                nowPlayingSrc={nowPlaying?.src}
                                                                globalPlaying={globalPlaying}
                                                                globalCurrentTime={globalCurrentTime}
                                                                globalDuration={globalDuration}
                                                                onGlobalSeek={seekGlobal}
                                                                onGlobalToggle={toggleGlobalPlay}
                                                            />
                                                        ) : null}
                                                        {otherFiles.map((f: any, i: number) => (
                                                            <FileMessage
                                                                key={i}
                                                                filePath={f.file_path}
                                                                filename={f.filename || 'file'}
                                                                fileSize={f.file_size}
                                                                isOwn={isOwn}
                                                                isGroup={activeChat.type === 'group'}
                                                                isDark={dm}
                                                                onPlay={playGlobalAudio}
                                                                onPlayVideo={(src, fn) => { setNowPlayingVideo({ src, filename: fn }); setTimeout(() => { if (floatingVideoRef.current) { floatingVideoRef.current.src = src; floatingVideoRef.current.play().catch(() => {}); } }, 100); }}
                                                                nowPlayingSrc={nowPlaying?.src}
                                                                globalPlaying={globalPlaying}
                                                                globalCurrentTime={globalCurrentTime}
                                                                globalDuration={globalDuration}
                                                                onGlobalSeek={seekGlobal}
                                                                onGlobalToggle={toggleGlobalPlay}
                                                            />
                                                        ))}
                                                    </div>
                                                );
                                            })()}

                                            {editingMessageId !== msg.id && msg.message_text && (
                                                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: (('file_path' in msg && msg.file_path) || (msg as any).files?.length) ? 6 : 0 }}>{renderTextWithLinks(msg.message_text)}</div>
                                            )}

                                            <div style={{ ...styles.timestamp, display: 'flex', alignItems: 'center', gap: 4, justifyContent: isOwn ? 'flex-end' : 'flex-start' }}>
                                                {msg.edited_at && <span style={{ opacity: 0.6, marginRight: 4 }}>изм.</span>}
                                                {formatTime(msg.timestamp)}
                                                {isOwn && (
                                                    <span title={(msg as any).is_read ? 'Прочитано' : 'Доставлено'} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                                                        {(msg as any).is_read ? (
                                                            <svg width="18" height="11" viewBox="0 0 18 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                <path d="M1 5.5L4.5 9L11 2" stroke="rgba(255,255,255,0.55)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                                                                <path d="M6 5.5L9.5 9L16 2" stroke="#93c5fd" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                                                            </svg>
                                                        ) : (
                                                            <svg width="12" height="10" viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                <path d="M1 5L4.5 8.5L11 1.5" stroke="rgba(255,255,255,0.65)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                                                            </svg>
                                                        )}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Reactions display */}
                                            {reactions[msg.id]?.length > 0 && (() => {
                                                const grouped: Record<string, number[]> = {};
                                                for (const r of reactions[msg.id]) {
                                                    if (!grouped[r.emoji]) grouped[r.emoji] = [];
                                                    grouped[r.emoji].push(r.user_id);
                                                }
                                                return (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4, justifyContent: isOwn ? 'flex-end' : 'flex-start' }}>
                                                        {Object.entries(grouped).map(([emoji, userIds]) => (
                                                            <button key={emoji} onClick={() => {
                                                                const isGroup = activeChat.type === 'group';
                                                                if (userIds.includes(currentUserId)) wsService.removeReaction(msg.id, isGroup, emoji);
                                                                else wsService.addReaction(msg.id, isGroup, emoji);
                                                            }} style={{ padding: '2px 6px', borderRadius: 12, border: `1px solid ${userIds.includes(currentUserId) ? '#6366f1' : (dm ? '#3a3a5e' : '#e0e0f0')}`, background: userIds.includes(currentUserId) ? (dm ? 'rgba(99,102,241,0.2)' : '#ede9fe') : (dm ? '#252540' : 'white'), cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 3 }}>
                                                                {emoji}<span style={{ fontSize: 10, color: dm ? '#a5b4fc' : '#6366f1', fontWeight: 600 }}>{userIds.length}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </div>

                                        {/* Reaction picker button on hover */}
                                        {hoveredMsgId === msg.id && (
                                            <div style={{ position: 'absolute', [isOwn ? 'right' : 'left']: '100%', bottom: 8, zIndex: 10, marginLeft: isOwn ? undefined : 4, marginRight: isOwn ? 4 : undefined }}>
                                                <button onClick={(e) => { e.stopPropagation(); setReactionPickerMsgId(p => p === msg.id ? null : msg.id); }}
                                                    style={{ background: dm ? '#252540' : 'white', border: `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, borderRadius: '50%', width: 26, height: 26, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>
                                                    😊
                                                </button>
                                                {reactionPickerMsgId === msg.id && (
                                                    <div style={{ position: 'absolute', bottom: 30, [isOwn ? 'right' : 'left']: 0, background: dm ? '#1e1e30' : 'white', border: `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, borderRadius: 12, padding: 6, display: 'flex', gap: 4, flexWrap: 'wrap', width: 200, zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
                                                        {['👍','❤️','😂','😮','😢','😡','🔥','👏','🎉','✅'].map(emoji => (
                                                            <button key={emoji} onClick={() => {
                                                                const isGroup = activeChat.type === 'group';
                                                                const myReaction = reactions[msg.id]?.find(r => r.user_id === currentUserId && r.emoji === emoji);
                                                                if (myReaction) wsService.removeReaction(msg.id, isGroup, emoji);
                                                                else wsService.addReaction(msg.id, isGroup, emoji);
                                                                setReactionPickerMsgId(null);
                                                            }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: 2, borderRadius: 6, lineHeight: 1 }}>
                                                                {emoji}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    </div>
                                    );
                                });
                                return items;
                            })()}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Channel: Comments panel */}
                        {isChannelChat && commentPostId !== null && (() => {
                            const post = messages.find(m => m.id === commentPostId);
                            const comments = messages.filter(m => (m as any).reply_to_id === commentPostId && !m.is_deleted);
                            const border2 = dm ? 'rgba(99,102,241,0.2)' : '#ede9fe';
                            return (
                                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 340, background: dm ? '#13132a' : '#ffffff', borderLeft: `1.5px solid ${border2}`, display: 'flex', flexDirection: 'column', zIndex: 50, boxShadow: '-4px 0 20px rgba(0,0,0,0.12)', animation: 'panel-slide-in 0.22s' }}>
                                    {/* Header */}
                                    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${border2}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                                        <span style={{ fontWeight: 700, fontSize: 15, color: dm ? '#e0e0f0' : '#1e1b4b' }}>Комментарии</span>
                                        <button onClick={() => { setCommentPostId(null); setCommentReplyTo(null); setEditingCommentId(null); setEditingCommentText(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#9999bb' : '#9ca3af', fontSize: 18 }}>✕</button>
                                    </div>
                                    {/* Post preview */}
                                    {post && (
                                        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${border2}`, background: dm ? '#1a1a2e' : '#f5f3ff', flexShrink: 0 }}>
                                            <div style={{ fontSize: 12, color: dm ? '#7c7caa' : '#6b7280', marginBottom: 4 }}>Пост</div>
                                            <div style={{ fontSize: 13, color: dm ? '#c0c0d8' : '#374151', maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>{post.message_text || '📎 Файл'}</div>
                                        </div>
                                    )}
                                    {/* Comments list */}
                                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {comments.length === 0 && <div style={{ textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13, marginTop: 20 }}>Пока нет комментариев</div>}
                                        {comments.map(c => {
                                            const isOwn2 = c.sender_id === currentUserId;
                                            const canEdit = isOwn2;
                                            const canDelete = isOwn2 || isGroupAdmin;
                                            const cName = (c as any).sender_name || (isOwn2 ? currentUsername : '?');
                                            const cAvatar = (c as any).sender_avatar ? config.fileUrl((c as any).sender_avatar) : null;
                                            const isEditingThis = editingCommentId === c.id;
                                            return (
                                                <div key={c.id}
                                                    style={{ display: 'flex', gap: 8, alignItems: 'flex-start', position: 'relative' }}
                                                    onMouseEnter={() => setHoveredCommentId(c.id)}
                                                    onMouseLeave={() => setHoveredCommentId(null)}
                                                >
                                                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: cAvatar ? (dm ? '#1a1a2e' : '#f3f4f6') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'white', fontSize: 13, overflow: 'hidden', flexShrink: 0 }}>
                                                        {cAvatar ? <img src={cAvatar} alt={cName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : cName[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0, background: dm ? '#1e1e3a' : '#f5f3ff', borderRadius: 12, padding: '8px 12px', borderTopLeftRadius: 4 }}>
                                                        <div style={{ fontSize: 12, fontWeight: 700, color: dm ? '#a5b4fc' : '#6366f1', marginBottom: 3 }}>{isOwn2 ? 'Вы' : cName}</div>
                                                        {isEditingThis ? (
                                                            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                                                                <input
                                                                    autoFocus
                                                                    value={editingCommentText}
                                                                    onChange={e => setEditingCommentText(e.target.value)}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter' && editingCommentText.trim()) {
                                                                            wsService.sendRaw({ type: 'edit_message', message_id: c.id, new_text: editingCommentText.trim(), is_group: true });
                                                                            setEditingCommentId(null); setEditingCommentText('');
                                                                        }
                                                                        if (e.key === 'Escape') { setEditingCommentId(null); setEditingCommentText(''); }
                                                                    }}
                                                                    style={{ flex: 1, padding: '5px 8px', borderRadius: 8, border: `1px solid ${dm ? '#4a4a7e' : '#c4b5fd'}`, background: dm ? '#13132a' : 'white', color: dm ? '#e0e0f0' : '#1e1b4b', fontSize: 13, outline: 'none' }}
                                                                />
                                                                <button onClick={() => { if (editingCommentText.trim()) { wsService.sendRaw({ type: 'edit_message', message_id: c.id, new_text: editingCommentText.trim(), is_group: true }); } setEditingCommentId(null); setEditingCommentText(''); }}
                                                                    style={{ padding: '4px 10px', borderRadius: 8, background: 'linear-gradient(135deg,#6c47d4,#8b5cf6)', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✓</button>
                                                                <button onClick={() => { setEditingCommentId(null); setEditingCommentText(''); }}
                                                                    style={{ padding: '4px 8px', borderRadius: 8, background: 'none', border: `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, color: dm ? '#9090b0' : '#6b7280', cursor: 'pointer', fontSize: 12 }}>✕</button>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                {c.message_text && <div style={{ fontSize: 13, color: dm ? '#d0d0e8' : '#374151', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{c.message_text}{(c as any).edited_at && <span style={{ fontSize: 10, color: dm ? '#5a5a8a' : '#bbb', marginLeft: 4 }}>изм.</span>}</div>}
                                                                {c.file_path && <FileMessage filePath={c.file_path} filename={(c as any).filename || ''} fileSize={(c as any).file_size} isOwn={false} isDark={dm} />}
                                                            </>
                                                        )}
                                                        <div style={{ fontSize: 10, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 4 }}>{new Date(c.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
                                                    </div>
                                                    {hoveredCommentId === c.id && !isEditingThis && (
                                                        <div style={{ position: 'absolute', right: 0, top: -2, display: 'flex', gap: 2, background: dm ? '#1e1e3a' : 'white', border: `1px solid ${dm ? '#3a3a5e' : '#e0deff'}`, borderRadius: 8, padding: '2px 4px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 5 }}>
                                                            <button title="Ответить" onClick={() => setCommentReplyTo({ id: c.id, name: cName, text: c.message_text })}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 5px', color: dm ? '#a5b4fc' : '#6366f1' }}>↩</button>
                                                            {canEdit && <button title="Редактировать" onClick={() => { setEditingCommentId(c.id); setEditingCommentText(c.message_text || ''); }}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 5px', color: dm ? '#a5b4fc' : '#6366f1' }}>✏️</button>}
                                                            {canDelete && <button title="Удалить" onClick={() => { setDeleteConfirmId(c.id); setMenuMessageId(null); }}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 5px', color: '#ef4444' }}>🗑</button>}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {/* Comment reply preview */}
                                    {commentReplyTo && (
                                        <div style={{ padding: '6px 14px', borderTop: `1px solid ${border2}`, background: dm ? '#1a1a2e' : '#f0efff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderLeft: '3px solid #6366f1', flexShrink: 0 }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: '#8b5cf6' }}>↩ {commentReplyTo.name}</div>
                                                <div style={{ fontSize: 12, color: dm ? '#9090b8' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commentReplyTo.text?.slice(0, 80) || '📎 файл'}</div>
                                            </div>
                                            <button onClick={() => setCommentReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}>✕</button>
                                        </div>
                                    )}
                                    {/* Comment input */}
                                    <div style={{ padding: '10px 14px', borderTop: commentReplyTo ? 'none' : `1px solid ${border2}`, display: 'flex', gap: 8, flexShrink: 0 }}>
                                        <input
                                            value={commentText}
                                            onChange={e => setCommentText(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && commentText.trim()) {
                                                    const text = commentReplyTo ? `↩ ${commentReplyTo.name}: ${commentReplyTo.text?.slice(0, 60) || ''}...\n${commentText.trim()}` : commentText.trim();
                                                    wsService.sendGroupMessage(activeChat!.id, text, undefined, undefined, undefined, commentPostId);
                                                    setCommentText(''); setCommentReplyTo(null);
                                                }
                                            }}
                                            placeholder="Написать комментарий..."
                                            style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, background: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#e0e0f0' : '#1e1b4b', fontSize: 13, outline: 'none' }}
                                        />
                                        <button
                                            onClick={() => {
                                                if (commentText.trim()) {
                                                    const text = commentReplyTo ? `↩ ${commentReplyTo.name}: ${commentReplyTo.text?.slice(0, 60) || ''}...\n${commentText.trim()}` : commentText.trim();
                                                    wsService.sendGroupMessage(activeChat!.id, text, undefined, undefined, undefined, commentPostId!);
                                                    setCommentText(''); setCommentReplyTo(null);
                                                }
                                            }}
                                            disabled={!commentText.trim()}
                                            style={{ padding: '8px 14px', borderRadius: 10, background: commentText.trim() ? 'linear-gradient(135deg, #6c47d4, #8b5cf6)' : (dm ? '#2a2a3a' : '#e0e0e8'), color: commentText.trim() ? 'white' : (dm ? '#5a5a8a' : '#9ca3af'), border: 'none', cursor: commentText.trim() ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 13 }}>→</button>
                                    </div>
                                </div>
                            );
                        })()}

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
                            if (replyIsVoice) replyFileLabel = '🎤 Голосовое сообщение';
                            else if (replyIsAudio) replyFileLabel = `🎵 ${replyFilename}`;
                            else if (replyIsVideo) replyFileLabel = `🎬 ${replyFilename}`;
                            else if (replyIsImg) replyFileLabel = '🖼️ Фото';
                            else if (replyFilename) replyFileLabel = `📄 ${replyFilename}`;
                            else if (replyFilePath) replyFileLabel = '📎 файл';
                            return (
                                <div style={{ padding: '8px 16px', backgroundColor: dm ? '#1a1a2e' : '#f0efff', borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.2)' : '#d9d6fe'}`, borderLeft: `3px solid #6366f1`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                        {replyImgSrc && <img src={replyImgSrc} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />}
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#8b5cf6', marginBottom: 2 }}>↩️ {replyTo.sender_name || 'Ответ'}</div>
                                            <div style={{ fontSize: 12, color: dm ? '#9090b8' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {replyTo.message_text?.slice(0, 80) || replyFileLabel || '📎 файл'}
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', fontSize: 14, padding: '2px 4px', flexShrink: 0, lineHeight: 1 }}>✕</button>
                                </div>
                            );
                        })()}

                        {/* Staging area */}
                        {pendingFiles.length > 0 && (
                            <div style={{ padding: '8px 16px', backgroundColor: dm ? '#1a1a2e' : '#f5f3ff', borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.2)' : '#ede9fe'}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <span style={{ fontSize: 11, color: dm ? '#7c7caa' : '#9ca3af', fontWeight: 500 }}>
                                        📎 {pendingFiles.length} / 10 файл{pendingFiles.length === 1 ? '' : pendingFiles.length < 5 ? 'а' : 'ов'}
                                    </span>
                                    <button onClick={() => setPendingFiles([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', fontSize: 12, padding: 0 }}>Убрать все</button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {pendingFiles.map((f, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', backgroundColor: dm ? '#252540' : 'white', border: `1px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, borderRadius: 10, fontSize: 12, maxWidth: 180 }}>
                                            <span style={{ fontSize: 16 }}>{/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.name) ? '🖼️' : /\.(mp4|webm|mov)$/i.test(f.name) ? '🎬' : /\.(mp3|ogg|wav|flac|aac|m4a)$/i.test(f.name) ? '🎵' : '📄'}</span>
                                            <span style={{ color: dm ? '#c0c0d8' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
                                            <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', fontSize: 14, padding: 0, lineHeight: 1, flexShrink: 0 }}>✕</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Upload progress */}
                        {uploading && (
                            <div style={{ padding: '8px 16px 6px', borderTop: `1px solid ${dm ? '#2a2a3d' : '#ede9fe'}`, backgroundColor: dm ? '#13131f' : 'white' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                                    <span style={{ fontSize: 12, color: dm ? '#9090b8' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '68%' }}>
                                        📤 {uploadingFileName}
                                    </span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#6366f1' }}>{uploadProgress}%</span>
                                        <button onClick={() => { currentUploadXHR.current?.abort(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#7070a0' : '#9ca3af', fontSize: 14, padding: 0, lineHeight: 1 }} title="Отменить загрузку">✕</button>
                                    </div>
                                </div>
                                <div style={{ height: 3, backgroundColor: dm ? '#2a2a3d' : '#e0e0f0', borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', borderRadius: 3, transition: 'width 0.1s ease' }} />
                                </div>
                            </div>
                        )}

                        {/* Режим выбора сообщений */}
                        {selectionMode && (
                            <div style={{ ...darkStyles.inputArea, justifyContent: 'space-between', padding: '10px 16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <button onClick={exitSelectionMode} style={{ background: 'none', border: `1.5px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, borderRadius: 10, padding: '7px 14px', cursor: 'pointer', color: dm ? '#c0c0d8' : '#6b7280', fontSize: 13 }}>✕ Отмена</button>
                                    <span style={{ fontSize: 13, color: dm ? '#a0a0c0' : '#6b7280', fontWeight: 500 }}>Выбрано: {selectedMsgIds.size}</span>
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        onClick={handleBulkForward}
                                        disabled={selectedMsgIds.size === 0}
                                        style={{ padding: '8px 14px', background: dm ? '#1e1e3a' : '#f5f3ff', color: '#6366f1', border: `1.5px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, borderRadius: 10, cursor: selectedMsgIds.size === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: selectedMsgIds.size === 0 ? 0.5 : 1 }}
                                    >↪️ Переслать</button>
                                    <button
                                        onClick={() => setBulkDeleteConfirm(true)}
                                        disabled={selectedMsgIds.size === 0}
                                        style={{ padding: '8px 14px', background: 'none', color: '#ef4444', border: '1.5px solid #fca5a5', borderRadius: 10, cursor: selectedMsgIds.size === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: selectedMsgIds.size === 0 ? 0.5 : 1 }}
                                    >🗑️ Удалить</button>
                                </div>
                            </div>
                        )}

                        {/* Ввод */}
                        {!selectionMode && isChannelChat && !isChannelMember && (
                            <div style={{ padding: '14px 18px', borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.15)' : '#ede9fe'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, background: dm ? '#13131f' : '#f7f8fc' }}>
                                <button
                                    onClick={async () => {
                                        if (!activeChat) return;
                                        const res = await api.joinGroup(token, activeChat.id);
                                        if (res.success || res.already_member) {
                                            await loadGroups();
                                            setPreviewGroup(null);
                                        }
                                    }}
                                    style={{ padding: '10px 28px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none', borderRadius: 14, cursor: 'pointer', fontSize: 14, fontWeight: 700, boxShadow: '0 2px 12px rgba(99,102,241,0.35)', transition: 'opacity 0.15s' }}
                                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
                                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                                >
                                    📢 Подписаться
                                </button>
                            </div>
                        )}
                        {!selectionMode && isChannelChat && isChannelMember && !isGroupAdmin && (
                            <div style={{ padding: '14px 18px', textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13, borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.1)' : '#ede9fe'}` }}>
                                🔒 Только администраторы могут публиковать
                            </div>
                        )}
                        {!selectionMode && (!isChannelChat || isGroupAdmin) && <div style={{ ...darkStyles.inputArea, position: 'relative' }}>
                            {showEmojiPicker && (
                                <EmojiPicker
                                    onSelect={emoji => { if (inputRef.current) { inputRef.current.value += emoji; autoResize(inputRef.current); inputRef.current.focus(); } }}
                                    onClose={() => setShowEmojiPicker(false)}
                                    isDark={theme.darkMode}
                                />
                            )}
                            <textarea
                                ref={inputRef}
                                rows={1}
                                defaultValue=""
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                                }}
                                onKeyUp={handleTyping}
                                onInput={(e) => autoResize(e.currentTarget)}
                                onPaste={(e) => {
                                    const items = e.clipboardData?.items;
                                    if (!items) return;
                                    const imgs = Array.from(items).filter(i => i.kind === 'file' && i.type.startsWith('image/'));
                                    if (imgs.length > 0) {
                                        e.preventDefault();
                                        addPendingFiles(imgs.map(i => i.getAsFile()!).filter(Boolean));
                                    } else {
                                        setTimeout(() => { if (inputRef.current) autoResize(inputRef.current); }, 0);
                                    }
                                }}
                                placeholder={isChannelChat ? 'Написать пост...' : 'Введите сообщение...'}
                                style={darkStyles.input}
                            />
                            <button onClick={() => setShowEmojiPicker(p => !p)} style={darkStyles.fileBtn} title="Эмодзи">😊</button>
                            <button onClick={() => fileInputRef.current?.click()} style={darkStyles.fileBtn}>
                                {uploading ? '📤' : '📎'}
                            </button>
                            <button
                                onClick={isRecording ? stopRecording : startRecording}
                                style={{ ...darkStyles.fileBtn, ...(isRecording ? { background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderColor: '#ef4444' } : {}), minWidth: 44 }}
                                title={isRecording ? 'Остановить запись' : 'Записать голосовое'}
                            >
                                {isRecording ? `⏹ ${recordingTime}s` : '🎤'}
                            </button>
                            <button onClick={sendMessage} style={styles.sendBtn}>
                                Отправить
                            </button>
                            <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />
                        </div>}
                    </>
                ) : (
                    <div style={darkStyles.noChat}>Выберите чат</div>
                )}
            </div>

            {/* Контекстное меню */}
            {menuMessage && (
                <div
                    style={{ position: 'fixed', top: menuPosition.y, left: menuPosition.x, zIndex: 9999 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{ ...styles.menu, backgroundColor: dm ? '#1e1e2e' : 'white', border: `1px solid ${dm ? '#3a3a4a' : '#ede9fe'}` }}>
                        {activeChat && (() => {
                            const chatKey = `${activeChat.type}-${activeChat.id}`;
                            const isPinned = pinnedMessages[chatKey]?.id === menuMessage.id;
                            return (
                                <button onClick={() => togglePinMessage(chatKey, menuMessage)} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                                    📌 {isPinned ? 'Открепить' : 'Закрепить'}
                                </button>
                            );
                        })()}
                        <button onClick={() => enterSelectionMode(menuMessage)} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                            ☑️ Выбрать
                        </button>
                        <button onClick={() => { setReplyTo(menuMessage); setMenuMessageId(null); }} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                            ↩️ Ответить
                        </button>
                        <button onClick={() => { setForwardingMessage(menuMessage); setMenuMessageId(null); }} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                            ↪️ Переслать
                        </button>
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
                        }} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                            📋 Копировать
                        </button>
                        {'file_path' in menuMessage && menuMessage.file_path && (
                            <button onClick={async () => {
                                const isGroup = activeChat?.type === 'group';
                                const url = isGroup
                                    ? `${BASE_URL}/files/group/download/${menuMessage.id}`
                                    : `${BASE_URL}/files/download/${menuMessage.id}`;
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
                            }} style={{ ...styles.menuItem, color: '#6366f1' }}>
                                💾 Скачать
                            </button>
                        )}
                        {menuMessage.sender_id === currentUserId && (
                            <>
                                <button onClick={() => handleEdit(menuMessage.id, menuMessage.message_text ?? '')} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                                    ✏️ Редактировать
                                </button>
                                <button onClick={() => handleDelete(menuMessage.id)} style={{ ...styles.menuItem, color: '#f44336' }}>
                                    🗑️ Удалить
                                </button>
                            </>
                        )}
                        <button onClick={() => setMenuMessageId(null)} style={{ ...styles.menuItem, color: dm ? '#aaa' : '#666' }}>
                            ❌ Отмена
                        </button>
                    </div>
                </div>
            )}

            {/* Модалки */}
            {showCreateGroup && (
                <CreateGroupModal token={token} isDark={theme.darkMode} onClose={() => setShowCreateGroup(false)} onGroupCreated={loadGroups} />
            )}
            {showCreateChannel && (
                <CreateChannelModal token={token} isDark={theme.darkMode} onClose={() => setShowCreateChannel(false)} onChannelCreated={loadGroups} />
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
                />
            )}
            {showFolderManager && (
                <FolderManager
                    token={token}
                    folders={folders}
                    users={users}
                    groups={groups}
                    isDark={theme.darkMode}
                    baseUrl={BASE_URL}
                    onClose={() => setShowFolderManager(false)}
                    onFoldersChange={updated => { setFolders(updated); }}
                />
            )}
            {showSettings && (
                <SettingsModal
                    token={token}
                    currentUsername={currentUsername}
                    currentAvatar={currentUserAvatar}
                    currentStatus={currentUserStatus}
                    theme={theme}
                    onThemeChange={onThemeChange}
                    onProfileUpdate={onProfileUpdate}
                    onLogout={onLogout}
                    onClose={() => setShowSettings(false)}
                />
            )}
            {/* Bulk delete confirmation modal */}
            {bulkDeleteConfirm && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setBulkDeleteConfirm(false)}>
                    <div style={{ background: dm ? '#13132a' : '#ffffff', borderRadius: 20, width: 320, padding: '28px 28px 22px', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', marginBottom: 8 }}>Удалить {selectedMsgIds.size} сообщ.</div>
                        <div style={{ fontSize: 14, color: dm ? '#9090b0' : '#6b7280', marginBottom: 20 }}>Выберите способ удаления</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <button onClick={() => handleBulkDelete(false)} style={{ width: '100%', padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e53935, #ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Удалить у всех</button>
                            <button onClick={() => handleBulkDelete(true)} style={{ width: '100%', padding: '11px 0', borderRadius: 12, border: dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', background: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#c0c0d8' : '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Удалить у себя</button>
                            <button onClick={() => setBulkDeleteConfirm(false)} style={{ width: '100%', padding: '9px 0', borderRadius: 12, border: 'none', background: 'none', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13, cursor: 'pointer' }}>Отмена</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk forward modal */}
            {forwardingMessages && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setForwardingMessages(null)}>
                    <div style={{ background: dm ? '#13132a' : 'white', borderRadius: 20, width: 360, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: dm ? '1px solid rgba(99,102,241,0.2)' : '1px solid #ede9fe' }} onClick={e => e.stopPropagation()}>
                        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${dm ? '#2a2a3d' : '#ede9fe'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 700, fontSize: 15, color: dm ? '#e2e8f0' : '#1e1b4b' }}>Переслать {forwardingMessages.length} сообщ.</span>
                                <button onClick={() => setForwardingMessages(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 18 }}>✕</button>
                            </div>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                            {groups.map(g => (
                                <div key={`fg-${g.id}`} onClick={() => {
                                    forwardingMessages.forEach(msg => {
                                        const senderName = (msg as any).sender_name || users.find((u: any) => u.id === msg.sender_id)?.username || 'Неизвестно';
                                        wsService.sendGroupMessage(g.id, `↪️ Переслано от ${senderName}\n${(msg as any).message_text || ''}`);
                                    });
                                    setForwardingMessages(null);
                                }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', cursor: 'pointer', borderBottom: `1px solid ${dm ? '#1e1e2e' : '#f3f3f8'}` }}>
                                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>{g.name[0]?.toUpperCase()}</div>
                                    <span style={{ fontSize: 14, color: dm ? '#e0e0e0' : '#1e1b4b', fontWeight: 500 }}>{g.name}</span>
                                </div>
                            ))}
                            {users.map(u => (
                                <div key={`fu-${u.id}`} onClick={() => {
                                    forwardingMessages.forEach(msg => {
                                        const senderName = (msg as any).sender_name || users.find((uu: any) => uu.id === msg.sender_id)?.username || 'Неизвестно';
                                        wsService.sendMessage(u.id, `↪️ Переслано от ${senderName}\n${(msg as any).message_text || ''}`);
                                    });
                                    setForwardingMessages(null);
                                }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', cursor: 'pointer', borderBottom: `1px solid ${dm ? '#1e1e2e' : '#f3f3f8'}` }}>
                                    <div style={{ width: 38, height: 38, borderRadius: '50%', backgroundColor: u.avatar ? (dm ? '#1a1a2e' : 'white') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'white', fontWeight: 700, fontSize: 15 }}>{u.username[0]?.toUpperCase()}</span>}
                                    </div>
                                    <span style={{ fontSize: 14, color: dm ? '#e0e0e0' : '#1e1b4b', fontWeight: 500 }}>{u.username}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Clear chat confirmation modal */}
            {showClearConfirm && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    className="modal-backdrop-enter" onClick={() => setShowClearConfirm(false)}>
                    <div style={{ background: dm ? '#13132a' : '#ffffff', borderRadius: 20, width: 320, padding: '28px 28px 22px', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe', textAlign: 'center' }}
                        className="modal-enter" onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', marginBottom: 8 }}>Это нельзя будет отменить</div>
                        <div style={{ fontSize: 14, color: dm ? '#9090b0' : '#6b7280', marginBottom: 24 }}>Очистить всю историю чата?</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={() => setShowClearConfirm(false)} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', background: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#c0c0d8' : '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Отмена</button>
                            <button onClick={confirmClearChat} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e53935, #ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(229,57,53,0.35)' }}>Очистить</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete message confirmation modal */}
            {deleteConfirmId !== null && (
                <div
                    style={{ position: 'fixed', inset: 0, zIndex: 5000, backgroundColor: dm ? 'rgba(15,10,40,0.75)' : 'rgba(15,10,40,0.4)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    className="modal-backdrop-enter"
                    onClick={() => setDeleteConfirmId(null)}
                >
                    <div
                        style={{ background: dm ? '#13132a' : '#ffffff', borderRadius: 20, width: 320, padding: '28px 28px 22px', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 0 40px rgba(99,102,241,0.12), 0 20px 60px rgba(0,0,0,0.12)', border: dm ? '1px solid rgba(99,102,241,0.25)' : '1px solid #ede9fe', textAlign: 'center' }}
                        className="modal-enter"
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ fontSize: 17, fontWeight: 700, color: dm ? '#ffffff' : '#1e1b4b', marginBottom: 8 }}>Удалить сообщение</div>
                        <div style={{ fontSize: 14, color: dm ? '#9090b0' : '#6b7280', marginBottom: 20 }}>Выберите способ удаления</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                            <button
                                onClick={() => confirmDelete(false)}
                                style={{ width: '100%', padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #e53935, #ef5350)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(229,57,53,0.35)' }}
                            >Удалить у всех</button>
                            <button
                                onClick={() => confirmDelete(true)}
                                style={{ width: '100%', padding: '11px 0', borderRadius: 12, border: dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe', background: dm ? '#1e1e3a' : '#f5f3ff', color: dm ? '#c0c0d8' : '#374151', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                            >Удалить у себя</button>
                            <button
                                onClick={() => setDeleteConfirmId(null)}
                                style={{ width: '100%', padding: '9px 0', borderRadius: 12, border: 'none', background: 'none', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13, cursor: 'pointer' }}
                            >Отмена</button>
                        </div>
                    </div>
                </div>
            )}
            {showSearch && (
                <SearchModal
                    token={token}
                    currentUserId={currentUserId}
                    isDark={theme.darkMode}
                    activeChatId={activeChat?.id}
                    activeChatType={activeChat?.type}
                    onClose={() => setShowSearch(false)}
                    onSelectMessage={(type, chatId, messageId) => {
                        if (type === 'private') {
                            const user = users.find(u => u.id === chatId);
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
            )}
            {selectedUserForProfile && (
                <UserProfileModal
                    user={selectedUserForProfile}
                    token={token}
                    isDark={theme.darkMode}
                    isOnline={users.find(u => u.id === selectedUserForProfile.id)?.is_online ?? selectedUserForProfile.is_online}
                    messages={
                        activeChat?.type === 'private' && activeChat.id === selectedUserForProfile.id
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
                        selectPrivateChat(selectedUserForProfile);
                        setSelectedUserForProfile(null);
                    }}
                    onGoToMessage={id => { setSelectedUserForProfile(null); setTimeout(() => goToMessage(id), 50); }}
                />
            )}

            {/* Forward message modal */}
            {forwardingMessage && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => setForwardingMessage(null)}>
                    <div style={{ background: dm ? '#13131f' : 'white', borderRadius: 18, width: 360, maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${dm ? '#2a2a3d' : '#ede9fe'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <span style={{ fontWeight: 700, fontSize: 15, color: dm ? '#e2e8f0' : '#1e1b4b' }}>Переслать в...</span>
                                <button onClick={() => setForwardingMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 18 }}>✕</button>
                            </div>
                            {/* Preview original message */}
                            <div style={{ borderLeft: `3px solid #6366f1`, paddingLeft: 10, borderRadius: 2 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#6366f1', marginBottom: 2 }}>
                                    {forwardingMessage.sender_name || users.find(u => u.id === forwardingMessage.sender_id)?.username || 'Неизвестно'}
                                </div>
                                <div style={{ fontSize: 12, color: dm ? '#9090b0' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                                    {forwardingMessage.message_text || (forwardingMessage.filename ? `📎 ${forwardingMessage.filename}` : '📎 вложение')}
                                </div>
                            </div>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
                            {groups.map(g => (
                                <div key={`fg-${g.id}`} onClick={() => {
                                    const msg = forwardingMessage;
                                    const senderName = msg.sender_name || users.find((u: any) => u.id === msg.sender_id)?.username || 'Неизвестно';
                                    const fwdPrefix = `↪️ Переслано от ${senderName}\n`;
                                    const fwdText = msg.message_text ? fwdPrefix + msg.message_text : fwdPrefix + (msg.filename ? `📎 ${msg.filename}` : '');
                                    const filesRaw = msg.files;
                                    const filesArr = filesRaw ? (typeof filesRaw === 'string' ? (() => { try { return JSON.parse(filesRaw); } catch { return []; } })() : filesRaw) : null;
                                    if (filesArr?.length) {
                                        wsService.sendGroupMessage(g.id, fwdText, undefined, undefined, undefined, undefined, undefined, undefined, filesArr);
                                    } else {
                                        wsService.sendGroupMessage(g.id, fwdText, msg.file_path, msg.filename, msg.file_size);
                                    }
                                    setForwardingMessage(null);
                                }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer' }}
                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: g.avatar ? (dm ? '#1a1a2e' : 'white') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700 }}>
                                        {g.avatar ? <img src={config.fileUrl(g.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : g.name[0]?.toUpperCase()}
                                    </div>
                                    <span style={{ fontSize: 14, color: dm ? '#e2e8f0' : '#1e1b4b' }}>{g.name}</span>
                                </div>
                            ))}
                            {users.map(u => (
                                <div key={`fu-${u.id}`} onClick={() => {
                                    const msg = forwardingMessage;
                                    const senderName = msg.sender_name || users.find((uu: any) => uu.id === msg.sender_id)?.username || 'Неизвестно';
                                    const fwdPrefix = `↪️ Переслано от ${senderName}\n`;
                                    const fwdText = msg.message_text ? fwdPrefix + msg.message_text : fwdPrefix + (msg.filename ? `📎 ${msg.filename}` : '');
                                    const filesRaw = msg.files;
                                    const filesArr = filesRaw ? (typeof filesRaw === 'string' ? (() => { try { return JSON.parse(filesRaw); } catch { return []; } })() : filesRaw) : null;
                                    if (filesArr?.length) {
                                        wsService.sendMessage(u.id, fwdText, undefined, undefined, undefined, undefined, undefined, undefined, filesArr);
                                    } else {
                                        wsService.sendMessage(u.id, fwdText, msg.file_path, msg.filename, msg.file_size);
                                    }
                                    setForwardingMessage(null);
                                }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer' }}
                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: u.avatar ? (dm ? '#1a1a2e' : 'white') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700 }}>
                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                    </div>
                                    <span style={{ fontSize: 14, color: dm ? '#e2e8f0' : '#1e1b4b' }}>{u.username}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Chat context menu (right-click on sidebar item) */}
            {pinMenu && (
                <div style={{ position: 'fixed', top: pinMenu.y, left: pinMenu.x, zIndex: 9999, background: dm ? '#1e1e2e' : 'white', border: `1px solid ${dm ? '#3a3a4a' : '#ede9fe'}`, borderRadius: 12, padding: 4, boxShadow: '0 4px 24px rgba(0,0,0,0.22)', minWidth: 192 }}
                    onClick={e => e.stopPropagation()}>
                    {(() => {
                        const btnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#e0e0e0' : '#1e1b4b', fontSize: 13, borderRadius: 8, textAlign: 'left' as const };
                        const key = pinMenu.key;
                        const isMuted = mutedChats.has(key);
                        if (addToFolderKey === key) {
                            return (
                                <>
                                    <button onClick={() => setAddToFolderKey(null)} style={{ ...btnStyle, color: '#6366f1' }}>← Назад</button>
                                    {folders.length === 0 && <div style={{ padding: '6px 14px', fontSize: 12, color: dm ? '#7070a0' : '#aaa' }}>Нет папок</div>}
                                    {folders.map(f => (
                                        <button key={f.id} onClick={() => addChatToFolder(f.id, key)} style={{ ...btnStyle }}>
                                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: f.color, display: 'inline-block', flexShrink: 0 }} />
                                            {f.name}
                                        </button>
                                    ))}
                                </>
                            );
                        }
                        return (
                            <>
                                <button onClick={() => togglePin(key)} style={btnStyle}>{pinnedChats.has(key) ? '📌 Открепить' : '📌 Закрепить'}</button>
                                <button onClick={() => toggleMute(key)} style={btnStyle}>{isMuted ? '🔔 Включить уведомления' : '🔕 Выключить уведомления'}</button>
                                <button onClick={() => { setAddToFolderKey(key); }} style={btnStyle}>📁 Добавить в папку</button>
                                <div style={{ height: 1, background: dm ? '#2a2a3a' : '#f0f0f0', margin: '4px 0' }} />
                                <button onClick={() => handleDeleteChat(key)} style={{ ...btnStyle, color: '#ef4444' }}>🗑️ Удалить чат</button>
                            </>
                        );
                    })()}
                </div>
            )}
            {pinMenu && <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => { setPinMenu(null); setAddToFolderKey(null); }} />}

            {/* Folder context menu */}
            {folderCtxMenu && (
                <div style={{ position: 'fixed', top: folderCtxMenu.y, left: folderCtxMenu.x, zIndex: 9999, background: dm ? '#1e1e2e' : 'white', border: `1px solid ${dm ? '#3a3a4a' : '#ede9fe'}`, borderRadius: 12, padding: 4, boxShadow: '0 4px 24px rgba(0,0,0,0.22)', minWidth: 180 }}
                    onClick={e => e.stopPropagation()}>
                    {(() => {
                        const btnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#e0e0e0' : '#1e1b4b', fontSize: 13, borderRadius: 8, textAlign: 'left' as const };
                        return (
                            <>
                                <button onClick={() => { setShowFolderManager(true); setFolderCtxMenu(null); }} style={btnStyle}>⚙️ Настроить</button>
                                <button onClick={async () => {
                                    try { await api.deleteFolder(token, folderCtxMenu.folderId); } catch {}
                                    const res = await api.getFolders(token);
                                    if (res.folders) setFolders(res.folders);
                                    if (activeFolder === folderCtxMenu.folderId) setActiveFolder(null);
                                    setFolderCtxMenu(null);
                                }} style={{ ...btnStyle, color: '#ef4444' }}>🗑️ Удалить папку</button>
                            </>
                        );
                    })()}
                </div>
            )}
            {folderCtxMenu && <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setFolderCtxMenu(null)} />}

            {/* In-app toast notifications */}
            {toasts.length > 0 && (
                <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 10, width: 320 }}>
                    {toasts.map(toast => (
                        <div
                            key={toast.id}
                            className={toast.exiting ? 'toast-exit' : 'toast-enter'}
                            style={{
                                background: dm ? '#1e1e2e' : 'white',
                                borderRadius: 16,
                                boxShadow: dm
                                    ? '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.2)'
                                    : '0 8px 32px rgba(99,102,241,0.18), 0 0 0 1px rgba(99,102,241,0.1)',
                                overflow: 'hidden',
                            }}
                        >
                            {/* Header — click to open chat */}
                            <div
                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px 8px', cursor: 'pointer' }}
                                onClick={() => {
                                    if (toast.chatType === 'private') {
                                        const user = usersRef.current.find(u => u.id === toast.chatId);
                                        if (user) selectPrivateChat(user);
                                    } else {
                                        const group = groupsRef.current.find(g => g.id === toast.chatId);
                                        if (group) selectGroupChat(group);
                                    }
                                    dismissToast(toast.id);
                                }}
                            >
                                <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: toast.avatarSrc ? (dm ? '#1a1a2e' : 'white') : toast.avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', fontSize: 15, color: 'white', fontWeight: 700 }}>
                                    {toast.avatarSrc
                                        ? <img src={config.fileUrl(toast.avatarSrc) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : toast.avatarLetter
                                    }
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: 13, color: dm ? '#e2e8f0' : '#1e1b4b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.title}</div>
                                    <div style={{ fontSize: 12, color: dm ? '#7878aa' : '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{toast.body}</div>
                                </div>
                                <button
                                    onClick={e => { e.stopPropagation(); dismissToast(toast.id); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 15, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                                >✕</button>
                            </div>
                            {/* Reply input */}
                            <div style={{ padding: '0 12px 8px', display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                                <input
                                    type="text"
                                    placeholder="Ответить..."
                                    value={toastReplies[toast.id] || ''}
                                    onChange={e => setToastReplies(prev => ({ ...prev, [toast.id]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') replyFromToast(toast, toastReplies[toast.id] || ''); }}
                                    style={{ flex: 1, padding: '7px 11px', borderRadius: 10, border: `1.5px solid ${dm ? '#3a3a55' : '#ede9fe'}`, backgroundColor: dm ? '#14142a' : '#f5f3ff', color: dm ? '#e2e8f0' : '#1e1b4b', fontSize: 13, outline: 'none' }}
                                />
                                <button
                                    onClick={() => replyFromToast(toast, toastReplies[toast.id] || '')}
                                    style={{ padding: '7px 13px', borderRadius: 10, border: 'none', backgroundColor: '#6366f1', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                                >↩</button>
                            </div>
                            {/* Mark as read */}
                            <div style={{ padding: '0 12px 10px' }} onClick={e => e.stopPropagation()}>
                                <button
                                    onClick={() => {
                                        const key = toast.chatType === 'private' ? `private-${toast.chatId}` : `group-${toast.chatId}`;
                                        setUnreadCounts(prev => { const next = { ...prev }; delete next[key]; return next; });
                                        if (toast.chatType === 'private' && toast.senderId) wsService.markRead(toast.senderId);
                                        dismissToast(toast.id);
                                    }}
                                    style={{ width: '100%', padding: '6px 0', borderRadius: 10, border: `1px solid ${dm ? '#3a3a55' : '#ede9fe'}`, backgroundColor: 'transparent', color: dm ? '#7878aa' : '#6b7280', fontSize: 12, cursor: 'pointer' }}
                                >
                                    ✓ Пометить как прочитанное
                                </button>
                            </div>
                            {/* Progress bar */}
                            <div style={{ height: 2, backgroundColor: dm ? '#2a2a3d' : '#ede9fe' }}>
                                <div style={{ height: '100%', backgroundColor: '#6366f1', animation: 'toastProgress 5s linear forwards' }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Floating video player */}
            {nowPlayingVideo && (
                <div
                    style={{ position: 'fixed', left: videoPos.x, top: videoPos.y, zIndex: 99000, borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.5)', border: `2px solid ${dm ? '#3a3a5e' : '#ede9fe'}`, background: '#000', userSelect: 'none', cursor: 'grab' }}
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: dm ? '#13131f' : '#f8f7ff' }}>
                        <span style={{ fontSize: 11, color: dm ? '#9090b0' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{nowPlayingVideo.filename}</span>
                        <button onClick={() => { setNowPlayingVideo(null); if (floatingVideoRef.current) floatingVideoRef.current.pause(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#9999bb' : '#9ca3af', fontSize: 14, padding: 0 }}>✕</button>
                    </div>
                </div>
            )}
        </div>
    );
};

const styles: { [key: string]: React.CSSProperties } = {
    container: { display: 'flex', height: '100vh', backgroundColor: '#eef0f5' },
    sidebar: { width: 320, backgroundColor: '#f7f8fc', boxShadow: '2px 0 16px rgba(99,102,241,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 1 },
    sidebarScroll: { flex: 1, overflowY: 'auto' as const, backgroundColor: '#f7f8fc' },
    sidebarHeader: { padding: '16px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', color: 'white', display: 'flex', alignItems: 'center', gap: 8 },
    newChatBtn: { padding: '6px 10px', backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 10, cursor: 'pointer', fontSize: 14, backdropFilter: 'blur(4px)' },
    createGroupBtn: { padding: '6px 10px', backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 10, cursor: 'pointer', fontSize: 12, backdropFilter: 'blur(4px)' },
    profileCard: { padding: '12px 16px', borderTop: '1px solid #e4e5ef', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#f0f1f8' },
    profileAvatar: { width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', overflow: 'hidden', boxShadow: '0 2px 8px rgba(99,102,241,0.3)' },
    profileInfo: { flex: 1, minWidth: 0 },
    profileName: { fontSize: 13, fontWeight: 600, color: '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    profileStatus: { fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 },
    settingsBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', padding: '6px', borderRadius: 10, color: '#9ca3af', flexShrink: 0 },
    sectionTitle: { padding: '14px 20px 6px', fontSize: 10, fontWeight: 700 as const, color: '#a5b4fc', textTransform: 'uppercase' as const, letterSpacing: 1.5 },
    chatItem: { display: 'flex', alignItems: 'center', padding: '10px 12px', cursor: 'pointer', gap: 10, transition: 'background 0.15s', borderRadius: 12, margin: '1px 8px' },
    activeChatItem: { background: 'linear-gradient(90deg, #e6e4f5 0%, #eceaf8 100%)', boxShadow: 'inset 3px 0 0 #6366f1' },
    avatar: { width: 40, height: 40, borderRadius: '50%', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 'bold' as const, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' },
    chatName: { fontSize: 14, fontWeight: 600 as const, color: '#1e1b4b', textAlign: 'left' as const },
    chatSub: { fontSize: 11, color: '#9ca3af', marginTop: 2, textAlign: 'left' as const },
    chatArea: { flex: 1, display: 'flex', flexDirection: 'column' as const, backgroundColor: '#f2f4f8', minWidth: 0 },
    chatHeader: { padding: '12px 20px', borderBottom: '1px solid #e8e8ef', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f7f8fc', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', minHeight: 68 },
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
    inputArea: { padding: '10px 16px', borderTop: '1px solid #e8e8ef', display: 'flex', gap: 8, alignItems: 'flex-end', backgroundColor: '#f7f8fc' },
    input: { flex: 1, padding: '10px 16px', fontSize: 14, border: '1.5px solid #dddde8', borderRadius: 16, outline: 'none', backgroundColor: '#eef0f8', transition: 'border-color 0.2s', resize: 'none' as const, lineHeight: '1.5', maxHeight: 150, overflowY: 'auto' as const, fontFamily: 'inherit' },
    fileBtn: { padding: '10px 13px', backgroundColor: '#eef0f8', border: '1.5px solid #dddde8', borderRadius: 12, cursor: 'pointer', fontSize: 16, color: '#6366f1', transition: 'all 0.15s' },
    sendBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none', borderRadius: 24, cursor: 'pointer', fontSize: 14, fontWeight: 600 as const, boxShadow: '0 2px 10px rgba(99,102,241,0.35)', transition: 'all 0.15s' },
    noChat: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', color: '#c4b5fd', fontSize: 16, gap: 12 },
    menu: { backgroundColor: 'white', borderRadius: 14, boxShadow: '0 8px 30px rgba(99,102,241,0.15)', padding: '6px 0', minWidth: 170, border: '1px solid #ede9fe' },
    menuItem: { display: 'block', width: '100%', padding: '10px 18px', textAlign: 'left' as const, border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 },
    findOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,10,40,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 },
    findModal: { borderRadius: 20, padding: 28, width: 340, border: '1px solid rgba(99,102,241,0.25)' },
    findInput: { width: '100%', padding: '11px 16px', fontSize: 14, borderRadius: 12, outline: 'none', boxSizing: 'border-box' as const },
    findBtn: { flex: 1, padding: '11px 0', background: 'linear-gradient(135deg, #6c47d4, #8b5cf6)', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600 as const },
    findCancelBtn: { flex: 1, padding: '11px 0', borderRadius: 12, cursor: 'pointer', fontSize: 14 },
};

export default Chat;
