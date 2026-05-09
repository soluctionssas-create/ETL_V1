"""Rutas de facturas con persistencia y Celery."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import CurrentUser, require_operator, require_viewer
from app.db.base import get_db
from app.repositories.invoice_repository import InvoiceBatchRepository, InvoiceRepository
from app.schemas.invoice import BatchOut, InvoiceOut, PaginatedResponse

router = APIRouter()

ALLOWED_TYPES = {
    "application/pdf",
    "text/xml",
    "application/xml",
    "application/zip",
    "application/x-zip-compressed",
    "text/csv",
}


@router.post("/batches", response_model=BatchOut, status_code=status.HTTP_202_ACCEPTED)
async def upload_batch(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_operator),
    db: Session = Depends(get_db),
):
    """Sube un lote de facturas (PDF, XML, ZIP, CSV) y dispara el pipeline ETL."""
    content_type = file.content_type or ""
    if content_type not in ALLOWED_TYPES and not file.filename.endswith(
        (".pdf", ".xml", ".zip", ".csv")
    ):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"File type '{content_type}' not supported",
        )

    # Lee el archivo para verificar tamaño
    data = await file.read()
    size_mb = len(data) / (1024 * 1024)
    if size_mb > settings.max_upload_size_mb:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {settings.max_upload_size_mb} MB limit",
        )

    repo = InvoiceBatchRepository(db)
    batch = repo.create(
        tenant_id=current_user.tenant_id,
        user_id=current_user.user_id,
        filename=file.filename or "upload",
        file_size=len(data),
        file_type=content_type or "unknown",
    )

    # Dispara tarea Celery (importación lazy para evitar deps circulares)
    try:
        from app.worker.tasks import parse_invoice_batch  # type: ignore[import]
        task = parse_invoice_batch.apply_async(
            args=[str(batch.id), str(current_user.tenant_id)],
            queue="etl.parse",
        )
        repo.update_status(batch.id, "processing", celery_task_id=task.id)
        batch.celery_task_id = task.id
        batch.status = "processing"
    except Exception:
        # El batch queda en pending si Celery no está disponible (modo local/test)
        pass

    return batch


@router.get("/batches", response_model=PaginatedResponse)
def list_batches(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    current_user: CurrentUser = Depends(require_viewer),
    db: Session = Depends(get_db),
):
    """Lista los lotes del tenant con paginación."""
    repo = InvoiceBatchRepository(db)
    items, total = repo.list_by_tenant(
        tenant_id=current_user.tenant_id,
        page=page,
        page_size=page_size,
        status=status_filter,
    )
    return PaginatedResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[BatchOut.model_validate(b) for b in items],
    )


@router.get("/batches/{batch_id}", response_model=BatchOut)
def get_batch(
    batch_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_viewer),
    db: Session = Depends(get_db),
):
    repo = InvoiceBatchRepository(db)
    batch = repo.get_by_id(batch_id, current_user.tenant_id)
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    return batch


@router.get("/batches/{batch_id}/invoices", response_model=PaginatedResponse)
def list_batch_invoices(
    batch_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: CurrentUser = Depends(require_viewer),
    db: Session = Depends(get_db),
):
    """Lista facturas de un lote."""
    batch_repo = InvoiceBatchRepository(db)
    if not batch_repo.get_by_id(batch_id, current_user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    repo = InvoiceRepository(db)
    items, total = repo.list_by_batch(
        batch_id=batch_id,
        tenant_id=current_user.tenant_id,
        page=page,
        page_size=page_size,
    )
    return PaginatedResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[InvoiceOut.model_validate(i) for i in items],
    )

