import { useState, useRef, type FormEvent, type KeyboardEvent } from 'react'
import { Search, MapPin, Briefcase, Loader2, Layers, X, Plus, ChevronDown, ListChecks } from 'lucide-react'
import { BUSINESS_GROUPS, ZONE_GROUPS, type CatalogGroup } from '../lib/catalog'

interface Props {
  onSearch: (queries: string[], zones: string[], maxResults: number, findContacts: boolean) => void
  isSearching: boolean
}

// `requests`: consultas a Google Places por cada combinación rubro × zona
const COVERAGE_OPTIONS = [
  { value: 60,  label: '60',  desc: 'Rápido',     requests: 3 },
  { value: 120, label: '120', desc: 'Grilla 2×2', requests: 12 },
  { value: 200, label: '200', desc: 'Grilla 3×3', requests: 27 },
  { value: 300, label: '300', desc: 'Grilla 4×4', requests: 48 },
]

// Precio de lista aproximado de Places Text Search con teléfono y web (USD por consulta)
const USD_PER_PLACES_REQUEST = 0.035

/** Lista agrupada para tildar rubros o zonas de a muchos. */
function CatalogPicker({
  label, groups, selected, onAdd, onRemove, disabled,
}: {
  label: string
  groups: CatalogGroup[]
  selected: string[]
  onAdd: (values: string[]) => void
  onRemove: (values: string[]) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const picked = groups.reduce((n, g) => n + g.items.filter(i => selected.includes(i)).length, 0)

  return (
    <div className="rounded-lg border border-white/[0.07] bg-scala-surface2/50">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-scala-text-muted hover:text-scala-text-primary transition-colors"
      >
        <ListChecks size={13} />
        <span>{label}</span>
        {picked > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-scala-blue text-white">{picked}</span>}
        <ChevronDown size={12} className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 max-h-80 overflow-y-auto">
          {groups.map(g => {
            const allPicked = g.items.every(i => selected.includes(i))
            return (
              <div key={g.name}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-scala-text-subtle">{g.name}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => allPicked ? onRemove(g.items) : onAdd(g.items)}
                    className="text-[11px] text-scala-blue-light hover:underline disabled:opacity-40"
                  >
                    {allPicked ? 'Quitar todos' : `Elegir los ${g.items.length}`}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map(item => {
                    const on = selected.includes(item)
                    return (
                      <button
                        key={item}
                        type="button"
                        disabled={disabled}
                        onClick={() => on ? onRemove([item]) : onAdd([item])}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors disabled:opacity-40 ${
                          on
                            ? 'bg-scala-blue/20 border-scala-blue/50 text-scala-text-primary'
                            : 'bg-scala-surface2 border-white/[0.07] text-scala-text-muted hover:text-scala-text-primary hover:border-white/20'
                        }`}
                      >
                        {item}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function SearchPanel({ onSearch, isSearching }: Props) {
  const [queries, setQueries] = useState<string[]>([])
  const [queryInput, setQueryInput] = useState('')
  const [zones, setZones] = useState<string[]>([])
  const [zoneInput, setZoneInput] = useState('')
  const [maxResults, setMaxResults] = useState(60)
  const [findContacts, setFindContacts] = useState(false)
  const queryRef = useRef<HTMLInputElement>(null)
  const zoneRef = useRef<HTMLInputElement>(null)

  const addQuery = (value: string) => {
    const v = value.trim()
    if (v && !queries.some(q => q.toLowerCase() === v.toLowerCase())) {
      setQueries(prev => [...prev, v])
    }
    setQueryInput('')
  }
  const removeQuery = (q: string) => setQueries(prev => prev.filter(x => x !== q))

  const addZone = (value: string) => {
    const v = value.trim()
    if (v && !zones.some(z => z.toLowerCase() === v.toLowerCase())) setZones(prev => [...prev, v])
    setZoneInput('')
  }

  const addMany = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (values: string[]) =>
    setter(prev => [...prev, ...values.filter(v => !prev.includes(v))])
  const removeMany = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (values: string[]) =>
    setter(prev => prev.filter(v => !values.includes(v)))
  const removeZone = (z: string) => setZones(prev => prev.filter(x => x !== z))

  const handleChipKey = (
    e: KeyboardEvent<HTMLInputElement>,
    inputValue: string,
    list: string[],
    add: (v: string) => void,
    setList: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(inputValue)
    } else if (e.key === 'Backspace' && !inputValue && list.length > 0) {
      setList(prev => prev.slice(0, -1))
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    // commitear cualquier input pendiente
    const qPending = queryInput.trim()
    const zPending = zoneInput.trim()
    const allQueries = qPending && !queries.some(q => q.toLowerCase() === qPending.toLowerCase()) ? [...queries, qPending] : queries
    const allZones = zPending && !zones.includes(zPending) ? [...zones, zPending] : zones
    if (allQueries.length && allZones.length && !isSearching) {
      const combos = allQueries.length * allZones.length
      if (combos > 30 && !window.confirm(
        `Vas a lanzar ${combos} búsquedas (${allQueries.length} rubros × ${allZones.length} zonas): ` +
        `unas ${(combos * requestsPerCombo).toLocaleString()} consultas a Google Places, ` +
        `aprox. USD ${Math.round(combos * requestsPerCombo * USD_PER_PLACES_REQUEST)}. ` +
        `Puede tardar un buen rato. ¿Seguir?`
      )) return
      setQueries(allQueries); setZones(allZones)
      setQueryInput(''); setZoneInput('')
      onSearch(allQueries, allZones, maxResults, findContacts)
    }
  }

  const totalQueries = queries.length + (queryInput.trim() ? 1 : 0)
  const totalZones   = zones.length   + (zoneInput.trim() ? 1 : 0)
  const canSearch    = totalQueries > 0 && totalZones > 0 && !isSearching
  const estimatedMax = totalQueries * totalZones * maxResults
  const requestsPerCombo = COVERAGE_OPTIONS.find(o => o.value === maxResults)?.requests ?? 3
  const estimatedRequests = totalQueries * totalZones * requestsPerCombo

  return (
    <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-6 mb-6">
      <h2 className="text-sm font-medium text-scala-text-muted uppercase tracking-widest mb-5">
        Nueva búsqueda
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Row 1: queries chip input + submit */}
        <div className="flex gap-3">
          <div
            className="flex flex-wrap items-center gap-1.5 min-h-[42px] flex-1 px-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07] focus-within:border-scala-blue/50 focus-within:ring-1 focus-within:ring-scala-blue/30 cursor-text transition-colors"
            onClick={() => queryRef.current?.focus()}
          >
            <Briefcase size={14} className="text-scala-text-subtle shrink-0" />
            {queries.map(q => (
              <span key={q} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-scala-green/15 border border-scala-green/30 text-xs text-scala-green font-medium">
                {q}
                {!isSearching && (
                  <button type="button" onClick={e => { e.stopPropagation(); removeQuery(q) }} className="hover:text-white transition-colors">
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}
            <input
              ref={queryRef}
              type="text"
              value={queryInput}
              onChange={e => setQueryInput(e.target.value)}
              onKeyDown={e => handleChipKey(e, queryInput, queries, addQuery, setQueries)}
              onBlur={() => { if (queryInput.trim()) addQuery(queryInput) }}
              disabled={isSearching}
              placeholder={queries.length === 0 ? 'Tipo de negocio (Enter para agregar otro) — ej: dentistas, odontólogos' : 'Agregar otra keyword...'}
              className="flex-1 min-w-[180px] bg-transparent text-sm text-scala-text-primary placeholder:text-scala-text-subtle focus:outline-none disabled:opacity-50"
            />
            {queryInput.trim() && (
              <button
                type="button"
                onClick={() => addQuery(queryInput)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-scala-text-muted hover:text-scala-text-primary border border-white/10 hover:border-white/20 transition-colors"
              >
                <Plus size={11} /> Agregar
              </button>
            )}
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

        <CatalogPicker
          label="Elegir rubros de la lista"
          groups={BUSINESS_GROUPS}
          selected={queries}
          onAdd={addMany(setQueries)}
          onRemove={removeMany(setQueries)}
          disabled={isSearching}
        />

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
            onKeyDown={e => handleChipKey(e, zoneInput, zones, addZone, setZones)}
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

        <CatalogPicker
          label="Elegir zonas de la lista"
          groups={ZONE_GROUPS}
          selected={zones}
          onAdd={addMany(setZones)}
          onRemove={removeMany(setZones)}
          disabled={isSearching}
        />

        {(totalQueries > 1 || totalZones > 1) && (
          <p className="text-xs text-scala-text-muted pl-1">
            Se van a correr <span className="text-scala-text-primary font-medium">{totalQueries} rubro(s)</span> × <span className="text-scala-text-primary font-medium">{totalZones} zona(s)</span> = <span className="text-scala-text-primary font-medium">{totalQueries * totalZones} búsquedas</span> — hasta <span className="text-scala-text-primary font-medium">{estimatedMax.toLocaleString()}</span> resultados antes de deduplicar · <span className="text-scala-text-primary font-medium">{estimatedRequests.toLocaleString()}</span> consultas a Google (aprox. USD {Math.round(estimatedRequests * USD_PER_PLACES_REQUEST)})
          </p>
        )}
      </form>

      {/* Bottom row: suggestions + coverage */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <label className="flex items-center gap-2 text-xs text-scala-text-muted cursor-pointer"
               title="Más lento y usa una búsqueda paga por lead. Si lo dejás apagado, lo podés hacer después desde Base de datos sobre los leads que elijas.">
          <input
            type="checkbox"
            checked={findContacts}
            onChange={e => setFindContacts(e.target.checked)}
            disabled={isSearching}
            className="accent-scala-blue"
          />
          Buscar responsables durante el scrape (web + LinkedIn)
        </label>

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
