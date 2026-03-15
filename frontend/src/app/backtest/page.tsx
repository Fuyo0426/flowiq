'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell,
} from 'recharts'
import {
  getStoredAuth, clearAuth, fetchChip,
  type ChipRow, fmtNum, fmtPct,
} from '@/lib/api'
import AppNav from '@/components/AppNav'

/* ── signal detection helpers ─────────────────────────────────────────────── */

interface SignalEvent {
  date: string
  type: string
  foreign_net: number
  trigger_price: number | null
  latest_price: number | null
  pctChange: number | null
  effective: boolean
}

function detectSignals(rows: ChipRow[]): SignalEvent[] {
  if (rows.length === 0) return []
  const latestPrice = rows[rows.length - 1].close_price
  const events: SignalEvent[] = []

  let consecBuy = 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.foreign_net > 0) consecBuy++
    else consecBuy = 0

    // compute rolling z_score from last 5 foreign_net values
    let zScore = 0
    if (i >= 4) {
      const window = rows.slice(i - 4, i + 1).map(x => x.foreign_net)
      const mean = window.reduce((a, b) => a + b, 0) / window.length
      const std = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length) || 1
      zScore = (r.foreign_net - mean) / std
    }

    if (consecBuy === 3 || (consecBuy < 3 && zScore > 1.5)) {
      const pctChange = (r.close_price != null && latestPrice != null)
        ? ((latestPrice - r.close_price) / r.close_price) * 100
        : null
      events.push({
        date: r.date,
        type: consecBuy === 3 ? '悄悄進場' : '異常放量',
        foreign_net: r.foreign_net,
        trigger_price: r.close_price,
        latest_price: latestPrice,
        pctChange,
        effective: pctChange != null && pctChange > 0,
      })
    }
  }
  return events
}

/* ── example stocks ───────────────────────────────────────────────────────── */

const EXAMPLES = [
  { id: '2330', name: '台積電', desc: '全球晶圓代工龍頭' },
  { id: '2317', name: '鴻海', desc: '電子代工巨頭' },
  { id: '2454', name: '聯發科', desc: 'IC 設計領導者' },
]

/* ── page ──────────────────────────────────────────────────────────────────── */

