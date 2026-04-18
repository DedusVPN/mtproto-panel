// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthStatus {
  auth_required: boolean
  auth_enabled: boolean
  admin_username: string
}

export interface AuthMe {
  sub: string
}

// ─── Servers ─────────────────────────────────────────────────────────────────

export type AuthMode = 'key' | 'password'

export interface StoredServer {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_mode: AuthMode
  private_key?: string | null
  private_key_passphrase?: string | null
  password?: string | null
}

export interface StoredServerCreate extends Omit<StoredServer, 'id'> {}
export interface StoredServerUpdate extends Partial<StoredServerCreate> {}

// ─── SSH ─────────────────────────────────────────────────────────────────────

export interface SSHAuth {
  host: string
  port: number
  username: string
  private_key?: string | null
  private_key_passphrase?: string | null
  password?: string | null
}

// ─── Telemt ──────────────────────────────────────────────────────────────────

export interface TelemtUser {
  username: string
  secret_hex: string
}

export interface TelemtConfig {
  public_host: string
  public_port: number
  server_port: number
  metrics_port: number
  api_listen: string
  tls_domain: string
  ad_tag: string
  users: TelemtUser[]
  mode_classic: boolean
  mode_secure: boolean
  mode_tls: boolean
  log_level: 'normal' | 'verbose' | 'debug' | 'silent'
  metrics_whitelist: string[]
  api_whitelist: string[]
}

// ─── Deploy ──────────────────────────────────────────────────────────────────

export interface DeployOptions {
  apt_update_upgrade: boolean
  sysctl_file_limits: boolean
  sysctl_network: boolean
  download_binary: boolean
  install_systemd: boolean
  start_and_enable_service: boolean
  verify_api: boolean
  binary_path: string
  install_ufw: boolean
  install_fail2ban: boolean
  kernel_hardening_sysctl: boolean
  install_traffic_shaper: boolean
  shaper_download_fast_mbytes_per_sec: number
  shaper_download_slow_mbytes_per_sec: number
  shaper_upload_fast_mbytes_per_sec: number
  shaper_upload_slow_mbytes_per_sec: number
  shaper_fast_tcp_ports: number[]
  ufw_extra_tcp_ports: number[]
}

export interface DeployRequest {
  ssh: SSHAuth
  telemt: TelemtConfig
  options: DeployOptions
}

export type WsMessageType = 'log' | 'error' | 'done'

export interface WsMessage {
  type: WsMessageType
  message?: string
  ok?: boolean
  error?: string
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export interface Preset {
  id: string
  label: string
  telemt: Partial<TelemtConfig>
  options?: Partial<DeployOptions>
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface MetricsCards {
  version?: string
  connections_total?: number
  connections_bad_total?: number
  desync_total?: number
  writers_active?: number
  writers_warm?: number
  upstream_connect_success?: number
  upstream_connect_fail?: number
  per_user_connections_current?: Record<string, number>
  [key: string]: unknown
}

export interface MetricPoint {
  t: number
  m: Record<string, number>
}

export interface MetricsSnapshotResponse {
  ok: boolean
  message?: string
  t?: number
  cards?: MetricsCards
  points_total?: number
  metrics_series?: number
  metrics?: Record<string, number>
  preview?: string
}

export interface MetricsHistoryResponse {
  points: MetricPoint[]
  last_cards?: MetricsCards | null
}

// ─── VDSina ──────────────────────────────────────────────────────────────────

export interface VdsinaStatus {
  configured: boolean
  api_base?: string
  token_diagnostics?: string
}

export interface VdsinaBalance {
  real?: string | number
  bonus?: string | number
}

export interface VdsinaDatacenter {
  id: number
  name: string
  country: string
  active: boolean
}

export interface VdsinaServerGroup {
  id: number
  name: string
  active: boolean
}

export interface VdsinaServerPlan {
  id: number
  name: string
  active: boolean
  enable: boolean
  period?: string
}

export interface VdsinaTemplate {
  id: number
  name: string
  active: boolean
  server_plan?: number[]
  server_plans?: number[]
}

export interface VdsinaSshKey {
  id: number
  name: string
}

export interface VdsinaServerIp {
  ip?: string
}

export interface VdsinaServer {
  id: number
  name?: string
  full_name?: string
  status?: string
  status_text?: string
  ip?: VdsinaServerIp
  can?: { delete?: boolean }
}

export interface VdsinaCreateBody {
  datacenter: number
  server_plan: number
  template: number
  autoprolong: boolean
  ssh_key?: number
  name?: string
  cpu?: number
  ram?: number
  disk?: number
}

// ─── Monitor ─────────────────────────────────────────────────────────────────

export interface MonitorServerConfig {
  proxy_port: number
  enabled: boolean
}

export interface MonitorSettings {
  enabled: boolean
  telegram_bot_token: string
  telegram_chat_id: string
  /** ID топика форума супергруппы (message_thread_id). Пустая строка = общий чат */
  telegram_thread_id: string
  /** Кастомный базовый URL Bot API (reverse-proxy). Пустая строка = api.telegram.org */
  telegram_api_base_url: string
  check_interval_seconds: number
  connect_timeout_seconds: number
  failure_threshold: number
  servers: Record<string, MonitorServerConfig>
}

export type ProxyStatus = 'up' | 'down' | 'unknown'

export interface ServerCheckStatus {
  status: ProxyStatus
  last_check_ts: number | null
  last_change_ts: number | null
  consecutive_failures: number
  last_error: string | null
}

export interface MonitorStatusResponse {
  running: boolean
  servers: Record<string, ServerCheckStatus>
}

export interface MonitorCheckNowResponse {
  ok: boolean
  servers: Record<string, ServerCheckStatus>
}

// ─── Cloudflare ──────────────────────────────────────────────────────────────

export interface CloudflareConfigSummary {
  configured: boolean
  api_base?: string
}

export interface CloudflarePanelServer {
  server_id: string
  host: string
  panel_name?: string
  ipv4?: string | null
}

export interface CloudflareARecord {
  id: string
  relative_name?: string
  content: string
  ttl?: number
  matched_panel_servers?: Array<{ name?: string; id?: string }>
}

export interface CloudflareOverview {
  configured: boolean
  token_status?: string
  token_error?: string
  zone?: { id: string; name: string }
  zone_error?: string
  a_records?: CloudflareARecord[]
  panel_servers_without_a?: Array<{ panel_name?: string; server_id: string; ipv4?: string }>
  servers?: CloudflarePanelServer[]
  error?: string
}

export interface CloudflareSyncItem {
  server_id: string
  name: string
}

export interface CloudflareDeleteRecord {
  id: string
  relative_name: string
  content: string
}

export interface CloudflareSyncResult {
  dry_run: boolean
  zone?: string
  errors?: string[]
  results?: unknown[]
  log?: string[]
}
