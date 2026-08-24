import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Download, Mail, Phone, Globe, Star, Search,
  RefreshCw, ExternalLink, Database, X, ChevronDown, Check, Loader2, ArrowUpDown,
  PhoneCall, PhoneOff, MessageCircle,
} from 'lucide-react'
import { apiFetch, apiJson } from '../lib/api'
import type { Lead, LeadStatus, Seller, SortMode } from '../types'
import { STATUS_LABEL, STATUS_ORDER, SORT_LABEL, sortLeads } from '../types'
import { StatusSelect } from './StatusBadge'
import CallPanel from './CallPanel'
import { waLink, WA_DEFAULT_TEXT } from '../lib/phone'

/* ── Dropdown multi-select ─────────────────────────────────────────────────── */
function MultiSelect({
  label, options, selected, onToggle,
}: {
  label: string
  options: { value: string; count: number }[]
  selected: string[]
  onToggle: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
          selected.length > 0
            ? 'border-scala-blue/50 bg-scala-blue/10 text-scala-text-primary'
            : 'border-white/[0.07] bg-scala-surface2 text-scala-text-muted hover:text-scala-text-primary hover:border-white/20'
        }`}
      >
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-scala-blue text-white">{selected.length}</span>
        )}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] rounded-xl border border-white/[0.1] bg-scala-surface2 shadow-2xl overflow-hidden">
          {options.length === 0 ? (
            <p className="px-4 py-3 text-xs text-scala-text-muted">Sin datos</p>
          ) : (
            <div className="max-h-60 overflow-y-auto py-1">
              {options.map(opt => {
                const active = selected.includes(opt.value)
                return (
                  <button
                    key={opt.value}
                    onClick={() => onToggle(opt.value)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left transition-colors hover:bg-white/[0.05] ${active ? 'text-scala-text-primary' : 'text-scala-text-muted'}`}
                  >
                    <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors ${active ? 'bg-scala-blue border-scala-blue' : 'border-white/20'}`}>
                      {active && <Check size={10} className="text-white" />}
                    </span>
                    <span className="flex-1 truncate">{opt.value}</span>
                    <span className="text-scala-text-subtle text-[10px]">{opt.count}</span>
                  </button>
                )
              })}
            </div>
          )}
          {selected.length > 0 && (
            <div className="border-t border-white/[0.07] p-2">
              <button
                onClick={() => options.forEach(o => selected.includes(o.value) && onToggle(o.value))}
                className="w-full text-xs text-scala-text-muted hover:text-red-400 py-1.5 transition-colors"
              >
                Limpiar selección
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main component ─────────────────────────────────────────────────────────── */
export default function LeadsDB() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [sellers, setSellers] = useState<Seller[]>([])
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [textFilter, setTextFilter] = useState('')
  const [selectedZones, setSelectedZones] = useState<string[]>([])
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  const [selectedStatuses, setSelectedStatuses] = useState<LeadStatus[]>([])
  const [selectedSellers, setSelectedSellers] = useState<string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [emailFilter, setEmailFilter] = useState<'all' | 'with' | 'without'>('all')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sortBy, setSortBy] = useState<SortMode>('recent')
  const [callingLead, setCallingLead] = useState<Lead | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [l, s] = await Promise.all([
        apiJson<Lead[]>('/api/leads'),
        apiJson<Seller[]>('/api/admin/sellers').catch(() => []),
      ])
      setLeads(l)
      setSellers(s)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Zone → seller mapping (each zone may be assigned to 0+ sellers)
  const zoneToSellers = useMemo(() => {
    const m = new Map<string, Seller[]>()
    sellers.filter(s => s.role === 'vendedor').forEach(s => {
      s.zones.forEach(z => {
        if (!m.has(z)) m.set(z, [])
        m.get(z)!.push(s)
      })
    })
    return m
  }, [sellers])

  const zoneOptions = useMemo(() => (
    Array.from(leads.reduce((m, l) => { if (l.search_zone) m.set(l.search_zone, (m.get(l.search_zone) || 0) + 1); return m }, new Map<string, number>()))
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value))
  ), [leads])

  const keywordOptions = useMemo(() => (
    Array.from(leads.reduce((m, l) => { if (l.search_query) m.set(l.search_query, (m.get(l.search_query) || 0) + 1); return m }, new Map<string, number>()))
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
  ), [leads])

  // Categorías de Google Places (campo `category`). Cada lead puede tener N tipos separados por ", ".
  const categoryOptions = useMemo(() => {
    const m = new Map<string, number>()
    leads.forEach(l => {
      if (!l.category) return
      l.category.split(',').map(c => c.trim()).filter(Boolean).forEach(cat => {
        m.set(cat, (m.get(cat) || 0) + 1)
      })
    })
    return Array.from(m).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
  }, [leads])

  const sellerOptions = useMemo(() => (
    sellers.filter(s => s.role === 'vendedor').map(s => ({
      value: s.id,
      label: s.full_name || s.email,
      count: leads.filter(l => (zoneToSellers.get(l.search_zone) ?? []).some(x => x.id === s.id)).length,
    }))
  ), [sellers, leads, zoneToSellers])

  const toggle = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>) => (v: T) => setter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])

  const hasFilters = textFilter || selectedZones.length || selectedKeywords.length || selectedStatuses.length || selectedSellers.length || selectedCategories.length || emailFilter !== 'all'
  const clearAll = () => {
    setTextFilter(''); setSelectedZones([]); setSelectedKeywords([])
    setSelectedStatuses([]); setSelectedSellers([]); setSelectedCategories([]); setEmailFilter('all')
  }

  const filtered = useMemo(() => leads.filter(l => {
    if (textFilter) {
      const q = textFilter.toLowerCase()
      if (![l.name, l.address, l.email, l.category, l.notes].some(v => v?.toLowerCase().includes(q))) return false
    }
    if (selectedZones.length && !selectedZones.includes(l.search_zone)) return false
    if (selectedKeywords.length && !selectedKeywords.includes(l.search_query)) return false
    if (selectedStatuses.length && !selectedStatuses.includes(l.status)) return false
    if (selectedCategories.length) {
      const leadCats = (l.category || '').split(',').map(c => c.trim()).filter(Boolean)
      if (!leadCats.some(c => selectedCategories.includes(c))) return false
    }
    if (selectedSellers.length) {
      const owners = (zoneToSellers.get(l.search_zone) ?? []).map(s => s.id)
      if (!owners.some(id => selectedSellers.includes(id))) return false
    }
    if (emailFilter === 'with' && !l.email) return false
    if (emailFilter === 'without' && l.email) return false
    return true
  }), [leads, textFilter, selectedZones, selectedKeywords, selectedStatuses, selectedCategories, selectedSellers, emailFilter, zoneToSellers])

  // Reset page cuando cambian filtros u orden
  useEffect(() => { setPage(1) }, [textFilter, selectedZones, selectedKeywords, selectedStatuses, selectedCategories, selectedSellers, emailFilter, pageSize, sortBy])

  const sorted = useMemo(() => sortLeads(filtered, sortBy), [filtered, sortBy])
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = useMemo(() => sorted.slice((safePage - 1) * pageSize, safePage * pageSize), [sorted, safePage, pageSize])

  const updateStatus = async (lead: Lead, status: LeadStatus) => {
    setSavingId(lead.place_id)
    try {
      const res = await apiFetch(`/api/leads/${encodeURIComponent(lead.place_id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, notes: lead.notes }),
      })
      if (res.ok) {
        const updated = await res.json() as Lead
        setLeads(prev => prev.map(l => l.place_id === lead.place_id ? { ...l, ...updated } : l))
      }
    } finally { setSavingId(null) }
  }

  const exportCSV = () => {
    const fields: (keyof Lead)[] = ['name','address','phone','website','email','status','rating','reviews_count','category','search_query','search_zone','notes']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [fields.join(','), ...sorted.map(l => fields.map(f => esc(l[f])).join(','))].join('\n')
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `leads_${new Date().toISOString().slice(0, 10)}.csv`,
    })
    a.click()
  }

  return (
    <div className="space-y-4">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total leads', value: leads.length, color: 'text-scala-text-primary' },
          { label: 'Con email', value: leads.filter(l => l.email).length, color: 'text-scala-green' },
          { label: 'Zonas', value: zoneOptions.length, color: 'text-scala-blue-light' },
          { label: 'Vendedores', value: sellerOptions.length, color: 'text-scala-blue-light' },
          { label: 'Sin contactar', value: leads.filter(l => l.status === 'nuevo').length, color: 'text-yellow-300' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-4">
            <p className="text-xs text-scala-text-muted mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-xl border border-white/[0.07] bg-scala-surface1">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-scala-text-subtle" />
          <input
            type="text"
            placeholder="Buscar nombre, email, dirección, notas..."
            value={textFilter}
            onChange={e => setTextFilter(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-blue/50 transition-colors"
          />
        </div>

        <div className="w-px h-6 bg-white/10 hidden sm:block" />

        <MultiSelect label="Zona" options={zoneOptions} selected={selectedZones} onToggle={toggle(setSelectedZones)} />
        <MultiSelect label="Keyword" options={keywordOptions} selected={selectedKeywords} onToggle={toggle(setSelectedKeywords)} />
        <MultiSelect label="Tipo de negocio" options={categoryOptions} selected={selectedCategories} onToggle={toggle(setSelectedCategories)} />
        <MultiSelect
          label="Estado"
          options={STATUS_ORDER.map(s => ({ value: s, count: leads.filter(l => l.status === s).length }))}
          selected={selectedStatuses}
          onToggle={toggle(setSelectedStatuses) as (v: string) => void}
        />
        <MultiSelect
          label="Vendedor"
          options={sellerOptions.map(s => ({ value: s.value, count: s.count }))}
          selected={selectedSellers}
          onToggle={toggle(setSelectedSellers)}
        />

        <div className="w-px h-6 bg-white/10 hidden sm:block" />

        <div className="flex rounded-lg border border-white/[0.07] overflow-hidden text-xs">
          {(['all', 'with', 'without'] as const).map(v => (
            <button
              key={v}
              onClick={() => setEmailFilter(v)}
              className={`px-3 py-2 transition-colors ${emailFilter === v ? 'bg-scala-blue text-white' : 'bg-scala-surface2 text-scala-text-muted hover:text-scala-text-primary'}`}
            >
              {v === 'all' ? 'Todos' : v === 'with' ? 'Con email' : 'Sin email'}
            </button>
          ))}
        </div>

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
          {hasFilters && (
            <button onClick={clearAll} className="flex items-center gap-1 px-3 py-2 rounded-lg border border-white/[0.07] bg-scala-surface2 text-xs text-scala-text-muted hover:text-red-400 hover:border-red-400/30 transition-colors">
              <X size={12} /> Limpiar
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

      {/* Active filter chips */}
      {(selectedZones.length || selectedKeywords.length || selectedStatuses.length || selectedSellers.length || selectedCategories.length) > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {selectedZones.map(z => (
            <span key={z} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-scala-blue/15 border border-scala-blue/30 text-scala-blue-light">
              {z}<button onClick={() => toggle(setSelectedZones)(z)} className="hover:text-white"><X size={10} /></button>
            </span>
          ))}
          {selectedKeywords.map(k => (
            <span key={k} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-scala-green/10 border border-scala-green/30 text-scala-green">
              {k}<button onClick={() => toggle(setSelectedKeywords)(k)} className="hover:text-white"><X size={10} /></button>
            </span>
          ))}
          {selectedCategories.map(c => (
            <span key={c} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-orange-500/10 border border-orange-500/30 text-orange-200">
              {c.replace(/_/g, ' ')}<button onClick={() => toggle(setSelectedCategories)(c)} className="hover:text-white"><X size={10} /></button>
            </span>
          ))}
          {selectedStatuses.map(s => (
            <span key={s} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-yellow-500/10 border border-yellow-500/30 text-yellow-200">
              {STATUS_LABEL[s]}<button onClick={() => toggle(setSelectedStatuses)(s as LeadStatus)} className="hover:text-white"><X size={10} /></button>
            </span>
          ))}
          {selectedSellers.map(id => {
            const s = sellers.find(x => x.id === id)
            return (
              <span key={id} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-purple-500/10 border border-purple-500/30 text-purple-200">
                {s?.full_name || s?.email || id}<button onClick={() => toggle(setSelectedSellers)(id)} className="hover:text-white"><X size={10} /></button>
              </span>
            )
          })}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.07] flex items-center justify-between">
          <p className="text-xs text-scala-text-muted">
            <span className="text-scala-text-primary font-medium">{filtered.length}</span> de {leads.length} leads
            {hasFilters && <span className="ml-1.5 text-scala-blue-light">· filtrado</span>}
          </p>
          {loading && <span className="text-xs text-scala-blue animate-pulse">Cargando...</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.07]">
                {['', 'Negocio', 'Zona', 'Vendedor', 'Contacto', 'Estado', 'Web', 'Rating'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-medium text-scala-text-muted uppercase tracking-wider whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <Database size={28} className="mx-auto mb-3 text-scala-text-subtle opacity-30" />
                    <p className="text-scala-text-muted text-sm">
                      {leads.length === 0 ? 'No hay leads guardados todavía' : 'Sin resultados para los filtros aplicados'}
                    </p>
                  </td>
                </tr>
              ) : paginated.map((lead, i) => {
                const owners = zoneToSellers.get(lead.search_zone) ?? []
                return (
                  <tr key={lead.place_id || i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
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
                      {lead.search_query && <p className="text-xs text-scala-text-subtle mt-0.5">"{lead.search_query}"</p>}
                      {lead.notes && <p className="text-xs text-scala-text-muted mt-1 italic max-w-[260px] truncate">{lead.notes}</p>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-scala-blue/10 text-scala-blue-light border border-scala-blue/20">{lead.search_zone || '—'}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {owners.length === 0
                        ? <span className="text-xs text-scala-text-subtle italic">Sin asignar</span>
                        : owners.map(o => (
                          <span key={o.id} className="inline-block px-2 py-0.5 rounded-full text-xs bg-purple-500/10 text-purple-200 border border-purple-500/20 mr-1">
                            {o.full_name || o.email.split('@')[0]}
                          </span>
                        ))}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap space-y-0.5">
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
                    <td className="px-4 py-3 whitespace-nowrap">
                      {lead.website ? <a href={lead.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-scala-blue-light hover:underline"><Globe size={12} /><ExternalLink size={11} /></a> : <span className="text-xs text-scala-text-subtle">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {lead.rating
                        ? <div className="flex items-center gap-1"><Star size={12} className="text-yellow-400 fill-yellow-400" /><span className="text-xs font-medium text-scala-text-primary">{lead.rating}</span>{lead.reviews_count && <span className="text-xs text-scala-text-subtle">({lead.reviews_count})</span>}</div>
                        : <span className="text-xs text-scala-text-subtle">—</span>}
                    </td>
                  </tr>
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
              <button
                onClick={() => setPage(1)}
                disabled={safePage === 1}
                className="px-2 py-1 rounded text-xs text-scala-text-muted hover:text-scala-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
              >« Primera</button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-2.5 py-1 rounded text-xs text-scala-text-muted hover:text-scala-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
              >‹ Anterior</button>
              <span className="px-3 py-1 rounded bg-scala-surface2 text-xs text-scala-text-primary font-medium">
                {safePage} <span className="text-scala-text-subtle">/ {totalPages}</span>
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-2.5 py-1 rounded text-xs text-scala-text-muted hover:text-scala-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
              >Siguiente ›</button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={safePage === totalPages}
                className="px-2 py-1 rounded text-xs text-scala-text-muted hover:text-scala-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
              >Última »</button>
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
