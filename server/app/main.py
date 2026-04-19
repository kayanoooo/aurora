import aiomysql
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
import os
import re
import uuid
import json
import mimetypes
import asyncio
from urllib.parse import quote
from datetime import datetime, timezone
import cloudinary
import cloudinary.uploader

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
)

def _cloudinary_configured() -> bool:
    name = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    key = os.getenv("CLOUDINARY_API_KEY", "")
    return bool(name and key and name not in ("ваш_cloud_name",) and key not in ("ваш_api_key",))

from .config import config
from .models import DatabasePool, UserModel, MessageModel, GroupModel, GroupMessageModel, ReactionModel, FolderModel, GroupReadModel, PostViewModel, SupportModel, BlockModel
from .auth import hash_password, verify_password, create_jwt_token, decode_jwt_token
from .websocket_manager import manager


# Pydantic модели для запросов
class RegisterRequest(BaseModel):
    email: str
    password: str

class SetupRequest(BaseModel):
    tag: str
    username: str
    theme: Optional[str] = None

class LoginRequest(BaseModel):
    email: str
    password: str

class PasswordResetRequest(BaseModel):
    email: str
    tag: str
    old_password: str
    new_password: str

class CreateGroupRequest(BaseModel):
    name: str
    description: str = ""

class InviteToGroupRequest(BaseModel):
    tag: str

class UpdateProfileRequest(BaseModel):
    username: Optional[str] = None
    status: Optional[str] = None
    avatar_color: Optional[str] = None
    birthday: Optional[str] = None
    phone: Optional[str] = None
    privacy_settings: Optional[str] = None
    tag: Optional[str] = None

class AddTagRequest(BaseModel):
    tag: str

class UpdateGroupRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class CreateChannelRequest(BaseModel):
    name: str
    description: str = ""
    channel_type: str = "public"
    channel_tag: Optional[str] = None

class UpdateChannelSettingsRequest(BaseModel):
    channel_type: Optional[str] = None
    channel_tag: Optional[str] = None

class SupportSendRequest(BaseModel):
    message_text: str

class AdminReplyRequest(BaseModel):
    user_id: int
    message_text: str

class UpdatePublicKeyRequest(BaseModel):
    public_key: str

class CreatePollRequest(BaseModel):
    question: str
    options: List[str]
    is_anonymous: bool = False
    is_multi_choice: bool = False

class VotePollRequest(BaseModel):
    option_indices: List[int]

class ScheduleMessageRequest(BaseModel):
    message_text: str
    scheduled_at: str   # ISO datetime string
    receiver_id: Optional[int] = None
    group_id: Optional[int] = None

app = FastAPI(title="Messenger API", version="2.0.0")

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://192.168.1.2:3000",
    "http://192.168.1.2:8000",
    "http://192.168.1.9:3000",
    "http://192.168.1.9:8000",
    "https://aurora-messenger.vercel.app",
]

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    origin = request.headers.get("origin", "")
    headers = {}
    if origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    import traceback
    print(f"Unhandled exception on {request.method} {request.url}: {exc}")
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"detail": str(exc)}, headers=headers)

# Настройка CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
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
                "ALTER TABLE `groups` ADD COLUMN `is_channel` TINYINT(1) NOT NULL DEFAULT 0",
                "ALTER TABLE `groups` ADD COLUMN `channel_type` VARCHAR(10) NOT NULL DEFAULT 'public'",
                "ALTER TABLE `groups` ADD COLUMN `channel_tag` VARCHAR(64) NULL DEFAULT NULL",
                "ALTER TABLE `groups` ADD COLUMN `invite_link` VARCHAR(64) NULL DEFAULT NULL",
                """CREATE TABLE IF NOT EXISTS post_views (
                    message_id INT NOT NULL,
                    user_id INT NOT NULL,
                    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (message_id, user_id)
                )""",
                """CREATE TABLE IF NOT EXISTS support_messages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    sender_id INT NOT NULL,
                    message_text TEXT NOT NULL,
                    is_admin_reply TINYINT(1) NOT NULL DEFAULT 0,
                    is_read TINYINT(1) NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_support_user (user_id),
                    INDEX idx_support_created (created_at)
                )""",
                "ALTER TABLE users ADD COLUMN public_key TEXT NULL",
                """CREATE TABLE IF NOT EXISTS blocked_users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    blocker_id INT NOT NULL,
                    blocked_id INT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_block (blocker_id, blocked_id),
                    INDEX idx_blocker (blocker_id),
                    INDEX idx_blocked (blocked_id)
                )""",
                """CREATE TABLE IF NOT EXISTS scheduled_messages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    sender_id INT NOT NULL,
                    receiver_id INT NULL,
                    group_id INT NULL,
                    message_text TEXT NOT NULL,
                    scheduled_at DATETIME NOT NULL,
                    sent TINYINT(1) NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_scheduled (scheduled_at, sent)
                )""",
                "ALTER TABLE `group_members` ADD COLUMN `custom_title` VARCHAR(64) NULL DEFAULT NULL",
                """CREATE TABLE IF NOT EXISTS polls (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    creator_id INT NOT NULL,
                    question VARCHAR(512) NOT NULL,
                    options JSON NOT NULL,
                    is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
                    is_multi_choice TINYINT(1) NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_polls_creator (creator_id)
                )""",
                """CREATE TABLE IF NOT EXISTS poll_votes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    poll_id INT NOT NULL,
                    user_id INT NOT NULL,
                    option_indices JSON NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_vote (poll_id, user_id),
                    INDEX idx_poll_votes_poll (poll_id)
                )""",
                "ALTER TABLE users ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0",
            ]:
                try:
                    await cur.execute(sql)
                except Exception:
                    pass
            await conn.commit()
    asyncio.create_task(scheduled_message_worker())
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
    """Регистрация — шаг 1: email + пароль"""
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT id FROM users WHERE email = %s", (request.email,))
            if await cur.fetchone():
                raise HTTPException(status_code=400, detail="Этот email уже зарегистрирован")

    password_hash = hash_password(request.password)
    temp_username = f"user_{uuid.uuid4().hex[:8]}"
    user_id = await UserModel.create_user(temp_username, request.email, password_hash)
    if not user_id:
        raise HTTPException(status_code=500, detail="Ошибка создания пользователя")

    token = create_jwt_token(user_id, temp_username)
    return {"success": True, "user_id": user_id, "token": token, "setup_required": True}

