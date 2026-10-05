import { LogOut, ShieldCheck, User as UserIcon } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'

export default function Header() {
  const { me, signOut } = useAuth()

  return (
    <header className="flex items-center justify-between mb-10">
      <div className="flex items-center gap-4">
        <img src="/logo/scala-logo.svg" alt="Scala" className="h-8 w-auto" />
        <div className="w-px h-6 bg-white/10" />
        <div>
          <h1 className="text-lg font-bold text-scala-text-primary leading-tight">
            Leads Scraper
          </h1>
          <p className="text-xs text-scala-text-muted">
            Google Maps + extracción de emails
          </p>
        </div>
      </div>

      {me && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5">
            {me.role === 'admin'
              ? <ShieldCheck size={13} className="text-scala-blue-light" />
              : <UserIcon size={13} className="text-scala-text-muted" />}
            <span className="text-xs text-scala-text-primary font-medium">{me.email}</span>
            <span className="text-[10px] uppercase tracking-wider text-scala-text-muted px-1.5 py-0.5 rounded bg-white/5">
              {me.role}
            </span>
          </div>
          <button
            onClick={signOut}
            title="Cerrar sesión"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs text-scala-text-muted hover:text-red-400 hover:border-red-400/30 transition-colors"
          >
            <LogOut size={13} />
            Salir
          </button>
        </div>
      )}
    </header>
  )
}
