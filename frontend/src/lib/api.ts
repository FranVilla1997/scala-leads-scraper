export const API = import.meta.env.VITE_API_URL ?? 'http://localhost:9001'

// Cached access token, updated by AuthContext on auth state changes.
let _accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  _accessToken = token
}

export function getAccessToken(): string | null {
  return _accessToken
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined ?? {}),
  }
  if (_accessToken) headers.Authorization = `Bearer ${_accessToken}`
  return fetch(`${API}${path}`, { ...init, headers })
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}