@app.post("/api/setup")
async def setup_profile(request: SetupRequest, token: str):
    """Регистрация — шаг 2: выбор тега и ника"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    tag = request.tag.lstrip('@').lower().strip()
    if not tag or len(tag) < 3 or len(tag) > 30:
        raise HTTPException(status_code=400, detail="Тег должен быть от 3 до 30 символов")
    import re
    if not re.match(r'^[a-z0-9_]+$', tag):
        raise HTTPException(status_code=400, detail="Тег может содержать только латинские буквы, цифры и _")

    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT id FROM users WHERE tag = %s AND id != %s", (tag, payload['user_id']))
            if await cur.fetchone():
                raise HTTPException(status_code=400, detail="Этот тег уже занят")
            await cur.execute(
                "UPDATE users SET tag = %s, username = %s, setup_complete = 1 WHERE id = %s",
                (tag, request.username, payload['user_id'])
            )
            # Auto-subscribe new user to the official Aurora channel
            await cur.execute(
                "SELECT id FROM `groups` WHERE channel_tag = 'auroramessenger' AND is_channel = 1 LIMIT 1"
            )
            aurora_channel = await cur.fetchone()
            if aurora_channel:
                await cur.execute(
                    "INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (%s, %s, 'member')",
                    (aurora_channel['id'], payload['user_id'])
                )

    new_token = create_jwt_token(payload['user_id'], request.username)
    return {"success": True, "token": new_token, "username": request.username, "tag": tag}

@app.post("/api/login")
async def login(request: LoginRequest):
    """Вход по email + паролю"""
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, username, password_hash, setup_complete FROM users WHERE email = %s",
                (request.email,)
            )
            user = await cur.fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    if not verify_password(request.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Неверный пароль")

    token = create_jwt_token(user['id'], user['username'])
    return {
        "success": True,
        "user_id": user['id'],
        "username": user['username'],
        "token": token,
        "setup_required": not bool(user['setup_complete'])
    }

@app.post("/api/password-reset")
async def password_reset(request: PasswordResetRequest):
    """Сброс пароля по email + нику + старому паролю"""
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, password_hash FROM users WHERE email = %s AND tag = %s",
                (request.email, request.tag)
            )
            user = await cur.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="Пользователь с таким email и тегом не найден")
            if not verify_password(request.old_password, user['password_hash']):
                raise HTTPException(status_code=400, detail="Неверный текущий пароль")
            new_hash = hash_password(request.new_password)
            await cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (new_hash, user['id']))
    return {"success": True}

# ========== Пользователи ==========

async def _get_related_user_ids(user_id: int) -> set:
    """Получить ID пользователей, с которыми user_id переписывался или состоит в общих группах"""
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # Контакты из личных сообщений
            await cur.execute("""
                SELECT DISTINCT receiver_id FROM messages WHERE sender_id = %s AND is_deleted = 0
                UNION
                SELECT DISTINCT sender_id FROM messages WHERE receiver_id = %s AND is_deleted = 0
            """, (user_id, user_id))
            rows = await cur.fetchall()
            ids = {r[0] for r in rows}
            # Участники общих групп
            await cur.execute("""
                SELECT DISTINCT gm2.user_id FROM group_members gm1
                JOIN group_members gm2 ON gm1.group_id = gm2.group_id
                WHERE gm1.user_id = %s AND gm2.user_id != %s
            """, (user_id, user_id))
            rows2 = await cur.fetchall()
            ids.update(r[0] for r in rows2)
    ids.discard(user_id)
    return ids

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
                "SELECT id, username, tag, avatar, avatar_color, status, last_seen FROM users WHERE id != %s AND setup_complete = 1 ORDER BY created_at DESC LIMIT 15",
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
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    is_self = user['id'] == payload['user_id']
    tags = await UserModel.get_tags(user['id'])
    safe = {k: v for k, v in user.items() if k not in ('password_hash', 'privacy_settings')}
    if is_self:
        # No privacy restrictions for self
        safe['tags'] = tags
        raw_ls = user.get('last_seen')
        if raw_ls and hasattr(raw_ls, 'isoformat'):
            safe['last_seen'] = raw_ls.isoformat() + 'Z'
        safe['is_online'] = True
        return {"user": safe}
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

    # Если пользователь заблокировал смотрящего — скрываем аватар и статус (как в Telegram)
    viewer_id = payload['user_id']
    if await BlockModel.is_blocked(user['id'], viewer_id):
        safe['avatar'] = None
        safe['last_seen'] = 'blocked_you'
        safe['is_online'] = False
    else:
        safe['is_online'] = manager.is_user_online(user['id'])

    return {"user": safe}

@app.get("/api/users/search")
async def search_users(token: str, query: str):
    """Поиск пользователей по нику или тегу"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    current_user_id = payload['user_id']
    clean_query = query.lstrip('@')
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """SELECT id, username, tag, avatar, avatar_color, status FROM users
                   WHERE (username LIKE %s OR tag LIKE %s) AND id != %s AND setup_complete = 1
                   ORDER BY username LIMIT 10""",
                (f"{clean_query}%", f"{clean_query}%", current_user_id)
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

    current_user_id = payload['user_id']
    users = await UserModel.get_contacts(current_user_id)
    # Получаем список тех, кто нас заблокировал (для маскировки)
    blocked_us = set(await BlockModel.get_users_who_blocked(current_user_id))
    result = []
    for u in users:
        ud = dict(u)
        priv = {}
        try:
            priv = json.loads(ud.get('privacy_settings') or '{}')
        except Exception:
            pass
        ud.pop('privacy_settings', None)
        if ud['id'] in blocked_us:
            # Пользователь нас заблокировал — скрываем его данные
            ud['avatar'] = None
            ud['last_seen'] = 'blocked_you'
            ud['is_online'] = False
        else:
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
    new_tag = None
    if request.tag is not None:
        new_tag = request.tag.lstrip('@').lower().strip()
        if not new_tag or len(new_tag) < 3 or len(new_tag) > 30:
            raise HTTPException(status_code=400, detail="Тег должен быть от 3 до 30 символов")
        if not re.match(r'^[a-z0-9_]+$', new_tag):
            raise HTTPException(status_code=400, detail="Тег может содержать только латиницу, цифры и _")
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT id FROM users WHERE tag = %s AND id != %s", (new_tag, payload['user_id']))
                if await cur.fetchone():
                    raise HTTPException(status_code=400, detail="Этот тег уже занят")
    success = await UserModel.update_profile(
        payload['user_id'],
        username=request.username,
        status=request.status,
        avatar_color=request.avatar_color,
        birthday=request.birthday,
        phone=request.phone,
        privacy_settings=request.privacy_settings,
        tag=new_tag
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
    related_ids = await _get_related_user_ids(payload['user_id'])
    profile_event = {
        "type": "profile_updated",
        "data": {
            "user_id": payload['user_id'],
            "username": user.get('username'),
            "avatar": user.get('avatar'),
            "status": broadcast_status,
            "avatar_color": user.get('avatar_color', '#1a73e8')
        }
    }
    # Broadcast only to contacts and group-mates (+ self)
    for uid in related_ids | {payload['user_id']}:
        await manager.send_message_to_user(uid, profile_event)
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
    content = await file.read()
    ext_map = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp'}
    if _cloudinary_configured():
        result = cloudinary.uploader.upload(content, folder="avatars", resource_type="image")
        avatar_url = result["secure_url"]
    else:
        ext = ext_map.get(file.content_type, '.jpg')
        local_filename = f"avatar_{uuid.uuid4().hex}{ext}"
        local_path = os.path.join("uploads", local_filename)
        with open(local_path, "wb") as f:
            f.write(content)
        avatar_url = f"/files/{local_filename}"
    await UserModel.update_avatar(payload['user_id'], avatar_url)
    user = await UserModel.get_user_by_id(payload['user_id'])
    try:
        _priv = json.loads(user.get('privacy_settings') or '{}')
    except Exception:
        _priv = {}
    related_ids = await _get_related_user_ids(payload['user_id'])
    avatar_event = {
        "type": "profile_updated",
        "data": {
            "user_id": payload['user_id'],
            "username": user.get('username'),
            "avatar": avatar_url,
            "status": user.get('status') if _priv.get('show_status', True) else None,
            "avatar_color": user.get('avatar_color', '#1a73e8')
        }
    }
    for uid in related_ids | {payload['user_id']}:
        await manager.send_message_to_user(uid, avatar_event)
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
    related_ids = await _get_related_user_ids(payload['user_id'])
    remove_event = {
        "type": "profile_updated",
        "data": {
            "user_id": payload['user_id'],
            "username": user.get('username'),
            "avatar": None,
            "status": user.get('status') if _priv2.get('show_status', True) else None,
            "avatar_color": user.get('avatar_color', '#1a73e8')
        }
    }
    for uid in related_ids | {payload['user_id']}:
        await manager.send_message_to_user(uid, remove_event)
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

# ========== Чёрный список ==========

@app.post("/api/block/{target_user_id}")
async def block_user(target_user_id: int, token: str):
    """Добавить пользователя в чёрный список"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload['user_id']
    if user_id == target_user_id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")
    await BlockModel.block_user(user_id, target_user_id)
    await manager.send_message_to_user(target_user_id, {"type": "visibility_update", "data": {"user_id": user_id, "last_seen": "blocked_you"}})
    await manager.send_message_to_user(user_id, {"type": "visibility_update", "data": {"user_id": target_user_id, "last_seen": "hidden"}})
    return {"success": True}

@app.delete("/api/block/{target_user_id}")
async def unblock_user(target_user_id: int, token: str):
    """Убрать пользователя из чёрного списка"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    await BlockModel.unblock_user(payload['user_id'], target_user_id)
    await manager.send_message_to_user(target_user_id, {"type": "visibility_update", "data": {"user_id": payload['user_id'], "last_seen": None}})
    return {"success": True}

@app.get("/api/blocked")
async def get_blocked_users(token: str):
    """Список заблокированных пользователей"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    blocked = await BlockModel.get_blocked_users(payload['user_id'])
    result = []
    for u in blocked:
        result.append({
            "id": u['id'],
            "username": u['username'],
            "tag": u['tag'],
            "avatar": u['avatar'],
            "blocked_at": u['created_at'].isoformat() if u.get('created_at') else None,
        })
    return {"success": True, "blocked": result}

@app.post("/api/groups/{group_id}/avatar")
async def update_group_avatar(group_id: int, token: str = Form(...), file: UploadFile = File(...)):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = await GroupModel.get_member_role(group_id, payload['user_id'])
    if role != 'admin':
        raise HTTPException(status_code=403, detail="Only admins can change group avatar")
    allowed = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Only images allowed")
    content = await file.read()
    ext_map = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp'}
    if _cloudinary_configured():
        result = cloudinary.uploader.upload(content, folder="group_avatars", resource_type="image")
        avatar_url = result["secure_url"]
    else:
        ext = ext_map.get(file.content_type, '.jpg')
        local_filename = f"group_avatar_{uuid.uuid4().hex}{ext}"
        local_path = os.path.join("uploads", local_filename)
        with open(local_path, "wb") as f:
            f.write(content)
        avatar_url = f"/files/{local_filename}"
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

    my_role = await GroupModel.get_member_role(group_id, payload['user_id'])
    if my_role != 'admin':
        raise HTTPException(status_code=403, detail="Only admins can invite members")

    user = await UserModel.get_user_by_tag(request.tag)
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

    # Сохраняем системное сообщение (только для обычных групп, не каналов)
    if not group.get('is_channel'):
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

    return {"success": True, "message": f"@{request.tag} added to group"}

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
        view_counts = await PostViewModel.get_view_counts(msg_ids)
        for msg in messages:
            msg['reactions'] = reactions_map.get(msg['id'], [])
            msg['is_read'] = read_counts.get(msg['id'], 0) > 0
            msg['view_count'] = view_counts.get(msg['id'], 0)

    return {"messages": messages}


@app.post("/api/groups/{group_id}/messages/{message_id}/view")
async def record_post_view(group_id: int, message_id: int, token: str):
    """Record that the current user viewed a channel post"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    count = await PostViewModel.record_view(message_id, payload['user_id'])
    return {"view_count": count}

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
    group_info = await GroupModel.get_group(group_id)
    # Сохраняем системное сообщение только для обычных групп
    if not (group_info and group_info.get('is_channel')):
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

# ========== Каналы ==========

@app.post("/api/channels")
async def create_channel(request: CreateChannelRequest, token: str):
    """Создать канал"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    invite_link = None
    if request.channel_type == 'private':
        invite_link = str(uuid.uuid4()).replace('-', '')[:16]

    channel_tag = None
    if request.channel_type == 'public' and request.channel_tag:
        channel_tag = request.channel_tag.lstrip('@').lower()

    channel_id = await GroupModel.create_channel(
        request.name, request.description, payload['user_id'],
        request.channel_type, channel_tag, invite_link
    )
    if not channel_id:
        raise HTTPException(status_code=500, detail="Failed to create channel")

    await manager.send_message_to_user(payload['user_id'], {
        "type": "new_group",
        "data": {"group_id": channel_id, "name": request.name}
    })

    return {"success": True, "channel_id": channel_id, "name": request.name, "invite_link": invite_link, "channel_tag": channel_tag}

@app.get("/api/channels/search")
async def search_channels(token: str, query: str):
    """Поиск публичных каналов по тегу или названию"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    clean = query.lstrip('@').lower()
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """SELECT g.id, g.name, g.avatar, g.channel_tag, g.description,
                          (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
                          EXISTS(SELECT 1 FROM group_members gm2
                                 WHERE gm2.group_id = g.id AND gm2.user_id = %s) AS is_member
                   FROM `groups` g
                   WHERE g.is_channel = 1 AND g.channel_type = 'public'
                     AND (g.channel_tag LIKE %s OR g.name LIKE %s)
                   ORDER BY member_count DESC LIMIT 10""",
                (payload['user_id'], f"{clean}%", f"%{clean}%")
            )
            rows = await cur.fetchall()
    return {"channels": [dict(r) for r in rows]}

