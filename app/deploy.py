from __future__ import annotations

import asyncio
import json
import re
import secrets
import shlex
from collections.abc import Callable, Coroutine
from pathlib import Path

import asyncssh
from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.schemas import DeployOptions, DeployRequest, SSHAuth, TelemtConfigPayload
from app.security_shaper import maybe_run_security_stack
from app.ssh_conn import build_asyncssh_connect_kwargs

MARKER_SYSCTL_MAIN_BEGIN = "# telemt-panel: file limits begin"
MARKER_SYSCTL_MAIN_END = "# telemt-panel: file limits end"
MARKER_LIMITS_BEGIN = "# telemt-panel: limits begin"
MARKER_LIMITS_END = "# telemt-panel: limits end"

STAGE_ROOT = "/tmp/telemt-panel-stage"

SYSCTL_MAIN_SNIPPET = """fs.file-max = 2097152
fs.nr_open = 2097152"""

SYSCTL_HIGHLOAD = """net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_syncookies = 1

net.ipv4.ip_local_port_range = 10000 65535
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_max_tw_buckets = 2000000

net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5

net.core.rmem_default = 262144
net.core.wmem_default = 262144
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

net.netfilter.nf_conntrack_max = 2097152
net.netfilter.nf_conntrack_tcp_timeout_established = 3600
net.netfilter.nf_conntrack_tcp_timeout_time_wait = 12
"""

LIMITS_SNIPPET = """* soft nofile 1048576
* hard nofile 1048576
telemt soft nofile 1048576
telemt hard nofile 1048576"""


def _templates_dir() -> Path:
    return Path(__file__).resolve().parent / "templates"


def render_telemt_toml(cfg: TelemtConfigPayload) -> str:
    env = Environment(
        loader=FileSystemLoader(_templates_dir()),
        autoescape=select_autoescape(enabled_extensions=()),
    )
    tpl = env.get_template("telemt.toml.j2")
    users = [
        {"username": u.username, "secret_hex": u.secret_hex.lower()} for u in cfg.users
    ]
    return tpl.render(
        ad_tag=cfg.ad_tag.lower(),
        log_level=cfg.log_level,
        public_host=cfg.public_host,
        public_port=cfg.public_port,
        server_port=cfg.server_port,
        metrics_port=cfg.metrics_port,
        api_listen=cfg.api_listen,
        tls_domain=cfg.tls_domain,
        mode_classic=cfg.mode_classic,
        mode_secure=cfg.mode_secure,
        mode_tls=cfg.mode_tls,
        users=users,
        metrics_whitelist_toml=json.dumps(cfg.metrics_whitelist),
        api_whitelist_toml=json.dumps(cfg.api_whitelist),
    )


def render_systemd_unit(telemt_binary: str) -> str:
    env = Environment(
        loader=FileSystemLoader(_templates_dir()),
        autoescape=select_autoescape(enabled_extensions=()),
    )
    tpl = env.get_template("telemt.service.j2")
    return tpl.render(telemt_binary=telemt_binary)


def _elevate(cmd: str, as_root: bool) -> str:
    if as_root:
        return cmd
    return f"sudo -n bash -lc {shlex.quote(cmd)}"


def _ssh_out_as_str(chunk: bytes | str | None) -> str:
    """AsyncSSH в разных версиях отдаёт из процессов и bytes, и str."""
    if chunk is None:
        return ""
    if isinstance(chunk, str):
        return chunk
    if isinstance(chunk, memoryview):
        return bytes(chunk).decode(errors="replace")
    return chunk.decode(errors="replace")


def _completed_returncode(completed: object) -> int:
    """AsyncSSH 2.22+: wait() возвращает SSHCompletedProcess, не int."""
    if isinstance(completed, int):
        return completed
    rc = getattr(completed, "returncode", None)
    if rc is None:
        return 0
    return int(rc)


async def _run_plain_capture(conn: asyncssh.SSHClientConnection, cmd: str) -> tuple[str, int]:
    async with conn.create_process(cmd) as proc:
        completed = await proc.wait()
    return _ssh_out_as_str(completed.stdout), _completed_returncode(completed)


