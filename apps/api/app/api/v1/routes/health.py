"""Health checks para Kubernetes liveness y readiness probes."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.config import settings
from app.db.base import get_db

router = APIRouter()


@router.get("/health/live")
def liveness():
    """Liveness probe: el proceso está vivo."""
    return {"status": "ok", "version": settings.app_version}


@router.get("/health/ready")
def readiness(db: Session = Depends(get_db)):
    """Readiness probe: la DB es accesible."""
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    status = "ready" if db_ok else "degraded"
    return {
        "status": status,
        "version": settings.app_version,
        "checks": {"database": "ok" if db_ok else "error"},
    }

