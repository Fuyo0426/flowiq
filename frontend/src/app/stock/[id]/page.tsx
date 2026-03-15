'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ComposedChart, BarChart as RBarChart, AreaChart, LineChart,
  Bar, Line, Area, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell, Legend,
} from 'recharts'
import {
  ArrowLeft, TrendUp, TrendDown, Lightning, Users,
} from '@phosphor-icons/react'
import AppNav from '@/components/AppNav'
import {
  getStoredAuth, clearAuth, fetchChip, fetchStockStats, fetchStocks,
  type ChipRow, type StockStats, fmt, fmtPct, fmtZ,
} from '@/lib/api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeMA(data: (number | null)[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null
    const slice = data.slice(i - period + 1, i + 1).filter((v): v is number => v != null)
    return slice.length === period ? slice.reduce((a, b) => a + b, 0) / period : null
  })
}

function findConsecBuyStarts(rows: ChipRow[], minStreak: number): Set<string> {
  const triggers = new Set<string>()
  let streak = 0
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].foreign_net > 0) {
      streak++
      if (streak === minStreak) {
        triggers.add(rows[i - minStreak + 1].date)
      }
    } else {
      streak = 0
    }
  }
  return triggers
}

function chipColor(v: number): string {
  return v >= 0 ? '#ef4444' : '#22c55e'
}

function fmtK(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${(n / 1000).toFixed(0)}K`
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, color, icon: Icon, delay,
}: {
  label: string
  value: string
  sub?: string
  color: string
  icon: React.ElementType
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-white rounded-2xl border border-zinc-200/60 p-5 hover:scale-[1.01] transition-transform cursor-default"
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon weight="duotone" size={16} className="text-zinc-400" />
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <p className={`font-mono text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="font-mono text-xs text-zinc-400 mt-1">{sub}</p>}
    </motion.div>
  )
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-zinc-200/60 p-5 animate-pulse">
          <div className="w-20 h-3 bg-zinc-200 rounded mb-3" />
          <div className="w-16 h-6 bg-zinc-200 rounded" />
        </div>
      ))}
    </div>
  )
}

function SkeletonChart() {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200/60 p-6 animate-pulse">
      <div className="w-32 h-4 bg-zinc-200 rounded mb-4" />
      <div className="w-full h-[320px] bg-zinc-100 rounded-lg" />
    </div>
  )
}

// ── Custom Tooltip ───────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  name: string
  value: number
  color: string
}

