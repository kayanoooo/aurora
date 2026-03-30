import aiomysql
from typing import List, Dict, Optional, Any
from .config import config

class DatabasePool:
    """Пул соединений с MySQL"""
    _pool = None
    
    @classmethod
    async def get_pool(cls):
        if cls._pool is None:
            cls._pool = await aiomysql.create_pool(
                host=config.MYSQL_HOST,
                port=config.MYSQL_PORT,
                user=config.MYSQL_USER,
                password=config.MYSQL_PASSWORD,
                db=config.MYSQL_DATABASE,
                autocommit=True,
                minsize=5,
                maxsize=20,
                charset='utf8mb4',  # Добавляем поддержку UTF-8
                use_unicode=True     # Включаем Unicode
            )
        return cls._pool
    
    @classmethod
    async def close(cls):
        if cls._pool:
            cls._pool.close()
            await cls._pool.wait_closed()

class UserModel:
    @staticmethod
    async def create_user(username: str, email: str, password_hash: str) -> Optional[int]:
        """Создать пользователя, вернуть его ID"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        "INSERT INTO users (username, email, password_hash) VALUES (%s, %s, %s)",
                        (username, email, password_hash)
                    )
                    return cur.lastrowid
                except Exception as e:
                    print(f"Error creating user: {e}")
                    return None
    
    @staticmethod
    async def get_user_by_username(username: str) -> Optional[Dict]:
        """Получить пользователя по имени"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT id, username, tag, email, password_hash, created_at, avatar, status, avatar_color, birthday, phone, privacy_settings, last_seen FROM users WHERE username = %s",
                    (username,)
                )
                return await cur.fetchone()

    @staticmethod
    async def get_user_by_id(user_id: int) -> Optional[Dict]:
        """Получить пользователя по ID"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT id, username, tag, email, created_at, avatar, status, avatar_color, birthday, phone, privacy_settings FROM users WHERE id = %s",
                    (user_id,)
                )
                return await cur.fetchone()
    
    @staticmethod
    async def update_last_seen(user_id: int):
        """Обновить время последнего посещения"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("UPDATE users SET last_seen = NOW() WHERE id = %s", (user_id,))
                await conn.commit()

    @staticmethod
    async def get_contacts(user_id: int) -> List[Dict]:
        """Получить пользователей, с которыми текущий юзер переписывался, отсортированных по последнему сообщению"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("""
                    SELECT u.id, u.username, u.tag, u.email, u.created_at, u.avatar, u.status, u.avatar_color, u.privacy_settings, u.last_seen,
                        (SELECT MAX(m.id) FROM messages m
                         WHERE (m.sender_id = %s AND m.receiver_id = u.id)
                            OR (m.sender_id = u.id AND m.receiver_id = %s)) AS last_msg_id
                    FROM users u
                    WHERE u.id IN (
                        SELECT DISTINCT receiver_id FROM messages WHERE sender_id = %s AND receiver_id != %s
                        UNION
                        SELECT DISTINCT sender_id FROM messages WHERE receiver_id = %s AND sender_id != %s
                    )
                    ORDER BY last_msg_id DESC
                """, (user_id, user_id, user_id, user_id, user_id, user_id))
                return await cur.fetchall()

    @staticmethod
    async def get_all_users(exclude_id: int = None) -> List[Dict]:
        """Получить всех пользователей, опционально исключая текущего"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                if exclude_id:
                    await cur.execute(
                        "SELECT id, username, email, created_at, avatar, status, avatar_color FROM users WHERE id != %s ORDER BY username",
                        (exclude_id,)
                    )
                else:
                    await cur.execute(
                        "SELECT id, username, email, created_at, avatar, status, avatar_color FROM users ORDER BY username"
                    )
                return await cur.fetchall()

    @staticmethod
    async def update_profile(user_id: int, username: str = None, status: str = None,
                             avatar_color: str = None, birthday: str = None,
                             phone: str = None, privacy_settings: str = None) -> bool:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    fields = []
                    values = []
                    if username is not None:
                        fields.append("username = %s"); values.append(username)
                    if status is not None:
                        fields.append("status = %s"); values.append(status)
                    if avatar_color is not None:
                        fields.append("avatar_color = %s"); values.append(avatar_color)
                    if birthday is not None:
                        fields.append("birthday = %s"); values.append(birthday or None)
                    if phone is not None:
                        fields.append("phone = %s"); values.append(phone or None)
                    if privacy_settings is not None:
                        fields.append("privacy_settings = %s"); values.append(privacy_settings)
                    if fields:
                        values.append(user_id)
                        await cur.execute(
                            f"UPDATE users SET {', '.join(fields)} WHERE id = %s",
                            values
                        )
                    return True
                except Exception as e:
                    print(f"Error updating profile: {e}")
                    return False

    @staticmethod
    async def remove_avatar(user_id: int) -> bool:
        """Удалить аватарку пользователя"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute("UPDATE users SET avatar = NULL WHERE id = %s", (user_id,))
                    return True
                except Exception as e:
                    print(f"Error removing avatar: {e}")
                    return False

    @staticmethod
    async def get_tags(user_id: int) -> List[str]:
        """Получить теги пользователя"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT tag FROM user_tags WHERE user_id = %s ORDER BY created_at", (user_id,))
                rows = await cur.fetchall()
                return [r[0] for r in rows]

    @staticmethod
    async def add_tag(user_id: int, tag: str) -> bool:
        """Добавить тег (тег глобально уникален)"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute("INSERT INTO user_tags (user_id, tag) VALUES (%s, %s)", (user_id, tag))
                    return True
                except Exception as e:
                    print(f"Tag add error: {e}")
                    return False

    @staticmethod
    async def remove_tag(user_id: int, tag: str) -> bool:
        """Удалить тег пользователя"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM user_tags WHERE user_id = %s AND tag = %s", (user_id, tag))
                return cur.rowcount > 0

    @staticmethod
    async def update_avatar(user_id: int, avatar_path: str) -> bool:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        "UPDATE users SET avatar = %s WHERE id = %s",
                        (avatar_path, user_id)
                    )
                    return True
                except Exception as e:
                    print(f"Error updating avatar: {e}")
                    return False

