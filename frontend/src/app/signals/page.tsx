'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  Lightning,
  ArrowUp,
  ArrowDown,
  ChartBar,
  Star,
  MagnifyingGlass,
} from '@phosphor-icons/react'
import AppNav from '@/components/AppNav'
import {
  getStoredAuth, clearAuth, fetchSignals, fetchStocks,
  type SignalRow, fmt, fmtPct, fmtZ,
} from '@/lib/api'

// ── Constants ─────────────────────────────────────────────────────────────────

type SignalTypeFilter = 'all' | SignalRow['signal_type']
type LightFilter = 'all' | 'red' | 'yellow'

const SIGNAL_TYPE_CHIPS: { key: SignalTypeFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'triple_arrow', label: '三箭齊發' },
  { key: 'stealth_entry', label: '悄悄進場' },
  { key: 'trust_push', label: '投信拉抬' },
  { key: 'retail_chase', label: '散戶警告' },
]

const LIGHT_CHIPS: { key: LightFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'red', label: '強訊號' },
  { key: 'yellow', label: '中訊號' },
]

const SIGNAL_BADGE_STYLE: Record<SignalRow['signal_type'], { label: string; cls: string }> = {
  triple_arrow: { label: '三箭齊發', cls: 'bg-red-50 text-red-600' },
  stealth_entry: { label: '悄悄進場', cls: 'bg-blue-50 text-blue-600' },
  trust_push: { label: '投信拉抬', cls: 'bg-purple-50 text-purple-600' },
  retail_chase: { label: '散戶追高', cls: 'bg-orange-50 text-orange-600' },
  normal: { label: '一般', cls: 'bg-zinc-100 text-zinc-500' },
}

const LIGHT_BORDER: Record<SignalRow['light'], string> = {
  red: 'border-l-red-500',
  yellow: 'border-l-yellow-400',
  gray: 'border-l-zinc-200',
}

const CHART_COLORS: Record<string, string> = {
  triple_arrow: '#ef4444',
  stealth_entry: '#ef4444',
  trust_push: '#3b82f6',
  retail_chase: '#f97316',
  normal: '#a1a1aa',
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl p-5 border border-zinc-200/60 border-l-[3px] border-l-zinc-200 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-200" />
          <div className="w-16 h-5 bg-zinc-200 rounded" />
          <div className="w-20 h-4 bg-zinc-100 rounded" />
        </div>
        <div className="w-12 h-5 bg-zinc-200 rounded-md" />
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-16 h-5 bg-zinc-100 rounded-full" />
        <div className="w-12 h-4 bg-zinc-100 rounded" />
        <div className="w-14 h-4 bg-zinc-100 rounded" />
        <div className="w-14 h-4 bg-zinc-100 rounded" />
      </div>
      <div className="flex items-center gap-2">
        <div className="w-14 h-5 bg-zinc-100 rounded" />
        <div className="w-14 h-5 bg-zinc-100 rounded" />
        <div className="w-14 h-5 bg-zinc-100 rounded" />
      </div>
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="20" y="30" width="80" height="60" rx="8" stroke="#d4d4d8" strokeWidth="2" fill="#fafafa" />
        <path d="M40 55 L55 45 L65 52 L80 40" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="40" cy="55" r="3" fill="#d4d4d8" />
        <circle cx="55" cy="45" r="3" fill="#d4d4d8" />
        <circle cx="65" cy="52" r="3" fill="#d4d4d8" />
        <circle cx="80" cy="40" r="3" fill="#d4d4d8" />
        <line x1="30" y1="70" x2="90" y2="70" stroke="#e4e4e7" strokeWidth="1.5" />
        <rect x="35" y="74" width="12" height="8" rx="2" fill="#e4e4e7" />
        <rect x="52" y="74" width="12" height="8" rx="2" fill="#e4e4e7" />
        <rect x="69" y="74" width="12" height="8" rx="2" fill="#e4e4e7" />
      </svg>
      <p className="text-zinc-400 text-sm mt-4">今日尚無訊號資料</p>
    </div>
  )
}

// ── Small Components ──────────────────────────────────────────────────────────

