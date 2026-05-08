import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Download, Mail, Phone, Globe, Star, Search,
  RefreshCw, ExternalLink, Database, X, ChevronDown, Check,
} from 'lucide-react'
import type { Lead } from '../types'

interface Props { apiBase: string }

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
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-scala-blue text-white`}>
            {selected.length}
          </span>
        )}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] rounded-xl border border-white/[0.1] bg-scala-surface2 shadow-2xl overflow-hidden">
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
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left transition-colors hover:bg-white/[0.05] ${
                      active ? 'text-scala-text-primary' : 'text-scala-text-muted'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors ${
                      active ? 'bg-scala-blue border-scala-blue' : 'border-white/20'
                    }`}>
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
export default function LeadsDB({ apiBase }: Props) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(false)
  const [textFilter, setTextFilter] = useState('')
  const [selectedZones, setSelectedZones] = useState<string[]>([])
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  const [emailFilter, setEmailFilter] = useState<'all' | 'with' | 'without'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/leads`)
      setLeads(await res.json() as Lead[])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [apiBase])

  useEffect(() => { load() }, [load])

  const zoneOptions = Array.from(
    leads.reduce((m, l) => { if (l.search_zone) m.set(l.search_zone, (m.get(l.search_zone) || 0) + 1); return m }, new Map<string, number>()),
  ).map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value))

  const keywordOptions = Array.from(
    leads.reduce((m, l) => { if (l.search_query) m.set(l.search_query, (m.get(l.search_query) || 0) + 1); return m }, new Map<string, number>()),
  ).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)

  const toggleZone = (z: string) => setSelectedZones(p => p.includes(z) ? p.filter(x => x !== z) : [...p, z])
  const toggleKeyword = (k: string) => setSelectedKeywords(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k])

  const hasFilters = textFilter || selectedZones.length || selectedKeywords.length || emailFilter !== 'all'
  const clearAll = () => { setTextFilter(''); setSelectedZones([]); setSelectedKeywords([]); setEmailFilter('all') }

  const filtered = leads.filter(l => {
    if (textFilter) {
      const q = textFilter.toLowerCase()
      if (![l.name, l.address, l.email, l.category].some(v => v?.toLowerCase().includes(q))) return false
    }
    if (selectedZones.length && !selectedZones.includes(l.search_zone)) return false
    if (selectedKeywords.length && !selectedKeywords.includes(l.search_query)) return false
    if (emailFilter === 'with' && !l.email) return false
    if (emailFilter === 'without' && l.email) return false
    return true
  })

  const exportCSV = () => {
    const fields: (keyof Lead)[] = ['name', 'address', 'phone', 'website', 'email', 'rating', 'reviews_count', 'category', 'search_query', 'search_zone']
    const csv = [fields.join(','), ...filtered.map(l => fields.map(f => String(l[f] ?? '').replace(/,/g, ';')).join(','))].join('\n')
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `leads_${new Date().toISOString().slice(0, 10)}.csv` })
    a.click()
  }

  return (
    <div className="space-y-4">

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total leads', value: leads.length, color: 'text-scala-text-primary' },
          { label: 'Con email', value: leads.filter(l => l.email).length, color: 'text-scala-green' },
          { label: 'Zonas', value: zoneOptions.length, color: 'text-scala-blue-light' },
          { label: 'Keywords', value: keywordOptions.length, color: 'text-scala-blue-light' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-4">
            <p className="text-xs text-scala-text-muted mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-xl border border-white/[0.07] bg-scala-surface1">

        {/* Text search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-scala-text-subtle" />
          <input
            type="text"
            placeholder="Buscar nombre, email, dirección..."
            value={textFilter}
            onChange={e => setTextFilter(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] text-xs text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-blue/50 transition-colors"
          />
        </div>

        <div className="w-px h-6 bg-white/10 hidden sm:block" />

        {/* Zone dropdown */}
        <MultiSelect
          label="Zona"
          options={zoneOptions}
          selected={selectedZones}
          onToggle={toggleZone}
        />

        {/* Keyword dropdown */}
        <MultiSelect
          label="Keyword"
          options={keywordOptions}
          selected={selectedKeywords}
          onToggle={toggleKeyword}
        />

        <div className="w-px h-6 bg-white/10 hidden sm:block" />

        {/* Email filter */}
        <div className="flex rounded-lg border border-white/[0.07] overflow-hidden text-xs">
          {(['all', 'with', 'without'] as const).map(v => (
            <button
              key={v}
              onClick={() => setEmailFilter(v)}
              className={`px-3 py-2 transition-colors ${
                emailFilter === v ? 'bg-scala-blue text-white' : 'bg-scala-surface2 text-scala-text-muted hover:text-scala-text-primary'
              }`}
            >
              {v === 'all' ? 'Todos' : v === 'with' ? 'Con email' : 'Sin email'}
            </button>
          ))}
        </div>

        {/* Actions */}
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
      {(selectedZones.length > 0 || selectedKeywords.length > 0) && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {selectedZones.map(z => (
            <span key={z} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-scala-blue/15 border border-scala-blue/30 text-scala-blue-light">
              {z}
              <button onClick={() => toggleZone(z)} className="hover:text-white transition-colors"><X size={10} /></button>
            </span>
          ))}
          {selectedKeywords.map(k => (
            <span key={k} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-scala-green/10 border border-scala-green/30 text-scala-green">
              {k}
              <button onClick={() => toggleKeyword(k)} className="hover:text-white transition-colors"><X size={10} /></button>
            </span>
          ))}
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
                {['Negocio', 'Zona', 'Dirección', 'Teléfono', 'Email', 'Web', 'Rating', 'Categoría'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-medium text-scala-text-muted uppercase tracking-wider whitespace-nowrap">
                    {col}
                  </th>
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
              ) : filtered.map((lead, i) => (
                <tr key={lead.place_id || i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-scala-text-primary text-sm leading-tight">{lead.name || '—'}</p>
                    {lead.search_query && <p className="text-xs text-scala-text-subtle mt-0.5">"{lead.search_query}"</p>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-scala-blue/10 text-scala-blue-light border border-scala-blue/20">{lead.search_zone || '—'}</span>
                  </td>
                  <td className="px-4 py-3"><p className="text-xs text-scala-text-muted max-w-[180px] leading-relaxed">{lead.address || '—'}</p></td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {lead.phone ? <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-xs text-scala-text-muted hover:text-scala-text-primary transition-colors"><Phone size={12} />{lead.phone}</a> : <span className="text-xs text-scala-text-subtle">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {lead.email ? <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-xs font-medium text-scala-green hover:underline"><Mail size={12} />{lead.email}</a> : <span className="text-xs text-scala-text-subtle">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {lead.website ? <a href={lead.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-scala-blue-light hover:underline"><Globe size={12} /><ExternalLink size={11} /></a> : <span className="text-xs text-scala-text-subtle">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {lead.rating ? <div className="flex items-center gap-1"><Star size={12} className="text-yellow-400 fill-yellow-400" /><span className="text-xs font-medium text-scala-text-primary">{lead.rating}</span>{lead.reviews_count && <span className="text-xs text-scala-text-subtle">({lead.reviews_count})</span>}</div> : <span className="text-xs text-scala-text-subtle">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {lead.category ? <span className="px-2 py-0.5 rounded-full text-xs bg-scala-surface3 text-scala-text-muted border border-white/[0.06]">{lead.category.replace(/_/g, ' ')}</span> : <span className="text-xs text-scala-text-subtle">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
