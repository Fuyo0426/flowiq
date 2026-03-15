'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts'
import {
  getStoredAuth, clearAuth, fetchSummary, fetchChip, fetchStocks,
  type ChipRow, fmt,
} from '@/lib/api'
import AppNav from '@/components/AppNav'

// ── helpers ──────────────────────────────────────────────────────────────────
function NetBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="num text-xs text-zinc-300">{'\u2014'}</span>
  const pos = value >= 0
  return (
    <span className={`num text-xs font-medium px-1.5 py-0.5 rounded ${pos ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
      {pos ? '+' : ''}{fmt(value)}
    </span>
  )
}

function SkelRow() {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-zinc-100 animate-pulse">
      <div className="w-20 h-4 bg-zinc-200 rounded" />
      <div className="flex-1 h-4 bg-zinc-100 rounded" />
      <div className="w-16 h-4 bg-zinc-200 rounded" />
      <div className="w-16 h-4 bg-zinc-100 rounded" />
      <div className="w-16 h-4 bg-zinc-200 rounded" />
      <div className="w-14 h-4 bg-zinc-100 rounded" />
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()
  const [auth, setAuth] = useState<{ user: string; pass: string } | null>(null)
  const [summary, setSummary] = useState<ChipRow[]>([])
  const [summaryDate, setSummaryDate] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChipRow[]>([])
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [search, setSearch] = useState('')
  const [stockNames, setStockNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const stored = getStoredAuth()
    if (!stored) { router.push('/'); return }
    setAuth(stored)
  }, [router])

  useEffect(() => {
    if (!auth) return

    setLoadingSummary(true)
    fetchSummary(auth, 50)
      .then(res => { setSummary(res.data); setSummaryDate(res.date) })
      .catch(() => { clearAuth(); router.push('/') })
      .finally(() => setLoadingSummary(false))

    fetchStocks(auth)
      .then(names => setStockNames(names))
      .catch(() => {})
  }, [auth, router])

  const loadDetail = useCallback(async (stockId: string) => {
    if (!auth) return
    setSelected(stockId)
    setLoadingDetail(true)
    try {
      const rows = await fetchChip(auth, stockId, 20)
      setDetail(rows.reverse())
    } finally {
      setLoadingDetail(false)
    }
  }, [auth])

  function logout() { clearAuth(); router.push('/') }

  function handleSearch(q: string) {
    setSearch(q)
  }

  const filtered = summary.filter(r =>
    search === '' || r.stock_id.includes(search) || (stockNames[r.stock_id] || '').includes(search)
  )

  const chartData = detail.map(r => ({
    date: r.date.slice(5),
    inst: Math.round(r.inst_net / 1000),
    foreign: Math.round(r.foreign_net / 1000),
    trust: Math.round(r.trust_net / 1000),
    price: r.close_price,
  }))

  return (
    <div className="min-h-[100dvh] bg-[#f9fafb]">
      <AppNav date={summaryDate} onSearch={handleSearch} onLogout={logout} />

      <main className="max-w-[1400px] mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8">

        {/* Left: Summary Table */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-zinc-900 tracking-tight">三大法人買超排行</h2>
              <p className="text-xs text-zinc-500 mt-0.5">點擊個股查看籌碼趨勢</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200/60 overflow-hidden shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]">
            {/* Table header */}
            <div className="grid grid-cols-[minmax(100px,1.2fr)_1fr_1fr_1fr_1fr_70px] gap-2 px-5 py-2.5 border-b border-zinc-100 bg-zinc-50">
              {['代號+名稱', '三大合計', '外資', '投信', '自營', '操作'].map(h => (
                <span key={h} className="text-xs font-medium text-zinc-500">{h}</span>
              ))}
            </div>

            {loadingSummary
              ? Array.from({ length: 12 }).map((_, i) => <SkelRow key={i} />)
              : (
                <AnimatePresence>
                  {filtered.map((row, i) => (
                    <motion.div
                      key={row.stock_id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      onClick={() => loadDetail(row.stock_id)}
                      className={`grid grid-cols-[minmax(100px,1.2fr)_1fr_1fr_1fr_1fr_70px] gap-2 px-5 py-3 border-b border-zinc-100 cursor-pointer hover:bg-blue-50/60 transition ${selected === row.stock_id ? 'bg-blue-50' : ''}`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="num text-sm font-medium text-zinc-700">{row.stock_id}</span>
                        {stockNames[row.stock_id] && (
                          <span className="text-xs text-zinc-400 truncate">{stockNames[row.stock_id]}</span>
                        )}
                      </span>
                      <NetBadge value={row.inst_net} />
                      <NetBadge value={row.foreign_net} />
                      <NetBadge value={row.trust_net} />
                      <NetBadge value={row.dealer_net} />
                      <Link
                        href={`/stock/${row.stock_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs px-2 py-1 rounded-md bg-zinc-100 text-zinc-600 hover:bg-blue-50 hover:text-blue-600 transition text-center whitespace-nowrap"
                      >
                        深度分析
                      </Link>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )
            }
          </div>
        </section>

        {/* Right: Detail Panel */}
        <section className="flex flex-col gap-6">
          {/* Stock Header */}
          <div className="bg-white rounded-2xl border border-zinc-200/60 p-6 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]">
            {selected ? (
              <>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="flex items-baseline gap-2">
                    <span className="num text-2xl font-bold text-zinc-900 tracking-tight">{selected}</span>
                    {stockNames[selected] && (
                      <span className="text-sm text-zinc-500">{stockNames[selected]}</span>
                    )}
                  </div>
                  {detail[detail.length - 1]?.close_price && (
                    <span className="num text-lg text-zinc-600">
                      NT$ {detail[detail.length - 1].close_price?.toFixed(1)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400">近 20 個交易日籌碼走勢</p>
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-zinc-400 text-sm">選擇左側個股查看詳情</p>
              </div>
            )}
          </div>

          {/* Chart */}
          {selected && (
            <div className="bg-white rounded-2xl border border-zinc-200/60 p-6 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]">
              <h3 className="text-sm font-medium text-zinc-700 mb-4">三大法人淨買超（千股）</h3>
              {loadingDetail ? (
                <div className="h-48 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#a1a1aa', fontFamily: 'var(--font-geist-mono)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}
                      formatter={(v: unknown) => [`${Number(v).toLocaleString()}K`, '']}
                    />
                    <ReferenceLine y={0} stroke="#e4e4e7" />
                    <Bar dataKey="inst" radius={[3, 3, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.inst >= 0 ? '#ef4444' : '#22c55e'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Detail Table */}
          {selected && !loadingDetail && detail.length > 0 && (
            <div className="bg-white rounded-2xl border border-zinc-200/60 overflow-hidden shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]">
              <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50">
                <span className="text-xs font-medium text-zinc-500">原始資料</span>
              </div>
              <div className="divide-y divide-zinc-100 max-h-64 overflow-y-auto">
                {[...detail].reverse().map(r => (
                  <div key={r.date} className="px-5 py-2.5 grid grid-cols-[80px_1fr_1fr] gap-2 text-xs">
                    <span className="num text-zinc-500">{r.date.slice(5)}</span>
                    <span>
                      <span className="text-zinc-400 mr-1">外資</span>
                      <NetBadge value={r.foreign_net} />
                    </span>
                    <span>
                      <span className="text-zinc-400 mr-1">融資</span>
                      <span className="num">{r.margin_balance.toLocaleString()}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
