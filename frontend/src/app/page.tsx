'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { setStoredAuth, getAuthHeader } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const res = await fetch(`${apiBase}/api/dates`, {
        headers: { Authorization: getAuthHeader(user, pass) },
      })
      if (!res.ok) throw new Error('帳號或密碼錯誤')
      setStoredAuth(user, pass)
      router.push('/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登入失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] grid grid-cols-1 lg:grid-cols-2">
      {/* Left Panel */}
      <div className="hidden lg:flex flex-col justify-between bg-zinc-950 p-14">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 12 L6 7 L9 10 L14 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-white font-semibold tracking-tight text-lg">FlowIQ</span>
        </div>

        <div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-5xl font-bold text-white tracking-tighter leading-none mb-6"
          >
            法人籌碼，<br />
            <span className="text-blue-400">即時透明</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="text-zinc-400 text-base leading-relaxed max-w-sm"
          >
            追蹤外資、投信、自營商每日動向，掌握資金流向，在新聞之前發現訊號。
          </motion.p>
        </div>

        <div className="flex gap-10">
          {[
            { label: '涵蓋股票', value: '2,000+' },
            { label: '資料來源', value: 'TWSE' },
            { label: '每日更新', value: '16:30' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 + i * 0.1 }}
            >
              <div className="num text-2xl font-bold text-white">{stat.value}</div>
              <div className="text-zinc-500 text-sm mt-1">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex items-center justify-center bg-[#f9fafb] px-8 py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm"
        >
          <div className="flex lg:hidden items-center gap-2 mb-10">
            <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M2 12 L6 7 L9 10 L14 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="font-semibold tracking-tight">FlowIQ</span>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 mb-1">登入</h2>
          <p className="text-zinc-500 text-sm mb-8">輸入帳號密碼進入籌碼分析平台</p>

          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700">帳號</label>
              <input
                type="text"
                value={user}
                onChange={e => setUser(e.target.value)}
                placeholder="admin"
                required
                className="w-full px-4 py-2.5 rounded-lg border border-zinc-200 bg-white text-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700">密碼</label>
              <input
                type="password"
                value={pass}
                onChange={e => setPass(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-lg border border-zinc-200 bg-white text-zinc-900 text-sm outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition disabled:opacity-50"
            >
              {loading ? '驗證中...' : '進入 FlowIQ'}
            </button>
          </form>

          <p className="text-xs text-zinc-400 mt-8 text-center">
            FlowIQ — 台股法人籌碼分析平台
          </p>
        </motion.div>
      </div>
    </div>
  )
}