@app.get("/api/channels/tag/{tag}")
async def get_channel_by_tag(tag: str, token: str):
    """Найти публичный канал по тегу"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    group = await GroupModel.get_channel_by_tag(tag.lstrip('@').lower())
    if not group:
        raise HTTPException(status_code=404, detail="Channel not found")
    return {"group": group}

@app.post("/api/groups/{group_id}/join")
async def join_public_channel(group_id: int, token: str):
    """Подписаться на публичный канал"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    group = await GroupModel.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Channel not found")
    if not group.get('is_channel') or group.get('channel_type') != 'public':
        raise HTTPException(status_code=403, detail="Can only join public channels this way")
    members = await GroupModel.get_members(group_id)
    if any(m['id'] == payload['user_id'] for m in members):
        return {"success": True, "already_member": True}
    success = await GroupModel.add_member(group_id, payload['user_id'])
    if not success:
        raise HTTPException(status_code=400, detail="Failed to join")
    await manager.send_message_to_user(payload['user_id'], {
        "type": "new_group",
        "data": {"group_id": group_id, "name": group['name'], "member_count": len(members) + 1}
    })
    return {"success": True, "group_id": group_id, "name": group['name']}

@app.post("/api/groups/{group_id}/invite-link")
async def generate_invite_link(group_id: int, token: str):
    """Сгенерировать ссылку-приглашение"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = await GroupModel.get_member_role(group_id, payload['user_id'])
    if role != 'admin':
        raise HTTPException(status_code=403, detail="Only admins can generate invite links")
    invite_link = str(uuid.uuid4()).replace('-', '')[:16]
    await GroupModel.update_channel_settings(group_id, invite_link=invite_link)
    return {"success": True, "invite_link": invite_link}

@app.get("/api/groups/join/{invite_link}")
async def join_via_invite_link(invite_link: str, token: str):
    """Вступить в группу/канал по ссылке"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    group = await GroupModel.get_group_by_invite_link(invite_link)
    if not group:
        raise HTTPException(status_code=404, detail="Invite link not found or expired")

    members = await GroupModel.get_members(group['id'])
    if any(m['id'] == payload['user_id'] for m in members):
        return {"success": True, "group_id": group['id'], "already_member": True}

    success = await GroupModel.add_member(group['id'], payload['user_id'])
    if not success:
        raise HTTPException(status_code=400, detail="Failed to join")

    await manager.send_message_to_user(payload['user_id'], {
        "type": "new_group",
        "data": {"group_id": group['id'], "name": group['name'], "member_count": group.get('member_count', 0)}
    })

    if not group.get('is_channel'):
        await GroupMessageModel.save_message(
            group_id=group['id'],
            message_text=f"Новый участник вступил",
            is_system=True
        )

    return {"success": True, "group_id": group['id'], "name": group['name']}

