import type {
  AuthStatus, StoredServer, StoredServerCreate, StoredServerUpdate,
  SSHAuth, Preset, MetricsSnapshotResponse, MetricsHistoryResponse,
  VdsinaStatus, VdsinaBalance, VdsinaDatacenter, VdsinaServerGroup,
  VdsinaServerPlan, VdsinaTemplate, VdsinaSshKey, VdsinaServer, VdsinaCreateBody,
  CloudflareOverview, CloudflareSyncItem, CloudflareDeleteRecord, CloudflareSyncResult,
  TelemtConfig,
} from '@/types'

// ─── Core fetch ──────────────────────────────────────────────────────────────

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, { ...init, credentials: 'include' })
  return r
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(url, init)
  const text = await r.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { /* ignore */ }

  if (!r.ok) {
    const detail = (json as Record<string, unknown>)?.detail
    const msg = formatDetail(detail) || text || r.statusText
    throw new Error(msg)
  }
  return json as T
}

function formatDetail(d: unknown): string {
  if (d == null) return ''
  if (typeof d === 'string') return d
  if (Array.isArray(d) && d.length && typeof d[0] === 'object' && d[0] !== null && 'msg' in d[0]) {
    return (d as Array<{ loc?: unknown[]; msg: string; type?: string }>)
      .map((x) => {
        const loc = Array.isArray(x.loc) ? x.loc.filter((p) => p !== 'body').join('.') : ''
        const typ = x.type ? ` [${x.type}]` : ''
        return (loc ? `${loc}: ` : '') + x.msg + typ
      })
      .join('; ')
  }
  try { return JSON.stringify(d) } catch { return String(d) }
}

function jsonInit(body: unknown, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  status: () => apiJson<AuthStatus>('/api/auth/status'),
  me: () => apiFetch('/api/auth/me'),
  login: (username: string, password: string) =>
    apiFetch('/api/auth/login', jsonInit({ username, password })),
  logout: () => apiFetch('/api/auth/logout', { method: 'POST', credentials: 'include' }),
}

// ─── Servers ──────────────────────────────────────────────────────────────────

export const servers = {
  list: () => apiJson<StoredServer[]>('/api/servers'),
  get: (id: string) => apiJson<StoredServer>(`/api/servers/${encodeURIComponent(id)}`),
  create: (body: StoredServerCreate) => apiJson<StoredServer>('/api/servers', jsonInit(body)),
  update: (id: string, body: StoredServerUpdate) =>
    apiJson<StoredServer>(`/api/servers/${encodeURIComponent(id)}`, jsonInit(body, 'PUT')),
  delete: (id: string) =>
    apiJson<{ ok: boolean }>(`/api/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  sshTest: (ssh: SSHAuth) =>
    apiJson<{ ok: boolean; message: string }>('/api/ssh-test', jsonInit({ ssh })),
  fetchRemoteTelemt: (ssh: SSHAuth) =>
    apiJson<{ ok: boolean; found: boolean; message?: string; telemt?: TelemtConfig }>(
      '/api/fetch-remote-telemt', jsonInit({ ssh })
    ),
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export const presets = {
  list: () => apiJson<Preset[]>('/api/presets'),
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export const metrics = {
  snapshot: (server_id: string, metrics_port: number) =>
    apiJson<MetricsSnapshotResponse>('/api/metrics/snapshot', jsonInit({ server_id, metrics_port })),
  history: (server_id: string, hours?: number) => {
    const q = hours ? `&hours=${hours}` : ''
    return apiJson<MetricsHistoryResponse>(`/api/metrics/history?server_id=${encodeURIComponent(server_id)}${q}`)
  },
}

// ─── VDSina ──────────────────────────────────────────────────────────────────

export const vdsina = {
  status: () => apiJson<VdsinaStatus>('/api/cloud/vdsina/status'),
  balance: () => apiJson<VdsinaBalance>('/api/cloud/vdsina/account/balance'),
  servers: () => apiJson<VdsinaServer[]>('/api/cloud/vdsina/servers'),
  datacenters: () => apiJson<VdsinaDatacenter[]>('/api/cloud/vdsina/catalog/datacenters'),
  serverGroups: () => apiJson<VdsinaServerGroup[]>('/api/cloud/vdsina/catalog/server-groups'),
  serverPlans: (groupId: number) =>
    apiJson<VdsinaServerPlan[]>(`/api/cloud/vdsina/catalog/server-plans/${groupId}`),
  templates: () => apiJson<VdsinaTemplate[]>('/api/cloud/vdsina/catalog/templates'),
  sshKeys: () => apiJson<VdsinaSshKey[]>('/api/cloud/vdsina/ssh-keys'),
  rootPassword: (id: number) =>
    apiJson<{ password: string }>(`/api/cloud/vdsina/servers/${id}/root-password`),
  create: (body: VdsinaCreateBody) =>
    apiJson<{ id: number; server?: VdsinaServer }>('/api/cloud/vdsina/servers', jsonInit(body)),
  delete: (id: number) =>
    apiJson<{ ok: boolean }>(`/api/cloud/vdsina/servers/${id}`, { method: 'DELETE' }),
}

// ─── Cloudflare ───────────────────────────────────────────────────────────────

export const cloudflare = {
  overview: () => apiJson<CloudflareOverview>('/api/cloud/cloudflare/overview'),
  sync: (items: CloudflareSyncItem[], proxied: boolean, ttl: number, dry_run: boolean) =>
    apiJson<CloudflareSyncResult>('/api/cloud/cloudflare/sync-panel-servers',
      jsonInit({ items, proxied, ttl, dry_run })),
  deleteRecords: (records: CloudflareDeleteRecord[], dry_run: boolean) =>
    apiJson<CloudflareSyncResult>('/api/cloud/cloudflare/delete-dns-records',
      jsonInit({ records, dry_run })),
}
