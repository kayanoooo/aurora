import uvicorn
from app.config import config

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=config.SERVER_HOST,
        port=config.SERVER_PORT,
        reload=True  # Автоматически перезагружается при изменениях
    )