import os
from dotenv import load_dotenv
from urllib.parse import urlparse, unquote

load_dotenv()

def _mysql_from_url():
    url = os.getenv('MYSQL_URL') or os.getenv('DATABASE_URL')
    if not url:
        return {}
    parsed = urlparse(url)
    if not parsed.hostname:
        return {}
    return {
        'host': parsed.hostname,
        'port': parsed.port or 3306,
        'user': unquote(parsed.username or ''),
        'password': unquote(parsed.password or ''),
        'database': parsed.path.lstrip('/') or 'railway',
    }

_MYSQL_URL_CONFIG = _mysql_from_url()

class Config:
    # MySQL
    MYSQL_HOST = os.getenv('MYSQL_HOST') or os.getenv('MYSQLHOST') or _MYSQL_URL_CONFIG.get('host', 'localhost')
    MYSQL_PORT = int(os.getenv('MYSQL_PORT') or os.getenv('MYSQLPORT') or _MYSQL_URL_CONFIG.get('port', 3307))
    MYSQL_USER = os.getenv('MYSQL_USER') or os.getenv('MYSQLUSER') or _MYSQL_URL_CONFIG.get('user', 'user')
    MYSQL_PASSWORD = os.getenv('MYSQL_PASSWORD') or os.getenv('MYSQLPASSWORD') or _MYSQL_URL_CONFIG.get('password', 'userpassword')
    MYSQL_DATABASE = os.getenv('MYSQL_DATABASE') or os.getenv('MYSQLDATABASE') or _MYSQL_URL_CONFIG.get('database', 'messenger')
    
    # JWT
    JWT_SECRET = os.getenv('JWT_SECRET', 'your-super-secret-key-change-this')
    JWT_ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256')
    JWT_EXPIRATION_MINUTES = int(os.getenv('JWT_EXPIRATION_MINUTES', 1440))
    
    # Сервер
    SERVER_HOST = os.getenv('SERVER_HOST', '0.0.0.0')
    SERVER_PORT = int(os.getenv('PORT') or os.getenv('SERVER_PORT', 8000))
    
    @property
    def DATABASE_URL(self):
        return f"mysql://{self.MYSQL_USER}:{self.MYSQL_PASSWORD}@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}"

config = Config()
