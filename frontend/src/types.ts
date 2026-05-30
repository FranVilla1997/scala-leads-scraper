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
