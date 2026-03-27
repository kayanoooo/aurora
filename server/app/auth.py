import jwt
import bcrypt
from datetime import datetime, timedelta
from typing import Optional, Dict
from .config import config

def hash_password(password: str) -> str:
    """Хеширует пароль"""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    """Проверяет пароль"""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_jwt_token(user_id: int, username: str) -> str:
    """Создает JWT токен"""
    payload = {
        'user_id': user_id,
        'username': username,
        'exp': datetime.utcnow() + timedelta(minutes=config.JWT_EXPIRATION_MINUTES)
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)

def decode_jwt_token(token: str) -> Optional[Dict]:
    """Декодирует JWT токен"""
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None