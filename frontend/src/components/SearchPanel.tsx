import { useState, useRef, type FormEvent, type KeyboardEvent } from 'react'
import { Search, MapPin, Briefcase, Loader2, Layers, X, Plus } from 'lucide-react'

interface Props {
  onSearch: (query: string, zones: string[], maxResults: number) => void
  isSearching: boolean
}

const COVERAGE_OPTIONS = [
  { value: 60,  label: '60',  desc: 'Rápido' },
  { value: 120, label: '120', desc: 'Grilla 2×2' },
  { value: 200, label: '200', desc: 'Grilla 3×3' },
  { value: 300, label: '300', desc: 'Grilla 4×4' },
]

const SUGGESTED_CITIES = ['Palermo', 'Belgrano', 'Recoleta', 'San Telmo', 'Caballito', 'Flores']

export default function SearchPanel({ onSearch, isSearching }: Props) {
  const [query, setQuery] = useState('')
  const [zones, setZones] = useState<string[]>([])
  const [zoneInput, setZoneInput] = useState('')
  const [maxResults, setMaxResults] = useState(60)
  const zoneRef = useRef<HTMLInputElement>(null)

  const addZone = (value: string) => {
    const v = value.trim()
    if (v && !zones.includes(v)) {
      setZones(prev => [...prev, v])
    }
    setZoneInput('')
  }

  const removeZone = (z: string) => setZones(prev => prev.filter(x => x !== z))

  const handleZoneKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addZone(zoneInput)
    } else if (e.key === 'Backspace' && !zoneInput && zones.length > 0) {
      setZones(prev => prev.slice(0, -1))
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const pending = zoneInput.trim()
    const allZones = pending && !zones.includes(pending) ? [...zones, pending] : zones
    if (query.trim() && allZones.length > 0 && !isSearching) {
      setZones(allZones)
      setZoneInput('')
      onSearch(query.trim(), allZones, maxResults)
    }
  }

  const canSearch = query.trim() && (zones.length > 0 || zoneInput.trim()) && !isSearching

  return (
    <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-6 mb-6">
      <h2 className="text-sm font-medium text-scala-text-muted uppercase tracking-widest mb-5">
        Nueva búsqueda
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Row 1: query + button */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Briefcase size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-scala-text-subtle pointer-events-none" />
            <input
              type="text"
              placeholder="Tipo de negocio (ej: dentistas, restaurants, abogados)"
              value={query}
              onChange={e => setQuery(e.target.value)}
              disabled={isSearching}
              className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-scala-surface2 border border-white/[0.07] text-sm text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none focus:border-scala-blue/50 focus:ring-1 focus:ring-scala-blue/30 disabled:opacity-50 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={!canSearch}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-scala-blue hover:bg-scala-blue-light text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {isSearching
              ? <><Loader2 size={15} className="animate-spin" />Buscando...</>
              : <><Search size={15} />Buscar leads</>}
          </button>
        </div>

        {/* Row 2: zone tag input */}
        <div
          className="flex flex-wrap items-center gap-1.5 min-h-[42px] px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] focus-within:border-scala-blue/50 focus-within:ring-1 focus-within:ring-scala-blue/30 cursor-text transition-colors"
          onClick={() => zoneRef.current?.focus()}
        >
          <MapPin size={14} className="text-scala-text-subtle shrink-0" />
          {zones.map(z => (
            <span key={z} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-scala-blue/20 border border-scala-blue/40 text-xs text-scala-blue-light font-medium">
              {z}
              {!isSearching && (
                <button type="button" onClick={e => { e.stopPropagation(); removeZone(z) }} className="hover:text-white transition-colors">
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          <input
            ref={zoneRef}
            type="text"
            value={zoneInput}
            onChange={e => setZoneInput(e.target.value)}
            onKeyDown={handleZoneKey}
            onBlur={() => { if (zoneInput.trim()) addZone(zoneInput) }}
            disabled={isSearching}
            placeholder={zones.length === 0 ? 'Ciudad o zona — Enter para agregar más' : 'Agregar otra ciudad...'}
            className="flex-1 min-w-[180px] bg-transparent text-sm text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none disabled:opacity-50"
          />
          {zoneInput.trim() && (
            <button
              type="button"
              onClick={() => addZone(zoneInput)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-scala-text-muted hover:text-scala-text-primary border border-white/10 hover:border-white/20 transition-colors"
            >
              <Plus size={11} /> Agregar
            </button>
          )}
        </div>

        {zones.length > 1 && (
          <p className="text-xs text-scala-text-muted pl-1">
            Se van a buscar <span className="text-scala-text-primary font-medium">{zones.length} zonas</span> — hasta <span className="text-scala-text-primary font-medium">{zones.length * maxResults}</span> resultados totales
          </p>
        )}
      </form>

      {/* Bottom row: suggestions + coverage */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_CITIES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => addZone(s)}
              disabled={isSearching || zones.includes(s)}
              className="px-3 py-1 rounded-full text-xs border border-white/[0.07] bg-scala-surface2 text-scala-text-muted hover:text-scala-text-primary hover:border-white/20 disabled:opacity-30 transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Layers size={13} className="text-scala-text-subtle" />
          <span className="text-xs text-scala-text-muted">Por zona:</span>
          <div className="flex rounded-lg border border-white/[0.07] overflow-hidden">
            {COVERAGE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMaxResults(opt.value)}
                disabled={isSearching}
                title={opt.desc}
                className={`px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                  maxResults === opt.value
                    ? 'bg-scala-blue text-white font-medium'
                    : 'bg-scala-surface2 text-scala-text-muted hover:text-scala-text-primary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-scala-text-subtle">{COVERAGE_OPTIONS.find(o => o.value === maxResults)?.desc}</span>
        </div>
      </div>
    </div>
  )
}