function MainTooltip({
  active, payload, label,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="bg-white border border-zinc-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-zinc-700 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-zinc-500">{p.name}:</span>
          <span className="font-mono font-medium text-zinc-800">
            {p.name === '\u5916\u8CC7\u6DE8\u8CB7\u8D85' ? `${p.value >= 0 ? '+' : ''}${p.value}K` : p.value?.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Tab types ────────────────────────────────────────────────────────────────

type SubTab = 'inst' | 'cumulative' | 'margin'

// ── Main Page ────────────────────────────────────────────────────────────────

export default function StockDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string

  const [auth, setAuth] = useState<{ user: string; pass: string } | null>(null)
  const [stats, setStats] = useState<StockStats | null>(null)
  const [chip, setChip] = useState<ChipRow[]>([])
  const [stockName, setStockName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [subTab, setSubTab] = useState<SubTab>('inst')

  // Auth check
  useEffect(() => {
    const stored = getStoredAuth()
    if (!stored) { router.push('/'); return }
    setAuth(stored)
  }, [router])

  // Data fetch
  useEffect(() => {
    if (!auth || !id) return
    setLoading(true)
    setError(false)

    Promise.all([
      fetchStockStats(auth, id),
      fetchChip(auth, id, 60),
      fetchStocks(auth),
    ])
      .then(([statsRes, chipRes, stocksMap]) => {
        setStats(statsRes)
        setChip(chipRes.sort((a, b) => a.date.localeCompare(b.date)))
        setStockName(stocksMap[id] || '')
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [auth, id])

  const logout = useCallback(() => {
    clearAuth()
    router.push('/')
  }, [router])

  // ── Computed chart data ──────────────────────────────────────────────────

  const mainChartData = useMemo(() => {
    if (!chip.length) return []
    const prices = chip.map((r) => r.close_price)
    const ma5 = computeMA(prices, 5)
    const ma20 = computeMA(prices, 20)
    return chip.map((r, i) => ({
      date: r.date.slice(5),
      fullDate: r.date,
      foreign_net: Math.round(r.foreign_net / 1000),
      close_price: r.close_price,
      ma5: ma5[i] != null ? Math.round(ma5[i]! * 10) / 10 : null,
      ma20: ma20[i] != null ? Math.round(ma20[i]! * 10) / 10 : null,
    }))
  }, [chip])

  const signalDates = useMemo(() => findConsecBuyStarts(chip, 3), [chip])

  const instChartData = useMemo(() => {
    return chip.map((r) => ({
      date: r.date.slice(5),
      foreign: Math.round(r.foreign_net / 1000),
      trust: Math.round(r.trust_net / 1000),
      dealer: Math.round(r.dealer_net / 1000),
    }))
  }, [chip])

  const cumChartData = useMemo(() => {
    let cumSum = 0
    return chip.map((r) => {
      cumSum += r.inst_net
      return {
        date: r.date.slice(5),
        cumulative: Math.round(cumSum / 1000),
      }
    })
  }, [chip])

  const marginChartData = useMemo(() => {
    return chip.map((r) => ({
      date: r.date.slice(5),
      margin: Math.round(r.margin_balance / 1000),
      short: Math.round(r.short_balance / 1000),
    }))
  }, [chip])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!auth) return null

  if (error) {
    return (
      <div className="min-h-[100dvh] bg-[#f9fafb]">
        <AppNav onLogout={logout} />
        <div className="max-w-[1400px] mx-auto px-6 py-20 text-center">
          <p className="text-zinc-500 text-lg mb-4">
            {'\u80A1\u7968\u4EE3\u865F\u4E0D\u5B58\u5728\u6216\u7121\u8CC7\u6599'}
          </p>
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
          >
            <ArrowLeft weight="duotone" size={16} />
            {'\u8FD4\u56DE'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-[#f9fafb]">
      <AppNav date={stats?.latest_date} onLogout={logout} />

      <main className="max-w-[1400px] mx-auto px-6 py-6 flex flex-col gap-6">

        {/* Breadcrumb + back */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 transition"
          >
            <ArrowLeft weight="duotone" size={16} />
            <span>{'\u8FD4\u56DE'}</span>
          </button>
          <span className="text-zinc-300">/</span>
          <span className="text-sm text-zinc-400">
            {'\u8A0A\u865F\u6392\u884C'}
          </span>
          <span className="text-zinc-300">/</span>
          <span className="text-sm font-medium text-zinc-700 font-mono">{id}</span>
        </div>

        {/* Stock Header */}
        {loading ? (
          <div className="animate-pulse flex items-baseline gap-4">
            <div className="w-20 h-8 bg-zinc-200 rounded" />
            <div className="w-32 h-5 bg-zinc-100 rounded" />
          </div>
        ) : stats ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-baseline gap-4 flex-wrap"
          >
            <h1 className="font-mono text-3xl font-bold text-zinc-900 tracking-tight">
              {id}{stockName ? `(${stockName})` : ''}
            </h1>
            {stats.latest_price != null && (
              <span className="font-mono text-xl text-zinc-700">
                NT$ {stats.latest_price.toFixed(1)}
              </span>
            )}
            <span
              className={`font-mono text-sm font-medium px-2.5 py-1 rounded-full ${
                stats.pct5 >= 0
                  ? 'bg-red-50 text-red-600'
                  : 'bg-green-50 text-green-700'
              }`}
            >
              {fmtPct(stats.pct5)}
            </span>
          </motion.div>
        ) : null}

        {/* Summary Cards */}
        {loading ? (
          <SkeletonCards />
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <SummaryCard
              label={'\u8FD15\u65E5\u5916\u8CC7\u7D2F\u7A4D'}
              value={fmtK(stats.cum5_foreign)}
              color={stats.cum5_foreign >= 0 ? 'text-red-600' : 'text-green-700'}
              icon={stats.cum5_foreign >= 0 ? TrendUp : TrendDown}
              delay={0}
            />
            <SummaryCard
              label={'\u8FD120\u65E5\u5916\u8CC7\u7D2F\u7A4D'}
              value={fmtK(stats.cum20_foreign)}
              color={stats.cum20_foreign >= 0 ? 'text-red-600' : 'text-green-700'}
              icon={stats.cum20_foreign >= 0 ? TrendUp : TrendDown}
              delay={0.06}
            />
            <SummaryCard
              label={'\u9023\u7E8C\u8CB7\u8D85'}
              value={
                stats.consec_buy > 0
                  ? `${stats.consec_buy}\u5929`
                  : `\u8CE3\u8D85${stats.consec_sell}\u5929`
              }
              color={stats.consec_buy > 0 ? 'text-red-600' : 'text-green-700'}
              icon={stats.consec_buy > 0 ? TrendUp : TrendDown}
              delay={0.12}
            />
            <SummaryCard
              label={'\u4ECA\u65E5\u7570\u5E38\u5EA6'}
              value={fmtZ(stats.z_score)}
              color={
                Math.abs(stats.z_score) > 2
                  ? 'text-red-600'
                  : Math.abs(stats.z_score) > 1
                    ? 'text-amber-600'
                    : 'text-zinc-500'
              }
              icon={Lightning}
              delay={0.18}
            />
            <SummaryCard
              label={'\u4E09\u5927\u4E00\u81F4'}
              value={stats.three_consistent ? '\u540C\u5411\u8CB7\u8D85' : '\u65B9\u5411\u5206\u6B67'}
              sub={stats.three_consistent ? '\u5916\u8CC7+\u6295\u4FE1+\u81EA\u71DF' : undefined}
              color={stats.three_consistent ? 'text-blue-600' : 'text-zinc-500'}
              icon={Users}
              delay={0.24}
            />
          </div>
        ) : null}

        {/* Main Chart */}
        {loading ? (
          <SkeletonChart />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-white rounded-2xl border border-zinc-200/60 p-6"
          >
            <h3 className="text-sm font-medium text-zinc-700 mb-4">
              {'\u5916\u8CC7\u7C4C\u78BC vs \u80A1\u50F9\u8D70\u52E2'}
            </h3>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={mainChartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="chip"
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${(v).toFixed(0)}K`}
                />
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<MainTooltip />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                />
                <ReferenceLine yAxisId="chip" y={0} stroke="#e4e4e7" />

                {/* Signal markers */}
                {mainChartData
                  .filter((d) => signalDates.has(d.fullDate))
                  .map((d) => (
                    <ReferenceLine
                      key={d.fullDate}
                      yAxisId="chip"
                      x={d.date}
                      stroke="#3b82f6"
                      strokeDasharray="3 3"
                    />
                  ))}

                <Bar
                  yAxisId="chip"
                  dataKey="foreign_net"
                  name={'\u5916\u8CC7\u6DE8\u8CB7\u8D85'}
                  radius={[2, 2, 0, 0]}
                  barSize={10}
                >
                  {mainChartData.map((entry, i) => (
                    <Cell key={i} fill={chipColor(entry.foreign_net)} />
                  ))}
                </Bar>
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="close_price"
                  name={'\u6536\u76E4\u50F9'}
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="ma5"
                  name="MA5"
                  stroke="#fb923c"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="ma20"
                  name="MA20"
                  stroke="#a855f7"
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </motion.div>
        )}

        {/* Sub-chart Tabs */}
        {!loading && chip.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-white rounded-2xl border border-zinc-200/60 p-6"
          >
            {/* Tab bar */}
            <div className="flex items-center gap-1 mb-5">
              {([
                { key: 'inst' as SubTab, label: '\u6295\u4FE1/\u81EA\u71DF' },
                { key: 'cumulative' as SubTab, label: '\u7D2F\u7A4D\u7DDA' },
                { key: 'margin' as SubTab, label: '\u878D\u8CC7\u5238' },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setSubTab(tab.key)}
                  className={`px-4 py-1.5 text-sm rounded-lg font-medium transition ${
                    subTab === tab.key
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab 1: Institutional detail */}
            {subTab === 'inst' && (
              <ResponsiveContainer width="100%" height={200}>
                <RBarChart data={instChartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}K`}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11, borderRadius: 8,
                      border: '1px solid #e4e4e7',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                    }}
                    formatter={(v) => [`${Number(v)}K`, '']}
                  />
                  <ReferenceLine y={0} stroke="#e4e4e7" />
                  <Bar dataKey="foreign" name={'\u5916\u8CC7'} barSize={6} radius={[2, 2, 0, 0]}>
                    {instChartData.map((e, i) => (
                      <Cell key={i} fill={chipColor(e.foreign)} />
                    ))}
                  </Bar>
                  <Bar dataKey="trust" name={'\u6295\u4FE1'} barSize={6} radius={[2, 2, 0, 0]}>
                    {instChartData.map((e, i) => (
                      <Cell key={i} fill={e.trust >= 0 ? '#3b82f6' : '#93c5fd'} />
                    ))}
                  </Bar>
                  <Bar dataKey="dealer" name={'\u81EA\u71DF'} barSize={6} radius={[2, 2, 0, 0]}>
                    {instChartData.map((e, i) => (
                      <Cell key={i} fill={e.dealer >= 0 ? '#a855f7' : '#d8b4fe'} />
                    ))}
                  </Bar>
                </RBarChart>
              </ResponsiveContainer>
            )}

            {/* Tab 2: Cumulative */}
            {subTab === 'cumulative' && (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={cumChartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}K`}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11, borderRadius: 8,
                      border: '1px solid #e4e4e7',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                    }}
                    formatter={(v) => [`${Number(v)}K`, '']}
                  />
                  <ReferenceLine y={0} stroke="#e4e4e7" />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    name={'\u7D2F\u7A4D\u6DE8\u8CB7\u8D85'}
                    stroke="#2563eb"
                    strokeWidth={2}
                    fill="#dbeafe"
                    fillOpacity={0.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}

            {/* Tab 3: Margin/Short */}
            {subTab === 'margin' && (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={marginChartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}K`}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11, borderRadius: 8,
                      border: '1px solid #e4e4e7',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                    }}
                    formatter={(v) => [`${Number(v)}K`, '']}
                  />
                  <Line
                    type="monotone"
                    dataKey="margin"
                    name={'\u878D\u8CC7\u9918\u984D'}
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="short"
                    name={'\u878D\u5238\u9918\u984D'}
                    stroke="#a855f7"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </motion.div>
        )}
      </main>
    </div>
  )
}
