# ─── Stage 1: Build frontend ─────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /workspace

# Install deps with layer-cache (package files change less often than source)
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --ignore-scripts

# Logo — copy to public/ so Vite bundles it as a static asset
# COPY logo.svg ./frontend/public/logo.svg

# Build (vite outDir: '../static' → /workspace/static)
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ─── Stage 2: Python backend ──────────────────────────────────────────────────
FROM python:3.13-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UVICORN_HOST=0.0.0.0 \
    UVICORN_PORT=8765 \
    PANEL_COOKIE_SECURE=false \
    PANEL_TRUST_FORWARDED_PROTO=false

RUN useradd --system --create-home --uid 1000 --shell /usr/sbin/nologin panel \
    && mkdir -p /app/data \
    && chown -R panel:panel /app

WORKDIR /app

# Python dependencies (own layer — changes rarely)
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-cache --no-dev

# Application source
COPY src ./src

# Built frontend from stage 1
COPY --from=frontend-builder /workspace/static ./static

RUN chown -R panel:panel /app

COPY deploy/docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh \
    && chmod 0755 /docker-entrypoint.sh

ENV HOME=/home/panel \
    PATH="/app/.venv/bin:$PATH"

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD /app/.venv/bin/python -c \
        "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=3)"

ENTRYPOINT ["/docker-entrypoint.sh"]
