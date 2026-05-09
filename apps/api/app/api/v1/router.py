from fastapi import APIRouter

from app.api.v1.routes import auth, exports, health, invoices, tenants


api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(tenants.router, prefix="/tenants", tags=["tenants"])
api_router.include_router(invoices.router, prefix="/invoices", tags=["invoices"])
api_router.include_router(exports.router, prefix="/exports", tags=["exports"])
