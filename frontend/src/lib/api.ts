const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export function getAuthHeader(user: string, pass: string) {
  return 'Basic ' + btoa(`${user}:${pass}`)
}

export function getStoredAuth(): { user: string; pass: string } | null {
  if (typeof window === 'undefined') return null
  const user = sessionStorage.getItem('fiq_user')
  const pass = sessionStorage.getItem('fiq_pass')
  if (!user || !pass) return null
  return { user, pass }
}

export function setStoredAuth(user: string, pass: string) {
  sessionStorage.setItem('fiq_user', user)
  sessionStorage.setItem('fiq_pass', pass)
}

export function clearAuth() {
  sessionStorage.removeItem('fiq_user')
  sessionStorage.removeItem('fiq_pass')
}

async function apiFetch(path: string, auth: { user: string; pass: string }) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: getAuthHeader(auth.user, auth.pass) },
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

export interface ChipRow {
  date: string
  stock_id: string
  foreign_net: number
  trust_net: number
  dealer_net: number
  inst_net: number
  margin_balance: number
  short_balance: number
  close_price: number | null
}

export async function fetchSummary(auth: { user: string; pass: string }, top = 30) {
  return apiFetch(`/api/summary?top=${top}`, auth) as Promise<{ date: string; data: ChipRow[] }>
}

export async function fetchChip(
  auth: { user: string; pass: string },
  stockId: string,
  limit = 30
) {
  return apiFetch(`/api/chip?stock_id=${stockId}&limit=${limit}`, auth) as Promise<ChipRow[]>
}

export async function fetchMultiChip(
  auth: { user: string; pass: string },
  stocks: string[],
  start?: string
) {
  const q = stocks.join(',')
  const startQ = start ? `&start=${start}` : ''
  return apiFetch(`/api/chip/multi?stocks=${q}${startQ}`, auth) as Promise<ChipRow[]>
}

export async function fetchDates(auth: { user: string; pass: string }) {
  return apiFetch('/api/dates', auth) as Promise<string[]>
}

export function fmt(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

export function fmtNum(n: number, sign = true) {
  const s = Math.abs(n).toLocaleString()
  if (!sign) return s
  return n >= 0 ? `+${s}` : `-${s}`
}
