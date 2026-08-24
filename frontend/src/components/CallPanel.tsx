import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X, Phone, Star, Globe, ExternalLink, Mic, Square, Loader2, Save,
  AlertCircle, CheckCircle2, MapPin, Mail, History, Trash2, Upload, MessageCircle,
} from 'lucide-react'
import { API, apiFetch, apiJson, getAccessToken } from '../lib/api'
import { waLink, WA_DEFAULT_TEXT } from '../lib/phone'
import {
  type Call, type Disposition, type Lead,
  DISPOSITION_LABEL, DISPOSITION_ORDER,
} from '../types'

interface Props {
  lead: Lead
  onClose: () => void
  onSaved?: (call: Call) => void
}

/* Colores por disposición — verde = bueno, rojo = muerto, gris = neutro */
const DISPOSITION_STYLE: Record<Disposition, string> = {
  no_atendio:        'border-white/15 text-scala-text-muted',
  buzon:             'border-white/15 text-scala-text-muted',
  gatekeeper:        'border-yellow-500/40 text-yellow-300',
  no_interesado:     'border-red-500/40 text-red-300',
  llamar_despues:    'border-scala-blue/40 text-scala-blue-light',
  interesado:        'border-purple-500/40 text-purple-300',
  cita_agendada:     'border-scala-green/50 text-scala-green',
  numero_equivocado: 'border-white/15 text-scala-text-muted',
  no_llamar:         'border-red-500/50 text-red-400',
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Fecha/hora local en el formato que espera <input type="datetime-local"> */
function toLocalInput(d: Date): string {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16)
}

