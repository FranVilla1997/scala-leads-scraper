import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { apiJson, setAccessToken } from './api'

export interface Me {
  id: string
  email: string
  role: 'admin' | 'vendedor'
  zones: string[]
}

interface AuthCtx {
  session: Session | null
  me: Me | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthCtx | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const loadMe = async (s: Session | null) => {
    if (!s) { setMe(null); return }
    try {
      const data = await apiJson<Me>('/api/me')
      setMe(data)
    } catch (e) {
      console.error('[auth] /api/me failed:', e)
      setMe(null)
    }
  }

  useEffect(() => {
    // Rely entirely on onAuthStateChange — it fires immediately with
    // INITIAL_SESSION (or SIGNED_IN if a saved session exists), and again
    // on every login/logout/refresh. supabase.auth.getSession() has been
    // observed to hang in this combo, so we avoid it.
    let firstEvent = true
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s)
      setAccessToken(s?.access_token ?? null)
      await loadMe(s)
      if (firstEvent) {
        firstEvent = false
        setLoading(false)
      }
    })

    // Safety: in case the first event somehow never fires
    const safety = setTimeout(() => setLoading(false), 3000)

    return () => { clearTimeout(safety); sub.subscription.unsubscribe() }
  }, [])

  const signIn: AuthCtx['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return {}
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setAccessToken(null)
    setMe(null)
  }

  const refresh = async () => { await loadMe(session) }

  return (
    <Ctx.Provider value={{ session, me, loading, signIn, signOut, refresh }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth fuera de <AuthProvider>')
  return v
}
