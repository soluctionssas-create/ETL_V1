"""Repositorio de InvoiceBatch e Invoice."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.invoice import Invoice, InvoiceBatch


class InvoiceBatchRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, tenant_id: uuid.UUID, user_id: uuid.UUID, **kwargs: Any) -> InvoiceBatch:
        batch = InvoiceBatch(tenant_id=tenant_id, uploaded_by=user_id, **kwargs)
        self.db.add(batch)
        self.db.commit()
        self.db.refresh(batch)
        return batch

    def get_by_id(self, batch_id: uuid.UUID, tenant_id: uuid.UUID) -> InvoiceBatch | None:
        return (
            self.db.query(InvoiceBatch)
            .filter(
                InvoiceBatch.id == batch_id,
                InvoiceBatch.tenant_id == tenant_id,
                InvoiceBatch.is_deleted.is_(False),
            )
            .first()
        )

    def list_by_tenant(
        self,
        tenant_id: uuid.UUID,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
    ) -> tuple[list[InvoiceBatch], int]:
        q = self.db.query(InvoiceBatch).filter(
            InvoiceBatch.tenant_id == tenant_id,
            InvoiceBatch.is_deleted.is_(False),
        )
        if status:
            q = q.filter(InvoiceBatch.status == status)

        total = q.with_entities(func.count()).scalar()
        items = (
            q.order_by(InvoiceBatch.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total

    def update_status(
        self,
        batch_id: uuid.UUID,
        status: str,
        celery_task_id: str | None = None,
        error_message: str | None = None,
    ) -> None:
        batch = self.db.query(InvoiceBatch).filter(InvoiceBatch.id == batch_id).first()
        if batch:
            batch.status = status
            if celery_task_id is not None:
                batch.celery_task_id = celery_task_id
            if error_message is not None:
                batch.error_message = error_message
            self.db.commit()


class InvoiceRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_by_batch(
        self,
        batch_id: uuid.UUID,
        tenant_id: uuid.UUID,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[Invoice], int]:
        q = self.db.query(Invoice).filter(
            Invoice.batch_id == batch_id,
            Invoice.tenant_id == tenant_id,
            Invoice.is_deleted.is_(False),
        )
        total = q.with_entities(func.count()).scalar()
        items = (
            q.order_by(Invoice.created_at.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total
