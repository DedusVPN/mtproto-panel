import { useState, useRef, useEffect } from 'react'
import { Toaster } from 'sonner'
import { Topbar } from '@/components/layout/Topbar'
import { Sidebar } from '@/components/layout/Sidebar'
import { LoginGate } from '@/components/layout/LoginGate'
import { ServerDialog } from '@/components/servers/ServerDialog'
import { ServersPage, type TelemtFormHandle } from '@/components/servers/ServersPage'
import { StatsPage } from '@/components/stats/StatsPage'
import { ProvidersPage } from '@/components/providers/ProvidersPage'
import { CloudflarePage } from '@/components/cloudflare/CloudflarePage'
import { MonitorPage } from '@/components/monitor/MonitorPage'
import { useAppStore } from '@/store'
import { auth as authApi } from '@/api/client'
import { useServers } from '@/hooks/useServers'
import type { StoredServer, AuthStatus, TelemtConfig } from '@/types'

// ─── Root ─────────────────────────────────────────────────────────────────────
// Handles ONLY auth boot — no API calls for servers/data until session confirmed

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const st = await authApi.status()
        setAuthStatus(st)
        if (!st.auth_required) {
          setSessionReady(true)
          return
        }
        // auth is required — check if we already have a valid session
        const me = await authApi.me()
        if (me.ok) {
          setSessionReady(true)
        }
        // else: LoginGate will be shown (sessionReady stays false)
      } catch {
        // network error — let the app load anyway
        setSessionReady(true)
      }
    })()
  }, [])

  // Show login form when auth is required and session is not yet established
  if (!sessionReady && authStatus?.auth_required) {
    return (
      <>
        <LoginGate
          username={authStatus.admin_username || 'admin'}
          onSuccess={() => setSessionReady(true)}
        />
        <Toaster position="bottom-right" theme="dark" />
      </>
    )
  }

  // Still checking auth status
  if (!sessionReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-base">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-bg-border border-t-accent" />
      </div>
    )
  }

  // Session confirmed — render the full app (all hooks/queries inside run safely)
  return <AuthenticatedApp authStatus={authStatus} />
}

// ─── Main app (only rendered after auth confirmed) ────────────────────────────

function AuthenticatedApp({ authStatus }: { authStatus: AuthStatus | null }) {
  const { view, selectedServerId, setSelectedServerId } = useAppStore()
  const [serverDialogOpen, setServerDialogOpen] = useState(false)
  const [editServer, setEditServer] = useState<StoredServer | null>(null)
  const telemtRef = useRef<TelemtFormHandle | null>(null)

  const { data: serverList = [], refetch: refetchServers } = useServers()

  // Clear stale selectedServerId if server was deleted externally
  useEffect(() => {
    if (!selectedServerId) return
    if (serverList.length > 0 && !serverList.some((s) => s.id === selectedServerId)) {
      setSelectedServerId(null)
    }
  }, [serverList, selectedServerId, setSelectedServerId])

  function handleOpenNewServer() {
    setEditServer(null)
    setServerDialogOpen(true)
  }

  function handleEditServer(s: StoredServer) {
    setEditServer(s)
    setServerDialogOpen(true)
  }

  function handleTelemtFetched(t: TelemtConfig) {
    telemtRef.current?.applyTelemt(t)
  }

  async function handleServerDialogClose() {
    setServerDialogOpen(false)
    setEditServer(null)
    await refetchServers()
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-base font-sans antialiased">
      <Topbar
        authRequired={!!authStatus?.auth_required}
        username={authStatus?.admin_username}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar only on Servers tab */}
        {view === 'servers' && (
          <Sidebar
            onAddServer={handleOpenNewServer}
            onEditServer={handleEditServer}
            onSelectServer={(id) => setSelectedServerId(id)}
          />
        )}

        <main className="flex-1 overflow-hidden">
          {view === 'servers' && (
            <ServersPage
              onOpenServerDialog={handleOpenNewServer}
              onApplyTelemt={handleTelemtFetched}
              telemtRef={telemtRef}
            />
          )}
          {view === 'stats' && <StatsPage />}
          {view === 'providers' && <ProvidersPage />}
          {view === 'cloudflare' && <CloudflarePage />}
          {view === 'monitor' && <MonitorPage />}
        </main>
      </div>

      <ServerDialog
        open={serverDialogOpen}
        onClose={handleServerDialogClose}
        editServer={editServer}
        onTelemtFetched={handleTelemtFetched}
        onLogLine={(line) => console.log('[telemt]', line)}
      />

      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#1c1a14',
            border: '1px solid #2e2a1a',
            color: '#ede8e0',
            fontSize: '13px',
          },
        }}
      />
    </div>
  )
}
