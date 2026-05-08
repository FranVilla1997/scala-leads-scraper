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
