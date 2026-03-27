import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # MySQL
    MYSQL_HOST = os.getenv('MYSQL_HOST', 'localhost')
    MYSQL_PORT = int(os.getenv('MYSQL_PORT', 3307))
    MYSQL_USER = os.getenv('MYSQL_USER', 'user')
    MYSQL_PASSWORD = os.getenv('MYSQL_PASSWORD', 'userpassword')
    MYSQL_DATABASE = os.getenv('MYSQL_DATABASE', 'messenger')
    
    # JWT
    JWT_SECRET = os.getenv('JWT_SECRET', 'your-super-secret-key-change-this')
    JWT_ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256')
    JWT_EXPIRATION_MINUTES = int(os.getenv('JWT_EXPIRATION_MINUTES', 1440))
    
    # Сервер
    SERVER_HOST = os.getenv('SERVER_HOST', '0.0.0.0')
    SERVER_PORT = int(os.getenv('SERVER_PORT', 8000))
    
    @property
    def DATABASE_URL(self):
        return f"mysql://{self.MYSQL_USER}:{self.MYSQL_PASSWORD}@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}"

config = Config()