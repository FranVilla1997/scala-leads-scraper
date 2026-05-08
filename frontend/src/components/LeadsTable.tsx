import { useState } from 'react'
import { Download, ExternalLink, Mail, Phone, Star, Search, Globe } from 'lucide-react'
import type { Lead } from '../types'

interface Props {
  leads: Lead[]
}

export default function LeadsTable({ leads }: Props) {
  const [filter, setFilter] = useState('')

  const filtered = leads.filter(l => {
    const q = filter.toLowerCase()
    return (
      l.name?.toLowerCase().includes(q) ||
      l.address?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q) ||
      l.category?.toLowerCase().includes(q)
    )
  })

  const exportCSV = () => {
    const fields: (keyof Lead)[] = ['name', 'address', 'phone', 'website', 'email', 'rating', 'reviews_count', 'category', 'search_query', 'search_zone']
    const header = fields.join(',')
    const rows = leads.map(l =>
      fields.map(f => String(l[f] ?? '').replace(/,/g, ';').replace(/\n/g, ' ')).join(',')
    )
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'leads_scala.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const withEmail = leads.filter(l => l.email).length

  return (
    <div className="rounded-xl border border-white/[0.07] bg-scala-surface1 overflow-hidden animate-fade-in">
      {/* Table header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-5 border-b border-white/[0.07]">
        <div>
          <h2 className="text-sm font-semibold text-scala-text-primary">
            Leads encontrados
          </h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-scala-text-muted">{leads.length} negocios</span>
            <span className="w-px h-3 bg-white/10" />
            <span className="text-xs text-scala-green font-medium">{withEmail} con email</span>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-56">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-scala-text-subtle" />
            <input
              type="text"
              placeholder="Filtrar..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="
                w-full pl-8 pr-3 py-2 rounded-lg bg-scala-surface2 border border-white/[0.07]
                text-xs text-scala-text-primary placeholder:text-scala-text-subtle
                focus:outline-none focus:border-scala-blue/50 transition-colors
              "
            />
          </div>
<button
            onClick={exportCSV}
            disabled={leads.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-scala-blue hover:bg-scala-blue-light text-white text-xs font-medium transition-colors disabled:opacity-40"
          >
            <Download size={13} />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.07]">
              {['Negocio', 'Dirección', 'Teléfono', 'Email', 'Web', 'Rating', 'Categoría'].map(col => (
                <th
                  key={col}
                  className="px-4 py-3 text-left text-xs font-medium text-scala-text-muted uppercase tracking-wider whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-scala-text-muted text-sm">
                  {filter ? 'Sin resultados para ese filtro' : 'Los leads aparecerán aquí en tiempo real'}
                </td>
              </tr>
            ) : (
              filtered.map((lead, i) => (
                <tr
                  key={lead.place_id || i}
                  className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors animate-fade-in"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-scala-text-primary text-sm leading-tight">
                      {lead.name || '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-scala-text-muted max-w-[200px] leading-relaxed">
                      {lead.address || '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {lead.phone ? (
                      <a
                        href={`tel:${lead.phone}`}
                        className="flex items-center gap-1.5 text-xs text-scala-text-muted hover:text-scala-text-primary transition-colors"
                      >
                        <Phone size={12} className="shrink-0" />
                        {lead.phone}
                      </a>
                    ) : (
                      <span className="text-xs text-scala-text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {lead.email ? (
                      <a
                        href={`mailto:${lead.email}`}
                        className="flex items-center gap-1.5 text-xs font-medium text-scala-green hover:underline"
                      >
                        <Mail size={12} className="shrink-0" />
                        {lead.email}
                      </a>
                    ) : (
                      <span className="text-xs text-scala-text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {lead.website ? (
                      <a
                        href={lead.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-scala-blue-light hover:underline"
                      >
                        <Globe size={12} className="shrink-0" />
                        <ExternalLink size={11} className="shrink-0" />
                      </a>
                    ) : (
                      <span className="text-xs text-scala-text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {lead.rating ? (
                      <div className="flex items-center gap-1">
                        <Star size={12} className="text-yellow-400 fill-yellow-400 shrink-0" />
                        <span className="text-xs text-scala-text-primary font-medium">{lead.rating}</span>
                        {lead.reviews_count && (
                          <span className="text-xs text-scala-text-subtle">({lead.reviews_count})</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-scala-text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {lead.category ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-scala-surface3 text-scala-text-muted border border-white/[0.06]">
                        {lead.category.replace(/_/g, ' ')}
                      </span>
                    ) : (
                      <span className="text-xs text-scala-text-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
