"""Tareas Celery del pipeline ETL: parse → classify → export."""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

from celery import chain, group
from worker.celery_app import celery_app

logger = logging.getLogger(__name__)

UVT_2026_COP = 52374
RETEIVA_FALLBACK_RATE = 0.15
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = PROJECT_ROOT / "data"
RETEFUENTE_CONFIG_PATH = DATA_DIR / "retefuente_2026.json"
RETEICA_CITIES_CONFIG_PATH = DATA_DIR / "reteica_ciudades.json"
RETEICA_CALI_LEGACY_PATH = DATA_DIR / "reteica_cali.json"
RETEIVA_CONFIG_PATH = DATA_DIR / "reteiva_config.json"

_retefuente_config_cache: dict[str, Any] | None = None
_reteica_config_cache: dict[str, Any] | None = None
_reteiva_config_cache: dict[str, Any] | None = None


def _load_json_config(path: Path, default_value: dict[str, Any]) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default_value


def _load_retefuente_config() -> dict[str, Any]:
    global _retefuente_config_cache
    if _retefuente_config_cache is not None:
        return _retefuente_config_cache

    _retefuente_config_cache = _load_json_config(
        RETEFUENTE_CONFIG_PATH,
        {
            "uvt_value_cop": UVT_2026_COP,
            "default_rule": {
                "concept": "Compras generales declarantes",
                "base_uvt": 10,
                "base_cop": 10 * UVT_2026_COP,
                "rate": 0.025,
                "account_code": "236540",
                "keywords": [],
            },
            "rules": [],
        },
    )
    return _retefuente_config_cache


def _load_reteica_config() -> dict[str, Any]:
    global _reteica_config_cache
    if _reteica_config_cache is not None:
        return _reteica_config_cache

    default_config = {
        "account_code": "23680101",
        "cities": {
            "CALI": {
                "service": {
                    "account_code": "23680102",
                    "base_uvt": 3,
                    "base_cop": 3 * UVT_2026_COP,
                    "rate": 0.01,
                    "keywords": ["servicio"],
                },
                "purchase": {
                    "account_code": "23680101",
                    "base_uvt": 15,
                    "base_cop": 15 * UVT_2026_COP,
                    "rate": 0.0077,
                    "keywords": ["compra"],
                },
            }
        },
    }

    config = _load_json_config(RETEICA_CITIES_CONFIG_PATH, {})
    if config:
        _reteica_config_cache = config
        return _reteica_config_cache

    legacy = _load_json_config(RETEICA_CALI_LEGACY_PATH, {})
    if legacy:
        city = str(legacy.get("city_match", "CALI")).strip().upper() or "CALI"
        _reteica_config_cache = {
            "account_code": str(legacy.get("account_code", "23680101") or "23680101"),
            "cities": {
                city: {
                    "service": legacy.get("service", {}),
                    "purchase": legacy.get("purchase", {}),
                }
            },
        }
        return _reteica_config_cache

    _reteica_config_cache = default_config
    return _reteica_config_cache


def _load_reteiva_config() -> dict[str, Any]:
    global _reteiva_config_cache
    if _reteiva_config_cache is not None:
        return _reteiva_config_cache

    _reteiva_config_cache = _load_json_config(
        RETEIVA_CONFIG_PATH,
        {
            "account_code": "236701",
            "fallback_rate": RETEIVA_FALLBACK_RATE,
        },
    )
    return _reteiva_config_cache


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
    """Motor rule-based con RETEFUENTE/RETEICA/RETEIVA desde configuracion."""
    vendor = (invoice.vendor_name or "").lower()
    description = " ".join(filter(None, [invoice.vendor_name or "", invoice.invoice_number or ""]))
    normalized_description = description.lower()
    amount = float(invoice.total_amount or 0)
    tax_amount = float(invoice.tax_amount or 0)

    retefuente_config = _load_retefuente_config()
    uvt_value = int(retefuente_config.get("uvt_value_cop", UVT_2026_COP) or UVT_2026_COP)
    default_rule = retefuente_config.get("default_rule", {})

    rfte_match = None
    for rule in retefuente_config.get("rules", []):
        keywords = [str(keyword).lower().strip() for keyword in rule.get("keywords", []) if str(keyword).strip()]
        if any(keyword in normalized_description for keyword in keywords):
            rfte_match = rule
            break

    if rfte_match is None:
        rfte_match = default_rule

    rfte_rate = float(rfte_match.get("rate", 0.025) or 0.025)
    rfte_base_uvt = float(rfte_match.get("base_uvt", 10) or 10)
    rfte_base_cop = int(rfte_match.get("base_cop", rfte_base_uvt * uvt_value) or (rfte_base_uvt * uvt_value))
    retefuente_applies = amount >= rfte_base_cop

    reteica_config = _load_reteica_config()
    city_cfg = (reteica_config.get("cities") or {}).get("CALI", {})
    service_cfg = city_cfg.get("service", {}) if isinstance(city_cfg, dict) else {}
    purchase_cfg = city_cfg.get("purchase", {}) if isinstance(city_cfg, dict) else {}
    service_keywords = [str(keyword).lower().strip() for keyword in service_cfg.get("keywords", []) if str(keyword).strip()]
    is_service = any(keyword in vendor for keyword in service_keywords) or "servicio" in normalized_description
    rica_rule = service_cfg if is_service else purchase_cfg

    rica_base_uvt = float(rica_rule.get("base_uvt", 3 if is_service else 15) or (3 if is_service else 15))
    rica_base_cop = int(rica_rule.get("base_cop", rica_base_uvt * uvt_value) or (rica_base_uvt * uvt_value))
    rica_rate = float(rica_rule.get("rate", 0.01 if is_service else 0.0077) or (0.01 if is_service else 0.0077))
    reteica_applies = amount >= rica_base_cop

    reteiva_config = _load_reteiva_config()
    reteiva_rate = float(reteiva_config.get("fallback_rate", RETEIVA_FALLBACK_RATE) or RETEIVA_FALLBACK_RATE)
    reteiva_applies = tax_amount > 0

    if is_service:
        account_code = "519500"
        account_name = "Servicios Tecnicos"
        cost_center = "CC-TI"
        category = "services"
        confidence = 0.92
    else:
        account_code = "140500"
        account_name = "Inventarios - Mercancias"
        cost_center = "CC-OPS"
        category = "inventory"
        confidence = 0.85

    if not retefuente_applies and not reteica_applies and not reteiva_applies:
        return {
            "account_code": "519900",
            "account_name": "Otros Gastos",
            "cost_center": "CC-ADM",
            "category": "other",
            "confidence_score": 0.55,
        }

    retention_tags = []
    if retefuente_applies:
        retention_tags.append(f"rfte:{rfte_rate}")
    if reteica_applies:
        retention_tags.append(f"rica:{rica_rate}")
    if reteiva_applies:
        retention_tags.append(f"reteiva:{reteiva_rate}")

    return {
        "account_code": account_code,
        "account_name": account_name,
        "cost_center": cost_center,
        "category": f"{category}|" + ",".join(retention_tags),
        "confidence_score": confidence,
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

