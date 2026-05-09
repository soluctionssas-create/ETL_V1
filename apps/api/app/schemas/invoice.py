"""Schemas para facturas y lotes."""
from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field


class BatchOut(BaseModel):
    id: uuid.UUID
    filename: str
    file_size: int
    file_type: str
    status: str
    total_invoices: int
    processed_invoices: int
    failed_invoices: int
    celery_task_id: str | None
    error_message: str | None

    model_config = {"from_attributes": True}


class InvoiceOut(BaseModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    invoice_number: str | None
    vendor_name: str | None
    vendor_tax_id: str | None
    total_amount: Decimal | None
    tax_amount: Decimal | None
    currency: str
    status: str
    error_message: str | None

    model_config = {"from_attributes": True}


class PaginatedResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list


class ClassificationOut(BaseModel):
    id: uuid.UUID
    invoice_id: uuid.UUID
    account_code: str | None
    account_name: str | None
    cost_center: str | None
    category: str | None
    confidence_score: Decimal | None
    is_manual_review: bool

    model_config = {"from_attributes": True}


class ExportOut(BaseModel):
    id: uuid.UUID
    erp_system: str
    status: str
    total_records: int
    exported_records: int
    celery_task_id: str | None
    error_message: str | None

    model_config = {"from_attributes": True}