@app.put("/api/groups/{group_id}/members/{user_id}/role")
async def set_member_role(group_id: int, user_id: int, token: str, role: str):
    """Изменить роль участника (admin/member)"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    my_role = await GroupModel.get_member_role(group_id, payload['user_id'])
    if my_role != 'admin':
        raise HTTPException(status_code=403, detail="Only admins can change roles")
    if role not in ('admin', 'member'):
        raise HTTPException(status_code=400, detail="Invalid role")
    success = await GroupModel.set_member_role(group_id, user_id, role)
    if not success:
        raise HTTPException(status_code=400, detail="User not found in group")
    return {"success": True}

@app.put("/api/groups/{group_id}/members/{user_id}/title")
async def set_member_title(group_id: int, user_id: int, token: str, title: str = ""):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    my_role = await GroupModel.get_member_role(group_id, payload['user_id'])
    if my_role != 'admin':
        raise HTTPException(status_code=403, detail="Only admins can set titles")
    success = await GroupModel.set_member_title(group_id, user_id, title or None)
    if not success:
        raise HTTPException(status_code=400, detail="User not found in group")
    return {"success": True}

@app.put("/api/groups/{group_id}/channel-settings")
async def update_channel_settings_endpoint(group_id: int, request: UpdateChannelSettingsRequest, token: str):
    """Обновить настройки канала"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = await GroupModel.get_member_role(group_id, payload['user_id'])
    if role != 'admin':
        raise HTTPException(status_code=403, detail="Only admins can change settings")

    channel_tag = None
    if request.channel_tag is not None:
        channel_tag = request.channel_tag.lstrip('@').lower() if request.channel_tag else ''

    invite_link_val = None
    # If switching to private, generate new invite link
    if request.channel_type == 'private':
        invite_link_val = str(uuid.uuid4()).replace('-', '')[:16]

    await GroupModel.update_channel_settings(
        group_id,
        channel_type=request.channel_type,
        channel_tag=channel_tag if channel_tag != '' else None,
        invite_link=invite_link_val
    )
    group = await GroupModel.get_group(group_id)
    return {"success": True, "group": group}

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

