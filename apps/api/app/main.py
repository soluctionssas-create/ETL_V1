from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings


app = FastAPI(
    title="ETL Contable SaaS API",
    version="1.0.0",
    openapi_url="/api/v1/openapi.json",
    docs_url="/api/v1/docs",
    redoc_url="/api/v1/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def correlation_and_tenant_middleware(request: Request, call_next):
    request.state.correlation_id = request.headers.get("X-Correlation-Id", "")
    request.state.tenant_id = request.headers.get("X-Tenant-Id", "")
    response = await call_next(request)
    if request.state.correlation_id:
        response.headers["X-Correlation-Id"] = request.state.correlation_id
    return response


app.include_router(api_router, prefix="/api/v1")
