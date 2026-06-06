import { config } from '../config';

const getApiUrl = () => config.API_URL;

export const api = {
    async sendRegisterCode(email: string) {
        try {
            const response = await fetch(`${getApiUrl()}/auth/send-register-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            if (!response.ok) {
                let detail = 'Ошибка отправки кода';
                try { const j = await response.json(); detail = j.detail || detail; } catch {}
                return { success: false, detail };
            }
            return await response.json();
        } catch (error) { throw error; }
    },

    async register(email: string, password: string, reg_code?: string) {
        try {
            const response = await fetch(`${getApiUrl()}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, reg_code }),
            });
            if (!response.ok) {
                let detail = 'Ошибка регистрации';
                try { const j = await response.json(); detail = j.detail || detail; } catch {}
                return { success: false, detail };
            }
            return await response.json();
        } catch (error) { throw error; }
    },

    async setupProfile(token: string, tag: string, username: string, theme?: string) {
        try {
            const response = await fetch(`${getApiUrl()}/setup?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag, username, theme }),
            });
            if (!response.ok) {
                let detail = 'Ошибка настройки профиля';
                try { const j = await response.json(); detail = j.detail || detail; } catch {}
                return { success: false, detail };
            }
            return await response.json();
        } catch (error) { throw error; }
    },

    async login(email: string, password: string) {
        try {
            let deviceId = localStorage.getItem('aurora_device_id');
            if (!deviceId) {
                deviceId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
                localStorage.setItem('aurora_device_id', deviceId);
            }
            const response = await fetch(`${getApiUrl()}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, device_id: deviceId }),
            });
            if (!response.ok) {
                let detail: any = 'Ошибка входа';
                try { const j = await response.json(); detail = j.detail || detail; } catch {}
                if (detail && typeof detail === 'object' && detail.code === 'banned') {
                    return { success: false, banned: true, ban_reason: detail.reason || '', ban_expires_at: detail.expires_at || null };
                }
                return { success: false, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) };
            }
            return await response.json();
        } catch (error) { throw error; }
    },

    async resetPassword(email: string, tag: string, old_password: string, new_password: string) {
        try {
            const response = await fetch(`${getApiUrl()}/password-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, tag, old_password, new_password }),
            });
            if (!response.ok) {
                let detail = 'Ошибка сброса пароля';
                try { const j = await response.json(); detail = j.detail || detail; } catch {}
                return { success: false, detail };
            }
            return await response.json();
        } catch (error) { throw error; }
    },

    async sendResetCode(email: string) {
        try {
            const response = await fetch(`${getApiUrl()}/auth/send-reset-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            return await response.json();
        } catch (error) { throw error; }
    },

    async confirmReset(email: string, code: string, new_password: string) {
        try {
            const response = await fetch(`${getApiUrl()}/auth/confirm-reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code, new_password }),
            });
            if (!response.ok) {
                let detail = 'Ошибка';
                try { const j = await response.json(); detail = j.detail || detail; } catch {}
                return { success: false, detail };
            }
            return await response.json();
        } catch (error) { throw error; }
    },
    
    async getUsers(token: string) {
        try {
            const response = await fetch(`${getApiUrl()}/users?token=${token}`);
            
            if (!response.ok) {
                const text = await response.text();
                console.error('Server error response:', text);
                throw new Error(`HTTP ${response.status}: ${text}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('Get users error:', error);
            throw error;
        }
    },
    
    async getConversation(token: string, userId: number, beforeId?: number) {
        try {
            let url = `${getApiUrl()}/conversation/${userId}?token=${token}&limit=200`;
            if (beforeId) url += `&before_id=${beforeId}`;
            const response = await fetch(url);
            if (!response.ok) {
                const text = await response.text();
                console.error('Server error response:', text);
                throw new Error(`HTTP ${response.status}: ${text}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Get conversation error:', error);
            throw error;
        }
    },
    
    async uploadFile(token: string, file: File) {
        return this.uploadFileWithProgress(token, file, () => {});
    },

    uploadFileWithProgress(token: string, file: File, onProgress: (pct: number) => void, onXHRCreated?: (xhr: XMLHttpRequest) => void): Promise<any> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const formData = new FormData();
            formData.append('token', token);
            formData.append('file', file);

            if (onXHRCreated) onXHRCreated(xhr);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch { reject(new Error('Invalid JSON response')); }
                } else {
                    reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.onabort = () => reject(new Error('Upload cancelled'));
            xhr.open('POST', `${getApiUrl()}/upload`);
            xhr.send(formData);
        });
    },

    async downloadFile(filePath: string, filename: string) {
        try {
            const response = await fetch(config.fileUrl(filePath) ?? filePath);
            const blob = await response.blob();

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            return true;
        } catch (error) {
            console.error('Download failed:', error);
            return false;
        }
    },

    async findUser(token: string, username: string) {
        const response = await fetch(`${getApiUrl()}/users/find?token=${token}&username=${encodeURIComponent(username)}`);
        if (!response.ok) throw new Error('User not found');
        return response.json();
    },

    async getRecentUsers(token: string) {
        const response = await fetch(`${getApiUrl()}/users/recent?token=${token}`);
        if (!response.ok) return { users: [] };
        return response.json();
    },

    async searchUsers(token: string, query: string) {
        const response = await fetch(`${getApiUrl()}/users/search?token=${token}&query=${encodeURIComponent(query)}`);
        if (!response.ok) return { users: [] };
        return response.json();
    },

    async searchChannels(token: string, query: string) {
        const response = await fetch(`${getApiUrl()}/channels/search?token=${token}&query=${encodeURIComponent(query)}`);
        if (!response.ok) return { channels: [] };
        return response.json();
    },

    async joinGroup(token: string, groupId: number) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}/join?token=${token}`, { method: 'POST' });
        if (!response.ok) return { success: false };
        return response.json();
    },

    async deleteGroup(token: string, groupId: number) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async updateGroup(token: string, groupId: number, name?: string, description?: string) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description }),
        });
        return response.json();
    },

    async removeMember(token: string, groupId: number, userId: number) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}/members/${userId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async clearConversation(token: string, userId: number) {
        const response = await fetch(`${getApiUrl()}/conversation/${userId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async clearGroupMessages(token: string, groupId: number) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}/messages?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    // Добавь в объект api:

// ========== Групповые чаты ==========

    async createGroup(token: string, name: string, description: string = '') {
        const response = await fetch(`${getApiUrl()}/groups?token=${token}&name=${encodeURIComponent(name)}&description=${encodeURIComponent(description)}`, {
            method: 'POST',
        });
        return response.json();
    },

    async getMyGroups(token: string) {
        const response = await fetch(`${getApiUrl()}/groups?token=${token}`);
        return response.json();
    },

    async getGroupInfo(token: string, groupId: number) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}?token=${token}`);
        return response.json();
    },

    async inviteToGroup(token: string, groupId: number, tag: string) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}/invite?token=${token}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ tag: tag.replace(/^@/, '') }),
        });
        const data = await response.json();
        if (!response.ok) return { success: false, message: data.detail || 'Ошибка' };
        return data;
    },

    async getGroupMessages(token: string, groupId: number, beforeId?: number) {
        let url = `${getApiUrl()}/groups/${groupId}/messages?token=${token}&limit=200`;
        if (beforeId) url += `&before_id=${beforeId}`;
        const response = await fetch(url);
        return response.json();
    },

    async getLinkPreview(token: string, url: string) {
        try {
            const response = await fetch(`${getApiUrl()}/link-preview?token=${token}&url=${encodeURIComponent(url)}`);
            if (!response.ok) return null;
            return await response.json();
        } catch { return null; }
    },

    exportChat(token: string, chatType: string, chatId: number, fmt: 'json' | 'txt' = 'json') {
        const url = `${getApiUrl()}/export/chat?token=${token}&chat_type=${chatType}&chat_id=${chatId}&fmt=${fmt}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat_${chatId}.${fmt}`;
        a.click();
    },

    async searchMessages(token: string, query: string, chatType?: string, chatId?: number) {
        let url = `${getApiUrl()}/search?token=${token}&query=${encodeURIComponent(query)}`;
        if (chatType && chatId) {
            url += `&chat_type=${chatType}&chat_id=${chatId}`;
        }
        const response = await fetch(url);
        return response.json();
    },

    async getProfile(token: string) {
        const response = await fetch(`${getApiUrl()}/profile?token=${token}`);
        if (!response.ok) {
            let detail: any = null;
            try { detail = (await response.json()).detail; } catch {}
            if (detail && typeof detail === 'object') {
                if (detail.code === 'banned') return { success: false, banned: true, ban_reason: detail.reason || '', ban_expires_at: detail.expires_at || null };
                if (detail.code === 'deleted') return { success: false, deleted: true };
            }
            return { success: false };
        }
        return response.json();
    },

    async updateProfile(token: string, data: {
        username?: string; status?: string; avatar_color?: string;
        birthday?: string; phone?: string; privacy_settings?: string; tag?: string;
    }) {
        const response = await fetch(`${getApiUrl()}/profile?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return response.json();
    },

    async removeAvatar(token: string) {
        const response = await fetch(`${getApiUrl()}/profile/avatar?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async getTags(token: string) {
        const response = await fetch(`${getApiUrl()}/profile/tags?token=${token}`);
        return response.json();
    },

    async addTag(token: string, tag: string) {
        const response = await fetch(`${getApiUrl()}/profile/tags?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag }),
        });
        return response.json();
    },

    async removeTag(token: string, tag: string) {
        const response = await fetch(`${getApiUrl()}/profile/tags/${encodeURIComponent(tag)}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async blockUser(token: string, userId: number) {
        const response = await fetch(`${getApiUrl()}/block/${userId}?token=${token}`, { method: 'POST' });
        return response.json();
    },

    async unblockUser(token: string, userId: number) {
        const response = await fetch(`${getApiUrl()}/block/${userId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async getBlockedUsers(token: string) {
        const response = await fetch(`${getApiUrl()}/blocked?token=${token}`);
        return response.json();
    },

    async uploadAvatar(token: string, file: File) {
        const formData = new FormData();
        formData.append('token', token);
        formData.append('file', file);
        const response = await fetch(`${getApiUrl()}/profile/avatar`, {
            method: 'POST',
            body: formData,
        });
        return response.json();
    },

    async uploadGroupAvatar(token: string, groupId: number, file: File) {
        const formData = new FormData();
        formData.append('token', token);
        formData.append('file', file);
        const response = await fetch(`${getApiUrl()}/groups/${groupId}/avatar`, {
            method: 'POST',
            body: formData,
        });
        return response.json();
    },

    async getFolders(token: string) {
        const response = await fetch(`${getApiUrl()}/folders?token=${token}`);
        return response.json();
    },
    async createFolder(token: string, name: string, color: string) {
        const response = await fetch(`${getApiUrl()}/folders?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color }),
        });
        return response.json();
    },
    async updateFolder(token: string, folderId: number, name: string, color: string) {
        const response = await fetch(`${getApiUrl()}/folders/${folderId}?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color }),
        });
        return response.json();
    },
    async deleteFolder(token: string, folderId: number) {
        const response = await fetch(`${getApiUrl()}/folders/${folderId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },
    async addChatToFolder(token: string, folderId: number, chatType: string, chatId: number) {
        const response = await fetch(`${getApiUrl()}/folders/${folderId}/chats?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_type: chatType, chat_id: chatId }),
        });
        return response.json();
    },
    async removeChatFromFolder(token: string, folderId: number, chatType: string, chatId: number) {
        const response = await fetch(`${getApiUrl()}/folders/${folderId}/chats/${chatType}/${chatId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    // ========== Каналы ==========

    async createChannel(token: string, name: string, description: string = '', channelType: string = 'public', channelTag?: string) {
        const body = { name, description, channel_type: channelType, channel_tag: channelTag || null };
        const response = await fetch(`${getApiUrl()}/channels?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return response.json();
    },

    async updateGroupAvatar(token: string, groupId: number, file: File) {
        const formData = new FormData();
        formData.append('token', token);
        formData.append('file', file);
        const response = await fetch(`${getApiUrl()}/groups/${groupId}/avatar`, {
            method: 'POST',
            body: formData,
        });
        return response.json();
    },

    async generateInviteLink(token: string, groupId: number) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}/invite-link?token=${token}`, {
            method: 'POST',
        });
        return response.json();
    },

    async joinViaInviteLink(token: string, inviteLink: string) {
        const response = await fetch(`${getApiUrl()}/groups/join/${inviteLink}?token=${token}`);
        return response.json();
    },

    async setMemberRole(token: string, groupId: number, userId: number, role: string) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}/members/${userId}/role?token=${token}&role=${role}`, {
            method: 'PUT',
        });
        return response.json();
    },

    async setMemberTitle(token: string, groupId: number, userId: number, title: string) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}/members/${userId}/title?token=${token}&title=${encodeURIComponent(title)}`, {
            method: 'PUT',
        });
        return response.json();
    },

    async updateChannelSettings(token: string, groupId: number, channelType?: string, channelTag?: string) {
        const response = await fetch(`${getApiUrl()}/groups/${groupId}/channel-settings?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_type: channelType, channel_tag: channelTag }),
        });
        return response.json();
    },

    async viewPost(token: string, groupId: number, messageId: number) {
        try {
            const response = await fetch(`${getApiUrl()}/groups/${groupId}/messages/${messageId}/view?token=${token}`, {
                method: 'POST',
            });
            return response.json();
        } catch { return { view_count: 0 }; }
    },

    async sendSupportMessage(token: string, message_text: string, file_path?: string, filename?: string) {
        const response = await fetch(`${getApiUrl()}/support/send?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_text, file_path, filename }),
        });
        return response.json();
    },

    async getSupportMessages(token: string) {
        const response = await fetch(`${getApiUrl()}/support/messages?token=${token}`);
        return response.json();
    },

    async getSupportUnread(token: string) {
        try {
            const response = await fetch(`${getApiUrl()}/support/unread?token=${token}`);
            return response.json();
        } catch { return { has_unread: false }; }
    },

    async getAdminStats(token: string) {
        const response = await fetch(`${getApiUrl()}/admin/stats?token=${token}`);
        return response.json();
    },

    async getAdminUsers(token: string, search = '') {
        const response = await fetch(`${getApiUrl()}/admin/users?token=${token}&search=${encodeURIComponent(search)}`);
        return response.json();
    },

    async deleteAdminUser(token: string, userId: number) {
        const response = await fetch(`${getApiUrl()}/admin/users/${userId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async banAdminUser(token: string, userId: number, reason: string = '', expiresAt?: string) {
        let url = `${getApiUrl()}/admin/users/${userId}/ban?token=${token}&reason=${encodeURIComponent(reason)}`;
        if (expiresAt) url += `&expires_at=${encodeURIComponent(expiresAt)}`;
        const response = await fetch(url, { method: 'POST' });
        return response.json();
    },

    async unbanAdminUser(token: string, userId: number) {
        const response = await fetch(`${getApiUrl()}/admin/users/${userId}/unban?token=${token}`, { method: 'POST' });
        return response.json();
    },

    async updateAdminUser(token: string, userId: number, data: { username?: string; email?: string; tag?: string; status?: string }) {
        const response = await fetch(`${getApiUrl()}/admin/users/${userId}?token=${token}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return response.json();
    },

    async deleteOwnAccount(token: string) {
        const response = await fetch(`${getApiUrl()}/account?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async getAdminSupport(token: string) {
        const response = await fetch(`${getApiUrl()}/admin/support?token=${token}`);
        return response.json();
    },

    async getAdminSupportThread(token: string, userId: number) {
        const response = await fetch(`${getApiUrl()}/admin/support/${userId}?token=${token}`);
        return response.json();
    },

    async updatePublicKey(token: string, public_key: string) {
        const response = await fetch(`${getApiUrl()}/users/me/public-key?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_key }),
        });
        return response.json();
    },

    async getUserPublicKey(token: string, userId: number): Promise<string | null> {
        try {
            const response = await fetch(`${getApiUrl()}/users/${userId}/public-key?token=${token}`);
            const data = await response.json();
            return data.public_key || null;
        } catch { return null; }
    },

    async scheduleMessage(token: string, message_text: string, scheduled_at?: string, receiver_id?: number, group_id?: number, send_when_online?: boolean) {
        const response = await fetch(`${getApiUrl()}/messages/schedule?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_text, scheduled_at, receiver_id, group_id, send_when_online: !!send_when_online }),
        });
        return response.json();
    },

    async getScheduledMessages(token: string, receiver_id?: number, group_id?: number) {
        const params = receiver_id ? `&receiver_id=${receiver_id}` : group_id ? `&group_id=${group_id}` : '';
        const response = await fetch(`${getApiUrl()}/messages/scheduled?token=${token}${params}`);
        return response.json();
    },

    async deleteScheduledMessage(token: string, scheduledId: number) {
        const response = await fetch(`${getApiUrl()}/messages/scheduled/${scheduledId}?token=${token}`, {
            method: 'DELETE',
        });
        return response.json();
    },

    async adminSupportReply(token: string, user_id: number, message_text: string) {
        const response = await fetch(`${getApiUrl()}/admin/support/reply?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id, message_text }),
        });
        return response.json();
    },

    async createPoll(token: string, question: string, options: string[], is_anonymous: boolean, is_multi_choice: boolean) {
        const response = await fetch(`${getApiUrl()}/polls?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, options, is_anonymous, is_multi_choice }),
        });
        return response.json();
    },

    async getPoll(token: string, pollId: number) {
        const response = await fetch(`${getApiUrl()}/polls/${pollId}?token=${token}`);
        return response.json();
    },

    async votePoll(token: string, pollId: number, option_indices: number[]) {
        const response = await fetch(`${getApiUrl()}/polls/${pollId}/vote?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ option_indices }),
        });
        return response.json();
    },

    async unvotePoll(token: string, pollId: number) {
        const response = await fetch(`${getApiUrl()}/polls/${pollId}/vote?token=${token}`, {
            method: 'DELETE',
        });
        return response.json();
    },

    async getServerInfo() {
        try {
            const response = await fetch(`${getApiUrl()}/server-info`);
            if (!response.ok) return null;
            return response.json();
        } catch { return null; }
    },

    async checkFileStorage(samplePath?: string | null) {
        if (!samplePath) return { ok: true, skipped: true };
        const url = config.fileUrl(samplePath);
        if (!url) return { ok: false, status: 0, url: '' };
        try {
            const response = await fetch(url, { method: 'GET', cache: 'no-store' });
            if (response.body) {
                try { await response.body.cancel(); } catch {}
            }
            return { ok: response.ok, status: response.status, url };
        } catch {
            return { ok: false, status: 0, url };
        }
    },

    async registerPushToken(token: string, pushToken: string, platform?: string) {
        const deviceId = localStorage.getItem('aurora_device_id') || undefined;
        const response = await fetch(`${getApiUrl()}/push-tokens?token=${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ push_token: pushToken, platform, device_id: deviceId }),
        });
        if (!response.ok) return { success: false };
        return response.json();
    },

    async unregisterPushToken(token: string, pushToken: string) {
        const response = await fetch(`${getApiUrl()}/push-tokens?token=${encodeURIComponent(token)}&push_token=${encodeURIComponent(pushToken)}`, {
            method: 'DELETE',
        });
        if (!response.ok) return { success: false };
        return response.json();
    },

    async getPlaylists(token: string) {
        const r = await fetch(`${getApiUrl()}/playlists?token=${token}`);
        return r.json();
    },
    async createPlaylist(token: string, name: string) {
        const r = await fetch(`${getApiUrl()}/playlists`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, name }) });
        return r.json();
    },
    async deletePlaylist(token: string, id: number) {
        const r = await fetch(`${getApiUrl()}/playlists/${id}?token=${token}`, { method: 'DELETE' });
        return r.json();
    },
    async renamePlaylist(token: string, id: number, name: string) {
        const r = await fetch(`${getApiUrl()}/playlists/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, name }) });
        return r.json();
    },
    async addTrack(token: string, data: { playlist_id: number; title: string; artist?: string; file_path: string; cover_path?: string; duration?: number }) {
        const r = await fetch(`${getApiUrl()}/playlists/tracks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...data }) });
        return r.json();
    },
    async deleteTrack(token: string, trackId: number) {
        const r = await fetch(`${getApiUrl()}/playlists/tracks/${trackId}?token=${token}`, { method: 'DELETE' });
        return r.json();
    },
    async extractTrackCover(token: string, trackId: number) {
        const r = await fetch(`${getApiUrl()}/playlists/tracks/${trackId}/extract-cover?token=${encodeURIComponent(token)}`, { method: 'POST' });
        return r.json();
    },
    async sharePlaylist(token: string, playlistId: number) {
        const fd = new FormData(); fd.append('token', token);
        const r = await fetch(`${getApiUrl()}/playlists/${playlistId}/share`, { method: 'POST', body: fd });
        return r.json();
    },
    async getSharedPlaylist(token: string, code: string) {
        const r = await fetch(`${getApiUrl()}/playlists/shared/${code}?token=${token}`);
        return r.json();
    },
    async setPlaylistCoverPath(token: string, playlistId: number, coverPath: string) {
        const r = await fetch(`${getApiUrl()}/playlists/${playlistId}/cover-path?token=${encodeURIComponent(token)}&cover=${encodeURIComponent(coverPath)}`, { method: 'PATCH' });
        return r.json();
    },
    async updatePlaylistCover(token: string, playlistId: number, file: File) {
        const fd = new FormData();
        fd.append('token', token);
        fd.append('file', file);
        const r = await fetch(`${getApiUrl()}/playlists/${playlistId}/cover`, { method: 'PUT', body: fd });
        return r.json();
    },
    async setNowPlaying(token: string, title: string | null, artist?: string | null) {
        const r = await fetch(`${getApiUrl()}/now_playing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, title: title ?? null, artist: artist ?? null }) });
        return r.json();
    },

    async getDisappearSetting(token: string, chatType: 'private' | 'group', chatId: number): Promise<{ seconds: number | null }> {
        try {
            const param = chatType === 'group' ? `group_id=${chatId}` : `receiver_id=${chatId}`;
            const r = await fetch(`${getApiUrl()}/messages/disappear-setting?token=${token}&${param}`);
            return r.json();
        } catch { return { seconds: null }; }
    },

    async setDisappearSetting(token: string, chatType: 'private' | 'group', chatId: number, seconds: number | null): Promise<{ success: boolean; seconds: number | null }> {
        try {
            const param = chatType === 'group' ? `group_id=${chatId}` : `receiver_id=${chatId}`;
            const secondsParam = seconds != null ? `&seconds=${seconds}` : '';
            const r = await fetch(`${getApiUrl()}/messages/disappear-setting?token=${token}&${param}${secondsParam}`, { method: 'POST' });
            return r.json();
        } catch { return { success: false, seconds: null }; }
    },
};
