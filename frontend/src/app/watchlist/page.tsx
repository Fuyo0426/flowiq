'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { MagnifyingGlass, X as XIcon } from '@phosphor-icons/react'
import {
  getStoredAuth, clearAuth, fetchChip, fetchStocks,
  type ChipRow, fmt,
} from '@/lib/api'
import AppNav from '@/components/AppNav'

/* ── Sparkline ────────────────────────────────────────────────────────────── */

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 80, h = 30, pad = 2
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return `${x},${y}`
  })
  const trend = values[values.length - 1] > values[0]
  return (
    <svg width={w} height={h}>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={trend ? '#ef4444' : '#22c55e'}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* ── localStorage helpers ─────────────────────────────────────────────────── */

const WL_KEY = 'fiq_watchlist'

function readWatchlist(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(WL_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeWatchlist(ids: string[]) {
  localStorage.setItem(WL_KEY, JSON.stringify(ids))
}

/* ── types ────────────────────────────────────────────────────────────────── */

interface WatchCard {
  stock_id: string
  inst_net: number
  close_price: number | null
  prices: number[]
  loading: boolean
}

/* ── page ──────────────────────────────────────────────────────────────────── */

export default function WatchlistPage() {
  const router = useRouter()
  const [auth, setAuth] = useState<{ user: string; pass: string } | null>(null)
  const [watchlist, setWatchlist] = useState<string[]>([])
  const [cards, setCards] = useState<Record<string, WatchCard>>({})
  const [stockNames, setStockNames] = useState<Record<string, string>>({})
  const [addInput, setAddInput] = useState('')
  const [toast, setToast] = useState('')

  // alert settings (display only)
  const [alertDaily, setAlertDaily] = useState(true)
  const [alertSignal, setAlertSignal] = useState(true)
  const [alertThreshold, setAlertThreshold] = useState('1000')
  const [alertZscore, setAlertZscore] = useState('1.5')

  useEffect(() => {
    const stored = getStoredAuth()
    if (!stored) { router.push('/'); return }
    setAuth(stored)
    setWatchlist(readWatchlist())
  }, [router])

  useEffect(() => {
    if (!auth) return
    fetchStocks(auth).then(setStockNames).catch(() => {})
  }, [auth])

  const fetchCardData = useCallback(async (id: string) => {
    if (!auth) return
    setCards(prev => ({ ...prev, [id]: { stock_id: id, inst_net: 0, close_price: null, prices: [], loading: true } }))
    try {
      const rows = await fetchChip(auth, id, 10)
      const sorted = rows.sort((a: ChipRow, b: ChipRow) => a.date.localeCompare(b.date))
      const latest = sorted[sorted.length - 1]
      const prices = sorted
        .slice(-5)
        .map((r: ChipRow) => r.close_price)
        .filter((p): p is number => p != null)

      setCards(prev => ({
        ...prev,
        [id]: {
          stock_id: id,
          inst_net: latest?.inst_net ?? 0,
          close_price: latest?.close_price ?? null,
          prices,
          loading: false,
        },
      }))
    } catch {
      setCards(prev => ({
        ...prev,
        [id]: { stock_id: id, inst_net: 0, close_price: null, prices: [], loading: false },
      }))
    }
  }, [auth])

  // fetch data for each watchlist item
  useEffect(() => {
    if (!auth) return
    watchlist.forEach(id => {
      if (!cards[id]) fetchCardData(id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, watchlist])

  function addStock() {
    const id = addInput.trim()
    if (!id) return
    if (watchlist.includes(id)) {
      showToast('已在自選股清單中')
      return
    }
    const next = [...watchlist, id]
    setWatchlist(next)
    writeWatchlist(next)
    setAddInput('')
    fetchCardData(id)
  }

  function removeStock(id: string) {
    const next = watchlist.filter(s => s !== id)
    setWatchlist(next)
    writeWatchlist(next)
    setCards(prev => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  function logout() { clearAuth(); router.push('/') }

  return (
    <div className="min-h-[100dvh] bg-[#f9fafb]">
      <AppNav onLogout={logout} />

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Title */}
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">自選股清單</h1>
          {watchlist.length > 0 && (
            <span className="num text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
              {watchlist.length}
            </span>
          )}
        </div>

        {/* Add Stock Input */}
        <div className="bg-white rounded-2xl border border-zinc-200/60 p-5 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)] mb-6">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={addInput}
              onChange={e => setAddInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addStock() }}
              placeholder="輸入代號加入自選股"
              className="num text-sm px-4 py-2.5 rounded-xl border border-zinc-200 bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 w-full sm:w-64 transition"
            />
            <button
              onClick={addStock}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition whitespace-nowrap"
            >
              加入
            </button>
          </div>
        </div>

        {/* Empty State */}
        {watchlist.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl border border-zinc-200/60 p-16 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)] text-center"
          >
            <MagnifyingGlass weight="duotone" size={48} className="mx-auto text-zinc-300 mb-4" />
            <p className="text-zinc-600 font-medium">自選股清單為空</p>
            <p className="text-sm text-zinc-400 mt-1">在訊號排行頁點擊加入追蹤，或在上方輸入股票代號</p>
          </motion.div>
        )}

        {/* Watchlist Grid */}
        {watchlist.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <AnimatePresence>
              {watchlist.map((id, i) => {
                const card = cards[id]
                return (
                  <motion.div
                    key={id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: i * 0.04 }}
                    className="relative bg-white rounded-2xl border border-zinc-200/60 p-5 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)] hover:border-blue-300 hover:shadow-[0_4px_24px_-4px_rgba(37,99,235,0.12)] transition group"
                  >
                    {/* Remove button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeStock(id) }}
                      className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition"
                    >
                      <XIcon size={14} weight="bold" />
                    </button>

                    <Link href={`/stock/${id}`} className="block">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="num text-lg font-bold text-zinc-900">{id}</span>
                          {stockNames[id] && (
                            <span className="text-sm text-zinc-500 ml-1.5">{stockNames[id]}</span>
                          )}
                        </div>
                        {card && !card.loading && (
                          <Sparkline values={card.prices} />
                        )}
                      </div>

                      {card?.loading ? (
                        <div className="flex gap-4">
                          <div className="w-24 h-4 bg-zinc-100 rounded animate-pulse" />
                          <div className="w-16 h-4 bg-zinc-100 rounded animate-pulse" />
                        </div>
                      ) : card ? (
                        <div className="flex items-center gap-4">
                          <div>
                            <span className="text-xs text-zinc-400">收盤</span>
                            <span className="num text-sm font-medium text-zinc-700 ml-1.5">
                              {card.close_price != null ? `NT$ ${card.close_price.toLocaleString()}` : '\u2014'}
                            </span>
                          </div>
                          <div>
                            <span className="text-xs text-zinc-400">三大法人</span>
                            <span className={`num text-sm font-medium ml-1.5 ${
                              card.inst_net >= 0 ? 'text-red-600' : 'text-green-600'
                            }`}>
                              {card.inst_net >= 0 ? '+' : ''}{fmt(card.inst_net)}
                            </span>
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center justify-between">
                        <span className="text-xs text-blue-600 font-medium">深度分析</span>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-blue-600">
                          <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}

        {/* Alert Settings */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white rounded-2xl border border-zinc-200/60 p-6 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]"
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">推播設定</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Line Notify 整合開發中</p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Toggle: Daily */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-zinc-700">每日收盤通知</span>
                <span className="text-xs text-zinc-400 ml-2">(16:30)</span>
              </div>
              <button
                onClick={() => setAlertDaily(!alertDaily)}
                className={`relative w-10 h-5 rounded-full transition ${alertDaily ? 'bg-blue-600' : 'bg-zinc-200'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition ${alertDaily ? 'left-5.5' : 'left-0.5'}`}
                  style={{ left: alertDaily ? 22 : 2 }}
                />
              </button>
            </div>

            {/* Toggle: Signal */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-700">訊號觸發即時通知</span>
              <button
                onClick={() => setAlertSignal(!alertSignal)}
                className={`relative w-10 h-5 rounded-full transition ${alertSignal ? 'bg-blue-600' : 'bg-zinc-200'}`}
              >
                <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition"
                  style={{ left: alertSignal ? 22 : 2 }}
                />
              </button>
            </div>

            <div className="h-px bg-zinc-100" />

            {/* Threshold inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">外資買超門檻（張）</label>
                <input
                  type="text"
                  value={alertThreshold}
                  onChange={e => setAlertThreshold(e.target.value)}
                  className="num text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 w-full transition"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Z-score 門檻</label>
                <input
                  type="text"
                  value={alertZscore}
                  onChange={e => setAlertZscore(e.target.value)}
                  className="num text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 w-full transition"
                />
              </div>
            </div>

            <button
              onClick={() => showToast('功能開發中')}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition"
            >
              儲存設定
            </button>
          </div>
        </motion.div>
      </main>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-zinc-900 text-white text-sm rounded-xl shadow-lg z-50"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
