class WebSocketService {
    private static instance: WebSocketService;
    private socket: WebSocket | null = null;
    private handlers: Set<(data: any) => void> = new Set();
    private token: string = '';
    private queue: any[] = [];
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts: number = 0;
    private readonly MAX_RECONNECT_DELAY = 30000;
    private readonly MAX_QUEUE_SIZE = 100;

    private constructor() {}

    static getInstance(): WebSocketService {
        if (!WebSocketService.instance) {
            WebSocketService.instance = new WebSocketService();
        }
        return WebSocketService.instance;
    }

    connect(token: string) {
        // If same token and already connected/connecting — skip
        const tokenChanged = token !== this.token && this.token !== '';
        if (!tokenChanged && this.socket && (
            this.socket.readyState === WebSocket.OPEN ||
            this.socket.readyState === WebSocket.CONNECTING
        )) {
            console.log('🔌 connect() skipped, already connected/connecting, state:', this.socket.readyState);
            return;
        }

        // Force close existing connection (token changed or socket is stale)
        if (this.socket) {
            this.socket.onopen = null;
            this.socket.onclose = null;
            this.socket.onerror = null;
            this.socket.onmessage = null;
            this.socket.close();
            this.socket = null;
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.token = token;
        const envWsUrl = process.env.REACT_APP_WS_URL;
        let url: string;
        if (envWsUrl) {
            url = `${envWsUrl}/ws?token=${token}`;
        } else {
            const loc = window.location;
            const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsHost = loc.protocol === 'https:' ? loc.host : `${loc.hostname}:8000`;
            url = `${wsProto}//${wsHost}/ws?token=${token}`;
        }
        console.log('🔌 Creating WS to:', url);

        const ws = new WebSocket(url);
        this.socket = ws;

        ws.onopen = () => {
            if (this.socket !== ws) { console.log('⚠️ onopen: stale socket, ignoring'); return; }
            console.log('✅ WS connected, flushing queue:', this.queue.length);
            this.reconnectAttempts = 0;
            this.queue.forEach(msg => ws.send(JSON.stringify(msg)));
            this.queue = [];
        };

        ws.onclose = (event) => {
            if (this.socket !== ws) { console.log('⚠️ onclose: stale socket, ignoring'); return; }
            console.log('❌ WS closed, code:', event.code, 'token present:', !!this.token);
            this.socket = null;
            if (this.token) {
                this.reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), this.MAX_RECONNECT_DELAY);
                console.log(`🔄 Reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
                this.reconnectTimer = setTimeout(() => this.connect(this.token), delay);
            }
        };

        ws.onerror = (e) => {
            if (this.socket !== ws) return;
            console.error('WS error:', e);
        };

        ws.onmessage = (event) => {
            if (this.socket !== ws) return;
            try {
                const data = JSON.parse(event.data);
                console.log('📩 WS received type:', data.type, 'data:', data.data);
                this.handlers.forEach(h => h(data));
            } catch (e) {
                console.error('WS parse error:', e);
            }
        };
    }

    disconnect() {
        console.log('🔌 disconnect() called');
        this.token = '';
        this.queue = [];
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            this.socket.onopen = null;
            this.socket.onclose = null;
            this.socket.onerror = null;
            this.socket.onmessage = null;
            this.socket.close();
            this.socket = null;
        }
    }

    isConnected(): boolean {
        return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
    }

    send(message: any): boolean {
        console.log('📤 send() called, type:', message.type, '| socket state:', this.socket?.readyState, '| OPEN=', WebSocket.OPEN);
        if (!this.socket) {
            console.error('❌ send() failed: no socket');
            return false;
        }
        if (this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
            console.log('✅ sent:', message.type);
            return true;
        }
        if (this.socket.readyState === WebSocket.CONNECTING) {
            console.log('⏳ queuing (still connecting):', message.type);
            if (this.queue.length < this.MAX_QUEUE_SIZE) this.queue.push(message);
            return true;
        }
        // Socket is CLOSING or CLOSED — queue and let reconnect flush it
        console.log('⏳ queuing (socket closing/closed, will retry on reconnect):', message.type);
        if (this.queue.length < this.MAX_QUEUE_SIZE) this.queue.push(message);
        return true;
    }

    sendRaw(message: any): boolean {
        return this.send(message);
    }

    sendMessage(receiverId: number, messageText?: string, filePath?: string, filename?: string, fileSize?: number, replyToId?: number, replyToText?: string, replyToSender?: string, files?: {file_path: string, filename: string, file_size: number}[]) {
        return this.send({
            type: 'message',
            receiver_id: receiverId,
            message_text: messageText || '',
            file_path: filePath || null,
            filename: filename || null,
            file_size: fileSize || null,
            files: files || null,
            reply_to_id: replyToId || null,
            reply_to_text: replyToText || null,
            reply_to_sender: replyToSender || null,
        });
    }

    sendGroupMessage(groupId: number, messageText?: string, filePath?: string, filename?: string, fileSize?: number, replyToId?: number, replyToText?: string, replyToSender?: string, files?: {file_path: string, filename: string, file_size: number}[]) {
        return this.send({
            type: 'group_message',
            group_id: groupId,
            message_text: messageText || '',
            file_path: filePath || null,
            filename: filename || null,
            file_size: fileSize || null,
            files: files || null,
            reply_to_id: replyToId || null,
            reply_to_text: replyToText || null,
            reply_to_sender: replyToSender || null,
        });
    }

    markRead(senderId: number) {
        return this.send({ type: 'mark_read', sender_id: senderId });
    }

    addReaction(messageId: number, isGroup: boolean, emoji: string) {
        return this.send({ type: 'add_reaction', message_id: messageId, is_group: isGroup, emoji });
    }

    removeReaction(messageId: number, isGroup: boolean, emoji: string) {
        return this.send({ type: 'remove_reaction', message_id: messageId, is_group: isGroup, emoji });
    }

    sendTyping(receiverId: number) {
        return this.send({ type: 'typing', receiver_id: receiverId });
    }

    sendGroupTyping(groupId: number) {
        return this.send({ type: 'group_typing', group_id: groupId });
    }

    sendSetOnline() {
        return this.send({ type: 'set_online' });
    }

    sendSetOffline() {
        return this.send({ type: 'set_offline' });
    }

    onMessage(handler: (data: any) => void): () => void {
        this.handlers.add(handler);
        console.log('📋 handler registered, total:', this.handlers.size);
        return () => {
            this.handlers.delete(handler);
            console.log('📋 handler removed, total:', this.handlers.size);
        };
    }
}

export const wsService = WebSocketService.getInstance();
