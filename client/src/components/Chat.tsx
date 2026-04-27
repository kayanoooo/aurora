import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
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
import MediaPicker, { EMOJI_CATEGORIES } from './MediaPicker';
import PollCreator from './PollCreator';
import PollMessage from './PollMessage';
import FolderManager from './FolderManager';
import { useLang } from '../i18n';
import ChatMediaPanel from './ChatMediaPanel';
import HelpModal from './HelpModal';
import { config } from '../config';
import SupportChat from './SupportChat';
import AdminPanel from './AdminPanel';
import { getOrCreateKeyPair, getOwnPublicKey, encryptMessage, decryptMessage, isEncryptedMessage, cachePublicKey, getCachedPublicKey } from '../services/cryptoService';
import MediaPlayer, { MiniPlayer, Track, MediaStateChange, Playlist, PlaylistBubble, PlaylistShareData, parsePlaylistMsg, PLAYLIST_MSG_PREFIX } from './MediaPlayer';
import { useCall } from '../hooks/useCall';
import CallOverlay from './CallOverlay';

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
}

const Chat: React.FC<ChatProps> = ({ token, currentUserId, currentUsername, currentUserAvatar, currentUserStatus, currentUserTag, theme, onThemeChange, onProfileUpdate, onLogout }) => {
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
    const messagesRef = useRef<(Message | GroupMessage)[]>([]);
    const [chatKey, setChatKey] = useState(0);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
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
    }, []);
    const [playlistToShare, setPlaylistToShare] = useState<Playlist | null>(null);
    const [playlistShareSearch, setPlaylistShareSearch] = useState('');
    const [playlistPreview, setPlaylistPreview] = useState<PlaylistShareData | null>(null);
    const [playlistSaving, setPlaylistSaving] = useState(false);
    // Scheduled messages
    const [scheduledMessages, setScheduledMessages] = useState<any[]>([]);
    const [showSchedulePicker, setShowSchedulePicker] = useState(false);
    const [scheduleDateTime, setScheduleDateTime] = useState('');
    const [decryptedTexts, setDecryptedTexts] = useState<Record<number, string>>({});
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
    const [replyTo, setReplyTo] = useState<any>(null);
    const [selectedUserForProfile, setSelectedUserForProfile] = useState<User | null>(null);
    const [profileFromGroupInfo, setProfileFromGroupInfo] = useState(false);
    const [favoritesMessages, setFavoritesMessages] = useState<any[]>([]);
    const [showPollCreator, setShowPollCreator] = useState(false);
    const [showAttachMenu, setShowAttachMenu] = useState(false);
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
    const [pinnedMessages, setPinnedMessages] = useState<Record<string, { id: number; text: string; sender: string } | null>>(() => {
        try { return JSON.parse(localStorage.getItem(`aurora_pinned_msgs_${currentUserId}`) || '{}'); }
        catch { return {}; }
    });
    const togglePinMessage = (chatKey: string, msg: any) => {
        setPinnedMessages(prev => {
            const next = { ...prev, [chatKey]: prev[chatKey]?.id === msg.id ? null : { id: msg.id, text: msg.message_text || (lang === 'en' ? '[file]' : '[файл]'), sender: (msg as any).sender_name || t('You') } };
            localStorage.setItem(lsKey('pinned_msgs'), JSON.stringify(next));
            return next;
        });
        setMenuMessageId(null);
    };

    // Folder context menu
    const [folderCtxMenu, setFolderCtxMenu] = useState<{ x: number; y: number; folderId: number } | null>(null);
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

    const handleDeleteChat = (key: string) => {
        const parts = key.split('-');
        const type = parts[0];
        const id = parseInt(parts[1]);
        hideChat(key);
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
    const [showFullReactionPicker, setShowFullReactionPicker] = useState(false);
    const [stickerPackPreview, setStickerPackPreview] = useState<{ url: string; pack?: { id: string; name: string; emoji: string; stickers: string[] } } | null>(null);
    const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);

    // @mention autocomplete
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [groupMembersCache, setGroupMembersCache] = useState<Record<number, { id: number; username: string; tag?: string; avatar?: string }[]>>({});

    // Post views
    const [postViews, setPostViews] = useState<Record<number, number>>({});
    const viewedPostsRef = useRef<Set<number>>(new Set());

    // Sidebar read receipts (✓✓)
    const [lastReadByOther, setLastReadByOther] = useState<Record<number, boolean>>({});

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [showScrollDown, setShowScrollDown] = useState(false);
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
            showInAppToast({ title: t('Microphone'), body: t('No microphone access. Check browser permissions.'), chatType: 'private', chatId: 0, avatarLetter: '🎤', avatarColor: '#ef4444' });
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
        // Pause music player while chat audio is playing
        if (miniControlsRef.current && miniIsPlaying) {
            miniControlsRef.current.toggle();
            miniWasPausedByAudio.current = true;
        }
        const index = mediaPlaylist.findIndex(x => x.src === src);
        setNowPlaying({ src, filename, index: index >= 0 ? index : 0 });
        setGlobalDuration(0);
        setGlobalCurrentTime(0);
        setGlobalPlaying(false);
        const audio = globalAudioRef.current;
        if (!audio) return;
        audio.src = src;
        audio.load();
        audio.play().catch(() => {});
    }, [mediaPlaylist, miniIsPlaying]);

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

    // === Last seen formatter ===

    const renderTextWithLinks = (text: string | null | undefined, onMentionClick?: (username: string) => void, mentionColor = '#6366f1'): React.ReactNode => {
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
    };

    // Sticker / GIF / Poll helpers
    const isSticker = (text?: string | null) => !!text?.startsWith('__sticker__');
    const isGif = (text?: string | null) => !!text?.startsWith('__gif__');
    const isPoll = (text?: string | null) => !!text?.startsWith('__poll__:');
    const getPollId = (text?: string | null) => { const m = text?.match(/^__poll__:(\d+)$/); return m ? parseInt(m[1]) : null; };
    const isCallEnded = (text?: string | null) => !!text?.startsWith('__call_ended__');
    const getCallDuration = (text?: string | null) => { const m = text?.match(/^__call_ended__(\d+)$/); return m ? parseInt(m[1]) : 0; };
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

    // Bulk-decrypt all encrypted messages in a list and store results
    const decryptBatch = useCallback(async (msgs: any[], partnerId: number) => {
        const pubKey = getCachedPublicKey(partnerId);
        if (!pubKey) return;
        const updates: Record<number, string> = {};
        await Promise.all(msgs.map(async m => {
            if (!isEncryptedMessage(m.message_text)) return;
            if (decryptedTexts[m.id] !== undefined) return;
            const { text } = await decryptMessage(m.message_text, pubKey);
            updates[m.id] = text;
        }));
        if (Object.keys(updates).length > 0) {
            setDecryptedTexts(prev => ({ ...prev, ...updates }));
        }
    }, [decryptedTexts]);

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
                setMessages(res.messages);
                const rxMap: Record<number, {emoji: string; user_id: number}[]> = {};
                for (const msg of res.messages) {
                    if (msg.reactions?.length) rxMap[msg.id] = msg.reactions;
                }
                setReactions(prev => ({ ...prev, ...rxMap }));
                restoreOrBottom();
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
                const viewMap: Record<number, number> = {};
                for (const msg of res.messages) {
                    if (msg.reactions?.length) rxMap[msg.id] = msg.reactions;
                    if (msg.view_count != null) viewMap[msg.id] = msg.view_count;
                }
                setReactions(prev => ({ ...prev, ...rxMap }));
                setPostViews(prev => ({ ...prev, ...viewMap }));
                restoreOrBottom();
            }
        } catch (e) { console.error(e); }
    }, [token]);

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
                    scrollToBottom(true);
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
                    if (data.data.sender_id === currentUserId && chat) scrollPositions.current.delete(`${chat.type}-${chat.id}`);
                    scrollToBottom(true);
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
                    if (!isChatActive && !mutedChatsRef.current.has(`group-${data.data.group_id}`) && !archivedChatsRef.current.has(`group-${data.data.group_id}`)) {
                        const groupObj = groupsRef.current.find((g: Group) => g.id === data.data.group_id);
                        const groupName = groupObj?.name || t('Group');
                        const senderName = data.data.sender_name || t('Member');
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
                if (chat?.type === 'private' && chat.id === data.data.user_id && data.data.user_id !== currentUserId) {
                    setTypingUser(data.data.username || t('Contact'));
                    if (typingUserTimerRef.current) clearTimeout(typingUserTimerRef.current);
                    typingUserTimerRef.current = setTimeout(() => setTypingUser(null), 1000);
                }
                const tKey = `private-${data.data.user_id}`;
                setTypingChats(prev => ({ ...prev, [tKey]: data.data.username || '' }));
                if (typingChatsTimers.current[tKey]) clearTimeout(typingChatsTimers.current[tKey]);
                typingChatsTimers.current[tKey] = setTimeout(() => setTypingChats(prev => { const n = { ...prev }; delete n[tKey]; return n; }), 3000);

            } else if (data.type === 'group_typing') {
                if (chat?.type === 'group' && chat.id === data.data.group_id) {
                    setTypingUser(data.data.username || t('Member'));
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

            } else if (data.type === 'visibility_update') {
                setUsers(prev => prev.map(u =>
                    u.id === data.data.user_id
                        ? { ...u, last_seen: data.data.last_seen ?? u.last_seen, is_online: data.data.last_seen === 'blocked_you' ? false : u.is_online }
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
                setScheduledMessages(prev => prev.filter(m => m.id !== sid));

            } else if (data.type === 'account_deleted') {
                onLogout();

            } else if (data.type === 'support_reply') {
                // Admin replied to current user
                setNewSupportReply({ ...data.data });
                if (!showSupportChatRef.current) {
                    showInAppToastRef.current?.({
                        title: 'Поддержка Aurora',
                        body: data.data.message_text,
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
                    showInAppToast({
                        title: `Поддержка: ${data.data.message_text.slice(0, 40)}`,
                        body: `User #${data.data.user_id}`,
                        chatType: 'private',
                        chatId: 0,
                        senderId: 0,
                        avatarLetter: '🎧',
                        avatarColor: '#ef4444',
                    });
                }
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
        setShowScrollDown(false);
        setScheduledMessages([]);
        setMessages([]);
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
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const selectGroupChat = (group: Group) => {
        saveDraft(activeChatRef.current);
        setReplyTo(null);
        setCommentPostId(null);
        setPreviewGroup(null);
        setShowScrollDown(false);
        setScheduledMessages([]);
        setMessages([]);
        setChatKey(k => k + 1);
        setActiveChat({ type: 'group', id: group.id, name: group.name });
        setUnreadCounts(prev => { const next = { ...prev }; delete next[`group-${group.id}`]; return next; });
        restoreDraft(`group-${group.id}`);
        wsService.send({ type: 'group_mark_read', group_id: group.id });
        loadGroupMessages(group.id);
        loadGroupMembers(group.id);
        loadScheduled({ type: 'group', id: group.id, name: group.name });
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
        if (!text || !activeChat || !scheduleDateTime) return;
        try {
            const res = activeChat.type === 'private'
                ? await api.scheduleMessage(token, text, new Date(scheduleDateTime).toISOString(), activeChat.id)
                : await api.scheduleMessage(token, text, new Date(scheduleDateTime).toISOString(), undefined, activeChat.id);
            if (res.success) {
                const newItem = {
                    id: res.id,
                    sender_id: currentUserId,
                    message_text: text,
                    scheduled_at: res.scheduled_at,
                    receiver_id: activeChat.type === 'private' ? activeChat.id : null,
                    group_id: activeChat.type === 'group' ? activeChat.id : null,
                };
                setScheduledMessages(prev => [...prev, newItem]);
                if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = 'auto'; }
            }
        } catch {}
        setShowSchedulePicker(false);
        setScheduleDateTime('');
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
        setMenuPosition({ x: e.clientX, y: e.clientY });
    };

    // Long-press for iOS/touch devices (context menu via touch)
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressMoved = useRef(false);
    const makeLongPressHandlers = (msg: any) => ({
        onTouchStart: (e: React.TouchEvent) => {
            longPressMoved.current = false;
            longPressTimer.current = setTimeout(() => {
                if (!longPressMoved.current) {
                    const touch = e.touches[0];
                    setMenuMessageId(msg.id);
                    setMenuPosition({ x: touch.clientX, y: touch.clientY });
                }
            }, 500);
        },
        onTouchMove: () => { longPressMoved.current = true; if (longPressTimer.current) clearTimeout(longPressTimer.current); },
        onTouchEnd: () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); },
        onTouchCancel: () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); },
    });

    // Clamp context menu inside viewport after it renders
    useLayoutEffect(() => {
        if (!menuMessage || !menuContainerRef.current || isMobile) return;
        const el = menuContainerRef.current;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 8;
        const left = Math.max(margin, Math.min(menuPosition.x, vw - rect.width - margin));
        const top  = Math.max(margin, Math.min(menuPosition.y, vh - rect.height - margin));
        el.style.left = `${left}px`;
        el.style.top  = `${top}px`;
    }, [menuMessage, menuPosition, isMobile]);

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
        if (id && text) {
            wsService.sendRaw({
                type: 'edit_message',
                message_id: id,
                new_text: text,
                is_group: activeChatRef.current?.type === 'group',
            });
        }
        setEditingMessageId(null);
        setEditingText('');
        if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = 'auto'; }
    };

    const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
    const [deletingMsgIds, setDeletingMsgIds] = useState<Set<number>>(new Set());
    const [forwardingMessage, setForwardingMessage] = useState<any | null>(null);

    const handleDelete = (messageId: number) => {
        setMenuMessageId(null);
        setDeleteConfirmId(messageId);
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
        if (text.startsWith('__poll__:')) return lang === 'en' ? '📊 Poll' : '📊 Опрос';
        if (text.startsWith('__call_ended__')) return lang === 'en' ? '📞 Call ended' : '📞 Звонок завершён';
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
        const rawPreview = text?.trim() || fallback;
        let preview: string;
        if (isEncryptedMessage(rawPreview)) {
            if (userId && decryptedPreviews[userId]) preview = decryptedPreviews[userId];
            else return <span style={subStyle}>{prefix ? `${prefix}${fallback}` : fallback}</span>;
        } else if (rawPreview.startsWith('__gif__')) preview = '🎞 GIF';
        else if (rawPreview.startsWith('__sticker__')) preview = `🎭 ${t('Stickers')}`;
        else if (rawPreview.startsWith('__poll__:')) preview = `📊 ${lang === 'en' ? 'Poll' : 'Опрос'}`;
        else if (rawPreview.startsWith('__call_ended__')) preview = `📞 ${lang === 'en' ? 'Call ended' : 'Звонок завершён'}`;
        else if (rawPreview.startsWith(PLAYLIST_MSG_PREFIX)) {
            try { const d = JSON.parse(rawPreview.slice(PLAYLIST_MSG_PREFIX.length)); preview = `🎵 ${d.name || (lang === 'en' ? 'Playlist' : 'Плейлист')}`; }
            catch { preview = `🎵 ${lang === 'en' ? 'Playlist' : 'Плейлист'}`; }
        } else if (rawPreview.startsWith('↪️ ')) {
            const nl = rawPreview.indexOf('\n');
            const body = nl !== -1 ? rawPreview.slice(nl + 1).trim() : '';
            preview = `↪ ${body || (lang === 'en' ? 'Forwarded message' : 'Пересланное сообщение')}`;
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

    const playNotificationSound = () => {
        try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
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
            setTimeout(() => ctx.close().catch(() => {}), 500);
        } catch {}
    };

    const showInAppToast = (toast: Omit<ToastItem, 'id' | 'exiting'>) => {
        const id = ++toastIdRef.current;
        setToasts(prev => [...prev.slice(-4), { ...toast, id }]);
        playNotificationSound();
        const timer = setTimeout(() => dismissToast(id), 5000);
        return () => clearTimeout(timer);
    };
    // Keep ref current so WebSocket handler (stale closure) always fires the latest toast
    showInAppToastRef.current = showInAppToast;

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
    const isGroupAdmin = activeGroup ? (activeGroup.my_role === 'admin' || activeGroup.creator_id === currentUserId) : false;
    const isChannelChat = !!(activeGroup?.is_channel);
    const isChannelMember = isChannelChat && groups.some(g => g.id === activeChat?.id);
    const isDeletedUser = activeChat?.type === 'private' && !!(users.find(u => u.id === activeChat.id) as any)?.is_deleted;

    // === Рендер ===

    const dm = theme.darkMode;
    const isOled = dm && theme.chatBg === '#000000';

    // OLED-aware color palette — replaces all hardcoded dark hex values below
    const C = {
        bg0:  isOled ? '#000000' : '#0f0f1a',   // deepest bg: container, messages area
        bg1:  isOled ? '#000000' : '#13131f',   // sidebar, input area
        bg2:  isOled ? '#050508' : '#1a1a2e',   // headers, large cards
        bg3:  isOled ? '#08080f' : '#1e1e2e',   // context menu, toasts
        bg4:  isOled ? '#0a0a14' : '#1e1e30',   // inputs, small buttons bg
        bg5:  isOled ? '#0d0d1a' : '#252540',   // reaction bubbles, hover cells
        bg6:  isOled ? '#0d0d12' : '#2a2a3a',   // misc hover + badge bg
        bdr1: isOled ? 'rgba(167,139,250,0.12)' : '#2a2a3d',  // main separator/border
        bdr2: isOled ? 'rgba(167,139,250,0.18)' : '#3a3a5e',  // card border
        bdr3: isOled ? 'rgba(167,139,250,0.14)' : '#3a3a55',  // input border
    };

    const darkStyles = {
        sidebar: { ...styles.sidebar, backgroundColor: dm ? C.bg1 : '#f7f8fc', boxShadow: isOled ? 'none' : dm ? '2px 0 12px rgba(99,102,241,0.05)' : '2px 0 12px rgba(99,102,241,0.05)', borderRight: 'none' },
        chatArea: { ...styles.chatArea, backgroundColor: theme.chatBg || (dm ? C.bg0 : '#f2f4f8') },
        chatHeader: { ...styles.chatHeader, borderBottom: 'none', background: dm ? (isOled ? 'linear-gradient(90deg, #1a0038 0%, #000000 320px)' : `linear-gradient(135deg, ${C.bg1} 0%, #1a1830 100%)`) : '#f7f8fc', backgroundAttachment: (isOled && !isMobile) ? 'fixed' : undefined, boxShadow: isOled ? '0 4px 32px rgba(139,92,246,0.08)' : dm ? '0 2px 16px rgba(0,0,0,0.25)' : '0 2px 12px rgba(99,102,241,0.08)' },
        inputArea: { ...styles.inputArea, backgroundColor: dm ? C.bg1 : '#f7f8fc', borderTop: 'none', boxShadow: isMobile ? 'none' : (isOled ? '0 -4px 24px rgba(139,92,246,0.06)' : dm ? '0 -2px 12px rgba(0,0,0,0.18)' : '0 -2px 10px rgba(99,102,241,0.07)'), padding: '8px 12px', gap: 8 },
        input: { ...styles.input, backgroundColor: 'transparent', border: 'none', boxShadow: 'none', padding: '8px 4px', color: dm ? '#e2e8f0' : 'inherit', flex: '1 1 0', minWidth: 0, fontSize: 14 },
        inputPill: { display: 'flex' as const, alignItems: 'flex-end' as const, gap: 0, flex: 1, minWidth: 0, background: isOled ? '#08080f' : dm ? C.bg4 : '#eef0f8', borderRadius: 24, border: 'none', padding: '2px 4px 2px 12px' },
        pillBtn: { background: 'none' as const, border: 'none' as const, cursor: 'pointer' as const, fontSize: 19, padding: '5px 4px', borderRadius: 8, color: dm ? (isOled ? '#6b5fa0' : '#5a5a7a') : '#b0b0c8', lineHeight: 1, flexShrink: 0, alignSelf: 'flex-end' as const, marginBottom: 3, transition: 'color 0.15s' as const },
        sendBtn2: { width: 40, height: 40, borderRadius: 20, background: isOled ? 'linear-gradient(135deg,#5b21b6,#7c3aed)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex' as const, alignItems: 'center' as const, justifyContent: 'center' as const, flexShrink: 0, alignSelf: 'flex-end' as const, marginBottom: 1, boxShadow: isOled ? '0 2px 12px rgba(124,58,237,0.45)' : '0 2px 10px rgba(99,102,241,0.4)', transition: 'all 0.15s' as const },
        chatName: { ...styles.chatName, color: dm ? '#e2e8f0' : '#1e1b4b' },
        chatItem: { ...styles.chatItem },
        sectionTitle: { ...styles.sectionTitle, color: dm ? (isOled ? 'rgba(167,139,250,0.45)' : '#4c4c7a') : '#a5b4fc' },
        headerText: { color: dm ? '#e2e8f0' : 'inherit' },
        profileCard: { ...styles.profileCard, backgroundColor: dm ? (isOled ? '#000000' : '#161625') : '#f0f1f8', borderTop: 'none', padding: '8px 16px', boxShadow: isMobile ? 'none' : (isOled ? '0 -4px 20px rgba(139,92,246,0.07)' : dm ? '0 -2px 12px rgba(0,0,0,0.18)' : '0 -2px 10px rgba(99,102,241,0.07)') },
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
    };

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
            {!isMobile && (
            <button
                onClick={cycleSidebar}
                title={sidebarState === 'full' ? t('Compact mode') : sidebarState === 'compact' ? t('Hide panel') : t('Show panel')}
                style={{ position: 'absolute', left: sidebarHidden ? 0 : sidebarCompact ? 64 : 320, top: '50%', transform: 'translateY(-50%)', zIndex: 30, width: isOled ? 14 : 16, height: isOled ? 44 : 48, borderRadius: '0 10px 10px 0', border: 'none', borderLeft: 'none', background: isOled ? '#000000' : (!dm ? 'white' : '#1e1a3d'), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOled ? '#a78bfa' : (dm ? '#a5b4fc' : '#6366f1'), fontSize: 9, boxShadow: isOled ? 'none' : (dm ? '2px 0 8px rgba(0,0,0,0.3)' : '2px 0 8px rgba(99,102,241,0.1)'), padding: 0, transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)' }}
            >
                {sidebarState === 'full' ? '◀' : sidebarState === 'compact' ? '⊟' : '▶'}
            </button>
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
                    width: sidebarHidden ? 0 : sidebarCompact ? 64 : 320,
                    minWidth: 0,
                    transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
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
                ) : (
                <div style={{
                    ...styles.sidebarHeader,
                    background: !dm ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' : (isOled ? 'linear-gradient(90deg, #1a0038 0%, #000000 320px)' : 'linear-gradient(135deg, #1e1a3d 0%, #2d2060 100%)'),
                    backgroundAttachment: (isOled && !isMobile) ? 'fixed' : undefined,
                    justifyContent: sidebarCompact ? 'center' : undefined,
                    padding: sidebarCompact ? '16px 0' : '16px',
                }}>
                    <img src="/logo192.png" alt="Aurora" style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, objectFit: 'cover' }} />
                    {!sidebarCompact && <>
                        <div style={{ flex: 1, lineHeight: 1.1 }}>
                            <span style={isOled
                                ? { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', color: '#d8b4fe' }
                                : dm
                                    ? { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', background: 'linear-gradient(90deg, #e0c4ff 0%, #a78bfa 55%, #818cf8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }
                                    : { fontWeight: 800, fontSize: 18, letterSpacing: '-0.5px', color: 'white' }
                            }>Aurora</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button
                                onClick={() => setShowMediaPlayer(v => !v)}
                                style={{ padding: '6px 10px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, backgroundColor: miniTrack ? (isOled ? 'rgba(167,139,250,0.25)' : (dm ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.3)')) : (isOled ? 'rgba(167,139,250,0.1)' : (dm ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.18)')), color: dm ? '#c4b5fd' : 'white', border: isOled ? '1px solid rgba(167,139,250,0.3)' : (dm ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.3)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 4, boxShadow: isOled ? '0 0 8px rgba(167,139,250,0.08)' : 'none' }}
                                title={lang === 'en' ? 'Media Player' : 'Медиаплеер'}
                            ><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></button>
                            <button
                                onClick={() => setShowHelp(true)}
                                style={{ padding: '6px 10px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, backgroundColor: isOled ? 'rgba(167,139,250,0.1)' : (dm ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.18)'), color: dm ? '#c4b5fd' : 'white', border: isOled ? '1px solid rgba(167,139,250,0.3)' : (dm ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.3)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 4, boxShadow: isOled ? '0 0 8px rgba(167,139,250,0.08)' : 'none' }}
                                title={lang === 'en' ? "What's new" : 'Что нового'}
                            ><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>
                        <div style={{ position: 'relative' }}>
                            <button
                                onClick={() => setShowCreateDropdown(v => !v)}
                                style={{ padding: '6px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, backgroundColor: isOled ? 'rgba(167,139,250,0.1)' : (dm ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.18)'), color: dm ? '#c4b5fd' : 'white', border: isOled ? '1px solid rgba(167,139,250,0.3)' : (dm ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.3)'), backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 4, boxShadow: isOled ? '0 0 8px rgba(167,139,250,0.08)' : 'none' }}
                            >
                                + <span style={{ fontSize: 10, marginTop: 1, opacity: 0.7 }}>▾</span>
                            </button>
                            {showCreateDropdown && (
                                <div
                                    className="floating-enter"
                                    style={{ position: 'absolute', top: '110%', right: 0, zIndex: 300, background: isOled ? '#080810' : (dm ? C.bg2 : 'white'), borderRadius: 14, boxShadow: isOled ? '0 0 30px rgba(124,58,237,0.3), 0 16px 40px rgba(0,0,0,0.9)' : dm ? '0 0 24px rgba(99,102,241,0.2), 0 12px 36px rgba(0,0,0,0.5)' : '0 0 20px rgba(99,102,241,0.1), 0 8px 28px rgba(0,0,0,0.14)', minWidth: 180, overflow: 'hidden', padding: '4px 0' }}
                                    onMouseLeave={() => setShowCreateDropdown(false)}
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
                            )}
                        </div>
                        </div>
                    </>}
                </div>
                )}

                {/* Sidebar search */}
                {!sidebarCompact && !showArchive && <div style={{ padding: '8px 10px', borderBottom: 'none', position: 'relative' }}>
                    <input
                        type="text"
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
                        style={{ width: '100%', boxSizing: 'border-box', padding: '7px 12px', borderRadius: 10, border: 'none', background: !dm ? '#f5f3ff' : (isOled ? C.bg4 : '#1e1e3a'), color: dm ? '#e0e0f0' : '#1e1b4b', fontSize: 13, outline: 'none', boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.14), 0 2px 10px rgba(139,92,246,0.08)' : dm ? '0 0 0 1px rgba(99,102,241,0.2)' : '0 0 0 1px rgba(99,102,241,0.2)', transition: 'box-shadow 0.15s' }}
                    />
                    {sidebarSearchFocused && (sidebarLocalMatches.users.length > 0 || sidebarLocalMatches.groups.length > 0 || sidebarSearchResults.length > 0 || sidebarChannelResults.length > 0 || sidebarSearchLoading || (!sidebarSearchQuery && (searchHistory.length > 0 || recentUsers.length > 0))) && (
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
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: u.avatar ? (dm ? C.bg1 : '#f7f8fc') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
                                                            {(u.tag === 'kayano' || u.tag === 'durov') && <span title={t('developer of Aurora')} style={{ flexShrink: 0, display: 'inline-flex', color: '#f59e0b' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{u.tag ? `@${u.tag}` : ((users.find(lu => lu.id === u.id) ?? u).is_online ? `🟢 ${t('Online')}` : t('Offline'))}</div>
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
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: u.avatar ? (dm ? C.bg1 : '#f7f8fc') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
                                                            {(u.tag === 'kayano' || u.tag === 'durov') && <span title={t('developer of Aurora')} style={{ flexShrink: 0, display: 'inline-flex', color: '#f59e0b' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>}
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
                                                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: u.avatar ? (dm ? C.bg1 : '#f7f8fc') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700, fontSize: 14 }}>
                                                        {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                                    </div>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e0e0f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
                                                            {(u.tag === 'kayano' || u.tag === 'durov') && <span title={t('developer of Aurora')} style={{ flexShrink: 0, display: 'inline-flex', color: '#f59e0b' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>}
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

                {/* Folder tabs */}
                {!sidebarCompact && !showArchive && folders.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', borderBottom: 'none' }}>
                    <div ref={folderTabsRef} style={{ display: 'flex', overflowX: 'auto', gap: 4, padding: '6px 8px', flex: 1, scrollbarWidth: 'none' }}>
                        <button
                            onClick={() => setActiveFolder(null)}
                            style={{ flexShrink: 0, padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                background: activeFolder === null ? (isOled ? '#7c3aed' : '#6366f1') : (dm ? (isOled ? 'rgba(167,139,250,0.07)' : 'rgba(99,102,241,0.12)') : '#f0f0ff'),
                                color: activeFolder === null ? 'white' : (dm ? (isOled ? '#c4b5fd' : '#a5b4fc') : '#6366f1'),
                                boxShadow: activeFolder === null && isOled ? '0 0 10px rgba(167,139,250,0.3)' : 'none' }}
                        >{lang === 'en' ? 'All' : 'Все'}</button>
                        {folders.map(f => {
                            const folderUnread = f.chats.reduce((sum, c) => sum + (unreadCounts[`${c.chat_type}-${c.chat_id}`] || 0), 0);
                            return (
                            <button key={f.id}
                                onClick={() => setActiveFolder(f.id)}
                                onContextMenu={e => { e.preventDefault(); setFolderCtxMenu({ x: e.clientX, y: e.clientY, folderId: f.id }); }}
                                style={{ flexShrink: 0, padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                    background: activeFolder === f.id ? f.color : (dm ? (isOled ? 'rgba(167,139,250,0.07)' : 'rgba(99,102,241,0.12)') : '#f0f0ff'),
                                    color: activeFolder === f.id ? 'white' : (dm ? (isOled ? '#c4b5fd' : '#a5b4fc') : '#6366f1'),
                                    display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                                {f.name}
                                {folderUnread > 0 && <span style={{ background: activeFolder === f.id ? 'rgba(255,255,255,0.3)' : f.color, color: 'white', fontSize: 10, fontWeight: 700, borderRadius: 8, padding: '1px 5px', lineHeight: 1.4 }}>{folderUnread > 99 ? '99+' : folderUnread}</span>}
                            </button>
                            );
                        })}
                    </div>
                    </div>
                )}

                <div style={darkStyles.sidebarScroll} onClick={() => pinMenu && setPinMenu(null)}>

                    {/* ─── Archive mode list ─── */}
                    {showArchive && (() => {
                        const archGroups = groups.filter(g => archivedChats.has(`group-${g.id}`));
                        const archUsers = users.filter(u => archivedChats.has(`private-${u.id}`));
                        const allArch = [
                            ...archGroups.map(g => ({ type: 'group' as const, item: g })),
                            ...archUsers.map(u => ({ type: 'user' as const, item: u })),
                        ].sort((a, b) => {
                            const ta = (a.item as any).last_msg_time || '';
                            const tb = (b.item as any).last_msg_time || '';
                            return tb.localeCompare(ta);
                        });
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
                        const folder = activeFolder !== null ? folders.find(f => f.id === activeFolder) : null;
                        const folderGroupIds = folder ? new Set(folder.chats.filter(c => c.chat_type === 'group').map(c => c.chat_id)) : null;
                        const folderUserIds = folder ? new Set(folder.chats.filter(c => c.chat_type === 'private').map(c => c.chat_id)) : null;
                        const visibleGroups = (folderGroupIds ? groups.filter(g => folderGroupIds.has(g.id)) : groups)
                            .filter(g => !archivedChats.has(`group-${g.id}`) && !hiddenChats.has(`group-${g.id}`));
                        const visibleUsers = (folderUserIds ? users.filter(u => folderUserIds.has(u.id)) : users)
                            .filter(u => !archivedChats.has(`private-${u.id}`) && !hiddenChats.has(`private-${u.id}`));

                        type ChatEntry = { kind: 'group'; data: Group } | { kind: 'user'; data: User } | { kind: 'favorites' };
                        const favKey = `private-${currentUserId}`;
                        const showFavorites = !archivedChats.has(favKey) && !hiddenChats.has(favKey)
                            && (!folderUserIds || folderUserIds.has(currentUserId));
                        const entries: ChatEntry[] = [
                            ...(showFavorites ? [{ kind: 'favorites' as const }] : []),
                            ...visibleGroups.map(g => ({ kind: 'group' as const, data: g })),
                            ...visibleUsers.map(u => ({ kind: 'user' as const, data: u })),
                        ];
                        const getKey = (e: ChatEntry) => e.kind === 'favorites' ? favKey : e.kind === 'group' ? `group-${e.data.id}` : `private-${e.data.id}`;
                        const getTime = (e: ChatEntry) => {
                            if (e.kind === 'favorites') return favoritesLastMsg?.time ? new Date(favoritesLastMsg.time).getTime() : 0;
                            const t = e.kind === 'group' ? (e.data as Group).last_msg_time : (e.data as User).last_msg_time;
                            return t ? new Date(t).getTime() : 0;
                        };
                        const sorted = entries.sort((a, b) => {
                            const pa = pinnedChats.has(getKey(a)) ? 1 : 0;
                            const pb = pinnedChats.has(getKey(b)) ? 1 : 0;
                            if (pa !== pb) return pb - pa;
                            return getTime(b) - getTime(a);
                        });

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
                                    style={{ ...darkStyles.chatItem, ...(activeChat?.type === 'private' && activeChat.id === currentUserId ? darkStyles.activeChatItem : {}), ...(sidebarCompact ? { justifyContent: 'center', padding: '6px 0' } : {}), position: 'relative' }}
                                >
                                    <div style={{ position: 'relative', flexShrink: 0 }}>
                                        <div style={{ ...styles.avatar, background: 'linear-gradient(135deg,#f59e0b,#f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', color: 'white' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>
                                        {pinnedChats.has(favKey) && <div style={{ position: 'absolute', top: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: dm ? C.bg4 : 'white', border: `1.5px solid ${dm ? C.bg1 : 'white'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, color: '#6366f1' }}><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg></div>}
                                    </div>
                                    {!sidebarCompact && <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                                            <div style={{ ...darkStyles.chatName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{lang === 'en' ? 'Favorites' : 'Избранное'}</div>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                                                {favoritesLastMsg?.time && <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', whiteSpace: 'nowrap' }}>{formatSidebarTime(favoritesLastMsg.time)}</div>}
                                                {unreadCounts[favKey] > 0 && <div className="badge-pop" style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', boxShadow: isOled ? '0 0 6px rgba(167,139,250,0.4)' : 'none' }}>{unreadCounts[favKey] > 99 ? '99+' : unreadCounts[favKey]}</div>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0, height: 18 }}>
                                            {renderSidebarSub(undefined, favoritesLastMsg?.text, favoritesLastMsg?.file, favoritesLastMsg?.filename, lang === 'en' ? 'Your saved messages' : 'Ваши сохранённые сообщения')}
                                        </div>
                                    </div>}
                                    {sidebarCompact && unreadCounts[favKey] > 0 && <div className="badge-pop" style={{ position: 'absolute', top: 4, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{unreadCounts[favKey] > 99 ? '99+' : unreadCounts[favKey]}</div>}
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
                                    {!sidebarCompact && <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                                            <div style={{ ...darkStyles.chatName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <span style={{ flexShrink: 0, display: 'inline-flex', color: dm ? '#7c7caa' : '#9ca3af' }}>
                                                    {group.is_channel
                                                        ? <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 3a1 1 0 00-1.447-.894L8.763 6H5a3 3 0 000 6h.28l1.771 5.316A1 1 0 008 18h1a1 1 0 001-1v-4.382l6.553 3.276A1 1 0 0018 15V3z" clipRule="evenodd"/></svg>
                                                        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
                                                </span>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</span>
                                                {!!group.is_channel && group.channel_tag === 'auroramessenger' && (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', flexShrink: 0 }}>
                                                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M2 6.5L4.5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                                                {group.last_msg_time && <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', whiteSpace: 'nowrap' }}>{formatSidebarTime(group.last_msg_time)}</div>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0, height: 18 }}>
                                            {(() => {
                                                const typing = !group.is_channel ? typingChats[`group-${group.id}`] : undefined;
                                                const senderLabel = group.is_channel ? '' : (group.last_msg_sender_id === currentUserId ? 'Вы: ' : group.last_msg_sender_name ? `${group.last_msg_sender_name}: ` : '');
                                                return renderSidebarSub(
                                                    typing ? `✍️ ${typing} ${t('is typing...')}` : undefined,
                                                    group.last_msg_text, group.last_msg_file, group.last_msg_filename,
                                                    group.last_msg_time ? '' : (group.member_count ? formatMembers(group.member_count, group.is_channel ? 'subscriber' : 'member', lang) : ''),
                                                    group.last_msg_time ? senderLabel : undefined
                                                );
                                            })()}
                                        </div>
                                    </div>}
                                    {!sidebarCompact && unreadCounts[`group-${group.id}`] > 0 && <div className="badge-pop" style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0, boxShadow: isOled ? '0 0 6px rgba(167,139,250,0.4)' : 'none' }}>{unreadCounts[`group-${group.id}`] > 99 ? '99+' : unreadCounts[`group-${group.id}`]}</div>}
                                    {sidebarCompact && unreadCounts[`group-${group.id}`] > 0 && <div className="badge-pop" style={{ position: 'absolute', top: 4, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', boxShadow: isOled ? '0 0 6px rgba(167,139,250,0.4)' : 'none' }}>{unreadCounts[`group-${group.id}`] > 99 ? '99+' : unreadCounts[`group-${group.id}`]}</div>}
                                </div>
                            ); } else { const user = entry.data as User; return (
                                <div
                                    key={`u-${user.id}`}
                                    onClick={() => selectPrivateChat(user)}
                                    onContextMenu={e => { e.preventDefault(); setPinMenu({ x: e.clientX, y: e.clientY, key: `private-${user.id}` }); }}
                                    className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}
                                    style={{ ...darkStyles.chatItem, ...(activeChat?.type === 'private' && activeChat.id === user.id ? darkStyles.activeChatItem : {}), ...(sidebarCompact ? { justifyContent: 'center', padding: '6px 0' } : {}), position: 'relative' }}
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
                                    {!sidebarCompact && <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                                            <div style={{ ...darkStyles.chatName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.username}</span>
                                                {user.is_developer && <span title={t('developer of Aurora')} style={{ flexShrink: 0, cursor: 'default', display: 'inline-flex', color: '#f59e0b' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                                                {user.last_msg_sender_id === currentUserId && (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                        {(lastReadByOther[user.id] || user.last_msg_is_read) ? (
                                                            <svg width="18" height="11" viewBox="0 0 18 11" fill="none"><path d="M1 5.5L4.5 9L11 2" stroke={isOled ? '#7c6aaa' : (dm ? '#5a5a8a' : '#9ca3af')} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 5.5L9.5 9L16 2" stroke={isOled ? '#a78bfa' : '#93c5fd'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                        ) : (
                                                            <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 5L4.5 8.5L11 1.5" stroke={isOled ? '#6b5a8a' : (dm ? '#5a5a8a' : '#a5b4fc')} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                        )}
                                                    </span>
                                                )}
                                                {user.last_msg_time && <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af', whiteSpace: 'nowrap' }}>{formatSidebarTime(user.last_msg_time)}</div>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0, height: 18 }}>
                                            {renderSidebarSub(
                                                (typingChats[`private-${user.id}`] && user.id !== currentUserId) ? `✍️ ${t('is typing...')}` : undefined,
                                                user.last_msg_text, user.last_msg_file, user.last_msg_filename,
                                                user.last_msg_time ? '' : blockedUserIds.has(user.id) ? (lang === 'en' ? '🚫 Blocked' : '🚫 Заблокирован') : user.last_seen === 'blocked_you' ? (lang === 'en' ? 'last seen a long time ago' : 'был(а) давно') : (user.is_online ? `🟢 ${t('Online')}` : user.last_seen === 'hidden' ? t('last seen recently') : user.last_seen ? `${t('last seen')} ${formatLastSeen(user.last_seen)}` : user.status || t('private chat')),
                                                undefined,
                                                user.id
                                            )}
                                        </div>
                                    </div>}
                                    {!sidebarCompact && unreadCounts[`private-${user.id}`] > 0 && <div className="badge-pop" style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0, boxShadow: isOled ? '0 0 6px rgba(167,139,250,0.4)' : 'none' }}>{unreadCounts[`private-${user.id}`] > 99 ? '99+' : unreadCounts[`private-${user.id}`]}</div>}
                                    {sidebarCompact && unreadCounts[`private-${user.id}`] > 0 && <div className="badge-pop" style={{ position: 'absolute', top: 4, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', boxShadow: isOled ? '0 0 6px rgba(167,139,250,0.4)' : 'none' }}>{unreadCounts[`private-${user.id}`] > 99 ? '99+' : unreadCounts[`private-${user.id}`]}</div>}
                                </div>
                            ); } })}
                        </div>
                        );
                    })()}
                </div>

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
                <div className="sidebar-profile-card" style={{ ...darkStyles.profileCard, ...(sidebarCompact ? { justifyContent: 'center', padding: '8px 0' } : {}) }}>
                    <div style={{ ...styles.profileAvatar, backgroundColor: currentUserAvatar ? (dm ? C.bg1 : '#f7f8fc') : avatarBg }} onClick={() => setShowSettings(true)}>
                        {currentUserAvatar
                            ? <img src={config.fileUrl(currentUserAvatar) ?? undefined} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                            : <span style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>{currentUsername[0]?.toUpperCase()}</span>
                        }
                    </div>
                    {!sidebarCompact && <>
                        <div style={styles.profileInfo}>
                            <div style={{ ...darkStyles.profileName, display: 'flex', alignItems: 'center', gap: 4 }}>
                                {currentUsername}
                                {(currentUserTag === 'kayano' || currentUserTag === 'durov') && <span title={t('developer of Aurora')} style={{ cursor: 'default', display: 'inline-flex', color: '#f59e0b', flexShrink: 0 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>}
                            </div>
                            {currentUserTag && <div style={styles.profileStatus}>@{currentUserTag}</div>}
                        </div>
                        <button onClick={() => setShowSettings(true)} style={{
                            ...styles.settingsBtn,
                            width: 32, height: 32, padding: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: `1px solid ${isOled ? 'rgba(167,139,250,0.2)' : dm ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.18)'}`,
                            background: isOled ? 'rgba(167,139,250,0.06)' : dm ? 'rgba(99,102,241,0.07)' : 'rgba(99,102,241,0.05)',
                            borderRadius: 10,
                            color: isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1',
                            boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.2), 0 2px 12px rgba(139,92,246,0.18)' : dm ? '0 0 0 1px rgba(99,102,241,0.22), 0 2px 10px rgba(99,102,241,0.14)' : 'none',
                            transition: 'all 0.15s',
                        }} title={t('Settings')}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                            </svg>
                        </button>
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
                        <div className={isMobile ? 'mobile-chat-header' : undefined} style={{ ...darkStyles.chatHeader, ...(isMobile ? { padding: '0 10px', height: 56, minHeight: 56, maxHeight: 56 } : {}) }}>
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
                                    const chatUser = activeChat.type === 'private' ? users.find(u => u.id === activeChat.id) : null;
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
                                            style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: '50%', background: isSelf ? 'linear-gradient(135deg,#f59e0b,#f97316)' : (src ? 'transparent' : bg), display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, cursor: (canClick || canClickGroup) ? 'pointer' : 'default', boxShadow: isBlocked ? 'none' : `0 0 10px ${bg}66` }}
                                            onClick={() => {
                                                if (canClick) { const u = users.find(u => u.id === activeChat.id); if (u) setSelectedUserForProfile(u); }
                                                if (canClickGroup) { setSelectedGroupId(activeChat.id); setShowGroupInfo(true); }
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
                                            placeholder={t('Search in chat...')}
                                            style={{ flex: 1, padding: '7px 12px', borderRadius: 10, border: 'none', background: dm ? (isOled ? '#0a0a12' : C.bg4) : '#eef0f8', color: dm ? '#e2e8f0' : '#1e1b4b', fontSize: 14, outline: 'none', minWidth: 0, boxShadow: isOled ? '0 0 0 1px rgba(167,139,250,0.14)' : dm ? '0 0 0 1.5px rgba(99,102,241,0.2)' : '0 0 0 1.5px rgba(99,102,241,0.15)' }}
                                        />
                                        {chatSearchQuery.length > 0 && (
                                            <span style={{ fontSize: 12, color: dm ? '#7c7caa' : '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                {!chatSearchQuery.trim()
                                                    ? (lang === 'en' ? `${messages.length} messages` : `${messages.length} сообщений`)
                                                    : chatSearchMatches.length > 0
                                                        ? `${chatSearchIdx + 1} / ${chatSearchMatches.length}`
                                                        : t('No results')}
                                            </span>
                                        )}
                                        <button onClick={() => goToChatSearchMatch(chatSearchIdx - 1)} disabled={chatSearchMatches.length === 0} style={darkStyles.iconBtn} title={lang === 'en' ? 'Previous (Shift+Enter)' : 'Предыдущий (Shift+Enter)'}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                                        <button onClick={() => goToChatSearchMatch(chatSearchIdx + 1)} disabled={chatSearchMatches.length === 0} style={darkStyles.iconBtn} title={lang === 'en' ? 'Next (Enter)' : 'Следующий (Enter)'}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                                        <button onClick={() => { setChatSearchOpen(false); setChatSearchQuery(''); }} style={darkStyles.iconBtn} title={t('Close')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: dm ? '#e2e8f0' : '#1e1b4b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {activeChat.name.replace(/^⭐\s*/, '')}
                                                {activeChat.type === 'private' && users.find(u => u.id === activeChat.id)?.is_developer && <span title={t('developer of Aurora')} style={{ flexShrink: 0, cursor: 'default', display: 'inline-flex', color: '#f59e0b' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>}
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
                                                        const u = users.find(u => u.id === activeChat.id);
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
                                                <span style={{ fontWeight: 600, fontStyle: 'normal' }}>{typingUser}</span> {t('is typing...')}
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: isMobile ? 4 : 8 }}>
                                {/* Call buttons — only for DM (not self, not blocked), hidden on mobile to save space */}
                                {!isMobile && !chatSearchOpen && activeChat.type === 'private' && activeChat.id !== currentUserId && !blockedUserIds.has(activeChat.id) && users.find(u => u.id === activeChat.id)?.last_seen !== 'blocked_you' && callInfo.state === 'idle' && (
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
                                {!chatSearchOpen && (activeChat.type === 'private' || isGroupAdmin) && (
                                    <button onClick={handleClearChat} style={darkStyles.iconBtn} title={t('Clear')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
                                )}
                                {!chatSearchOpen && activeChat.type === 'group' && isGroupAdmin && !isChannelChat && (
                                    <button onClick={() => { setSelectedGroupId(activeChat.id); setShowInviteModal(true); }} style={darkStyles.iconBtn} title={t('Invite')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg></button>
                                )}
                            </div>
                        </div>



                        {/* Закреплённое сообщение */}
                        {(() => {
                            const chatKey = `${activeChat.type}-${activeChat.id}`;
                            const pinned = pinnedMessages[chatKey];
                            if (!pinned) return null;
                            return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', background: isOled ? '#000000' : (dm ? '#181828' : '#f5f3ff'), borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.15)' : (dm ? 'rgba(99,102,241,0.18)' : '#ede9fe')}`, cursor: 'pointer', flexShrink: 0 }}
                                    onClick={() => { const el = document.getElementById(`msg-${pinned.id}`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.transition = 'background 0.3s'; el.style.background = 'rgba(99,102,241,0.18)'; setTimeout(() => { el.style.background = ''; }, 1500); } }}>
                                    <div style={{ width: 3, height: 32, borderRadius: 2, background: '#6366f1', flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: '#6366f1', display: 'flex', alignItems: 'center', gap: 4 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5H19l-4.5 3.3 1.7 5.2L12 12.3l-4.2 3.2 1.7-5.2L5 7h5.5z"/><line x1="12" y1="17" x2="12" y2="22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg> {t('Pinned message')}</div>
                                        <div style={{ fontSize: 12, color: dm ? '#9090b0' : '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pinned.text}</div>
                                    </div>
                                    <button onClick={e => { e.stopPropagation(); togglePinMessage(`${activeChat.type}-${activeChat.id}`, { id: pinned.id, message_text: pinned.text }); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#aaa', padding: '0 2px', display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                </div>
                            );
                        })()}

                        {/* Сообщения */}
                        <div
                            key={chatKey}
                            ref={messagesContainerRef}
                            className="chat-enter"
                            style={{ ...styles.messagesArea, backgroundColor: dm ? C.bg0 : '#f2f4f8', overflowAnchor: 'none', paddingRight: isMobile ? 10 : 24, paddingLeft: isMobile ? 10 : 24, paddingTop: isMobile ? 12 : 20, position: 'relative' }}
                            onScroll={e => {
                                const el = e.currentTarget;
                                const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                                setShowScrollDown(distFromBottom > 200);
                                if (activeChat) scrollPositions.current.set(`${activeChat.type}-${activeChat.id}`, el.scrollTop);
                            }}
                        >
                            {(() => {
                                const filtered = messages.filter(m => !m.is_deleted);
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
                                                style={{ position: 'relative', margin: '0 auto 12px auto', maxWidth: 600, background: isOled ? (isActive ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.02)') : (dm ? (isActive ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.04)') : (isActive ? 'rgba(99,102,241,0.05)' : 'rgba(255,255,255,0.9)')), backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 18, padding: '14px 16px', boxShadow: isActive ? (isOled ? '0 0 0 1.5px rgba(167,139,250,0.5), 0 8px 32px rgba(124,58,237,0.25)' : dm ? '0 0 0 1.5px rgba(99,102,241,0.5), 0 8px 28px rgba(99,102,241,0.2)' : '0 0 0 1.5px rgba(99,102,241,0.35), 0 6px 24px rgba(99,102,241,0.12)') : (isOled ? '0 4px 20px rgba(0,0,0,0.7), 0 0 0 1px rgba(167,139,250,0.06)' : dm ? '0 4px 16px rgba(0,0,0,0.35), 0 0 0 1px rgba(99,102,241,0.06)' : '0 2px 12px rgba(99,102,241,0.07), 0 0 0 1px rgba(99,102,241,0.04)'), transition: 'all 0.2s' }}>
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
                                                                                        title="Все эмодзи">
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
                                    const senderUser = !isOwn ? (users.find(u => u.id === msg.sender_id) || groupMembersCache[activeChat.id]?.find(u => u.id === msg.sender_id) as any) : null;
                                    const senderAvatar = ('sender_avatar' in msg ? (msg as any).sender_avatar : null) || senderUser?.avatar || null;
                                    const senderAvatarColor = (msg as any).sender_avatar_color || senderUser?.avatar_color || '#6366f1';
                                    const senderInitial = ((msg as any).sender_name || senderUser?.username || '?')[0]?.toUpperCase() || '?';
                                    const hasReactions = (reactions[msg.id]?.length || 0) > 0;
                                    const isSelected = selectedMsgIds.has(msg.id);
                                    items.push(
                                    <div
                                        key={msg.id}
                                        id={`msg-${msg.id}`}
                                        className={deletingMsgIds.has(msg.id) ? 'msg-delete' : 'msg-in'}
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

                                        <div style={{ position: 'relative', display: 'inline-block', maxWidth: isMediaOnlyMsg(msg) ? (isMobile ? '88%' : '72%') : (isMobile ? '82%' : '62%') }}>
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
                                                return {
                                                    maxWidth: '100%',
                                                    padding: '10px 14px',
                                                    borderRadius: isOwn ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
                                                    wordBreak: 'break-word' as const,
                                                    fontSize: theme.fontSize,
                                                    boxShadow: isOwn ? '0 2px 10px rgba(99,102,241,0.25)' : `0 2px 8px rgba(0,0,0,${dm ? '0.2' : '0.07'})`,
                                                    ...(isOwn
                                                        ? { background: isOled
                                                                ? `linear-gradient(135deg, #3b1f6e, #4c1d95)`
                                                                : `linear-gradient(135deg, ${theme.bubbleOwnColor}, #8b5cf6)`, color: 'white' }
                                                        : isOled
                                                            ? { background: `linear-gradient(135deg, #04040e, #080818)`, color: '#c4b5fd' }
                                                            : dm
                                                                ? { background: theme.bubbleOtherColor === '#e8e8e8' ? `linear-gradient(135deg, #18183a, #1e1e52)` : `linear-gradient(135deg, ${theme.bubbleOtherColor}, ${theme.bubbleOtherColor}cc)`, color: '#dde0f8' }
                                                                : { background: theme.bubbleOtherColor === '#e8e8e8' ? `linear-gradient(135deg, #f5f3ff, #ede9fe)` : `linear-gradient(135deg, ${theme.bubbleOtherColor}ee, ${theme.bubbleOtherColor})`, color: '#1e1b4b' }
                                                    ),
                                                };
                                            })()}
                                        >
                                            {!isOwn && 'sender_name' in msg && (() => {
                                                const bubbleBg = isOled ? '#04040e' : dm
                                                    ? (theme.bubbleOtherColor === '#e8e8e8' ? '#18183a' : theme.bubbleOtherColor)
                                                    : (theme.bubbleOtherColor === '#e8e8e8' ? '#f5f3ff' : theme.bubbleOtherColor);
                                                const nameColor = isBgDark(bubbleBg) ? '#c4b5fd' : '#6366f1';
                                                return <div style={{ ...styles.senderName, color: nameColor, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    {msg.sender_name}
                                                    {((msg as any).sender_is_developer || users.find(u => u.id === (msg as any).sender_id)?.is_developer) && <span title={t('developer of Aurora')} style={{ flexShrink: 0, cursor: 'default', display: 'inline-flex', color: '#f59e0b' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>}
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

                                            {editingMessageId !== msg.id && msg.message_text && (() => {
                                                const isRead = (msg as any).is_read;
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
                                                const displayText = isPrivate ? getDisplayText(msg, activeChat!.id) : (msg.message_text || '');
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
                                                if (!encLocked && isCallEnded(msg.message_text)) {
                                                    const dur = getCallDuration(msg.message_text);
                                                    const mins = Math.floor(dur / 60), secs = dur % 60;
                                                    const durStr = dur > 0 ? ` · ${mins > 0 ? `${mins} мин ` : ''}${secs} сек` : '';
                                                    return (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', color: isOwn ? 'rgba(255,255,255,0.85)' : (dm ? '#a5b4fc' : '#6366f1') }}>
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l1.8-1.8a2 2 0 0 1 2.11-.45c.9.32 1.85.55 2.81.68a2 2 0 0 1 1.72 2.03z"/></svg>
                                                            <span style={{ fontSize: 13, fontWeight: 500 }}>{lang === 'en' ? 'Call ended' : 'Звонок завершён'}{durStr}</span>
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
                                                return (
                                                    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: hasFile ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                        {encLocked ? (
                                                            <span style={{ opacity: 0.7, fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Зашифровано</span>
                                                        ) : fwdMatch ? (
                                                            renderTextWithLinks(fwdBody, (uname => { const u = users.find(x => x.tag === uname || x.username === uname) || (groupMembersCache[activeChat!.id]?.find(x => (x as any).tag === uname || x.username === uname) as any); if (u) setSelectedUserForProfile(u as any); }), isOwn ? 'rgba(255,255,255,0.9)' : (isOled ? '#c4b5fd' : (dm ? '#a78bfa' : '#6366f1')))
                                                        ) : (
                                                            renderTextWithLinks(displayText, (uname => { const u = users.find(x => x.tag === uname || x.username === uname) || (groupMembersCache[activeChat!.id]?.find(x => (x as any).tag === uname || x.username === uname) as any); if (u) setSelectedUserForProfile(u as any); }), isOwn ? 'rgba(255,255,255,0.9)' : (isOled ? '#c4b5fd' : (dm ? '#a78bfa' : '#6366f1')))
                                                        )}
                                                    </div>
                                                );
                                            })()}

                                            {!isSpecialMsg(msg.message_text) && (
                                            <div style={{ ...styles.timestamp, display: 'flex', alignItems: 'center', gap: 4, justifyContent: isOwn ? 'flex-end' : 'flex-start', ...(isMediaOnlyMsg(msg) ? { position: 'absolute' as const, bottom: 6, right: 10, backgroundColor: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.92)', borderRadius: 8, padding: '2px 7px', opacity: 1 } : {}) }}>
                                                {msg.edited_at && <span style={{ opacity: 0.6, marginRight: 4 }}>{t('edited')}</span>}
                                                {formatTime(msg.timestamp)}
                                                {isOwn && (
                                                    <span title={(msg as any).is_read ? (lang === 'en' ? 'Read' : 'Прочитано') : (lang === 'en' ? 'Delivered' : 'Доставлено')} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
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
                                                            {new Date(sm.scheduled_at).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
                                        style={{ pointerEvents: 'all', width: 40, height: 40, borderRadius: '50%', background: isOled ? '#050508' : (dm ? '#2d2b5a' : 'white'), border: `1.5px solid ${isOled ? 'rgba(167,139,250,0.35)' : (dm ? 'rgba(99,102,241,0.35)' : '#d0caff')}`, boxShadow: isOled ? '0 4px 16px rgba(0,0,0,0.8), 0 0 0 1px rgba(167,139,250,0.1)' : '0 4px 16px rgba(99,102,241,0.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: isOled ? '#c4b5fd' : (dm ? '#a5b4fc' : '#6366f1'), transition: 'opacity 0.2s' }}
                                        title={lang === 'en' ? 'Scroll to latest' : 'К последнему сообщению'}
                                    >↓</button>
                                </div>
                            )}
                        </div>

                        {/* Channel: Comments overlay */}
                        {isChannelChat && commentPostId !== null && (() => {
                            const post = messages.find(m => m.id === commentPostId);
                            const comments = messages.filter(m => (m as any).reply_to_id === commentPostId && !m.is_deleted);
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
                                            const ownBubbleBg = isOled ? 'linear-gradient(135deg,#3b1f6e,#4c1d95)' : `linear-gradient(135deg,${theme.bubbleOwnColor},#8b5cf6)`;
                                            const otherBubbleBg = isOled ? 'rgba(20,12,40,0.9)' : (dm ? 'rgba(30,30,60,0.8)' : 'rgba(255,255,255,0.95)');
                                            const otherBubbleBorder = isOled ? '1px solid rgba(167,139,250,0.12)' : dm ? '1px solid rgba(99,102,241,0.15)' : '1px solid rgba(99,102,241,0.1)';
                                            const otherBubbleShadow = isOled ? '0 2px 12px rgba(0,0,0,0.5)' : dm ? '0 2px 8px rgba(0,0,0,0.2)' : '0 2px 8px rgba(99,102,241,0.08)';
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
                                                                {c.file_path && <FileMessage filePath={c.file_path} filename={(c as any).filename || ''} fileSize={(c as any).file_size} isOwn={isOwn2} isDark={dm} onPlay={playGlobalAudio} nowPlayingSrc={nowPlaying?.src} globalPlaying={globalPlaying} globalCurrentTime={globalCurrentTime} />}
                                                            </>
                                                        )}
                                                        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: isOwn2 ? 'right' : 'left' }}>{new Date(c.timestamp).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
                                                    </div>
                                                    {hoveredCommentId === c.id && !isEditingThis && (
                                                        <div style={{ position: 'absolute', [isOwn2 ? 'left' : 'right']: 40, bottom: 0, display: 'flex', gap: 2, background: isOled ? '#0a0a14' : dm ? C.bg3 : 'white', border: `1px solid ${dm ? C.bdr2 : '#e0deff'}`, borderRadius: 10, padding: '3px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 5 }}>
                                                            <button title={t('Reply')} onClick={() => setCommentReplyTo({ id: c.id, name: cName, text: stripCommentReplyPrefix(c.message_text) })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', color: dm ? '#a5b4fc' : '#6366f1', display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></button>
                                                            <button title={lang === 'en' ? 'Forward' : 'Переслать'} onClick={() => setForwardingMessages([{ ...c, message_text: stripCommentReplyPrefix(c.message_text) }])} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', color: dm ? '#a5b4fc' : '#6366f1', display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg></button>
                                                            {canEdit && <button title={t('Edit')} onClick={() => { setEditingCommentId(c.id); setEditingCommentText(stripCommentReplyPrefix(c.message_text) || ''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', color: dm ? '#a5b4fc' : '#6366f1', display: 'flex', alignItems: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>}
                                                            {canDelete && <button title={t('Delete')} onClick={() => { setDeleteConfirmId(c.id); setMenuMessageId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', color: '#ef4444', display: 'flex', alignItems: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>}
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
                        {editingMessageId && (
                            <div className="bar-enter" style={{ padding: '8px 16px', backgroundColor: dm ? C.bg2 : '#f0efff', borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.2)' : '#d9d6fe'}`, borderLeft: `3px solid ${isOled ? '#a78bfa' : '#6366f1'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isOled ? '#a78bfa' : '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: isOled ? '#a78bfa' : '#6366f1', marginBottom: 1 }}>{lang === 'en' ? 'Editing message' : 'Редактирование'}</div>
                                        <div style={{ fontSize: 12, color: dm ? '#9090b8' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editingText.slice(0, 80)}</div>
                                    </div>
                                </div>
                                <button onClick={() => { setEditingMessageId(null); setEditingText(''); if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = 'auto'; } }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', padding: '2px 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
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
                                <div className="bar-enter" style={{ padding: '8px 16px', backgroundColor: dm ? C.bg2 : '#f0efff', borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.2)' : '#d9d6fe'}`, borderLeft: `3px solid #6366f1`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                        {replyImgSrc && <img src={replyImgSrc} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />}
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#8b5cf6', marginBottom: 2 }}>↩️ {replyTo.sender_name || t('Reply')}</div>
                                            <div style={{ fontSize: 12, color: dm ? '#9090b8' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {replyTo.message_text?.slice(0, 80) || replyFileLabel || `📎 ${lang === 'en' ? 'file' : 'файл'}`}
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', padding: '2px 4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                </div>
                            );
                        })()}

                        {/* Staging area */}
                        {pendingFiles.length > 0 && (
                            <div className="bar-enter" style={{ padding: '8px 16px', backgroundColor: dm ? C.bg2 : '#f5f3ff', borderTop: `1px solid ${dm ? 'rgba(99,102,241,0.2)' : '#ede9fe'}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <span style={{ fontSize: 11, color: dm ? '#7c7caa' : '#9ca3af', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> {pendingFiles.length} / 10 {lang === 'en' ? `file${pendingFiles.length === 1 ? '' : 's'}` : `файл${pendingFiles.length === 1 ? '' : pendingFiles.length < 5 ? 'а' : 'ов'}`}
                                    </span>
                                    <button onClick={() => setPendingFiles([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', fontSize: 12, padding: 0 }}>{lang === 'en' ? 'Remove all' : 'Убрать все'}</button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {pendingFiles.map((f, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', backgroundColor: dm ? C.bg5 : 'white', border: `1px solid ${dm ? C.bdr2 : '#ede9fe'}`, borderRadius: 10, fontSize: 12, maxWidth: 180 }}>
                                            <span style={{ display: 'inline-flex', color: dm ? '#a5b4fc' : '#6366f1' }}>{/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.name) ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> : /\.(mp4|webm|mov)$/i.test(f.name) ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> : /\.(mp3|ogg|wav|flac|aac|m4a)$/i.test(f.name) ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}</span>
                                            <span style={{ color: dm ? '#c0c0d8' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
                                            <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#a5b4fc', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                        </div>
                                    ))}
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
                                        onClick={() => setBulkDeleteConfirm(true)}
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
                        {!selectionMode && !isDeletedUser && (!isChannelChat || isGroupAdmin) && <div className="chat-input-area" style={{ ...darkStyles.inputArea, position: 'relative' }}>
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
                                <div className="floating-enter" style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 200, background: dm ? C.bg2 : 'white', border: `1px solid ${dm ? C.bdr2 : '#ede9fe'}`, borderRadius: 12, boxShadow: '0 -4px 24px rgba(0,0,0,0.18)', padding: '12px 16px', marginBottom: 4 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#a5b4fc' : '#6366f1', marginBottom: 10 }}>
                                        {lang === 'en' ? 'Schedule message' : 'Отложить сообщение'}
                                    </div>
                                    <input
                                        type="datetime-local"
                                        value={scheduleDateTime}
                                        min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                                        onChange={e => setScheduleDateTime(e.target.value)}
                                        style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${dm ? C.bdr2 : '#d1d5db'}`, background: dm ? C.bg1 : '#f9f9ff', color: dm ? '#e0e0f0' : '#1e1b4b', fontSize: 13, boxSizing: 'border-box' as const, marginBottom: 10 }}
                                    />
                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                        <button onClick={() => { setShowSchedulePicker(false); setScheduleDateTime(''); }} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${dm ? C.bdr2 : '#e0e0f0'}`, background: 'transparent', color: dm ? '#9ca3af' : '#6b7280', cursor: 'pointer', fontSize: 13 }}>
                                            {lang === 'en' ? 'Cancel' : 'Отмена'}
                                        </button>
                                        <button onClick={sendScheduled} disabled={!scheduleDateTime} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: scheduleDateTime ? '#6366f1' : (dm ? '#2a2a4a' : '#e0e0f0'), color: scheduleDateTime ? 'white' : (dm ? '#5a5a8a' : '#9ca3af'), cursor: scheduleDateTime ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}>
                                            {lang === 'en' ? 'Schedule' : 'Запланировать'}
                                        </button>
                                    </div>
                                </div>
                            )}
                            {/* @mention dropdown */}
                            {mentionQuery !== null && activeChat?.type === 'group' && (() => {
                                const members = groupMembersCache[activeChat.id] || [];
                                const q = mentionQuery.toLowerCase();
                                const filtered = members.filter(m =>
                                    (m.username.toLowerCase().includes(q) || (m.tag || '').toLowerCase().includes(q))
                                ).slice(0, 6);
                                if (filtered.length === 0) return null;
                                return (
                                    <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, zIndex: 100, background: dm ? C.bg2 : 'white', border: `1px solid ${dm ? C.bdr2 : '#ede9fe'}`, borderRadius: 12, boxShadow: '0 -4px 24px rgba(0,0,0,0.18)', overflow: 'hidden', marginBottom: 4 }}>
                                        {filtered.map((m, i) => (
                                            <div key={m.id}
                                                onMouseDown={e => {
                                                    e.preventDefault();
                                                    if (!inputRef.current) return;
                                                    const val = inputRef.current.value;
                                                    const pos = mentionAnchorPos.current;
                                                    const before = val.slice(0, pos);
                                                    const match = before.match(/@(\w*)$/);
                                                    const handle = m.tag || m.username;
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
                                                }}
                                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', background: i === mentionIndex ? (dm ? 'rgba(99,102,241,0.18)' : '#f0eeff') : 'transparent' }}
                                                onMouseEnter={() => setMentionIndex(i)}
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
                                <button onClick={() => setShowEmojiPicker(p => !p)} style={{ ...darkStyles.pillBtn, color: showEmojiPicker ? (dm ? '#a5b4fc' : '#6366f1') : (dm ? (isOled ? '#a78bfa' : '#7c7caa') : '#9ca3af') }} title="Эмодзи"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>
                                <textarea
                                    ref={inputRef}
                                    rows={1}
                                    defaultValue=""
                                    onKeyDown={(e) => {
                                        if (mentionQuery !== null && activeChat?.type === 'group') {
                                            const members = groupMembersCache[activeChat.id] || [];
                                            const filtered = members.filter(m => (m.username.toLowerCase().includes(mentionQuery.toLowerCase()) || (m.tag || '').toLowerCase().includes(mentionQuery.toLowerCase()))).slice(0, 6);
                                            if (filtered.length > 0) {
                                                if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, filtered.length - 1)); return; }
                                                if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
                                                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                                                    e.preventDefault();
                                                    const m = filtered[mentionIndex];
                                                    if (m && inputRef.current) {
                                                        const val = inputRef.current.value;
                                                        const pos = mentionAnchorPos.current;
                                                        const before = val.slice(0, pos);
                                                        const match = before.match(/@(\w*)$/);
                                                        const handle = m.tag || m.username;
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
                                                    }
                                                    return;
                                                }
                                                if (e.key === 'Escape') { setMentionQuery(null); return; }
                                            }
                                        }
                                        if (e.key === 'Escape' && editingMessageId) { setEditingMessageId(null); setEditingText(''); if (inputRef.current) { inputRef.current.value = ''; inputRef.current.style.height = 'auto'; } return; }
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                                    }}
                                    onKeyUp={handleTyping}
                                    onInput={(e) => {
                                        autoResize(e.currentTarget);
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
                                            setTimeout(() => { if (inputRef.current) autoResize(inputRef.current); }, 0);
                                        }
                                    }}
                                    placeholder={isChannelChat ? t('Write a post...') : t('Type a message...')}
                                    style={{ ...darkStyles.input, ...(isMobile ? { fontSize: 16 } : {}) }}
                                />
                                <div style={{ position: 'relative', alignSelf: 'flex-end', marginBottom: 2 }}>
                                    <button onClick={() => setShowAttachMenu(p => !p)} style={{ ...darkStyles.pillBtn, marginBottom: 0, color: showAttachMenu ? (dm ? '#a5b4fc' : '#6366f1') : (dm ? (isOled ? '#a78bfa' : '#7c7caa') : '#9ca3af') }}>
                                        {uploading ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>}
                                    </button>
                                {showAttachMenu && (
                                    <div style={{ position: 'absolute', bottom: '110%', left: 0, zIndex: 200, background: isOled ? '#000000' : (dm ? '#1a1a2e' : 'white'), border: `1px solid ${isOled ? 'rgba(167,139,250,0.2)' : (dm ? 'rgba(99,102,241,0.25)' : '#e5e7eb')}`, borderRadius: 12, boxShadow: isOled ? '0 4px 32px rgba(0,0,0,0.9), 0 0 0 1px rgba(167,139,250,0.1)' : '0 4px 24px rgba(0,0,0,0.2)', overflow: 'hidden', minWidth: 160 }} onMouseLeave={() => setShowAttachMenu(false)}>
                                        <button onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer', color: isOled ? '#c4b5fd' : (dm ? '#e2e8f0' : '#1e1b4b'), fontSize: 14, textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> {lang === 'en' ? 'File' : 'Файл'}
                                        </button>
                                        {activeChat?.type === 'group' && (
                                        <button onClick={() => { setShowAttachMenu(false); setShowPollCreator(true); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer', color: isOled ? '#c4b5fd' : (dm ? '#e2e8f0' : '#1e1b4b'), fontSize: 14, textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> {lang === 'en' ? 'Poll' : 'Опрос'}
                                        </button>
                                        )}
                                        {serverInfo?.storage === 'cloudinary' && (
                                            <div style={{ padding: '6px 16px 10px', fontSize: 11, color: isOled ? 'rgba(167,139,250,0.5)' : (dm ? '#6060a0' : '#9ca3af'), borderTop: `1px solid ${isOled ? 'rgba(167,139,250,0.1)' : (dm ? 'rgba(99,102,241,0.12)' : '#f0eeff')}` }}>
                                                ☁️ {lang === 'en'
                                                    ? `Image ≤${serverInfo.max_image_mb} MB · Video ≤${serverInfo.max_video_mb} MB`
                                                    : `Фото ≤${serverInfo.max_image_mb} МБ · Видео ≤${serverInfo.max_video_mb} МБ`}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={isRecording ? stopRecording : startRecording}
                                style={{ ...darkStyles.pillBtn, marginBottom: 0, alignSelf: 'flex-end', ...(isRecording ? { color: '#ef4444' } : {}), padding: '5px 4px' }}
                                title={isRecording ? 'Остановить запись' : 'Записать голосовое'}
                            >
                                {isRecording ? (
                                    <span style={{ fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> {recordingTime}s</span>
                                ) : (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                                )}
                            </button>
                            {!isMobile && (
                                <button onClick={() => setShowSchedulePicker(p => !p)} title={lang === 'en' ? 'Schedule' : 'Запланировать'}
                                    style={{ ...darkStyles.pillBtn, marginBottom: 0, padding: '5px 4px', position: 'relative', color: showSchedulePicker ? (isOled ? '#c4b5fd' : '#6366f1') : scheduledMessages.length > 0 ? (isOled ? '#a78bfa' : '#6366f1') : (dm ? (isOled ? '#8b7dc8' : '#6b6b9a') : '#7c7caa') }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                    {scheduledMessages.length > 0 && <span style={{ position: 'absolute', top: 1, right: 1, minWidth: 14, height: 14, borderRadius: 7, background: isOled ? '#7c3aed' : '#6366f1', color: 'white', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', boxShadow: '0 0 4px rgba(99,102,241,0.5)' }}>{scheduledMessages.length}</span>}
                                </button>
                            )}
                            </div>{/* end inputPill */}
                            <button onClick={sendMessage} className={isMobile ? 'chat-send-btn-mobile' : ''} style={isMobile ? undefined : darkStyles.sendBtn2}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                                </svg>
                            </button>
                            <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} />
                        </div>}
                    </>
                ) : (
                    <div className="fadein-up" style={{ ...darkStyles.noChat, gap: 0 }}>
                        <div style={{ width: 80, height: 80, borderRadius: '50%', background: isOled ? 'linear-gradient(135deg,rgba(124,58,237,0.18),rgba(167,139,250,0.08))' : dm ? 'linear-gradient(135deg,rgba(99,102,241,0.18),rgba(139,92,246,0.08))' : 'linear-gradient(135deg,#ede9fe,#f5f3ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18, boxShadow: isOled ? '0 0 40px rgba(167,139,250,0.12)' : dm ? '0 4px 24px rgba(99,102,241,0.1)' : '0 4px 24px rgba(99,102,241,0.08)', color: isOled ? '#a78bfa' : dm ? '#818cf8' : '#6366f1' }}><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
                        <div style={{ fontWeight: 700, fontSize: 18, color: dm ? '#e2e8f0' : '#1e1b4b', marginBottom: 8 }}>Aurora</div>
                        <div style={{ fontSize: 13, color: dm ? '#5a5a8a' : '#9ca3af', textAlign: 'center', maxWidth: 220, lineHeight: 1.6 }}>{lang === 'en' ? 'Select a chat to start messaging' : 'Выберите чат, чтобы начать общение'}</div>
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
                        top: menuPosition.y,
                        left: menuPosition.x,
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
                            const menuBorderCol = dm ? '#3a3a4a' : '#ede9fe';
                            if (showFullReactionPicker) {
                                return (
                                    <div style={{ backgroundColor: dm ? C.bg3 : 'white', border: `1px solid ${menuBorderCol}`, overflow: 'hidden', borderRadius: isMobile ? '20px 20px 0 0' : 14, width: isMobile ? undefined : 320 }}>
                                        {/* Back header */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: `1px solid ${dm ? C.bg6 : '#f0eeff'}` }}>
                                            <button onClick={() => setShowFullReactionPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#a5b4fc' : '#6366f1', padding: '2px 6px', borderRadius: 8, display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e2e8f0' : '#1e1b4b' }}>{lang === 'en' ? 'React' : 'Реакция'}</span>
                                        </div>
                                        <FullReactionPicker dm={dm} onSelect={addReaction} onClose={() => setShowFullReactionPicker(false)} />
                                    </div>
                                );
                            }
                            return (
                    <div style={{ ...styles.menu, backgroundColor: dm ? C.bg3 : 'white', border: `1px solid ${menuBorderCol}`, padding: 0, overflow: 'hidden', maxHeight: isMobile ? '75vh' : '80vh', overflowY: 'auto', borderRadius: isMobile ? '20px 20px 0 0' : 14 }}>
                        {/* Quick reactions row */}
                        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 8px 6px', borderBottom: `1px solid ${dm ? C.bg6 : '#f0eeff'}`, gap: 2 }}>
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
                                title="Все эмодзи">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                            </button>
                        </div>
                        <div style={{ padding: '4px 0' }}>
                        {activeChat && (() => {
                            const chatKey = `${activeChat.type}-${activeChat.id}`;
                            const isPinned = pinnedMessages[chatKey]?.id === menuMessage.id;
                            return (
                                <button onClick={() => togglePinMessage(chatKey, menuMessage)} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                                    📌 {isPinned ? t('Unpin') : t('Pin')}
                                </button>
                            );
                        })()}
                        <button onClick={() => enterSelectionMode(menuMessage)} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                            ☑️ {t('Select message')}
                        </button>
                        <button onClick={() => { setReplyTo(menuMessage); setMenuMessageId(null); }} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                            ↩️ {t('Reply')}
                        </button>
                        <button onClick={() => { setForwardingMessage(menuMessage); setMenuMessageId(null); }} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                            ↪️ {t('Forward')}
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
                            📋 {t('Copy text')}
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
                                    }} style={{ ...styles.menuItem, color: isSaved ? '#6366f1' : (dm ? '#e0e0e0' : 'inherit') }}>
                                        🔖 {isSaved ? t('Remove saved GIF') : t('Save GIF')}
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
                                        }} style={{ ...styles.menuItem, color: isSaved ? '#6366f1' : (dm ? '#e0e0e0' : 'inherit') }}>
                                            🔖 {isSaved ? t('Remove saved GIF') : t('Save GIF')}
                                        </button>
                                    );
                                }
                            }
                            return null;
                        })()}
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
                                💾 {t('Download')}
                            </button>
                        )}
                        {menuMessage.sender_id === currentUserId && (
                            <>
                                <button onClick={() => handleEdit(menuMessage.id, menuMessage.message_text ?? '')} style={{ ...styles.menuItem, color: dm ? '#e0e0e0' : 'inherit' }}>
                                    ✏️ {t('Edit message')}
                                </button>
                                <button onClick={() => handleDelete(menuMessage.id)} style={{ ...styles.menuItem, color: '#f44336' }}>
                                    🗑️ {t('Delete message')}
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
                        <button onClick={() => setMenuMessageId(null)} style={{ ...styles.menuItem, color: dm ? '#aaa' : '#666' }}>
                            ❌ {t('Cancel')}
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
                    users={users.filter(u => u.id !== currentUserId)}
                    groups={groups}
                    isDark={theme.darkMode}
                    baseUrl={BASE_URL}
                    onClose={() => setShowFolderManager(false)}
                    onBack={() => { setShowFolderManager(false); setTimeout(() => setShowSettings(true), 50); }}
                    onFoldersChange={updated => { setFolders(updated); }}
                />
            )}
            {showSettings && (
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
                    onClose={() => setShowSettings(false)}
                />
            )}
            {showSupportChat && (
                <SupportChat
                    token={token}
                    currentUserId={currentUserId}
                    isDark={theme.darkMode}
                    onClose={() => setShowSupportChat(false)}
                    onBack={() => { setShowSupportChat(false); setTimeout(() => setShowSettings(true), 50); }}
                    newReply={newSupportReply}
                />
            )}
            {showAdminPanel && (
                <AdminPanel
                    token={token}
                    isDark={theme.darkMode}
                    onClose={() => setShowAdminPanel(false)}
                    onBack={() => { setShowAdminPanel(false); setTimeout(() => setShowSettings(true), 50); }}
                    newSupportMsg={newSupportMsg}
                />
            )}
            {showHelp && (
                <HelpModal
                    isDark={theme.darkMode}
                    initialTab="patchnotes"
                    onClose={() => setShowHelp(false)}
                />
            )}
            {showMediaPanel && activeChat && (
                <ChatMediaPanel
                    messages={messages}
                    isDark={theme.darkMode}
                    onClose={() => setShowMediaPanel(false)}
                    onGoToMessage={id => { setShowMediaPanel(false); setTimeout(() => goToMessage(id), 50); }}
                />
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
            {forwardingMessages && (
                <div className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 4000, background: isOled ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.5)', backdropFilter: isOled ? 'blur(8px)' : 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setForwardingMessages(null)}>
                    <div className="modal-enter" style={{ background: isOled ? '#000000' : (dm ? '#13132a' : 'white'), borderRadius: 20, width: 360, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 0 40px rgba(167,139,250,0.15), 0 20px 60px rgba(0,0,0,0.8)' : '0 20px 60px rgba(0,0,0,0.3)', border: isOled ? '1px solid rgba(167,139,250,0.18)' : (dm ? '1px solid rgba(99,102,241,0.2)' : '1px solid #ede9fe') }} onClick={e => e.stopPropagation()}>
                        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${dm ? C.bdr1 : '#ede9fe'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 700, fontSize: 15, color: dm ? '#e2e8f0' : '#1e1b4b' }}>{lang === 'en' ? `Forward ${forwardingMessages.length} msg.` : `Переслать ${forwardingMessages.length} сообщ.`}</span>
                                <button onClick={() => setForwardingMessages(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                            {/* Favorites */}
                            <div onClick={() => {
                                forwardingMessages!.forEach(msg => {
                                    const senderName = (msg as any).sender_name || users.find((u: any) => u.id === msg.sender_id)?.username || (lang === 'en' ? 'Unknown' : 'Неизвестно');
                                    wsService.sendMessage(currentUserId, `↪️ ${lang === 'en' ? 'Forwarded from' : 'Переслано от'} ${senderName}\n${(msg as any).message_text || ''}`);
                                });
                                setForwardingMessages(null);
                            }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', cursor: 'pointer', borderBottom: `1px solid ${dm ? C.bg3 : '#f3f3f8'}` }}>
                                <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#f59e0b,#f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>
                                <span style={{ fontSize: 14, color: dm ? '#e0e0e0' : '#1e1b4b', fontWeight: 600 }}>{lang === 'en' ? 'Favorites' : 'Избранное'}</span>
                            </div>
                            {groups.filter(g => !g.is_channel || g.my_role === 'admin' || g.creator_id === currentUserId).map(g => (
                                <div key={`fg-${g.id}`} onClick={() => {
                                    forwardingMessages!.forEach(msg => {
                                        const senderName = (msg as any).sender_name || users.find((u: any) => u.id === msg.sender_id)?.username || (lang === 'en' ? 'Unknown' : 'Неизвестно');
                                        wsService.sendGroupMessage(g.id, `↪️ ${lang === 'en' ? 'Forwarded from' : 'Переслано от'} ${senderName}\n${(msg as any).message_text || ''}`);
                                    });
                                    setForwardingMessages(null);
                                }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', cursor: 'pointer', borderBottom: `1px solid ${dm ? C.bg3 : '#f3f3f8'}` }}>
                                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>{g.name[0]?.toUpperCase()}</div>
                                    <span style={{ fontSize: 14, color: dm ? '#e0e0e0' : '#1e1b4b', fontWeight: 500 }}>{g.name}</span>
                                </div>
                            ))}
                            {users.map(u => (
                                <div key={`fu-${u.id}`} onClick={() => {
                                    forwardingMessages.forEach(msg => {
                                        const senderName = (msg as any).sender_name || users.find((uu: any) => uu.id === msg.sender_id)?.username || (lang === 'en' ? 'Unknown' : 'Неизвестно');
                                        wsService.sendMessage(u.id, `↪️ ${lang === 'en' ? 'Forwarded from' : 'Переслано от'} ${senderName}\n${(msg as any).message_text || ''}`);
                                    });
                                    setForwardingMessages(null);
                                }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', cursor: 'pointer', borderBottom: `1px solid ${dm ? C.bg3 : '#f3f3f8'}` }}>
                                    <div style={{ width: 38, height: 38, borderRadius: '50%', backgroundColor: u.avatar ? (dm ? C.bg2 : 'white') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
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
                            <button
                                onClick={() => confirmDelete(true)}
                                style={{ width: '100%', padding: '11px 0', borderRadius: 12, border: isOled ? '1.5px solid rgba(167,139,250,0.2)' : (dm ? '1.5px solid #3a3a5e' : '1.5px solid #ede9fe'), background: isOled ? '#0a0a10' : (dm ? '#1e1e3a' : '#f5f3ff'), color: isOled ? '#c4b5fd' : (dm ? '#c0c0d8' : '#374151'), fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                            >{t('Delete for me')}</button>
                            <button
                                onClick={() => setDeleteConfirmId(null)}
                                style={{ width: '100%', padding: '9px 0', borderRadius: 12, border: 'none', background: 'none', color: dm ? '#5a5a8a' : '#9ca3af', fontSize: 13, cursor: 'pointer' }}
                            >{t('Cancel')}</button>
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
                    isSelf={selectedUserForProfile.id === currentUserId}
                    isOnline={selectedUserForProfile.id === currentUserId ? true : (blockedUserIds.has(selectedUserForProfile.id) ? false : (users.find(u => u.id === selectedUserForProfile.id)?.is_online ?? selectedUserForProfile.is_online))}
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
                />
            )}

            {/* Forward message modal */}
            {forwardingMessage && (
                <div className="modal-backdrop-enter" style={{ position: 'fixed', inset: 0, zIndex: 4000, background: isOled ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.5)', backdropFilter: isOled ? 'blur(8px)' : 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => setForwardingMessage(null)}>
                    <div className="modal-enter" style={{ background: isOled ? '#000000' : (dm ? '#1a1a2e' : 'white'), borderRadius: 18, width: 360, maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: dm ? '0 0 40px rgba(99,102,241,0.3), 0 30px 80px rgba(0,0,0,0.6)' : '0 20px 60px rgba(0,0,0,0.35)', border: isOled ? '1px solid rgba(167,139,250,0.2)' : (dm ? '1px solid rgba(99,102,241,0.25)' : 'none') }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${dm ? C.bdr1 : '#ede9fe'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <span style={{ fontWeight: 700, fontSize: 15, color: dm ? '#e2e8f0' : '#1e1b4b' }}>{t('Forward to...')}</span>
                                <button onClick={() => setForwardingMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                            {/* Preview original message */}
                            <div style={{ borderLeft: `3px solid #6366f1`, paddingLeft: 10, borderRadius: 2 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#6366f1', marginBottom: 2 }}>
                                    {forwardingMessage.sender_name || users.find(u => u.id === forwardingMessage.sender_id)?.username || (lang === 'en' ? 'Unknown' : 'Неизвестно')}
                                </div>
                                <div style={{ fontSize: 12, color: dm ? '#9090b0' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                                    {forwardingMessage.message_text || (forwardingMessage.filename ? `📎 ${forwardingMessage.filename}` : `📎 ${lang === 'en' ? 'attachment' : 'вложение'}`)}
                                </div>
                            </div>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
                            {/* Favorites entry */}
                            <div onClick={() => {
                                const msg = forwardingMessage!;
                                const senderName = msg.sender_name || users.find((u: any) => u.id === msg.sender_id)?.username || (lang === 'en' ? 'Unknown' : 'Неизвестно');
                                const fwdPrefix = `↪️ ${lang === 'en' ? 'Forwarded from' : 'Переслано от'} ${senderName}\n`;
                                const fwdText = msg.message_text ? fwdPrefix + msg.message_text : fwdPrefix + (msg.filename ? `📎 ${msg.filename}` : '');
                                const filesRaw = msg.files;
                                const filesArr = filesRaw ? (typeof filesRaw === 'string' ? (() => { try { return JSON.parse(filesRaw); } catch { return []; } })() : filesRaw) : null;
                                if (filesArr?.length) wsService.sendMessage(currentUserId, fwdText, undefined, undefined, undefined, undefined, undefined, undefined, filesArr);
                                else wsService.sendMessage(currentUserId, fwdText, msg.file_path, msg.filename, msg.file_size);
                                setForwardingMessage(null);
                            }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer' }}
                                className={`sidebar-item${dm ? ' sidebar-item-dark' : ''}`}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#f59e0b,#f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'white' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>
                                <span style={{ fontSize: 14, color: dm ? '#e2e8f0' : '#1e1b4b', fontWeight: 600 }}>{lang === 'en' ? 'Favorites' : 'Избранное'}</span>
                            </div>
                            {groups.filter(g => !g.is_channel || g.my_role === 'admin' || g.creator_id === currentUserId).map(g => (
                                <div key={`fg-${g.id}`} onClick={() => {
                                    const msg = forwardingMessage;
                                    const senderName = msg.sender_name || users.find((u: any) => u.id === msg.sender_id)?.username || (lang === 'en' ? 'Unknown' : 'Неизвестно');
                                    const fwdPrefix = `↪️ ${lang === 'en' ? 'Forwarded from' : 'Переслано от'} ${senderName}\n`;
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
                                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: g.avatar ? (dm ? C.bg2 : 'white') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700 }}>
                                        {g.avatar ? <img src={config.fileUrl(g.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : g.name[0]?.toUpperCase()}
                                    </div>
                                    <span style={{ fontSize: 14, color: dm ? '#e2e8f0' : '#1e1b4b' }}>{g.name}</span>
                                </div>
                            ))}
                            {users.map(u => (
                                <div key={`fu-${u.id}`} onClick={() => {
                                    const msg = forwardingMessage;
                                    const senderName = msg.sender_name || users.find((uu: any) => uu.id === msg.sender_id)?.username || (lang === 'en' ? 'Unknown' : 'Неизвестно');
                                    const fwdPrefix = `↪️ ${lang === 'en' ? 'Forwarded from' : 'Переслано от'} ${senderName}\n`;
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
                                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: u.avatar ? (dm ? C.bg2 : 'white') : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, color: 'white', fontWeight: 700 }}>
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
                <div className="floating-enter" style={{ position: 'fixed', top: Math.min(pinMenu.y, window.innerHeight - 260), left: Math.min(pinMenu.x, window.innerWidth - 210), zIndex: 9999, background: dm ? C.bg3 : 'white', border: `1px solid ${dm ? '#3a3a4a' : '#ede9fe'}`, borderRadius: 12, padding: 4, boxShadow: '0 4px 24px rgba(0,0,0,0.22)', minWidth: 192, maxHeight: '80vh', overflowY: 'auto' }}
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
                                <button onClick={() => toggleMute(key)} style={btnStyle}>{isMuted ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> {lang === 'en' ? 'Unmute' : 'Включить уведомления'}</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg> {lang === 'en' ? 'Mute' : 'Выключить уведомления'}</>}</button>
                                <button onClick={() => { toggleArchive(key); }} style={btnStyle}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg> {archivedChats.has(key) ? (lang === 'en' ? 'Unarchive' : 'Разархивировать') : (lang === 'en' ? 'Archive' : 'Архивировать')}</button>
                                <button onClick={() => { setAddToFolderKey(key); }} style={btnStyle}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> {lang === 'en' ? 'Add to folder' : 'Добавить в папку'}</button>
                                <div style={{ height: 1, background: dm ? C.bg6 : '#f0f0f0', margin: '4px 0' }} />
                                {isPrivate && privateUserId !== null && (
                                    <button
                                        onClick={() => isBlocked ? handleUnblockUser(privateUserId) : handleBlockUser(privateUserId)}
                                        style={{ ...btnStyle, color: isBlocked ? '#22c55e' : '#f97316' }}
                                    >
                                        {isBlocked
                                            ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg> {lang === 'en' ? 'Unblock user' : 'Разблокировать'}</>
                                            : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> {lang === 'en' ? 'Block user' : 'Заблокировать'}</>}
                                    </button>
                                )}
                                <button onClick={() => handleDeleteChat(key)} style={{ ...btnStyle, color: '#ef4444' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> {lang === 'en' ? 'Delete chat' : 'Удалить чат'}</button>
                            </>
                        );
                    })()}
                </div>
            )}
            {pinMenu && <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => { setPinMenu(null); setAddToFolderKey(null); }} />}

            {/* Folder context menu */}
            {folderCtxMenu && (
                <div className="floating-enter" style={{ position: 'fixed', top: folderCtxMenu.y, left: folderCtxMenu.x, zIndex: 9999, background: dm ? C.bg3 : 'white', border: `1px solid ${dm ? '#3a3a4a' : '#ede9fe'}`, borderRadius: 12, padding: 4, boxShadow: '0 4px 24px rgba(0,0,0,0.22)', minWidth: 180 }}
                    onClick={e => e.stopPropagation()}>
                    {(() => {
                        const btnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#e0e0e0' : '#1e1b4b', fontSize: 13, borderRadius: 8, textAlign: 'left' as const };
                        return (
                            <>
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

            {/* In-app toast notifications */}
            {toasts.length > 0 && (
                <div style={{ position: 'fixed', bottom: isMobile ? 80 : 24, right: isMobile ? 0 : 24, left: isMobile ? 0 : 'auto', zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 8, width: isMobile ? '100%' : 320, padding: isMobile ? '0 10px' : 0 }}>
                    {toasts.map(toast => (
                        <div
                            key={toast.id}
                            className={toast.exiting ? 'toast-exit' : 'toast-enter'}
                            style={{
                                background: dm ? C.bg3 : 'white',
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
                                <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: toast.avatarSrc ? (dm ? C.bg2 : 'white') : toast.avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', fontSize: 15, color: 'white', fontWeight: 700 }}>
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
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', padding: '0 2px', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                                ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                            {/* Reply input */}
                            <div style={{ padding: '0 12px 8px', display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                                <input
                                    type="text"
                                    placeholder={lang === 'en' ? 'Reply...' : 'Ответить...'}
                                    value={toastReplies[toast.id] || ''}
                                    onChange={e => setToastReplies(prev => ({ ...prev, [toast.id]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') replyFromToast(toast, toastReplies[toast.id] || ''); }}
                                    style={{ flex: 1, padding: '7px 11px', borderRadius: 10, border: `1.5px solid ${dm ? C.bdr3 : '#ede9fe'}`, backgroundColor: dm ? '#14142a' : '#f5f3ff', color: dm ? '#e2e8f0' : '#1e1b4b', fontSize: 13, outline: 'none' }}
                                />
                                <button
                                    onClick={() => replyFromToast(toast, toastReplies[toast.id] || '')}
                                    style={{ padding: '7px 13px', borderRadius: 10, border: 'none', backgroundColor: '#6366f1', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg></button>
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
                                    style={{ width: '100%', padding: '6px 0', borderRadius: 10, border: `1px solid ${dm ? C.bdr3 : '#ede9fe'}`, backgroundColor: 'transparent', color: dm ? '#7878aa' : '#6b7280', fontSize: 12, cursor: 'pointer' }}
                                >
                                    ✓ {lang === 'en' ? 'Mark as read' : 'Пометить как прочитанное'}
                                </button>
                            </div>
                            {/* Progress bar */}
                            <div style={{ height: 2, backgroundColor: dm ? C.bdr1 : '#ede9fe' }}>
                                <div style={{ height: '100%', backgroundColor: '#6366f1', animation: 'toastProgress 5s linear forwards' }} />
                            </div>
                        </div>
                    ))}
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
                        <div style={{ background: isOled ? '#000' : dm ? '#13132a' : '#fff', borderRadius: 20, width: 380, maxHeight: '75vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: isOled ? '0 24px 80px rgba(0,0,0,0.95), 0 0 0 1px rgba(167,139,250,0.14)' : '0 24px 80px rgba(0,0,0,0.3)', border: isOled ? '1px solid rgba(167,139,250,0.15)' : dm ? '1px solid rgba(99,102,241,0.2)' : '1px solid #ede9fe' }} onClick={e => e.stopPropagation()}>
                            <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${isOled ? 'rgba(167,139,250,0.1)' : dm ? 'rgba(99,102,241,0.15)' : '#ede9fe'}` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 15, color: dm ? '#e2e8f0' : '#1e1b4b' }}>Поделиться плейлистом</div>
                                        <div style={{ fontSize: 12, color: dm ? '#5a5a8a' : '#9ca3af', marginTop: 2 }}>«{playlistToShare.name}»</div>
                                    </div>
                                    <button onClick={() => setPlaylistToShare(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dm ? '#5a5a8a' : '#9ca3af', display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                </div>
                                <input autoFocus value={playlistShareSearch} onChange={e => setPlaylistShareSearch(e.target.value)} placeholder="🔍 Поиск чата..." style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: 'none', background: isOled ? '#0a0a14' : dm ? '#1e1e38' : '#f5f3ff', color: dm ? '#e2e8f0' : '#1e1b4b', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const }} />
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                                {filteredUsers.map(u => (
                                    <div key={u.id} onClick={() => sendPlaylistMsg('private', u.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', cursor: 'pointer', transition: 'background 0.12s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.07)' : dm ? 'rgba(99,102,241,0.08)' : '#f5f3ff')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                        <div style={{ width: 38, height: 38, borderRadius: '50%', background: u.avatar_color || '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0, overflow: 'hidden' }}>
                                            {u.avatar ? <img src={config.fileUrl(u.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                                            {u.tag && <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>@{u.tag}</div>}
                                        </div>
                                    </div>
                                ))}
                                {filteredGroups.map(g => (
                                    <div key={g.id} onClick={() => sendPlaylistMsg('group', g.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', cursor: 'pointer', transition: 'background 0.12s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = isOled ? 'rgba(167,139,250,0.07)' : dm ? 'rgba(99,102,241,0.08)' : '#f5f3ff')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                        <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 15, flexShrink: 0, overflow: 'hidden' }}>
                                            {g.avatar ? <img src={config.fileUrl(g.avatar) ?? undefined} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : g.name[0]?.toUpperCase()}
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: dm ? '#e2e8f0' : '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                                            <div style={{ fontSize: 11, color: dm ? '#5a5a8a' : '#9ca3af' }}>{g.is_channel ? '📢 Канал' : '👥 Группа'}</div>
                                        </div>
                                    </div>
                                ))}
                                {filteredUsers.length === 0 && filteredGroups.length === 0 && (
                                    <div style={{ textAlign: 'center', color: dm ? '#5a5a8a' : '#9ca3af', padding: '32px 0', fontSize: 14 }}>Ничего не найдено</div>
                                )}
                            </div>
                        </div>
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
                    peerAvatar={callInfo.peerId ? (config.fileUrl(users.find(u => u.id === callInfo.peerId)?.avatar ?? null) ?? null) : null}
                    peerAvatarColor={callInfo.peerId ? (users.find(u => u.id === callInfo.peerId)?.avatar_color || 'linear-gradient(135deg,#6366f1,#8b5cf6)') : undefined}
                />
            )}
        </div>
    );
};

const styles: { [key: string]: React.CSSProperties } = {
    container: { display: 'flex', height: '100svh', backgroundColor: '#eef0f5' },
    sidebar: { width: 320, backgroundColor: '#f7f8fc', boxShadow: '2px 0 16px rgba(99,102,241,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 1 },
    sidebarScroll: { flex: 1, overflowY: 'auto' as const, backgroundColor: '#f7f8fc' },
    sidebarHeader: { padding: '16px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', color: 'white', display: 'flex', alignItems: 'center', gap: 8 },
    newChatBtn: { padding: '6px 10px', backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 10, cursor: 'pointer', fontSize: 14, backdropFilter: 'blur(4px)' },
    createGroupBtn: { padding: '6px 10px', backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 10, cursor: 'pointer', fontSize: 12, backdropFilter: 'blur(4px)' },
    profileCard: { padding: '13px 16px', borderTop: '1px solid #e4e5ef', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: '#f0f1f8', flexShrink: 0, boxSizing: 'border-box' as const },
    profileAvatar: { width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', overflow: 'hidden', boxShadow: '0 2px 8px rgba(99,102,241,0.3)' },
    profileInfo: { flex: 1, minWidth: 0 },
    profileName: { fontSize: 13, fontWeight: 600, color: '#1e1b4b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    profileStatus: { fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 },
    settingsBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', padding: '6px', borderRadius: 10, color: '#9ca3af', flexShrink: 0 },
    sectionTitle: { padding: '14px 20px 6px', fontSize: 10, fontWeight: 700 as const, color: '#a5b4fc', textTransform: 'uppercase' as const, letterSpacing: 1.5 },
    chatItem: { display: 'flex', alignItems: 'center', padding: '10px 12px', cursor: 'pointer', gap: 10, transition: 'background 0.15s', borderRadius: 12, margin: '1px 8px' },
    activeChatItem: { background: 'linear-gradient(90deg, rgba(99,102,241,0.22) 0%, rgba(139,92,246,0.10) 55%, transparent 100%)', boxShadow: 'inset 3px 0 0 #6366f1, 0 1px 10px rgba(99,102,241,0.18)' },
    avatar: { width: 40, height: 40, borderRadius: '50%', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 'bold' as const, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' },
    chatName: { fontSize: 14, fontWeight: 600 as const, color: '#1e1b4b', textAlign: 'left' as const },
    chatSub: { fontSize: 11, color: '#9ca3af', marginTop: 2, textAlign: 'left' as const },
    chatArea: { flex: 1, display: 'flex', flexDirection: 'column' as const, backgroundColor: '#f2f4f8', minWidth: 0 },
    chatHeader: { padding: '0 20px', borderBottom: '1px solid #e8e8ef', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f7f8fc', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', height: 68, minHeight: 68, maxHeight: 68, flexShrink: 0, boxSizing: 'border-box' as const },
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
    inputArea: { padding: '11px 16px', borderTop: '1px solid #e8e8ef', display: 'flex', gap: 8, alignItems: 'center', backgroundColor: '#f7f8fc', flexShrink: 0, boxSizing: 'border-box' as const },
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

// ─── Sticker Pack Preview Modal ───────────────────────────────────────────────
const StickerPackPreviewModal: React.FC<{
    data: { url: string; pack?: { id: string; name: string; emoji: string; stickers: string[] } };
    isDark: boolean;
    onClose: () => void;
}> = ({ data, isDark, onClose }) => {
    const { t: tl, lang: language } = useLang();
    const dm = isDark;
    const isOled = dm && document.body.classList.contains('oled-theme');
    const bg = dm ? (isOled ? '#050508' : '#1a1a2e') : '#ffffff';
    const border = dm ? '#2e2e4a' : '#e8e8f0';
    const text = dm ? '#e2e8f0' : '#1e1b4b';
    const subtext = dm ? '#888' : '#9ca3af';
    const accent = '#6366f1';
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

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.48)', backdropFilter: 'blur(4px)' }}>
            <div ref={ref} style={{ backgroundColor: bg, borderRadius: 20, boxShadow: dm ? '0 8px 40px rgba(0,0,0,0.7)' : '0 8px 40px rgba(99,102,241,0.22)', border: `1px solid ${border}`, width: 340, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '14px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{ fontSize: 28 }}>{data.pack?.emoji || '🎭'}</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: text }}>{data.pack?.name || tl('Stickers')}</div>
                        <div style={{ fontSize: 12, color: subtext }}>{count} {countLabel}</div>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: subtext, padding: '4px 6px', borderRadius: 8, display: 'flex', alignItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>

                {/* Sticker grid */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12 }}>
                    {stickers.map((url, i) => (
                        <div key={i} style={{ width: 82, height: 82, borderRadius: 12, overflow: 'hidden', border: `1.5px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: dm ? (isOled ? '#000000' : '#13131f') : '#f8f9fa' }}>
                            <img src={url} alt={language === 'en' ? 'sticker' : 'стикер'} style={{ maxWidth: 74, maxHeight: 74, objectFit: 'contain' }} />
                        </div>
                    ))}
                </div>

                {/* Footer */}
                {data.pack && (
                    <div style={{ padding: '12px 16px', borderTop: `1px solid ${border}`, flexShrink: 0 }}>
                        <button
                            onClick={handleAdd}
                            disabled={added}
                            style={{ width: '100%', padding: '11px 0', background: added ? (dm ? (isOled ? '#0d0d12' : '#2a2a3a') : '#f0f0f0') : `linear-gradient(135deg, ${accent}, #8b5cf6)`, color: added ? subtext : 'white', border: 'none', borderRadius: 12, cursor: added ? 'default' : 'pointer', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', transition: 'all 0.15s' }}
                        >
                            {added ? tl('Pack added ✓') : tl('Add pack (N)').replace('N', String(count))}
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
