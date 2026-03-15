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

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function apiFetch(path: string, auth: { user: string; pass: string }) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: getAuthHeader(auth.user, auth.pass) },
  })
  if (!res.ok) throw new ApiError(res.status, `API ${res.status}`)
  return res.json()
}

// ── Types ──────────────────────────────────────────────────────────────────

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

export interface SignalRow {
  stock_id: string
  score: number
  z_score: number
  foreign_net: number
  trust_net: number
  dealer_net: number
  inst_net: number
  close_price: number | null
  consec_buy: number
  consec_sell: number
  cum5_foreign: number
  pct5: number
  three_consistent: boolean
  signal_type: 'triple_arrow' | 'stealth_entry' | 'trust_push' | 'retail_chase' | 'normal'
  light: 'red' | 'yellow' | 'gray'
}

export interface StockStats {
  stock_id: string
  market: string
  latest_date: string
  latest_price: number | null
  consec_buy: number
  consec_sell: number
  cum5_foreign: number
  cum20_foreign: number
  pct5: number
  z_score: number
  three_consistent: boolean
  total_days: number
}

// ── Fetch functions ────────────────────────────────────────────────────────

export async function fetchSummary(auth: { user: string; pass: string }, top = 30) {
  return apiFetch(`/api/summary?top=${top}`, auth) as Promise<{ date: string; data: ChipRow[] }>
}

export async function fetchChip(
  auth: { user: string; pass: string },
  stockId: string,
  limit = 60
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

export async function fetchStocks(auth: { user: string; pass: string }) {
  return apiFetch('/api/stocks', auth) as Promise<Record<string, string>>
}

export async function fetchSignals(auth: { user: string; pass: string }, top = 50) {
  return apiFetch(`/api/signals?top=${top}`, auth) as Promise<{ date: string; data: SignalRow[] }>
}

export async function fetchStockStats(auth: { user: string; pass: string }, stockId: string) {
  return apiFetch(`/api/stock/${stockId}/stats`, auth) as Promise<StockStats>
}

// ── Formatting helpers ─────────────────────────────────────────────────────

export function fmt(n: number | null | undefined) {
  if (n == null || isNaN(n)) return '\u2014'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

export function fmtNum(n: number, sign = true) {
  const s = Math.abs(n).toLocaleString()
  if (!sign) return s
  return n >= 0 ? `+${s}` : `-${s}`
}

export function fmtPct(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export function fmtZ(z: number) {
  const sign = z >= 0 ? '+' : ''
  return `${sign}${z.toFixed(1)}\u03C3`
}
