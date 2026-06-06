FROM node:20-bookworm-slim AS client-builder

WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

COPY server/ /app/server/
COPY --from=client-builder /build/client/build /app/client/build

RUN mkdir -p /app/uploads

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --app-dir server --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
