import { useState, useEffect } from 'react'
import { KeyRound, Lock, Info } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/components/ui/utils'
import { useCreateServer, useUpdateServer } from '@/hooks/useServers'
import { servers as serversApi } from '@/api/client'
import type { StoredServer, StoredServerCreate, AuthMode, TelemtConfig } from '@/types'

interface ServerDialogProps {
  open: boolean
  onClose: () => void
  editServer?: StoredServer | null
  onTelemtFetched?: (t: TelemtConfig) => void
  onLogLine?: (line: string) => void
}

export function ServerDialog({
  open, onClose, editServer, onTelemtFetched, onLogLine,
}: ServerDialogProps) {
  const isEdit = !!editServer
  const createServer = useCreateServer()
  const updateServer = useUpdateServer()

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(22)
  const [username, setUsername] = useState('root')
  const [authMode, setAuthMode] = useState<AuthMode>('key')
  const [privateKey, setPrivateKey] = useState('')
  const [keyPass, setKeyPass] = useState('')
  const [password, setPassword] = useState('')
  const [fetchTelemt, setFetchTelemt] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setError('')
      setSubmitting(false)
      if (editServer) {
        setName(editServer.name)
        setHost(editServer.host)
        setPort(editServer.port)
        setUsername(editServer.username)
        setAuthMode(editServer.auth_mode)
        setPrivateKey(editServer.private_key || '')
        setKeyPass(editServer.private_key_passphrase || '')
        setPassword(editServer.password || '')
        setFetchTelemt(false)
      } else {
        setName('')
        setHost('')
        setPort(22)
        setUsername('root')
        setAuthMode('key')
        setPrivateKey('')
        setKeyPass('')
        setPassword('')
        setFetchTelemt(true)
      }
    }
  }, [open, editServer])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!name.trim()) { setError('Укажите название'); return }
    if (!host.trim()) { setError('Укажите хост'); return }
    if (!username.trim()) { setError('Укажите пользователя'); return }
    if (authMode === 'key' && !privateKey.trim()) { setError('Вставьте приватный ключ'); return }
    if (authMode === 'password' && !password.trim()) { setError('Укажите пароль SSH'); return }

    setSubmitting(true)
    try {
      const body: StoredServerCreate = {
        name: name.trim(),
        host: host.trim(),
        port,
        username: username.trim(),
        auth_mode: authMode,
        private_key: authMode === 'key' ? privateKey.trim() : null,
        private_key_passphrase: authMode === 'key' ? keyPass || null : null,
        password: authMode === 'password' ? password.trim() : null,
      }

      if (!isEdit && fetchTelemt && onTelemtFetched) {
        onLogLine?.('Чтение /etc/telemt/telemt.toml по SSH…')
        try {
          const sshAuth = {
            host: body.host,
            port: body.port,
            username: body.username,
            private_key: body.private_key ?? null,
            private_key_passphrase: body.private_key_passphrase ?? null,
            password: body.password ?? null,
          }
          const fr = await serversApi.fetchRemoteTelemt(sshAuth)
          if (!fr.ok) throw new Error(fr.message || 'Не удалось подключиться')
          if (fr.telemt) {
            onTelemtFetched(fr.telemt)
            onLogLine?.(fr.message || 'Конфиг Telemt считан с сервера.')
          } else {
            onLogLine?.(fr.message || (fr.found ? 'Файл не разобран' : 'Файл не найден на сервере'))
          }
        } catch (ex) {
          onLogLine?.(`Предупреждение: ${ex instanceof Error ? ex.message : ex}`)
        }
      }

      if (isEdit && editServer) {
        await updateServer.mutateAsync({ id: editServer.id, body })
      } else {
        await createServer.mutateAsync(body)
      }
      onClose()
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Изменить сервер' : 'Новый сервер'}</DialogTitle>
        </DialogHeader>

        <form id="server-form" onSubmit={handleSubmit}>
          <div className="px-5 py-4 space-y-3">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="dlg-name">Название</Label>
              <Input
                id="dlg-name"
                placeholder="EU-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Host */}
            <div className="space-y-1.5">
              <Label htmlFor="dlg-host">Хост</Label>
              <Input
                id="dlg-host"
                placeholder="203.0.113.10"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                autoComplete="off"
                required
              />
            </div>

            {/* Port + User */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dlg-port">Порт SSH</Label>
                <Input
                  id="dlg-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dlg-user">Пользователь</Label>
                <Input
                  id="dlg-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            {/* Auth mode toggle */}
            <div className="space-y-1.5">
              <Label>Способ входа</Label>
              <div className="flex gap-1 p-0.5 rounded-btn bg-bg-elevated border border-bg-border w-fit">
                {(['key', 'password'] as AuthMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAuthMode(m)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 h-6 rounded text-xs font-medium transition-all',
                      authMode === m
                        ? 'bg-bg-surface border border-bg-border text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-secondary'
                    )}
                  >
                    {m === 'key'
                      ? <><KeyRound className="h-3 w-3" />Ключ</>
                      : <><Lock className="h-3 w-3" />Пароль</>
                    }
                  </button>
                ))}
              </div>
            </div>

            {/* Key fields */}
            {authMode === 'key' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dlg-key">Приватный ключ (PEM / OpenSSH)</Label>
                  <Textarea
                    id="dlg-key"
                    rows={5}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dlg-key-pass">Пароль от ключа (если есть)</Label>
                  <Input
                    id="dlg-key-pass"
                    type="password"
                    value={keyPass}
                    onChange={(e) => setKeyPass(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
            )}

            {/* Password field */}
            {authMode === 'password' && (
              <div className="space-y-1.5">
                <Label htmlFor="dlg-password">Пароль SSH</Label>
                <Input
                  id="dlg-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            )}

            {/* Fetch telemt checkbox (new only) */}
            {!isEdit && (
              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={fetchTelemt}
                  onChange={(e) => setFetchTelemt(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-bg-border accent-amber-500"
                />
                <span className="text-xs text-text-secondary group-hover:text-text-primary leading-relaxed">
                  Считать <code className="font-mono text-text-primary">/etc/telemt/telemt.toml</code> и заполнить форму конфига
                </span>
              </label>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-danger/10 border border-danger/25 px-3 py-2 text-xs text-danger">
                <Info className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}
          </div>
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Отмена</Button>
          <Button variant="primary" form="server-form" type="submit" loading={submitting}>
            {isEdit ? 'Сохранить' : 'Добавить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
