import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Download, Mail, Phone, Globe, Star, Search, RefreshCw,
  ExternalLink, Database, MapPin, MessageSquare, Save, X, Loader2, ArrowUpDown,
  PhoneCall, PhoneOff, MessageCircle,
} from 'lucide-react'
import CallPanel from './CallPanel'
import { waLink, WA_DEFAULT_TEXT } from '../lib/phone'
import { apiFetch, apiJson } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import { type Lead, type LeadStatus, type SortMode, STATUS_ORDER, STATUS_LABEL, SORT_LABEL, sortLeads } from '../types'
import { StatusSelect, StatusBadge } from './StatusBadge'

export default function SellerDashboard() {
  const { me } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(false)
  const [textFilter, setTextFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all')
  const [zoneFilter, setZoneFilter] = useState<string | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sortBy, setSortBy] = useState<SortMode>('recent')
  const [callingLead, setCallingLead] = useState<Lead | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<Lead[]>('/api/leads')
      setLeads(data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const updateStatus = async (lead: Lead, status: LeadStatus, notes?: string) => {
    setSavingId(lead.place_id)
    try {
      const res = await apiFetch(`/api/leads/${encodeURIComponent(lead.place_id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, notes: notes ?? lead.notes ?? null }),
      })
      if (res.ok) {
        const updated = await res.json() as Lead
        setLeads(prev => prev.map(l => l.place_id === lead.place_id ? { ...l, ...updated } : l))
      }
    } finally { setSavingId(null) }
  }

  const saveNote = async (lead: Lead) => {
    await updateStatus(lead, lead.status, noteDraft)
    setExpanded(null)
  }

  const stats = useMemo(() => {
    const by: Record<string, number> = {}
    leads.forEach(l => { by[l.status] = (by[l.status] || 0) + 1 })
    return by
  }, [leads])

  const categoryOptions = useMemo(() => {
    const m = new Map<string, number>()
    leads.forEach(l => {
      if (!l.category) return
      l.category.split(',').map(c => c.trim()).filter(Boolean).forEach(cat => {
        m.set(cat, (m.get(cat) || 0) + 1)
      })
    })
    return Array.from(m).sort((a, b) => b[1] - a[1])
  }, [leads])

  const filtered = useMemo(() => {
    return leads.filter(l => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false
      if (zoneFilter !== 'all' && l.search_zone !== zoneFilter) return false
      if (categoryFilter !== 'all') {
        const cats = (l.category || '').split(',').map(c => c.trim())
        if (!cats.includes(categoryFilter)) return false
      }
      if (textFilter) {
        const q = textFilter.toLowerCase()
        if (![l.name, l.address, l.email, l.phone].some(v => v?.toLowerCase().includes(q))) return false
      }
      return true
    })
  }, [leads, statusFilter, zoneFilter, categoryFilter, textFilter])

  useEffect(() => { setPage(1) }, [statusFilter, zoneFilter, categoryFilter, textFilter, pageSize, sortBy])

  const sorted = useMemo(() => sortLeads(filtered, sortBy), [filtered, sortBy])
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = useMemo(() => sorted.slice((safePage - 1) * pageSize, safePage * pageSize), [sorted, safePage, pageSize])

  const exportCSV = () => {
    const fields: (keyof Lead)[] = ['name','address','phone','website','email','status','search_zone','notes']
    const csv = [
      fields.join(','),
      ...sorted.map(l => fields.map(f => `"${String(l[f] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `mis_leads_${new Date().toISOString().slice(0, 10)}.csv`,
    })
    a.click()
  }

  if (!me) return null

  if (me.zones.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-10 text-center">
        <MapPin size={32} className="mx-auto mb-3 text-scala-text-subtle opacity-40" />
        <p className="text-scala-text-primary text-sm font-medium">Todavía no tenés zonas asignadas</p>
        <p className="text-xs text-scala-text-muted mt-1">Pedile al administrador que te asigne zonas para empezar a trabajar.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Zonas */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-scala-text-muted">Tus zonas:</span>
        {me.zones.map(z => (
          <span key={z} className="px-2.5 py-0.5 rounded-full text-xs bg-scala-blue/15 border border-scala-blue/30 text-scala-blue-light">
            {z}
          </span>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {STATUS_ORDER.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(p => p === s ? 'all' : s)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              statusFilter === s
                ? 'border-scala-blue/50 bg-scala-blue/10'
                : 'border-white/[0.07] bg-scala-surface1 hover:border-white/20'
            }`}
          >
            <p className="text-[10px] uppercase tracking-wider text-scala-text-muted mb-1">{STATUS_LABEL[s]}</p>
            <p className="text-2xl font-bold text-scala-text-primary">{stats[s] ?? 0}</p>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-xl border border-white/[0.07] bg-scala-surface1">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-scala-text-subtle" />
          <input
            type="text"
            placeholder="Buscar nombre, email, teléfono..."
            value={textFilter}
            onChange={e => setTextFilter(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-blue/50"
          />
        </div>

        <select
          value={zoneFilter}
          onChange={e => setZoneFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary cursor-pointer focus:outline-none focus:border-scala-blue/50"
        >
          <option value="all">Todas las zonas</option>
          {me.zones.map(z => <option key={z} value={z}>{z}</option>)}
        </select>

        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary cursor-pointer focus:outline-none focus:border-scala-blue/50 max-w-[200px]"
        >
          <option value="all">Todos los tipos</option>
          {categoryOptions.map(([cat, count]) => (
            <option key={cat} value={cat}>{cat.replace(/_/g, ' ')} ({count})</option>
          ))}
        </select>

        <div className="flex items-center gap-1.5">
          <ArrowUpDown size={13} className="text-scala-text-subtle" />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortMode)}
            className="px-2 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary cursor-pointer focus:outline-none focus:border-scala-blue/50"
          >
            {(['recent','quality','rating','reviews'] as SortMode[]).map(s => (
              <option key={s} value={s}>{SORT_LABEL[s]}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 ml-auto">
          {statusFilter !== 'all' && (
            <button onClick={() => setStatusFilter('all')} className="flex items-center gap-1 px-3 py-2 rounded-lg border border-white/[0.07] bg-scala-surface2 text-xs text-scala-text-muted hover:text-red-400 transition-colors">
              <X size={12} /> {STATUS_LABEL[statusFilter]}
            </button>
          )}
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/[0.07] bg-scala-surface2 text-xs text-scala-text-muted hover:text-scala-text-primary transition-colors disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportCSV} disabled={filtered.length === 0} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-scala-blue hover:bg-scala-blue-light text-white text-xs font-medium transition-colors disabled:opacity-40">
            <Download size={13} />
            Exportar ({filtered.length})
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.07] flex items-center justify-between">
          <p className="text-xs text-scala-text-muted">
            <span className="text-scala-text-primary font-medium">{filtered.length}</span> de {leads.length} leads asignados
          </p>
          {loading && <span className="text-xs text-scala-blue animate-pulse">Cargando...</span>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.07]">
                {['', 'Negocio', 'Zona', 'Contacto', 'Estado', 'Notas', 'Web'].map(c => (
                  <th key={c} className="px-4 py-3 text-left text-xs font-medium text-scala-text-muted uppercase tracking-wider whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center">
                  <Database size={28} className="mx-auto mb-3 text-scala-text-subtle opacity-30" />
                  <p className="text-scala-text-muted text-sm">Sin leads para los filtros aplicados</p>
                </td></tr>
              ) : paginated.map(lead => {
                const isOpen = expanded === lead.place_id
                return (
                  <Fragment key={lead.place_id}>
                    <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-3">
                        {lead.do_not_call ? (
                          <span title="No llamar" className="flex items-center justify-center w-8 h-8 rounded-lg border border-red-500/30 text-red-400">
                            <PhoneOff size={13} />
                          </span>
                        ) : (
                          <button
                            onClick={() => setCallingLead(lead)}
                            disabled={!lead.phone}
                            title={lead.phone ? 'Registrar llamada' : 'Sin teléfono'}
                            className="flex items-center justify-center w-8 h-8 rounded-lg bg-scala-blue/15 border border-scala-blue/40 text-scala-blue-light hover:bg-scala-blue hover:text-white disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                          >
                            <PhoneCall size={13} />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-scala-text-primary text-sm leading-tight">{lead.name || '—'}</p>
                        <p className="text-xs text-scala-text-subtle mt-0.5">{lead.address || '—'}</p>
                        {lead.rating && (
                          <span className="inline-flex items-center gap-1 mt-1 text-xs text-scala-text-muted">
                            <Star size={11} className="text-yellow-400 fill-yellow-400" />
                            {lead.rating} ({lead.reviews_count ?? 0})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-xs bg-scala-blue/10 text-scala-blue-light border border-scala-blue/20">{lead.search_zone || '—'}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap space-y-1">
                        {lead.phone && (
                          <span className="flex items-center gap-2">
                            <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-xs text-scala-text-muted hover:text-scala-text-primary"><Phone size={12} />{lead.phone}</a>
                            {waLink(lead.phone, WA_DEFAULT_TEXT) && (
                              <a href={waLink(lead.phone, WA_DEFAULT_TEXT)!} target="_blank" rel="noopener noreferrer"
                                 title="Enviar WhatsApp"
                                 className="text-[#25D366] hover:scale-110 transition-transform"><MessageCircle size={13} /></a>
                            )}
                          </span>
                        )}
                        {lead.email && <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-xs font-medium text-scala-green hover:underline"><Mail size={12} />{lead.email}</a>}
                        {!lead.phone && !lead.email && <span className="text-xs text-scala-text-subtle">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {savingId === lead.place_id
                          ? <Loader2 size={14} className="animate-spin text-scala-blue" />
                          : <StatusSelect value={lead.status} onChange={s => updateStatus(lead, s)} />}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => {
                            setExpanded(isOpen ? null : lead.place_id)
                            setNoteDraft(lead.notes ?? '')
                          }}
                          className="flex items-center gap-1.5 text-xs text-scala-text-muted hover:text-scala-text-primary transition-colors"
                        >
                          <MessageSquare size={12} />
                          {lead.notes ? <span className="max-w-[160px] truncate">{lead.notes}</span> : <span className="italic">Agregar nota</span>}
                        </button>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {lead.website
                          ? <a href={lead.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-scala-blue-light hover:underline"><Globe size={12} /><ExternalLink size={11} /></a>
                          : <span className="text-xs text-scala-text-subtle">—</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-scala-surface2/40">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex gap-2">
                            <textarea
                              value={noteDraft}
                              onChange={e => setNoteDraft(e.target.value)}
                              placeholder="Notas sobre el contacto, próximos pasos, objeciones..."
                              rows={2}
                              className="flex-1 px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-blue/50 resize-y"
                            />
                            <div className="flex flex-col gap-1.5">
                              <button onClick={() => saveNote(lead)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-scala-blue hover:bg-scala-blue-light text-white text-xs">
                                <Save size={12} /> Guardar
                              </button>
                              <button onClick={() => setExpanded(null)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-scala-text-muted hover:text-scala-text-primary">
                                <X size={12} /> Cancelar
                              </button>
                            </div>
                          </div>
                          <StatusBadge status={lead.status} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Paginador */}
        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-white/[0.07] bg-scala-surface1">
            <div className="flex items-center gap-2 text-xs text-scala-text-muted">
              <span>Mostrando {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} de {filtered.length}</span>
              <span className="text-scala-text-subtle">·</span>
              <span>Por página:</span>
              <select
                value={pageSize}
                onChange={e => setPageSize(Number(e.target.value))}
                className="bg-scala-surface2 border border-white/[0.07] rounded px-2 py-1 text-xs text-scala-text-primary focus:outline-none focus:border-scala-blue/50"
              >
                {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={safePage === 1} className="px-2 py-1 rounded text-xs text-scala-text-muted hover:text-scala-text-primary disabled:opacity-30 disabled:cursor-not-allowed">« Primera</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1} className="px-2.5 py-1 rounded text-xs text-scala-text-muted hover:text-scala-text-primary disabled:opacity-30 disabled:cursor-not-allowed">‹ Anterior</button>
              <span className="px-3 py-1 rounded bg-scala-surface2 text-xs text-scala-text-primary font-medium">
                {safePage} <span className="text-scala-text-subtle">/ {totalPages}</span>
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="px-2.5 py-1 rounded text-xs text-scala-text-muted hover:text-scala-text-primary disabled:opacity-30 disabled:cursor-not-allowed">Siguiente ›</button>
              <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} className="px-2 py-1 rounded text-xs text-scala-text-muted hover:text-scala-text-primary disabled:opacity-30 disabled:cursor-not-allowed">Última »</button>
            </div>
          </div>
        )}
      </div>

      {callingLead && (
        <CallPanel
          lead={callingLead}
          onClose={() => setCallingLead(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  )
}
