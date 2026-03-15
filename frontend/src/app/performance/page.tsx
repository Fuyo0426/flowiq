'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, ReferenceLine,
} from 'recharts'
import {
  getStoredAuth, clearAuth, fetchSignals, fetchStocks,
  type SignalRow, fmtPct, fmtZ, ApiError,
} from '@/lib/api'
import AppNav from '@/components/AppNav'

/* ── signal type labels ───────────────────────────────────────────────────── */

const SIGNAL_LABELS: Record<string, string> = {
  triple_arrow: '三箭齊發',
  stealth_entry: '悄悄進場',
  trust_push: '投信推力',
  retail_chase: '散戶追漲',
  normal: '一般',
}

const LIGHT_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  red: { bg: 'bg-red-50', text: 'text-red-600', label: '強' },
  yellow: { bg: 'bg-amber-50', text: 'text-amber-600', label: '中' },
  gray: { bg: 'bg-zinc-100', text: 'text-zinc-500', label: '弱' },
}

/* ── sort helpers ─────────────────────────────────────────────────────────── */

type SortKey = 'z_score' | 'consec_buy' | 'pct5' | 'score'
type SortDir = 'asc' | 'desc'

/* ── page ──────────────────────────────────────────────────────────────────── */

export default function PerformancePage() {
  const router = useRouter()
  const [auth, setAuth] = useState<{ user: string; pass: string } | null>(null)
  const [signals, setSignals] = useState<SignalRow[]>([])
  const [signalDate, setSignalDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [stockNames, setStockNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const stored = getStoredAuth()
    if (!stored) { router.push('/'); return }
    setAuth(stored)
  }, [router])

  useEffect(() => {
    if (!auth) return
    setLoading(true)
    Promise.all([
      fetchSignals(auth, 100),
      fetchStocks(auth),
    ])
      .then(([res, names]) => {
        setSignals(res.data)
        setSignalDate(res.date)
        setStockNames(names)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearAuth(); router.push('/')
        } else {
          setError('資料載入失敗，請確認後端服務是否正常')
        }
      })
      .finally(() => setLoading(false))
  }, [auth, router])

  function logout() { clearAuth(); router.push('/') }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  /* ── computed stats ─────────────────────────────────────────────────────── */

  const top20 = useMemo(() => signals.slice(0, 20), [signals])

  const totalCount = signals.length
  const redCount = signals.filter(s => s.light === 'red').length
  const tripleArrowCount = signals.filter(s => s.signal_type === 'triple_arrow').length
  const avgZscore = top20.length > 0
    ? top20.reduce((sum, s) => sum + s.z_score, 0) / top20.length
    : 0

  /* ── win rate by signal type ────────────────────────────────────────────── */

  const winRateData = useMemo(() => {
    const types = ['triple_arrow', 'stealth_entry', 'trust_push', 'normal'] as const
    return types.map(t => {
      const group = signals.filter(s => s.signal_type === t)
      const wins = group.filter(s => s.pct5 > 0).length
      const rate = group.length > 0 ? (wins / group.length) * 100 : 0
      return {
        type: SIGNAL_LABELS[t] || t,
        winRate: Math.round(rate),
        count: group.length,
      }
    }).filter(d => d.count > 0)
  }, [signals])

  /* ── z-score distribution ───────────────────────────────────────────────── */

  const zDistData = useMemo(() => {
    const bins: { range: string; center: number; count: number }[] = []
    for (let z = -3; z < 3; z += 0.5) {
      const lo = z
      const hi = z + 0.5
      const count = signals.filter(s => s.z_score >= lo && s.z_score < hi).length
      bins.push({
        range: `${lo.toFixed(1)}`,
        center: lo + 0.25,
        count,
      })
    }
    return bins
  }, [signals])

  /* ── sorted table data ──────────────────────────────────────────────────── */

  const sortedTop20 = useMemo(() => {
    const copy = [...top20]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })
    return copy
  }, [top20, sortKey, sortDir])

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortDir === 'desc' ? ' \u2193' : ' \u2191'
  }

  return (
    <div className="min-h-[100dvh] bg-[#f9fafb]">
      <AppNav date={signalDate} onLogout={logout} />

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Title */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">訊號勝率儀表板</h1>
          <p className="text-sm text-zinc-500 mt-1">追蹤歷史訊號觸發後的市場表現</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200/60 rounded-2xl px-5 py-4 text-sm text-red-600">
            {error}
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: '今日偵測訊號', value: `${totalCount}`, sub: '檔' },
                { label: '強訊號（紅燈）', value: `${redCount}`, sub: '檔' },
                { label: '平均異常程度', value: `${avgZscore.toFixed(1)}\u03C3`, sub: 'Top 20' },
                { label: '三箭齊發', value: `${tripleArrowCount}`, sub: '檔' },
              ].map((card, i) => (
                <motion.div
                  key={card.label}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="bg-white rounded-2xl border border-zinc-200/60 p-6 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]"
                >
                  <div className="num text-3xl font-bold text-zinc-900 tracking-tight">
                    {card.value}
                    <span className="text-sm font-normal text-zinc-400 ml-1">{card.sub}</span>
                  </div>
                  <div className="text-sm text-zinc-500 mt-1">{card.label}</div>
                </motion.div>
              ))}
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Win Rate by Signal Type */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white rounded-2xl border border-zinc-200/60 p-6 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]"
              >
                <h3 className="text-sm font-medium text-zinc-700 mb-4">各訊號類型勝率</h3>
                {winRateData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart
                        data={winRateData}
                        layout="vertical"
                        margin={{ top: 0, right: 16, left: 16, bottom: 0 }}
                      >
                        <XAxis
                          type="number"
                          domain={[0, 100]}
                          tick={{ fontSize: 10, fill: '#a1a1aa' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={v => `${v}%`}
                        />
                        <YAxis
                          type="category"
                          dataKey="type"
                          tick={{ fontSize: 12, fill: '#52525b' }}
                          axisLine={false}
                          tickLine={false}
                          width={80}
                        />
                        <Tooltip
                          contentStyle={{
                            fontSize: 12,
                            borderRadius: 8,
                            border: '1px solid #e4e4e7',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                          }}
                          formatter={(v: unknown) => [`${Number(v)}%`, '勝率']}
                        />
                        <Bar dataKey="winRate" radius={[0, 4, 4, 0]} barSize={20}>
                          {winRateData.map((entry, i) => (
                            <Cell key={i} fill={entry.winRate >= 60 ? '#22c55e' : entry.winRate >= 40 ? '#eab308' : '#ef4444'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-zinc-400 mt-3">
                      * 勝率基於近期 {signals.length} 個訊號資料計算，建議累積更多歷史資料以提高可靠性
                    </p>
                  </>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-sm text-zinc-400">
                    無足夠資料
                  </div>
                )}
              </motion.div>

              {/* Z-score Distribution */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-white rounded-2xl border border-zinc-200/60 p-6 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)]"
              >
                <h3 className="text-sm font-medium text-zinc-700 mb-4">Z-score 分佈</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={zDistData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <XAxis
                      dataKey="range"
                      tick={{ fontSize: 10, fill: '#a1a1aa', fontFamily: 'var(--font-geist-mono)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#a1a1aa' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 8,
                        border: '1px solid #e4e4e7',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                      }}
                      formatter={(v: unknown) => [`${Number(v)} 檔`, '數量']}
                    />
                    <ReferenceLine x="-2.0" stroke="#ef4444" strokeDasharray="4 3" label={{ value: '-2\u03C3', fill: '#ef4444', fontSize: 10 }} />
                    <ReferenceLine x="2.0" stroke="#ef4444" strokeDasharray="4 3" label={{ value: '2\u03C3', fill: '#ef4444', fontSize: 10 }} />
                    <Area
                      dataKey="count"
                      type="monotone"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="#dbeafe"
                      fillOpacity={0.6}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </motion.div>
            </div>

            {/* Recent Signals Tracking Table */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl border border-zinc-200/60 overflow-hidden shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)] mb-6"
            >
              <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-500">訊號追蹤紀錄 (Top 20)</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100">
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 w-10">#</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">代號 / 名稱</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">訊號類型</th>
                      <th
                        className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 cursor-pointer hover:text-zinc-700 select-none"
                        onClick={() => toggleSort('z_score')}
                      >
                        Z-score{sortIcon('z_score')}
                      </th>
                      <th
                        className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 cursor-pointer hover:text-zinc-700 select-none"
                        onClick={() => toggleSort('consec_buy')}
                      >
                        連買{sortIcon('consec_buy')}
                      </th>
                      <th
                        className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 cursor-pointer hover:text-zinc-700 select-none"
                        onClick={() => toggleSort('pct5')}
                      >
                        5日漲跌{sortIcon('pct5')}
                      </th>
                      <th
                        className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 cursor-pointer hover:text-zinc-700 select-none"
                        onClick={() => toggleSort('score')}
                      >
                        評分{sortIcon('score')}
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">強度</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {sortedTop20.map((s, i) => {
                        const ls = LIGHT_STYLES[s.light] || LIGHT_STYLES.gray
                        return (
                          <motion.tr
                            key={s.stock_id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: i * 0.02 }}
                            className={i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'}
                          >
                            <td className="num px-4 py-2.5 text-zinc-400 text-xs">{i + 1}</td>
                            <td className="px-4 py-2.5">
                              <span className="num text-zinc-900 font-medium">{s.stock_id}</span>
                              {stockNames[s.stock_id] && (
                                <span className="text-xs text-zinc-400 ml-1.5">{stockNames[s.stock_id]}</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs font-medium">
                                {SIGNAL_LABELS[s.signal_type] || s.signal_type}
                              </span>
                            </td>
                            <td className="num px-4 py-2.5 text-zinc-700">{fmtZ(s.z_score)}</td>
                            <td className="num px-4 py-2.5 text-zinc-700">{s.consec_buy}日</td>
                            <td className={`num px-4 py-2.5 font-medium ${s.pct5 >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {fmtPct(s.pct5)}
                            </td>
                            <td className="num px-4 py-2.5">
                              <span className="bg-zinc-900 text-white text-xs font-mono px-2 py-0.5 rounded-md">
                                {s.score}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${ls.bg} ${ls.text}`}>
                                {ls.label}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <Link
                                href={`/stock/${s.stock_id}`}
                                className="text-xs px-2.5 py-1 rounded-md bg-zinc-100 text-zinc-600 hover:bg-blue-50 hover:text-blue-600 transition whitespace-nowrap"
                              >
                                分析
                              </Link>
                            </td>
                          </motion.tr>
                        )
                      })}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </motion.div>

            {/* Data Limitation Notice */}
            <div className="px-5 py-3.5 bg-amber-50 border border-amber-200/60 rounded-2xl text-xs text-amber-700">
              目前資料僅涵蓋有限交易日。回測準確性隨資料增加而提升，建議在資料庫達到 60+ 個交易日後作為主要決策依據。
            </div>
          </>
        )}
      </main>
    </div>
  )
}
