"""Modelos de dominio: InvoiceBatch, Invoice, Classification."""
import uuid
from enum import Enum

from sqlalchemy import BigInteger, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import AuditMixin


class BatchStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"
    partial = "partial"


class InvoiceStatus(str, Enum):
    raw = "raw"
    parsed = "parsed"
    classified = "classified"
    exported = "exported"
    error = "error"


class InvoiceBatch(Base, AuditMixin):
    __tablename__ = "invoice_batches"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(
        String(50), default=BatchStatus.pending, nullable=False
    )
    total_invoices: Mapped[int] = mapped_column(default=0, nullable=False)
    processed_invoices: Mapped[int] = mapped_column(default=0, nullable=False)
    failed_invoices: Mapped[int] = mapped_column(default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(200), nullable=True)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="invoice_batches")
    invoices: Mapped[list["Invoice"]] = relationship(
        "Invoice", back_populates="batch"
    )

    def __repr__(self) -> str:
        return f"<InvoiceBatch {self.id} status={self.status}>"


class Invoice(Base, AuditMixin):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoice_batches.id"), nullable=False
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    vendor_tax_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    total_amount: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    tax_amount: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="COP", nullable=False)
    status: Mapped[str] = mapped_column(
        String(50), default=InvoiceStatus.raw, nullable=False
    )
    raw_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    batch: Mapped["InvoiceBatch"] = relationship("InvoiceBatch", back_populates="invoices")
    classification: Mapped["Classification | None"] = relationship(
        "Classification", back_populates="invoice", uselist=False
    )

    def __repr__(self) -> str:
        return f"<Invoice {self.invoice_number} status={self.status}>"


class Classification(Base, AuditMixin):
    __tablename__ = "classifications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoices.id"), unique=True, nullable=False
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False
    )
    account_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    account_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    cost_center: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    is_manual_review: Mapped[bool] = mapped_column(default=False, nullable=False)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="classification")

    def __repr__(self) -> str:
        return f"<Classification {self.account_code}>"


# Import here to avoid circular deps
from app.models.tenant import Tenant  # noqa: E402, F401
