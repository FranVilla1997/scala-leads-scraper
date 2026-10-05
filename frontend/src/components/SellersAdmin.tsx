import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Users, ShieldCheck, MapPin, Save, Loader2, Plus, X, Mail, RefreshCw, UserPlus, AlertCircle, Power } from 'lucide-react'
import { apiFetch, apiJson } from '../lib/api'
import type { Seller } from '../types'

export default function SellersAdmin() {
  const [sellers, setSellers] = useState<Seller[]>([])
  const [availableZones, setAvailableZones] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftZones, setDraftZones] = useState<string[]>([])
  const [newZoneInput, setNewZoneInput] = useState('')
  const [saving, setSaving] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, z] = await Promise.all([
        apiJson<Seller[]>('/api/admin/sellers'),
        apiJson<string[]>('/api/admin/zones'),
      ])
      setSellers(s)
      setAvailableZones(z)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const startEdit = (s: Seller) => {
    setEditing(s.id)
    setDraftZones([...s.zones])
    setNewZoneInput('')
  }

  const cancelEdit = () => { setEditing(null); setDraftZones([]); setNewZoneInput('') }

  const addZone = (z: string) => {
    const v = z.trim()
    if (v && !draftZones.includes(v)) setDraftZones(prev => [...prev, v])
    setNewZoneInput('')
  }

  const removeZone = (z: string) => setDraftZones(prev => prev.filter(x => x !== z))

  const save = async (userId: string) => {
    setSaving(true)
    try {
      const res = await apiFetch(`/api/admin/sellers/${userId}/zones`, {
        method: 'PUT',
        body: JSON.stringify({ zones: draftZones }),
      })
      if (res.ok) {
        setSellers(prev => prev.map(s => s.id === userId ? { ...s, zones: draftZones } : s))
        cancelEdit()
      }
    } finally { setSaving(false) }
  }

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      const res = await apiFetch('/api/admin/sellers', {
        method: 'POST',
        body: JSON.stringify({ email: newEmail, password: newPassword, full_name: newFullName || null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { detail?: string }
        setCreateError(err.detail || `${res.status} ${res.statusText}`)
        return
      }
      setNewEmail(''); setNewPassword(''); setNewFullName('')
      setShowCreate(false)
      await load()
    } finally { setCreating(false) }
  }

  const toggleActive = async (s: Seller) => {
    const res = await apiFetch(`/api/admin/sellers/${s.id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !s.active }),
    })
    if (res.ok) setSellers(prev => prev.map(x => x.id === s.id ? { ...x, active: !s.active } : x))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-scala-text-muted" />
          <h2 className="text-sm font-medium text-scala-text-primary">Vendedores y zonas asignadas</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/[0.07] bg-scala-surface2 text-xs text-scala-text-muted hover:text-scala-text-primary transition-colors disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refrescar
          </button>
          <button onClick={() => setShowCreate(s => !s)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-scala-blue hover:bg-scala-blue-light text-white text-xs font-medium transition-colors">
            <UserPlus size={13} />
            Nuevo vendedor
          </button>
        </div>
      </div>

      {showCreate && (
        <form onSubmit={submitCreate} className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-5 space-y-3">
          <h3 className="text-sm font-medium text-scala-text-primary">Crear vendedor</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-scala-text-muted mb-1 block">Nombre</label>
              <input
                value={newFullName}
                onChange={e => setNewFullName(e.target.value)}
                placeholder="Juan Pérez"
                disabled={creating}
                className="w-full px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-blue/50 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-scala-text-muted mb-1 block">Email</label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="juan@scala.com"
                disabled={creating}
                className="w-full px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-blue/50 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-scala-text-muted mb-1 block">Contraseña (mín 6)</label>
              <input
                type="text"
                required
                minLength={6}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="contraseña inicial"
                disabled={creating}
                className="w-full px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-blue/50 disabled:opacity-50"
              />
            </div>
          </div>

          {createError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{createError}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={creating || !newEmail || newPassword.length < 6} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-scala-blue hover:bg-scala-blue-light text-white text-xs font-medium disabled:opacity-40 transition-colors">
              {creating ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              Crear
            </button>
            <button type="button" onClick={() => { setShowCreate(false); setCreateError(null) }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/10 text-xs text-scala-text-muted hover:text-scala-text-primary">
              <X size={13} /> Cancelar
            </button>
            <span className="text-[10px] text-scala-text-subtle self-center ml-2">Pasale el email + contraseña al vendedor para que entre.</span>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {sellers.length === 0 && !loading && (
          <p className="text-sm text-scala-text-muted text-center py-8">Sin usuarios todavía.</p>
        )}

        {sellers.map(s => {
          const isEditing = editing === s.id
          return (
            <div key={s.id} className={`rounded-xl border bg-scala-surface1 p-4 ${s.active ? 'border-white/[0.07]' : 'border-white/[0.04] opacity-60'}`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-[260px]">
                  {s.role === 'admin'
                    ? <ShieldCheck size={18} className="text-scala-blue-light shrink-0" />
                    : <Mail size={16} className="text-scala-text-muted shrink-0" />}
                  <div>
                    <p className="text-sm font-medium text-scala-text-primary">{s.full_name || s.email}</p>
                    <p className="text-xs text-scala-text-muted">{s.email}</p>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    s.role === 'admin' ? 'bg-scala-blue/20 text-scala-blue-light' : 'bg-white/5 text-scala-text-muted'
                  }`}>{s.role}</span>
                  {!s.active && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30">Inactivo</span>
                  )}
                  {s.role === 'vendedor' && (
                    <button
                      onClick={() => toggleActive(s)}
                      title={s.active ? 'Desactivar' : 'Activar'}
                      className={`ml-1 p-1 rounded-md border transition-colors ${
                        s.active
                          ? 'border-white/10 text-scala-text-muted hover:text-red-400 hover:border-red-400/30'
                          : 'border-scala-green/30 text-scala-green hover:bg-scala-green/10'
                      }`}
                    >
                      <Power size={12} />
                    </button>
                  )}
                </div>

                {s.role === 'vendedor' && (
                  <div className="flex-1 min-w-[300px]">
                    {!isEditing ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <MapPin size={13} className="text-scala-text-subtle shrink-0" />
                        {s.zones.length === 0
                          ? <span className="text-xs text-scala-text-subtle italic">Sin zonas asignadas</span>
                          : s.zones.map(z => (
                            <span key={z} className="px-2 py-0.5 rounded-full text-xs bg-scala-blue/15 border border-scala-blue/30 text-scala-blue-light">{z}</span>
                          ))}
                        <button onClick={() => startEdit(s)} className="ml-auto px-3 py-1.5 rounded-lg text-xs text-scala-text-muted hover:text-scala-text-primary border border-white/10 hover:border-white/20 transition-colors">
                          Editar
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center flex-wrap gap-1.5 px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07]">
                          <MapPin size={13} className="text-scala-text-subtle" />
                          {draftZones.map(z => (
                            <span key={z} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-scala-blue/20 border border-scala-blue/40 text-scala-blue-light">
                              {z}
                              <button onClick={() => removeZone(z)} className="hover:text-white"><X size={11} /></button>
                            </span>
                          ))}
                          <input
                            value={newZoneInput}
                            onChange={e => setNewZoneInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addZone(newZoneInput) }
                              else if (e.key === 'Backspace' && !newZoneInput && draftZones.length) setDraftZones(p => p.slice(0, -1))
                            }}
                            placeholder="Nueva zona — Enter"
                            className="flex-1 min-w-[140px] bg-transparent text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none"
                          />
                        </div>

                        {availableZones.filter(z => !draftZones.includes(z)).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            <span className="text-[10px] text-scala-text-subtle uppercase tracking-wider self-center mr-1">Sugeridas:</span>
                            {availableZones.filter(z => !draftZones.includes(z)).slice(0, 12).map(z => (
                              <button key={z} onClick={() => addZone(z)} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-white/[0.07] bg-scala-surface2 text-scala-text-muted hover:text-scala-text-primary hover:border-white/20 transition-colors">
                                <Plus size={10} /> {z}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button onClick={() => save(s.id)} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-scala-blue hover:bg-scala-blue-light text-white text-xs disabled:opacity-50">
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            Guardar
                          </button>
                          <button onClick={cancelEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-scala-text-muted hover:text-scala-text-primary">
                            <X size={12} /> Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
