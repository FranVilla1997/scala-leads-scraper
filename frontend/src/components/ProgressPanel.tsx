import { CheckCircle2, Loader2 } from 'lucide-react'

interface Props {
  message: string
  progress: { current: number; total: number }
  isSearching: boolean
  leadsFound: number
}

export default function ProgressPanel({ message, progress, isSearching, leadsFound }: Props) {
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const isDone = !isSearching

  return (
    <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-5 mb-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          {isSearching ? (
            <Loader2 size={16} className="text-scala-blue animate-spin shrink-0" />
          ) : (
            <CheckCircle2 size={16} className="text-scala-green shrink-0" />
          )}
          <p className="text-sm text-scala-text-primary">{message}</p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-xs text-scala-text-muted">Leads encontrados</p>
            <p className="text-lg font-bold text-scala-green">{leadsFound}</p>
          </div>
          {progress.total > 0 && (
            <div className="text-right">
              <p className="text-xs text-scala-text-muted">Progreso</p>
              <p className="text-lg font-bold text-scala-text-primary">
                {isDone ? progress.total : progress.current}
                <span className="text-sm font-normal text-scala-text-muted">/{progress.total}</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {progress.total > 0 && (
        <div className="relative h-1.5 rounded-full bg-scala-surface3 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
            style={{
              width: `${isDone ? 100 : pct}%`,
              background: isDone
                ? 'linear-gradient(90deg, #6bdda1, #3b7ef5)'
                : 'linear-gradient(90deg, #185de8, #3b7ef5)',
            }}
          />
        </div>
      )}

      {isSearching && progress.total === 0 && (
        <div className="h-1.5 rounded-full bg-scala-surface3 overflow-hidden">
          <div
            className="h-full w-1/3 rounded-full bg-scala-blue animate-pulse-blue"
            style={{ animation: 'pulse_blue 1.5s ease-in-out infinite, slide 2s linear infinite' }}
          />
        </div>
      )}
    </div>
  )
}
