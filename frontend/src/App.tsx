import { useState, useRef } from 'react'
import { Search, Database } from 'lucide-react'
import Header from './components/Header'
import SearchPanel from './components/SearchPanel'
import ProgressPanel from './components/ProgressPanel'
import LeadsTable from './components/LeadsTable'
import LeadsDB from './components/LeadsDB'
import type { Lead, SSEEvent } from './types'

const API = 'http://localhost:9001'

type Tab = 'scraper' | 'database'
type SearchState = 'idle' | 'searching' | 'done'

export default function App() {
  const [tab, setTab] = useState<Tab>('scraper')
  const [searchState, setSearchState] = useState<SearchState>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const esRef = useRef<EventSource | null>(null)

  const handleSearch = async (query: string, zones: string[], maxResults: number) => {
    esRef.current?.close()
    setSearchState('searching')
    setLeads([])
    setProgress({ current: 0, total: 0 })
    setStatusMessage('Iniciando búsqueda...')

    try {
      const res = await fetch(`${API}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, zones, max_results: maxResults }),
      })
      if (!res.ok) throw new Error('Error al iniciar la búsqueda')
      const { job_id } = await res.json() as { job_id: string }

      const es = new EventSource(`${API}/api/search/${job_id}/stream`)
      esRef.current = es

      es.onmessage = (e: MessageEvent) => {
        const event = JSON.parse(e.data as string) as SSEEvent
        if (event.type === 'status') {
          setStatusMessage(event.message ?? '')
          if (event.total) setProgress(p => ({ ...p, total: event.total! }))
        } else if (event.type === 'scraping') {
          setStatusMessage(event.message ?? '')
          if (event.index) setProgress(p => ({ ...p, current: event.index! }))
          if (event.total) setProgress(p => ({ ...p, total: event.total! }))
        } else if (event.type === 'lead' && event.data) {
          setLeads(prev => [event.data!, ...prev])
        } else if (event.type === 'done') {
          setSearchState('done')
          const parts = [`${event.total ?? 0} negocios procesados`]
          if (event.new) parts.push(`${event.new} nuevos`)
          if (event.skipped) parts.push(`${event.skipped} ya existían`)
          setStatusMessage(`Búsqueda completada — ${parts.join(' · ')}.`)
          es.close()
        } else if (event.type === 'error') {
          setSearchState('idle')
          setStatusMessage(`Error: ${event.message ?? 'desconocido'}`)
          es.close()
        }
      }
      es.onerror = () => { if (searchState === 'searching') setSearchState('done'); es.close() }
    } catch {
      setSearchState('idle')
      setStatusMessage('No se pudo conectar con el servidor backend.')
    }
  }

  return (
    <div className="scala-bg">
      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <Header />

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-scala-surface1 border border-white/[0.07] w-fit mb-7">
          {([
            { id: 'scraper', label: 'Scraper', icon: Search },
            { id: 'database', label: 'Base de datos', icon: Database },
          ] as { id: Tab; label: string; icon: typeof Search }[]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === id
                  ? 'bg-scala-blue text-white shadow-lg'
                  : 'text-scala-text-muted hover:text-scala-text-primary'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Scraper tab */}
        {tab === 'scraper' && (
          <>
            <SearchPanel onSearch={handleSearch} isSearching={searchState === 'searching'} />
            {searchState !== 'idle' && (
              <ProgressPanel
                message={statusMessage}
                progress={progress}
                isSearching={searchState === 'searching'}
                leadsFound={leads.length}
              />
            )}
            {leads.length > 0 && <LeadsTable leads={leads} />}
          </>
        )}

        {/* Database tab */}
        {tab === 'database' && <LeadsDB apiBase={API} />}
      </div>
    </div>
  )
}
