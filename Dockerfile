# Multi-stage: the intermediate "builder" stage trusts a local-machine dev
# TLS-interception CA (geder-filter-ca.crt.local, gitignored) so `pip install`
# can complete when built through that proxy. Only the *installed packages*
# are copied into the final stage below — the cert is never trusted by, or
# present in, the shipped image. When geder-filter-ca.crt.local doesn't exist
# (CI, other machines), the COPY is a no-op glob match and update-ca-certificates
# is a harmless no-op too.
FROM python:3.12-slim AS builder

WORKDIR /app
COPY requirements.txt .
COPY geder-filter-ca.crt.local* /usr/local/share/ca-certificates/geder.crt
RUN update-ca-certificates && \
    pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY --from=builder /install /usr/local
COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
