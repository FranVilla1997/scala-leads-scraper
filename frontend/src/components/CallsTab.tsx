import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Phone, RefreshCw, Star, Clock, Flame, RotateCcw, FileText, X, Loader2,
  TrendingUp, DollarSign, CalendarCheck, MessageSquare, ChevronRight, Sparkles,
} from 'lucide-react'
import { apiFetch, apiJson } from '../lib/api'
import {
  type Call, type CallMetrics, type CallQueue, type Lead,
  DISPOSITION_LABEL,
} from '../types'
import CallPanel from './CallPanel'

type QueueKey = 'seguimiento' | 'nuevos' | 'reintentar'

const QUEUE_META: Record<QueueKey, { label: string; hint: string; icon: typeof Flame; color: string }> = {
  seguimiento: { label: 'Seguimientos vencidos', hint: 'Lo más caliente — ya hablaste y quedaron en algo', icon: Flame,     color: 'text-scala-green' },
  nuevos:      { label: 'Nunca llamados',        hint: 'Ordenados por calidad (rating × reseñas)',        icon: Phone,     color: 'text-scala-blue-light' },
  reintentar:  { label: 'Reintentar',            hint: 'Llamados hace más de 7 días, sin cerrar',         icon: RotateCcw, color: 'text-yellow-300' },
}

