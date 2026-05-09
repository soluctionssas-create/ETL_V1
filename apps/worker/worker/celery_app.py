import os

from celery import Celery


broker_url = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672//")
backend_url = os.getenv("REDIS_URL", "redis://localhost:6379/1")

celery_app = Celery("etl_worker", broker=broker_url, backend=backend_url)
celery_app.conf.task_routes = {
    "worker.tasks.parse_invoice": {"queue": "etl.parse"},
    "worker.tasks.classify_invoice": {"queue": "etl.classify"},
    "worker.tasks.export_erp": {"queue": "etl.export"},
}
