from uuid import uuid4

from fastapi import APIRouter, File, UploadFile


router = APIRouter()


@router.post("/upload", status_code=202)
def upload_invoice(file: UploadFile = File(...)):
    batch_id = str(uuid4())
    return {
        "batch_id": batch_id,
        "filename": file.filename,
        "status": "accepted",
        "next": "processing_async",
    }


@router.get("")
def list_invoices(limit: int = 20, offset: int = 0):
    return {"data": [], "meta": {"limit": limit, "offset": offset}}


@router.get("/{invoice_id}")
def get_invoice(invoice_id: str):
    return {"id": invoice_id, "status": "processing"}


@router.post("/{invoice_id}/reprocess", status_code=202)
def reprocess_invoice(invoice_id: str):
    return {"id": invoice_id, "status": "requeued"}
