from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from app.auth_http import PanelAuthMiddleware
from app.auth_router import router as auth_router
from app.deploy import run_deploy, ssh_connect_test, stream_telemt_journal
from app.remote_telemt_config import fetch_telemt_config_from_server
from app.presets import list_presets
from app.metrics_history import append_snapshot, list_history
from app.metrics_prom import build_stats_cards, parse_prometheus_sample_lines
from app.metrics_remote import fetch_remote_prometheus_metrics
from app.schemas import DeployRequest, JournalStreamRequest, MetricsSnapshotRequest, SSHTestRequest
from app.server_schemas import StoredServerCreate, StoredServerUpdate
from app.server_store import create_server, delete_server, get_server, list_servers, update_server
from app.cloud_router import cloud_meta_router, router as cloud_vdsina_router
from app.http_shared import close_shared_http_client, shared_http_client
from app.panel_auth_settings import get_panel_auth_settings
from app.ws_auth import require_panel_ws_or_close

STATIC_DIR = Path(__file__).resolve().parents[2] / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    shared_http_client()
    try:
        yield
    finally:
        await close_shared_http_client()


app = FastAPI(title="Telemt — панель развёртывания по SSH", lifespan=lifespan)


def _configure_middleware(application: FastAPI) -> None:
    application.add_middleware(PanelAuthMiddleware)
    s = get_panel_auth_settings()
    origins = [o.strip() for o in (s.cors_origins or "").split(",") if o.strip()]
    if origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )


_configure_middleware(app)

app.include_router(auth_router)
app.include_router(cloud_meta_router)
app.include_router(cloud_vdsina_router)


@app.get("/api/presets")
async def api_presets():
    return list_presets()


@app.get("/api/servers")
async def api_servers_list():
    return [s.model_dump(mode="json") for s in await list_servers()]


@app.get("/api/servers/{server_id}")
async def api_server_get(server_id: str):
    s = await get_server(server_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Сервер не найден")
    return s.model_dump(mode="json")


@app.post("/api/servers")
async def api_server_create(body: StoredServerCreate):
    s = await create_server(body)
    return s.model_dump(mode="json")


@app.put("/api/servers/{server_id}")
async def api_server_put(server_id: str, body: StoredServerUpdate):
    s = await update_server(server_id, body)
    if s is None:
        raise HTTPException(status_code=404, detail="Сервер не найден")
    return s.model_dump(mode="json")


@app.delete("/api/servers/{server_id}")
async def api_server_delete(server_id: str):
    if not await delete_server(server_id):
        raise HTTPException(status_code=404, detail="Сервер не найден")
    return {"ok": True}


@app.post("/api/ssh-test")
async def api_ssh_test(body: SSHTestRequest):
    try:
        ok, msg = await ssh_connect_test(body.ssh)
        return {"ok": ok, "message": msg}
    except Exception as e:
        return {"ok": False, "message": str(e)}


@app.post("/api/metrics/snapshot")
async def api_metrics_snapshot(body: MetricsSnapshotRequest):
    """SSH → http://127.0.0.1:<metrics_port>/metrics на сервере, парсинг и запись в историю (48 ч)."""
    s = await get_server(body.server_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Сервер не найден")
    ok, msg, raw = await fetch_remote_prometheus_metrics(s.to_ssh_auth(), body.metrics_port)
    if not ok:
        return {
            "ok": False,
            "message": msg,
            "preview": (raw or "")[:800] or None,
        }
    rec = await append_snapshot(body.server_id, raw)
    parsed = parse_prometheus_sample_lines(raw)
    cards = build_stats_cards(parsed)
    hist = await list_history(body.server_id)
    metrics_json = {k: float(v) for k, v in parsed.items()}
    return {
        "ok": True,
        "message": msg,
        "t": rec["t"],
        "cards": cards,
        "points_total": len(hist),
        "metrics_series": len(rec["m"]),
        "metrics": metrics_json,
    }


@app.get("/api/metrics/history")
async def api_metrics_history(server_id: str):
    if not server_id.strip():
        raise HTTPException(status_code=400, detail="server_id обязателен")
    pts = await list_history(server_id.strip())
    last_cards: dict[str, object] | None = None
    if pts:
        m = pts[-1].get("m") or {}
        if isinstance(m, dict) and m:
            parsed = {str(k): float(v) for k, v in m.items() if isinstance(v, (int, float))}
            last_cards = build_stats_cards(parsed)
    return {
        "points": [{"t": p["t"], "m": p.get("m") or {}} for p in pts],
        "last_cards": last_cards,
    }


@app.post("/api/fetch-remote-telemt")
async def api_fetch_remote_telemt(body: SSHTestRequest):
    """Считать /etc/telemt/telemt.toml по SSH (для импорта в форму при добавлении сервера)."""
    try:
        conn_ok, found, msg, cfg = await fetch_telemt_config_from_server(body.ssh)
        return {
            "ok": conn_ok,
            "found": found,
            "message": msg,
            "telemt": cfg.model_dump(mode="json") if cfg is not None else None,
        }
    except Exception as e:
        return {
            "ok": False,
            "found": False,
            "message": str(e),
            "telemt": None,
        }


@app.websocket("/ws/deploy")
async def ws_deploy(ws: WebSocket):
    await ws.accept()
    if not await require_panel_ws_or_close(ws):
        return
    try:
        raw = await ws.receive_text()
        data = json.loads(raw)
        req = DeployRequest.model_validate(data)
    except json.JSONDecodeError as e:
        await ws.send_json({"type": "error", "message": f"JSON: {e}"})
        await ws.close()
        return
    except ValidationError as e:
        await ws.send_json({"type": "error", "message": str(e)})
        await ws.close()
        return
    except WebSocketDisconnect:
        return

    closed = False

    async def send_log(message: str) -> None:
        nonlocal closed
        if closed:
            return
        try:
            await ws.send_json({"type": "log", "message": message})
        except Exception:
            closed = True

    try:
        await run_deploy(req, send_log)
        if not closed:
            await ws.send_json({"type": "done", "ok": True})
    except Exception as e:
        if not closed:
            await ws.send_json({"type": "done", "ok": False, "error": str(e)})
    finally:
        closed = True
        try:
            await ws.close()
        except Exception:
            pass


@app.websocket("/ws/journal")
async def ws_journal(ws: WebSocket):
    await ws.accept()
    if not await require_panel_ws_or_close(ws):
        return
    try:
        raw = await ws.receive_text()
        req = JournalStreamRequest.model_validate(json.loads(raw))
    except json.JSONDecodeError as e:
        await ws.send_json({"type": "error", "message": f"JSON: {e}"})
        await ws.close()
        return
    except ValidationError as e:
        await ws.send_json({"type": "error", "message": str(e)})
        await ws.close()
        return
    except WebSocketDisconnect:
        return

    send_ok = True
    halt = asyncio.Event()

    async def send_log(message: str) -> None:
        nonlocal send_ok
        if not send_ok:
            return
        try:
            await ws.send_json({"type": "log", "message": message})
        except Exception:
            send_ok = False
            halt.set()

    async def client_watcher() -> None:
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            halt.set()

    watcher = asyncio.create_task(client_watcher())
    try:
        await stream_telemt_journal(req.ssh, send_log, halt)
    except Exception as e:
        try:
            await send_log(f"Ошибка: {e}")
        except Exception:
            pass
    finally:
        halt.set()
        watcher.cancel()
        try:
            await watcher
        except asyncio.CancelledError:
            pass
        try:
            await ws.send_json({"type": "done"})
        except Exception:
            pass
        try:
            await ws.close()
        except Exception:
            pass


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def index_page():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
