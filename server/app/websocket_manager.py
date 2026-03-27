from typing import Dict, Optional
from fastapi import WebSocket

class ConnectionManager:
    """Управляет WebSocket соединениями"""
    
    def __init__(self):
        # user_id -> websocket
        self.active_connections: Dict[int, WebSocket] = {}
    
    async def connect(self, user_id: int, websocket: WebSocket):
        """Подключает пользователя"""
        await websocket.accept()
        self.active_connections[user_id] = websocket
        print(f"User {user_id} connected. Total active: {len(self.active_connections)}")
    
    def disconnect(self, user_id: int):
        """Отключает пользователя"""
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            print(f"User {user_id} disconnected. Total active: {len(self.active_connections)}")
    
    async def send_message_to_user(self, user_id: int, message: dict) -> bool:
        """Отправляет сообщение конкретному пользователю"""
        print(f"📤 Attempting to send to user {user_id}: {message}")
        
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
                print(f"✅ Sent to user {user_id}")
                return True
            except Exception as e:
                print(f"❌ Error sending to user {user_id}: {e}")
                self.disconnect(user_id)
                return False
        else:
            print(f"User {user_id} is offline")
            return False

    async def send_to_group_members(self, group_id: int, message: dict, exclude_user_id: int = None):
        """Отправить сообщение всем участникам группы"""
        # Нужно получить участников группы
        from .models import GroupModel
        members = await GroupModel.get_members(group_id)
        
        for member in members:
            if exclude_user_id and member['id'] == exclude_user_id:
                continue
            await self.send_message_to_user(member['id'], message)
    
    def is_user_online(self, user_id: int) -> bool:
        """Проверяет, онлайн ли пользователь"""
        return user_id in self.active_connections

manager = ConnectionManager()