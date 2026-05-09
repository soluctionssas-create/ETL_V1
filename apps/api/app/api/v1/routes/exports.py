from fastapi import APIRouter


router = APIRouter()


@router.post("/run", status_code=202)
def run_export(batch_id: str):
    return {"batch_id": batch_id, "status": "queued"}


@router.get("")
def list_exports(limit: int = 20, offset: int = 0):
    return {"data": [], "meta": {"limit": limit, "offset": offset}}


@router.get("/{export_id}")
def get_export(export_id: str):
    return {"id": export_id, "status": "pending"}


@router.post("/{export_id}/retry", status_code=202)
def retry_export(export_id: str):
    return {"id": export_id, "status": "requeued"}
