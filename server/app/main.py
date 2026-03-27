import aiomysql
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
import os
import uuid
import json
import mimetypes
from urllib.parse import quote
from datetime import datetime, timezone

from .config import config
from .models import DatabasePool, UserModel, MessageModel, GroupModel, GroupMessageModel, ReactionModel, FolderModel, GroupReadModel
from .auth import hash_password, verify_password, create_jwt_token, decode_jwt_token
from .websocket_manager import manager


# Pydantic модели для запросов
class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class CreateGroupRequest(BaseModel):
    name: str
    description: str = ""

class InviteToGroupRequest(BaseModel):
    username: str

class UpdateProfileRequest(BaseModel):
    username: Optional[str] = None
    status: Optional[str] = None
    avatar_color: Optional[str] = None
    birthday: Optional[str] = None
    phone: Optional[str] = None
    privacy_settings: Optional[str] = None

class AddTagRequest(BaseModel):
    tag: str

class UpdateGroupRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

app = FastAPI(title="Messenger API", version="2.0.0")

# Настройка CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://192.168.1.2:3000",
        "http://192.168.1.2:8000",
        "https://aurora-messenger.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Создаем папку для загрузок
os.makedirs("uploads", exist_ok=True)

# ========== События жизненного цикла ==========

@app.on_event("startup")
async def startup():
    """При запуске сервера инициализируем пул соединений"""
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for sql in [
                "ALTER TABLE group_messages ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0",
                "ALTER TABLE group_messages MODIFY COLUMN sender_id INT NULL",
                "ALTER TABLE messages ADD COLUMN files TEXT NULL",
                "ALTER TABLE group_messages ADD COLUMN files TEXT NULL",
                "ALTER TABLE messages ADD COLUMN is_read TINYINT(1) NOT NULL DEFAULT 0",
                "ALTER TABLE users ADD COLUMN last_seen TIMESTAMP NULL",
                """CREATE TABLE IF NOT EXISTS group_message_reads (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    message_id INT NOT NULL,
                    user_id INT NOT NULL,
                    group_id INT NOT NULL,
                    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_read (message_id, user_id)
                )""",
                """CREATE TABLE IF NOT EXISTS message_reactions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    message_id INT NOT NULL,
                    is_group TINYINT(1) NOT NULL DEFAULT 0,
                    user_id INT NOT NULL,
                    emoji VARCHAR(16) NOT NULL,
                    UNIQUE KEY unique_reaction (message_id, is_group, user_id, emoji)
                )""",
                """CREATE TABLE IF NOT EXISTS chat_folders (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    name VARCHAR(100) NOT NULL,
                    color VARCHAR(20) DEFAULT '#6366f1',
                    position INT DEFAULT 0
                )""",
                """CREATE TABLE IF NOT EXISTS folder_chats (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    folder_id INT NOT NULL,
                    chat_type ENUM('private','group') NOT NULL,
                    chat_id INT NOT NULL,
                    UNIQUE KEY unique_folder_chat (folder_id, chat_type, chat_id)
                )""",
            ]:
                try:
                    await cur.execute(sql)
                except Exception:
                    pass
            await conn.commit()
    print("✅ Database pool initialized")

@app.on_event("shutdown")
async def shutdown():
    """При остановке сервера обновляем last_seen и закрываем пул"""
    for user_id in list(manager.active_connections.keys()):
        try:
            await UserModel.update_last_seen(user_id)
        except Exception:
            pass
    await DatabasePool.close()
    print("👋 Database pool closed")

# ========== Базовые эндпоинты ==========

@app.get("/api/health")
async def root():
    return {"message": "Messenger API is running", "status": "ok", "version": "2.0.0"}

# ========== Аутентификация ==========

@app.post("/api/register")
async def register(request: RegisterRequest):
    """Регистрация нового пользователя"""
    existing = await UserModel.get_user_by_username(request.username)
    if existing:
        raise HTTPException(status_code=400, detail="Это имя пользователя уже занято")
    
    password_hash = hash_password(request.password)
    user_id = await UserModel.create_user(request.username, request.email, password_hash)
    
    if not user_id:
        raise HTTPException(status_code=500, detail="Failed to create user")
    
    token = create_jwt_token(user_id, request.username)
    
    return {
        "success": True,
        "user_id": user_id,
        "username": request.username,
        "token": token
    }

