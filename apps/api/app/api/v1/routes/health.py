from fastapi import APIRouter


router = APIRouter()


@router.get("/health/live")
def liveness():
    return {"status": "ok"}


@router.get("/health/ready")
def readiness():
    return {"status": "ready"}