export default function BacktestPage() {
  const router = useRouter()
  const [auth, setAuth] = useState<{ user: string; pass: string } | null>(null)
  const [stockInput, setStockInput] = useState('')
  const [stockId, setStockId] = useState('')
  const [chipData, setChipData] = useState<ChipRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const stored = getStoredAuth()
    if (!stored) { router.push('/'); return }
    setAuth(stored)
  }, [router])

  const loadStock = useCallback(async (id: string) => {
    if (!auth || !id.trim()) return
    const trimmed = id.trim()
    setStockId(trimmed)
    setStockInput(trimmed)
    setLoading(true)
    setError('')
    try {
      const rows = await fetchChip(auth, trimmed, 60)
      if (rows.length === 0) {
        setError('查無資料，請確認股票代號是否正確')
        setChipData([])
      } else {
        setChipData(rows.sort((a, b) => a.date.localeCompare(b.date)))
      }
    } catch {
      setError('資料載入失敗')
      setChipData([])
    } finally {
      setLoading(false)
    }
  }, [auth])

  function logout() { clearAuth(); router.push('/') }

  const signals = detectSignals(chipData)

  const effectiveCount = signals.filter(s => s.effective).length
  const winRate = signals.length > 0 ? (effectiveCount / signals.length) * 100 : 0
  const avgGain = signals.length > 0
    ? signals.reduce((sum, s) => sum + (s.pctChange ?? 0), 0) / signals.length
    : 0
  const maxGain = signals.length > 0
    ? Math.max(...signals.map(s => s.pctChange ?? 0))
    : 0

  const signalDates = new Set(signals.map(s => s.date))

  const chartData = chipData.map(r => ({
    date: r.date.slice(5),
    fullDate: r.date,
    foreign: Math.round(r.foreign_net / 1000),
    price: r.close_price,
  }))

  const dateRange = chipData.length > 0
    ? `${chipData[0].date} ~ ${chipData[chipData.length - 1].date}`
    : ''

  return (
    <div className="min-h-[100dvh] bg-[#f9fafb]">
      <AppNav onLogout={logout} />

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Title */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">歷史回測</h1>
          <p className="text-sm text-zinc-500 mt-1">選取個股，查看歷史訊號觸發時機與事後漲跌</p>
        </div>

        {/* Control Bar */}
        <div className="bg-white rounded-2xl border border-zinc-200/60 p-5 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)] mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <input
              type="text"
              value={stockInput}
              onChange={e => setStockInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') loadStock(stockInput) }}
              placeholder="輸入股票代號 e.g. 2330"
              className="num text-sm px-4 py-2.5 rounded-xl border border-zinc-200 bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 w-full sm:w-64 transition"
            />
            <button
              onClick={() => loadStock(stockInput)}
              disabled={loading}
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? '查詢中...' : '查詢'}
            </button>
          </div>

          {dateRange && (
            <div className="mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200/60 rounded-xl text-xs text-amber-700">
              目前資料涵蓋 {chipData.length} 個交易日（{dateRange}），更多歷史資料建置中
            </div>
          )}

          {error && (
            <div className="mt-3 px-4 py-2.5 bg-red-50 border border-red-200/60 rounded-xl text-xs text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* Default State: Example Cards */}
        {!stockId && !loading && (
          <div className="mb-8">
            <p className="text-sm text-zinc-500 mb-4">點擊範例快速查看回測結果</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {EXAMPLES.map((ex, i) => (
                <motion.button
                  key={ex.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  onClick={() => loadStock(ex.id)}
                  className="text-left bg-white rounded-2xl border border-zinc-200/60 p-6 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)] hover:border-blue-300 hover:shadow-[0_4px_24px_-4px_rgba(37,99,235,0.12)] transition cursor-pointer"
                >
                  <span className="num text-lg font-bold text-zinc-900">{ex.id}</span>
                  <span className="text-sm text-zinc-500 ml-2">{ex.name}</span>
                  <p className="text-xs text-zinc-400 mt-2">{ex.desc}</p>
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* Chart Area */}
        {stockId && chipData.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl border border-zinc-200/60 p-6 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)] mb-6"
          >
            <div className="flex items-baseline gap-2 mb-4">
              <h3 className="text-sm font-medium text-zinc-700">外資淨買超 vs 股價</h3>
              <span className="num text-xs text-zinc-400">{stockId}</span>
            </div>

            {loading ? (
              <div className="h-[300px] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 10, fill: '#a1a1aa', fontFamily: 'var(--font-geist-mono)' }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: '淨買超(K)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#a1a1aa' } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: '#93c5fd', fontFamily: 'var(--font-geist-mono)' }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: '股價', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#93c5fd' } }}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: '1px solid #e4e4e7',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                    }}
                    formatter={(v: unknown, name: unknown) => [
                      name === 'price' ? `NT$ ${Number(v)?.toLocaleString()}` : `${Number(v).toLocaleString()}K`,
                      name === 'price' ? '股價' : '外資淨買超',
                    ]}
                  />
                  <ReferenceLine yAxisId="left" y={0} stroke="#e4e4e7" />

                  {/* Signal trigger markers */}
                  {chartData.map((d) =>
                    signalDates.has(d.fullDate) ? (
                      <ReferenceLine
                        key={d.fullDate}
                        yAxisId="left"
                        x={d.date}
                        stroke="#2563eb"
                        strokeDasharray="4 3"
                        strokeWidth={1.5}
                        label={{ value: '訊號', position: 'top', fill: '#2563eb', fontSize: 10 }}
                      />
                    ) : null
                  )}

                  <Bar dataKey="foreign" yAxisId="left" radius={[3, 3, 0, 0]} barSize={16}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.foreign >= 0 ? '#ef4444' : '#22c55e'} />
                    ))}
                  </Bar>
                  <Line
                    dataKey="price"
                    yAxisId="right"
                    type="monotone"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </motion.div>
        )}

        {/* Win Rate Summary Cards */}
        {stockId && signals.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: '訊號觸發次數', value: `${signals.length}次` },
              { label: '有效訊號', value: `${effectiveCount}次 (${winRate.toFixed(0)}%)` },
              { label: '平均漲幅', value: fmtPct(avgGain) },
              { label: '最大單次漲幅', value: fmtPct(maxGain) },
            ].map((card, i) => (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="bg-white rounded-2xl border border-zinc-200/60 p-5 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]"
              >
                <div className="num text-2xl font-bold text-zinc-900 tracking-tight">{card.value}</div>
                <div className="text-xs text-zinc-500 mt-1">{card.label}</div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Signal Events Table */}
        {stockId && chipData.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl border border-zinc-200/60 overflow-hidden shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]"
          >
            <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50">
              <span className="text-xs font-medium text-zinc-500">訊號事件紀錄</span>
            </div>

            {signals.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-400">
                此期間未偵測到訊號觸發事件
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100">
                      {['觸發日', '訊號類型', '外資淨買', '觸發時股價', '最新股價', '漲跌幅', '評估'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {signals.map((s, i) => (
                        <motion.tr
                          key={s.date + s.type}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.03 }}
                          className={i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'}
                        >
                          <td className="num px-4 py-2.5 text-zinc-700 whitespace-nowrap">{s.date}</td>
                          <td className="px-4 py-2.5">
                            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs font-medium">
                              {s.type}
                            </span>
                          </td>
                          <td className="num px-4 py-2.5 text-zinc-700">{fmtNum(Math.round(s.foreign_net / 1000))}K</td>
                          <td className="num px-4 py-2.5 text-zinc-700">{s.trigger_price?.toLocaleString() ?? '\u2014'}</td>
                          <td className="num px-4 py-2.5 text-zinc-700">{s.latest_price?.toLocaleString() ?? '\u2014'}</td>
                          <td className={`num px-4 py-2.5 font-medium ${(s.pctChange ?? 0) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {s.pctChange != null ? fmtPct(s.pctChange) : '\u2014'}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                              s.effective
                                ? 'bg-green-50 text-green-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}>
                              {s.effective ? '有效' : '待觀察'}
                            </span>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}
      </main>
    </div>
  )
}