export default function CallPanel({ lead, onClose, onSaved }: Props) {
  const [disposition, setDisposition] = useState<Disposition | null>(null)
  const [notes, setNotes] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [nextActionAt, setNextActionAt] = useState('')
  const [appointmentAt, setAppointmentAt] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState(false)

  const [history, setHistory] = useState<Call[]>([])
  const savedRef = useRef(false)

  // ── Grabación ──────────────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    apiJson<Call[]>(`/api/calls?place_id=${encodeURIComponent(lead.place_id)}`)
      .then(setHistory)
      .catch(() => { /* sin historial */ })
  }, [lead.place_id])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  useEffect(() => () => {
    stopTracks()
    if (audioUrl) URL.revokeObjectURL(audioUrl)
  }, [stopTracks, audioUrl])

  const startRecording = async () => {
    setMicError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream
      chunksRef.current = []

      const rec = new MediaRecorder(stream)
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        stopTracks()
      }
      rec.start()
      recorderRef.current = rec
      setRecording(true)
      setElapsed(0)
      timerRef.current = window.setInterval(() => setElapsed(e => e + 1), 1000)
    } catch {
      setMicError('No se pudo acceder al micrófono. Revisá los permisos del navegador.')
    }
  }

  const stopRecording = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const discardRecording = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setElapsed(0)
  }

  /** Alternativa a grabar en el navegador: subir un audio grabado en el celular. */
  const handleFilePick = (file: File) => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setMicError(null)
    setAudioBlob(file)
    setAudioUrl(URL.createObjectURL(file))

    // Leer la duración real del archivo para el costo y las métricas
    const probe = new Audio(URL.createObjectURL(file))
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration)) setElapsed(Math.round(probe.duration))
    }
  }

  // ── Guardar ────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!disposition) { setError('Elegí un resultado para la llamada'); return }
    setError(null)
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        place_id: lead.place_id,
        disposition,
        caller_type: 'humano',
      }
      if (notes.trim())         body.notes = notes.trim()
      if (nextStep.trim())      body.next_step = nextStep.trim()
      if (nextActionAt)         body.next_action_at = new Date(nextActionAt).toISOString()
      if (appointmentAt)        body.appointment_at = new Date(appointmentAt).toISOString()
      if (contactName.trim())   body.contact_name = contactName.trim()
      if (contactEmail.trim())  body.contact_email = contactEmail.trim()
      if (elapsed > 0)          body.duration_seconds = elapsed

      const res = await apiFetch('/api/calls', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { detail?: string }
        throw new Error(err.detail || `${res.status} ${res.statusText}`)
      }
      let call = await res.json() as Call
      savedRef.current = true

      // Subir audio (si hay) y esperar la transcripción
      if (audioBlob) {
        setTranscribing(true)
        const form = new FormData()
        form.append('file', audioBlob, `llamada-${call.id}.webm`)
        if (elapsed > 0) form.append('duration_seconds', String(elapsed))

        const token = getAccessToken()
        const up = await fetch(`${API}/api/calls/${call.id}/audio`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        })
        if (up.ok) {
          call = await up.json() as Call
        } else {
          const err = await up.json().catch(() => ({})) as { detail?: string }
          setTranscribing(false)
          setSaving(false)
          setError(
            `✔ Llamada y audio GUARDADOS. Solo falló la transcripción (${err.detail ?? up.status}). ` +
            'La podés transcribir después desde el historial con "Transcribir pendientes".'
          )
          onSaved?.(call)
          return  // no cerramos: que el mensaje se lea
        }
        setTranscribing(false)
      }

      onSaved?.(call)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
      setTranscribing(false)
    }
  }

  const tryClose = () => {
    if (!savedRef.current && (recording || audioBlob)) {
      const ok = window.confirm('Tenés una grabación sin guardar. Si cerrás ahora se pierde. ¿Cerrar igual?')
      if (!ok) return
    }
    onClose()
  }

  const needsAppointment = disposition === 'cita_agendada' 
  const needsFollowUp = disposition === 'llamar_despues' || disposition === 'interesado'

  // Atajo: la ventana de 72hs que recomienda el sistema
  const suggestSlot = (hoursFromNow: number) => {
    const d = new Date(Date.now() + hoursFromNow * 3600_000)
    d.setMinutes(0, 0, 0)
    return toLocalInput(d)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={tryClose}>
      <div
        className="w-full max-w-xl h-full overflow-y-auto bg-scala-surface1 border-l border-white/10 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 px-6 py-4 bg-scala-surface1 border-b border-white/[0.07]">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-scala-text-primary truncate">{lead.name}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-scala-text-muted">
              {lead.search_zone && (
                <span className="flex items-center gap-1"><MapPin size={11} />{lead.search_zone}</span>
              )}
              {lead.rating != null && (
                <span className="flex items-center gap-1">
                  <Star size={11} className="text-yellow-400 fill-yellow-400" />
                  {lead.rating} ({lead.reviews_count ?? 0})
                </span>
              )}
              {lead.call_count ? <span>· {lead.call_count} llamada(s) previas</span> : null}
            </div>
          </div>
          <button onClick={tryClose} className="p-1.5 rounded-lg text-scala-text-muted hover:text-scala-text-primary hover:bg-white/5">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Contexto para tener a la vista mientras hablás */}
          <div className="rounded-xl border border-white/[0.07] bg-scala-surface2 p-4 space-y-2.5">
            {lead.phone ? (
              <div className="flex flex-wrap items-center gap-3">
                <a href={`tel:${lead.phone}`}
                   className="flex items-center gap-2.5 text-lg font-semibold text-scala-green hover:underline">
                  <Phone size={18} />{lead.phone}
                </a>
                {waLink(lead.phone, WA_DEFAULT_TEXT) && (
                  <a href={waLink(lead.phone, WA_DEFAULT_TEXT)!}
                     target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#25D366]/15 border border-[#25D366]/40 text-xs font-medium text-[#25D366] hover:bg-[#25D366] hover:text-white transition-colors">
                    <MessageCircle size={13} /> Enviar WhatsApp
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-scala-text-subtle">Sin teléfono registrado</p>
            )}
            {lead.address && <p className="text-xs text-scala-text-muted">{lead.address}</p>}
            <div className="flex flex-wrap gap-3 text-xs">
              {lead.website ? (
                <a href={lead.website} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-1 text-scala-blue-light hover:underline">
                  <Globe size={12} /> Ver web <ExternalLink size={10} />
                </a>
              ) : (
                <span className="flex items-center gap-1 text-yellow-300">
                  <AlertCircle size={12} /> Sin sitio web — buen gancho
                </span>
              )}
              {lead.email && (
                <span className="flex items-center gap-1 text-scala-text-muted">
                  <Mail size={12} />{lead.email}
                </span>
              )}
            </div>
            {lead.category && (
              <p className="text-xs text-scala-text-subtle">{lead.category.replace(/_/g, ' ')}</p>
            )}
          </div>

          {/* Grabación */}
          <div>
            <label className="text-xs uppercase tracking-widest text-scala-text-muted mb-2 block">
              Grabación
            </label>
            <div className="rounded-xl border border-white/[0.07] bg-scala-surface2 p-4">
              {!audioBlob ? (
                <div className="flex items-center gap-3">
                  {!recording ? (
                    <button onClick={startRecording}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/15 border border-red-500/40 text-sm text-red-300 hover:bg-red-500/25 transition-colors">
                      <Mic size={15} /> Grabar
                    </button>
                  ) : (
                    <button onClick={stopRecording}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors">
                      <Square size={14} className="fill-current" /> Detener
                    </button>
                  )}
                  <span className={`text-sm font-mono ${recording ? 'text-red-300' : 'text-scala-text-subtle'}`}>
                    {recording && <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse mr-2" />}
                    {fmtDuration(elapsed)}
                  </span>
                  {!recording && (
                    <div className="ml-auto flex items-center gap-3">
                      <span className="text-xs text-scala-text-subtle">celular en altavoz</span>
                      <span className="text-xs text-scala-text-subtle">o</span>
                      <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-xs text-scala-text-muted hover:text-scala-text-primary hover:border-white/25 cursor-pointer transition-colors">
                        <Upload size={13} /> Subir audio
                        <input
                          type="file"
                          accept="audio/*,video/mp4,.m4a"
                          className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleFilePick(f) }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 size={15} className="text-scala-green shrink-0" />
                    <span className="text-sm text-scala-text-primary">
                      Grabado — {fmtDuration(elapsed)}
                    </span>
                    <button onClick={discardRecording}
                            className="ml-auto flex items-center gap-1 text-xs text-scala-text-muted hover:text-red-400">
                      <Trash2 size={12} /> Descartar
                    </button>
                  </div>
                  {audioUrl && <audio controls src={audioUrl} className="w-full h-9" />}
                  <p className="text-xs text-scala-text-subtle">
                    Se transcribe automáticamente al guardar.
                  </p>
                </div>
              )}
              {micError && (
                <p className="mt-2 text-xs text-red-300 flex items-start gap-1.5">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />{micError}
                </p>
              )}
            </div>
          </div>

          {/* Disposición */}
          <div>
            <label className="text-xs uppercase tracking-widest text-scala-text-muted mb-2 block">
              ¿Qué pasó? <span className="text-red-400">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {DISPOSITION_ORDER.map(d => (
                <button
                  key={d}
                  onClick={() => setDisposition(d)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    disposition === d
                      ? `${DISPOSITION_STYLE[d]} bg-white/[0.08] ring-1 ring-white/20`
                      : `${DISPOSITION_STYLE[d]} bg-scala-surface2 opacity-60 hover:opacity-100`
                  }`}
                >
                  {DISPOSITION_LABEL[d]}
                </button>
              ))}
            </div>
          </div>

          {/* Campos de cita */}
          {needsAppointment && (
            <div className="rounded-xl border border-scala-green/30 bg-scala-green/[0.06] p-4 space-y-3">
              <p className="text-xs text-scala-green font-medium">Datos de la cita</p>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-scala-text-muted mb-1 block">
                  Fecha y hora
                </label>
                <input type="datetime-local" value={appointmentAt}
                       onChange={e => setAppointmentAt(e.target.value)}
                       className="w-full px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary focus:outline-none focus:border-scala-green/50" />
                <div className="flex gap-1.5 mt-1.5">
                  {[{ h: 24, l: 'Mañana' }, { h: 48, l: 'En 2 días' }, { h: 72, l: 'En 3 días' }].map(s => (
                    <button key={s.h} onClick={() => setAppointmentAt(suggestSlot(s.h))}
                            className="px-2 py-0.5 rounded-full text-[10px] border border-white/10 text-scala-text-muted hover:text-scala-text-primary hover:border-white/25">
                      {s.l}
                    </button>
                  ))}
                  <span className="text-[10px] text-scala-text-subtle self-center ml-1">
                    dentro de 72hs = mejor show rate
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Nombre del contacto" value={contactName}
                       onChange={e => setContactName(e.target.value)}
                       className="px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-green/50" />
                <input placeholder="Email (que lo diga él)" value={contactEmail}
                       onChange={e => setContactEmail(e.target.value)}
                       className="px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-green/50" />
              </div>
            </div>
          )}

          {/* Notas */}
          <div>
            <label className="text-xs uppercase tracking-widest text-scala-text-muted mb-2 block">
              Notas
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Qué dijo, objeciones que puso, con quién hablaste..."
              className="w-full px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-blue/50 resize-y"
            />
          </div>

          {/* Próximo paso */}
          <div className={needsFollowUp ? 'rounded-xl border border-scala-blue/30 bg-scala-blue/[0.06] p-4 space-y-3' : 'space-y-3'}>
            <label className="text-xs uppercase tracking-widest text-scala-text-muted block">
              Próximo paso
            </label>
            <input
              value={nextStep}
              onChange={e => setNextStep(e.target.value)}
              placeholder="Ej: volver a llamar al dueño, mandar propuesta..."
              className="w-full px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-blue/50"
            />
            <div>
              <input type="datetime-local" value={nextActionAt}
                     onChange={e => setNextActionAt(e.target.value)}
                     className="w-full px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary focus:outline-none focus:border-scala-blue/50" />
              <div className="flex gap-1.5 mt-1.5">
                {[{ h: 24, l: 'Mañana' }, { h: 24 * 7, l: 'En 1 semana' }, { h: 24 * 30, l: 'En 1 mes' }, { h: 24 * 90, l: 'En 3 meses' }].map(s => (
                  <button key={s.h} onClick={() => setNextActionAt(suggestSlot(s.h))}
                          className="px-2 py-0.5 rounded-full text-[10px] border border-white/10 text-scala-text-muted hover:text-scala-text-primary hover:border-white/25">
                    {s.l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Guardar */}
          <button
            onClick={save}
            disabled={saving || !disposition}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-scala-blue hover:bg-scala-blue-light text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {transcribing
              ? <><Loader2 size={15} className="animate-spin" />Transcribiendo...</>
              : saving
                ? <><Loader2 size={15} className="animate-spin" />Guardando...</>
                : <><Save size={15} />Guardar llamada</>}
          </button>

          {/* Historial */}
          {history.length > 0 && (
            <div className="pt-2 border-t border-white/[0.07]">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-scala-text-muted mb-3">
                <History size={12} /> Llamadas anteriores ({history.length})
              </p>
              <div className="space-y-2">
                {history.map(c => (
                  <div key={c.id} className="rounded-lg border border-white/[0.07] bg-scala-surface2 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-medium ${DISPOSITION_STYLE[c.disposition]}`}>
                        {DISPOSITION_LABEL[c.disposition]}
                      </span>
                      <span className="text-scala-text-subtle">
                        {new Date(c.created_at).toLocaleDateString('es-AR')}
                      </span>
                    </div>
                    {c.summary && <p className="text-scala-text-muted mt-1.5 leading-relaxed">{c.summary}</p>}
                    {c.notes && <p className="text-scala-text-subtle mt-1 italic">{c.notes}</p>}
                    {c.recording_url && (
                      <div className="mt-2 space-y-1">
                        <audio controls preload="none" src={c.recording_url} className="w-full h-8" />
                        {!c.transcript && (
                          <p className="text-[10px] text-yellow-300">Audio guardado — sin transcribir todavía</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
