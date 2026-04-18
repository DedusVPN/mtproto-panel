import { Plus, Server as ServerIcon, Trash2, Pencil } from 'lucide-react'
import { useServers, useDeleteServer } from '@/hooks/useServers'
import { useAppStore } from '@/store'
import { Button, cn } from '@/components/ui'
import type { StoredServer } from '@/types'

interface SidebarProps {
  onAddServer: () => void
  onEditServer: (s: StoredServer) => void
  onSelectServer: (id: string) => void
}

export function Sidebar({ onAddServer, onEditServer, onSelectServer }: SidebarProps) {
  const { data: serverList = [], isLoading } = useServers()
  const { selectedServerId } = useAppStore()
  const deleteServer = useDeleteServer()

  function handleDelete(e: React.MouseEvent, s: StoredServer) {
    e.stopPropagation()
    if (!confirm(`Удалить сервер «${s.name}»?`)) return
    deleteServer.mutate(s.id)
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-bg-border bg-bg-surface">
      {/* Add button */}
      <div className="px-3 pt-3 pb-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 border border-dashed border-bg-border hover:border-accent/40 hover:text-accent"
          onClick={onAddServer}
        >
          <Plus className="h-3.5 w-3.5" />
          Новый сервер
        </Button>
      </div>

      {/* List label */}
      <div className="px-4 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Серверы
        </span>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {isLoading && (
          <div className="px-2 py-6 flex justify-center">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-bg-border border-t-accent" />
          </div>
        )}
        {!isLoading && serverList.length === 0 && (
          <p className="px-3 py-4 text-xs text-text-muted text-center">
            Нет сохранённых серверов
          </p>
        )}
        {serverList.map((s) => (
          <ServerItem
            key={s.id}
            server={s}
            isActive={s.id === selectedServerId}
            onSelect={() => onSelectServer(s.id)}
            onEdit={() => onEditServer(s)}
            onDelete={(e) => handleDelete(e, s)}
          />
        ))}
      </div>
    </aside>
  )
}

function ServerItem({
  server,
  isActive,
  onSelect,
  onEdit,
  onDelete,
}: {
  server: StoredServer
  isActive: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-all duration-150',
        isActive
          ? 'bg-accent/10 border border-accent/25 text-text-primary'
          : 'hover:bg-bg-elevated text-text-secondary hover:text-text-primary border border-transparent'
      )}
      onClick={onSelect}
      title="Выбрать · двойной клик — редактировать"
      onDoubleClick={(e) => { e.preventDefault(); onEdit() }}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full bg-accent" />
      )}
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-elevated border border-bg-border">
        <ServerIcon className={cn('h-3 w-3', isActive ? 'text-accent' : 'text-text-muted')} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{server.name}</div>
        <div className="truncate text-[10px] text-text-muted font-mono">
          {server.host}:{server.port}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="flex h-5 w-5 items-center justify-center rounded hover:bg-bg-overlay text-text-muted hover:text-text-primary transition-colors"
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          title="Редактировать"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          className="flex h-5 w-5 items-center justify-center rounded hover:bg-danger/15 text-text-muted hover:text-danger transition-colors"
          onClick={onDelete}
          title="Удалить"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