async def _run_shell_capture(conn: asyncssh.SSHClientConnection, cmd: str, *, as_root: bool) -> tuple[str, int]:
    full = _elevate(cmd, as_root)
    async with conn.create_process(full) as proc:
        completed = await proc.wait()
    return _ssh_out_as_str(completed.stdout), _completed_returncode(completed)


async def _run_shell(
    conn: asyncssh.SSHClientConnection,
    cmd: str,
    log: Callable[[str], Coroutine[None, None, None] | None],
    *,
    as_root: bool,
) -> None:
    full = _elevate(cmd, as_root)
    await log(f"$ {full}")
    async with conn.create_process(full) as proc:
        async def _drain(stream: asyncio.StreamReader | None, prefix: str) -> None:
            if stream is None:
                return
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = _ssh_out_as_str(line).rstrip()
                if text:
                    await log(f"{prefix}{text}")

        await asyncio.wait(
            [
                asyncio.create_task(_drain(proc.stdout, "")),
                asyncio.create_task(_drain(proc.stderr, "stderr: ")),
            ]
        )
        completed = await proc.wait()
        code = _completed_returncode(completed)
        if code != 0:
            raise RuntimeError(f"Команда завершилась с кодом {code}: {full}")


async def _push_file(
    conn: asyncssh.SSHClientConnection,
    sftp: asyncssh.SFTPClient,
    remote_final: str,
    content: str,
    mode: int,
    log: Callable[[str], Coroutine[None, None, None] | None],
    *,
    as_root: bool,
) -> None:
    await _run_shell(conn, f"mkdir -p {shlex.quote(STAGE_ROOT)}", log, as_root=False)
    name = secrets.token_hex(8)
    staging = f"{STAGE_ROOT}/{name}"
    async with sftp.open(staging, "w") as f:
        # Текстовый режим ("w"): AsyncSSH сам кодирует str; bytes → ошибка .encode
        await f.write(content)
    await sftp.chmod(staging, mode & 0o777)
    q_s = shlex.quote(staging)
    q_d = shlex.quote(remote_final)
    mo = oct(mode)[2:]
    install_cmd = f"install -m {mo} {q_s} {q_d}"
    await _run_shell(conn, install_cmd, log, as_root=as_root)
    await _run_shell(conn, f"rm -f {q_s}", log, as_root=False)


async def _ensure_block_in_file(
    conn: asyncssh.SSHClientConnection,
    sftp: asyncssh.SFTPClient,
    path: str,
    begin: str,
    end: str,
    body: str,
    log: Callable[[str], Coroutine[None, None, None] | None],
    *,
    as_root: bool,
) -> None:
    out, rc = await _run_shell_capture(conn, f"cat {shlex.quote(path)}", as_root=as_root)
    current = out if rc == 0 else ""
    if begin in current and end in current:
        await log(f"Фрагмент уже есть в {path}, пропуск.")
        return
    block = f"\n{begin}\n{body.strip()}\n{end}\n"
    new_content = current.rstrip() + block
    if not new_content.endswith("\n"):
        new_content += "\n"
    await _push_file(conn, sftp, path, new_content, 0o644, log, as_root=as_root)
    await log(f"Обновлён {path}")


async def _remote_user_exists(conn: asyncssh.SSHClientConnection, user: str) -> bool:
    async with conn.create_process(f"getent passwd {shlex.quote(user)}") as proc:
        completed = await proc.wait()
    return _completed_returncode(completed) == 0 and bool(
        _ssh_out_as_str(completed.stdout).strip()
    )


async def ssh_connect_test(ssh: SSHAuth) -> tuple[bool, str]:
    kwargs = build_asyncssh_connect_kwargs(ssh)
    async with asyncssh.connect(**kwargs) as conn:
        out, rc = await _run_plain_capture(conn, "uname -a")
        if rc != 0:
            return False, f"uname -a завершился с кодом {rc}"
        return True, out.strip()