class MessageModel:
    @staticmethod
    async def save_message(sender_id: int, receiver_id: int, message_text: str = None,
                        file_path: str = None, filename: str = None, file_size: int = None,
                        reply_to_id: int = None, reply_to_text: str = None,
                        reply_to_sender: str = None, files: str = None) -> Optional[int]:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    INSERT INTO messages
                    (sender_id, receiver_id, message_text, file_path, filename, file_size,
                    reply_to_id, reply_to_text, reply_to_sender, files)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (sender_id, receiver_id, message_text, file_path, filename, file_size,
                    reply_to_id, reply_to_text, reply_to_sender, files))
                return cur.lastrowid
    
    @staticmethod
    async def get_conversation(user1_id: int, user2_id: int, limit: int = 50) -> List[Dict]:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("""
                    SELECT m.id, m.sender_id, m.receiver_id, m.message_text,
                        m.file_path, m.filename, m.file_size, m.timestamp,
                        m.reply_to_id, m.reply_to_text, m.reply_to_sender, m.files,
                        COALESCE(m.is_read, 0) as is_read,
                        u1.username as sender_name, u2.username as receiver_name
                    FROM messages m
                    JOIN users u1 ON m.sender_id = u1.id
                    JOIN users u2 ON m.receiver_id = u2.id
                    WHERE ((m.sender_id = %s AND m.receiver_id = %s)
                        OR (m.sender_id = %s AND m.receiver_id = %s))
                        AND m.is_deleted = 0
                    ORDER BY m.timestamp DESC
                    LIMIT %s
                """, (user1_id, user2_id, user2_id, user1_id, limit))
                
                messages = await cur.fetchall()
                for msg in messages:
                    if msg.get('timestamp'):
                        # Явно помечаем как UTC, чтобы браузер правильно конвертировал в МСК
                        msg['timestamp'] = msg['timestamp'].replace(tzinfo=__import__('datetime').timezone.utc).isoformat()
                    if msg.get('reply_to_text') is None:
                        msg['reply_to_text'] = ''
                    if msg.get('reply_to_sender') is None:
                        msg['reply_to_sender'] = ''
                return list(reversed(messages))
            
    @staticmethod
    async def get_undelivered_messages(user_id: int) -> List[Dict]:
        """Получить все недоставленные сообщения для пользователя"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """SELECT m.id, m.sender_id, m.receiver_id, m.message_text, m.file_path, 
                            m.filename, m.file_size, m.timestamp, u.username as sender_name
                    FROM messages m
                    JOIN users u ON m.sender_id = u.id
                    WHERE m.receiver_id = %s AND m.delivered = FALSE
                    ORDER BY m.timestamp ASC""",
                    (user_id,)
                )
                return await cur.fetchall()
    
    @staticmethod
    async def mark_as_read(sender_id: int, receiver_id: int) -> List[int]:
        """Помечает все непрочитанные сообщения от sender_id к receiver_id как прочитанные. Возвращает список ID."""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id FROM messages WHERE sender_id=%s AND receiver_id=%s AND is_read=0 AND is_deleted=0",
                    (sender_id, receiver_id)
                )
                rows = await cur.fetchall()
                ids = [r[0] for r in rows]
                if ids:
                    placeholders = ','.join(['%s'] * len(ids))
                    await cur.execute(f"UPDATE messages SET is_read=1 WHERE id IN ({placeholders})", ids)
                return ids

    @staticmethod
    async def mark_as_delivered(message_ids: List[int]):
        """Пометить сообщения как доставленные"""
        if not message_ids:
            return
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                placeholders = ','.join(['%s'] * len(message_ids))
                await cur.execute(
                    f"UPDATE messages SET delivered = TRUE WHERE id IN ({placeholders})",
                    message_ids
                )

    @staticmethod
    async def get_message_by_id(message_id: int) -> Optional[Dict]:
        """Получить сообщение по ID"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT id, sender_id, receiver_id, message_text, file_path, filename, file_size FROM messages WHERE id = %s",
                    (message_id,)
                )
                return await cur.fetchone()

    @staticmethod
    async def clear_conversation(user1_id: int, user2_id: int) -> bool:
        """Удалить все сообщения между двумя пользователями"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute("""
                        DELETE FROM messages
                        WHERE (sender_id = %s AND receiver_id = %s)
                           OR (sender_id = %s AND receiver_id = %s)
                    """, (user1_id, user2_id, user2_id, user1_id))
                    return True
                except Exception as e:
                    print(f"Error clearing conversation: {e}")
                    return False

    @staticmethod
    async def update_message(message_id: int, new_text: str) -> bool:
        """Обновить текст сообщения"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE messages SET message_text = %s, edited_at = NOW() WHERE id = %s",
                    (new_text, message_id)
                )
                return cur.rowcount > 0

    @staticmethod
    async def delete_message(message_id: int) -> bool:
        """Пометить сообщение как удаленное"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE messages SET is_deleted = TRUE WHERE id = %s",
                    (message_id,)
                )
                return cur.rowcount > 0
    
    @staticmethod
    async def search_conversation(user_id: int, other_user_id: int, query: str, limit: int = 50) -> List[Dict]:
        """Поиск сообщений в диалоге"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("""
                    SELECT m.id, m.sender_id, m.receiver_id, m.message_text, 
                        m.file_path, m.filename, m.file_size, 
                        DATE_FORMAT(m.timestamp, '%%Y-%%m-%%dT%%H:%%i:%%s') as timestamp,
                        u1.username as sender_name, u2.username as receiver_name
                    FROM messages m
                    JOIN users u1 ON m.sender_id = u1.id
                    JOIN users u2 ON m.receiver_id = u2.id
                    WHERE ((m.sender_id = %s AND m.receiver_id = %s)
                        OR (m.sender_id = %s AND m.receiver_id = %s))
                        AND m.message_text LIKE %s
                        AND m.is_deleted = 0
                    ORDER BY m.timestamp DESC
                    LIMIT %s
                """, (user_id, other_user_id, other_user_id, user_id, f'%{query}%', limit))
                return await cur.fetchall()

    @staticmethod
    async def search_all_conversations(user_id: int, query: str, limit: int = 100) -> List[Dict]:
        """Поиск по всем сообщениям пользователя"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("""
                    SELECT m.id, m.sender_id, m.receiver_id, m.message_text, 
                        m.file_path, m.filename, m.file_size, m.timestamp,
                        u1.username as sender_name, u2.username as receiver_name
                    FROM messages m
                    JOIN users u1 ON m.sender_id = u1.id
                    JOIN users u2 ON m.receiver_id = u2.id
                    WHERE (m.sender_id = %s OR m.receiver_id = %s)
                        AND m.message_text LIKE %s
                        AND m.is_deleted = 0
                    ORDER BY m.timestamp DESC
                    LIMIT %s
                """, (user_id, user_id, f'%{query}%', limit))
                
                results = await cur.fetchall()
                for row in results:
                    if row.get('timestamp'):
                        row['timestamp'] = row['timestamp'].replace(tzinfo=__import__('datetime').timezone.utc).isoformat()
                return results
                


class GroupModel:
    @staticmethod
    async def create_group(name: str, description: str, creator_id: int) -> Optional[int]:
        """Создать группу"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "INSERT INTO `groups` (name, description, creator_id) VALUES (%s, %s, %s)",
                    (name, description, creator_id)
                )
                group_id = cur.lastrowid
                
                # Добавляем создателя как админа
                await cur.execute(
                    "INSERT INTO group_members (group_id, user_id, role) VALUES (%s, %s, 'admin')",
                    (group_id, creator_id)
                )
                return group_id
    
    @staticmethod
    async def get_group(group_id: int) -> Optional[Dict]:
        """Получить информацию о группе"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """SELECT g.*, COUNT(gm.user_id) as member_count
                       FROM `groups` g
                       LEFT JOIN group_members gm ON g.id = gm.group_id
                       WHERE g.id = %s
                       GROUP BY g.id""",
                    (group_id,)
                )
                return await cur.fetchone()
    
    @staticmethod
    async def get_user_groups(user_id: int) -> List[Dict]:
        """Получить все группы пользователя"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """SELECT g.*, COUNT(gm2.user_id) as member_count,
                              (SELECT COUNT(*) FROM group_messages WHERE group_id = g.id) as message_count
                       FROM `groups` g
                       JOIN group_members gm ON g.id = gm.group_id
                       LEFT JOIN group_members gm2 ON g.id = gm2.group_id
                       WHERE gm.user_id = %s
                       GROUP BY g.id
                       ORDER BY g.created_at DESC""",
                    (user_id,)
                )
                return await cur.fetchall()
    
    @staticmethod
    async def add_member(group_id: int, user_id: int, role: str = 'member') -> bool:
        """Добавить участника в группу"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        "INSERT INTO group_members (group_id, user_id, role) VALUES (%s, %s, %s)",
                        (group_id, user_id, role)
                    )
                    return True
                except:
                    return False
    
    @staticmethod
    async def get_members(group_id: int) -> List[Dict]:
        """Получить всех участников группы"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """SELECT u.id, u.username, u.email, u.avatar, gm.role, gm.joined_at
                       FROM group_members gm
                       JOIN users u ON gm.user_id = u.id
                       WHERE gm.group_id = %s
                       ORDER BY gm.role DESC, u.username""",
                    (group_id,)
                )
                return await cur.fetchall()

    @staticmethod
    async def get_member_role(group_id: int, user_id: int) -> Optional[str]:
        """Получить роль пользователя в группе"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT role FROM group_members WHERE group_id = %s AND user_id = %s",
                    (group_id, user_id)
                )
                row = await cur.fetchone()
                return row['role'] if row else None

    @staticmethod
    async def update_group(group_id: int, name: str = None, description: str = None) -> bool:
        """Обновить информацию о группе"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    if name is not None:
                        await cur.execute("UPDATE `groups` SET name = %s WHERE id = %s", (name, group_id))
                    if description is not None:
                        await cur.execute("UPDATE `groups` SET description = %s WHERE id = %s", (description, group_id))
                    return True
                except Exception as e:
                    print(f"Error updating group: {e}")
                    return False

    @staticmethod
    async def delete_group(group_id: int) -> bool:
        """Удалить группу"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute("DELETE FROM group_members WHERE group_id = %s", (group_id,))
                    await cur.execute("DELETE FROM group_messages WHERE group_id = %s", (group_id,))
                    await cur.execute("DELETE FROM `groups` WHERE id = %s", (group_id,))
                    return True
                except Exception as e:
                    print(f"Error deleting group: {e}")
                    return False

    @staticmethod
    async def remove_member(group_id: int, user_id: int) -> bool:
        """Удалить участника из группы"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        "DELETE FROM group_members WHERE group_id = %s AND user_id = %s",
                        (group_id, user_id)
                    )
                    return cur.rowcount > 0
                except Exception as e:
                    print(f"Error removing member: {e}")
                    return False

    @staticmethod
    async def update_group_avatar(group_id: int, avatar_path: str) -> bool:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        "UPDATE `groups` SET avatar = %s WHERE id = %s",
                        (avatar_path, group_id)
                    )
                    return True
                except Exception as e:
                    print(f"Error updating group avatar: {e}")
                    return False

class GroupMessageModel:
    @staticmethod
    async def save_message(group_id: int, sender_id: int = None, message_text: str = None,
                        file_path: str = None, filename: str = None, file_size: int = None,
                        reply_to_id: int = None, is_system: bool = False, files: str = None) -> Optional[int]:
        """Сохранить сообщение в группе"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """INSERT INTO group_messages (group_id, sender_id, message_text, file_path,
                            filename, file_size, reply_to_id, is_system, files)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (group_id, sender_id, message_text, file_path, filename, file_size, reply_to_id, int(is_system), files)
                )
                return cur.lastrowid
    
    @staticmethod
    async def get_messages(group_id: int, limit: int = 50, offset: int = 0) -> List[Dict]:
        """Получить историю сообщений группы"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("""
                    SELECT
                        gm.id, gm.group_id, gm.sender_id,
                        COALESCE(gm.message_text, '') as message_text,
                        gm.file_path, gm.filename, gm.file_size, gm.timestamp,
                        gm.reply_to_id, gm.edited_at, gm.is_deleted,
                        COALESCE(gm.is_system, 0) as is_system,
                        gm.files,
                        u.username as sender_name,
                        u.avatar as sender_avatar,
                        COALESCE(u.avatar_color, '#1a73e8') as sender_avatar_color,
                        COALESCE(rm.message_text, '') as reply_to_text,
                        COALESCE(ru.username, '') as reply_to_sender
                    FROM group_messages gm
                    LEFT JOIN users u ON gm.sender_id = u.id
                    LEFT JOIN group_messages rm ON gm.reply_to_id = rm.id
                    LEFT JOIN users ru ON rm.sender_id = ru.id
                    WHERE gm.group_id = %s AND gm.is_deleted = 0
                    ORDER BY gm.timestamp DESC
                    LIMIT %s OFFSET %s
                """, (group_id, limit, offset))
                
                messages = await cur.fetchall()

                for msg in messages:
                    if msg.get('timestamp'):
                        msg['timestamp'] = msg['timestamp'].replace(tzinfo=__import__('datetime').timezone.utc).isoformat()
                    if msg.get('reply_to_text') is None:
                        msg['reply_to_text'] = ''
                    else:
                        msg['reply_to_text'] = str(msg['reply_to_text'])
                    if msg.get('reply_to_sender') is None:
                        msg['reply_to_sender'] = ''
                    else:
                        msg['reply_to_sender'] = str(msg['reply_to_sender'])

                return list(reversed(messages))
            
    @staticmethod
    async def search_messages(group_id: int, query: str, limit: int = 50) -> List[Dict]:
        """Поиск сообщений в группе"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("""
                    SELECT gm.id, gm.group_id, gm.sender_id, gm.message_text, 
                        gm.file_path, gm.filename, gm.file_size, gm.timestamp,
                        u.username as sender_name
                    FROM group_messages gm
                    JOIN users u ON gm.sender_id = u.id
                    WHERE gm.group_id = %s
                        AND gm.message_text LIKE %s
                        AND gm.is_deleted = 0
                    ORDER BY gm.timestamp DESC
                    LIMIT %s
                """, (group_id, f'%{query}%', limit))
                
                results = await cur.fetchall()
                for row in results:
                    if row.get('timestamp'):
                        row['timestamp'] = row['timestamp'].replace(tzinfo=__import__('datetime').timezone.utc).isoformat()
                return results
                    
# В models.py, в классе GroupMessageModel
    @staticmethod
    async def get_message_by_id(message_id: int) -> Optional[Dict]:
        """Получить групповое сообщение по ID"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """SELECT id, group_id, sender_id, message_text, file_path, 
                            filename, file_size, reply_to_id, timestamp
                    FROM group_messages WHERE id = %s""",
                    (message_id,)
                )
                return await cur.fetchone()

    @staticmethod
    async def update_message(message_id: int, new_text: str) -> bool:
        """Обновить текст группового сообщения"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE group_messages SET message_text = %s, edited_at = NOW() WHERE id = %s",
                    (new_text, message_id)
                )
                return cur.rowcount > 0

    @staticmethod
    async def delete_message(message_id: int) -> bool:
        """Пометить групповое сообщение как удаленное"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE group_messages SET is_deleted = TRUE WHERE id = %s",
                    (message_id,)
                )
                return cur.rowcount > 0

    @staticmethod
    async def clear_messages(group_id: int) -> bool:
        """Удалить все сообщения группы"""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute("DELETE FROM group_messages WHERE group_id = %s", (group_id,))
                    return True
                except Exception as e:
                    print(f"Error clearing group messages: {e}")
                    return False


class GroupReadModel:
    @staticmethod
    async def mark_group_messages_read(group_id: int, user_id: int) -> List[int]:
        """Отметить все сообщения группы как прочитанные данным пользователем. Возвращает IDs новых прочитанных."""
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                # Get unread message IDs (not from self)
                await cur.execute("""
                    SELECT id FROM group_messages
                    WHERE group_id = %s AND sender_id != %s AND is_deleted = 0
                    AND id NOT IN (SELECT message_id FROM group_message_reads WHERE user_id = %s)
                """, (group_id, user_id, user_id))
                rows = await cur.fetchall()
                if not rows:
                    return []
                ids = [r[0] for r in rows]
                await cur.executemany(
                    "INSERT IGNORE INTO group_message_reads (message_id, user_id, group_id) VALUES (%s, %s, %s)",
                    [(mid, user_id, group_id) for mid in ids]
                )
                await conn.commit()
                return ids

    @staticmethod
    async def get_read_counts(message_ids: List[int]) -> Dict[int, int]:
        """Получить количество прочитавших для каждого сообщения"""
        if not message_ids:
            return {}
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                fmt = ','.join(['%s'] * len(message_ids))
                await cur.execute(
                    f"SELECT message_id, COUNT(*) as cnt FROM group_message_reads WHERE message_id IN ({fmt}) GROUP BY message_id",
                    message_ids
                )
                rows = await cur.fetchall()
                return {r[0]: r[1] for r in rows}


class ReactionModel:
    @staticmethod
    async def add_reaction(message_id: int, is_group: bool, user_id: int, emoji: str) -> bool:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        "INSERT IGNORE INTO message_reactions (message_id, is_group, user_id, emoji) VALUES (%s, %s, %s, %s)",
                        (message_id, int(is_group), user_id, emoji)
                    )
                    return True
                except Exception as e:
                    print(f"Error adding reaction: {e}")
                    return False

    @staticmethod
    async def remove_reaction(message_id: int, is_group: bool, user_id: int, emoji: str) -> bool:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM message_reactions WHERE message_id=%s AND is_group=%s AND user_id=%s AND emoji=%s",
                    (message_id, int(is_group), user_id, emoji)
                )
                return cur.rowcount > 0

    @staticmethod
    async def get_reactions(message_id: int, is_group: bool) -> List[Dict]:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT emoji, user_id FROM message_reactions WHERE message_id=%s AND is_group=%s",
                    (message_id, int(is_group))
                )
                return await cur.fetchall()

    @staticmethod
    async def get_reactions_for_messages(message_ids: List[int], is_group: bool) -> Dict[int, List[Dict]]:
        if not message_ids:
            return {}
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                placeholders = ','.join(['%s'] * len(message_ids))
                await cur.execute(
                    f"SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id IN ({placeholders}) AND is_group=%s",
                    (*message_ids, int(is_group))
                )
                rows = await cur.fetchall()
                result: Dict[int, List[Dict]] = {}
                for row in rows:
                    mid = row['message_id']
                    if mid not in result:
                        result[mid] = []
                    result[mid].append({'emoji': row['emoji'], 'user_id': row['user_id']})
                return result


class FolderModel:
    @staticmethod
    async def get_folders(user_id: int) -> List[Dict]:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT id, name, color, position FROM chat_folders WHERE user_id=%s ORDER BY position, id",
                    (user_id,)
                )
                folders = await cur.fetchall()
                for folder in folders:
                    await cur.execute(
                        "SELECT chat_type, chat_id FROM folder_chats WHERE folder_id=%s",
                        (folder['id'],)
                    )
                    folder['chats'] = await cur.fetchall()
                return folders

    @staticmethod
    async def create_folder(user_id: int, name: str, color: str = '#6366f1') -> Optional[int]:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "INSERT INTO chat_folders (user_id, name, color) VALUES (%s, %s, %s)",
                    (user_id, name, color)
                )
                return cur.lastrowid

    @staticmethod
    async def update_folder(folder_id: int, user_id: int, name: str = None, color: str = None) -> bool:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                fields, vals = [], []
                if name is not None:
                    fields.append("name=%s"); vals.append(name)
                if color is not None:
                    fields.append("color=%s"); vals.append(color)
                if not fields:
                    return False
                vals += [folder_id, user_id]
                await cur.execute(f"UPDATE chat_folders SET {', '.join(fields)} WHERE id=%s AND user_id=%s", vals)
                return cur.rowcount > 0

    @staticmethod
    async def delete_folder(folder_id: int, user_id: int) -> bool:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("DELETE FROM folder_chats WHERE folder_id=%s", (folder_id,))
                await cur.execute("DELETE FROM chat_folders WHERE id=%s AND user_id=%s", (folder_id, user_id))
                return cur.rowcount > 0

    @staticmethod
    async def add_chat(folder_id: int, chat_type: str, chat_id: int) -> bool:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        "INSERT IGNORE INTO folder_chats (folder_id, chat_type, chat_id) VALUES (%s, %s, %s)",
                        (folder_id, chat_type, chat_id)
                    )
                    return True
                except Exception as e:
                    print(f"Error adding chat to folder: {e}")
                    return False

    @staticmethod
    async def remove_chat(folder_id: int, chat_type: str, chat_id: int) -> bool:
        pool = await DatabasePool.get_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM folder_chats WHERE folder_id=%s AND chat_type=%s AND chat_id=%s",
                    (folder_id, chat_type, chat_id)
                )
                return cur.rowcount > 0