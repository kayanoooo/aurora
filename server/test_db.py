import asyncio
import aiomysql
from app.config import config

async def test_connection():
    try:
        print(f"Connecting to {config.MYSQL_HOST}:{config.MYSQL_PORT}")
        print(f"User: {config.MYSQL_USER}")
        print(f"Database: {config.MYSQL_DATABASE}")
        
        conn = await aiomysql.connect(
            host=config.MYSQL_HOST,
            port=config.MYSQL_PORT,
            user=config.MYSQL_USER,
            password=config.MYSQL_PASSWORD,
            db=config.MYSQL_DATABASE
        )
        
        async with conn.cursor() as cur:
            await cur.execute("SELECT 1")
            result = await cur.fetchone()
            print(f"Connection successful! Result: {result}")
        
        conn.close()
        return True
    except Exception as e:
        print(f"Connection failed: {e}")
        return False

if __name__ == "__main__":
    asyncio.run(test_connection())