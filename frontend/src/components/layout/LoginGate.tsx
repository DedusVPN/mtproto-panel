import { useState } from 'react'
import { Lock, AlertCircle } from 'lucide-react'
import { auth } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LoginGateProps {
  username: string
  onSuccess: () => void
}

export function LoginGate({ username, onSuccess }: LoginGateProps) {
  const [user, setUser] = useState(username)
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await auth.login(user.trim(), pass)
      if (!r.ok) {
        setError('Неверный логин или пароль')
        return
      }
      onSuccess()
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-base bg-gradient-base">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="rounded-card border border-bg-border bg-bg-surface shadow-card overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-bg-border px-6 py-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 border border-accent/30">
              <Lock className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Вход в панель</h2>
              <p className="text-xs text-text-muted">Сессия: cookie HttpOnly + JWT</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-username">Логин</Label>
              <Input
                id="login-username"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password">Пароль</Label>
              <Input
                id="login-password"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-md bg-danger/10 border border-danger/25 px-3 py-2 text-xs text-danger">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <Button variant="primary" size="lg" className="w-full" loading={loading}>
              Войти
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