function LeadRow({ lead, onCall }: { lead: Lead; onCall: (l: Lead) => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-scala-text-primary truncate">{lead.name || '—'}</p>
        <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-scala-text-muted">
          <span className="px-1.5 py-0.5 rounded bg-scala-blue/10 text-scala-blue-light border border-scala-blue/20">
            {lead.search_zone}
          </span>
          {lead.rating != null && (
            <span className="flex items-center gap-1">
              <Star size={10} className="text-yellow-400 fill-yellow-400" />
              {lead.rating} ({lead.reviews_count ?? 0})
            </span>
          )}
          {!lead.website && (
            <span className="text-yellow-300">sin web</span>
          )}
          {lead.call_count ? <span>· {lead.call_count} llamada(s)</span> : null}
        </div>
      </div>
      <span className="hidden sm:block text-xs text-scala-text-muted font-mono whitespace-nowrap">
        {lead.phone}
      </span>
      <button
        onClick={() => onCall(lead)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-scala-blue hover:bg-scala-blue-light text-white text-xs font-medium transition-colors shrink-0"
      >
        <Phone size={12} /> Llamar
      </button>
    </div>
  )
}

export default function CallsTab() {
  const [queue, setQueue] = useState<CallQueue | null>(null)
  const [metrics, setMetrics] = useState<CallMetrics | null>(null)
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(false)

  const [activeQueue, setActiveQueue] = useState<QueueKey>('seguimiento')
  const [callingLead, setCallingLead] = useState<Lead | null>(null)
  const [openCall, setOpenCall] = useState<Call | null>(null)
  const [transcribing, setTranscribing] = useState<string | null>(null)
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [q, m, c] = await Promise.all([
        apiJson<CallQueue>('/api/calls/queue'),
        apiJson<CallMetrics>('/api/calls/metrics'),
        apiJson<Call[]>('/api/calls'),
      ])
      setQueue(q)
      setMetrics(m)
      setCalls(c)
      // Arrancar en la primera cola que tenga algo
      if (q.totals.seguimiento === 0) {
        setActiveQueue(q.totals.nuevos > 0 ? 'nuevos' : 'reintentar')
      }
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const transcribeOne = async (call: Call) => {
    setTranscribing(call.id)
    try {
      const res = await apiFetch(`/api/calls/${call.id}/transcribe`, { method: 'POST' })
      if (res.ok) {
        const updated = await res.json() as Call
        setOpenCall(updated)
        setCalls(prev => prev.map(c => c.id === updated.id ? updated : c))
      } else {
        const err = await res.json().catch(() => ({})) as { detail?: string }
        setBulkMsg(err.detail || 'No se pudo transcribir')
      }
    } finally { setTranscribing(null) }
  }

  const transcribePending = async () => {
    setBulkMsg('Procesando...')
    const res = await apiFetch('/api/calls/transcribe-pending', { method: 'POST' })
    if (res.ok) {
      const r = await res.json() as { pendientes: number; transcriptas: number; fallidas: number }
      setBulkMsg(`${r.transcriptas} de ${r.pendientes} transcriptas${r.fallidas ? ` · ${r.fallidas} fallaron` : ''}`)
      load()
    } else {
      const err = await res.json().catch(() => ({})) as { detail?: string }
      setBulkMsg(err.detail || 'Error')
    }
  }

  const pendingCount = useMemo(
    () => calls.filter(c => c.recording_url && !c.transcript).length,
    [calls],
  )

  const leadsByPlace = useMemo(() => {
    const m = new Map<string, Lead>()
    if (queue) {
      [...queue.seguimiento, ...queue.nuevos, ...queue.reintentar].forEach(l => m.set(l.place_id, l))
    }
    return m
  }, [queue])

  const kpis = metrics ? [
    { label: 'Llamadas',        value: metrics.total_calls,   sub: `${metrics.calls_last_7d} en 7 días`, icon: Phone,         color: 'text-scala-text-primary' },
    { label: 'Conversaciones',  value: metrics.conversations, sub: `${metrics.connect_rate}% de contacto`, icon: MessageSquare, color: 'text-scala-blue-light' },
    { label: 'Citas agendadas', value: metrics.appointments,  sub: `${metrics.conversation_to_appt}% de las conversaciones`, icon: CalendarCheck, color: 'text-scala-green' },
    { label: 'Llamadas x cita', value: metrics.calls_per_appointment ?? '—', sub: 'tu ratio real', icon: TrendingUp,   color: 'text-purple-300' },
    { label: 'Costo x cita',    value: metrics.cost_per_appointment != null ? `$${metrics.cost_per_appointment}` : '—', sub: `$${metrics.total_cost_usd} total`, icon: DollarSign, color: 'text-yellow-300' },
  ] : []

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <k.icon size={12} className="text-scala-text-subtle" />
              <p className="text-xs text-scala-text-muted">{k.label}</p>
            </div>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-scala-text-subtle mt-0.5">{k.sub}</p>
          </div>
        ))}
        {!metrics && (
          <div className="col-span-2 sm:col-span-5 rounded-xl border border-white/[0.07] bg-scala-surface1 p-6 text-center text-sm text-scala-text-muted">
            {loading ? 'Cargando métricas...' : 'Todavía no hay llamadas registradas'}
          </div>
        )}
      </div>

      {/* Cola de trabajo */}
      <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-white/[0.07]">
          <h2 className="text-sm font-medium text-scala-text-primary">A quién llamo hoy</h2>
          <button onClick={load} disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.07] bg-scala-surface2 text-xs text-scala-text-muted hover:text-scala-text-primary transition-colors disabled:opacity-40">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>

        {/* Selector de cola */}
        <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-white/[0.07]">
          {(Object.keys(QUEUE_META) as QueueKey[]).map(k => {
            const meta = QUEUE_META[k]
            const count = queue?.totals[k] ?? 0
            const active = activeQueue === k
            return (
              <button key={k} onClick={() => setActiveQueue(k)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all ${
                        active
                          ? 'border-scala-blue/50 bg-scala-blue/10 text-scala-text-primary'
                          : 'border-white/[0.07] bg-scala-surface2 text-scala-text-muted hover:text-scala-text-primary'
                      }`}>
                <meta.icon size={13} className={active ? meta.color : ''} />
                {meta.label}
                <span className="px-1.5 py-0.5 rounded-full bg-white/[0.08] text-[10px] font-bold">{count}</span>
              </button>
            )
          })}
        </div>

        <p className="px-5 py-2 text-xs text-scala-text-subtle border-b border-white/[0.04]">
          {QUEUE_META[activeQueue].hint}
        </p>

        <div className="max-h-[520px] overflow-y-auto">
          {!queue || queue[activeQueue].length === 0 ? (
            <div className="py-14 text-center">
              <Clock size={26} className="mx-auto mb-3 text-scala-text-subtle opacity-30" />
              <p className="text-sm text-scala-text-muted">
                {loading ? 'Cargando...' : 'No hay leads en esta cola'}
              </p>
            </div>
          ) : (
            queue[activeQueue].map(l => (
              <LeadRow key={l.place_id} lead={l} onCall={setCallingLead} />
            ))
          )}
        </div>
      </div>

      {/* Historial */}
      <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-white/[0.07]">
          <h2 className="text-sm font-medium text-scala-text-primary">
            Historial de llamadas
            <span className="ml-2 text-xs text-scala-text-muted font-normal">{calls.length}</span>
          </h2>
          <div className="flex items-center gap-3">
            {bulkMsg && <span className="text-xs text-scala-text-muted">{bulkMsg}</span>}
            {pendingCount > 0 && (
              <button onClick={transcribePending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-scala-blue/15 border border-scala-blue/40 text-xs text-scala-blue-light hover:bg-scala-blue hover:text-white transition-colors">
                <Sparkles size={12} /> Transcribir {pendingCount} pendiente{pendingCount > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
        {calls.length === 0 ? (
          <div className="py-12 text-center">
            <Phone size={24} className="mx-auto mb-3 text-scala-text-subtle opacity-30" />
            <p className="text-sm text-scala-text-muted">Todavía no registraste ninguna llamada</p>
          </div>
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            {calls.map(c => {
              const lead = leadsByPlace.get(c.place_id)
              return (
                <button key={c.id} onClick={() => setOpenCall(c)}
                        className="w-full flex items-start gap-3 px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors text-left">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-scala-text-primary truncate">
                        {lead?.name ?? c.place_id.slice(0, 18)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] border border-white/10 text-scala-text-muted">
                        {DISPOSITION_LABEL[c.disposition]}
                      </span>
                      {c.caller_type === 'agente_ia' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/15 border border-purple-500/30 text-purple-300">IA</span>
                      )}
                      {c.transcript && (
                        <span className="flex items-center gap-1 text-[10px] text-scala-green">
                          <FileText size={10} /> transcripta
                        </span>
                      )}
                    </div>
                    {(c.summary || c.notes) && (
                      <p className="text-xs text-scala-text-muted mt-1 line-clamp-2">
                        {c.summary || c.notes}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-scala-text-subtle">
                      {new Date(c.created_at).toLocaleDateString('es-AR')}
                    </p>
                    {c.duration_seconds ? (
                      <p className="text-[10px] text-scala-text-subtle">
                        {Math.floor(c.duration_seconds / 60)}:{String(c.duration_seconds % 60).padStart(2, '0')}
                      </p>
                    ) : null}
                  </div>
                  <ChevronRight size={14} className="text-scala-text-subtle shrink-0 mt-1" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Panel de llamada */}
      {callingLead && (
        <CallPanel
          lead={callingLead}
          onClose={() => setCallingLead(null)}
          onSaved={() => load()}
        />
      )}

      {/* Detalle de llamada / transcripción */}
      {openCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
             onClick={() => setOpenCall(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-scala-surface1 shadow-2xl"
               onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 flex items-start justify-between gap-4 px-6 py-4 bg-scala-surface1 border-b border-white/[0.07]">
              <div>
                <h3 className="text-base font-semibold text-scala-text-primary">
                  {leadsByPlace.get(openCall.place_id)?.name ?? 'Llamada'}
                </h3>
                <p className="text-xs text-scala-text-muted mt-0.5">
                  {DISPOSITION_LABEL[openCall.disposition]} ·{' '}
                  {new Date(openCall.created_at).toLocaleString('es-AR')}
                  {openCall.caller_email ? ` · ${openCall.caller_email}` : ''}
                </p>
              </div>
              <button onClick={() => setOpenCall(null)}
                      className="p-1.5 rounded-lg text-scala-text-muted hover:text-scala-text-primary hover:bg-white/5">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {openCall.recording_url && (
                <div className="space-y-2">
                  <audio controls src={openCall.recording_url} className="w-full h-10" />
                  {!openCall.transcript && (
                    <button onClick={() => transcribeOne(openCall)}
                            disabled={transcribing === openCall.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-scala-blue/15 border border-scala-blue/40 text-xs text-scala-blue-light hover:bg-scala-blue hover:text-white disabled:opacity-50 transition-colors">
                      {transcribing === openCall.id
                        ? <><Loader2 size={12} className="animate-spin" /> Transcribiendo...</>
                        : <><Sparkles size={12} /> Transcribir ahora</>}
                    </button>
                  )}
                </div>
              )}

              {openCall.summary && (
                <div>
                  <p className="text-xs uppercase tracking-widest text-scala-text-muted mb-1.5">Resumen</p>
                  <p className="text-sm text-scala-text-primary leading-relaxed">{openCall.summary}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {openCall.sentiment && (
                  <span className={`px-2 py-1 rounded-full text-xs border ${
                    openCall.sentiment === 'positivo' ? 'border-scala-green/40 text-scala-green'
                    : openCall.sentiment === 'negativo' ? 'border-red-500/40 text-red-300'
                    : 'border-white/15 text-scala-text-muted'
                  }`}>
                    Sentimiento: {openCall.sentiment}
                  </span>
                )}
                {openCall.interest_level && (
                  <span className="px-2 py-1 rounded-full text-xs border border-purple-500/30 text-purple-300">
                    Interés: {openCall.interest_level}
                  </span>
                )}
                {openCall.cost_usd != null && (
                  <span className="px-2 py-1 rounded-full text-xs border border-white/15 text-scala-text-muted">
                    ${openCall.cost_usd}
                  </span>
                )}
              </div>

              {openCall.objections && openCall.objections.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-widest text-scala-text-muted mb-1.5">Objeciones</p>
                  <div className="flex flex-wrap gap-1.5">
                    {openCall.objections.map((o, i) => (
                      <span key={i} className="px-2 py-1 rounded-lg text-xs bg-yellow-500/10 border border-yellow-500/25 text-yellow-200">
                        {o}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {openCall.notes && (
                <div>
                  <p className="text-xs uppercase tracking-widest text-scala-text-muted mb-1.5">Tus notas</p>
                  <p className="text-sm text-scala-text-muted italic leading-relaxed">{openCall.notes}</p>
                </div>
              )}

              {openCall.next_step && (
                <div className="rounded-lg border border-scala-blue/30 bg-scala-blue/[0.06] p-3">
                  <p className="text-xs text-scala-blue-light font-medium mb-1">Próximo paso</p>
                  <p className="text-sm text-scala-text-primary">{openCall.next_step}</p>
                  {openCall.next_action_at && (
                    <p className="text-xs text-scala-text-muted mt-1">
                      {new Date(openCall.next_action_at).toLocaleString('es-AR')}
                    </p>
                  )}
                </div>
              )}

              {openCall.transcript && (
                <div>
                  <p className="text-xs uppercase tracking-widest text-scala-text-muted mb-1.5">Transcripción</p>
                  <div className="rounded-lg border border-white/[0.07] bg-scala-surface2 p-4 max-h-72 overflow-y-auto">
                    <p className="text-xs text-scala-text-muted whitespace-pre-wrap leading-relaxed">
                      {openCall.transcript}
                    </p>
                  </div>
                </div>
              )}

              {!openCall.transcript && openCall.transcript_status === 'error' && (
                <p className="text-xs text-red-300">La transcripción falló para esta llamada.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
