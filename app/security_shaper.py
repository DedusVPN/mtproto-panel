"""
Доп. шаги в духе «Решалы»: UFW, Fail2Ban, sysctl hardening, шейпер tc
(скачивание: egress HTB; загрузка: ingress → IFB + HTB).
См. обсуждение возможностей: https://github.com/DonMatteoVPN/Reshala-Remnawave-Bedolaga
"""

from __future__ import annotations

import textwrap
from collections.abc import Callable, Coroutine

import asyncssh

from app.schemas import DeployOptions, TelemtConfigPayload

SYSCTL_SECURITY = """# telemt-panel: базовое усиление ядра (IPv4/IPv6, hardlinks)
kernel.dmesg_restrict = 1
kernel.kptr_restrict = 2
kernel.yama.ptrace_scope = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0
"""

FAIL2BAN_JAIL_LOCAL = """# Сгенерировано telemt-panel
[DEFAULT]
bantime = 86400
findtime = 600
maxretry = 3

[sshd]
enabled = true
"""


def _render_shaper_script(
    dl_fast_mbit: int,
    dl_slow_mbit: int,
    ul_fast_mbit: int,
    ul_slow_mbit: int,
    fast_ports: list[int],
) -> str:
    ports_bash = " ".join(str(p) for p in fast_ports)
    return (
        textwrap.dedent(
            """\
        #!/bin/bash
        set -euo pipefail
        IFB=ifb0
        DL_FAST=__DL_FAST__
        DL_SLOW=__DL_SLOW__
        UL_FAST=__UL_FAST__
        UL_SLOW=__UL_SLOW__
        FAST_PORTS="__PORTS__"

        _detect_dev() {
          local d
          d=$(ip -o route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}' || true)
          if [[ -z "${d:-}" ]]; then
            d=$(ip -4 route show default 0.0.0.0/0 2>/dev/null | awk '{print $5}' | head -1)
          fi
          echo "${d:-eth0}"
        }

        if [[ "${1:-}" == "stop" ]]; then
          DEV=$(_detect_dev)
          tc qdisc del dev "$DEV" ingress 2>/dev/null || true
          tc qdisc del dev "$DEV" root 2>/dev/null || true
          tc qdisc del dev "$IFB" root 2>/dev/null || true
          ip link set dev "$IFB" down 2>/dev/null || true
          echo "telemt-panel-shaper: stopped (ingress + egress + $IFB)"
          exit 0
        fi

        modprobe ifb 2>/dev/null || true
        ip link add dev "$IFB" type ifb 2>/dev/null || true
        ip link set dev "$IFB" up

        DEV=$(_detect_dev)
        echo "telemt-panel-shaper: dev=$DEV ifb=$IFB ports=$FAST_PORTS"
        echo "  download (egress):  fast=${DL_FAST}mbit slow=${DL_SLOW}mbit"
        echo "  upload (ingress):   fast=${UL_FAST}mbit slow=${UL_SLOW}mbit"

        tc qdisc del dev "$DEV" ingress 2>/dev/null || true
        tc qdisc del dev "$DEV" root 2>/dev/null || true
        tc qdisc del dev "$IFB" root 2>/dev/null || true

        tc qdisc add dev "$DEV" root handle 1: htb default 30
        tc class add dev "$DEV" parent 1: classid 1:1 htb rate 10gbit ceil 10gbit
        tc class add dev "$DEV" parent 1:1 classid 1:10 htb rate "${DL_FAST}"mbit ceil "${DL_FAST}"mbit prio 1
        tc class add dev "$DEV" parent 1:1 classid 1:30 htb rate "${DL_SLOW}"mbit ceil "${DL_SLOW}"mbit prio 3
        prio=2
        for p in $FAST_PORTS; do
          tc filter add dev "$DEV" parent 1: protocol ip prio "$prio" u32 match ip sport "$p" 0xffff flowid 1:10
          prio=$((prio + 1))
        done

        tc qdisc add dev "$DEV" handle ffff: ingress
        tc filter add dev "$DEV" parent ffff: protocol ip prio 1 u32 match u32 0 0 action mirred egress redirect dev "$IFB"

        tc qdisc add dev "$IFB" root handle 2: htb default 40
        tc class add dev "$IFB" parent 2: classid 2:1 htb rate 10gbit ceil 10gbit
        tc class add dev "$IFB" parent 2:1 classid 2:10 htb rate "${UL_FAST}"mbit ceil "${UL_FAST}"mbit prio 1
        tc class add dev "$IFB" parent 2:1 classid 2:40 htb rate "${UL_SLOW}"mbit ceil "${UL_SLOW}"mbit prio 3
        prio=2
        for p in $FAST_PORTS; do
          tc filter add dev "$IFB" parent 2: protocol ip prio "$prio" u32 match ip dport "$p" 0xffff flowid 2:10
          prio=$((prio + 1))
        done

        echo "telemt-panel-shaper: done"
        """
        )
        .replace("__DL_FAST__", str(dl_fast_mbit))
        .replace("__DL_SLOW__", str(dl_slow_mbit))
        .replace("__UL_FAST__", str(ul_fast_mbit))
        .replace("__UL_SLOW__", str(ul_slow_mbit))
        .replace("__PORTS__", ports_bash)
    )


