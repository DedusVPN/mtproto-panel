import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Rocket, Terminal, StopCircle, FlaskConical, Save, Plus, Minus,
  KeyRound, Lock, Shuffle, ChevronDown, AlertTriangle,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { presets as presetsApi, servers as serversApi } from '@/api/client'
import { useAppStore } from '@/store'
import { useServers, useUpdateServer } from '@/hooks/useServers'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { cn } from '@/components/ui/utils'
import type { AuthMode, TelemtConfig, DeployOptions, SSHAuth, TelemtUser, StoredServer } from '@/types'

function randomHex32() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
}

function parsePortList(s: string): number[] {
  return s.split(/[\s,]+/)
    .map((x) => parseInt(x, 10))
    .filter((n) => !isNaN(n) && n >= 1 && n <= 65535)
}

// ─── User row ────────────────────────────────────────────────────────────────

function UserRow({
  user,
  onChange,
  onRemove,
}: {
  user: TelemtUser
  onChange: (u: TelemtUser) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 space-y-1">
        <Label>Имя</Label>
        <Input
          placeholder="free"
          value={user.username}
          onChange={(e) => onChange({ ...user, username: e.target.value })}
        />
      </div>
      <div className="flex-[2] space-y-1">
        <Label>Секрет (32 hex)</Label>
        <div className="flex gap-1">
          <Input
            className="font-mono text-xs"
            maxLength={32}
            value={user.secret_hex}
            onChange={(e) => onChange({ ...user, secret_hex: e.target.value })}
          />
          <Button variant="ghost" size="icon" title="Сгенерировать" onClick={() => onChange({ ...user, secret_hex: randomHex32() })}>
            <Shuffle className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Button variant="ghost" size="icon" onClick={onRemove} className="text-text-muted hover:text-danger mb-0">
        <Minus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ─── Log panel ────────────────────────────────────────────────────────────────

function LogPanel({ title, lines, empty }: { title: string; lines: string[]; empty: string }) {
  const ref = useRef<HTMLPreElement>(null)
  const prevLen = useRef(0)
  if (ref.current && lines.length !== prevLen.current) {
    prevLen.current = lines.length
    requestAnimationFrame(() => {
      if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
    })
  }
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <Terminal className="h-3.5 w-3.5 text-text-muted" />
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1">
        <pre
          ref={ref}
          className={cn(
            'font-mono text-xs leading-relaxed overflow-auto h-56 px-4 py-3',
            lines.length === 0 ? 'text-text-muted' : 'text-text-primary'
          )}
        >
          {lines.length === 0 ? empty : lines.join('\n')}
        </pre>
      </CardContent>
    </Card>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface ServersPageProps {
  onOpenServerDialog: () => void
  onApplyTelemt: (t: TelemtConfig) => void
  telemtRef: React.MutableRefObject<TelemtFormHandle | null>
}

export interface TelemtFormHandle {
  applyTelemt: (t: Partial<TelemtConfig>) => void
  getValues: () => { ssh: SSHAuth | null; telemt: TelemtConfig; options: DeployOptions }
}

export function ServersPage({ onOpenServerDialog, onApplyTelemt: _onApply, telemtRef }: ServersPageProps) {
  const { selectedServerId } = useAppStore()
  const { data: serverList = [] } = useServers()
  const updateServer = useUpdateServer()
  const deployWs = useWebSocket()
  const journalWs = useWebSocket()

  const selectedServer = serverList.find((s) => s.id === selectedServerId) ?? null

  // SSH form state
  const [authMode, setAuthMode] = useState<AuthMode>('key')
  const [sshHost, setSshHost] = useState('')
  const [sshPort, setSshPort] = useState(22)
  const [sshUser, setSshUser] = useState('root')
  const [sshKey, setSshKey] = useState('')
  const [sshKeyFile, setSshKeyFile] = useState<File | null>(null)
  const [sshKeyPass, setSshKeyPass] = useState('')
  const [sshPassword, setSshPassword] = useState('')

  // Apply full server data (including sensitive fields) to form
  const applyServerToForm = useCallback((srv: StoredServer | null) => {
    if (!srv) return
    setSshHost(srv.host)
    setSshPort(srv.port)
    setSshUser(srv.username)
    setAuthMode(srv.auth_mode)
    setSshKey(srv.private_key || '')
    setSshKeyPass(srv.private_key_passphrase || '')
    setSshPassword(srv.password || '')
    setSshKeyFile(null)
  }, [])

  // When selected server changes, fetch full data (list may omit sensitive fields)
  useEffect(() => {
    if (!selectedServerId) return
    void serversApi.get(selectedServerId).then(applyServerToForm).catch(() => {
      // fallback to list data if fetch fails
      applyServerToForm(serverList.find((s) => s.id === selectedServerId) ?? null)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServerId])

  // Telemt config
  const [publicHost, setPublicHost] = useState('')
  const [publicPort, setPublicPort] = useState(443)
  const [serverPort, setServerPort] = useState(443)
  const [metricsPort, setMetricsPort] = useState(9090)
  const [apiListen, setApiListen] = useState('127.0.0.1:9091')
  const [tlsDomain, setTlsDomain] = useState('')
  const [adTag, setAdTag] = useState('')
  const [users, setUsers] = useState<TelemtUser[]>([{ username: 'free', secret_hex: randomHex32() }])
  const [modeClassic, setModeClassic] = useState(false)
  const [modeSecure, setModeSecure] = useState(false)
  const [modeTls, setModeTls] = useState(true)
  const [logLevel, setLogLevel] = useState<TelemtConfig['log_level']>('normal')
  const [metricsWhitelist, setMetricsWhitelist] = useState('["127.0.0.1/32","::1/128"]')
  const [apiWhitelist, setApiWhitelist] = useState('["127.0.0.1/32","::1/128"]')

  // Deploy options
  const [optApt, setOptApt] = useState(true)
  const [optSysctlLimits, setOptSysctlLimits] = useState(true)
  const [optSysctlNet, setOptSysctlNet] = useState(true)
  const [optDownload, setOptDownload] = useState(true)
  const [optSystemd, setOptSystemd] = useState(true)
  const [optStart, setOptStart] = useState(true)
  const [optVerify, setOptVerify] = useState(true)
  const [binaryPath, setBinaryPath] = useState('/bin/telemt')
  // Security
  const [optUfw, setOptUfw] = useState(false)
  const [optFail2ban, setOptFail2ban] = useState(false)
  const [optKernelHardening, setOptKernelHardening] = useState(false)
  const [optShaper, setOptShaper] = useState(false)
  const [ufwExtra, setUfwExtra] = useState('')
  const [shaperDlFast, setShaperDlFast] = useState(2)
  const [shaperDlSlow, setShaperDlSlow] = useState(1)
  const [shaperUlFast, setShaperUlFast] = useState(2)
  const [shaperUlSlow, setShaperUlSlow] = useState(1)
  const [shaperPorts, setShaperPorts] = useState('443,80,8080,8443')

  // Preset
  const [presetId, setPresetId] = useState('')
  const { data: presets = [] } = useQuery({
    queryKey: ['presets'],
    queryFn: presetsApi.list,
  })

  // Logs
  const [deployLines, setDeployLines] = useState<string[]>([])
  const [journalLines, setJournalLines] = useState<string[]>([])
  const [deploying, setDeploying] = useState(false)
  const [journaling, setJournaling] = useState(false)
  const [testing, setTesting] = useState(false)

  // Expose handle to parent
  telemtRef.current = {
    applyTelemt(t) {
      if (t.public_host !== undefined) setPublicHost(t.public_host ?? '')
      if (t.public_port !== undefined) setPublicPort(t.public_port ?? 443)
      if (t.server_port !== undefined) setServerPort(t.server_port ?? 443)
      if (t.metrics_port !== undefined) setMetricsPort(t.metrics_port ?? 9090)
      if (t.api_listen !== undefined) setApiListen(t.api_listen ?? '127.0.0.1:9091')
      if (t.tls_domain !== undefined) setTlsDomain(t.tls_domain ?? '')
      if (t.ad_tag !== undefined) setAdTag(t.ad_tag ?? '')
      if (t.mode_classic !== undefined) setModeClassic(!!t.mode_classic)
      if (t.mode_secure !== undefined) setModeSecure(!!t.mode_secure)
      if (t.mode_tls !== undefined) setModeTls(t.mode_tls !== false)
      if (t.log_level) setLogLevel(t.log_level)
      if (t.metrics_whitelist) setMetricsWhitelist(JSON.stringify(t.metrics_whitelist))
      if (t.api_whitelist) setApiWhitelist(JSON.stringify(t.api_whitelist))
      if (t.users && t.users.length) setUsers(t.users)
    },
    getValues() {
      let ssh: SSHAuth | null = null
      if (sshHost.trim()) {
        ssh = {
          host: sshHost.trim(),
          port: sshPort,
          username: sshUser.trim(),
          private_key: authMode === 'key' ? sshKey.trim() || null : null,
          private_key_passphrase: authMode === 'key' ? sshKeyPass || null : null,
          password: authMode === 'password' ? sshPassword.trim() || null : null,
        }
      }
      let metricsWl: string[] = []
      let apiWl: string[] = []
      try { metricsWl = JSON.parse(metricsWhitelist) } catch { metricsWl = [] }
      try { apiWl = JSON.parse(apiWhitelist) } catch { apiWl = [] }

      const telemt: TelemtConfig = {
        public_host: publicHost, public_port: publicPort, server_port: serverPort,
        metrics_port: metricsPort, api_listen: apiListen, tls_domain: tlsDomain,
        ad_tag: adTag, users, mode_classic: modeClassic, mode_secure: modeSecure,
        mode_tls: modeTls, log_level: logLevel,
        metrics_whitelist: metricsWl, api_whitelist: apiWl,
      }
      const fp = parsePortList(shaperPorts)
      const options: DeployOptions = {
        apt_update_upgrade: optApt, sysctl_file_limits: optSysctlLimits,
        sysctl_network: optSysctlNet, download_binary: optDownload,
        install_systemd: optSystemd, start_and_enable_service: optStart,
        verify_api: optVerify, binary_path: binaryPath,
        install_ufw: optUfw, install_fail2ban: optFail2ban,
        kernel_hardening_sysctl: optKernelHardening, install_traffic_shaper: optShaper,
        shaper_download_fast_mbytes_per_sec: shaperDlFast,
        shaper_download_slow_mbytes_per_sec: shaperDlSlow,
        shaper_upload_fast_mbytes_per_sec: shaperUlFast,
        shaper_upload_slow_mbytes_per_sec: shaperUlSlow,
        shaper_fast_tcp_ports: fp.length ? fp : [443, 80, 8080, 8443],
        ufw_extra_tcp_ports: parsePortList(ufwExtra),
      }
      return { ssh, telemt, options }
    },
  }

  function applyPreset() {
    const p = presets.find((x) => x.id === presetId)
    if (!p) return
    telemtRef.current?.applyTelemt(p.telemt)
    const o = p.options || {}
    if (o.apt_update_upgrade !== undefined) setOptApt(!!o.apt_update_upgrade)
    if (o.download_binary !== undefined) setOptDownload(!!o.download_binary)
    if (o.install_systemd !== undefined) setOptSystemd(!!o.install_systemd)
    if (o.start_and_enable_service !== undefined) setOptStart(!!o.start_and_enable_service)
    if (o.verify_api !== undefined) setOptVerify(!!o.verify_api)
    if (o.binary_path) setBinaryPath(o.binary_path)
    if (o.install_ufw !== undefined) setOptUfw(!!o.install_ufw)
    if (o.install_fail2ban !== undefined) setOptFail2ban(!!o.install_fail2ban)
    if (o.kernel_hardening_sysctl !== undefined) setOptKernelHardening(!!o.kernel_hardening_sysctl)
    if (o.install_traffic_shaper !== undefined) setOptShaper(!!o.install_traffic_shaper)
    toast.success(`Шаблон «${p.label}» применён`)
  }

  async function collectSshAuth(): Promise<SSHAuth> {
    const host = sshHost.trim()
    const user = sshUser.trim()
    if (!host) throw new Error('Укажите хост SSH')
    if (!user) throw new Error('Укажите пользователя SSH')
    if (authMode === 'key') {
      let pk = sshKey.trim()
      if (!pk && sshKeyFile) pk = await sshKeyFile.text()
      if (!pk) throw new Error('Укажите приватный ключ')
      return { host, port: sshPort, username: user, private_key: pk, private_key_passphrase: sshKeyPass || null, password: null }
    }
    if (!sshPassword.trim()) throw new Error('Укажите пароль SSH')
    return { host, port: sshPort, username: user, private_key: null, private_key_passphrase: null, password: sshPassword.trim() }
  }

  async function handleTest() {
    setDeployLines([])
    setTesting(true)
    try {
      const ssh = await collectSshAuth()
      setDeployLines(['Проверка SSH…'])
      const j = await serversApi.sshTest(ssh)
      setDeployLines([j.ok ? `✓ ${j.message}` : `✗ ${j.message}`])
    } catch (e) {
      setDeployLines([`✗ ${e instanceof Error ? e.message : e}`])
    } finally {
      setTesting(false)
    }
  }

  async function handleDeploy() {
    setDeployLines([])
    setDeploying(true)
    try {
      const ssh = await collectSshAuth()
      const { telemt, options } = telemtRef.current!.getValues()
      const payload = { ssh, telemt, options }
      const ws = deployWs.connect('/ws/deploy', (msg) => {
        const m = msg as { type: string; message?: string; ok?: boolean; error?: string }
        if (m.type === 'log') setDeployLines((p) => [...p, m.message ?? ''])
        else if (m.type === 'error') setDeployLines((p) => [...p, `✗ ${m.message}`])
        else if (m.type === 'done') {
          setDeployLines((p) => [...p, m.ok ? '── Успешно ──' : `── Ошибка: ${m.error ?? '?'} ──`])
          ws.close()
        }
      }, () => setDeploying(false))
      ws.onopen = () => ws.send(JSON.stringify(payload))
    } catch (e) {
      setDeployLines([`✗ ${e instanceof Error ? e.message : e}`])
      setDeploying(false)
    }
  }

  async function handleJournalStart() {
    setJournalLines([])
    setJournaling(true)
    try {
      const ssh = await collectSshAuth()
      const ws = journalWs.connect('/ws/journal', (msg) => {
        const m = msg as { type: string; message?: string }
        if (m.type === 'log') setJournalLines((p) => [...p, m.message ?? ''])
        else if (m.type === 'error') setJournalLines((p) => [...p, `✗ ${m.message}`])
        else if (m.type === 'done') setJournalLines((p) => [...p, '── конец потока ──'])
      }, () => setJournaling(false))
      ws.onopen = () => ws.send(JSON.stringify({ ssh }))
    } catch (e) {
      setJournalLines([`✗ ${e instanceof Error ? e.message : e}`])
      setJournaling(false)
    }
  }

  function handleJournalStop() {
    journalWs.disconnect()
    setJournaling(false)
  }

  async function handleSaveServer() {
    if (!sshHost.trim()) { toast.error('Заполните хост SSH'); return }
    try {
      const ssh = await collectSshAuth()
      if (selectedServer) {
        await updateServer.mutateAsync({
          id: selectedServer.id,
          body: {
            name: selectedServer.name,
            host: ssh.host, port: ssh.port, username: ssh.username,
            auth_mode: authMode,
            private_key: ssh.private_key, private_key_passphrase: ssh.private_key_passphrase,
            password: ssh.password,
          },
        })
        setDeployLines((p) => [...p, 'Профиль сервера обновлён.'])
      } else {
        onOpenServerDialog()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const checkboxCls = 'h-3.5 w-3.5 rounded border-bg-border accent-amber-500 cursor-pointer'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-bg-border bg-bg-surface px-4 py-2">
        <div className="flex items-center gap-1.5">
          {selectedServer && (
            <span className="text-xs text-text-muted">
              <span className="text-text-secondary font-medium">{selectedServer.name}</span>
              <span className="mx-1 text-bg-border">·</span>
              <span className="font-mono">{selectedServer.host}</span>
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Preset */}
          <div className="flex items-center gap-1">
            <select
              className="h-7 rounded-btn bg-bg-elevated border border-bg-border px-2 text-xs text-text-secondary focus:outline-none focus:border-accent/50"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              <option value="">Шаблон…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <Button variant="ghost" size="sm" onClick={applyPreset} disabled={!presetId}>
              Применить
            </Button>
          </div>
          <div className="h-4 w-px bg-bg-border" />
          <Button variant="secondary" size="sm" onClick={handleTest} loading={testing}>
            <FlaskConical className="h-3.5 w-3.5" /> SSH тест
          </Button>
          <Button variant="primary" size="sm" onClick={handleDeploy} loading={deploying}>
            <Rocket className="h-3.5 w-3.5" /> Развернуть
          </Button>
          <Button variant="secondary" size="sm" onClick={handleJournalStart} disabled={journaling}>
            <Terminal className="h-3.5 w-3.5" /> journalctl
          </Button>
          {journaling && (
            <Button variant="danger" size="sm" onClick={handleJournalStop}>
              <StopCircle className="h-3.5 w-3.5" /> Стоп
            </Button>
          )}
          <div className="h-4 w-px bg-bg-border" />
          <Button variant="accent" size="sm" onClick={handleSaveServer}>
            <Save className="h-3.5 w-3.5" /> Сохранить
          </Button>
        </div>
      </div>

      {/* Warning banner */}
      <div className="shrink-0 border-b border-warning/20 bg-warning/5 px-4 py-2">
        <div className="flex items-start gap-2 text-xs text-warning/90">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Доступ по <strong>http://IP:порт</strong> без шифрования — ограничьте порт файрволом/VPN.
            SSH-ключи передаются через WebSocket на тот же хост, не открывайте панель в публичный интернет.
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* SSH */}
          <Card>
            <CardHeader>
              <KeyRound className="h-3.5 w-3.5 text-text-muted" />
              <CardTitle>Подключение SSH</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Auth toggle */}
              <div className="space-y-1.5">
                <Label>Способ входа</Label>
                <div className="flex gap-1 p-0.5 rounded-btn bg-bg-elevated border border-bg-border w-fit">
                  {(['key', 'password'] as AuthMode[]).map((m) => (
                    <button key={m} type="button" onClick={() => setAuthMode(m)}
                      className={cn('flex items-center gap-1.5 px-3 h-6 rounded text-xs font-medium transition-all',
                        authMode === m ? 'bg-bg-surface border border-bg-border text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                      )}>
                      {m === 'key' ? <><KeyRound className="h-3 w-3" />Ключ</> : <><Lock className="h-3 w-3" />Пароль</>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ssh-host">Хост</Label>
                <Input id="ssh-host" placeholder="203.0.113.10" value={sshHost} onChange={(e) => setSshHost(e.target.value)} autoComplete="off" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ssh-port">Порт</Label>
                  <Input id="ssh-port" type="number" min={1} max={65535} value={sshPort} onChange={(e) => setSshPort(Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ssh-user">Пользователь</Label>
                  <Input id="ssh-user" value={sshUser} onChange={(e) => setSshUser(e.target.value)} autoComplete="off" name="ssh-remote-user" />
                </div>
              </div>
              {authMode === 'key' ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-key-file">Ключ (файл)</Label>
                    <Input id="ssh-key-file" type="file" accept=".pem,.key,*"
                      onChange={(e) => { setSshKeyFile(e.target.files?.[0] ?? null); setSshKey('') }} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-key">Ключ (текст)</Label>
                    <Textarea id="ssh-key" rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      value={sshKey} onChange={(e) => { setSshKey(e.target.value); setSshKeyFile(null) }} className="text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-key-pass">Пароль от ключа</Label>
                    <Input id="ssh-key-pass" type="password" value={sshKeyPass} onChange={(e) => setSshKeyPass(e.target.value)} autoComplete="off" />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="ssh-password">Пароль SSH</Label>
                  <Input
                    id="ssh-password"
                    type="password"
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    autoComplete="new-password"
                    name="ssh-remote-secret"
                    data-lpignore="true"
                    data-1p-ignore
                    data-form-type="other"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Telemt config */}
          <Card>
            <CardHeader>
              <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
              <CardTitle>Конфиг Telemt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="public-host">public_host</Label>
                <Input id="public-host" placeholder="proxy.example.com" value={publicHost} onChange={(e) => setPublicHost(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>public_port</Label>
                  <Input type="number" value={publicPort} onChange={(e) => setPublicPort(Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>server.port</Label>
                  <Input type="number" value={serverPort} onChange={(e) => setServerPort(Number(e.target.value))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>metrics_port</Label>
                  <Input type="number" value={metricsPort} onChange={(e) => setMetricsPort(Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>api listen</Label>
                  <Input className="font-mono text-xs" value={apiListen} onChange={(e) => setApiListen(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>censorship.tls_domain</Label>
                <Input placeholder="example.com" value={tlsDomain} onChange={(e) => setTlsDomain(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>ad_tag (32 hex)</Label>
                <div className="flex gap-1">
                  <Input className="font-mono text-xs" maxLength={32} value={adTag} onChange={(e) => setAdTag(e.target.value)} />
                  <Button variant="ghost" size="icon" title="Генерировать" onClick={() => setAdTag(randomHex32())}>
                    <Shuffle className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Режимы ссылок</Label>
                <div className="flex gap-4">
                  {[
                    ['classic', modeClassic, setModeClassic],
                    ['secure', modeSecure, setModeSecure],
                    ['tls', modeTls, setModeTls],
                  ].map(([label, val, set]) => (
                    <label key={String(label)} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" className={checkboxCls}
                        checked={val as boolean}
                        onChange={(e) => (set as (v: boolean) => void)(e.target.checked)} />
                      <span className="text-xs text-text-secondary">{String(label)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>log_level</Label>
                <Select value={logLevel} onValueChange={(v) => setLogLevel(v as typeof logLevel)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['normal', 'verbose', 'debug', 'silent'].map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>metrics_whitelist (JSON)</Label>
                <Input className="font-mono text-xs" value={metricsWhitelist} onChange={(e) => setMetricsWhitelist(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>api whitelist (JSON)</Label>
                <Input className="font-mono text-xs" value={apiWhitelist} onChange={(e) => setApiWhitelist(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {/* Users */}
          <Card>
            <CardHeader>
              <CardTitle>Пользователи</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-text-muted">Секрет — 32 hex символа.</p>
              <div className="space-y-2">
                {users.map((u, i) => (
                  <UserRow key={i} user={u}
                    onChange={(nu) => setUsers((p) => p.map((x, j) => j === i ? nu : x))}
                    onRemove={() => setUsers((p) => p.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setUsers((p) => [...p, { username: '', secret_hex: '' }])}>
                <Plus className="h-3.5 w-3.5" /> Добавить пользователя
              </Button>
            </CardContent>
          </Card>

          {/* Deploy options */}
          <Card>
            <CardHeader>
              <Rocket className="h-3.5 w-3.5 text-text-muted" />
              <CardTitle>Опции деплоя</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  ['apt update & upgrade', optApt, setOptApt],
                  ['limits в sysctl.conf', optSysctlLimits, setOptSysctlLimits],
                  ['sysctl.d + limits.conf', optSysctlNet, setOptSysctlNet],
                  ['скачать telemt', optDownload, setOptDownload],
                  ['systemd unit', optSystemd, setOptSystemd],
                  ['enable + restart', optStart, setOptStart],
                  ['curl /v1/users', optVerify, setOptVerify],
                ].map(([label, val, set]) => (
                  <label key={String(label)} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className={checkboxCls}
                      checked={val as boolean}
                      onChange={(e) => (set as (v: boolean) => void)(e.target.checked)} />
                    <span className="text-xs text-text-secondary">{String(label)}</span>
                  </label>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label>Путь к бинарнику</Label>
                <Select value={binaryPath} onValueChange={setBinaryPath}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="/bin/telemt">/bin/telemt</SelectItem>
                    <SelectItem value="/usr/local/bin/telemt">/usr/local/bin/telemt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Security */}
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Безопасность и шейпер</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  {[
                    ['UFW: SSH + порты Telemt + доп.', optUfw, setOptUfw],
                    ['Fail2Ban SSH: бан 24ч, 3 попытки/600с', optFail2ban, setOptFail2ban],
                    ['Kernel hardening (sysctl)', optKernelHardening, setOptKernelHardening],
                    ['Шейпер трафика (tc)', optShaper, setOptShaper],
                  ].map(([label, val, set]) => (
                    <label key={String(label)} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className={checkboxCls}
                        checked={val as boolean}
                        onChange={(e) => (set as (v: boolean) => void)(e.target.checked)} />
                      <span className="text-xs text-text-secondary">{String(label)}</span>
                    </label>
                  ))}
                  <div className="space-y-1.5 pt-1">
                    <Label>Доп. TCP порты для UFW (через запятую)</Label>
                    <Input className="font-mono text-xs" placeholder="51820, …" value={ufwExtra} onChange={(e) => setUfwExtra(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">Скачивание, МБ/с</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Быстрые порты</Label><Input type="number" step={0.125} min={0.125} value={shaperDlFast} onChange={(e) => setShaperDlFast(Number(e.target.value))} /></div>
                    <div className="space-y-1"><Label>Остальное</Label><Input type="number" step={0.125} min={0.125} value={shaperDlSlow} onChange={(e) => setShaperDlSlow(Number(e.target.value))} /></div>
                  </div>
                  <p className="text-xs text-text-muted">Загрузка, МБ/с</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Быстрые порты</Label><Input type="number" step={0.125} min={0.125} value={shaperUlFast} onChange={(e) => setShaperUlFast(Number(e.target.value))} /></div>
                    <div className="space-y-1"><Label>Остальное</Label><Input type="number" step={0.125} min={0.125} value={shaperUlSlow} onChange={(e) => setShaperUlSlow(Number(e.target.value))} /></div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Быстрые TCP порты</Label>
                    <Input className="font-mono text-xs" value={shaperPorts} onChange={(e) => setShaperPorts(e.target.value)} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Logs */}
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <LogPanel title="Журнал деплоя" lines={deployLines} empty="Ожидание…" />
          <LogPanel title="journalctl -f -u telemt" lines={journalLines} empty="Запустите live." />
        </div>
      </div>
    </div>
  )
}