async def run_deploy(
    req: DeployRequest,
    log: Callable[[str], Coroutine[None, None, None]],
) -> None:
    ssh = req.ssh
    opts: DeployOptions = req.options
    cfg: TelemtConfigPayload = req.telemt

    conn_kw = build_asyncssh_connect_kwargs(ssh)

    await log(f"Подключение к {ssh.username}@{ssh.host}:{ssh.port} …")
    async with asyncssh.connect(**conn_kw) as conn:
        as_root = ssh.username == "root"
        if not as_root:
            await log(
                "Пользователь не root: для записи в /etc используется sudo -n (нужен NOPASSWD)."
            )
            await _run_shell(conn, "true", log, as_root=False)

        async with conn.start_sftp_client() as sftp:
            if opts.apt_update_upgrade:
                await log("--- apt update && apt upgrade ---")
                await _run_shell(
                    conn,
                    "export DEBIAN_FRONTEND=noninteractive; "
                    "apt-get update -y && apt-get upgrade -y",
                    log,
                    as_root=as_root,
                )

            if opts.sysctl_file_limits:
                await log("--- sysctl file limits (/etc/sysctl.conf) ---")
                await _ensure_block_in_file(
                    conn,
                    sftp,
                    "/etc/sysctl.conf",
                    MARKER_SYSCTL_MAIN_BEGIN,
                    MARKER_SYSCTL_MAIN_END,
                    SYSCTL_MAIN_SNIPPET,
                    log,
                    as_root=as_root,
                )

            if opts.sysctl_network:
                await log("--- /etc/sysctl.d/99-telemt-highload.conf ---")
                await _push_file(
                    conn,
                    sftp,
                    "/etc/sysctl.d/99-telemt-highload.conf",
                    SYSCTL_HIGHLOAD,
                    0o644,
                    log,
                    as_root=as_root,
                )
                await log("Запись sysctl highload завершена.")

                await log("--- /etc/security/limits.conf ---")
                await _ensure_block_in_file(
                    conn,
                    sftp,
                    "/etc/security/limits.conf",
                    MARKER_LIMITS_BEGIN,
                    MARKER_LIMITS_END,
                    LIMITS_SNIPPET,
                    log,
                    as_root=as_root,
                )

                await log(
                    "--- применение sysctl (drop-in + /etc/sysctl.conf; исправление к инструкции) ---"
                )
                await _run_shell(
                    conn,
                    "sysctl -p /etc/sysctl.d/99-telemt-highload.conf && sysctl -p /etc/sysctl.conf",
                    log,
                    as_root=as_root,
                )

            work = "/tmp/telemt-panel-install"
            if opts.download_binary:
                await log("--- загрузка telemt (latest release) ---")
                await _run_shell(conn, f"rm -rf {work} && mkdir -p {work}", log, as_root=as_root)
                dl = (
                    f"cd {shlex.quote(work)} && wget -qO- "
                    '"https://github.com/telemt/telemt/releases/latest/download/'
                    'telemt-$(uname -m)-linux-$(ldd --version 2>&1 | grep -iq musl && echo musl || echo gnu).tar.gz" '
                    "| tar -xz"
                )
                await _run_shell(conn, dl, log, as_root=as_root)
                bin_src = f"{work}/telemt"
                await _run_shell(conn, f"test -f {shlex.quote(bin_src)}", log, as_root=as_root)
                dest = opts.binary_path
                await _run_shell(
                    conn,
                    f"install -m 0755 {shlex.quote(bin_src)} {shlex.quote(dest)}",
                    log,
                    as_root=as_root,
                )
                await _run_shell(conn, f"rm -rf {work}", log, as_root=as_root)

            await log("--- /etc/telemt ---")
            await _run_shell(conn, "mkdir -p /etc/telemt", log, as_root=as_root)

            toml_content = render_telemt_toml(cfg)
            await _push_file(
                conn, sftp, "/etc/telemt/telemt.toml", toml_content, 0o644, log, as_root=as_root
            )
            await log("Записан /etc/telemt/telemt.toml")

            await log("--- пользователь telemt ---")
            exists = await _remote_user_exists(conn, "telemt")
            if not exists:
                await _run_shell(
                    conn,
                    "useradd -d /opt/telemt -m -r -U telemt",
                    log,
                    as_root=as_root,
                )
            else:
                await log("Пользователь telemt уже существует.")

            await _run_shell(
                conn, "chown -R telemt:telemt /etc/telemt", log, as_root=as_root
            )

            if opts.install_systemd:
                await log("--- systemd unit ---")
                unit = render_systemd_unit(opts.binary_path)
                await _push_file(
                    conn,
                    sftp,
                    "/etc/systemd/system/telemt.service",
                    unit,
                    0o644,
                    log,
                    as_root=as_root,
                )

            if opts.start_and_enable_service:
                await _run_shell(conn, "systemctl daemon-reload", log, as_root=as_root)
                await _run_shell(conn, "systemctl enable telemt", log, as_root=as_root)
                await _run_shell(conn, "systemctl restart telemt", log, as_root=as_root)
                await _run_shell(
                    conn,
                    "systemctl --no-pager -l status telemt || true",
                    log,
                    as_root=as_root,
                )

            if opts.verify_api:
                await log("--- проверка API пользователей ---")
                host_port = cfg.api_listen.strip()
                if re.match(r"^\d+\.\d+\.\d+\.\d+:\d+$", host_port):
                    curl_host = host_port
                elif host_port.startswith("[") and "]:" in host_port:
                    curl_host = host_port
                else:
                    port = host_port.split(":")[-1]
                    curl_host = f"127.0.0.1:{port}"
                curl_url = f"http://{curl_host}/v1/users"
                await _run_shell(
                    conn,
                    f"curl -sS --max-time 15 {shlex.quote(curl_url)} | head -c 8000 || true",
                    log,
                    as_root=as_root,
                )

            await maybe_run_security_stack(
                conn,
                sftp,
                log,
                as_root=as_root,
                opts=opts,
                cfg=cfg,
                ssh_port=ssh.port,
                push_file=_push_file,
                run_shell_impl=_run_shell,
            )

        await log("Готово.")


