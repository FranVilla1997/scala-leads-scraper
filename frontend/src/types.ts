export type LeadStatus =
  | 'nuevo'
  | 'contactado'
  | 'interesado'
  | 'cerrado_ganado'
  | 'cerrado_perdido'

export const STATUS_LABEL: Record<LeadStatus, string> = {
  nuevo:            'Nuevo',
  contactado:       'Contactado',
  interesado:       'Interesado',
  cerrado_ganado:   'Cerrado · Ganado',
  cerrado_perdido:  'Cerrado · Perdido',
}

export const STATUS_ORDER: LeadStatus[] = [
  'nuevo', 'contactado', 'interesado', 'cerrado_ganado', 'cerrado_perdido',
]

export interface Lead {
  id?: string
  place_id: string
  name: string
  address: string
  phone: string
  website: string
  email: string | null
  rating: number | null
  reviews_count: number | null
  category: string
  search_query: string
  search_zone: string
  scraped_at: string
  status: LeadStatus
  notes: string | null
  updated_at?: string
  updated_by?: string | null
}

export interface SSEEvent {
  type: 'status' | 'scraping' | 'lead' | 'done' | 'error'
  message?: string
  data?: Lead
  total?: number
  index?: number
  new?: number
  skipped?: number
}

export interface Seller {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'vendedor'
  active: boolean
  created_at: string
  zones: string[]
}

export interface AdminStats {
  overview: {
    total: number
    with_email: number
    without_email: number
    email_rate: number
    by_status: Partial<Record<LeadStatus, number>>
    scraped_last_7d: number
    scraped_last_30d: number
  }
  top_zones:      { zone: string;     count: number }[]
  top_categories: { category: string; count: number }[]
  top_queries:    { query: string;    count: number }[]
  activity_30d:   { date: string;     count: number }[]
  sellers: {
    id: string
    email: string
    full_name: string | null
    active: boolean
    zones: string[]
    total_assigned: number
    by_status: Record<LeadStatus, number>
    with_email: number
    updates_7d: number
    updates_30d: number
    contact_rate: number
    win_rate: number
  }[]
}
