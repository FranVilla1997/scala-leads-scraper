import { useState, type FormEvent } from 'react'
import { Mail, Lock, LogIn, Loader2, AlertCircle } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await signIn(email, password)
    setBusy(false)
    if (error) setError(error)
  }

  return (
    <div className="scala-bg min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo/scala-logo.svg" alt="Scala" className="h-12 w-auto mb-5" />
          <h1 className="text-2xl font-bold text-scala-text-primary">Leads Scraper</h1>
          <p className="text-sm text-scala-text-muted mt-1.5">Iniciá sesión para continuar</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-white/[0.07] bg-scala-surface1 p-8 space-y-5">
          <div>
            <label className="text-xs text-scala-text-muted uppercase tracking-widest mb-2 block">Email</label>
            <div className="relative">
              <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-scala-text-subtle" />
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={busy}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-scala-surface2 border border-white/[0.07] text-sm text-scala-text-primary focus:outline-none focus:border-scala-blue/50 focus:ring-1 focus:ring-scala-blue/30 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-scala-text-muted uppercase tracking-widest mb-2 block">Contraseña</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-scala-text-subtle" />
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={busy}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-scala-surface2 border border-white/[0.07] text-sm text-scala-text-primary focus:outline-none focus:border-scala-blue/50 focus:ring-1 focus:ring-scala-blue/30 disabled:opacity-50"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-scala-blue hover:bg-scala-blue-light text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy
              ? <><Loader2 size={15} className="animate-spin" />Ingresando...</>
              : <><LogIn size={15} />Ingresar</>}
          </button>
        </form>

        <p className="text-center text-xs text-scala-text-subtle mt-6">
          ¿Olvidaste tu contraseña? Contactá al administrador.
        </p>
      </div>
    </div>
  )
}