function NetBadge({ label, value }: { label: string; value: number }) {
  const pos = value >= 0
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-zinc-400">{label}</span>
      <span className={`font-mono font-medium px-1.5 py-0.5 rounded ${pos ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
        {fmt(value)}
      </span>
    </span>
  )
}

function ZScoreText({ z }: { z: number }) {
  let color = 'text-zinc-500'
  if (z >= 2) color = 'text-red-600'
  else if (z >= 1) color = 'text-orange-500'
  else if (z <= -1) color = 'text-green-600'
  return <span className={`font-mono text-xs font-medium ${color}`}>{fmtZ(z)}</span>
}

function StrengthDot({ light }: { light: SignalRow['light'] }) {
  if (light === 'red') {
    return <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
    </span>
  }
  if (light === 'yellow') {
    return <span className="inline-flex rounded-full h-2.5 w-2.5 bg-yellow-400" />
  }
  return <span className="inline-flex rounded-full h-2.5 w-2.5 bg-zinc-300" />
}

// ── Watchlist helpers ─────────────────────────────────────────────────────────

function getWatchlist(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem('fiq_watchlist')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function toggleWatchlist(stockId: string): string[] {
  const list = getWatchlist()
  const idx = list.indexOf(stockId)
  if (idx >= 0) {
    list.splice(idx, 1)
  } else {
    list.push(stockId)
  }
  localStorage.setItem('fiq_watchlist', JSON.stringify(list))
  return [...list]
}

// ── Signal Card ───────────────────────────────────────────────────────────────

function SignalCard({
  row,
  stockName,
  index,
  inWatchlist,
  onToggleWatchlist,
}: {
  row: SignalRow
  stockName: string
  index: number
  inWatchlist: boolean
  onToggleWatchlist: (id: string) => void
}) {
  const badge = SIGNAL_BADGE_STYLE[row.signal_type]
  const consecText = row.consec_buy > 0
    ? `連買${row.consec_buy}d`
    : row.consec_sell > 0
    ? `連賣${row.consec_sell}d`
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.03, duration: 0.3, ease: 'easeOut' }}
      className={`bg-white rounded-2xl p-5 border border-zinc-200/60 border-l-[3px] ${LIGHT_BORDER[row.light]} shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_20px_-6px_rgba(0,0,0,0.08)] transition-shadow`}
    >
      {/* Row 1: stock info + score */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <StrengthDot light={row.light} />
          <span className="font-mono font-bold text-lg text-zinc-900">{row.stock_id}</span>
          <span className="text-zinc-500 text-sm ml-0.5">{stockName}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.preventDefault(); onToggleWatchlist(row.stock_id) }}
            className="p-1 rounded-md hover:bg-zinc-100 transition"
            title={inWatchlist ? '移出自選' : '加入自選'}
          >
            <Star
              weight={inWatchlist ? 'fill' : 'regular'}
              size={16}
              className={inWatchlist ? 'text-yellow-500' : 'text-zinc-300'}
            />
          </button>
          <span className="bg-zinc-900 text-white text-xs font-mono px-2 py-0.5 rounded-md">
            {row.score}
          </span>
        </div>
      </div>

      {/* Row 2: signal type, z-score, consec, pct5 */}
      <div className="flex items-center flex-wrap gap-2 mb-2.5">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>
          {badge.label}
        </span>
        <ZScoreText z={row.z_score} />
        {consecText && (
          <span className={`font-mono text-xs font-medium ${row.consec_buy > 0 ? 'text-red-500' : 'text-green-600'}`}>
            {consecText}
          </span>
        )}
        <span className="inline-flex items-center gap-0.5">
          {row.pct5 >= 0 ? (
            <ArrowUp weight="bold" size={12} className="text-red-500" />
          ) : (
            <ArrowDown weight="bold" size={12} className="text-green-600" />
          )}
          <span className={`font-mono text-xs font-medium ${row.pct5 >= 0 ? 'text-red-500' : 'text-green-600'}`}>
            {fmtPct(row.pct5)}
          </span>
        </span>
        {row.close_price != null && (
          <span className="font-mono text-xs text-zinc-400">
            ${row.close_price.toFixed(1)}
          </span>
        )}
      </div>

      {/* Row 3: nets + action */}
      <div className="flex items-center justify-between">
        <div className="flex items-center flex-wrap gap-2.5">
          <NetBadge label="外資" value={row.foreign_net} />
          <NetBadge label="投信" value={row.trust_net} />
          <NetBadge label="自營" value={row.dealer_net} />
        </div>
        <Link
          href={`/stock/${row.stock_id}`}
          className="text-xs text-blue-600 font-medium px-2.5 py-1 rounded-md border border-blue-200 hover:bg-blue-50 transition whitespace-nowrap"
        >
          深度分析
        </Link>
      </div>
    </motion.div>
  )
}

// ── Sector Summary Sidebar ────────────────────────────────────────────────────

function SectorSummary({ data }: { data: SignalRow[] }) {
  // Count by signal type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {
      triple_arrow: 0,
      stealth_entry: 0,
      trust_push: 0,
      retail_chase: 0,
      normal: 0,
    }
    data.forEach(r => { counts[r.signal_type] = (counts[r.signal_type] || 0) + 1 })
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([type, count]) => ({
        type,
        label: SIGNAL_BADGE_STYLE[type as SignalRow['signal_type']].label,
        count,
      }))
      .sort((a, b) => b.count - a.count)
  }, [data])

  const redCount = data.filter(r => r.light === 'red').length
  const yellowCount = data.filter(r => r.light === 'yellow').length

  const top10Avg = useMemo(() => {
    const top = data.slice(0, 10)
    if (top.length === 0) return 0
    return top.reduce((s, r) => s + r.z_score, 0) / top.length
  }, [data])

  const topStock = data[0] ?? null

  return (
    <div className="flex flex-col gap-5">
      {/* Bar chart card */}
      <div className="bg-white rounded-2xl border border-zinc-200/60 p-5 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-1.5 mb-4">
          <ChartBar weight="duotone" size={16} className="text-zinc-500" />
          <h3 className="text-sm font-medium text-zinc-700">訊號類型分佈</h3>
        </div>
        {typeCounts.length > 0 ? (
          <ResponsiveContainer width="100%" height={typeCounts.length * 40 + 20}>
            <BarChart
              data={typeCounts}
              layout="vertical"
              margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                width={72}
                tick={{ fontSize: 12, fill: '#71717a' }}
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
                formatter={(v: unknown) => [`${v} 支`, '數量']}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
                {typeCounts.map((entry, i) => (
                  <Cell key={i} fill={CHART_COLORS[entry.type] || '#a1a1aa'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-zinc-400 py-4 text-center">無資料</p>
        )}
      </div>

      {/* Stats card */}
      <div className="bg-white rounded-2xl border border-zinc-200/60 p-5 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
        <h3 className="text-sm font-medium text-zinc-700 mb-4">今日統計</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-zinc-400 mb-1">強訊號（紅燈）</p>
            <p className="font-mono text-xl font-bold text-red-600">{redCount}<span className="text-sm font-normal text-zinc-400 ml-0.5">支</span></p>
          </div>
          <div>
            <p className="text-xs text-zinc-400 mb-1">中訊號（黃燈）</p>
            <p className="font-mono text-xl font-bold text-yellow-500">{yellowCount}<span className="text-sm font-normal text-zinc-400 ml-0.5">支</span></p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-zinc-400 mb-1">Top 10 平均 Z-score</p>
            <p className="font-mono text-xl font-bold text-zinc-900">{fmtZ(top10Avg)}</p>
          </div>
        </div>
      </div>

      {/* Top stock card */}
      {topStock && (
        <div className="bg-white rounded-2xl border border-zinc-200/60 p-5 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-1.5 mb-3">
            <Lightning weight="duotone" size={16} className="text-red-500" />
            <h3 className="text-sm font-medium text-zinc-700">最強訊號</h3>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <StrengthDot light={topStock.light} />
            <span className="font-mono font-bold text-lg text-zinc-900">{topStock.stock_id}</span>
            <span className="bg-zinc-900 text-white text-xs font-mono px-2 py-0.5 rounded-md ml-auto">
              {topStock.score}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SIGNAL_BADGE_STYLE[topStock.signal_type].cls}`}>
              {SIGNAL_BADGE_STYLE[topStock.signal_type].label}
            </span>
            <ZScoreText z={topStock.z_score} />
            <span className={`font-mono text-xs font-medium ${topStock.pct5 >= 0 ? 'text-red-500' : 'text-green-600'}`}>
              {fmtPct(topStock.pct5)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <NetBadge label="外資" value={topStock.foreign_net} />
            <NetBadge label="投信" value={topStock.trust_net} />
            <NetBadge label="自營" value={topStock.dealer_net} />
          </div>
          <Link
            href={`/stock/${topStock.stock_id}`}
            className="mt-3 block text-center text-xs text-blue-600 font-medium px-3 py-1.5 rounded-md border border-blue-200 hover:bg-blue-50 transition"
          >
            查看深度分析
          </Link>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SignalsPage() {
  const router = useRouter()
  const [auth, setAuth] = useState<{ user: string; pass: string } | null>(null)
  const [signals, setSignals] = useState<SignalRow[]>([])
  const [stockNames, setStockNames] = useState<Record<string, string>>({})
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)

  // Filters
  const [typeFilter, setTypeFilter] = useState<SignalTypeFilter>('all')
  const [lightFilter, setLightFilter] = useState<LightFilter>('all')

  // Watchlist
  const [watchlist, setWatchlist] = useState<string[]>([])

  // Auth check
  useEffect(() => {
    const stored = getStoredAuth()
    if (!stored) { router.push('/'); return }
    setAuth(stored)
    setWatchlist(getWatchlist())
  }, [router])

  // Fetch data
  useEffect(() => {
    if (!auth) return
    setLoading(true)

    Promise.all([
      fetchSignals(auth, 50),
      fetchStocks(auth),
    ])
      .then(([sigRes, stocks]) => {
        setSignals(sigRes.data)
        setDate(sigRes.date)
        setStockNames(stocks)
      })
      .catch(() => {
        clearAuth()
        router.push('/')
      })
      .finally(() => setLoading(false))
  }, [auth, router])

  // Filter logic
  const filtered = useMemo(() => {
    return signals.filter(r => {
      if (typeFilter !== 'all' && r.signal_type !== typeFilter) return false
      if (lightFilter !== 'all' && r.light !== lightFilter) return false
      return true
    })
  }, [signals, typeFilter, lightFilter])

  // Handlers
  const logout = useCallback(() => {
    clearAuth()
    router.push('/')
  }, [router])

  const handleToggleWatchlist = useCallback((stockId: string) => {
    const updated = toggleWatchlist(stockId)
    setWatchlist(updated)
  }, [])

  return (
    <div className="min-h-[100dvh] bg-[#f9fafb]">
      <AppNav date={date} onLogout={logout} />

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {/* Page header */}
        <div className="flex items-center flex-wrap gap-3 mb-6">
          <div className="flex items-center gap-2">
            <Lightning weight="duotone" size={22} className="text-blue-600" />
            <h1 className="text-xl font-bold text-zinc-900 tracking-tight">今日訊號排行</h1>
          </div>
          {date && (
            <span className="font-mono text-xs bg-zinc-100 text-zinc-500 px-2.5 py-1 rounded-md">
              {date}
            </span>
          )}
          {!loading && (
            <span className="text-xs text-zinc-400">
              共 {signals.length} 支
            </span>
          )}
        </div>

        {/* Filter bar */}
        <div className="mb-6 space-y-3">
          {/* Signal type filters */}
          <div className="flex items-center flex-wrap gap-2">
            <MagnifyingGlass weight="duotone" size={14} className="text-zinc-400 mr-0.5" />
            <span className="text-xs text-zinc-400 mr-1">訊號類型</span>
            {SIGNAL_TYPE_CHIPS.map(chip => (
              <button
                key={chip.key}
                onClick={() => setTypeFilter(chip.key)}
                className={`text-sm px-3 py-1.5 rounded-full border transition ${
                  typeFilter === chip.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Light filters */}
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-xs text-zinc-400 mr-1 ml-[22px]">強度</span>
            {LIGHT_CHIPS.map(chip => (
              <button
                key={chip.key}
                onClick={() => setLightFilter(chip.key)}
                className={`text-sm px-3 py-1.5 rounded-full border transition ${
                  lightFilter === chip.key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'
                }`}
              >
                {chip.label}
                {chip.key === 'red' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 ml-1.5" />}
                {chip.key === 'yellow' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 ml-1.5" />}
              </button>
            ))}
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
          {/* Left: Signal list */}
          <section>
            {loading ? (
              <div className="flex flex-col gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="flex flex-col gap-4">
                <AnimatePresence mode="popLayout">
                  {filtered.map((row, i) => (
                    <SignalCard
                      key={row.stock_id}
                      row={row}
                      stockName={stockNames[row.stock_id] || ''}
                      index={i}
                      inWatchlist={watchlist.includes(row.stock_id)}
                      onToggleWatchlist={handleToggleWatchlist}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* Right: Sector summary */}
          <aside className="hidden lg:block">
            {loading ? (
              <div className="flex flex-col gap-5">
                <div className="bg-white rounded-2xl border border-zinc-200/60 p-5 h-48 animate-pulse">
                  <div className="w-28 h-4 bg-zinc-200 rounded mb-6" />
                  <div className="space-y-3">
                    <div className="w-full h-5 bg-zinc-100 rounded" />
                    <div className="w-3/4 h-5 bg-zinc-100 rounded" />
                    <div className="w-1/2 h-5 bg-zinc-100 rounded" />
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-zinc-200/60 p-5 h-36 animate-pulse">
                  <div className="w-20 h-4 bg-zinc-200 rounded mb-6" />
                  <div className="grid grid-cols-2 gap-4">
                    <div className="w-16 h-8 bg-zinc-100 rounded" />
                    <div className="w-16 h-8 bg-zinc-100 rounded" />
                  </div>
                </div>
              </div>
            ) : signals.length > 0 ? (
              <SectorSummary data={signals} />
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  )
}
