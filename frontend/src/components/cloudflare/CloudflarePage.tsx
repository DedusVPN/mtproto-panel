import { useState, useEffect } from 'react'
import { RefreshCw, Trash2, Globe, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Circle, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { cloudflare as cfApi } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { cn } from '@/components/ui/utils'
import type { CloudflareOverview, CloudflarePanelServer, CloudflareARecord, CloudflareSyncResult } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubdomainGroup {
  id: number
  subdomain: string
  serverIds: Set<string>
}

let _seq = 0
function nextId() { return ++_seq }

// ─── Status helpers ───────────────────────────────────────────────────────────

type RowStatus = 'matched' | 'mismatch' | 'missing'

function getGroupStatus(subdomain: string, serverIds: Set<string>, panelServers: CloudflarePanelServer[], aRecords: CloudflareARecord[]): RowStatus {
  if (!subdomain.trim() || !serverIds.size) return 'missing'
  const srvsWithIp = [...serverIds].map((id) => panelServers.find((s) => s.server_id === id)).filter((s) => s?.ipv4)
  if (!srvsWithIp.length) return 'missing'
  const allMatched = srvsWithIp.every((s) =>
    aRecords.some((r) => (r.relative_name ?? '') === subdomain.trim() && r.content === s!.ipv4)
  )
  if (allMatched) return 'matched'
  const someExist = aRecords.some((r) => (r.relative_name ?? '') === subdomain.trim())
  return someExist ? 'mismatch' : 'missing'
}

function StatusBadge({ status }: { status: RowStatus }) {
  if (status === 'matched') return (
    <span className="flex items-center gap-1 text-[10px] text-success">
      <CheckCircle2 className="h-3 w-3" /> В CF
    </span>
  )
  if (status === 'mismatch') return (
    <span className="flex items-center gap-1 text-[10px] text-warning">
      <AlertTriangle className="h-3 w-3" /> Расхождение
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-[10px] text-text-muted/50">
      <Circle className="h-3 w-3" /> Нет записи
    </span>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function CloudflarePage() {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [overview, setOverview] = useState<CloudflareOverview | null>(null)
  const [statusLine, setStatusLine] = useState('')
  const [ttl, setTtl] = useState('60')

  // Subdomain groups: each group = one subdomain + set of servers
  const [groups, setGroups] = useState<SubdomainGroup[]>([{ id: nextId(), subdomain: '', serverIds: new Set() }])

  // A-records table
  const [selectedRecs, setSelectedRecs] = useState<Set<string>>(new Set())
  const [recsOpen, setRecsOpen] = useState(true)

  // Log
  const [logLines, setLogLines] = useState<string[]>([])
  const [apiJson, setApiJson] = useState('')
  const [jsonOpen, setJsonOpen] = useState(false)

  useEffect(() => { void handleRefresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function setLog(r: CloudflareSyncResult) {
    setLogLines(Array.isArray(r.log) && r.log.length ? r.log : ['(нет шагов)'])
    setApiJson(JSON.stringify(r, null, 2))
  }

  async function handleRefresh() {
    setLoading(true)
    setStatusLine('')
    setLogLines([])
    try {
      const data = await cfApi.overview()
      setOverview(data)
      if (data.error) { setStatusLine(data.error); return }
      const z = data.zone ? `${data.zone.name} · ${data.zone.id}` : ''
      const tok = data.token_status || (data.configured ? 'ok' : '')
      let line = data.configured ? `Токен: ${tok}` : 'Токен не настроен'
      if (z) line += ` · зона: ${z}`
      if (data.zone_error) line += ` · ${data.zone_error}`
      if (data.token_error) line = `Токен: ${data.token_error}`
      setStatusLine(line)

      // Auto-populate groups from existing CF records matched to panel servers
      const servers: CloudflarePanelServer[] = data.servers ?? []
      const records: CloudflareARecord[] = data.a_records ?? []

      if (records.length && servers.length) {
        // Build subdomain → serverIds map from matched records
        const subMap: Record<string, Set<string>> = {}
        records.forEach((r) => {
          const sub = r.relative_name?.trim() ?? ''
          if (!sub) return
          const matched = (r.matched_panel_servers ?? []).map((x) => x.id).filter(Boolean)
          // Also match by IP
          const byIp = servers.filter((s) => s.ipv4 === r.content).map((s) => s.server_id)
          const all = [...new Set([...matched, ...byIp])] as string[]
          if (all.length) {
            subMap[sub] = subMap[sub] ?? new Set()
            all.forEach((id) => subMap[sub].add(id))
          }
        })

        if (Object.keys(subMap).length) {
          setGroups((prev) => {
            // Keep manually edited groups, merge auto-detected
            const hasManual = prev.some((g) => g.subdomain.trim() || g.serverIds.size)
            if (hasManual) return prev
            const autoGroups = Object.entries(subMap).map(([sub, ids]) => ({
              id: nextId(), subdomain: sub, serverIds: ids,
            }))
            return autoGroups.length ? autoGroups : [{ id: nextId(), subdomain: '', serverIds: new Set() }]
          })
        }
      }

      // Remove stale server IDs
      const validIds = new Set(servers.map((s) => s.server_id))
      setGroups((prev) => prev.map((g) => ({
        ...g,
        serverIds: new Set([...g.serverIds].filter((id) => validIds.has(id))),
      })))
    } catch (e) {
      setStatusLine(`Ошибка: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleSync(dryRun: boolean) {
    const items = groups.flatMap((g) =>
      g.subdomain.trim()
        ? [...g.serverIds]
            .filter((id) => panelServers.find((s) => s.server_id === id)?.ipv4)
            .map((server_id) => ({ server_id, name: g.subdomain.trim() }))
        : []
    )
    if (!items.length) { toast.error('Укажите поддомен и отметьте хотя бы один сервер с IPv4'); return }
    if (!dryRun && !confirm('Изменить A-записи в Cloudflare?')) return
    setSyncing(true)
    try {
      const ttlNum = parseInt(ttl, 10) || 60
      const r = await cfApi.sync(items, false, ttlNum, dryRun)
      setLog(r)
      toast.success(dryRun ? 'Dry-run выполнен' : 'Синхронизация выполнена')
      await handleRefresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLogLines([msg])
      toast.error(msg)
    } finally {
      setSyncing(false)
    }
  }

  async function handleDelete(dryRun: boolean) {
    if (!selectedRecs.size) { toast.error('Отметьте A-записи для удаления'); return }
    if (!dryRun && !confirm('Удалить выбранные A-записи в Cloudflare?')) return
    const records = aRecords
      .filter((r) => selectedRecs.has(r.id))
      .map((r) => ({ id: r.id, relative_name: r.relative_name ?? '', content: r.content }))
    setDeleting(true)
    try {
      const r = await cfApi.deleteRecords(records, dryRun)
      setLog(r)
      toast.success(dryRun ? 'Dry-run удаления выполнен' : 'Записи удалены')
      setSelectedRecs(new Set())
      await handleRefresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLogLines([msg])
      toast.error(msg)
    } finally {
      setDeleting(false)
    }
  }

  // Group management
  function addGroup() {
    setGroups((p) => [...p, { id: nextId(), subdomain: '', serverIds: new Set() }])
  }

  function removeGroup(id: number) {
    setGroups((p) => {
      const next = p.filter((g) => g.id !== id)
      return next.length ? next : [{ id: nextId(), subdomain: '', serverIds: new Set() }]
    })
  }

  function setGroupSubdomain(id: number, subdomain: string) {
    setGroups((p) => p.map((g) => g.id === id ? { ...g, subdomain } : g))
  }

  function toggleGroupServer(gid: number, sid: string) {
    setGroups((p) => p.map((g) => {
      if (g.id !== gid) return g
      const s = new Set(g.serverIds)
      s.has(sid) ? s.delete(sid) : s.add(sid)
      return { ...g, serverIds: s }
    }))
  }

  function toggleRec(id: string) {
    setSelectedRecs((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  const panelServers: CloudflarePanelServer[] = overview?.servers ?? []
  const aRecords: CloudflareARecord[] = overview?.a_records ?? []
  const missing = overview?.panel_servers_without_a ?? []
  const configured = overview?.configured ?? false
  const zoneName = overview?.zone?.name ?? ''

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-bg-border bg-bg-surface px-4 py-2">
        <Globe className="h-4 w-4 text-text-muted" />
        <span className="text-sm font-semibold text-text-primary">Cloudflare DNS</span>
        {statusLine && (
          <span className={cn(
            'text-xs truncate max-w-sm',
            configured && !overview?.token_error ? 'text-text-muted' : 'text-danger'
          )}>{statusLine}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-text-muted">TTL</span>
          <Select value={ttl} onValueChange={setTtl}>
            <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[['1', 'Авто (CF)'], ['60', '60 с'], ['120', '2 мин'], ['300', '5 мин'], ['3600', '1 ч'], ['86400', '24 ч']].map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={handleRefresh} loading={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> Обновить
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void handleSync(true)} disabled={syncing}>Dry-run</Button>
          <Button variant="primary" size="sm" onClick={() => void handleSync(false)} loading={syncing}>
            Применить в CF
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Subdomain groups */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Поддомены и серверы</CardTitle>
              {zoneName && (
                <p className="text-[10px] text-text-muted mt-0.5">
                  Зона: <span className="font-mono text-text-secondary">{zoneName}</span>
                  <span className="mx-1.5">·</span>
                  Несколько серверов в одном поддомене = несколько A-записей (round-robin)
                </p>
              )}
              {!zoneName && (
                <p className="text-[10px] text-text-muted mt-0.5">
                  Несколько серверов в одном поддомене = несколько A-записей (round-robin)
                </p>
              )}
            </div>
            {missing.length > 0 && (
              <Badge variant="warning" className="ml-auto text-[10px]">{missing.length} без A-записи</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {!configured && !loading && (
              <p className="text-xs text-text-muted rounded-lg border border-bg-border bg-bg-elevated p-3">
                Задайте <code className="font-mono text-text-primary">CLOUDFLARE_API_TOKEN</code> и{' '}
                <code className="font-mono text-text-primary">CLOUDFLARE_ZONE_ID</code> (или{' '}
                <code className="font-mono">CLOUDFLARE_ZONE_NAME</code>) в <code className="font-mono">.env</code>.
              </p>
            )}

            {groups.map((g, gIdx) => {
              const status = getGroupStatus(g.subdomain, g.serverIds, panelServers, aRecords)
              const fullDomain = g.subdomain.trim()
                ? (g.subdomain.trim() === '@' ? zoneName : `${g.subdomain.trim()}${zoneName ? `.${zoneName}` : ''}`)
                : ''

              return (
                <div key={g.id} className={cn(
                  'rounded-card border p-3 space-y-2.5 transition-colors',
                  status === 'matched' ? 'border-success/25 bg-success/5' :
                  status === 'mismatch' ? 'border-warning/25 bg-warning/5' :
                  'border-bg-border bg-bg-elevated'
                )}>
                  {/* Group header */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted font-mono w-5 text-right shrink-0">
                      {gIdx + 1}.
                    </span>
                    <div className="flex-1 flex items-center gap-1.5">
                      <div className="relative flex-1 max-w-[220px]">
                        <input
                          className={cn(
                            'h-7 w-full rounded-btn border px-2 pr-6 text-xs font-mono bg-bg-surface focus:outline-none transition-colors',
                            status === 'matched' ? 'border-success/40 text-success focus:border-success/70' :
                            g.subdomain.trim() ? 'border-accent/40 text-text-primary focus:border-accent/70' :
                            'border-bg-border text-text-primary focus:border-accent/50'
                          )}
                          placeholder="поддомен или @"
                          value={g.subdomain}
                          onChange={(e) => setGroupSubdomain(g.id, e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                        />
                        {g.subdomain.trim() && (
                          <button
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                            onClick={() => setGroupSubdomain(g.id, '')}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {fullDomain && (
                        <span className="text-[10px] text-text-muted font-mono truncate max-w-[180px]" title={fullDomain}>
                          → {fullDomain}
                        </span>
                      )}
                    </div>
                    <StatusBadge status={status} />
                    <button
                      className="ml-1 flex h-6 w-6 items-center justify-center rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                      onClick={() => removeGroup(g.id)}
                      title="Удалить группу"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Server checkboxes */}
                  {panelServers.length === 0 ? (
                    <p className="text-[10px] text-text-muted ml-7">Нажмите «Обновить» для загрузки серверов.</p>
                  ) : (
                    <div className="ml-7 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                      {panelServers.map((srv) => {
                        const checked = g.serverIds.has(srv.server_id)
                        const hasIp = !!srv.ipv4
                        const isMatchedHere = checked && hasIp && aRecords.some(
                          (r) => (r.relative_name ?? '') === g.subdomain.trim() && r.content === srv.ipv4
                        )
                        return (
                          <label key={srv.server_id} className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
                            !hasIp ? 'opacity-40 pointer-events-none' :
                            checked ? 'bg-bg-surface/60' : 'hover:bg-bg-surface/40'
                          )}>
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded accent-amber-500 shrink-0"
                              checked={checked}
                              disabled={!hasIp}
                              onChange={() => toggleGroupServer(g.id, srv.server_id)}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-text-primary truncate flex items-center gap-1">
                                {srv.panel_name ?? srv.server_id}
                                {isMatchedHere && <CheckCircle2 className="h-2.5 w-2.5 text-success shrink-0" />}
                              </div>
                              <div className="text-[10px] text-text-muted font-mono truncate">
                                {srv.ipv4 ?? <span className="italic">нет IPv4</span>}
                              </div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            <Button variant="ghost" size="sm" onClick={addGroup} className="mt-1">
              <Plus className="h-3.5 w-3.5" /> Добавить поддомен
            </Button>
          </CardContent>
        </Card>

        {/* A-records table (collapsible) */}
        <Card>
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-bg-elevated/30 transition-colors rounded-t-card"
            onClick={() => setRecsOpen((p) => !p)}
          >
            {recsOpen ? <ChevronDown className="h-3.5 w-3.5 text-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-text-muted" />}
            <span className="text-sm font-semibold text-text-primary">A-записи в зоне</span>
            {aRecords.length > 0 && <Badge variant="default" className="text-[10px]">{aRecords.length}</Badge>}
          </button>

          {recsOpen && (
            <div className="border-t border-bg-border">
              {aRecords.length === 0 ? (
                <p className="px-4 py-4 text-xs text-text-muted">
                  {overview ? 'Нет A-записей с IP из панели.' : 'Нажмите «Обновить».'}
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-bg-border text-text-muted">
                          <th className="w-8 px-3 py-2" />
                          <th className="px-3 py-2 text-left font-medium">Поддомен</th>
                          <th className="px-3 py-2 text-left font-medium">IP</th>
                          <th className="px-3 py-2 text-left font-medium">TTL</th>
                          <th className="px-3 py-2 text-left font-medium">Серверы панели</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aRecords.map((r) => {
                          const names = (r.matched_panel_servers ?? [])
                            .map((x) => x.name || x.id || '').filter(Boolean)
                          return (
                            <tr key={r.id} className="border-b border-bg-border/50 hover:bg-bg-elevated/30">
                              <td className="px-3 py-1.5">
                                <input type="checkbox" className="h-3.5 w-3.5 rounded accent-amber-500"
                                  checked={selectedRecs.has(r.id)} onChange={() => toggleRec(r.id)} />
                              </td>
                              <td className="px-3 py-1.5 font-mono text-text-primary">{r.relative_name ?? '@'}</td>
                              <td className="px-3 py-1.5 font-mono text-text-secondary">{r.content}</td>
                              <td className="px-3 py-1.5 text-text-muted">{r.ttl ?? '—'}</td>
                              <td className="px-3 py-1.5 text-text-secondary">{names.join(', ') || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2 px-4 py-2.5 border-t border-bg-border/50">
                    <Button variant="ghost" size="sm" onClick={() => void handleDelete(true)} disabled={deleting || !selectedRecs.size}>
                      Dry-run удаления
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => void handleDelete(false)} disabled={!selectedRecs.size} loading={deleting}>
                      <Trash2 className="h-3.5 w-3.5" /> Удалить выбранные
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>

        {/* Action log */}
        {logLines.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Лог действий</CardTitle></CardHeader>
            <CardContent className="p-0">
              <pre className="font-mono text-xs text-text-secondary px-4 py-3 leading-relaxed overflow-auto max-h-48">
                {logLines.join('\n')}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* JSON response (collapsible) */}
        {apiJson && (
          <Card>
            <button
              className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-bg-elevated/30 transition-colors rounded-t-card"
              onClick={() => setJsonOpen((p) => !p)}
            >
              {jsonOpen ? <ChevronDown className="h-3.5 w-3.5 text-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-text-muted" />}
              <span className="text-xs text-text-secondary font-medium">Ответ API (JSON)</span>
            </button>
            {jsonOpen && (
              <div className="border-t border-bg-border">
                <pre className="font-mono text-xs text-text-secondary px-4 py-3 overflow-auto max-h-64">{apiJson}</pre>
              </div>
            )}
          </Card>
        )}

        <p className="text-[10px] text-text-muted pb-2">
          Требуются переменные:{' '}
          <code className="font-mono">CLOUDFLARE_API_TOKEN</code>,{' '}
          <code className="font-mono">CLOUDFLARE_ZONE_ID</code> или{' '}
          <code className="font-mono">CLOUDFLARE_ZONE_NAME</code>.{' '}
          <a href="https://developers.cloudflare.com/api/" target="_blank" rel="noopener noreferrer" className="text-text-link hover:underline">
            Документация API
          </a>
        </p>
      </div>
    </div>
  )
}
