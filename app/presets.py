"""Пресеты настроек Telemt (без SSH). Первый — значения из instr.txt."""

from __future__ import annotations

from typing import Any

PRESETS: list[dict[str, Any]] = [
    {
        "id": "instr-example",
        "label": "Как в instr.txt (пример)",
        "telemt": {
            "public_host": "free3.dedus.pro",
            "public_port": 443,
            "server_port": 443,
            "metrics_port": 9090,
            "api_listen": "127.0.0.1:9091",
            "tls_domain": "petrovich.ru",
            "ad_tag": "eed658964f794738117e42c2157e5a09",
            "users": [
                {"username": "free", "secret_hex": "f97fccdfa1bf4c0de586e6282f07778c"},
            ],
            "mode_classic": False,
            "mode_secure": False,
            "mode_tls": True,
            "log_level": "normal",
            "metrics_whitelist": ["127.0.0.1/32", "::1/128", "0.0.0.0/0"],
            "api_whitelist": ["127.0.0.1/32", "::1/128"],
        },
        "options": {
            "apt_update_upgrade": True,
            "sysctl_file_limits": True,
            "sysctl_network": True,
            "download_binary": True,
            "install_systemd": True,
            "start_and_enable_service": True,
            "verify_api": True,
            "binary_path": "/bin/telemt",
            "install_ufw": False,
            "install_fail2ban": False,
            "kernel_hardening_sysctl": False,
            "install_traffic_shaper": False,
        },
    },
    {
        "id": "local-metrics",
        "label": "Метрики только с localhost",
        "telemt": {
            "public_host": "proxy.example.com",
            "public_port": 443,
            "server_port": 443,
            "metrics_port": 9090,
            "api_listen": "127.0.0.1:9091",
            "tls_domain": "www.cloudflare.com",
            "ad_tag": "0123456789abcdef0123456789abcdef",
            "users": [
                {"username": "user1", "secret_hex": "fedcba9876543210fedcba9876543210"},
            ],
            "mode_classic": False,
            "mode_secure": False,
            "mode_tls": True,
            "log_level": "normal",
            "metrics_whitelist": ["127.0.0.1/32", "::1/128"],
            "api_whitelist": ["127.0.0.1/32", "::1/128"],
        },
        "options": {
            "apt_update_upgrade": True,
            "sysctl_file_limits": True,
            "sysctl_network": True,
            "download_binary": True,
            "install_systemd": True,
            "start_and_enable_service": True,
            "verify_api": True,
            "binary_path": "/usr/local/bin/telemt",
            "install_ufw": False,
            "install_fail2ban": False,
            "kernel_hardening_sysctl": False,
            "install_traffic_shaper": False,
        },
    },
]


def list_presets() -> list[dict[str, Any]]:
    return PRESETS
