from fastapi import APIRouter
from pydantic import BaseModel


router = APIRouter()


class TenantCreate(BaseModel):
    name: str
    tax_id: str


@router.get("")
def list_tenants():
    return [{"id": "t-demo", "name": "Tenant Demo"}]


@router.post("")
def create_tenant(payload: TenantCreate):
    return {"id": "t-new", **payload.model_dump()}


@router.get("/{tenant_id}")
def get_tenant(tenant_id: str):
    return {"id": tenant_id, "name": "Tenant", "status": "active"}


@router.patch("/{tenant_id}")
def patch_tenant(tenant_id: str):
    return {"id": tenant_id, "updated": True}


@router.delete("/{tenant_id}")
def delete_tenant(tenant_id: str):
    return {"id": tenant_id, "deleted": True}
