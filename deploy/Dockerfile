FROM python:3.13-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UVICORN_HOST=0.0.0.0 \
    UVICORN_PORT=8765

RUN useradd --system --create-home --uid 1000 --shell /usr/sbin/nologin panel \
    && mkdir -p /app/data \
    && chown -R panel:panel /app

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
COPY src ./src
COPY static ./static

RUN uv sync --frozen --no-cache --no-dev \
    && chown -R panel:panel /app

USER panel
ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=3)"

CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host \"${UVICORN_HOST}\" --port \"${UVICORN_PORT}\""]
