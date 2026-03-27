import { config } from '../config';

const API_URL = config.API_URL;

export const api = {
    async register(username: string, email: string, password: string) {
        try {
            const response = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, email, password }),
            });

            if (!response.ok) {
                let detail = 'Ошибка регистрации';
                try { const j = await response.json(); detail = j.detail || detail; } catch {}
                return { success: false, detail };
            }

            const data = await response.json();
            return data;
        } catch (error) {
            throw error;
        }
    },

    async login(username: string, password: string) {
        try {
            const response = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            if (!response.ok) {
                let detail = 'Ошибка входа';
                try { const j = await response.json(); detail = j.detail || detail; } catch {}
                return { success: false, detail };
            }

            const data = await response.json();
            return data;
        } catch (error) {
            throw error;
        }
    },
    
    async getUsers(token: string) {
        try {
            const response = await fetch(`${API_URL}/users?token=${token}`);
            
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
    
    async getConversation(token: string, userId: number) {
        try {
            const response = await fetch(`${API_URL}/conversation/${userId}?token=${token}`);
            
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
            xhr.open('POST', `${API_URL}/upload`);
            xhr.send(formData);
        });
    },

    async downloadFile(filePath: string, filename: string) {
        try {
            const response = await fetch(`${config.BASE_URL}${filePath}`);
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
        const response = await fetch(`${API_URL}/users/find?token=${token}&username=${encodeURIComponent(username)}`);
        if (!response.ok) throw new Error('User not found');
        return response.json();
    },

    async getRecentUsers(token: string) {
        const response = await fetch(`${API_URL}/users/recent?token=${token}`);
        if (!response.ok) return { users: [] };
        return response.json();
    },

    async searchUsers(token: string, query: string) {
        const response = await fetch(`${API_URL}/users/search?token=${token}&query=${encodeURIComponent(query)}`);
        if (!response.ok) return { users: [] };
        return response.json();
    },

    async deleteGroup(token: string, groupId: number) {
        const response = await fetch(`${API_URL}/groups/${groupId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async updateGroup(token: string, groupId: number, name?: string, description?: string) {
        const response = await fetch(`${API_URL}/groups/${groupId}?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description }),
        });
        return response.json();
    },

    async removeMember(token: string, groupId: number, userId: number) {
        const response = await fetch(`${API_URL}/groups/${groupId}/members/${userId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async clearConversation(token: string, userId: number) {
        const response = await fetch(`${API_URL}/conversation/${userId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async clearGroupMessages(token: string, groupId: number) {
        const response = await fetch(`${API_URL}/groups/${groupId}/messages?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    // Добавь в объект api:

// ========== Групповые чаты ==========

    async createGroup(token: string, name: string, description: string = '') {
        const response = await fetch(`${API_URL}/groups?token=${token}&name=${encodeURIComponent(name)}&description=${encodeURIComponent(description)}`, {
            method: 'POST',
        });
        return response.json();
    },

    async getMyGroups(token: string) {
        const response = await fetch(`${API_URL}/groups?token=${token}`);
        return response.json();
    },

    async getGroupInfo(token: string, groupId: number) {
        const response = await fetch(`${API_URL}/groups/${groupId}?token=${token}`);
        return response.json();
    },

    async inviteToGroup(token: string, groupId: number, username: string) {
        const response = await fetch(`${API_URL}/groups/${groupId}/invite?token=${token}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username }),
        });
        return response.json();
    },

    async getGroupMessages(token: string, groupId: number, limit: number = 50) {
        const response = await fetch(`${API_URL}/groups/${groupId}/messages?token=${token}&limit=${limit}`);
        return response.json();
    },

    async searchMessages(token: string, query: string, chatType?: string, chatId?: number) {
        let url = `${API_URL}/search?token=${token}&query=${encodeURIComponent(query)}`;
        if (chatType && chatId) {
            url += `&chat_type=${chatType}&chat_id=${chatId}`;
        }
        const response = await fetch(url);
        return response.json();
    },

    async getProfile(token: string) {
        const response = await fetch(`${API_URL}/profile?token=${token}`);
        return response.json();
    },

    async updateProfile(token: string, data: {
        username?: string; status?: string; avatar_color?: string;
        birthday?: string; phone?: string; privacy_settings?: string;
    }) {
        const response = await fetch(`${API_URL}/profile?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        return response.json();
    },

    async removeAvatar(token: string) {
        const response = await fetch(`${API_URL}/profile/avatar?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async getTags(token: string) {
        const response = await fetch(`${API_URL}/profile/tags?token=${token}`);
        return response.json();
    },

    async addTag(token: string, tag: string) {
        const response = await fetch(`${API_URL}/profile/tags?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag }),
        });
        return response.json();
    },

    async removeTag(token: string, tag: string) {
        const response = await fetch(`${API_URL}/profile/tags/${encodeURIComponent(tag)}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },

    async uploadAvatar(token: string, file: File) {
        const formData = new FormData();
        formData.append('token', token);
        formData.append('file', file);
        const response = await fetch(`${API_URL}/profile/avatar`, {
            method: 'POST',
            body: formData,
        });
        return response.json();
    },

    async uploadGroupAvatar(token: string, groupId: number, file: File) {
        const formData = new FormData();
        formData.append('token', token);
        formData.append('file', file);
        const response = await fetch(`${API_URL}/groups/${groupId}/avatar`, {
            method: 'POST',
            body: formData,
        });
        return response.json();
    },

    async getFolders(token: string) {
        const response = await fetch(`${API_URL}/folders?token=${token}`);
        return response.json();
    },
    async createFolder(token: string, name: string, color: string) {
        const response = await fetch(`${API_URL}/folders?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color }),
        });
        return response.json();
    },
    async updateFolder(token: string, folderId: number, name: string, color: string) {
        const response = await fetch(`${API_URL}/folders/${folderId}?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color }),
        });
        return response.json();
    },
    async deleteFolder(token: string, folderId: number) {
        const response = await fetch(`${API_URL}/folders/${folderId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },
    async addChatToFolder(token: string, folderId: number, chatType: string, chatId: number) {
        const response = await fetch(`${API_URL}/folders/${folderId}/chats?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_type: chatType, chat_id: chatId }),
        });
        return response.json();
    },
    async removeChatFromFolder(token: string, folderId: number, chatType: string, chatId: number) {
        const response = await fetch(`${API_URL}/folders/${folderId}/chats/${chatType}/${chatId}?token=${token}`, { method: 'DELETE' });
        return response.json();
    },
};