async def stream_telemt_journal(
    ssh: SSHAuth,
    send_line: Callable[[str], Coroutine[None, None, None] | None],
    halt: asyncio.Event,
) -> None:
    """Поток journalctl -f -u telemt; останавливается по halt или EOF."""
    kwargs = build_asyncssh_connect_kwargs(ssh)
    await send_line(f"SSH {ssh.username}@{ssh.host}:{ssh.port} — live journalctl -u telemt")
    async with asyncssh.connect(**kwargs) as conn:
        as_root = ssh.username == "root"
        cmd = "journalctl -f -n 300 --no-pager -o short-iso -u telemt"
        full = _elevate(cmd, as_root)
        await send_line(f"$ {full}")
        async with conn.create_process(full) as proc:

            async def drain_stderr() -> None:
                stream = proc.stderr
                if stream is None:
                    return
                while not halt.is_set():
                    try:
                        line = await asyncio.wait_for(stream.readline(), timeout=0.5)
                    except asyncio.TimeoutError:
                        continue
                    if not line:
                        break
                    t = _ssh_out_as_str(line).rstrip()
                    if t:
                        try:
                            await send_line(f"stderr: {t}")
                        except Exception:
                            return

            err_task = asyncio.create_task(drain_stderr())
            try:
                stream = proc.stdout
                if stream is None:
                    return
                while not halt.is_set():
                    try:
                        line = await asyncio.wait_for(stream.readline(), timeout=0.5)
                    except asyncio.TimeoutError:
                        continue
                    if not line:
                        try:
                            await send_line("[journalctl: конец потока]")
                        except Exception:
                            pass
                        break
                    t = _ssh_out_as_str(line).rstrip()
                    if t:
                        try:
                            await send_line(t)
                        except Exception:
                            halt.set()
                            break
            finally:
                err_task.cancel()
                try:
                    await err_task
                except asyncio.CancelledError:
                    pass
