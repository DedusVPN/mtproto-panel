from __future__ import annotations

import asyncio
import os
import struct


def _build_tls_client_hello() -> bytes:
    """
    Строит минимальный TLS 1.2/1.3 ClientHello для зондирования MTProto-прокси.

    Telemt в TLS-режиме при получении ClientHello без корректного HMAC-секрета:
      - либо форвардит соединение на настроенный TLS-домен → присылает ServerHello (0x16)
      - либо закрывает соединение с TLS Alert (0x15) или чистым EOF

    Любой другой сервис (SSH, HTTP, VPN) ответит нетипичными данными или RST.
    """
    random_bytes = os.urandom(32)

    cipher_suites = bytes([
        0x13, 0x01,  # TLS_AES_128_GCM_SHA256       (TLS 1.3)
        0x13, 0x02,  # TLS_AES_256_GCM_SHA384        (TLS 1.3)
        0x13, 0x03,  # TLS_CHACHA20_POLY1305_SHA256  (TLS 1.3)
        0x00, 0x2f,  # TLS_RSA_WITH_AES_128_CBC_SHA
        0x00, 0x35,  # TLS_RSA_WITH_AES_256_CBC_SHA
        0xc0, 0x2b,  # TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
        0xc0, 0x2f,  # TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
    ])

    sv_data = b'\x04\x03\x04\x03\x03'
    ext_supported_versions = b'\x00\x2b' + struct.pack('>H', len(sv_data)) + sv_data

    sg_list = b'\x00\x17\x00\x18\x00\x19'
    sg_data = struct.pack('>H', len(sg_list)) + sg_list
    ext_supported_groups = b'\x00\x0a' + struct.pack('>H', len(sg_data)) + sg_data

    epf_data = b'\x01\x00'
    ext_ec_point_formats = b'\x00\x0b' + struct.pack('>H', len(epf_data)) + epf_data

    extensions = ext_supported_versions + ext_supported_groups + ext_ec_point_formats

    body = (
        b'\x03\x03'
        + random_bytes
        + b'\x00'
        + struct.pack('>H', len(cipher_suites)) + cipher_suites
        + b'\x01\x00'
        + struct.pack('>H', len(extensions)) + extensions
    )

    handshake = b'\x01' + len(body).to_bytes(3, 'big') + body
    return b'\x16\x03\x01' + struct.pack('>H', len(handshake)) + handshake


async def check_proxy_port(host: str, port: int, timeout: float) -> tuple[bool, str]:
    """
    Проверяет доступность MTProto-прокси через TLS-зонд.

    Критерии UP:
      - Получен TLS ServerHello (первый байт 0x16) — прокси форвардит на реальный HTTPS
      - Получен TLS Alert (первый байт 0x15) — прокси сбросил соединение через TLS
      - EOF (пустые данные) — прокси принял наш пакет и закрыл соединение (valid drop)

    Критерии DOWN:
      - Отказ подключения / таймаут connect — прокси не слушает
      - Получены не-TLS данные (SSH, HTTP и др.) — на порту другой сервис
      - Таймаут чтения — ничего не ответило за отведённое время
      - ConnectionResetError при чтении — удалённая сторона прислала RST
        (нетипичное поведение для Telemt, признак другого сервиса)
    """
    read_timeout = min(timeout, 8.0)

    # ── 1. TCP-подключение ────────────────────────────────────────────────────
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        return False, f"Таймаут подключения ({timeout:.0f} с)"
    except OSError as e:
        return False, str(e)
    except Exception as e:
        return False, str(e)

    # ── 2. Отправка TLS ClientHello ───────────────────────────────────────────
    try:
        writer.write(_build_tls_client_hello())
        await asyncio.wait_for(writer.drain(), timeout=5.0)
    except Exception as e:
        _close_writer(writer)
        return False, f"Ошибка отправки зонда: {e}"

    # ── 3. Чтение ответа ──────────────────────────────────────────────────────
    try:
        data = await asyncio.wait_for(reader.read(512), timeout=read_timeout)
    except asyncio.TimeoutError:
        _close_writer(writer)
        return False, "Нет ответа на TLS-зонд (таймаут)"
    except ConnectionResetError:
        _close_writer(writer)
        return False, "Соединение сброшено (RST) — не TLS-прокси"
    except OSError as e:
        _close_writer(writer)
        return False, str(e)
    except Exception as e:
        _close_writer(writer)
        return False, f"Ошибка чтения: {e}"

    _close_writer(writer)

    # ── 4. Разбор ответа ──────────────────────────────────────────────────────
    if not data:
        # EOF: прокси принял наш ClientHello и закрыл соединение без данных.
        # Telemt делает именно так, когда не может верифицировать секрет
        # и не имеет настроенного fallback-домена.
        return True, "ok (прокси закрыл соединение после зонда)"

    first = data[0]

    if first == 0x16:
        # TLS Handshake (ServerHello) — прокси форвардит на реальный HTTPS
        return True, "ok (TLS ServerHello)"

    if first == 0x15:
        # TLS Alert — прокси сбросил handshake по TLS
        level = data[1] if len(data) > 1 else 0
        desc = data[2] if len(data) > 2 else 0
        level_s = "fatal" if level == 2 else "warning"
        return True, f"ok (TLS Alert {level_s} {desc:#04x})"

    # Не-TLS ответ: SSH ("SSH-"), HTTP ("HTTP"), и т.д.
    preview = data[:16].hex()
    return False, f"Не TLS-прокси на порту (ответ: {preview}…)"


def _close_writer(writer: asyncio.StreamWriter) -> None:
    try:
        writer.close()
    except Exception:
        pass
