"""Tareas Celery del pipeline ETL: parse → classify → export."""
from __future__ import annotations

import logging
import uuid
from typing import Any

from celery import chain, group
from worker.celery_app import celery_app

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers de DB (importación lazy para evitar deps circulares en tests)
# ─────────────────────────────────────────────────────────────────────────────

def _get_db_session():
    """Crea una sesión SQLAlchemy para usar dentro de una tarea."""
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "api"))

    from app.db.base import SessionLocal
    return SessionLocal()


# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Parse
# ─────────────────────────────────────────────────────────────────────────────

@celery_app.task(
    name="worker.tasks.parse_invoice_batch",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=5,
    queue="etl.parse",
    acks_late=True,
)
def parse_invoice_batch(self, batch_id: str, tenant_id: str) -> dict[str, Any]:
    """
    Stage 1: Parsea el lote de facturas desde el storage.
    - Lee el archivo (PDF/XML/CSV/ZIP)
    - Extrae datos estructurados por factura
    - Crea los registros Invoice en BD
    - Encadena classify_batch
    """
    logger.info("parse_invoice_batch: batch=%s tenant=%s", batch_id, tenant_id)

    db = _get_db_session()
    try:
        from app.models.invoice import InvoiceBatch, BatchStatus, Invoice, InvoiceStatus

        batch = db.query(InvoiceBatch).filter(
            InvoiceBatch.id == uuid.UUID(batch_id)
        ).first()

        if not batch:
            logger.error("Batch %s not found", batch_id)
            return {"error": "batch_not_found", "batch_id": batch_id}

        # Actualiza estado
        batch.status = BatchStatus.processing
        db.commit()

        # Simulación de parseo real (aquí iría PyMuPDF, lxml, csv.DictReader, etc.)
        # En producción: leer desde S3/MinIO, parsear, crear Invoice por cada registro
        parsed_invoices = _simulate_parse(batch.filename, str(batch.id))

        # Inserta facturas en BD
        for inv_data in parsed_invoices:
            invoice = Invoice(
                batch_id=batch.id,
                tenant_id=batch.tenant_id,
                invoice_number=inv_data.get("invoice_number"),
                vendor_name=inv_data.get("vendor_name"),
                vendor_tax_id=inv_data.get("vendor_tax_id"),
                total_amount=inv_data.get("total_amount"),
                tax_amount=inv_data.get("tax_amount"),
                currency=inv_data.get("currency", "COP"),
                status=InvoiceStatus.parsed,
                raw_data=str(inv_data),
            )
            db.add(invoice)

        batch.total_invoices = len(parsed_invoices)
        db.commit()

        logger.info("parse_invoice_batch: %d invoices parsed for batch=%s", len(parsed_invoices), batch_id)

        # Encadena al clasificador
        classify_batch.apply_async(args=[batch_id, tenant_id], queue="etl.classify")

        return {"batch_id": batch_id, "total_parsed": len(parsed_invoices), "stage": "parsed"}

    except Exception as exc:
        logger.exception("parse_invoice_batch failed for batch=%s", batch_id)
        try:
            from app.models.invoice import InvoiceBatch, BatchStatus
            batch = db.query(InvoiceBatch).filter(InvoiceBatch.id == uuid.UUID(batch_id)).first()
            if batch:
                batch.status = BatchStatus.failed
                batch.error_message = str(exc)[:500]
                db.commit()
        except Exception:
            pass
        raise
    finally:
        db.close()


