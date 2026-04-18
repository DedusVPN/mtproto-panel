import { useState, useEffect } from 'react'
import { RefreshCw, Plus, Trash2, ArrowRightCircle, Server, Cloud } from 'lucide-react'
import { toast } from 'sonner'
import { vdsina as vdsinaApi, servers as serversApi } from '@/api/client'
import { useServers } from '@/hooks/useServers'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/components/ui/utils'
import type {
  VdsinaServer, VdsinaDatacenter, VdsinaServerGroup,
  VdsinaServerPlan, VdsinaTemplate, VdsinaSshKey,
} from '@/types'

// ─── Provider registry (extend to add more providers) ─────────────────────────

type ProviderId = 'vdsina'

interface ProviderMeta {
  id: ProviderId
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const PROVIDERS: ProviderMeta[] = [
  { id: 'vdsina', label: 'VDSina', description: 'userapi.vdsina.com', icon: Server },
]

// ─── VDSina panel ─────────────────────────────────────────────────────────────

function vdsinaIp(s: VdsinaServer): string {
  return s.ip?.ip ? String(s.ip.ip) : ''
}

function VdsinaPanel() {
  const qc = useQueryClient()
  const { setSelectedServerId } = useAppStore()
  const { refetch: refetchServers } = useServers()

  const [loading, setLoading] = useState(false)
  const [statusLine, setStatusLine] = useState('')
  const [vdsinaServers, setVdsinaServers] = useState<VdsinaServer[]>([])
  const [datacenters, setDatacenters] = useState<VdsinaDatacenter[]>([])
  const [groups, setGroups] = useState<VdsinaServerGroup[]>([])
  const [plans, setPlans] = useState<VdsinaServerPlan[]>([])
  const [templates, setTemplates] = useState<VdsinaTemplate[]>([])
  const [sshKeys, setSshKeys] = useState<VdsinaSshKey[]>([])
  const [allTemplates, setAllTemplates] = useState<VdsinaTemplate[]>([])
  const [configured, setConfigured] = useState(false)

  const [selDc, setSelDc] = useState('')
  const [selGroup, setSelGroup] = useState('')
  const [selPlan, setSelPlan] = useState('')
  const [selTemplate, setSelTemplate] = useState('')
  const [selSshKey, setSelSshKey] = useState('')
  const [vpsName, setVpsName] = useState('')
  const [vcpu, setVcpu] = useState('')
  const [vram, setVram] = useState('')
  const [vdisk, setVdisk] = useState('')
  const [autoprolong, setAutoprolong] = useState(true)
  const [creating, setCreating] = useState(false)

  async function refresh() {
    setLoading(true)
    setStatusLine('')
    try {
      const st = await vdsinaApi.status()
      setConfigured(st.configured)
      if (!st.configured) {
        setStatusLine('API не настроен: задайте VDSINA_API_TOKEN и перезапустите панель.')
        return
      }
      setStatusLine(`Подключено к ${st.api_base ?? ''} · загрузка…`)
      const [bal, srvs, dcs, grps, tmpl, keys] = await Promise.all([
        vdsinaApi.balance(),
        vdsinaApi.servers(),
        vdsinaApi.datacenters(),
        vdsinaApi.serverGroups(),
        vdsinaApi.templates(),
        vdsinaApi.sshKeys(),
      ])
      setVdsinaServers(Array.isArray(srvs) ? srvs : [])
      setDatacenters((dcs ?? []).filter((d) => d.active))
      const activeGroups = (grps ?? []).filter((g) => g.active)
      setGroups(activeGroups)
      setAllTemplates(Array.isArray(tmpl) ? tmpl : [])
      setSshKeys(keys ?? [])
      setStatusLine(`Баланс: ${bal?.real ?? '—'} · бонусы: ${bal?.bonus ?? '—'}`)

      if (activeGroups.length) {
        const gid = Number(activeGroups[0].id)
        setSelGroup(String(gid))
        await loadPlans(gid, Array.isArray(tmpl) ? tmpl : [])
      }
    } catch (e) {
      setStatusLine(`Ошибка: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPlans(gid: number, allTmpl = allTemplates) {
    try {
      const p = await vdsinaApi.serverPlans(gid)
      const active = (p ?? []).filter((x) => x.active && x.enable)
      setPlans(active)
      if (active.length) {
        const pid = active[0].id
        setSelPlan(String(pid))
        const filtered = allTmpl
          .filter((t) => t.active !== false)
          .filter((t) => {
            const sp = t.server_plan || t.server_plans || []
            return Array.isArray(sp) && sp.length ? sp.some((x) => Number(x) === pid) : true
          })
        setTemplates(filtered)
        if (filtered.length) setSelTemplate(String(filtered[0].id))
      }
    } catch (e) {
      toast.error(`Ошибка загрузки тарифов: ${e instanceof Error ? e.message : e}`)
    }
  }

  async function handleGroupChange(gid: string) {
    setSelGroup(gid)
    if (gid) await loadPlans(Number(gid))
  }

  async function handleImport(srv: VdsinaServer) {
    const ip = vdsinaIp(srv)
    if (!ip) { toast.error('У сервера нет IPv4'); return }
    const suggestedName = (srv.name || srv.full_name || `VDSina #${srv.id}`).trim()
    try {
      const pr = await vdsinaApi.rootPassword(srv.id)
      const pw = String(pr?.password ?? '').trim()
      if (!pw) {
        toast.error('Пароль root пустой — добавьте сервер вручную через «Новый сервер»')
        return
      }
      const saved = await serversApi.create({
        name: suggestedName, host: ip, port: 22, username: 'root',
        auth_mode: 'password', password: pw,
        private_key: null, private_key_passphrase: null,
      })
      await refetchServers()
      setSelectedServerId(saved.id)
      void qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(`Сервер «${saved.name}» добавлен в панель`)
    } catch (e) {
      toast.error(`Ошибка: ${e instanceof Error ? e.message : e}`)
    }
  }

  async function handleCreate() {
    const dc = parseInt(selDc, 10)
    const plan = parseInt(selPlan, 10)
    const tmpl = selTemplate ? parseInt(selTemplate, 10) : null
    if (!dc || dc < 1) { toast.error('Выберите датацентр'); return }
    if (!plan || plan < 1) { toast.error('Выберите тариф'); return }
    if (!tmpl) { toast.error('Выберите шаблон ОС'); return }
    setCreating(true)
    try {
      const body: Parameters<typeof vdsinaApi.create>[0] = {
        datacenter: dc, server_plan: plan, template: tmpl, autoprolong,
      }
      const sk = selSshKey ? parseInt(selSshKey, 10) : null
      if (sk && sk >= 1) body.ssh_key = sk
      if (vpsName.trim()) body.name = vpsName.trim()
      const cpu = parseInt(vcpu, 10)
      const ram = parseInt(vram, 10)
      const disk = parseInt(vdisk, 10)
      if (!isNaN(cpu) && cpu >= 1) body.cpu = cpu
      if (!isNaN(ram) && ram >= 1) body.ram = ram
      if (!isNaN(disk) && disk >= 1) body.disk = disk
      const created = await vdsinaApi.create(body)
      toast.success(`VDSina: создан сервер id ${created.id}`)
      await refresh()
    } catch (e) {
      toast.error(`Ошибка создания: ${e instanceof Error ? e.message : e}`)
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(srv: VdsinaServer) {
    if (!confirm(`Удалить VPS #${srv.id} на VDSina? Это действие необратимо.`)) return
    try {
      await vdsinaApi.delete(srv.id)
      await refresh()
      toast.success(`VPS #${srv.id} удалён`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const selectClass = 'h-8 w-full rounded-btn bg-bg-elevated border border-bg-border px-2 text-xs text-text-primary focus:outline-none focus:border-accent/50'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 pb-3">
        {statusLine && <span className="text-xs text-text-muted flex-1">{statusLine}</span>}
        {loading && <Spinner className="h-4 w-4" />}
        <Button variant="ghost" size="sm" onClick={refresh} loading={loading} className="shrink-0">
          <RefreshCw className="h-3.5 w-3.5" /> Обновить
        </Button>
      </div>

      {!configured && !loading && (
        <p className="text-xs text-text-muted rounded-card border border-bg-border bg-bg-surface p-4">
          Задайте <code className="font-mono text-text-primary">VDSINA_API_TOKEN</code> в{' '}
          <code className="font-mono">.env</code> и перезапустите панель.{' '}
          <a href="https://www.vdsina.com/tech/api" target="_blank" rel="noopener noreferrer" className="text-text-link hover:underline">
            Документация API
          </a>
        </p>
      )}

      {/* Two-column layout: server list + order form */}
      {configured && (
        <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
          {/* Left: VPS list */}
          <div className="flex-1 overflow-y-auto space-y-2 min-w-0">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider pb-1">
              Ваши VPS {vdsinaServers.length > 0 && `(${vdsinaServers.length})`}
            </h3>
            {loading && !vdsinaServers.length && (
              <div className="flex justify-center py-8"><Spinner /></div>
            )}
            {!loading && vdsinaServers.length === 0 && (
              <div className="rounded-card border border-bg-border bg-bg-surface p-4 text-center">
                <p className="text-xs text-text-muted">Нет VPS на аккаунте</p>
              </div>
            )}
            {vdsinaServers.map((s) => {
              const ip = vdsinaIp(s)
              const st = (s.status_text || s.status || '').trim()
              return (
                <div key={s.id} className="flex items-center gap-3 rounded-card border border-bg-border bg-bg-surface px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-text-primary truncate">
                      {s.name || s.full_name || 'VPS'}{' '}
                      <span className="text-text-muted font-normal">#{s.id}</span>
                    </div>
                    <div className="text-[10px] text-text-muted font-mono mt-0.5">
                      {ip ? ip : 'нет IPv4'}{st ? ` · ${st}` : ''}
                    </div>
                  </div>
                  <Badge variant={st === 'active' || st === 'on' ? 'success' : 'default'}>{st || '—'}</Badge>
                  <Button variant="accent" size="sm" disabled={!ip} onClick={() => void handleImport(s)}>
                    <ArrowRightCircle className="h-3.5 w-3.5" /> В панель
                  </Button>
                  <Button variant="danger" size="icon-sm" disabled={!s.can?.delete}
                    onClick={() => void handleDelete(s)} title="Удалить VPS">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )
            })}
          </div>

          {/* Right: Order form */}
          <div className="w-72 shrink-0 overflow-y-auto">
            <Card className="h-full">
              <CardHeader>
                <Plus className="h-3.5 w-3.5 text-text-muted" />
                <CardTitle>Заказать VPS</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Датацентр</Label>
                  <select className={selectClass} value={selDc} onChange={(e) => setSelDc(e.target.value)}>
                    <option value="">—</option>
                    {datacenters.map((d) => (
                      <option key={d.id} value={String(d.id)}>{d.name} ({d.country}) · #{d.id}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Группа серверов</Label>
                  <select className={selectClass} value={selGroup} onChange={(e) => void handleGroupChange(e.target.value)}>
                    {groups.map((g) => <option key={g.id} value={String(g.id)}>{g.name} · #{g.id}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Тариф</Label>
                  <select className={selectClass} value={selPlan} onChange={(e) => setSelPlan(e.target.value)}>
                    {plans.map((p) => <option key={p.id} value={String(p.id)}>#{p.id} — {p.name} ({p.period})</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Шаблон ОС</Label>
                  <select className={selectClass} value={selTemplate} onChange={(e) => setSelTemplate(e.target.value)}>
                    {templates.map((t) => <option key={t.id} value={String(t.id)}>{t.name} · #{t.id}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>SSH-ключ</Label>
                  <select className={selectClass} value={selSshKey} onChange={(e) => setSelSshKey(e.target.value)}>
                    <option value="">— без ключа —</option>
                    {sshKeys.map((k) => <option key={k.id} value={String(k.id)}>{k.name} · #{k.id}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Имя VPS</Label>
                  <Input placeholder="telemt-1" value={vpsName} onChange={(e) => setVpsName(e.target.value)} autoComplete="off" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Ресурсы (необязательно)</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <div className="text-[10px] text-text-muted mb-1">CPU</div>
                      <Input type="number" min={1} placeholder="авто" value={vcpu} onChange={(e) => setVcpu(e.target.value)} />
                    </div>
                    <div>
                      <div className="text-[10px] text-text-muted mb-1">RAM ГБ</div>
                      <Input type="number" min={1} placeholder="авто" value={vram} onChange={(e) => setVram(e.target.value)} />
                    </div>
                    <div>
                      <div className="text-[10px] text-text-muted mb-1">Диск ГБ</div>
                      <Input type="number" min={1} placeholder="авто" value={vdisk} onChange={(e) => setVdisk(e.target.value)} />
                    </div>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="h-3.5 w-3.5 rounded accent-amber-500"
                    checked={autoprolong} onChange={(e) => setAutoprolong(e.target.checked)} />
                  <span className="text-xs text-text-secondary">Автопродление</span>
                </label>
                <Button variant="primary" size="sm" className="w-full" onClick={handleCreate} loading={creating}>
                  <Plus className="h-3.5 w-3.5" /> Заказать VPS
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Provider tabs + page shell ────────────────────────────────────────────────

export function ProvidersPage() {
  const [activeProvider, setActiveProvider] = useState<ProviderId>('vdsina')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tabs bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-bg-border bg-bg-surface px-4">
        {PROVIDERS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveProvider(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-all -mb-px',
              activeProvider === id
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary hover:border-bg-border'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        {/* Future provider placeholder */}
        <span className="flex items-center gap-1.5 px-3 py-2.5 text-xs text-text-muted/40 cursor-default select-none border-b-2 border-transparent -mb-px italic">
          <Cloud className="h-3.5 w-3.5" /> Скоро…
        </span>
      </div>

      {/* Provider content — full remaining space */}
      <div className="flex-1 overflow-hidden p-4">
        {activeProvider === 'vdsina' && <VdsinaPanel />}
      </div>
    </div>
  )
}
