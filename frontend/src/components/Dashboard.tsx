import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3, Mail, MailX, Target, TrendingUp, MapPin, Tag, Activity,
  Users, Trophy, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react'
import { apiJson } from '../lib/api'
import { type AdminStats, type LeadStatus, STATUS_LABEL, STATUS_ORDER } from '../types'

const STATUS_COLOR: Record<LeadStatus, string> = {
  nuevo:            'bg-scala-blue',
  contactado:       'bg-yellow-500',
  interesado:       'bg-purple-500',
  cerrado_ganado:   'bg-scala-green',
  cerrado_perdido:  'bg-red-500',
}

function Kpi({ icon: Icon, label, value, suffix, accent }: {
  icon: typeof BarChart3
  label: string
  value: number | string
  suffix?: string
  accent: string
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-4">
      <div className="flex items-center gap-2 text-xs text-scala-text-muted mb-2">
        <Icon size={13} className={accent} />
        <span>{label}</span>
      </div>
      <p className={`text-2xl font-bold ${accent}`}>
        {value}
        {suffix && <span className="text-sm font-normal text-scala-text-muted ml-1">{suffix}</span>}
      </p>
    </div>
  )
}

function HorizontalBar({ label, value, max, color = 'bg-scala-blue' }: {
  label: string; value: number; max: number; color?: string
}) {
  const pct = max ? Math.round((value / max) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-scala-text-primary truncate max-w-[70%]">{label}</span>
        <span className="text-scala-text-muted font-medium">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-scala-surface3 overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Sparkline({ data, max }: { data: { date: string; count: number }[]; max: number }) {
  if (data.length === 0) return <p className="text-xs text-scala-text-subtle italic">Sin actividad reciente</p>
  const W = 480, H = 60, P = 4
  const innerW = W - 2 * P, innerH = H - 2 * P
  const step = innerW / Math.max(data.length - 1, 1)
  const points = data.map((d, i) => {
    const x = P + i * step
    const y = P + innerH - (max ? (d.count / max) * innerH : 0)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-scala-blue-light" />
        {data.map((d, i) => {
          const x = P + i * step
          const y = P + innerH - (max ? (d.count / max) * innerH : 0)
          return <circle key={d.date} cx={x} cy={y} r="1.5" className="fill-scala-blue" />
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-scala-text-subtle">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState<'won' | 'contact' | 'assigned' | 'activity'>('won')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const load = useCallback(async () => {
    setLoading(true)
    try { setStats(await apiJson<AdminStats>('/api/admin/stats')) }
    catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const sellersSorted = useMemo(() => {
    if (!stats) return []
    const key = (s: AdminStats['sellers'][number]) => ({
      won: s.by_status.cerrado_ganado,
      contact: s.contact_rate,
      assigned: s.total_assigned,
      activity: s.updates_30d,
    }[sortBy])
    const arr = [...stats.sellers].sort((a, b) => key(a) - key(b))
    return sortDir === 'desc' ? arr.reverse() : arr
  }, [stats, sortBy, sortDir])

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const SortHeader = ({ id, label, align = 'left' }: { id: typeof sortBy; label: string; align?: 'left'|'right'|'center' }) => (
    <th onClick={() => toggleSort(id)} className={`px-3 py-3 text-${align} text-xs font-medium uppercase tracking-wider cursor-pointer select-none whitespace-nowrap ${sortBy === id ? 'text-scala-blue-light' : 'text-scala-text-muted hover:text-scala-text-primary'}`}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === id && (sortDir === 'desc' ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
      </span>
    </th>
  )

  if (!stats) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-10 text-center">
        {loading
          ? <p className="text-sm text-scala-text-muted animate-pulse">Cargando estadísticas...</p>
          : <p className="text-sm text-scala-text-muted">Sin datos.</p>}
      </div>
    )
  }

  const { overview, top_zones, top_categories, top_queries, activity_30d, sellers } = stats
  const funnel = STATUS_ORDER.map(s => ({ status: s, count: overview.by_status[s] ?? 0 }))
  const funnelMax = Math.max(...funnel.map(f => f.count), 1)
  const zoneMax  = top_zones[0]?.count ?? 1
  const catMax   = top_categories[0]?.count ?? 1
  const queryMax = top_queries[0]?.count ?? 1
  const actMax   = Math.max(...activity_30d.map(d => d.count), 1)
  const topWinner = sellers.length > 0 ? sellers[0] : null

  return (
    <div className="space-y-5">
      {/* Refresh */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-scala-text-primary flex items-center gap-2">
          <BarChart3 size={15} className="text-scala-blue-light" />
          Estadísticas globales
        </h2>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/[0.07] bg-scala-surface2 text-xs text-scala-text-muted hover:text-scala-text-primary transition-colors disabled:opacity-40">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refrescar
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={Target}     label="Total leads"        value={overview.total}                                    accent="text-scala-text-primary" />
        <Kpi icon={Mail}       label="Con email"          value={overview.with_email}    suffix={`(${overview.email_rate}%)`} accent="text-scala-green" />
        <Kpi icon={MailX}      label="Sin email"          value={overview.without_email}                            accent="text-scala-text-muted" />
        <Kpi icon={TrendingUp} label="Ganados"            value={overview.by_status.cerrado_ganado ?? 0}            accent="text-scala-green" />
        <Kpi icon={Activity}   label="Scrapeados 7d"      value={overview.scraped_last_7d}                          accent="text-scala-blue-light" />
        <Kpi icon={Activity}   label="Scrapeados 30d"     value={overview.scraped_last_30d}                         accent="text-scala-blue-light" />
      </div>

      {/* Funnel + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-5">
          <h3 className="text-xs uppercase tracking-widest text-scala-text-muted mb-4">Embudo de conversión</h3>
          <div className="space-y-3">
            {funnel.map(({ status, count }) => {
              const pct = funnelMax ? Math.round((count / funnelMax) * 100) : 0
              const pctTotal = overview.total ? Math.round((count / overview.total) * 100) : 0
              return (
                <div key={status} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-scala-text-primary font-medium">{STATUS_LABEL[status]}</span>
                    <span className="text-scala-text-muted">
                      <span className="text-scala-text-primary font-semibold">{count}</span>
                      <span className="ml-1.5 text-scala-text-subtle">({pctTotal}%)</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-scala-surface3 overflow-hidden">
                    <div className={`h-full ${STATUS_COLOR[status]} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-5">
          <h3 className="text-xs uppercase tracking-widest text-scala-text-muted mb-2 flex items-center gap-2">
            <Activity size={12} /> Actividad de scraping — últimos 30 días
          </h3>
          <Sparkline data={activity_30d} max={actMax} />
          <p className="text-xs text-scala-text-muted mt-2">
            Pico: <span className="text-scala-text-primary font-medium">{actMax}</span> leads en un día
          </p>
        </div>
      </div>

      {/* Top zonas, categorías, queries */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-5">
          <h3 className="text-xs uppercase tracking-widest text-scala-text-muted mb-4 flex items-center gap-2">
            <MapPin size={12} /> Top zonas
          </h3>
          <div className="space-y-2.5">
            {top_zones.length === 0
              ? <p className="text-xs text-scala-text-subtle italic">Sin datos</p>
              : top_zones.map(z => <HorizontalBar key={z.zone} label={z.zone} value={z.count} max={zoneMax} color="bg-scala-blue-light" />)}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-5">
          <h3 className="text-xs uppercase tracking-widest text-scala-text-muted mb-4 flex items-center gap-2">
            <Tag size={12} /> Top tipos de negocio
          </h3>
          <div className="space-y-2.5">
            {top_categories.length === 0
              ? <p className="text-xs text-scala-text-subtle italic">Sin datos</p>
              : top_categories.map(c => <HorizontalBar key={c.category} label={c.category.replace(/_/g, ' ')} value={c.count} max={catMax} color="bg-orange-500" />)}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 p-5">
          <h3 className="text-xs uppercase tracking-widest text-scala-text-muted mb-4 flex items-center gap-2">
            <Target size={12} /> Top búsquedas
          </h3>
          <div className="space-y-2.5">
            {top_queries.length === 0
              ? <p className="text-xs text-scala-text-subtle italic">Sin datos</p>
              : top_queries.map(q => <HorizontalBar key={q.query} label={q.query} value={q.count} max={queryMax} color="bg-scala-green" />)}
          </div>
        </div>
      </div>

      {/* Performance por vendedor */}
      <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
          <h3 className="text-sm font-medium text-scala-text-primary flex items-center gap-2">
            <Users size={14} className="text-scala-text-muted" />
            Rendimiento por vendedor
          </h3>
          {topWinner && (
            <div className="flex items-center gap-2 text-xs">
              <Trophy size={13} className="text-yellow-400" />
              <span className="text-scala-text-muted">Top:</span>
              <span className="text-scala-text-primary font-medium">{topWinner.full_name || topWinner.email}</span>
              <span className="text-scala-green font-semibold">· {topWinner.by_status.cerrado_ganado} ganados</span>
            </div>
          )}
        </div>

        {sellers.length === 0 ? (
          <p className="text-sm text-scala-text-muted text-center py-10">Sin vendedores activos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] bg-scala-surface2/30">
                  <th className="px-4 py-3 text-left text-xs font-medium text-scala-text-muted uppercase tracking-wider">Vendedor</th>
                  <SortHeader id="assigned" label="Asignados" align="right" />
                  {STATUS_ORDER.map(s => (
                    <th key={s} className="px-2 py-3 text-center text-[10px] font-medium text-scala-text-muted uppercase tracking-wider whitespace-nowrap">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`inline-block w-2 h-2 rounded-full ${STATUS_COLOR[s]}`} />
                        {STATUS_LABEL[s].split('·')[0].trim()}
                      </div>
                    </th>
                  ))}
                  <SortHeader id="contact"  label="Contact %" align="right" />
                  <th className="px-3 py-3 text-right text-xs font-medium text-scala-text-muted uppercase tracking-wider whitespace-nowrap">Win %</th>
                  <SortHeader id="activity" label="Actividad 30d" align="right" />
                </tr>
              </thead>
              <tbody>
                {sellersSorted.map((s, i) => (
                  <tr key={s.id} className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${!s.active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {i === 0 && sortBy === 'won' && sortDir === 'desc' && <Trophy size={12} className="text-yellow-400 shrink-0" />}
                        <div>
                          <p className="text-sm font-medium text-scala-text-primary">{s.full_name || s.email}</p>
                          <p className="text-[10px] text-scala-text-subtle">{s.zones.length} zonas · {s.with_email} con email</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-sm font-semibold text-scala-text-primary">{s.total_assigned}</td>
                    {STATUS_ORDER.map(st => (
                      <td key={st} className="px-2 py-3 text-center text-xs text-scala-text-muted">{s.by_status[st]}</td>
                    ))}
                    <td className="px-3 py-3 text-right">
                      <span className={`text-xs font-medium ${s.contact_rate >= 50 ? 'text-scala-green' : s.contact_rate >= 25 ? 'text-yellow-300' : 'text-scala-text-muted'}`}>
                        {s.contact_rate}%
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={`text-xs font-medium ${s.win_rate >= 10 ? 'text-scala-green' : 'text-scala-text-muted'}`}>
                        {s.win_rate}%
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="text-xs text-scala-text-primary font-medium">{s.updates_30d}</span>
                      <span className="text-[10px] text-scala-text-subtle ml-1">(7d: {s.updates_7d})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
