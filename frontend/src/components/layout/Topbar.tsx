import { Server, BarChart3, Cloud, Globe, Bell, LogOut } from 'lucide-react'
import { useAppStore } from '@/store'
import { auth } from '@/api/client'
import { toast } from 'sonner'
import { cn } from '@/components/ui'

type View = 'servers' | 'stats' | 'providers' | 'cloudflare' | 'monitor'

const TABS: { view: View; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { view: 'servers', label: 'Серверы', icon: Server },
  { view: 'stats', label: 'Статистика', icon: BarChart3 },
  { view: 'providers', label: 'Хостинг', icon: Cloud },
  { view: 'cloudflare', label: 'Cloudflare', icon: Globe },
  { view: 'monitor', label: 'Мониторинг', icon: Bell },
]

interface TopbarProps {
  authRequired: boolean
  username?: string
}

export function Topbar({ authRequired, username }: TopbarProps) {
  const { view, setView } = useAppStore()

  async function handleLogout() {
    try {
      await auth.logout()
      window.location.reload()
    } catch {
      toast.error('Ошибка при выходе')
    }
  }

  return (
    <header className="flex h-11 shrink-0 items-center border-b border-bg-border bg-bg-surface px-4 gap-1">
      {/* Brand */}
      <div className="flex items-center gap-2.5 mr-2 pr-3 border-r border-bg-border">
        <img
          src={`${import.meta.env.BASE_URL}logo.svg`}
          alt="Dedus"
          className="h-7 w-7 shrink-0 object-contain"
          draggable={false}
        />
        <div className="flex flex-col leading-none select-none">
          <span className="text-[11px] font-extrabold tracking-widest text-text-primary uppercase">
            Dedus
          </span>
          <span className="text-[9px] font-semibold tracking-wider text-text-muted uppercase">
            MTProxy
          </span>
        </div>
      </div>

      {TABS.map(({ view: v, label, icon: Icon }) => (
        <button
          key={v}
          onClick={() => setView(v)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 h-7 text-xs font-medium transition-all duration-150',
            view === v
              ? 'bg-accent/15 text-accent-hover border border-accent/25'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}

      <div className="ml-auto flex items-center gap-2">
        {authRequired && username && (
          <span className="text-xs text-text-muted hidden sm:block">
            {username}
          </span>
        )}
        {authRequired && (
          <button
            onClick={handleLogout}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
            title="Выйти"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </header>
  )
}
