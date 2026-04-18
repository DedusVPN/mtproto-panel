from __future__ import annotations

import json
from typing import Any

from app.cloudflare_schemas import CloudflareDnsTarget
from app.cloudflare_settings import CloudflareSettings


def parse_dns_targets_payload(raw: str | bytes) -> list[CloudflareDnsTarget]:
    data: Any = json.loads(raw)
    if isinstance(data, dict) and "records" in data:
        data = data["records"]
    if not isinstance(data, list):
        raise ValueError("Ожидался JSON-массив или объект с ключом «records»")
    return [CloudflareDnsTarget.model_validate(x) for x in data]


def load_dns_targets_from_settings(s: CloudflareSettings) -> list[CloudflareDnsTarget]:
    """Цели из CLOUDFLARE_DNS_TARGETS_JSON или файла CLOUDFLARE_DNS_TARGETS_FILE (файл перекрывает JSON)."""
    if s.dns_targets_file is not None and s.dns_targets_file.is_file():
        return parse_dns_targets_payload(s.dns_targets_file.read_text(encoding="utf-8-sig"))
    j = (s.dns_targets_json or "").strip()
    if not j:
        return []
    return parse_dns_targets_payload(j)