SHAPER_SERVICE = """[Unit]
Description=Telemt panel traffic shaper (download egress + upload IFB)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/telemt-panel-shaper.sh
ExecStop=/usr/local/sbin/telemt-panel-shaper.sh stop

[Install]
WantedBy=multi-user.target
"""


async def run_extra_packages(
    conn: asyncssh.SSHClientConnection,
    log: Callable[[str], Coroutine[None, None, None] | None],
    *,
    as_root: bool,
    run_shell_impl,
) -> None:
    await run_shell_impl(
        conn,
        "export DEBIAN_FRONTEND=noninteractive; apt-get install -y ufw fail2ban iproute2",
        log,
        as_root=as_root,
    )


async def apply_kernel_hardening(
    conn: asyncssh.SSHClientConnection,
    sftp: asyncssh.SFTPClient,
    log: Callable[[str], Coroutine[None, None, None] | None],
    *,
    as_root: bool,
    push_file,
    run_shell_impl,
) -> None:
    await log("--- kernel hardening (sysctl) ---")
    await push_file(
        conn,
        sftp,
        "/etc/sysctl.d/98-telemt-security-hardening.conf",
        SYSCTL_SECURITY,
        0o644,
        log,
        as_root=as_root,
    )
    await run_shell_impl(
        conn,
        "sysctl -p /etc/sysctl.d/98-telemt-security-hardening.conf",
        log,
        as_root=as_root,
    )


async def apply_fail2ban(
    conn: asyncssh.SSHClientConnection,
    sftp: asyncssh.SFTPClient,
    log: Callable[[str], Coroutine[None, None, None] | None],
    *,
    as_root: bool,
    push_file,
    run_shell_impl,
) -> None:
    await log("--- Fail2Ban (bantime=24h, maxretry=3, findtime=600) ---")
    await push_file(
        conn,
        sftp,
        "/etc/fail2ban/jail.local",
        FAIL2BAN_JAIL_LOCAL,
        0o644,
        log,
        as_root=as_root,
    )
    await run_shell_impl(conn, "systemctl enable fail2ban", log, as_root=as_root)
    await run_shell_impl(conn, "systemctl restart fail2ban", log, as_root=as_root)
    await run_shell_impl(
        conn, "systemctl --no-pager -l status fail2ban || true", log, as_root=as_root
    )


async def apply_ufw(
    conn: asyncssh.SSHClientConnection,
    log: Callable[[str], Coroutine[None, None, None] | None],
    *,
    as_root: bool,
    ssh_port: int,
    open_tcp_ports: list[int],
    run_shell_impl,
) -> None:
    await log("--- UFW: политика по умолчанию, SSH и сервисные порты, затем enable ---")
    await run_shell_impl(conn, "ufw default deny incoming", log, as_root=as_root)
    await run_shell_impl(conn, "ufw default allow outgoing", log, as_root=as_root)
    # Сначала SSH, чтобы не потерять сессию
    await run_shell_impl(
        conn,
        f"ufw allow {int(ssh_port)}/tcp comment 'ssh telemt-panel'",
        log,
        as_root=as_root,
    )
    seen = {int(ssh_port)}
    for p in open_tcp_ports:
        p = int(p)
        if p in seen:
            continue
        seen.add(p)
        await run_shell_impl(
            conn,
            f"ufw allow {p}/tcp comment 'telemt-panel'",
            log,
            as_root=as_root,
        )
    await run_shell_impl(conn, "ufw --force enable", log, as_root=as_root)
    await run_shell_impl(conn, "ufw status verbose || true", log, as_root=as_root)


