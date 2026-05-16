FROM python:3.12-slim

WORKDIR /app
# Build context es la raíz del repositorio (configurado en docker-compose.yml)
# para poder incluir data/ que está fuera de apps/worker/
COPY apps/worker/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/worker/worker ./worker
COPY data ./data

ENV DATA_DIR=/app/data

CMD ["celery", "-A", "worker.celery_app", "worker", "--loglevel=info"]
