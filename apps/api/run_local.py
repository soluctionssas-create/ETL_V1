"""Script de arranque local — API ETL SaaS con SQLite"""
import os
import sys

# Añadir apps/api al path
api_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, api_dir)

# Variables de entorno para desarrollo local
os.environ.setdefault("DATABASE_URL", "sqlite:///./etl_dev.db")
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("DEBUG", "true")
os.environ.setdefault("JWT_SECRET", "dev-secret-key-for-local-testing-only-min-32-chars-ok")
os.environ.setdefault("CORS_ORIGINS", '["http://localhost:3000","http://127.0.0.1:3000","http://localhost:8001"]')
os.environ.setdefault("RATE_LIMIT_REQUESTS", "1000")
os.environ.setdefault("MAX_UPLOAD_SIZE_MB", "50")

# Crear tablas si no existen
from app.db.base import engine, Base
from app import models  # noqa: F401 — importa todos los modelos

Base.metadata.create_all(bind=engine)
print("✅ Base de datos SQLite inicializada en etl_dev.db")

# Arrancar uvicorn
import uvicorn
uvicorn.run(
    "app.main:app",
    host="0.0.0.0",
    port=8001,
    reload=False,
    log_level="info",
)