async def apply_traffic_shaper(
    conn: asyncssh.SSHClientConnection,
    sftp: asyncssh.SFTPClient,
    log: Callable[[str], Coroutine[None, None, None] | None],
    *,
    as_root: bool,
    dl_fast_mbit: int,
    dl_slow_mbit: int,
    ul_fast_mbit: int,
    ul_slow_mbit: int,
    fast_ports: list[int],
    push_file,
    run_shell_impl,
) -> None:
    await log(
        f"--- шейпер tc: скачивание egress fast/slow {dl_fast_mbit}/{dl_slow_mbit} Mbit/s; "
        f"загрузка IFB fast/slow {ul_fast_mbit}/{ul_slow_mbit} Mbit/s; порты {fast_ports} ---"
    )
    script = _render_shaper_script(
        dl_fast_mbit, dl_slow_mbit, ul_fast_mbit, ul_slow_mbit, fast_ports
    )
    await push_file(
        conn,
        sftp,
        "/usr/local/sbin/telemt-panel-shaper.sh",
        script,
        0o755,
        log,
        as_root=as_root,
    )
    await push_file(
        conn,
        sftp,
        "/etc/systemd/system/telemt-panel-shaper.service",
        SHAPER_SERVICE,
        0o644,
        log,
        as_root=as_root,
    )
    await run_shell_impl(conn, "systemctl daemon-reload", log, as_root=as_root)
    await run_shell_impl(
        conn,
        "systemctl enable telemt-panel-shaper.service",
        log,
        as_root=as_root,
    )
    await run_shell_impl(
        conn,
        "systemctl restart telemt-panel-shaper.service",
        log,
        as_root=as_root,
    )
    await run_shell_impl(
        conn,
        "systemctl --no-pager -l status telemt-panel-shaper.service || true",
        log,
        as_root=as_root,
    )


def _api_listen_port(cfg: TelemtConfigPayload) -> int | None:
    """Порт API, если слушает 0.0.0.0 / все интерфейсы — для UFW."""
    raw = (cfg.api_listen or "").strip()
    if not raw:
        return None
    if raw.startswith("127.") or raw.startswith("localhost") or raw.startswith("[::1]"):
        return None
    try:
        return int(raw.rsplit(":", 1)[-1])
    except ValueError:
        return None


def ufw_tcp_ports_from_config(
    cfg: TelemtConfigPayload, ssh_port: int, extra: list[int]
) -> list[int]:
    ports = {80, 8080, 8443, int(cfg.server_port)}
    api_p = _api_listen_port(cfg)
    if api_p is not None:
        ports.add(api_p)
    ports.add(int(cfg.metrics_port))
    for p in extra:
        ports.add(int(p))
    ports.add(int(ssh_port))
    return sorted(ports)


async def maybe_run_security_stack(
    conn: asyncssh.SSHClientConnection,
    sftp: asyncssh.SFTPClient,
    log: Callable[[str], Coroutine[None, None, None] | None],
    *,
    as_root: bool,
    opts: DeployOptions,
    cfg: TelemtConfigPayload,
    ssh_port: int,
    push_file,
    run_shell_impl,
) -> None:
    if not (
        opts.install_ufw
        or opts.install_fail2ban
        or opts.kernel_hardening_sysctl
        or opts.install_traffic_shaper
    ):
        return

    need_pkg = (
        opts.install_ufw
        or opts.install_fail2ban
        or opts.install_traffic_shaper
    )
    if need_pkg:
        await run_extra_packages(conn, log, as_root=as_root, run_shell_impl=run_shell_impl)

    if opts.kernel_hardening_sysctl:
        await apply_kernel_hardening(
            conn, sftp, log, as_root=as_root, push_file=push_file, run_shell_impl=run_shell_impl
        )

    if opts.install_fail2ban:
        await apply_fail2ban(
            conn, sftp, log, as_root=as_root, push_file=push_file, run_shell_impl=run_shell_impl
        )

    if opts.install_ufw:
        extra = list(opts.ufw_extra_tcp_ports or [])
        open_ports = ufw_tcp_ports_from_config(cfg, ssh_port, extra)
        await apply_ufw(
            conn,
            log,
            as_root=as_root,
            ssh_port=ssh_port,
            open_tcp_ports=open_ports,
            run_shell_impl=run_shell_impl,
        )

    if opts.install_traffic_shaper:
        dl_f = max(1, int(round(opts.shaper_download_fast_mbytes_per_sec * 8)))
        dl_s = max(1, int(round(opts.shaper_download_slow_mbytes_per_sec * 8)))
        ul_f = max(1, int(round(opts.shaper_upload_fast_mbytes_per_sec * 8)))
        ul_s = max(1, int(round(opts.shaper_upload_slow_mbytes_per_sec * 8)))
        ports = list(opts.shaper_fast_tcp_ports)
        await apply_traffic_shaper(
            conn,
            sftp,
            log,
            as_root=as_root,
            dl_fast_mbit=dl_f,
            dl_slow_mbit=dl_s,
            ul_fast_mbit=ul_f,
            ul_slow_mbit=ul_s,
            fast_ports=ports,
            push_file=push_file,
            run_shell_impl=run_shell_impl,
        )
