from typing import Dict, List, Optional
from fastapi import WebSocket

class ConnectionManager:
    """Manages WebSocket connections — supports multiple connections per user (multi-device)"""

    def __init__(self):
        # user_id -> list of websockets (one per device/tab)
        self.active_connections: Dict[int, List[WebSocket]] = {}
        self.manual_offline: set = set()

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        self.manual_offline.discard(user_id)
        print(f"User {user_id} connected. Connections: {len(self.active_connections[user_id])}. Total users: {len(self.active_connections)}")

    def disconnect(self, user_id: int, websocket: WebSocket = None):
        if user_id not in self.active_connections:
            return
        if websocket is not None:
            try:
                self.active_connections[user_id].remove(websocket)
            except ValueError:
                pass
        if not self.active_connections[user_id]:
            del self.active_connections[user_id]
            self.manual_offline.discard(user_id)
        print(f"User {user_id} disconnected. Remaining: {len(self.active_connections.get(user_id, []))}")

    def set_manual_offline(self, user_id: int):
        self.manual_offline.add(user_id)

    def set_manual_online(self, user_id: int):
        self.manual_offline.discard(user_id)

    async def send_message_to_user(self, user_id: int, message: dict) -> bool:
        sockets = self.active_connections.get(user_id, [])
        if not sockets:
            return False
        delivered = False
        dead = []
        for ws in list(sockets):
            try:
                await ws.send_json(message)
                delivered = True
            except Exception as e:
                print(f"❌ Error sending to user {user_id}: {e}")
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)
        return delivered

    async def send_to_group_members(self, group_id: int, message: dict, exclude_user_id: int = None):
        from .models import GroupModel
        members = await GroupModel.get_members(group_id)
        for member in members:
            if exclude_user_id and member['id'] == exclude_user_id:
                continue
            await self.send_message_to_user(member['id'], message)

    def is_user_online(self, user_id: int) -> bool:
        return bool(self.active_connections.get(user_id)) and user_id not in self.manual_offline

manager = ConnectionManager()
