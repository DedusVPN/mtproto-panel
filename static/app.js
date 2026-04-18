(function () {
  const $ = (id) => document.getElementById(id);
  const logEl = $("log");

  async function authFetch(input, init) {
    const r = await fetch(input, { ...init, credentials: "include" });
    if (r.status === 401) {
      try {
        const st = await fetch("/api/auth/status", { credentials: "include" });
        const sj = await st.json();
        const u = String(input);
        if (
          sj.auth_required &&
          u.indexOf("/api/auth/login") === -1 &&
          u.indexOf("/api/auth/me") === -1 &&
          u.indexOf("/api/auth/status") === -1
        ) {
          window.location.reload();
        }
      } catch (_) {
        /* ignore */
      }
    }
    return r;
  }
  const journalLogEl = $("journal-log");
  const LS_SERVER = "telemt_selected_server_id";
  const LS_VIEW = "telemt_panel_view";
  const LS_STATS_HISTORY_RANGE = "telemt_stats_history_range";

  let statsPollTimer = null;
  const chartHandles = {};
  /** Последний server_id, для которого созданы экземпляры Chart (смена сервера — пересоздание). */
  let statsChartsBoundSid = null;

  let journalWs = null;
  let presetsCache = [];
  let serversListCache = [];
  let selectedServerId = null;
  let selectedServerName = "";

  const dlg = () => $("dlg-server");

  function randomHex32() {
    const u = new Uint8Array(16);
    crypto.getRandomValues(u);
    return Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function appendLog(line) {
    if (logEl.classList.contains("log-empty")) {
      logEl.textContent = "";
      logEl.classList.remove("log-empty");
    }
    logEl.textContent += line + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }

  function clearLog() {
    logEl.textContent = "";
    logEl.classList.add("log-empty");
  }

  function appendJournal(line) {
    if (journalLogEl.classList.contains("log-empty")) {
      journalLogEl.textContent = "";
      journalLogEl.classList.remove("log-empty");
    }
    journalLogEl.textContent += line + "\n";
    journalLogEl.scrollTop = journalLogEl.scrollHeight;
  }

  function clearJournalLog() {
    journalLogEl.textContent = "";
    journalLogEl.classList.add("log-empty");
  }

  function getAuthMode() {
    const r = document.querySelector('input[name="auth-mode"]:checked');
    return r ? r.value : "key";
  }

  function syncAuthUi() {
    const keyMode = getAuthMode() === "key";
    $("auth-key-block").classList.toggle("hidden", !keyMode);
    $("auth-pass-block").classList.toggle("hidden", keyMode);
  }

  function getDlgAuthMode() {
    const r = document.querySelector('input[name="dlg-auth-mode"]:checked');
    return r ? r.value : "key";
  }

  function syncDlgAuthUi() {
    const keyMode = getDlgAuthMode() === "key";
    $("dlg-auth-key-block").classList.toggle("hidden", !keyMode);
    $("dlg-auth-pass-block").classList.toggle("hidden", keyMode);
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function addUserRow(name = "", secret = "") {
    const wrap = $("users-rows");
    const row = document.createElement("div");
    row.className = "user-row";
    row.innerHTML =
      '<div class="field" style="margin:0"><label>Имя</label><input type="text" class="u-name input" placeholder="free" value="' +
      escapeAttr(name) +
      '" /></div>' +
      '<div class="field" style="margin:0"><label>Секрет</label><input type="text" class="u-secret input input-mono" maxlength="32" value="' +
      escapeAttr(secret) +
      '" /></div>' +
      '<button type="button" class="btn btn-secondary btn-sm btn-gen-secret">hex</button>' +
      '<button type="button" class="btn btn-secondary btn-sm rm-user">×</button>';
    row.querySelector(".rm-user").addEventListener("click", () => row.remove());
    row.querySelector(".btn-gen-secret").addEventListener("click", () => {
      row.querySelector(".u-secret").value = randomHex32();
    });
    wrap.appendChild(row);
  }

  function collectUsers() {
    const rows = document.querySelectorAll(".user-row");
    const users = [];
    rows.forEach((r) => {
      const username = r.querySelector(".u-name").value.trim();
      const secret_hex = r.querySelector(".u-secret").value.trim();
      if (username || secret_hex) users.push({ username, secret_hex });
    });
    return users;
  }

  function parsePortListStr(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    return raw
      .split(/[\s,]+/)
      .map((x) => parseInt(x, 10))
      .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 65535);
  }

  function parseJsonArray(id, label) {
    const raw = $(id).value.trim();
    try {
      const v = JSON.parse(raw);
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
        throw new Error("ожидается JSON-массив строк");
      }
      return v;
    } catch (e) {
      throw new Error(label + ": " + e.message);
    }
  }

  async function collectSshAuth() {
    const host = $("ssh-host").value.trim();
    const port = Number($("ssh-port").value) || 22;
    const username = $("ssh-user").value.trim();
    if (!host) throw new Error("Укажите хост SSH");
    if (!username) throw new Error("Укажите пользователя SSH");

    if (getAuthMode() === "key") {
      let pk = $("ssh-key").value.trim();
      if (!pk) {
        const f = $("ssh-key-file").files[0];
        if (f) pk = await f.text();
      }
      if (!pk) throw new Error("Укажите приватный ключ (файл или текст)");
      return {
        host,
        port,
        username,
        private_key: pk,
        private_key_passphrase: $("ssh-key-passphrase").value || null,
        password: null,
      };
    }

    const pw = ($("ssh-password").value || "").trim();
    if (!pw) throw new Error("Укажите пароль SSH");
    return {
      host,
      port,
      username,
      private_key: null,
      password: pw,
      private_key_passphrase: null,
    };
  }

  function applySshToMainForm(s) {
    $("ssh-host").value = s.host || "";
    $("ssh-port").value = s.port ?? 22;
    $("ssh-user").value = s.username || "root";
    $("ssh-key").value = "";
    $("ssh-key-file").value = "";
    $("ssh-key-passphrase").value = s.private_key_passphrase || "";
    $("ssh-password").value = "";

    if (s.auth_mode === "password") {
      document.querySelector('input[name="auth-mode"][value="password"]').checked = true;
      $("ssh-password").value = s.password || "";
    } else {
      document.querySelector('input[name="auth-mode"][value="key"]').checked = true;
      $("ssh-key").value = s.private_key || "";
    }
    syncAuthUi();
  }

  async function buildStoredPayloadFromMainForm(name) {
    const a = await collectSshAuth();
    return {
      name: name.trim(),
      host: a.host,
      port: a.port,
      username: a.username,
      auth_mode: getAuthMode(),
      private_key: a.private_key,
      private_key_passphrase: a.private_key_passphrase || null,
      password: a.password,
    };
  }

  function setActiveServerLabel(text) {
    $("active-server-label").textContent = text || "";
  }

  async function loadServers() {
    const r = await authFetch("/api/servers");
    if (!r.ok) throw new Error(r.statusText);
    serversListCache = await r.json();
    renderServerList();
  }

  function renderServerList() {
    const host = $("server-list");
    host.innerHTML = "";
    serversListCache.forEach((s) => {
      const wrap = document.createElement("div");
      wrap.className = "server-item-wrap";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "server-item" + (s.id === selectedServerId ? " is-active" : "");
      btn.innerHTML =
        '<span class="server-item-name"></span><span class="server-item-host"></span><span class="server-item-meta"></span>';
      btn.querySelector(".server-item-name").textContent = s.name;
      btn.querySelector(".server-item-host").textContent = `${s.host}:${s.port}`;
      btn.querySelector(".server-item-meta").textContent = s.auth_mode === "key" ? "Ключ" : "Пароль";
      btn.title = "Выбрать · двойной клик — редактировать";
      btn.addEventListener("click", () => selectServer(s.id));
      btn.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        openDialogEdit(s.id);
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "server-del";
      del.setAttribute("aria-label", "Удалить");
      del.textContent = "×";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        removeServer(s.id, s.name);
      });

      wrap.appendChild(btn);
      wrap.appendChild(del);
      host.appendChild(wrap);
    });
  }

  async function selectServer(id) {
    selectedServerId = id;
    localStorage.setItem(LS_SERVER, id);
    const onStats = !$("view-stats").classList.contains("hidden");
    if (onStats) {
      void refreshStatsPanel();
    }
    const r = await authFetch("/api/servers/" + encodeURIComponent(id));
    if (!r.ok) {
      selectedServerId = null;
      selectedServerName = "";
      localStorage.removeItem(LS_SERVER);
      setActiveServerLabel("");
      renderServerList();
      return;
    }
    const data = await r.json();
    selectedServerName = data.name || "";
    applySshToMainForm(data);
    setActiveServerLabel("Активен: " + (data.name || data.host));
    renderServerList();
  }

  async function removeServer(id, name) {
    if (!confirm(`Удалить сервер «${name}»?`)) return;
    const r = await authFetch("/api/servers/" + encodeURIComponent(id), { method: "DELETE" });
    if (!r.ok) {
      alert("Не удалось удалить");
      return;
    }
    if (selectedServerId === id) {
      selectedServerId = null;
      selectedServerName = "";
      localStorage.removeItem(LS_SERVER);
      setActiveServerLabel("");
    }
    await loadServers();
  }

  function openDialogNew(prefillFromMain) {
    $("dlg-server-title").textContent = "Новый сервер";
    $("dlg-server-id").value = "";
    $("dlg-fetch-telemt-wrap").classList.remove("hidden");
    $("dlg-fetch-telemt").checked = true;
    if (prefillFromMain) {
      $("dlg-name").value = "";
      $("dlg-host").value = $("ssh-host").value.trim();
      $("dlg-port").value = $("ssh-port").value || 22;
      $("dlg-user").value = $("ssh-user").value.trim() || "root";
      if (getAuthMode() === "password") {
        document.querySelector('input[name="dlg-auth-mode"][value="password"]').checked = true;
        $("dlg-password").value = $("ssh-password").value;
        $("dlg-key").value = "";
        $("dlg-key-pass").value = "";
      } else {
        document.querySelector('input[name="dlg-auth-mode"][value="key"]').checked = true;
        $("dlg-key").value = $("ssh-key").value.trim();
        $("dlg-key-pass").value = $("ssh-key-passphrase").value;
        $("dlg-password").value = "";
      }
    } else {
      $("dlg-name").value = "";
      $("dlg-host").value = "";
      $("dlg-port").value = 22;
      $("dlg-user").value = "root";
      document.querySelector('input[name="dlg-auth-mode"][value="key"]').checked = true;
      $("dlg-key").value = "";
      $("dlg-key-pass").value = "";
      $("dlg-password").value = "";
    }
    syncDlgAuthUi();
    dlg().showModal();
  }

  function dialogBodyToSsh(body) {
    return {
      host: body.host,
      port: body.port,
      username: body.username,
      private_key: body.auth_mode === "key" ? body.private_key : null,
      private_key_passphrase:
        body.auth_mode === "key" ? body.private_key_passphrase || null : null,
      password: body.auth_mode === "password" ? body.password : null,
    };
  }

  function applyTelemtOnly(t) {
    if (!t) return;
    $("public-host").value = t.public_host || "";
    $("public-port").value = t.public_port ?? 443;
    $("server-port").value = t.server_port ?? 443;
    $("metrics-port").value = t.metrics_port ?? 9090;
    $("api-listen").value = t.api_listen || "127.0.0.1:9091";
    $("tls-domain").value = t.tls_domain || "";
    $("ad-tag").value = t.ad_tag || "";
    $("mode-classic").checked = !!t.mode_classic;
    $("mode-secure").checked = !!t.mode_secure;
    $("mode-tls").checked = t.mode_tls !== false;
    $("log-level").value = t.log_level || "normal";
    $("metrics-whitelist").value = JSON.stringify(t.metrics_whitelist || []);
    $("api-whitelist").value = JSON.stringify(t.api_whitelist || []);
    $("users-rows").innerHTML = "";
    (t.users || []).forEach((u) => addUserRow(u.username, u.secret_hex));
    if (!(t.users || []).length) addUserRow("free", randomHex32());
  }

  async function openDialogEdit(id) {
    const r = await authFetch("/api/servers/" + encodeURIComponent(id));
    if (!r.ok) {
      alert("Сервер не найден");
      return;
    }
    const s = await r.json();
    $("dlg-server-title").textContent = "Изменить сервер";
    $("dlg-fetch-telemt-wrap").classList.add("hidden");
    $("dlg-server-id").value = s.id;
    $("dlg-name").value = s.name || "";
    $("dlg-host").value = s.host || "";
    $("dlg-port").value = s.port ?? 22;
    $("dlg-user").value = s.username || "root";
    if (s.auth_mode === "password") {
      document.querySelector('input[name="dlg-auth-mode"][value="password"]').checked = true;
      $("dlg-password").value = s.password || "";
      $("dlg-key").value = "";
      $("dlg-key-pass").value = "";
    } else {
      document.querySelector('input[name="dlg-auth-mode"][value="key"]').checked = true;
      $("dlg-key").value = s.private_key || "";
      $("dlg-key-pass").value = s.private_key_passphrase || "";
      $("dlg-password").value = "";
    }
    syncDlgAuthUi();
    dlg().showModal();
  }

  function closeDialog() {
    dlg().close();
  }

  function collectDialogBody() {
    const name = $("dlg-name").value.trim();
    const host = $("dlg-host").value.trim();
    const port = Number($("dlg-port").value) || 22;
    const username = $("dlg-user").value.trim();
    const mode = getDlgAuthMode();
    if (!name) throw new Error("Укажите название");
    if (!host) throw new Error("Укажите хост");
    if (!username) throw new Error("Укажите пользователя");
    const body = {
      name,
      host,
      port,
      username,
      auth_mode: mode,
      private_key: null,
      private_key_passphrase: $("dlg-key-pass").value || null,
      password: null,
    };
    if (mode === "key") {
      const pk = $("dlg-key").value.trim();
      if (!pk) throw new Error("Вставьте приватный ключ");
      body.private_key = pk;
    } else {
      const pw = $("dlg-password").value.trim();
      if (!pw) throw new Error("Укажите пароль SSH");
      body.password = pw;
    }
    return body;
  }

  function buildPayload() {
    const telemt = {
      public_host: $("public-host").value.trim(),
      public_port: Number($("public-port").value) || 443,
      server_port: Number($("server-port").value) || 443,
      metrics_port: Number($("metrics-port").value) || 9090,
      api_listen: $("api-listen").value.trim(),
      tls_domain: $("tls-domain").value.trim(),
      ad_tag: $("ad-tag").value.trim(),
      users: collectUsers(),
      mode_classic: $("mode-classic").checked,
      mode_secure: $("mode-secure").checked,
      mode_tls: $("mode-tls").checked,
      log_level: $("log-level").value,
      metrics_whitelist: parseJsonArray("metrics-whitelist", "metrics_whitelist"),
      api_whitelist: parseJsonArray("api-whitelist", "api_whitelist"),
    };
    const fastPorts = parsePortListStr($("shaper-ports").value);
    const options = {
      apt_update_upgrade: $("opt-apt").checked,
      sysctl_file_limits: $("opt-sysctl-limits").checked,
      sysctl_network: $("opt-sysctl-net").checked,
      download_binary: $("opt-download").checked,
      install_systemd: $("opt-systemd").checked,
      start_and_enable_service: $("opt-start").checked,
      verify_api: $("opt-verify").checked,
      binary_path: $("binary-path").value,
      install_ufw: $("opt-ufw").checked,
      install_fail2ban: $("opt-fail2ban").checked,
      kernel_hardening_sysctl: $("opt-kernel-hardening").checked,
      install_traffic_shaper: $("opt-shaper").checked,
      shaper_download_fast_mbytes_per_sec: Number($("shaper-dl-fast-mbs").value) || 2,
      shaper_download_slow_mbytes_per_sec: Number($("shaper-dl-slow-mbs").value) || 1,
      shaper_upload_fast_mbytes_per_sec: Number($("shaper-ul-fast-mbs").value) || 2,
      shaper_upload_slow_mbytes_per_sec: Number($("shaper-ul-slow-mbs").value) || 1,
      shaper_fast_tcp_ports: fastPorts.length ? fastPorts : [443, 80, 8080, 8443],
      ufw_extra_tcp_ports: parsePortListStr($("ufw-extra-ports").value),
    };
    return { telemt, options };
  }

  function applyPreset(p) {
    const t = p.telemt;
    $("public-host").value = t.public_host || "";
    $("public-port").value = t.public_port ?? 443;
    $("server-port").value = t.server_port ?? 443;
    $("metrics-port").value = t.metrics_port ?? 9090;
    $("api-listen").value = t.api_listen || "127.0.0.1:9091";
    $("tls-domain").value = t.tls_domain || "";
    $("ad-tag").value = t.ad_tag || "";
    $("mode-classic").checked = !!t.mode_classic;
    $("mode-secure").checked = !!t.mode_secure;
    $("mode-tls").checked = t.mode_tls !== false;
    $("log-level").value = t.log_level || "normal";
    $("metrics-whitelist").value = JSON.stringify(t.metrics_whitelist || []);
    $("api-whitelist").value = JSON.stringify(t.api_whitelist || []);

    $("users-rows").innerHTML = "";
    (t.users || []).forEach((u) => addUserRow(u.username, u.secret_hex));
    if (!(t.users || []).length) addUserRow("free", randomHex32());

    const o = p.options || {};
    $("opt-apt").checked = o.apt_update_upgrade !== false;
    $("opt-sysctl-limits").checked = o.sysctl_file_limits !== false;
    $("opt-sysctl-net").checked = o.sysctl_network !== false;
    $("opt-download").checked = o.download_binary !== false;
    $("opt-systemd").checked = o.install_systemd !== false;
    $("opt-start").checked = o.start_and_enable_service !== false;
    $("opt-verify").checked = o.verify_api !== false;
    if (o.binary_path) $("binary-path").value = o.binary_path;
    if (o.install_ufw != null) $("opt-ufw").checked = !!o.install_ufw;
    if (o.install_fail2ban != null) $("opt-fail2ban").checked = !!o.install_fail2ban;
    if (o.kernel_hardening_sysctl != null) $("opt-kernel-hardening").checked = !!o.kernel_hardening_sysctl;
    if (o.install_traffic_shaper != null) $("opt-shaper").checked = !!o.install_traffic_shaper;
    const dlF = o.shaper_download_fast_mbytes_per_sec ?? o.shaper_fast_mbytes_per_sec;
    const dlS = o.shaper_download_slow_mbytes_per_sec ?? o.shaper_slow_mbytes_per_sec;
    const ulF = o.shaper_upload_fast_mbytes_per_sec ?? o.shaper_fast_mbytes_per_sec;
    const ulS = o.shaper_upload_slow_mbytes_per_sec ?? o.shaper_slow_mbytes_per_sec;
    if (dlF != null) $("shaper-dl-fast-mbs").value = dlF;
    if (dlS != null) $("shaper-dl-slow-mbs").value = dlS;
    if (ulF != null) $("shaper-ul-fast-mbs").value = ulF;
    if (ulS != null) $("shaper-ul-slow-mbs").value = ulS;
    if (o.shaper_fast_tcp_ports && o.shaper_fast_tcp_ports.length) {
      $("shaper-ports").value = o.shaper_fast_tcp_ports.join(",");
    }
    if (o.ufw_extra_tcp_ports && o.ufw_extra_tcp_ports.length) {
      $("ufw-extra-ports").value = o.ufw_extra_tcp_ports.join(",");
    }
  }

  async function loadPresets() {
    const r = await authFetch("/api/presets");
    if (!r.ok) throw new Error(r.statusText);
    presetsCache = await r.json();
    const sel = $("preset-select");
    while (sel.options.length > 1) sel.remove(1);
    presetsCache.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      sel.appendChild(opt);
    });
  }

  document.querySelectorAll('input[name="auth-mode"]').forEach((el) => {
    el.addEventListener("change", syncAuthUi);
  });
  document.querySelectorAll('input[name="dlg-auth-mode"]').forEach((el) => {
    el.addEventListener("change", syncDlgAuthUi);
  });

  $("ssh-key-file").addEventListener("change", () => {
    $("ssh-key").value = "";
  });
  $("ssh-key").addEventListener("input", () => {
    $("ssh-key-file").value = "";
  });

  $("btn-gen-ad").addEventListener("click", () => {
    $("ad-tag").value = randomHex32();
  });

  $("btn-add-user").addEventListener("click", () => addUserRow("", ""));

  $("btn-preset-apply").addEventListener("click", () => {
    const id = $("preset-select").value;
    if (!id) return;
    const p = presetsCache.find((x) => x.id === id);
    if (p) applyPreset(p);
  });

  $("btn-server-add").addEventListener("click", () => openDialogNew(false));

  $("dlg-server-close").addEventListener("click", closeDialog);
  $("dlg-cancel").addEventListener("click", closeDialog);

  $("form-server").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const body = collectDialogBody();
      const sid = $("dlg-server-id").value.trim();
      if (!sid && !$("dlg-fetch-telemt-wrap").classList.contains("hidden") && $("dlg-fetch-telemt").checked) {
        appendLog("Чтение /etc/telemt/telemt.toml по SSH…");
        const fr = await authFetch("/api/fetch-remote-telemt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ssh: dialogBodyToSsh(body) }),
        });
        const fj = await fr.json();
        if (!fj.ok) {
          throw new Error(fj.message || "Не удалось подключиться по SSH");
        }
        if (fj.telemt) {
          applyTelemtOnly(fj.telemt);
          appendLog(fj.message || "Конфиг Telemt подставлен в форму.");
        } else {
          appendLog(fj.message || (fj.found ? "Файл не разобран" : "Файл на сервере не найден"));
        }
      }
      let r;
      if (sid) {
        r = await authFetch("/api/servers/" + encodeURIComponent(sid), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        r = await authFetch("/api/servers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      const saved = await r.json();
      closeDialog();
      await loadServers();
      await selectServer(saved.id);
    } catch (err) {
      alert(String(err.message || err));
    }
  });

  $("btn-save-server").addEventListener("click", async () => {
    try {
      if (selectedServerId) {
        const item = serversListCache.find((x) => x.id === selectedServerId);
        const nm =
          (selectedServerName && selectedServerName.trim()) ||
          (item && item.name) ||
          $("ssh-host").value.trim() ||
          "server";
        const body = await buildStoredPayloadFromMainForm(nm);
        const r = await authFetch("/api/servers/" + encodeURIComponent(selectedServerId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(await r.text());
        await loadServers();
        await selectServer(selectedServerId);
        appendLog("Профиль сервера обновлён.");
        return;
      }
      openDialogNew(true);
    } catch (err) {
      alert(String(err.message || err));
    }
  });

  $("btn-test").addEventListener("click", async () => {
    clearLog();
    appendLog("Проверка SSH…");
    $("btn-test").disabled = true;
    try {
      const ssh = await collectSshAuth();
      const r = await authFetch("/api/ssh-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssh }),
      });
      const j = await r.json();
      appendLog(j.ok ? "OK: " + j.message : "Ошибка: " + j.message);
    } catch (e) {
      appendLog("Ошибка: " + e.message);
    } finally {
      $("btn-test").disabled = false;
    }
  });

  $("btn-deploy").addEventListener("click", async () => {
    clearLog();
    $("btn-deploy").disabled = true;
    try {
      const ssh = await collectSshAuth();
      const { telemt, options } = buildPayload();
      const payload = { ssh, telemt, options };
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(proto + "//" + location.host + "/ws/deploy");
      ws.onopen = () => ws.send(JSON.stringify(payload));
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          appendLog(ev.data);
          return;
        }
        if (msg.type === "log") appendLog(msg.message);
        else if (msg.type === "error") appendLog("Ошибка: " + msg.message);
        else if (msg.type === "done") {
          appendLog(msg.ok ? "--- Успешно ---" : "--- Ошибка: " + (msg.error || "?") + " ---");
          ws.close();
        }
      };
      ws.onerror = () => appendLog("WebSocket: ошибка");
      ws.onclose = () => {
        $("btn-deploy").disabled = false;
      };
    } catch (e) {
      appendLog("Ошибка: " + e.message);
      $("btn-deploy").disabled = false;
    }
  });

  function setJournalButtons(running) {
    $("btn-journal-start").disabled = running;
    $("btn-journal-stop").disabled = !running;
  }

  $("btn-journal-start").addEventListener("click", async () => {
    if (journalWs) {
      journalWs.close();
      journalWs = null;
    }
    clearJournalLog();
    appendJournal("Подключение…");
    setJournalButtons(true);
    try {
      const ssh = await collectSshAuth();
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(proto + "//" + location.host + "/ws/journal");
      journalWs = ws;
      ws.onopen = () => ws.send(JSON.stringify({ ssh }));
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          appendJournal(ev.data);
          return;
        }
        if (msg.type === "log") appendJournal(msg.message);
        else if (msg.type === "error") appendJournal("Ошибка: " + msg.message);
        else if (msg.type === "done") appendJournal("--- конец потока ---");
      };
      ws.onerror = () => appendJournal("WebSocket: ошибка");
      ws.onclose = () => {
        journalWs = null;
        setJournalButtons(false);
      };
    } catch (e) {
      appendJournal("Ошибка: " + e.message);
      setJournalButtons(false);
    }
  });

  $("btn-journal-stop").addEventListener("click", () => {
    if (journalWs) {
      journalWs.close();
      journalWs = null;
    }
    setJournalButtons(false);
  });

  function vdsinaPublicIp(s) {
    const ipObj = s && s.ip;
    return ipObj && typeof ipObj === "object" && ipObj.ip ? String(ipObj.ip) : "";
  }

  function formatApiErrorDetail(d) {
    if (d == null) return "";
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length && typeof d[0] === "object" && d[0].msg != null) {
      return d
        .map((x) => {
          const loc = Array.isArray(x.loc) ? x.loc.filter((p) => p !== "body").join(".") : String(x.loc ?? "");
          const typ = x.type ? " [" + x.type + "]" : "";
          return (loc ? loc + ": " : "") + x.msg + typ;
        })
        .join("; ");
    }
    try {
      return JSON.stringify(d);
    } catch {
      return String(d);
    }
  }

  async function apiJson(url, { method = "GET", body } = {}) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    const r = await authFetch(url, opt);
    const t = await r.text();
    let j = null;
    try {
      j = t ? JSON.parse(t) : null;
    } catch {
      /* ignore */
    }
    if (!r.ok) {
      const d = j && j.detail !== undefined && j.detail !== null ? j.detail : t || r.statusText;
      const msg = formatApiErrorDetail(d) || r.statusText;
      throw new Error(msg);
    }
    return j;
  }

  function clearStatsTimer() {
    if (statsPollTimer) {
      clearInterval(statsPollTimer);
      statsPollTimer = null;
    }
  }

  function vdsinaSuggestedPanelName(s) {
    const base = String((s && (s.name || s.full_name)) || "").trim();
    return base || "VDSina #" + (s && s.id);
  }

  async function createPanelServerFromVdsina(body) {
    const r = await authFetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    const saved = await r.json();
    await loadServers();
    await selectServer(saved.id);
    appendLog("Сервер «" + body.name + "» добавлен в панель.");
    return saved;
  }

  function openDialogVdsinaPartial({ name, host, password }) {
    $("dlg-server-title").textContent = "Новый сервер (VDSina)";
    $("dlg-server-id").value = "";
    $("dlg-fetch-telemt-wrap").classList.remove("hidden");
    $("dlg-fetch-telemt").checked = true;
    $("dlg-name").value = name || "";
    $("dlg-host").value = host || "";
    $("dlg-port").value = 22;
    $("dlg-user").value = "root";
    document.querySelector('input[name="dlg-auth-mode"][value="password"]').checked = true;
    $("dlg-password").value = password || "";
    $("dlg-key").value = "";
    $("dlg-key-pass").value = "";
    syncDlgAuthUi();
    dlg().showModal();
  }

  function fmtNum(v) {
    if (v == null || Number.isNaN(Number(v))) return "—";
    const n = Number(v);
    if (Math.abs(n) >= 1e9) return n.toExponential(3);
    return Number.isInteger(n) ? n.toLocaleString("ru-RU") : n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
  }

  /** Краткие KPI над графиками (остальное — только на графиках). */
  const HERO_KPIS = [
    { label: "Версия", fromCards: "version" },
    { label: "Uptime, с", key: "telemt_uptime_seconds" },
    {
      label: "Пользователей Telemt",
      compute(cards, m) {
        if (cards && cards.per_user_connections_current && typeof cards.per_user_connections_current === "object") {
          return Object.keys(cards.per_user_connections_current).length;
        }
        const keys = Object.keys(m || {}).filter((k) => k.startsWith("telemt_user_connections_current{"));
        return keys.length;
      },
    },
    {
      label: "Сессий сейчас",
      compute(cards, m) {
        if (cards && cards.per_user_connections_current && typeof cards.per_user_connections_current === "object") {
          let s = 0;
          for (const k of Object.keys(cards.per_user_connections_current)) {
            s += Number(cards.per_user_connections_current[k]) || 0;
          }
          return s;
        }
        let s = 0;
        for (const k of Object.keys(m || {})) {
          if (k.startsWith("telemt_user_connections_current{")) s += Number(m[k]) || 0;
        }
        return s;
      },
    },
    { label: "Соединений принято", fromCards: "connections_total", fallbackKey: "telemt_connections_total" },
    { label: "Плохие соединения", fromCards: "connections_bad_total", fallbackKey: "telemt_connections_bad_total" },
    { label: "Таймауты рукопожатия", key: "telemt_handshake_timeouts_total" },
    {
      label: "ME writers (act / warm)",
      compute(cards, m) {
        const a = cards && cards.writers_active != null ? cards.writers_active : m.telemt_me_writers_active_current;
        const w = cards && cards.writers_warm != null ? cards.writers_warm : m.telemt_me_writers_warm_current;
        if (a == null && w == null) return null;
        return String(fmtNum(a)) + " / " + String(fmtNum(w));
      },
    },
    {
      label: "Upstream OK / fail",
      compute(cards, m) {
        const ok = cards && cards.upstream_connect_success != null ? cards.upstream_connect_success : m.telemt_upstream_connect_success_total;
        const fl = cards && cards.upstream_connect_fail != null ? cards.upstream_connect_fail : m.telemt_upstream_connect_fail_total;
        if (ok == null && fl == null) return null;
        return String(fmtNum(ok)) + " / " + String(fmtNum(fl));
      },
    },
    { label: "Desync", fromCards: "desync_total", fallbackKey: "telemt_desync_total" },
    { label: "Уник. IP (трекер)", key: 'telemt_ip_tracker_entries{scope="active"}' },
  ];

  function dashCardValue(cards, m, it) {
    if (typeof it.compute === "function") {
      const v = it.compute(cards || {}, m || {});
      return v === "" ? null : v;
    }
    if (it.fromCards && cards && cards[it.fromCards] != null) return cards[it.fromCards];
    if (it.key && m && m[it.key] != null) return m[it.key];
    if (it.fallbackKey && m && m[it.fallbackKey] != null) return m[it.fallbackKey];
    return null;
  }

  function fmtDashCell(v) {
    if (v == null) return "—";
    if (typeof v === "string") return escapeAttr(v);
    return escapeAttr(fmtNum(v));
  }

  function showStatsDashLoader(message) {
    const host = $("stats-dash");
    if (!host) return;
    const text = message || "Снимок метрик…";
    host.innerHTML =
      '<div class="stats-hero panel"><div class="stats-dash-loader" role="status" aria-live="polite">' +
      '<span class="stats-dash-loader-spinner" aria-hidden="true"></span>' +
      '<span class="stats-dash-loader-text">' +
      escapeAttr(text) +
      "</span></div></div>";
  }

  function statsHistoryQuerySuffix() {
    const sel = $("stats-history-range");
    if (!sel) return "";
    const v = String(sel.value || "").trim();
    if (!v || v === "all") return "";
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return "";
    return "&hours=" + encodeURIComponent(String(Math.min(48, Math.max(1, n))));
  }

  function isStaleStatsResponse(forServerId) {
    return !forServerId || selectedServerId !== forServerId;
  }

  function applyStatsHistoryRangeChange() {
    if (!$("view-stats") || $("view-stats").classList.contains("hidden")) return;
    const sid = selectedServerId;
    if (!sid) return;
    void (async () => {
      const data = await fetchMetricsHistoryData(sid);
      if (isStaleStatsResponse(sid) || !data.ok) return;
      requestAnimationFrame(() => updateStatsHistoryCharts(data.points, sid));
    })();
  }

  function restoreStatsHistoryRangeFromStorage() {
    const sel = $("stats-history-range");
    if (!sel) return;
    const saved = localStorage.getItem(LS_STATS_HISTORY_RANGE);
    if (saved && Array.from(sel.options).some((o) => o.value === saved)) sel.value = saved;
  }

  async function fetchMetricsHistoryData(sid) {
    const suf = statsHistoryQuerySuffix();
    const r = await authFetch("/api/metrics/history?server_id=" + encodeURIComponent(sid) + suf);
    if (!r.ok) return { ok: false, points: [], last_cards: null };
    const data = await r.json();
    return {
      ok: true,
      points: Array.isArray(data.points) ? data.points : [],
      last_cards: data.last_cards && typeof data.last_cards === "object" ? data.last_cards : null,
    };
  }

  function renderStatsDashboard(cards, m) {
    const host = $("stats-dash");
    if (!host) return;
    const mSafe = m && typeof m === "object" ? m : {};
    const cSafe = cards && typeof cards === "object" ? cards : null;
    const hasMetrics = Object.keys(mSafe).length > 0;
    const hasCards = cSafe != null && Object.keys(cSafe).length > 0;
    if (!hasMetrics && !hasCards) {
      host.innerHTML = '<p class="hint stats-dash-empty">Нет данных метрик. Снимите снимок или дождитесь авто-снимка.</p>';
      return;
    }
    const inner = HERO_KPIS.map((it) => {
      const v = dashCardValue(cSafe, mSafe, it);
      return (
        '<div class="stats-card"><div class="stats-card-k">' +
        escapeAttr(it.label) +
        '</div><div class="stats-card-v">' +
        fmtDashCell(v) +
        "</div></div>"
      );
    }).join("");
    host.innerHTML =
      '<div class="stats-hero panel"><div class="stats-cards stats-cards-hero">' + inner + "</div></div>";
  }

  function destroyStatCharts() {
    Object.keys(chartHandles).forEach((k) => {
      if (chartHandles[k]) {
        chartHandles[k].destroy();
        delete chartHandles[k];
      }
    });
  }

  function seriesDerivative(points, key) {
    const arr = [];
    for (let i = 1; i < points.length; i++) {
      const dt = points[i].t - points[i - 1].t;
      if (dt <= 0) continue;
      const v0 = points[i - 1].m[key];
      const v1 = points[i].m[key];
      if (v0 == null || v1 == null) continue;
      arr.push({ x: points[i].t * 1000, y: Math.max(0, (v1 - v0) / dt) });
    }
    return arr;
  }

  function seriesGauge(points, key) {
    return points
      .filter((p) => p.m && p.m[key] != null)
      .map((p) => ({ x: p.t * 1000, y: p.m[key] }));
  }

  function firstMetricKey(points, prefix) {
    const keys = new Set();
    points.forEach((p) => {
      Object.keys(p.m || {}).forEach((k) => {
        if (k.startsWith(prefix)) keys.add(k);
      });
    });
    const sorted = Array.from(keys).sort();
    return sorted[0] || null;
  }

  function formatChartXTime(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return "";
    const d = new Date(n);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function formatChartTooltipTime(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return "";
    const d = new Date(n);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  function chartOpts() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      transitions: { active: { animation: { duration: 0 } } },
      interaction: { mode: "index", axis: "x", intersect: false },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "Время", color: "#8b93a8" },
          ticks: {
            color: "#8b93a8",
            maxTicksLimit: 8,
            callback: (raw) => formatChartXTime(raw),
          },
          grid: { color: "rgba(42,49,66,0.45)" },
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#8b93a8" },
          grid: { color: "rgba(42,49,66,0.45)" },
        },
      },
      plugins: {
        legend: { labels: { color: "#e8ebf0" } },
        tooltip: {
          intersect: false,
          mode: "index",
          axis: "x",
          callbacks: {
            title(items) {
              if (!items || !items.length) return "";
              const x = items[0].parsed && items[0].parsed.x;
              return formatChartTooltipTime(x);
            },
          },
        },
      },
    };
  }

  function updateOrCreateLineChart(canvasId, label, dataPoints, borderColor, fillColor) {
    const canvas = $(canvasId);
    if (!canvas || typeof Chart === "undefined") return;
    const data = (dataPoints || []).slice();
    let ch = chartHandles[canvasId];
    if (!ch) {
      ch = new Chart(canvas, {
        type: "line",
        data: {
          datasets: [
            {
              label,
              data,
              borderColor,
              backgroundColor: fillColor,
              fill: true,
              tension: 0.25,
              pointRadius: 0,
            },
          ],
        },
        options: chartOpts(),
      });
      chartHandles[canvasId] = ch;
    } else {
      ch.data.datasets[0].label = label;
      ch.data.datasets[0].data = data;
      ch.data.datasets[0].borderColor = borderColor;
      ch.data.datasets[0].backgroundColor = fillColor;
      ch.update("none");
    }
  }

  function updateOrCreateMultiLineChart(canvasId, datasetSpecs) {
    const canvas = $(canvasId);
    if (!canvas || typeof Chart === "undefined") return;
    const datasets = (datasetSpecs || []).map((s) => ({
      label: s.label,
      data: (s.data || []).slice(),
      borderColor: s.borderColor,
      backgroundColor: s.fillColor || "transparent",
      fill: !!s.fill,
      tension: 0.25,
      pointRadius: 0,
    }));
    let ch = chartHandles[canvasId];
    if (!ch) {
      ch = new Chart(canvas, {
        type: "line",
        data: { datasets },
        options: chartOpts(),
      });
      chartHandles[canvasId] = ch;
    } else {
      ch.data.datasets = datasets;
      ch.update("none");
    }
  }

  function updateStatsHistoryCharts(pts, forServerId) {
    if (typeof Chart === "undefined") return;
    if (forServerId && isStaleStatsResponse(forServerId)) return;
    if (!selectedServerId) {
      destroyStatCharts();
      statsChartsBoundSid = null;
      return;
    }
    if (statsChartsBoundSid !== selectedServerId) {
      destroyStatCharts();
      statsChartsBoundSid = selectedServerId;
    }

    const uk = firstMetricKey(pts, "telemt_user_connections_current{");
    const usr = uk ? seriesGauge(pts, uk) : [];
    const payDer = seriesDerivative(pts, "telemt_me_d2c_payload_bytes_total").map((p) => ({
      x: p.x,
      y: p.y / 1e6,
    }));

    updateOrCreateLineChart(
      "chart-conn-rate",
      "/ с",
      seriesDerivative(pts, "telemt_connections_total"),
      "rgb(99,102,241)",
      "rgba(99,102,241,0.15)"
    );
    updateOrCreateLineChart(
      "chart-handshake-rate",
      "/ с",
      seriesDerivative(pts, "telemt_handshake_timeouts_total"),
      "rgb(251,191,36)",
      "rgba(251,191,36,0.12)"
    );
    updateOrCreateLineChart(
      "chart-auth-rate",
      "/ с",
      seriesDerivative(pts, "telemt_auth_expensive_checks_total"),
      "rgb(167,139,250)",
      "rgba(167,139,250,0.12)"
    );
    updateOrCreateMultiLineChart("chart-upstream", [
      {
        label: "success / с",
        data: seriesDerivative(pts, "telemt_upstream_connect_success_total"),
        borderColor: "rgb(52,211,153)",
        fillColor: "rgba(52,211,153,0.08)",
        fill: true,
      },
      {
        label: "fail / с",
        data: seriesDerivative(pts, "telemt_upstream_connect_fail_total"),
        borderColor: "rgb(244,63,94)",
        fillColor: "rgba(244,63,94,0.08)",
        fill: true,
      },
    ]);
    updateOrCreateLineChart(
      "chart-bad",
      "накопительно",
      seriesGauge(pts, "telemt_connections_bad_total"),
      "rgb(244,63,94)",
      "rgba(244,63,94,0.12)"
    );
    updateOrCreateLineChart(
      "chart-writers",
      "active",
      seriesGauge(pts, "telemt_me_writers_active_current"),
      "rgb(34,211,153)",
      "rgba(34,211,153,0.12)"
    );
    updateOrCreateLineChart(
      "chart-me-reconn",
      "/ с",
      seriesDerivative(pts, "telemt_me_reconnect_attempts_total"),
      "rgb(96,165,250)",
      "rgba(96,165,250,0.12)"
    );
    updateOrCreateLineChart(
      "chart-payload-mbs",
      "МБ/с",
      payDer,
      "rgb(34,197,235)",
      "rgba(34,197,235,0.12)"
    );
    updateOrCreateLineChart(
      "chart-user-cur",
      uk || "sessions",
      usr,
      "rgb(192,132,252)",
      "rgba(192,132,252,0.12)"
    );
    updateOrCreateLineChart(
      "chart-desync",
      "накопительно",
      seriesGauge(pts, "telemt_desync_total"),
      "rgb(248,113,113)",
      "rgba(248,113,113,0.1)"
    );
  }

  async function syncStatsFromHistory() {
    const sid = selectedServerId;
    if (!sid) {
      renderStatsDashboard(null, {});
      updateStatsHistoryCharts([], null);
      return;
    }
    const data = await fetchMetricsHistoryData(sid);
    if (!data.ok || isStaleStatsResponse(sid)) return;
    const pts = data.points;
    const last = pts.length ? pts[pts.length - 1] : null;
    const m = last && last.m ? last.m : {};
    renderStatsDashboard(data.last_cards || null, m);
    requestAnimationFrame(() => updateStatsHistoryCharts(pts, sid));
  }

  async function takeMetricsSnapshot(showAlert, options) {
    const opts = options && typeof options === "object" ? options : {};
    const dashLoader = opts.dashLoader === true;
    const sid = selectedServerId;
    const port = Number($("stats-metrics-port").value) || 9090;
    const el = $("stats-msg");
    if (!sid) {
      if (el) el.textContent = "Выберите сервер в боковой панели.";
      destroyStatCharts();
      statsChartsBoundSid = null;
      renderStatsDashboard(null, {});
      return false;
    }
    if (dashLoader) {
      showStatsDashLoader();
      void fetchMetricsHistoryData(sid).then((data) => {
        if (!data.ok || isStaleStatsResponse(sid)) return;
        requestAnimationFrame(() => updateStatsHistoryCharts(data.points, sid));
      });
    }
    try {
      const j = await apiJson("/api/metrics/snapshot", {
        method: "POST",
        body: { server_id: sid, metrics_port: port },
      });
      if (isStaleStatsResponse(sid)) return false;
      if (!j.ok) {
        if (el) el.textContent = j.message || "Ошибка снимка";
        if (showAlert) alert(j.message || "Ошибка снимка");
        await syncStatsFromHistory();
        return false;
      }
      if (isStaleStatsResponse(sid)) return false;
      if (el) {
        el.textContent =
          "Снимок " +
          new Date(j.t * 1000).toLocaleString("ru-RU") +
          " · точек в истории: " +
          (j.points_total ?? "?") +
          " · серий: " +
          (j.metrics_series ?? "?");
      }
      const m = j.metrics && typeof j.metrics === "object" ? j.metrics : {};
      const c = j.cards && typeof j.cards === "object" ? j.cards : null;
      renderStatsDashboard(c, m);
      const fin = await fetchMetricsHistoryData(sid);
      if (!fin.ok || isStaleStatsResponse(sid)) return true;
      requestAnimationFrame(() => updateStatsHistoryCharts(fin.points, sid));
      return true;
    } catch (e) {
      const msg = e.message || String(e);
      if (!isStaleStatsResponse(sid)) {
        if (el) el.textContent = msg;
        if (showAlert) alert(msg);
        await syncStatsFromHistory();
      }
      return false;
    }
  }

  function refreshStatsPanel() {
    if (!$("view-stats").classList.contains("hidden")) {
      void takeMetricsSnapshot(false, { dashLoader: true });
    }
  }

  function syncStatsPortFromServersForm() {
    const inp = $("metrics-port");
    const st = $("stats-metrics-port");
    if (!st) return;
    const mp = inp ? Number(inp.value) : NaN;
    if (Number.isFinite(mp) && mp >= 1 && mp <= 65535) {
      st.value = String(mp);
    }
  }

  function setView(view) {
    document.querySelectorAll(".topbar-tab").forEach((t) => {
      t.classList.toggle("is-active", t.getAttribute("data-view") === view);
    });
    $("view-stats").classList.toggle("hidden", view !== "stats");
    $("view-servers").classList.toggle("hidden", view !== "servers");
    $("view-providers").classList.toggle("hidden", view !== "providers");
    localStorage.setItem(LS_VIEW, view);

    clearStatsTimer();
    if (view === "stats") {
      syncStatsPortFromServersForm();
      restoreStatsHistoryRangeFromStorage();
      void refreshStatsPanel();
      if ($("stats-auto-snapshot") && $("stats-auto-snapshot").checked) {
        statsPollTimer = setInterval(() => void takeMetricsSnapshot(false, { dashLoader: false }), 60000);
      }
    }
    if (view === "providers") {
      void refreshVdsina();
    }
    if (view !== "stats") {
      destroyStatCharts();
      statsChartsBoundSid = null;
    }
  }

  function fillSelect(sel, items, labelFn, valueKey, emptyLabel) {
    sel.innerHTML = "";
    if (emptyLabel) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = emptyLabel;
      sel.appendChild(o);
    }
    (items || []).forEach((it) => {
      const o = document.createElement("option");
      o.value = String(it[valueKey]);
      o.textContent = labelFn(it);
      sel.appendChild(o);
    });
  }

  let vdsinaRefreshing = false;
  let vdsinaTemplatesAll = [];

  function vdsinaTemplateAllowedForPlan(t, planId) {
    if (!Number.isFinite(planId) || planId < 1) return true;
    const sp = t.server_plan || t.server_plans || t["server-plan"];
    if (!Array.isArray(sp) || sp.length === 0) return true;
    return sp.some((x) => Number(x) === Number(planId));
  }

  function refillVdsinaTemplatesForPlan() {
    const planId = parseInt(String($("vdsina-plan").value || ""), 10);
    const list = (vdsinaTemplatesAll || [])
      .filter((t) => t && t.active !== false)
      .filter((t) => vdsinaTemplateAllowedForPlan(t, planId));
    fillSelect($("vdsina-template"), list, (t) => (t.name || "") + " · id " + t.id, "id");
  }

  async function loadVdsinaPlans() {
    const sel = $("vdsina-plan");
    const gid = Number($("vdsina-group").value);
    if (!gid) {
      sel.innerHTML = "";
      refillVdsinaTemplatesForPlan();
      return;
    }
    const plans = await apiJson("/api/cloud/vdsina/catalog/server-plans/" + gid);
    fillSelect(
      sel,
      (plans || []).filter((p) => p.active && p.enable),
      (p) => "#" + p.id + " — " + (p.name || "") + " (" + (p.period || "") + ")",
      "id"
    );
    refillVdsinaTemplatesForPlan();
  }

  async function refreshVdsina() {
    if (vdsinaRefreshing) return;
    vdsinaRefreshing = true;
    const btn = $("btn-vdsina-refresh");
    if (btn) btn.disabled = true;
    try {
      const st = await apiJson("/api/cloud/vdsina/status");
      if (!st.configured) {
        $("vdsina-line").textContent =
          "API не настроен: задайте VDSINA_API_TOKEN и перезапустите панель.";
        $("vdsina-list").innerHTML = "";
        return;
      }
      $("vdsina-line").textContent = "Подключено к " + (st.api_base || "") + " · загрузка…";
      const [bal, srvs, dcs, groups, tmpl, keys] = await Promise.all([
        apiJson("/api/cloud/vdsina/account/balance"),
        apiJson("/api/cloud/vdsina/servers"),
        apiJson("/api/cloud/vdsina/catalog/datacenters"),
        apiJson("/api/cloud/vdsina/catalog/server-groups"),
        apiJson("/api/cloud/vdsina/catalog/templates"),
        apiJson("/api/cloud/vdsina/ssh-keys"),
      ]);
      const real = (bal && bal.real) || "—";
      const bonus = (bal && bal.bonus) || "—";
      $("vdsina-line").textContent = "Баланс: " + real + " · бонусы: " + bonus;

      const dcList = (dcs || []).filter((d) => d.active);
      fillSelect($("vdsina-dc"), dcList, (d) => d.name + " (" + d.country + ") · id " + d.id, "id");
      const gr = (groups || []).filter((g) => g.active);
      fillSelect($("vdsina-group"), gr, (g) => (g.name || "") + " · id " + g.id, "id");
      vdsinaTemplatesAll = Array.isArray(tmpl) ? tmpl : [];
      await loadVdsinaPlans();

      fillSelect(
        $("vdsina-sshkey"),
        keys || [],
        (k) => (k.name || "key") + " · id " + k.id,
        "id",
        "— без ключа —"
      );
      if ($("vdsina-sshkey").options.length) $("vdsina-sshkey").selectedIndex = 0;

      renderVdsinaServers(Array.isArray(srvs) ? srvs : []);
    } catch (e) {
      $("vdsina-line").textContent = "Ошибка: " + (e.message || e);
      $("vdsina-list").innerHTML = "";
    } finally {
      vdsinaRefreshing = false;
      if (btn) btn.disabled = false;
    }
  }

  function renderVdsinaServers(servers) {
    const host = $("vdsina-list");
    host.innerHTML = "";
    if (!servers.length) {
      host.innerHTML = '<div class="sidebar-hint">Нет VPS в аккаунте.</div>';
      return;
    }
    servers.forEach((s) => {
      const ip = vdsinaPublicIp(s);
      const card = document.createElement("div");
      card.className = "vdsina-card";
      const st = (s.status_text || s.status || "").trim();
      card.innerHTML =
        '<div class="vdsina-card-top"><div><div class="vdsina-title"></div><div class="vdsina-meta"></div></div></div><div class="vdsina-card-actions"></div>';
      card.querySelector(".vdsina-title").textContent = (s.name || s.full_name || "VPS") + " · id " + s.id;
      card.querySelector(".vdsina-meta").textContent = (ip ? "IP: " + ip + " · " : "") + st;
      const actions = card.querySelector(".vdsina-card-actions");
      const bIp = document.createElement("button");
      bIp.type = "button";
      bIp.className = "btn btn-ghost btn-sm";
      bIp.textContent = "В панель";
      bIp.title = "Создать новую запись сервера в панели с root и паролем из API";
      bIp.disabled = !ip;
      bIp.addEventListener("click", async () => {
        const suggested = vdsinaSuggestedPanelName(s);
        bIp.disabled = true;
        try {
          const pr = await apiJson("/api/cloud/vdsina/servers/" + s.id + "/root-password");
          const pw = String((pr && pr.password) || "").trim();
          if (!pw) {
            openDialogVdsinaPartial({ name: suggested, host: ip, password: "" });
            appendLog("VDSina: пароль пустой — откройте диалог и введите root-пароль вручную.");
            return;
          }
          await createPanelServerFromVdsina({
            name: suggested,
            host: ip,
            port: 22,
            username: "root",
            auth_mode: "password",
            password: pw,
            private_key: null,
            private_key_passphrase: null,
          });
        } catch (e) {
          openDialogVdsinaPartial({ name: suggested, host: ip, password: "" });
          appendLog("VDSina: не удалось добавить автоматически — " + (e.message || e) + ". Откройте диалог и сохраните вручную.");
        } finally {
          bIp.disabled = false;
        }
      });
      const bDel = document.createElement("button");
      bDel.type = "button";
      bDel.className = "btn btn-secondary btn-sm";
      bDel.textContent = "Удалить";
      const canDel = s.can && s.can.delete;
      bDel.disabled = !canDel;
      bDel.addEventListener("click", async () => {
        if (!confirm("Удалить VPS #" + s.id + " на VDSina? Это действие необратимо.")) return;
        try {
          await apiJson("/api/cloud/vdsina/servers/" + s.id, { method: "DELETE" });
          await refreshVdsina();
        } catch (err) {
          alert(String(err.message || err));
        }
      });
      actions.appendChild(bIp);
      actions.appendChild(bDel);
      host.appendChild(card);
    });
  }

  $("vdsina-group").addEventListener("change", () => {
    loadVdsinaPlans().catch((e) => console.error(e));
  });

  $("vdsina-plan").addEventListener("change", () => {
    refillVdsinaTemplatesForPlan();
  });

  $("btn-vdsina-refresh").addEventListener("click", () => refreshVdsina().catch((e) => console.error(e)));

  $("btn-vdsina-create").addEventListener("click", async () => {
    try {
      const dc = parseInt(String($("vdsina-dc").value), 10);
      const plan = parseInt(String($("vdsina-plan").value), 10);
      const tmplRaw = String($("vdsina-template").value || "").trim();
      const tmpl = tmplRaw === "" ? null : parseInt(tmplRaw, 10);
      const skRaw = String($("vdsina-sshkey").value || "").trim();
      const sk = skRaw === "" ? null : parseInt(skRaw, 10);
      const name = ($("vdsina-name").value || "").trim() || null;
      if (!Number.isFinite(dc) || dc < 1) throw new Error("Выберите датацентр");
      if (!Number.isFinite(plan) || plan < 1) throw new Error("Выберите тариф");
      if (tmpl != null && (!Number.isFinite(tmpl) || tmpl < 1)) throw new Error("Выберите шаблон ОС");
      if (tmpl == null) throw new Error("Выберите шаблон ОС");
      if (sk != null && !Number.isFinite(sk)) throw new Error("Некорректный SSH-ключ");
      const body = {
        datacenter: dc,
        server_plan: plan,
        template: tmpl,
        autoprolong: $("vdsina-autoprolong").checked,
      };
      if (sk != null && sk >= 1) body.ssh_key = sk;
      if (name) body.name = name;
      const cpu = parseInt(String($("vdsina-cpu").value || ""), 10);
      const ram = parseInt(String($("vdsina-ram").value || ""), 10);
      const disk = parseInt(String($("vdsina-disk").value || ""), 10);
      if (Number.isFinite(cpu) && cpu >= 1) body.cpu = cpu;
      if (Number.isFinite(ram) && ram >= 1) body.ram = ram;
      if (Number.isFinite(disk) && disk >= 1) body.disk = disk;
      const created = await apiJson("/api/cloud/vdsina/servers", { method: "POST", body });
      appendLog("VDSina: создан сервер id " + created.id);
      await refreshVdsina();
      const ip = created.server ? vdsinaPublicIp(created.server) : "";
      const newId = created && created.id != null ? created.id : null;
      if (ip && newId != null) {
        const suggested =
          (created.server && (created.server.name || created.server.full_name || "").trim()) ||
          ($("vdsina-name").value || "").trim() ||
          "VDSina #" + newId;
        try {
          const pr = await apiJson("/api/cloud/vdsina/servers/" + newId + "/root-password");
          const pw = String((pr && pr.password) || "").trim();
          if (pw) {
            await createPanelServerFromVdsina({
              name: suggested,
              host: ip,
              port: 22,
              username: "root",
              auth_mode: "password",
              password: pw,
              private_key: null,
              private_key_passphrase: null,
            });
          } else {
            openDialogVdsinaPartial({ name: suggested, host: ip, password: "" });
            appendLog("VDSina: VPS создан, пароль root пустой — завершите в диалоге «Новый сервер».");
          }
        } catch (e) {
          openDialogVdsinaPartial({ name: suggested, host: ip, password: "" });
          appendLog("VDSina: VPS создан, импорт в панель: " + (e.message || e) + " — сохраните в диалоге.");
        }
      }
    } catch (e) {
      alert(String(e.message || e));
    }
  });

  const cfDnsPanel = $("cf-dns-panel");
  if (cfDnsPanel) {
    const cfDnsOut = $("cf-dns-out");
    function cfDnsShowJson(obj) {
      if (!cfDnsOut) return;
      cfDnsOut.classList.remove("log-empty");
      cfDnsOut.textContent = JSON.stringify(obj, null, 2);
    }
    function cfDnsShowErr(e) {
      if (!cfDnsOut) return;
      cfDnsOut.classList.remove("log-empty");
      cfDnsOut.textContent = String(e.message || e);
    }

    function parseCfDnsIps() {
      const raw = String($("cf-dns-ips").value || "");
      return raw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    async function refreshCfDnsStatus() {
      const line = $("cf-dns-line");
      if (!line) return;
      try {
        const st = await apiJson("/api/cloud/cloudflare/status");
        const z = st.zone ? st.zone.name + " · " + st.zone.id : "зона не загружена";
        const tok = st.configured ? st.token_status || "ok" : "нет токена";
        line.textContent =
          (st.configured ? "Токен: " + tok : "Задайте CLOUDFLARE_API_TOKEN") +
          (st.zone ? " · " + z : st.zone_error ? " · зона: " + st.zone_error : "") +
          (typeof st.targets_count === "number" ? " · целей в конфиге: " + st.targets_count : "");
        cfDnsShowJson(st);
      } catch (e) {
        line.textContent = "Ошибка: " + (e.message || e);
        cfDnsShowErr(e);
      }
    }

    $("btn-cf-dns-status").addEventListener("click", () => refreshCfDnsStatus().catch((e) => console.error(e)));

    $("btn-cf-dns-list").addEventListener("click", async () => {
      const name = ($("cf-dns-name").value || "").trim();
      if (!name) {
        alert("Укажите поддомен");
        return;
      }
      try {
        const q = encodeURIComponent(name);
        const data = await apiJson("/api/cloud/cloudflare/dns-records?name=" + q);
        cfDnsShowJson(data);
      } catch (e) {
        cfDnsShowErr(e);
      }
    });

    $("btn-cf-dns-dry").addEventListener("click", async () => {
      const name = ($("cf-dns-name").value || "").trim();
      const ips = parseCfDnsIps();
      if (!name || !ips.length) {
        alert("Укажите поддомен и хотя бы один IPv4");
        return;
      }
      const ttl = parseInt(String($("cf-dns-ttl").value || "1"), 10);
      try {
        const data = await apiJson("/api/cloud/cloudflare/sync-a/dry-run", {
          method: "POST",
          body: { name, ips, proxied: $("cf-dns-proxied").checked, ttl: Number.isFinite(ttl) && ttl >= 1 ? ttl : 1 },
        });
        cfDnsShowJson(data);
      } catch (e) {
        cfDnsShowErr(e);
      }
    });

    $("btn-cf-dns-sync").addEventListener("click", async () => {
      const name = ($("cf-dns-name").value || "").trim();
      const ips = parseCfDnsIps();
      if (!name || !ips.length) {
        alert("Укажите поддомен и хотя бы один IPv4");
        return;
      }
      const ttl = parseInt(String($("cf-dns-ttl").value || "1"), 10);
      try {
        const data = await apiJson("/api/cloud/cloudflare/sync-a", {
          method: "POST",
          body: { name, ips, proxied: $("cf-dns-proxied").checked, ttl: Number.isFinite(ttl) && ttl >= 1 ? ttl : 1 },
        });
        cfDnsShowJson(data);
      } catch (e) {
        cfDnsShowErr(e);
      }
    });

    $("btn-cf-dns-sync-config-dry").addEventListener("click", async () => {
      try {
        const data = await apiJson("/api/cloud/cloudflare/sync-config?dry_run=true", { method: "POST" });
        cfDnsShowJson(data);
      } catch (e) {
        cfDnsShowErr(e);
      }
    });

    $("btn-cf-dns-sync-config").addEventListener("click", async () => {
      if (!confirm("Применить синхронизацию DNS по всем целям из .env (CLOUDFLARE_DNS_TARGETS_*)?")) return;
      try {
        const data = await apiJson("/api/cloud/cloudflare/sync-config?dry_run=false", { method: "POST" });
        cfDnsShowJson(data);
      } catch (e) {
        cfDnsShowErr(e);
      }
    });
  }

  document.querySelectorAll(".topbar-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.getAttribute("data-view");
      if (v) setView(v);
    });
  });
  const btnSnap = $("btn-stats-snapshot");
  if (btnSnap) btnSnap.addEventListener("click", () => void takeMetricsSnapshot(true, { dashLoader: true }));
  const autoSnap = $("stats-auto-snapshot");
  if (autoSnap) {
    autoSnap.addEventListener("change", () => {
      clearStatsTimer();
      if (!$("view-stats").classList.contains("hidden") && autoSnap.checked) {
        statsPollTimer = setInterval(() => void takeMetricsSnapshot(false, { dashLoader: false }), 60000);
      }
    });
  }
  const statsHistoryRange = $("stats-history-range");
  if (statsHistoryRange) {
    restoreStatsHistoryRangeFromStorage();
    statsHistoryRange.addEventListener("change", () => {
      localStorage.setItem(LS_STATS_HISTORY_RANGE, statsHistoryRange.value);
      applyStatsHistoryRangeChange();
    });
  }

  async function ensurePanelSession() {
    const st = await authFetch("/api/auth/status");
    const sj = await st.json();
    if (!sj.auth_required) return;
    const me = await authFetch("/api/auth/me");
    if (me.ok) return;
    const gate = $("login-gate");
    const err = $("login-err");
    const form = $("login-gate-form");
    $("login-user").value = (sj.admin_username || "admin").trim();
    $("login-pass").value = "";
    err.classList.add("hidden");
    err.textContent = "";
    gate.classList.remove("hidden");
    await new Promise((resolve) => {
      async function onSubmit(e) {
        e.preventDefault();
        err.classList.add("hidden");
        err.textContent = "";
        const username = $("login-user").value.trim();
        const password = $("login-pass").value;
        try {
          const r = await authFetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
          if (!r.ok) {
            err.textContent = "Неверный логин или пароль";
            err.classList.remove("hidden");
            return;
          }
          form.removeEventListener("submit", onSubmit);
          gate.classList.add("hidden");
          resolve();
        } catch (ex) {
          err.textContent = String(ex.message || ex);
          err.classList.remove("hidden");
        }
      }
      form.addEventListener("submit", onSubmit);
    });
  }

  async function boot() {
    syncAuthUi();
    syncDlgAuthUi();
    try {
      await ensurePanelSession();
    } catch (e) {
      console.error(e);
    }
    try {
      await loadPresets();
      const first = presetsCache.find((x) => x.id === "instr-example");
      if (first) {
        $("preset-select").value = "instr-example";
        applyPreset(first);
      } else {
        addUserRow("free", "");
      }
    } catch (e) {
      console.error(e);
      addUserRow("free", "");
    }

    try {
      await loadServers();
      const saved = localStorage.getItem(LS_SERVER);
      if (saved && serversListCache.some((x) => x.id === saved)) {
        await selectServer(saved);
      }
    } catch (e) {
      console.error(e);
    }

    const vv = (localStorage.getItem(LS_VIEW) || "servers").trim();
    const allow = { stats: true, servers: true, providers: true };
    setView(allow[vv] ? vv : "servers");
  }

  boot();
})();
