export interface User {
    id: number;
    username: string;
    tag?: string;
    email: string;
    created_at: string;
    avatar?: string;
    status?: string;
    avatar_color?: string;
    birthday?: string;
    phone?: string;
    tags?: string[];
    privacy_settings?: string;
    last_seen?: string | null;
    is_online?: boolean;
    last_msg_text?: string | null;
    last_msg_file?: string | null;
    last_msg_filename?: string | null;
    last_msg_time?: string | null;
    last_msg_sender_id?: number | null;
    last_msg_is_read?: number | null;
    is_developer?: boolean;
}

export interface Message {
    id: number;
    sender_id: number;
    receiver_id: number;
    sender_name?: string;
    message_text?: string;
    file_path?: string;
    filename?: string;
    file_size?: number;
    timestamp: string;
    delivered: boolean;
    reply_to_id?: number;
    reply_to_text?: string;  // Добавляем
    reply_to_sender?: string; // Добавляем
    edited_at?: string;
    is_deleted?: boolean;
    pending?: boolean;
}

export interface Group {
    id: number;
    name: string;
    description: string;
    creator_id: number;
    created_at: string;
    member_count: number;
    message_count?: number;
    avatar?: string;
    last_msg_text?: string | null;
    last_msg_file?: string | null;
    last_msg_filename?: string | null;
    last_msg_time?: string | null;
    last_msg_sender_id?: number | null;
    last_msg_sender_name?: string | null;
    // Channel fields
    is_channel?: number;
    channel_type?: 'public' | 'private';
    channel_tag?: string | null;
    invite_link?: string | null;
    my_role?: 'admin' | 'member';
}

export interface GroupMember {
    id: number;
    username: string;
    email: string;
    avatar?: string;
    tag?: string;
    role: 'admin' | 'member';
    joined_at: string;
    custom_title?: string;
}

export interface GroupMessage {
    id: number;
    group_id: number;
    sender_id: number;
    sender_name: string;
    sender_tag?: string;
    sender_avatar?: string;
    sender_avatar_color?: string;
    message_text?: string;
    file_path?: string;
    filename?: string;
    file_size?: number;
    timestamp: string;
    reply_to_id?: number;
    reply_to_text?: string;  // Добавляем
    reply_to_sender?: string; // Добавляем
    edited_at?: string;
    is_deleted?: boolean;
    pending?: boolean;
}

export interface ChatItem {
    type: 'private' | 'group';
    id: number;
    name: string;
    avatar?: string;
    lastMessage?: string;
    lastMessageTime?: string;
    unread?: number;
}

export interface AuthResponse {
    success: boolean;
    user_id: number;
    username: string;
    token: string;
}

export interface WebSocketMessage {
    type: 'message' | 'message_sent' | 'group_message' | 'delivered' | 'typing' | 'group_typing';
    data: any;
}

export interface ThemeSettings {
    fontSize: number;
    bubbleOwnColor: string;
    bubbleOtherColor: string;
    chatBg: string;
    darkMode: boolean;
    avatarColor?: string;
}