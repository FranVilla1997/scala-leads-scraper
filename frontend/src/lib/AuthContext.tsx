import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { apiJson } from './api'

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
    } catch {
      setMe(null)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadMe(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s)
      await loadMe(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn: AuthCtx['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return {}
  }

  const signOut = async () => {
    await supabase.auth.signOut()
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