@app.post("/api/login")
async def login(request: LoginRequest):
    """Вход пользователя"""
    user = await UserModel.get_user_by_username(request.username)
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")

    if not verify_password(request.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Неверный пароль")
    
    token = create_jwt_token(user['id'], user['username'])
    
    return {
        "success": True,
        "user_id": user['id'],
        "username": user['username'],
        "token": token
    }

# ========== Пользователи ==========

@app.get("/api/users/recent")
async def get_recent_users(token: str):
    """Получить недавно зарегистрированных пользователей"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, username, avatar, avatar_color, status, last_seen FROM users WHERE id != %s ORDER BY created_at DESC LIMIT 15",
                (payload['user_id'],)
            )
            rows = await cur.fetchall()
    result = []
    for u in rows:
        ud = dict(u)
        if ud.get('last_seen') and hasattr(ud['last_seen'], 'isoformat'):
            ud['last_seen'] = ud['last_seen'].isoformat() + 'Z'
        ud['is_online'] = manager.is_user_online(ud['id'])
        result.append(ud)
    return {"users": result}

@app.get("/api/users/find")
async def find_user(token: str, username: str):
    """Найти пользователя по нику"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await UserModel.get_user_by_username(username)
    if not user or user['id'] == payload['user_id']:
        raise HTTPException(status_code=404, detail="User not found")
    tags = await UserModel.get_tags(user['id'])
    safe = {k: v for k, v in user.items() if k not in ('password_hash', 'privacy_settings')}
    # Apply privacy settings
    import json as _json
    try:
        priv = _json.loads(user.get('privacy_settings') or '{}')
    except Exception:
        priv = {}
    if not priv.get('show_status', True):
        safe['status'] = None
    if not priv.get('show_birthday', True):
        safe['birthday'] = None
    if not priv.get('show_phone', True):
        safe['phone'] = None
    if not priv.get('show_email', True):
        safe['email'] = None
    safe['tags'] = tags if priv.get('show_tags', True) else []
    # last_seen with privacy
    raw_ls = user.get('last_seen')
    if not priv.get('show_last_seen', True):
        safe['last_seen'] = 'hidden'
    elif raw_ls and hasattr(raw_ls, 'isoformat'):
        safe['last_seen'] = raw_ls.isoformat() + 'Z'
    else:
        safe['last_seen'] = raw_ls
    return {"user": safe}

@app.get("/api/users/search")
async def search_users(token: str, query: str):
    """Поиск пользователей по префиксу имени"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    current_user_id = payload['user_id']
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, username, avatar, avatar_color, status FROM users WHERE username LIKE %s AND id != %s ORDER BY username LIMIT 10",
                (f"{query}%", current_user_id)
            )
            rows = await cur.fetchall()
    result = []
    for u in rows:
        ud = dict(u)
        ud['is_online'] = manager.is_user_online(ud['id'])
        result.append(ud)
    return {"users": result}

@app.get("/api/users")
async def get_users(token: str):
    """Получить список контактов (пользователей с которыми переписывались)"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    users = await UserModel.get_contacts(payload['user_id'])
    result = []
    for u in users:
        ud = dict(u)
        priv = {}
        try:
            priv = json.loads(ud.get('privacy_settings') or '{}')
        except Exception:
            pass
        ud.pop('privacy_settings', None)
        if not priv.get('show_last_seen', True):
            ud['last_seen'] = 'hidden'
        elif ud.get('last_seen') and hasattr(ud['last_seen'], 'isoformat'):
            ud['last_seen'] = ud['last_seen'].isoformat() + 'Z'
        ud['is_online'] = manager.is_user_online(ud['id'])
        result.append(ud)
    return {"users": result}

@app.get("/api/profile")
async def get_profile(token: str):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await UserModel.get_user_by_id(payload['user_id'])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    tags = await UserModel.get_tags(payload['user_id'])
    user_data = dict(user)
    user_data.pop('password_hash', None)
    user_data['tags'] = tags
    # Convert birthday to string if datetime
    if user_data.get('birthday') and hasattr(user_data['birthday'], 'isoformat'):
        user_data['birthday'] = user_data['birthday'].isoformat()
    return {"success": True, "user": user_data}

@app.put("/api/profile")
async def update_profile(request: UpdateProfileRequest, token: str):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    if request.username:
        existing = await UserModel.get_user_by_username(request.username)
        if existing and existing['id'] != payload['user_id']:
            raise HTTPException(status_code=400, detail="Username already taken")
    success = await UserModel.update_profile(
        payload['user_id'],
        username=request.username,
        status=request.status,
        avatar_color=request.avatar_color,
        birthday=request.birthday,
        phone=request.phone,
        privacy_settings=request.privacy_settings
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update profile")
    user = await UserModel.get_user_by_id(payload['user_id'])
    tags = await UserModel.get_tags(payload['user_id'])
    # Apply privacy settings to broadcast
    import json as _json
    try:
        priv = _json.loads(user.get('privacy_settings') or '{}')
    except Exception:
        priv = {}
    broadcast_status = user.get('status') if priv.get('show_status', True) else None
    # Broadcast to all connected users
    for uid in list(manager.active_connections.keys()):
        await manager.send_message_to_user(uid, {
            "type": "profile_updated",
            "data": {
                "user_id": payload['user_id'],
                "username": user.get('username'),
                "avatar": user.get('avatar'),
                "status": broadcast_status,
                "avatar_color": user.get('avatar_color', '#1a73e8')
            }
        })
    user_data = dict(user)
    user_data.pop('password_hash', None)
    user_data['tags'] = tags
    return {"success": True, "user": user_data}

@app.post("/api/profile/avatar")
async def update_avatar(token: str = Form(...), file: UploadFile = File(...)):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    allowed = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Only images allowed")
    ext = os.path.splitext(file.filename)[1]
    unique_filename = f"avatar_{uuid.uuid4().hex}{ext}"
    file_path = os.path.join("uploads", unique_filename)
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    avatar_url = f"/files/{unique_filename}"
    await UserModel.update_avatar(payload['user_id'], avatar_url)
    user = await UserModel.get_user_by_id(payload['user_id'])
    try:
        _priv = json.loads(user.get('privacy_settings') or '{}')
    except Exception:
        _priv = {}
    for uid in list(manager.active_connections.keys()):
        await manager.send_message_to_user(uid, {
            "type": "profile_updated",
            "data": {
                "user_id": payload['user_id'],
                "username": user.get('username'),
                "avatar": avatar_url,
                "status": user.get('status') if _priv.get('show_status', True) else None,
                "avatar_color": user.get('avatar_color', '#1a73e8')
            }
        })
    return {"success": True, "avatar": avatar_url}

@app.delete("/api/profile/avatar")
async def remove_avatar(token: str):
    """Удалить аватарку пользователя"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    await UserModel.remove_avatar(payload['user_id'])
    user = await UserModel.get_user_by_id(payload['user_id'])
    try:
        _priv2 = json.loads(user.get('privacy_settings') or '{}')
    except Exception:
        _priv2 = {}
    for uid in list(manager.active_connections.keys()):
        await manager.send_message_to_user(uid, {
            "type": "profile_updated",
            "data": {
                "user_id": payload['user_id'],
                "username": user.get('username'),
                "avatar": None,
                "status": user.get('status') if _priv2.get('show_status', True) else None,
                "avatar_color": user.get('avatar_color', '#1a73e8')
            }
        })
    return {"success": True}

@app.get("/api/profile/tags")
async def get_my_tags(token: str):
    """Получить теги текущего пользователя"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    tags = await UserModel.get_tags(payload['user_id'])
    return {"tags": tags}

@app.post("/api/profile/tags")
async def add_tag(request: AddTagRequest, token: str):
    """Добавить тег (глобально уникален)"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    tag = request.tag.strip().lstrip('#')
    if not tag or len(tag) > 50:
        raise HTTPException(status_code=400, detail="Invalid tag")
    success = await UserModel.add_tag(payload['user_id'], tag)
    if not success:
        raise HTTPException(status_code=400, detail="Tag already taken")
    return {"success": True, "tag": tag}

@app.delete("/api/profile/tags/{tag}")
async def remove_tag(tag: str, token: str):
    """Удалить тег"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    await UserModel.remove_tag(payload['user_id'], tag)
    return {"success": True}

@app.post("/api/groups/{group_id}/avatar")
async def update_group_avatar(group_id: int, token: str = Form(...), file: UploadFile = File(...)):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    allowed = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Only images allowed")
    ext = os.path.splitext(file.filename)[1]
    unique_filename = f"group_{uuid.uuid4().hex}{ext}"
    file_path = os.path.join("uploads", unique_filename)
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    avatar_url = f"/files/{unique_filename}"
    await GroupModel.update_group_avatar(group_id, avatar_url)
    # Notify group members
    members = await GroupModel.get_members(group_id)
    for member in members:
        await manager.send_message_to_user(member['id'], {
            "type": "group_updated",
            "data": {"group_id": group_id, "avatar": avatar_url}
        })
    return {"success": True, "avatar": avatar_url}

# ========== Личные сообщения ==========

@app.get("/api/conversation/{user_id}")
async def get_conversation(user_id: int, token: str, limit: int = 10000):
    """Получить историю диалога с указанным пользователем"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    current_user_id = payload['user_id']
    messages = await MessageModel.get_conversation(current_user_id, user_id, limit)

    # Добавляем реакции
    if messages:
        msg_ids = [m['id'] for m in messages]
        reactions_map = await ReactionModel.get_reactions_for_messages(msg_ids, False)
        for msg in messages:
            msg['reactions'] = reactions_map.get(msg['id'], [])

    return {"messages": messages}

# ========== Групповые чаты ==========

@app.post("/api/groups")
async def create_group(token: str, name: str, description: str = ""):
    """Создать новую группу"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    group_id = await GroupModel.create_group(name, description, payload['user_id'])
    # В main.py, в эндпоинте create_group:
    if group_id:
        # Отправляем уведомление создателю
        await manager.send_message_to_user(payload['user_id'], {
            "type": "new_group",
            "data": {"group_id": group_id, "name": name}
        })
    if not group_id:
        raise HTTPException(status_code=500, detail="Failed to create group")
    
    return {"success": True, "group_id": group_id, "name": name}

@app.get("/api/groups")
async def get_my_groups(token: str):
    """Получить все группы пользователя"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    groups = await GroupModel.get_user_groups(payload['user_id'])
    return {"groups": groups}

@app.get("/api/groups/{group_id}")
async def get_group_info(group_id: int, token: str):
    """Получить информацию о группе"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    group = await GroupModel.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    members = await GroupModel.get_members(group_id)
    return {"group": group, "members": members}

@app.post("/api/groups/{group_id}/invite")
async def invite_to_group(group_id: int, request: InviteToGroupRequest, token: str):
    """Пригласить пользователя в группу"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    user = await UserModel.get_user_by_username(request.username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Проверяем, не состоит ли уже в группе
    members = await GroupModel.get_members(group_id)
    for member in members:
        if member['id'] == user['id']:
            raise HTTPException(status_code=400, detail="User already in group")
    
    success = await GroupModel.add_member(group_id, user['id'])
    if not success:
        raise HTTPException(status_code=400, detail="Failed to add user")
    
    # Получаем информацию о группе для уведомления
    group = await GroupModel.get_group(group_id)

    # Отправляем уведомление приглашенному пользователю
    await manager.send_message_to_user(user['id'], {
        "type": "new_group",
        "data": {
            "group_id": group_id,
            "name": group['name'],
            "member_count": group['member_count']
        }
    })

    # Сохраняем системное сообщение
    await GroupMessageModel.save_message(
        group_id=group_id,
        message_text=f"{user['username']} вступил в группу",
        is_system=True
    )

    # Отправляем всем существующим участникам группы (кроме нового) уведомление об обновлении
    for member in members:
        await manager.send_message_to_user(member['id'], {
            "type": "group_member_added",
            "data": {
                "group_id": group_id,
                "user_id": user['id'],
                "username": user['username']
            }
        })

    return {"success": True, "message": f"{request.username} added to group"}

@app.get("/api/groups/{group_id}/messages")
async def get_group_messages(group_id: int, token: str, limit: int = 10000):
    """Получить историю сообщений группы"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    messages = await GroupMessageModel.get_messages(group_id, limit)

    if messages:
        msg_ids = [m['id'] for m in messages]
        reactions_map = await ReactionModel.get_reactions_for_messages(msg_ids, True)
        read_counts = await GroupReadModel.get_read_counts(msg_ids)
        for msg in messages:
            msg['reactions'] = reactions_map.get(msg['id'], [])
            # is_read = at least 1 other member has read this message
            msg['is_read'] = read_counts.get(msg['id'], 0) > 0

    return {"messages": messages}

@app.put("/api/groups/{group_id}")
async def update_group(group_id: int, request: UpdateGroupRequest, token: str):
    """Редактировать группу (только для админа)"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = await GroupModel.get_member_role(group_id, payload['user_id'])
    if role != 'admin':
        raise HTTPException(status_code=403, detail="Only admin can edit group")
    success = await GroupModel.update_group(group_id, request.name, request.description)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update group")
    group = await GroupModel.get_group(group_id)
    members = await GroupModel.get_members(group_id)
    for member in members:
        await manager.send_message_to_user(member['id'], {
            "type": "group_info_updated",
            "data": {"group_id": group_id, "name": group['name'], "description": group.get('description', '')}
        })
    return {"success": True, "group": group}

@app.delete("/api/groups/{group_id}")
async def delete_group(group_id: int, token: str):
    """Удалить группу (только для админа)"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = await GroupModel.get_member_role(group_id, payload['user_id'])
    if role != 'admin':
        raise HTTPException(status_code=403, detail="Only admin can delete group")
    members = await GroupModel.get_members(group_id)
    success = await GroupModel.delete_group(group_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete group")
    for member in members:
        await manager.send_message_to_user(member['id'], {
            "type": "group_deleted",
            "data": {"group_id": group_id}
        })
    return {"success": True}

@app.delete("/api/groups/{group_id}/members/{user_id}")
async def remove_group_member(group_id: int, user_id: int, token: str):
    """Удалить участника из группы"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = await GroupModel.get_member_role(group_id, payload['user_id'])
    if role != 'admin' and payload['user_id'] != user_id:
        raise HTTPException(status_code=403, detail="Not allowed")
    success = await GroupModel.remove_member(group_id, user_id)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to remove member")
    await manager.send_message_to_user(user_id, {
        "type": "removed_from_group",
        "data": {"group_id": group_id}
    })
    removed_user = await UserModel.get_user_by_id(user_id)
    username = removed_user['username'] if removed_user else str(user_id)
    # Сохраняем системное сообщение
    await GroupMessageModel.save_message(
        group_id=group_id,
        message_text=f"{username} покинул группу",
        is_system=True
    )
    remaining = await GroupModel.get_members(group_id)
    for member in remaining:
        await manager.send_message_to_user(member['id'], {
            "type": "group_member_removed",
            "data": {"group_id": group_id, "user_id": user_id, "username": username}
        })
    return {"success": True}

@app.delete("/api/groups/{group_id}/messages")
async def clear_group_messages(group_id: int, token: str):
    """Очистить историю группы (только для админа)"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = await GroupModel.get_member_role(group_id, payload['user_id'])
    if role != 'admin':
        raise HTTPException(status_code=403, detail="Only admin can clear messages")
    success = await GroupMessageModel.clear_messages(group_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to clear messages")
    members = await GroupModel.get_members(group_id)
    for member in members:
        await manager.send_message_to_user(member['id'], {
            "type": "chat_cleared",
            "data": {"group_id": group_id, "is_group": True}
        })
    return {"success": True}

@app.delete("/api/conversation/{user_id}")
async def clear_conversation(user_id: int, token: str):
    """Очистить личный чат"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    success = await MessageModel.clear_conversation(payload['user_id'], user_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to clear conversation")
    # Notify both users
    await manager.send_message_to_user(payload['user_id'], {
        "type": "chat_cleared",
        "data": {"user_id": user_id, "is_group": False}
    })
    await manager.send_message_to_user(user_id, {
        "type": "chat_cleared",
        "data": {"user_id": payload['user_id'], "is_group": False}
    })
    return {"success": True}

# ========== Файлы ==========

MAX_UPLOAD_SIZE = 1 * 1024 * 1024 * 1024  # 1 GB

@app.post("/api/upload")
async def upload_file(token: str = Form(...), file: UploadFile = File(...)):
    """Загрузить файл на сервер (до 1 ГБ)"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    file_extension = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4().hex}{file_extension}"
    file_path = os.path.join("uploads", unique_filename)

    total_size = 0
    chunk_size = 1024 * 1024  # 1 MB chunks
    try:
        with open(file_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > MAX_UPLOAD_SIZE:
                    f.close()
                    os.remove(file_path)
                    raise HTTPException(status_code=413, detail="Файл превышает лимит 1 ГБ")
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "success": True,
        "file_path": f"/files/{unique_filename}",
        "filename": file.filename,
        "file_size": total_size
    }

@app.get("/files/{filename}")
async def get_file(filename: str):
    """Получить файл"""
    file_path = os.path.join("uploads", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    content_type, _ = mimetypes.guess_type(file_path)
    if not content_type:
        content_type = "application/octet-stream"
    
    return FileResponse(file_path, media_type=content_type, headers={"Access-Control-Allow-Origin": "*"})

@app.get("/files/download/{message_id}")
async def download_file_by_id(message_id: int):
    """Скачать файл с оригинальным именем по ID сообщения"""
    try:
        message = await MessageModel.get_message_by_id(message_id)
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
        
        file_path = message.get('file_path')
        if not file_path:
            raise HTTPException(status_code=404, detail="No file attached")
        
        file_name = os.path.basename(file_path)
        full_path = os.path.join("uploads", file_name)
        
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        original_filename = message.get('filename', file_name)
        encoded_filename = quote(original_filename, encoding='utf-8')
        
        content_type, _ = mimetypes.guess_type(full_path)
        if not content_type:
            content_type = "application/octet-stream"
        
        return FileResponse(
            full_path,
            media_type=content_type,
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            }
        )
        
    except Exception as e:
        print(f"Error downloading file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.options("/files/download/{message_id}")
async def options_download_file(message_id: int):
    """Обработка OPTIONS запроса для CORS"""
    return JSONResponse(
        status_code=200,
        content={"message": "OK"},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "86400",
        }
    )


@app.get("/files/group/download/{message_id}")
async def download_group_file_by_id(message_id: int):
    """Скачать файл из группового сообщения с оригинальным именем"""
    try:
        # Получаем сообщение из групповых сообщений
        message = await GroupMessageModel.get_message_by_id(message_id)
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")
        
        file_path = message.get('file_path')
        if not file_path:
            raise HTTPException(status_code=404, detail="No file attached")
        
        file_name = os.path.basename(file_path)
        full_path = os.path.join("uploads", file_name)
        
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        original_filename = message.get('filename', file_name)
        encoded_filename = quote(original_filename, encoding='utf-8')
        
        content_type, _ = mimetypes.guess_type(full_path)
        if not content_type:
            content_type = "application/octet-stream"
        
        return FileResponse(
            full_path,
            media_type=content_type,
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            }
        )
        
    except Exception as e:
        print(f"Error downloading group file: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    

# ========== Поиск ==========

from fastapi.responses import JSONResponse

@app.get("/api/search")
async def search_messages(token: str, query: str, chat_type: str = None, chat_id: int = None):
    """Поиск сообщений в чате"""
    payload = decode_jwt_token(token)
    if not payload:
        return JSONResponse(
            status_code=401,
            content={"error": "Invalid token"}
        )
    
    user_id = payload['user_id']
    results = []
    
    try:
        if chat_type == 'private' and chat_id:
            messages = await MessageModel.search_conversation(user_id, chat_id, query)
            results = messages
        elif chat_type == 'group' and chat_id:
            members = await GroupModel.get_members(chat_id)
            if not any(m['id'] == user_id for m in members):
                return JSONResponse(
                    status_code=403,
                    content={"error": "Not a member of this group"}
                )
            messages = await GroupMessageModel.search_messages(chat_id, query)
            results = messages
        else:
            messages = await MessageModel.search_all_conversations(user_id, query)
            results = messages
        
        return JSONResponse(
            status_code=200,
            content={"results": results, "query": query}
        )
    except Exception as e:
        print(f"❌ Search error: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "results": [], "query": query}
        )

# ========== WebSocket ==========

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket эндпоинт для реального времени"""
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008, reason="Missing token")
        return
    
    payload = decode_jwt_token(token)
    if not payload:
        await websocket.close(code=1008, reason="Invalid token")
        return
    
    user_id = payload['user_id']
    username = payload['username']
    
    await manager.connect(user_id, websocket)
    await UserModel.update_last_seen(user_id)

    # Уведомляем всех об онлайн статусе
    for uid in list(manager.active_connections.keys()):
        if uid != user_id:
            await manager.send_message_to_user(uid, {"type": "user_status", "data": {"user_id": user_id, "is_online": True}})

    # Отправляем недоставленные личные сообщения
    undelivered = await MessageModel.get_undelivered_messages(user_id)
    if undelivered:
        print(f"📦 Sending {len(undelivered)} undelivered messages to {username}")
        for msg in undelivered:
            await manager.send_message_to_user(user_id, {
                "type": "message",
                "data": {
                    "id": msg['id'],
                    "sender_id": msg['sender_id'],
                    "sender_name": msg['sender_name'],
                    "message_text": msg['message_text'],
                    "file_path": msg['file_path'],
                    "filename": msg.get('filename'),
                    "file_size": msg.get('file_size'),
                    "timestamp": msg['timestamp'].isoformat() if msg['timestamp'] else None
                }
            })
        await MessageModel.mark_as_delivered([msg['id'] for msg in undelivered])

    # Уведомляем о прочитанных сообщениях которые были прочитаны пока мы были оффлайн
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id FROM messages WHERE sender_id = %s AND is_read = 1",
                (user_id,)
            )
            read_msgs = await cur.fetchall()
    if read_msgs:
        read_ids = [m['id'] for m in read_msgs]
        await manager.send_message_to_user(user_id, {
            "type": "messages_read",
            "data": {"reader_id": None, "message_ids": read_ids}
        })

    try:
        while True:
            data = await websocket.receive_json()
            print(f"📥 Received from {username}: type={data.get('type')} text={repr(data.get('message_text',''))}")

            if data.get("type") == "message":
                receiver_id = data.get("receiver_id")
                message_text = data.get("message_text", "")
                file_path = data.get("file_path")
                filename = data.get("filename")
                file_size = data.get("file_size")
                reply_to_id = data.get("reply_to_id")
                files_list = data.get("files")
                files_json = json.dumps(files_list) if files_list else None

                current_timestamp = datetime.now(timezone.utc).isoformat()
                
                # Получаем информацию об ответе
                reply_to_text = None
                reply_to_sender = None
                if reply_to_id:
                    reply_msg = await MessageModel.get_message_by_id(reply_to_id)
                    if reply_msg:
                        if reply_msg.get('message_text'):
                            reply_to_text = reply_msg['message_text']
                        elif reply_msg.get('filename'):
                            reply_to_text = f"📎 {reply_msg['filename']}"
                        else:
                            try:
                                fl = json.loads(reply_msg['files']) if isinstance(reply_msg.get('files'), str) else (reply_msg.get('files') or [])
                                reply_to_text = f"📎 {fl[0]['filename']}" if fl else ''
                            except Exception:
                                reply_to_text = ''
                        reply_sender = await UserModel.get_user_by_id(reply_msg['sender_id'])
                        reply_to_sender = reply_sender['username'] if reply_sender else ''
                        print(f"📝 Reply found: id={reply_to_id}, text='{reply_to_text}', sender='{reply_to_sender}'")
                
                # Сохраняем
                message_id = await MessageModel.save_message(
                    sender_id=user_id,
                    receiver_id=receiver_id,
                    message_text=message_text,
                    file_path=file_path,
                    filename=filename,
                    file_size=file_size,
                    reply_to_id=reply_to_id,
                    reply_to_text=reply_to_text,
                    reply_to_sender=reply_to_sender,
                    files=files_json
                )
                
                print(f"💾 Saved message {message_id} with reply_to_text='{reply_to_text}'")
                        
                            # Получаем информацию об отправителе
                sender = await UserModel.get_user_by_id(user_id)

                
                # Создаем данные сообщения
# Создаем данные сообщения для отправки
                message_data = {
                    "id": message_id,
                    "sender_id": user_id,
                    "receiver_id": receiver_id,
                    "sender_name": sender['username'],
                    "message_text": message_text,
                    "file_path": file_path,
                    "filename": filename,
                    "file_size": file_size,
                    "files": files_list,
                    "reply_to_id": reply_to_id,
                    "reply_to_text": reply_to_text,
                    "reply_to_sender": reply_to_sender,
                    "timestamp": current_timestamp
                }
                
                # Отправляем получателю если он онлайн
                delivered = await manager.send_message_to_user(receiver_id, {
                    "type": "message",
                    "data": message_data
                })
                
                # Если сообщение доставлено, помечаем его как доставленное
                if delivered:
                    await MessageModel.mark_as_delivered([message_id])
                
                # Отправляем отправителю подтверждение (delivered уже определена)
                await manager.send_message_to_user(user_id, {
                    "type": "message_sent",
                    "data": {
                        **message_data,
                        "delivered": delivered
                    }
                })
            
            # Групповое сообщение
            # В обработчике group_message
            elif data.get("type") == "group_message":
                group_id = data.get("group_id")
                message_text = data.get("message_text", "")
                file_path = data.get("file_path")
                filename = data.get("filename")
                file_size = data.get("file_size")
                reply_to_id = data.get("reply_to_id")
                files_list = data.get("files")
                files_json = json.dumps(files_list) if files_list else None
                current_timestamp = datetime.now(timezone.utc).isoformat()
                # Получаем информацию о сообщении, на которое отвечаем
                reply_to_text = None
                reply_to_sender = None
                if reply_to_id:
                    reply_msg = await GroupMessageModel.get_message_by_id(reply_to_id)
                    if reply_msg:
                        if reply_msg.get('message_text'):
                            reply_to_text = reply_msg['message_text']
                        elif reply_msg.get('filename'):
                            reply_to_text = f"📎 {reply_msg['filename']}"
                        else:
                            try:
                                fl = json.loads(reply_msg['files']) if isinstance(reply_msg.get('files'), str) else (reply_msg.get('files') or [])
                                reply_to_text = f"📎 {fl[0]['filename']}" if fl else ''
                            except Exception:
                                reply_to_text = ''
                        reply_sender = await UserModel.get_user_by_id(reply_msg['sender_id'])
                        reply_to_sender = reply_sender['username'] if reply_sender else ''
                
                # Сохраняем сообщение
                message_id = await GroupMessageModel.save_message(
                    group_id=group_id,
                    sender_id=user_id,
                    message_text=message_text if message_text else None,
                    file_path=file_path,
                    filename=filename,
                    file_size=file_size,
                    reply_to_id=reply_to_id,
                    files=files_json
                )
                
                # Получаем отправителя
                sender = await UserModel.get_user_by_id(user_id)
                
                message_data = {
                    "id": message_id,
                    "group_id": group_id,
                    "sender_id": user_id,
                    "sender_name": sender['username'],
                    "sender_avatar": sender.get('avatar'),
                    "sender_avatar_color": sender.get('avatar_color'),
                    "message_text": message_text,
                    "file_path": file_path,
                    "filename": filename,
                    "file_size": file_size,
                    "files": files_list,
                    "reply_to_id": reply_to_id,
                    "reply_to_text": reply_to_text or '',
                    "reply_to_sender": reply_to_sender or '',
                    "timestamp": current_timestamp,
                    "is_read": False
                }
                
                # Получаем всех участников группы
                members = await GroupModel.get_members(group_id)
                
                # Отправляем всем участникам
                for member in members:
                    await manager.send_message_to_user(member['id'], {
                        "type": "group_message",
                        "data": message_data
                    })
            
            # Индикатор набора текста (личный)
            elif data.get("type") == "typing":
                receiver_id = data.get("receiver_id")
                await manager.send_message_to_user(receiver_id, {
                    "type": "typing",
                    "data": {
                        "user_id": user_id,
                        "username": username
                    }
                })
            
            # Индикатор набора текста (групповой)
            elif data.get("type") == "group_typing":
                group_id = data.get("group_id")
                members = await GroupModel.get_members(group_id)
                for member in members:
                    if member['id'] != user_id:
                        await manager.send_message_to_user(member['id'], {
                            "type": "group_typing",
                            "data": {
                                "group_id": group_id,
                                "user_id": user_id,
                                "username": username
                            }
                        })

            
            elif data.get("type") == "edit_message":
                message_id = data.get("message_id")
                new_text = data.get("new_text")
                is_group = data.get("is_group", False)
                
                print(f"✏️ EDIT MESSAGE RECEIVED: id={message_id}, new_text={new_text}, is_group={is_group}")
                
                try:
                    if is_group:
                        msg = await GroupMessageModel.get_message_by_id(message_id)
                        if not msg or msg['sender_id'] != user_id:
                            await manager.send_message_to_user(user_id, {"type": "error", "data": {"message": "Нет прав для редактирования этого сообщения"}})
                        else:
                            success = await GroupMessageModel.update_message(message_id, new_text)
                            print(f"✏️ Group edit result: {success}")
                            if success:
                                members = await GroupModel.get_members(msg['group_id'])
                                for member in members:
                                    await manager.send_message_to_user(member['id'], {
                                        "type": "message_edited",
                                        "data": {
                                            "message_id": message_id,
                                            "new_text": new_text,
                                            "is_group": True,
                                            "group_id": msg['group_id']
                                        }
                                    })
                    else:
                        msg = await MessageModel.get_message_by_id(message_id)
                        if not msg or msg['sender_id'] != user_id:
                            await manager.send_message_to_user(user_id, {"type": "error", "data": {"message": "Нет прав для редактирования этого сообщения"}})
                        else:
                            success = await MessageModel.update_message(message_id, new_text)
                            print(f"✏️ Private edit result: {success}")
                            if success:
                                await manager.send_message_to_user(msg['sender_id'], {
                                    "type": "message_edited",
                                    "data": {
                                        "message_id": message_id,
                                        "new_text": new_text,
                                        "is_group": False
                                    }
                                })
                                await manager.send_message_to_user(msg['receiver_id'], {
                                    "type": "message_edited",
                                    "data": {
                                        "message_id": message_id,
                                        "new_text": new_text,
                                        "is_group": False
                                    }
                                })
                except Exception as e:
                    print(f"❌ Error editing message: {e}")
                    import traceback
                    traceback.print_exc()


            elif data.get("type") == "mark_read":
                sender_id = data.get("sender_id")
                if sender_id:
                    read_ids = await MessageModel.mark_as_read(sender_id, user_id)
                    if read_ids:
                        await manager.send_message_to_user(sender_id, {
                            "type": "messages_read",
                            "data": {"reader_id": user_id, "message_ids": read_ids}
                        })

            elif data.get("type") == "group_mark_read":
                group_id = data.get("group_id")
                if group_id:
                    newly_read = await GroupReadModel.mark_group_messages_read(group_id, user_id)
                    if newly_read:
                        # Find senders of these messages and notify them
                        pool = await DatabasePool.get_pool()
                        async with pool.acquire() as conn:
                            async with conn.cursor(aiomysql.DictCursor) as cur:
                                fmt = ','.join(['%s'] * len(newly_read))
                                await cur.execute(
                                    f"SELECT DISTINCT sender_id FROM group_messages WHERE id IN ({fmt}) AND sender_id IS NOT NULL",
                                    newly_read
                                )
                                senders = await cur.fetchall()
                        for s in senders:
                            if s['sender_id'] != user_id:
                                await manager.send_message_to_user(s['sender_id'], {
                                    "type": "group_messages_read",
                                    "data": {"group_id": group_id, "message_ids": newly_read, "reader_id": user_id}
                                })

            elif data.get("type") == "add_reaction":
                message_id = data.get("message_id")
                is_group = data.get("is_group", False)
                emoji = data.get("emoji", "")
                if message_id and emoji:
                    await ReactionModel.add_reaction(message_id, is_group, user_id, emoji)
                    event = {"type": "reaction_update", "data": {
                        "message_id": message_id, "is_group": is_group,
                        "user_id": user_id, "emoji": emoji, "action": "add"
                    }}
                    if is_group:
                        gm = await GroupMessageModel.get_message_by_id(message_id)
                        if gm:
                            members = await GroupModel.get_members(gm['group_id'])
                            for m in members:
                                await manager.send_message_to_user(m['id'], event)
                    else:
                        msg = await MessageModel.get_message_by_id(message_id)
                        if msg:
                            await manager.send_message_to_user(msg['sender_id'], event)
                            await manager.send_message_to_user(msg['receiver_id'], event)

            elif data.get("type") == "remove_reaction":
                message_id = data.get("message_id")
                is_group = data.get("is_group", False)
                emoji = data.get("emoji", "")
                if message_id and emoji:
                    await ReactionModel.remove_reaction(message_id, is_group, user_id, emoji)
                    event = {"type": "reaction_update", "data": {
                        "message_id": message_id, "is_group": is_group,
                        "user_id": user_id, "emoji": emoji, "action": "remove"
                    }}
                    if is_group:
                        gm = await GroupMessageModel.get_message_by_id(message_id)
                        if gm:
                            members = await GroupModel.get_members(gm['group_id'])
                            for m in members:
                                await manager.send_message_to_user(m['id'], event)
                    else:
                        msg = await MessageModel.get_message_by_id(message_id)
                        if msg:
                            await manager.send_message_to_user(msg['sender_id'], event)
                            await manager.send_message_to_user(msg['receiver_id'], event)

            elif data.get("type") == "delete_message":
                message_id = data.get("message_id")
                is_group = data.get("is_group", False)
                
                print(f"🗑️ DELETE MESSAGE RECEIVED: id={message_id}, is_group={is_group}")
                
                try:
                    if is_group:
                        msg = await GroupMessageModel.get_message_by_id(message_id)
                        if not msg or msg['sender_id'] != user_id:
                            await manager.send_message_to_user(user_id, {"type": "error", "data": {"message": "Нет прав для удаления этого сообщения"}})
                        else:
                            success = await GroupMessageModel.delete_message(message_id)
                            print(f"🗑️ Group delete result: {success}")
                            if success:
                                members = await GroupModel.get_members(msg['group_id'])
                                print(f"👥 Sending delete to {len(members)} members")
                                for member in members:
                                    await manager.send_message_to_user(member['id'], {
                                        "type": "message_deleted",
                                        "data": {
                                            "message_id": message_id,
                                            "is_group": True
                                        }
                                    })
                    else:
                        msg = await MessageModel.get_message_by_id(message_id)
                        if not msg or msg['sender_id'] != user_id:
                            await manager.send_message_to_user(user_id, {"type": "error", "data": {"message": "Нет прав для удаления этого сообщения"}})
                        else:
                            success = await MessageModel.delete_message(message_id)
                            print(f"🗑️ Private delete result: {success}")
                            if success:
                                await manager.send_message_to_user(msg['sender_id'], {
                                    "type": "message_deleted",
                                    "data": {
                                        "message_id": message_id,
                                        "is_group": False
                                    }
                                })
                                await manager.send_message_to_user(msg['receiver_id'], {
                                    "type": "message_deleted",
                                    "data": {
                                        "message_id": message_id,
                                        "is_group": False
                                    }
                                })
                except Exception as e:
                    print(f"❌ Error deleting message: {e}")
                    import traceback
                    traceback.print_exc()
           
                            
    except WebSocketDisconnect:
        manager.disconnect(user_id)
        await UserModel.update_last_seen(user_id)
        print(f"User {username} disconnected")
        for uid in list(manager.active_connections.keys()):
            await manager.send_message_to_user(uid, {"type": "user_status", "data": {"user_id": user_id, "is_online": False}})
    except Exception as e:
        print(f"❌ Unexpected error for {username}: {e}")
        manager.disconnect(user_id)
        await UserModel.update_last_seen(user_id)
        for uid in list(manager.active_connections.keys()):
            await manager.send_message_to_user(uid, {"type": "user_status", "data": {"user_id": user_id, "is_online": False}})

# ========== Папки чатов ==========

class CreateFolderRequest(BaseModel):
    name: str
    color: str = '#6366f1'

class UpdateFolderRequest(BaseModel):
    name: str = None
    color: str = None

class AddChatToFolderRequest(BaseModel):
    chat_type: str
    chat_id: int

@app.get("/api/folders")
async def get_folders(token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    return {"folders": await FolderModel.get_folders(payload['user_id'])}

@app.post("/api/folders")
async def create_folder(request: CreateFolderRequest, token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    folder_id = await FolderModel.create_folder(payload['user_id'], request.name, request.color)
    return {"id": folder_id, "name": request.name, "color": request.color, "chats": []}

@app.put("/api/folders/{folder_id}")
async def update_folder(folder_id: int, request: UpdateFolderRequest, token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    ok = await FolderModel.update_folder(folder_id, payload['user_id'], request.name, request.color)
    return {"ok": ok}

@app.delete("/api/folders/{folder_id}")
async def delete_folder(folder_id: int, token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    ok = await FolderModel.delete_folder(folder_id, payload['user_id'])
    return {"ok": ok}

@app.post("/api/folders/{folder_id}/chats")
async def add_chat_to_folder(folder_id: int, request: AddChatToFolderRequest, token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    ok = await FolderModel.add_chat(folder_id, request.chat_type, request.chat_id)
    return {"ok": ok}

@app.delete("/api/folders/{folder_id}/chats/{chat_type}/{chat_id}")
async def remove_chat_from_folder(folder_id: int, chat_type: str, chat_id: int, token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    ok = await FolderModel.remove_chat(folder_id, chat_type, chat_id)
    return {"ok": ok}

# ========== Статика ==========

# Подключаем статические файлы клиента (если есть)
client_build_path = os.path.join(os.path.dirname(__file__), "../../client/build")
if os.path.exists(client_build_path):
    app.mount("/", StaticFiles(directory=client_build_path, html=True), name="client")
    print(f"📁 Serving static files from {client_build_path}")
else:
    print(f"⚠️ Client build not found at {client_build_path}")