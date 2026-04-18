import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw, Server, CheckCircle2, AlertCircle } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useServers } from '@/hooks/useServers'
import { useAppStore } from '@/store'
import { metrics as metricsApi } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/components/ui/utils'
import type { MetricPoint, MetricsCards, StoredServer } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVER_COLORS = [
  '#f59e0b', // gold — primary, matches logo
  '#34d399', // emerald
  '#60a5fa', // blue
  '#f43f5e', // red
  '#a78bfa', // violet
  '#22d3ee', // cyan
  '#fb923c', // orange
  '#84cc16', // lime
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNum(v: unknown): string {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  if (Math.abs(n) >= 1e9) return n.toExponential(3)
  return Number.isInteger(n)
    ? n.toLocaleString('ru-RU')
    : n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
}

function fmtTime(ms: number) {
  const d = new Date(ms)
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function derivative(points: MetricPoint[], key: string): { t: number; v: number }[] {
  const arr: { t: number; v: number }[] = []
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t
    if (dt <= 0) continue
    const v0 = points[i - 1].m[key]
    const v1 = points[i].m[key]
    if (v0 == null || v1 == null) continue
    arr.push({ t: points[i].t * 1000, v: Math.max(0, (v1 - v0) / dt) })
  }
  return arr
}

function gauge(points: MetricPoint[], key: string): { t: number; v: number }[] {
  return points.filter((p) => p.m[key] != null).map((p) => ({ t: p.t * 1000, v: p.m[key] }))
}

function firstKey(points: MetricPoint[], prefix: string): string | null {
  const keys = new Set<string>()
  points.forEach((p) => Object.keys(p.m).forEach((k) => { if (k.startsWith(prefix)) keys.add(k) }))
  return Array.from(keys).sort()[0] ?? null
}

// ─── Per-server state ─────────────────────────────────────────────────────────

interface ServerMetrics {
  points: MetricPoint[]
  cards: MetricsCards | null
  snapping: boolean
  historyLoading: boolean
  error: string
  lastSnap: number | null
}

const EMPTY_METRICS: ServerMetrics = {
  points: [], cards: null, snapping: false, historyLoading: false, error: '', lastSnap: null,
}

// ─── KPI grid card for one server ────────────────────────────────────────────

function ServerKpiCard({
  server, metrics, color, onSnapshot,
}: {
  server: StoredServer
  metrics: ServerMetrics
  color: string
  onSnapshot: () => void
}) {
  const m = metrics.points.at(-1)?.m ?? {}
  const cards = metrics.cards
  const perUser = cards?.per_user_connections_current
  const sessionCount = perUser
    ? Object.values(perUser).reduce((a, v) => a + (Number(v) || 0), 0)
    : Object.entries(m)
        .filter(([k]) => k.startsWith('telemt_user_connections_current{'))
        .reduce((a, [, v]) => a + (Number(v) || 0), 0)

  const hasData = !!cards || Object.keys(m).length > 0

  const kpis = [
    { label: 'Сессии',      value: fmtNum(sessionCount),                                                                                                                          accent: 'success' as const },
    { label: 'Соединений',  value: fmtNum(cards?.connections_total ?? m.telemt_connections_total) },
    { label: 'Плохих',      value: fmtNum(cards?.connections_bad_total ?? m.telemt_connections_bad_total),                                                                         accent: 'danger' as const },
    { label: 'Writers a/w', value: `${fmtNum(cards?.writers_active ?? m.telemt_me_writers_active_current)}/${fmtNum(cards?.writers_warm ?? m.telemt_me_writers_warm_current)}` },
    { label: 'Up OK/fail',  value: `${fmtNum(cards?.upstream_connect_success ?? m.telemt_upstream_connect_success_total)}/${fmtNum(cards?.upstream_connect_fail ?? m.telemt_upstream_connect_fail_total)}` },
    { label: 'Uptime',      value: fmtNum(m.telemt_uptime_seconds) + '\u202fс' },
  ]

  return (
    <div className={cn(
      'relative flex flex-col gap-2.5 rounded-lg bg-bg-elevated px-3.5 py-3 transition-opacity overflow-hidden',
      !hasData && !metrics.snapping && 'opacity-55'
    )}>
      {/* Left color accent stripe */}
      <span className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-lg" style={{ background: color }} />

      {/* Header row */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-text-primary truncate leading-tight">{server.name}</div>
          <div className="text-[10px] text-text-muted font-mono truncate leading-tight">{server.host}</div>
        </div>
        {/* Status + time */}
        <div className="shrink-0 flex items-center gap-1.5">
          {metrics.lastSnap && !metrics.snapping && (
            <span className="text-[10px] text-text-muted/50 font-mono hidden sm:block">
              {new Date(metrics.lastSnap).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          {metrics.snapping
            ? <Spinner className="h-3 w-3" />
            : metrics.error
              ? <span title={metrics.error}><AlertCircle className="h-3.5 w-3.5 text-danger" /></span>
              : hasData
                ? <CheckCircle2 className="h-3 w-3 text-success/50" />
                : <Server className="h-3 w-3 text-text-muted/25" />
          }
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-overlay transition-colors"
            onClick={onSnapshot}
            title="Снять снимок"
          >
            <RefreshCw className={cn('h-3 w-3', metrics.snapping && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* KPI values grid */}
      {!hasData && !metrics.snapping ? (
        <span className="text-[10px] text-text-muted italic">нет данных</span>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
          {kpis.map(({ label, value, accent }) => (
            <div key={label} className="min-w-0">
              <div className="text-[9px] text-text-muted uppercase tracking-wide leading-none mb-0.5">{label}</div>
              <div className={cn(
                'text-sm font-bold font-mono tabular-nums truncate leading-tight',
                accent === 'success' ? 'text-success' :
                accent === 'danger' ? 'text-danger' :
                'text-text-primary'
              )}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Multi-server chart ───────────────────────────────────────────────────────

function MultiChart({ title, hint, serverDatasets }: {
  title: string
  hint?: string
  serverDatasets: Array<{ id: string; name: string; color: string; data: { t: number; v: number }[] }>
}) {
  const allEmpty = serverDatasets.every((s) => s.data.length === 0)

  const allTs = [...new Set(serverDatasets.flatMap((s) => s.data.map((p) => p.t)))].sort((a, b) => a - b)
  const merged = allTs.map((t) => {
    const obj: Record<string, number | null> = { t }
    serverDatasets.forEach((s) => {
      const closest = s.data.reduce<{ t: number; v: number } | null>((best, p) => {
        if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) return p
        return best
      }, null)
      obj[s.id] = closest && Math.abs(closest.t - t) < 120_000 ? closest.v : null
    })
    return obj
  })

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {hint && <p className="text-[10px] text-text-muted mt-0.5 font-mono truncate">{hint}</p>}
        </div>
      </CardHeader>
      <CardContent className="pt-2 pb-4 px-2">
        {allEmpty ? (
          <div className="flex h-48 items-center justify-center">
            <p className="text-xs text-text-muted">Нет данных в истории</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={merged}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,49,66,0.5)" />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']}
                tickFormatter={fmtTime} tick={{ fill: '#8b93a8', fontSize: 10 }}
                tickLine={false} axisLine={false} tickCount={5} />
              <YAxis tick={{ fill: '#8b93a8', fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                contentStyle={{ background: '#1c1a14', border: '1px solid #2e2a1a', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#8b93a8' }}
                labelFormatter={(v) => fmtTime(Number(v))}
                formatter={(v: number, _k, item) => {
                  const sd = serverDatasets.find((s) => s.id === item.dataKey)
                  return [v == null ? '—' : v.toFixed(4), sd?.name ?? item.dataKey]
                }}
              />
              {serverDatasets.length > 1 && (
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }}
                  formatter={(val) => serverDatasets.find((s) => s.id === val)?.name ?? val} />
              )}
              {serverDatasets.map((s) => (
                <Line key={s.id} type="monotone" dataKey={s.id} stroke={s.color}
                  dot={false} strokeWidth={2} isAnimationActive={false}
                  connectNulls={false} name={s.name} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function StatsPage() {
  const { data: allServers = [] } = useServers()
  const { statsHistoryRange, setStatsHistoryRange } = useAppStore()

  const [metricsPort, setMetricsPort] = useState(9090)
  const [autoSnap, setAutoSnap] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [serverMetrics, setServerMetrics] = useState<Record<string, ServerMetrics>>({})
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (allServers.length && selectedIds.size === 0) {
      setSelectedIds(new Set(allServers.map((s) => s.id)))
    }
  }, [allServers]) // eslint-disable-line react-hooks/exhaustive-deps

  function patchMetrics(id: string, patch: Partial<ServerMetrics>) {
    setServerMetrics((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? EMPTY_METRICS), ...patch },
    }))
  }

  const loadHistory = useCallback(async (id: string, range: string) => {
    patchMetrics(id, { historyLoading: true })
    try {
      const hours = range === 'all' ? undefined : Number(range)
      const data = await metricsApi.history(id, hours)
      setServerMetrics((prev) => {
        const cur = prev[id] ?? EMPTY_METRICS
        return {
          ...prev,
          [id]: {
            ...cur,
            points: data.points ?? [],
            cards: cur.cards ?? data.last_cards ?? null,
            historyLoading: false,
          },
        }
      })
    } catch {
      patchMetrics(id, { historyLoading: false })
    }
  }, [])

  const takeSnapshot = useCallback(async (id: string, port: number, silent = false) => {
    if (!silent) patchMetrics(id, { snapping: true, error: '' })
    else patchMetrics(id, { snapping: true })
    try {
      const j = await metricsApi.snapshot(id, port)
      setServerMetrics((prev) => {
        const cur = prev[id] ?? EMPTY_METRICS
        return {
          ...prev,
          [id]: {
            ...cur,
            snapping: false,
            error: j.ok ? '' : (j.message ?? 'Ошибка'),
            cards: j.ok && j.cards ? j.cards : cur.cards,
            lastSnap: j.ok ? Date.now() : cur.lastSnap,
          },
        }
      })
      if (j.ok) await loadHistory(id, statsHistoryRange)
    } catch (e) {
      patchMetrics(id, { snapping: false, error: e instanceof Error ? e.message : String(e) })
    }
  }, [loadHistory, statsHistoryRange])

  const prevSelectedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const newIds = [...selectedIds].filter((id) => !prevSelectedRef.current.has(id))
    prevSelectedRef.current = new Set(selectedIds)
    newIds.forEach((id) => {
      void loadHistory(id, statsHistoryRange)
      void takeSnapshot(id, metricsPort, true)
    })
  }, [selectedIds]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    selectedIds.forEach((id) => void loadHistory(id, statsHistoryRange))
  }, [statsHistoryRange]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (autoSnap && selectedIds.size > 0) {
      timerRef.current = setInterval(() => {
        selectedIds.forEach((id) => void takeSnapshot(id, metricsPort, true))
      }, 60_000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [autoSnap, selectedIds, metricsPort]) // eslint-disable-line react-hooks/exhaustive-deps

  function snapshotAll() {
    selectedIds.forEach((id) => void takeSnapshot(id, metricsPort, false))
  }

  function toggleServer(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedServers = allServers.filter((s) => selectedIds.has(s.id))

  function buildDatasets(fn: (srv: StoredServer) => { t: number; v: number }[]) {
    return selectedServers.map((srv, i) => ({
      id: srv.id,
      name: srv.name,
      color: SERVER_COLORS[i % SERVER_COLORS.length],
      data: fn(srv),
    }))
  }

  const getPoints = (srv: StoredServer) => serverMetrics[srv.id]?.points ?? []

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-bg-border bg-bg-surface px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Порт метрик</span>
          <input type="number" min={1} max={65535}
            className="h-7 w-20 rounded-btn bg-bg-elevated border border-bg-border px-2 text-xs text-text-primary focus:outline-none focus:border-accent/50"
            value={metricsPort} onChange={(e) => setMetricsPort(Number(e.target.value))} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Период</span>
          <Select value={statsHistoryRange} onValueChange={setStatsHistoryRange}>
            <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Всё (48 ч)</SelectItem>
              {['1', '6', '12', '24', '48'].map((v) => (
                <SelectItem key={v} value={v}>{v} ч</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" className="h-3.5 w-3.5 rounded accent-amber-500"
            checked={autoSnap} onChange={(e) => setAutoSnap(e.target.checked)} />
          <span className="text-xs text-text-secondary">Авто 60 с</span>
        </label>
        <Button variant="primary" size="sm" onClick={snapshotAll} disabled={selectedIds.size === 0}>
          <RefreshCw className="h-3.5 w-3.5" /> Снять снимок
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Server picker — matches Sidebar width/style */}
        <div className="w-56 shrink-0 border-r border-bg-border bg-bg-surface flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-bg-border">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Серверы мониторинга
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            {allServers.length === 0 && (
              <p className="px-3 py-4 text-xs text-text-muted text-center">Нет серверов</p>
            )}
            {allServers.map((srv, i) => {
              const checked = selectedIds.has(srv.id)
              const color = SERVER_COLORS[i % SERVER_COLORS.length]
              const srvMetrics = serverMetrics[srv.id]
              return (
                <label key={srv.id} className={cn(
                  'group flex items-center gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 transition-all border',
                  checked
                    ? 'bg-bg-elevated border-bg-border/80'
                    : 'border-transparent opacity-50 hover:opacity-80 hover:bg-bg-elevated/50'
                )}>
                  <input type="checkbox" className="sr-only" checked={checked}
                    onChange={() => toggleServer(srv.id)} />
                  {/* Custom checkbox with server color */}
                  <span className={cn(
                    'h-3.5 w-3.5 shrink-0 rounded flex items-center justify-center border-2 transition-all',
                    checked ? 'border-transparent' : 'border-bg-border'
                  )} style={checked ? { background: color } : {}}>
                    {checked && <span className="block h-1.5 w-1.5 rounded-sm bg-white/90" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-text-primary truncate">{srv.name}</div>
                    <div className="text-[10px] text-text-muted font-mono truncate">{srv.host}</div>
                  </div>
                  {/* Spinner if loading */}
                  {srvMetrics?.snapping && (
                    <Spinner className="h-3 w-3 shrink-0" />
                  )}
                </label>
              )
            })}
          </div>
          {/* Select all / none */}
          {allServers.length > 1 && (
            <div className="border-t border-bg-border px-3 py-2 flex gap-2">
              <button
                className="text-[10px] text-text-muted hover:text-text-primary transition-colors"
                onClick={() => setSelectedIds(new Set(allServers.map((s) => s.id)))}
              >Все</button>
              <span className="text-[10px] text-text-muted/30">·</span>
              <button
                className="text-[10px] text-text-muted hover:text-text-primary transition-colors"
                onClick={() => setSelectedIds(new Set())}
              >Ни одного</button>
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          {selectedServers.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-text-muted">Выберите хотя бы один сервер слева</p>
            </div>
          )}

          {selectedServers.length > 0 && (
            <div className="p-4 space-y-4">
              {/* KPI grid */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-secondary">Текущие показатели</span>
                  <span className="text-[10px] text-text-muted">
                    {selectedServers.length} {selectedServers.length === 1 ? 'сервер' : selectedServers.length < 5 ? 'сервера' : 'серверов'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {selectedServers.map((srv, i) => (
                    <ServerKpiCard
                      key={srv.id}
                      server={srv}
                      metrics={serverMetrics[srv.id] ?? EMPTY_METRICS}
                      color={SERVER_COLORS[i % SERVER_COLORS.length]}
                      onSnapshot={() => void takeSnapshot(srv.id, metricsPort, false)}
                    />
                  ))}
                </div>
              </div>

              {/* Charts — 2 columns, tall */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <MultiChart title="Соединения / с" hint="telemt_connections_total"
                  serverDatasets={buildDatasets((srv) => derivative(getPoints(srv), 'telemt_connections_total'))} />
                <MultiChart title="Таймауты рукопожатия / с" hint="telemt_handshake_timeouts_total"
                  serverDatasets={buildDatasets((srv) => derivative(getPoints(srv), 'telemt_handshake_timeouts_total'))} />
                <MultiChart title="Тяжёлые auth-проверки / с" hint="telemt_auth_expensive_checks_total"
                  serverDatasets={buildDatasets((srv) => derivative(getPoints(srv), 'telemt_auth_expensive_checks_total'))} />
                <MultiChart title="Upstream success / с" hint="telemt_upstream_connect_success_total"
                  serverDatasets={buildDatasets((srv) => derivative(getPoints(srv), 'telemt_upstream_connect_success_total'))} />
                <MultiChart title="Upstream fail / с" hint="telemt_upstream_connect_fail_total"
                  serverDatasets={buildDatasets((srv) => derivative(getPoints(srv), 'telemt_upstream_connect_fail_total'))} />
                <MultiChart title="Плохие соединения" hint="telemt_connections_bad_total"
                  serverDatasets={buildDatasets((srv) => gauge(getPoints(srv), 'telemt_connections_bad_total'))} />
                <MultiChart title="ME writers active" hint="telemt_me_writers_active_current"
                  serverDatasets={buildDatasets((srv) => gauge(getPoints(srv), 'telemt_me_writers_active_current'))} />
                <MultiChart title="ME reconnect / с" hint="telemt_me_reconnect_attempts_total"
                  serverDatasets={buildDatasets((srv) => derivative(getPoints(srv), 'telemt_me_reconnect_attempts_total'))} />
                <MultiChart title="DC→клиент payload, МБ/с" hint="telemt_me_d2c_payload_bytes_total"
                  serverDatasets={buildDatasets((srv) => derivative(getPoints(srv), 'telemt_me_d2c_payload_bytes_total').map((p) => ({ ...p, v: p.v / 1e6 })))} />
                <MultiChart title="Desync (накопительно)" hint="telemt_desync_total"
                  serverDatasets={buildDatasets((srv) => gauge(getPoints(srv), 'telemt_desync_total'))} />
                <MultiChart title="Сессии пользователя" hint="telemt_user_connections_current{…}"
                  serverDatasets={buildDatasets((srv) => {
                    const uk = firstKey(getPoints(srv), 'telemt_user_connections_current{')
                    return uk ? gauge(getPoints(srv), uk) : []
                  })} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