MAX_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024  # 5 GB (dev limit)

@app.get("/api/server-info")
async def server_info():
    cloudinary_active = _cloudinary_configured()
    return {
        "storage": "cloudinary" if cloudinary_active else "local",
        "max_file_mb": 25 if cloudinary_active else 5120,
        "max_image_mb": 20 if cloudinary_active else 5120,
        "max_video_mb": 100 if cloudinary_active else 5120,
    }

@app.post("/api/upload")
async def upload_file(token: str = Form(...), file: UploadFile = File(...)):
    """Загрузить файл на сервер (до 1 ГБ)"""
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    content = await file.read()
    total_size = len(content)
    if total_size > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="Файл превышает лимит 1 ГБ")

    if _cloudinary_configured():
        try:
            resource_type = "video" if file.content_type and file.content_type.startswith("video") else \
                            "image" if file.content_type and file.content_type.startswith("image") else "raw"
            result = cloudinary.uploader.upload(
                content,
                folder="chat_files",
                resource_type=resource_type,
                use_filename=True,
                unique_filename=True,
            )
            file_url = result["secure_url"]
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        # Local storage fallback
        ext = os.path.splitext(file.filename or "")[1] if file.filename else ""
        local_filename = f"{uuid.uuid4().hex}{ext}"
        local_path = os.path.join("uploads", local_filename)
        with open(local_path, "wb") as f:
            f.write(content)
        file_url = f"/files/{local_filename}"

    return {
        "success": True,
        "file_path": file_url,
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
                "SELECT id FROM messages WHERE sender_id = %s AND is_read = 1 ORDER BY id DESC LIMIT 500",
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
                
                # Проверяем чёрный список (двусторонняя блокировка)
                if receiver_id != user_id:
                    if await BlockModel.is_blocked(receiver_id, user_id) or await BlockModel.is_blocked(user_id, receiver_id):
                        continue  # Молча игнорируем

                    # Проверяем, не удалён ли получатель
                    recv_info = await UserModel.get_user_by_id(receiver_id)
                    if recv_info and recv_info.get('is_deleted'):
                        continue  # Нельзя писать удалённому пользователю

                    # Проверяем настройку "принимать сообщения только от известных"
                    if recv_info:
                        try:
                            recv_priv = json.loads(recv_info.get('privacy_settings') or '{}')
                            if not recv_priv.get('allow_messages', True):
                                # Проверяем: есть ли уже история переписки?
                                pool_chk = await DatabasePool.get_pool()
                                async with pool_chk.acquire() as conn_chk:
                                    async with conn_chk.cursor() as cur_chk:
                                        await cur_chk.execute(
                                            "SELECT 1 FROM messages WHERE (sender_id=%s AND receiver_id=%s) OR (sender_id=%s AND receiver_id=%s) LIMIT 1",
                                            (user_id, receiver_id, receiver_id, user_id)
                                        )
                                        has_history = await cur_chk.fetchone() is not None
                                if not has_history:
                                    continue  # Новый собеседник — не принимать
                        except Exception:
                            pass

                # Получаем информацию об ответе
                reply_to_text = None
                reply_to_sender = None
                reply_to_file_path = None
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
                        # Extract file path for thumbnail
                        if reply_msg.get('file_path'):
                            reply_to_file_path = reply_msg['file_path']
                        elif reply_msg.get('files'):
                            try:
                                fl = json.loads(reply_msg['files']) if isinstance(reply_msg['files'], str) else reply_msg['files']
                                reply_to_file_path = fl[0]['file_path'] if fl else None
                            except Exception:
                                pass
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
                    files=files_json,
                    reply_to_file_path=reply_to_file_path
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
                    "reply_to_file_path": reply_to_file_path,
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

                # Проверяем членство пользователя в группе
                sender_role = await GroupModel.get_member_role(group_id, user_id)
                if sender_role is None:
                    continue

                # Каналы: только администраторы могут создавать посты (сообщения без reply_to_id)
                if reply_to_id is None:
                    grp_info = await GroupModel.get_group(group_id)
                    if grp_info and grp_info.get('is_channel'):
                        if sender_role != 'admin':
                            continue
                # Получаем информацию о сообщении, на которое отвечаем
                reply_to_text = None
                reply_to_sender = None
                reply_to_file_path = None
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
                        if reply_msg.get('file_path'):
                            reply_to_file_path = reply_msg['file_path']
                        elif reply_msg.get('files'):
                            try:
                                fl = json.loads(reply_msg['files']) if isinstance(reply_msg['files'], str) else reply_msg['files']
                                reply_to_file_path = fl[0]['file_path'] if fl else None
                            except Exception:
                                pass
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
                    files=files_json,
                    reply_to_file_path=reply_to_file_path
                )
                
                # Получаем отправителя
                sender = await UserModel.get_user_by_id(user_id)
                
                message_data = {
                    "id": message_id,
                    "group_id": group_id,
                    "sender_id": user_id,
                    "sender_name": sender['username'],
                    "sender_tag": sender.get('tag'),
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
                    "reply_to_file_path": reply_to_file_path,
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
                # Проверяем членство перед рассылкой typing-индикатора
                typing_role = await GroupModel.get_member_role(group_id, user_id)
                if typing_role is None:
                    continue
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

            elif data.get("type") == "set_offline":
                manager.set_manual_offline(user_id)
                await UserModel.update_last_seen(user_id)
                for uid in list(manager.active_connections.keys()):
                    await manager.send_message_to_user(uid, {"type": "user_status", "data": {"user_id": user_id, "is_online": False}})

            elif data.get("type") == "set_online":
                manager.set_manual_online(user_id)
                for uid in list(manager.active_connections.keys()):
                    await manager.send_message_to_user(uid, {"type": "user_status", "data": {"user_id": user_id, "is_online": True}})

            elif data.get("type") == "delete_message":
                message_id = data.get("message_id")
                is_group = data.get("is_group", False)
                for_self = data.get("for_self", False)

                print(f"🗑️ DELETE MESSAGE RECEIVED: id={message_id}, is_group={is_group}, for_self={for_self}")

                try:
                    if is_group:
                        msg = await GroupMessageModel.get_message_by_id(message_id)
                        if not msg:
                            pass
                        elif for_self:
                            # Hide only for current user — no need to check ownership
                            success = await GroupMessageModel.delete_message(message_id, for_self=True, current_user_id=user_id)
                            if success:
                                await manager.send_message_to_user(user_id, {
                                    "type": "message_deleted",
                                    "data": {"message_id": message_id, "is_group": True, "for_self": True, "group_id": msg['group_id']}
                                })
                        else:
                            admin_role = await GroupModel.get_member_role(msg['group_id'], user_id)
                            can_delete = msg['sender_id'] == user_id or admin_role == 'admin'
                            if not can_delete:
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
                                            "data": {"message_id": message_id, "is_group": True, "group_id": msg['group_id']}
                                        })
                    else:
                        msg = await MessageModel.get_message_by_id(message_id)
                        if not msg:
                            pass
                        elif for_self:
                            # Any participant can delete for themselves
                            if user_id not in (msg['sender_id'], msg['receiver_id']):
                                await manager.send_message_to_user(user_id, {"type": "error", "data": {"message": "Нет прав"}})
                            else:
                                success = await MessageModel.delete_message(message_id, for_self=True, current_user_id=user_id)
                                if success:
                                    other_id = msg['receiver_id'] if msg['sender_id'] == user_id else msg['sender_id']
                                    await manager.send_message_to_user(user_id, {
                                        "type": "message_deleted",
                                        "data": {"message_id": message_id, "is_group": False, "for_self": True, "other_user_id": other_id}
                                    })
                        elif msg['sender_id'] != user_id:
                            await manager.send_message_to_user(user_id, {"type": "error", "data": {"message": "Нет прав для удаления этого сообщения"}})
                        else:
                            success = await MessageModel.delete_message(message_id)
                            print(f"🗑️ Private delete result: {success}")
                            if success:
                                other_id = msg['receiver_id']
                                await manager.send_message_to_user(msg['sender_id'], {
                                    "type": "message_deleted",
                                    "data": {"message_id": message_id, "is_group": False, "other_user_id": other_id}
                                })
                                await manager.send_message_to_user(msg['receiver_id'], {
                                    "type": "message_deleted",
                                    "data": {"message_id": message_id, "is_group": False, "other_user_id": msg['sender_id']}
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

# ========== Admin guard ==========

async def require_admin(token: str) -> dict:
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT tag FROM users WHERE id = %s", (payload['user_id'],))
            user = await cur.fetchone()
    if not user or user.get('tag') not in ('kayano', 'durov'):
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload

# ========== Support chat ==========

@app.post("/api/support/send")
async def support_send(request: SupportSendRequest, token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    user_id = payload['user_id']
    if not request.message_text.strip():
        raise HTTPException(400, "Empty message")
    msg_id = await SupportModel.send_message(user_id, request.message_text.strip())
    if not msg_id:
        raise HTTPException(500, "Failed to send message")
    admin_ids = await SupportModel.get_admin_ids()
    for admin_id in admin_ids:
        await manager.send_message_to_user(admin_id, {
            "type": "support_message",
            "data": {"user_id": user_id, "msg_id": msg_id, "message_text": request.message_text.strip()}
        })
    return {"success": True, "id": msg_id}

@app.get("/api/support/messages")
async def get_support_messages(token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    messages = await SupportModel.get_user_messages(payload['user_id'])
    await SupportModel.mark_user_read(payload['user_id'])
    return {"messages": messages}

@app.get("/api/support/unread")
async def get_support_unread(token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    has_unread = await SupportModel.has_unread_replies(payload['user_id'])
    return {"has_unread": has_unread}

# ========== Admin panel ==========

@app.get("/api/admin/stats")
async def get_admin_stats(token: str):
    await require_admin(token)
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            stats = {}
            await cur.execute("SELECT COUNT(*) as cnt FROM users")
            stats['total_users'] = (await cur.fetchone())['cnt']
            for label, cond in [
                ('day', "DATE(timestamp) = CURDATE()"),
                ('week', "timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
                ('month', "timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)"),
            ]:
                await cur.execute(
                    f"SELECT (SELECT COUNT(*) FROM messages WHERE {cond} AND is_deleted = 0) + "
                    f"(SELECT COUNT(*) FROM group_messages WHERE {cond} AND is_deleted = 0) as cnt"
                )
                stats[f'messages_{label}'] = (await cur.fetchone())['cnt']
            for label, cond in [
                ('day', "DATE(timestamp) = CURDATE()"),
                ('week', "timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
                ('month', "timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)"),
            ]:
                await cur.execute(
                    f"SELECT (SELECT COUNT(*) FROM messages WHERE (file_path IS NOT NULL OR files IS NOT NULL) AND {cond} AND is_deleted = 0) + "
                    f"(SELECT COUNT(*) FROM group_messages WHERE (file_path IS NOT NULL OR files IS NOT NULL) AND {cond} AND is_deleted = 0) as cnt"
                )
                stats[f'files_{label}'] = (await cur.fetchone())['cnt']
            for label, cond in [
                ('day', "DATE(created_at) = CURDATE()"),
                ('week', "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"),
                ('month', "created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"),
            ]:
                await cur.execute(f"SELECT COUNT(*) as cnt FROM users WHERE {cond}")
                stats[f'users_{label}'] = (await cur.fetchone())['cnt']
            await cur.execute("""
                SELECT DATE(created_at) as d, COUNT(*) as cnt
                FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY DATE(created_at) ORDER BY d
            """)
            stats['reg_chart'] = [{"date": str(r['d']), "count": r['cnt']} for r in await cur.fetchall()]
            stats['online_now'] = len(manager.active_connections)
            return stats

@app.get("/api/admin/users")
async def get_admin_users(token: str, search: str = ""):
    await require_admin(token)
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            if search:
                await cur.execute("""
                    SELECT id, username, tag, email, created_at, avatar, status, is_deleted
                    FROM users WHERE username LIKE %s OR tag LIKE %s OR email LIKE %s
                    ORDER BY created_at DESC LIMIT 200
                """, (f'%{search}%', f'%{search}%', f'%{search}%'))
            else:
                await cur.execute("""
                    SELECT id, username, tag, email, created_at, avatar, status, is_deleted
                    FROM users ORDER BY created_at DESC LIMIT 200
                """)
            rows = await cur.fetchall()
            for r in rows:
                if r.get('created_at') and hasattr(r['created_at'], 'isoformat'):
                    r['created_at'] = r['created_at'].replace(tzinfo=timezone.utc).isoformat()
            return {"users": rows}

@app.delete("/api/admin/users/{user_id}")
async def delete_admin_user(user_id: int, token: str):
    payload = await require_admin(token)
    if payload['user_id'] == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    related_ids = await _get_related_user_ids(user_id)
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE users SET is_deleted = 1, username = 'Удалённый пользователь', tag = NULL, avatar = NULL, status = NULL WHERE id = %s",
                (user_id,)
            )
            await conn.commit()
    deleted_event = {
        "type": "profile_updated",
        "data": {"user_id": user_id, "username": "Удалённый пользователь", "avatar": None, "status": None, "avatar_color": "#6b7280"}
    }
    for uid in related_ids | {user_id}:
        await manager.send_message_to_user(uid, deleted_event)
    return {"success": True}

@app.delete("/api/account")
async def delete_own_account(token: str):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload['user_id']
    related_ids = await _get_related_user_ids(user_id)
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE users SET is_deleted = 1, username = 'Удалённый пользователь', tag = NULL, avatar = NULL, status = NULL WHERE id = %s",
                (user_id,)
            )
            await conn.commit()
    deleted_event = {
        "type": "profile_updated",
        "data": {"user_id": user_id, "username": "Удалённый пользователь", "avatar": None, "status": None, "avatar_color": "#6b7280"}
    }
    for uid in related_ids:
        await manager.send_message_to_user(uid, deleted_event)
    await manager.send_message_to_user(user_id, {"type": "account_deleted", "data": {}})
    return {"success": True}

@app.get("/api/admin/support")
async def get_admin_support(token: str):
    await require_admin(token)
    threads = await SupportModel.get_all_threads()
    return {"threads": threads}

@app.get("/api/admin/support/{user_id}")
async def get_admin_support_thread(user_id: int, token: str):
    await require_admin(token)
    messages = await SupportModel.get_thread(user_id)
    return {"messages": messages}

@app.post("/api/admin/support/reply")
async def admin_support_reply(request: AdminReplyRequest, token: str):
    payload = await require_admin(token)
    if not request.message_text.strip():
        raise HTTPException(400, "Empty message")
    msg_id = await SupportModel.admin_reply(payload['user_id'], request.user_id, request.message_text.strip())
    if not msg_id:
        raise HTTPException(500, "Failed to send reply")
    await manager.send_message_to_user(request.user_id, {
        "type": "support_reply",
        "data": {"msg_id": msg_id, "message_text": request.message_text.strip(), "admin_id": payload['user_id']}
    })
    return {"success": True, "id": msg_id}

# ========== Encryption — public key exchange ==========

@app.put("/api/users/me/public-key")
async def update_public_key(request: UpdatePublicKeyRequest, token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE users SET public_key = %s WHERE id = %s",
                              (request.public_key, payload['user_id']))
    return {"ok": True}

@app.get("/api/users/{user_id}/public-key")
async def get_public_key(user_id: int, token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT public_key FROM users WHERE id = %s", (user_id,))
            row = await cur.fetchone()
    if not row: raise HTTPException(404, "User not found")
    return {"public_key": row.get("public_key")}

# ========== Scheduled messages ==========

async def scheduled_message_worker():
    """Background task: fires due scheduled messages every 20 seconds."""
    while True:
        await asyncio.sleep(20)
        try:
            pool = await DatabasePool.get_pool()
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    await cur.execute("""
                        SELECT * FROM scheduled_messages
                        WHERE sent = 0 AND scheduled_at <= NOW()
                        LIMIT 50
                    """)
                    due = await cur.fetchall()
                    for m in due:
                        await cur.execute(
                            "UPDATE scheduled_messages SET sent = 1 WHERE id = %s", (m['id'],)
                        )
                        await conn.commit()
                        # Insert into real messages table
                        if m['receiver_id']:
                            await cur.execute(
                                "INSERT INTO messages (sender_id, receiver_id, message_text) VALUES (%s, %s, %s)",
                                (m['sender_id'], m['receiver_id'], m['message_text'])
                            )
                            msg_id = cur.lastrowid
                            await conn.commit()
                            msg_data = {
                                "type": "message",
                                "data": {
                                    "id": msg_id,
                                    "sender_id": m['sender_id'],
                                    "receiver_id": m['receiver_id'],
                                    "message_text": m['message_text'],
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                    "is_read": 0,
                                    "scheduled_id": m['id'],
                                }
                            }
                            await manager.send_message_to_user(m['sender_id'], {**msg_data, "data": {**msg_data["data"], "is_own": True}})
                            await manager.send_message_to_user(m['receiver_id'], msg_data)
                        elif m['group_id']:
                            await cur.execute(
                                "INSERT INTO group_messages (group_id, sender_id, message_text) VALUES (%s, %s, %s)",
                                (m['group_id'], m['sender_id'], m['message_text'])
                            )
                            msg_id = cur.lastrowid
                            await conn.commit()
                            from .models import GroupModel
                            members = await GroupModel.get_members(m['group_id'])
                            msg_data = {
                                "type": "group_message",
                                "data": {
                                    "id": msg_id,
                                    "group_id": m['group_id'],
                                    "sender_id": m['sender_id'],
                                    "message_text": m['message_text'],
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                    "scheduled_id": m['id'],
                                }
                            }
                            for member in members:
                                await manager.send_message_to_user(member['id'], msg_data)
                        # Notify sender that scheduled message was sent
                        await manager.send_message_to_user(m['sender_id'], {
                            "type": "scheduled_sent",
                            "data": {"scheduled_id": m['id']}
                        })
        except Exception as e:
            print(f"Scheduler error: {e}")

@app.post("/api/messages/schedule")
async def schedule_message(request: ScheduleMessageRequest, token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    if not request.message_text.strip(): raise HTTPException(400, "Empty message")
    if not request.receiver_id and not request.group_id:
        raise HTTPException(400, "receiver_id or group_id required")
    try:
        scheduled_at = datetime.fromisoformat(request.scheduled_at.replace('Z', '+00:00'))
    except Exception:
        raise HTTPException(400, "Invalid scheduled_at datetime")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO scheduled_messages (sender_id, receiver_id, group_id, message_text, scheduled_at) VALUES (%s, %s, %s, %s, %s)",
                (payload['user_id'], request.receiver_id, request.group_id, request.message_text.strip(), scheduled_at)
            )
            new_id = cur.lastrowid
            await conn.commit()
    return {"success": True, "id": new_id, "scheduled_at": scheduled_at.isoformat()}

@app.get("/api/messages/scheduled")
async def get_scheduled_messages(token: str, receiver_id: Optional[int] = None, group_id: Optional[int] = None):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            if receiver_id:
                await cur.execute(
                    "SELECT * FROM scheduled_messages WHERE sender_id = %s AND receiver_id = %s AND sent = 0 ORDER BY scheduled_at",
                    (payload['user_id'], receiver_id)
                )
            elif group_id:
                await cur.execute(
                    "SELECT * FROM scheduled_messages WHERE sender_id = %s AND group_id = %s AND sent = 0 ORDER BY scheduled_at",
                    (payload['user_id'], group_id)
                )
            else:
                await cur.execute(
                    "SELECT * FROM scheduled_messages WHERE sender_id = %s AND sent = 0 ORDER BY scheduled_at",
                    (payload['user_id'],)
                )
            rows = await cur.fetchall()
            for r in rows:
                if r.get('scheduled_at') and hasattr(r['scheduled_at'], 'isoformat'):
                    r['scheduled_at'] = r['scheduled_at'].replace(tzinfo=timezone.utc).isoformat()
                if r.get('created_at') and hasattr(r['created_at'], 'isoformat'):
                    r['created_at'] = r['created_at'].replace(tzinfo=timezone.utc).isoformat()
    return {"scheduled": rows}

@app.delete("/api/messages/scheduled/{scheduled_id}")
async def delete_scheduled_message(scheduled_id: int, token: str):
    payload = decode_jwt_token(token)
    if not payload: raise HTTPException(401, "Invalid token")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM scheduled_messages WHERE id = %s AND sender_id = %s AND sent = 0",
                (scheduled_id, payload['user_id'])
            )
            deleted = cur.rowcount
            await conn.commit()
    return {"ok": deleted > 0}

# ========== Опросы ==========

@app.post("/api/polls")
async def create_poll(request: CreatePollRequest, token: str):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    if len(request.options) < 2 or len(request.options) > 10:
        raise HTTPException(status_code=400, detail="Poll must have 2-10 options")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO polls (creator_id, question, options, is_anonymous, is_multi_choice) VALUES (%s, %s, %s, %s, %s)",
                (payload['user_id'], request.question, json.dumps(request.options, ensure_ascii=False),
                 1 if request.is_anonymous else 0, 1 if request.is_multi_choice else 0)
            )
            poll_id = cur.lastrowid
            await conn.commit()
    return {"poll_id": poll_id}

@app.get("/api/polls/{poll_id}")
async def get_poll(poll_id: int, token: str):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM polls WHERE id = %s", (poll_id,))
            poll = await cur.fetchone()
            if not poll:
                raise HTTPException(status_code=404, detail="Poll not found")
            await cur.execute("SELECT user_id, option_indices FROM poll_votes WHERE poll_id = %s", (poll_id,))
            votes_rows = await cur.fetchall()
    options = poll['options'] if isinstance(poll['options'], list) else json.loads(poll['options'])
    vote_counts = [0] * len(options)
    voters_by_option: list[list] = [[] for _ in options]
    my_votes: list[int] = []
    for row in votes_rows:
        indices = row['option_indices'] if isinstance(row['option_indices'], list) else json.loads(row['option_indices'])
        for idx in indices:
            if 0 <= idx < len(options):
                vote_counts[idx] += 1
                voters_by_option[idx].append(row['user_id'])
        if row['user_id'] == payload['user_id']:
            my_votes = indices
    total_voters = len(votes_rows)
    # Get voter usernames if not anonymous
    voter_names: list[list] = [[] for _ in options]
    if not poll['is_anonymous'] and votes_rows:
        all_voter_ids = list({row['user_id'] for row in votes_rows})
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                placeholders = ','.join(['%s'] * len(all_voter_ids))
                await cur.execute(f"SELECT id, username, tag, avatar FROM users WHERE id IN ({placeholders})", all_voter_ids)
                user_rows = {r['id']: r for r in await cur.fetchall()}
        for i, uid_list in enumerate(voters_by_option):
            voter_names[i] = [{'id': uid, 'username': user_rows[uid]['username'], 'tag': user_rows[uid].get('tag'), 'avatar': user_rows[uid].get('avatar')} for uid in uid_list if uid in user_rows]
    return {
        "id": poll_id,
        "question": poll['question'],
        "options": options,
        "is_anonymous": bool(poll['is_anonymous']),
        "is_multi_choice": bool(poll['is_multi_choice']),
        "vote_counts": vote_counts,
        "total_voters": total_voters,
        "my_votes": my_votes,
        "voters": voter_names if not poll['is_anonymous'] else [[] for _ in options],
    }

@app.delete("/api/polls/{poll_id}/vote")
async def unvote_poll(poll_id: int, token: str):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM poll_votes WHERE poll_id = %s AND user_id = %s",
                (poll_id, payload['user_id'])
            )
            await conn.commit()
    return {"ok": True}

@app.post("/api/polls/{poll_id}/vote")
async def vote_poll(poll_id: int, request: VotePollRequest, token: str):
    payload = decode_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    pool = await DatabasePool.get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM polls WHERE id = %s", (poll_id,))
            poll = await cur.fetchone()
            if not poll:
                raise HTTPException(status_code=404, detail="Poll not found")
            options = poll['options'] if isinstance(poll['options'], list) else json.loads(poll['options'])
            for idx in request.option_indices:
                if idx < 0 or idx >= len(options):
                    raise HTTPException(status_code=400, detail="Invalid option index")
            if not poll['is_multi_choice'] and len(request.option_indices) > 1:
                raise HTTPException(status_code=400, detail="Single choice poll")
            await cur.execute(
                "INSERT INTO poll_votes (poll_id, user_id, option_indices) VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE option_indices = VALUES(option_indices)",
                (poll_id, payload['user_id'], json.dumps(request.option_indices))
            )
            await conn.commit()
    return {"ok": True}

# ========== Статика ==========

# Подключаем статические файлы клиента (если есть)
client_build_path = os.path.join(os.path.dirname(__file__), "../../client/build")
if os.path.exists(client_build_path):
    app.mount("/", StaticFiles(directory=client_build_path, html=True), name="client")
    print(f"📁 Serving static files from {client_build_path}")
else:
    print(f"⚠️ Client build not found at {client_build_path}")