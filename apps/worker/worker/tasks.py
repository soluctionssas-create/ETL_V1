from worker.celery_app import celery_app


@celery_app.task(name="worker.tasks.parse_invoice", autoretry_for=(Exception,), retry_backoff=True, max_retries=5)
def parse_invoice(invoice_id: str):
    return {"invoice_id": invoice_id, "stage": "parsed"}


@celery_app.task(name="worker.tasks.classify_invoice", autoretry_for=(Exception,), retry_backoff=True, max_retries=5)
def classify_invoice(invoice_id: str):
    return {"invoice_id": invoice_id, "stage": "classified"}


@celery_app.task(name="worker.tasks.export_erp", autoretry_for=(Exception,), retry_backoff=True, max_retries=5)
def export_erp(batch_id: str):
    return {"batch_id": batch_id, "stage": "exported"}
