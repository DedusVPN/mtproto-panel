import { useState, useEffect, useCallback } from 'react'
import {
  Bell, BellOff, RefreshCw, Send, CheckCircle2, XCircle,
  HelpCircle, Activity, Server as ServerIcon, Settings2, Eye, EyeOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { monitor as monitorApi } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/components/ui/utils'
import { useServers } from '@/hooks/useServers'
import type {
  MonitorSettings, MonitorStatusResponse, ProxyStatus,
} from '@/types'

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: MonitorSettings = {
  enabled: false,
  telegram_bot_token: '',
  telegram_chat_id: '',
  telegram_thread_id: '',
  telegram_api_base_url: '',
  check_interval_seconds: 60,
  connect_timeout_seconds: 10,
  failure_threshold: 2,
  servers: {},
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function ProxyStatusBadge({ status }: { status: ProxyStatus }) {
  if (status === 'up') {
    return (
      <span className="inline-flex items-center gap-1 text-success text-xs font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Доступен
      </span>
    )
  }
  if (status === 'down') {
    return (
      <span className="inline-flex items-center gap-1 text-danger text-xs font-medium">
        <XCircle className="h-3.5 w-3.5" />
        Недоступен
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-text-muted text-xs font-medium">
      <HelpCircle className="h-3.5 w-3.5" />
      Неизвестно
    </span>
  )
}

function formatTs(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function MonitorPage() {
  const { data: serverList = [], isLoading: serversLoading } = useServers()

  const [settings, setSettings] = useState<MonitorSettings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState<MonitorStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [testingTg, setTestingTg] = useState(false)
  const [showToken, setShowToken] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([monitorApi.getSettings(), monitorApi.status()])
      setSettings(s)
      setStatus(st)
    } catch (e) {
      toast.error(`Ошибка загрузки: ${e}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])

  async function handleSave() {
    setSaving(true)
    try {
      const saved = await monitorApi.putSettings(settings)
      setSettings(saved)
      toast.success('Настройки сохранены')
    } catch (e) {
      toast.error(`Ошибка сохранения: ${e}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleCheckNow() {
    setChecking(true)
    try {
      const res = await monitorApi.checkNow()
      setStatus({ running: status?.running ?? false, servers: res.servers })
      toast.success('Проверка выполнена')
    } catch (e) {
      toast.error(`Ошибка проверки: ${e}`)
    } finally {
      setChecking(false)
    }
  }

  async function handleTestTelegram() {
    setTestingTg(true)
    try {
      const res = await monitorApi.testTelegram(settings)
      if (res.ok) {
        toast.success('Тестовое сообщение отправлено в Telegram')
      } else {
        toast.error(`Ошибка Telegram: ${res.message}`)
      }
    } catch (e) {
      toast.error(`Ошибка: ${e}`)
    } finally {
      setTestingTg(false)
    }
  }

  function setServerEnabled(serverId: string, enabled: boolean) {
    setSettings((prev) => {
      const existing = prev.servers[serverId] ?? { proxy_port: 443, enabled: true }
      return {
        ...prev,
        servers: { ...prev.servers, [serverId]: { ...existing, enabled } },
      }
    })
  }

  function setServerPort(serverId: string, port: number) {
    setSettings((prev) => {
      const existing = prev.servers[serverId] ?? { proxy_port: 443, enabled: true }
      return {
        ...prev,
        servers: { ...prev.servers, [serverId]: { ...existing, proxy_port: port } },
      }
    })
  }

  if (loading || serversLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-bg-border border-t-accent" />
      </div>
    )
  }

  const monitoredCount = serverList.filter(
    (s) => settings.servers[s.id]?.enabled,
  ).length

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 border border-accent/20">
              <Activity className="h-4.5 w-4.5 text-accent" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-text-primary">Мониторинг прокси</h1>
              <p className="text-[11px] text-text-muted">
                Отслеживание доступности MTProto прокси с Telegram-уведомлениями
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCheckNow}
              disabled={checking}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />
              Проверить сейчас
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5 text-xs">
              Сохранить
            </Button>
          </div>
        </div>

        {/* Global toggle */}
        <Card>
          <CardContent className="flex items-center justify-between py-4 px-5">
            <div className="flex items-center gap-3">
              {settings.enabled
                ? <Bell className="h-4 w-4 text-accent" />
                : <BellOff className="h-4 w-4 text-text-muted" />}
              <div>
                <div className="text-xs font-medium text-text-primary">
                  {settings.enabled ? 'Мониторинг включён' : 'Мониторинг выключен'}
                </div>
                <div className="text-[10px] text-text-muted">
                  {settings.enabled
                    ? `Отслеживается ${monitoredCount} из ${serverList.length} серверов`
                    : 'Проверки не выполняются'}
                </div>
              </div>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(v) => setSettings((p) => ({ ...p, enabled: v }))}
            />
          </CardContent>
        </Card>

        {/* Telegram settings */}
        <Card>
          <CardHeader className="pb-3 pt-4 px-5">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold text-text-primary uppercase tracking-wider">
              <Send className="h-3.5 w-3.5 text-accent" />
              Telegram-уведомления
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-5 pb-5">
            {/* Декой без type=password — иначе браузер связывает с полем токена и предлагает сохранить */}
            <input type="text" name="prevent_autofill_user" style={{ display: 'none' }} readOnly tabIndex={-1} autoComplete="off" aria-hidden />
            <input type="text" name="prevent_autofill_pass" style={{ display: 'none' }} readOnly tabIndex={-1} autoComplete="off" aria-hidden />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[11px] text-text-muted">Bot Token</Label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    placeholder="1234567890:AAH…"
                    value={settings.telegram_bot_token}
                    onChange={(e) => setSettings((p) => ({ ...p, telegram_bot_token: e.target.value }))}
                    className="text-xs font-mono pr-8"
                    autoComplete="new-password"
                    name="telegram-botfather-token"
                    data-lpignore="true"
                    data-1p-ignore
                    data-form-type="other"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                    tabIndex={-1}
                    title={showToken ? 'Скрыть' : 'Показать'}
                  >
                    {showToken
                      ? <EyeOff className="h-3.5 w-3.5" />
                      : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="text-[10px] text-text-muted">
                  Токен из @BotFather
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-text-muted">Chat ID</Label>
                <Input
                  placeholder="-1001234567890"
                  value={settings.telegram_chat_id}
                  onChange={(e) => setSettings((p) => ({ ...p, telegram_chat_id: e.target.value }))}
                  className="text-xs font-mono"
                  autoComplete="off"
                  name="tg-chat-id"
                  data-lpignore="true"
                  data-form-type="other"
                />
                <p className="text-[10px] text-text-muted">
                  ID чата или канала (можно узнать через @userinfobot)
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-muted">
                Thread ID
                <span className="ml-1.5 text-[10px] text-text-muted/60 font-normal normal-case tracking-normal">
                  (опционально — для топика форума супергруппы)
                </span>
              </Label>
              <Input
                placeholder="12345"
                value={settings.telegram_thread_id}
                onChange={(e) => setSettings((p) => ({ ...p, telegram_thread_id: e.target.value }))}
                className="text-xs font-mono max-w-[200px]"
                autoComplete="off"
                name="tg-thread-id"
                data-lpignore="true"
                data-form-type="other"
              />
              <p className="text-[10px] text-text-muted leading-relaxed">
                Если супергруппа использует форум с топиками — укажите ID нужного топика
                (<code className="font-mono">message_thread_id</code>).
                Получить можно переслав любое сообщение из топика боту
                <code className="font-mono ml-1">@JsonDumpBot</code> и найдя поле{' '}
                <code className="font-mono">message_thread_id</code>.
                Оставьте пустым для отправки в общий чат.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-muted">
                API Base URL
                <span className="ml-1.5 text-[10px] text-text-muted/60 font-normal normal-case tracking-normal">
                  (опционально — для reverse-proxy)
                </span>
              </Label>
              <Input
                placeholder="https://api.telegram.org"
                value={settings.telegram_api_base_url}
                onChange={(e) => setSettings((p) => ({ ...p, telegram_api_base_url: e.target.value }))}
                className="text-xs font-mono"
                autoComplete="off"
                name="tg-api-base"
                data-lpignore="true"
                data-form-type="other"
              />
              <p className="text-[10px] text-text-muted leading-relaxed">
                Если Telegram заблокирован — укажите адрес своего reverse-proxy
                (например <code className="font-mono">https://tg.my-domain.com</code>).
                Оставьте пустым для использования официального <code className="font-mono">api.telegram.org</code>.
              </p>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleTestTelegram}
              disabled={testingTg || !settings.telegram_bot_token || !settings.telegram_chat_id}
              className="gap-1.5 text-xs border border-bg-border"
            >
              <Send className={cn('h-3.5 w-3.5', testingTg && 'animate-pulse')} />
              Отправить тестовое сообщение
            </Button>
          </CardContent>
        </Card>

        {/* Check parameters */}
        <Card>
          <CardHeader className="pb-3 pt-4 px-5">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold text-text-primary uppercase tracking-wider">
              <Settings2 className="h-3.5 w-3.5 text-accent" />
              Параметры проверки
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3 px-5 pb-5">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-muted">Интервал (сек)</Label>
              <Input
                type="number"
                min={10}
                max={3600}
                value={settings.check_interval_seconds}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, check_interval_seconds: Number(e.target.value) }))
                }
                className="text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-muted">Таймаут соединения (сек)</Label>
              <Input
                type="number"
                min={2}
                max={60}
                value={settings.connect_timeout_seconds}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, connect_timeout_seconds: Number(e.target.value) }))
                }
                className="text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-text-muted">Неудач до уведомления</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.failure_threshold}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, failure_threshold: Number(e.target.value) }))
                }
                className="text-xs"
              />
            </div>
          </CardContent>
        </Card>

        {/* Per-server config + status */}
        <Card>
          <CardHeader className="pb-3 pt-4 px-5">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold text-text-primary uppercase tracking-wider">
              <ServerIcon className="h-3.5 w-3.5 text-accent" />
              Серверы
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {serverList.length === 0 ? (
              <p className="text-xs text-text-muted py-4 text-center">
                Нет сохранённых серверов. Добавьте серверы на вкладке «Серверы».
              </p>
            ) : (
              <div className="space-y-2">
                {serverList.map((srv) => {
                  const cfg = settings.servers[srv.id] ?? { proxy_port: 443, enabled: false }
                  const srvStatus = status?.servers[srv.id]
                  return (
                    <ServerMonitorRow
                      key={srv.id}
                      serverName={srv.name}
                      serverHost={srv.host}
                      enabled={cfg.enabled}
                      proxyPort={cfg.proxy_port}
                      checkStatus={srvStatus ? {
                        status: srvStatus.status,
                        last_check_ts: srvStatus.last_check_ts,
                        last_change_ts: srvStatus.last_change_ts,
                        consecutive_failures: srvStatus.consecutive_failures,
                        last_error: srvStatus.last_error,
                      } : undefined}
                      onEnabledChange={(v) => setServerEnabled(srv.id, v)}
                      onPortChange={(v) => setServerPort(srv.id, v)}
                    />
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Scheduler status */}
        {status && (
          <div className="flex items-center gap-2 px-1">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                status.running ? 'bg-success' : 'bg-text-muted/40',
              )}
            />
            <span className="text-[11px] text-text-muted">
              {status.running ? 'Планировщик мониторинга работает' : 'Планировщик не запущен'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Server row ───────────────────────────────────────────────────────────────

interface ServerMonitorRowProps {
  serverName: string
  serverHost: string
  enabled: boolean
  proxyPort: number
  checkStatus?: {
    status: ProxyStatus
    last_check_ts: number | null
    last_change_ts: number | null
    consecutive_failures: number
    last_error: string | null
  }
  onEnabledChange: (v: boolean) => void
  onPortChange: (v: number) => void
}

function ServerMonitorRow({
  serverName,
  serverHost,
  enabled,
  proxyPort,
  checkStatus,
  onEnabledChange,
  onPortChange,
}: ServerMonitorRowProps) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 transition-colors',
        enabled ? 'border-bg-border bg-bg-surface' : 'border-bg-border/50 bg-bg-base opacity-60',
      )}
    >
      <div className="flex items-center gap-3">
        {/* Enable toggle */}
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />

        {/* Server info */}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-text-primary truncate">{serverName}</div>
          <div className="text-[10px] text-text-muted font-mono truncate">
            {serverHost}
          </div>
        </div>

        {/* Port input */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-text-muted whitespace-nowrap">Порт прокси:</span>
          <Input
            type="number"
            min={1}
            max={65535}
            value={proxyPort}
            onChange={(e) => onPortChange(Number(e.target.value))}
            className="w-20 text-xs text-center h-7 py-0"
            disabled={!enabled}
          />
        </div>

        {/* Status */}
        <div className="shrink-0 min-w-[90px] text-right">
          {checkStatus ? (
            <ProxyStatusBadge status={checkStatus.status} />
          ) : (
            <span className="text-[10px] text-text-muted">Нет данных</span>
          )}
        </div>
      </div>

      {/* Last check details */}
      {checkStatus && (
        <div className="mt-2 ml-9 flex flex-wrap gap-x-4 gap-y-0.5">
          <span className="text-[10px] text-text-muted">
            Проверка: {formatTs(checkStatus.last_check_ts)}
          </span>
          {checkStatus.last_change_ts && (
            <span className="text-[10px] text-text-muted">
              Изменение: {formatTs(checkStatus.last_change_ts)}
            </span>
          )}
          {checkStatus.status === 'down' && checkStatus.consecutive_failures > 0 && (
            <Badge variant="danger" className="text-[9px] px-1.5 py-0 h-4">
              {checkStatus.consecutive_failures} неудач подряд
            </Badge>
          )}
          {checkStatus.last_error && checkStatus.status === 'down' && (
            <span className="text-[10px] text-danger/80 truncate max-w-xs" title={checkStatus.last_error}>
              {checkStatus.last_error}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