def _simulate_parse(filename: str, batch_id: str) -> list[dict]:
    """Simulación de parseo. En producción reemplazar con lógica real."""
    return [
        {
            "invoice_number": f"INV-{batch_id[:8]}-001",
            "vendor_name": "Proveedor Demo S.A.S",
            "vendor_tax_id": "900123456-7",
            "total_amount": 1190000.00,
            "tax_amount": 190000.00,
            "currency": "COP",
        },
        {
            "invoice_number": f"INV-{batch_id[:8]}-002",
            "vendor_name": "Servicios Técnicos Ltda",
            "vendor_tax_id": "800987654-1",
            "total_amount": 595000.00,
            "tax_amount": 95000.00,
            "currency": "COP",
        },
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Classify
# ─────────────────────────────────────────────────────────────────────────────

@celery_app.task(
    name="worker.tasks.classify_batch",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=5,
    queue="etl.classify",
    acks_late=True,
)
def classify_batch(self, batch_id: str, tenant_id: str) -> dict[str, Any]:
    """
    Stage 2: Clasifica cada factura con reglas + scoring de confianza.
    - Aplica reglas basadas en vendor_name / tax_id / amount
    - Asigna cuenta contable, centro de costos y categoría
    - Crea registros Classification en BD
    """
    logger.info("classify_batch: batch=%s tenant=%s", batch_id, tenant_id)

    db = _get_db_session()
    try:
        from app.models.invoice import Invoice, InvoiceStatus, Classification

        invoices = db.query(Invoice).filter(
            Invoice.batch_id == uuid.UUID(batch_id),
            Invoice.status == InvoiceStatus.parsed,
        ).all()

        classified = 0
        for invoice in invoices:
            classification = _classify_invoice(invoice)
            cls = Classification(
                invoice_id=invoice.id,
                tenant_id=invoice.tenant_id,
                account_code=classification["account_code"],
                account_name=classification["account_name"],
                cost_center=classification["cost_center"],
                category=classification["category"],
                confidence_score=classification["confidence_score"],
                is_manual_review=classification["confidence_score"] < 0.7,
            )
            db.add(cls)
            invoice.status = InvoiceStatus.classified
            classified += 1

        from app.models.invoice import InvoiceBatch
        batch = db.query(InvoiceBatch).filter(InvoiceBatch.id == uuid.UUID(batch_id)).first()
        if batch:
            batch.processed_invoices = classified

        db.commit()
        logger.info("classify_batch: %d invoices classified for batch=%s", classified, batch_id)

        return {"batch_id": batch_id, "classified": classified, "stage": "classified"}

    except Exception as exc:
        logger.exception("classify_batch failed for batch=%s", batch_id)
        raise
    finally:
        db.close()


def _classify_invoice(invoice) -> dict:
    """Motor de clasificación rule-based. En producción: ML model / LLM."""
    vendor = (invoice.vendor_name or "").lower()
    amount = float(invoice.total_amount or 0)

    if "servicio" in vendor or "técnic" in vendor:
        return {
            "account_code": "519500",
            "account_name": "Servicios Técnicos",
            "cost_center": "CC-TI",
            "category": "services",
            "confidence_score": 0.92,
        }
    if "proveedor" in vendor or amount > 1_000_000:
        return {
            "account_code": "140500",
            "account_name": "Inventarios - Mercancías",
            "cost_center": "CC-OPS",
            "category": "inventory",
            "confidence_score": 0.85,
        }
    return {
        "account_code": "519900",
        "account_name": "Otros Gastos",
        "cost_center": "CC-ADM",
        "category": "other",
        "confidence_score": 0.55,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Export
# ─────────────────────────────────────────────────────────────────────────────

@celery_app.task(
    name="worker.tasks.export_to_erp",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=5,
    queue="etl.export",
    acks_late=True,
)
def export_to_erp(self, export_id: str, batch_id: str, tenant_id: str, erp_system: str) -> dict[str, Any]:
    """
    Stage 3: Exporta facturas clasificadas al ERP destino.
    - Construye el payload en el formato del ERP (SAP, Siigo, Helisa, etc.)
    - Llama al API del ERP o genera el archivo de importación
    - Actualiza estado de ErpExport en BD
    """
    logger.info("export_to_erp: export=%s batch=%s erp=%s", export_id, batch_id, erp_system)

    db = _get_db_session()
    try:
        from app.models.invoice import Invoice, InvoiceStatus
        from app.models.export import ErpExport, ExportStatus

        export = db.query(ErpExport).filter(ErpExport.id == uuid.UUID(export_id)).first()
        if not export:
            return {"error": "export_not_found"}

        export.status = ExportStatus.running
        db.commit()

        invoices = db.query(Invoice).filter(
            Invoice.batch_id == uuid.UUID(batch_id),
            Invoice.status == InvoiceStatus.classified,
        ).all()

        # Construye payload según ERP
        payload = _build_erp_payload(erp_system, invoices)

        # En producción: llamar al API del ERP con httpx
        exported_count = len(invoices)
        for inv in invoices:
            inv.status = InvoiceStatus.exported

        export.status = ExportStatus.success
        export.total_records = len(invoices)
        export.exported_records = exported_count
        export.export_payload = str(payload)[:5000]

        from app.models.invoice import InvoiceBatch, BatchStatus
        batch = db.query(InvoiceBatch).filter(InvoiceBatch.id == uuid.UUID(batch_id)).first()
        if batch:
            batch.status = BatchStatus.completed

        db.commit()
        logger.info("export_to_erp: %d records exported to %s", exported_count, erp_system)

        return {
            "export_id": export_id,
            "erp_system": erp_system,
            "exported": exported_count,
            "stage": "exported",
        }

    except Exception as exc:
        logger.exception("export_to_erp failed for export=%s", export_id)
        try:
            from app.models.export import ErpExport, ExportStatus
            exp = db.query(ErpExport).filter(ErpExport.id == uuid.UUID(export_id)).first()
            if exp:
                exp.status = ExportStatus.failed
                exp.error_message = str(exc)[:500]
                db.commit()
        except Exception:
            pass
        raise
    finally:
        db.close()


def _build_erp_payload(erp_system: str, invoices: list) -> list[dict]:
    """Transforma facturas al formato del ERP destino."""
    if erp_system.lower() == "siigo":
        return [
            {
                "document": {"id": 1},
                "date": str(inv.created_at.date()) if inv.created_at else "",
                "customer": {"identification": inv.vendor_tax_id},
                "items": [{"code": inv.invoice_number, "description": inv.vendor_name, "quantity": 1, "price": float(inv.total_amount or 0)}],
            }
            for inv in invoices
        ]
    # Generic / SAP fallback
    return [
        {
            "invoice_id": str(inv.id),
            "invoice_number": inv.invoice_number,
            "vendor": inv.vendor_name,
            "amount": float(inv.total_amount or 0),
        }
        for inv in invoices
    ]

