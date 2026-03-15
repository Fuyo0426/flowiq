'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ChartBar,
  Lightning,
  Star,
  ArrowCounterClockwise,
  Trophy,
  MagnifyingGlass,
  List,
  X,
  SignOut,
} from '@phosphor-icons/react'

interface AppNavProps {
  date?: string
  onSearch?: (q: string) => void
  onLogout: () => void
}

const NAV_ITEMS = [
  { href: '/dashboard', icon: ChartBar, label: '\u6CD5\u4EBA\u6392\u884C' },
  { href: '/signals', icon: Lightning, label: '\u8A0A\u865F\u5075\u6E2C' },
  { href: '/watchlist', icon: Star, label: '\u81EA\u9078\u80A1' },
  { href: '/backtest', icon: ArrowCounterClockwise, label: '\u56DE\u6E2C' },
  { href: '/performance', icon: Trophy, label: '\u52DD\u7387\u7D71\u8A08' },
] as const

export default function AppNav({ date, onSearch, onLogout }: AppNavProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && onSearch) {
      onSearch(searchValue.trim())
    }
  }

  return (
    <header className="bg-white border-b border-zinc-200 sticky top-0 z-30">
      <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
        {/* Left: Logo + date */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 12 L6 7 L9 10 L14 4"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="font-semibold tracking-tight text-zinc-900 text-sm">FlowIQ</span>
          {date && (
            <span className="num text-xs text-zinc-400 ml-1 hidden sm:inline">{date}</span>
          )}
        </div>

        {/* Center: Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md transition ${
                  active
                    ? 'text-blue-600'
                    : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50'
                }`}
              >
                <Icon weight="duotone" size={18} />
                <span>{label}</span>
                {active && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-600" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Right: Search + logout + hamburger */}
        <div className="flex items-center gap-2">
          {onSearch && (
            <div className="relative hidden sm:block">
              <MagnifyingGlass
                weight="duotone"
                size={16}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
              />
              <input
                type="text"
                placeholder="搜尋代號..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="num text-sm pl-8 pr-3 py-1.5 rounded-lg border border-zinc-200 bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 w-36 transition"
              />
            </div>
          )}

          <button
            onClick={onLogout}
            className="hidden md:flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 transition px-2 py-1.5"
          >
            <SignOut weight="duotone" size={18} />
            <span>登出</span>
          </button>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-1.5 text-zinc-600 hover:text-zinc-900 transition"
          >
            {mobileOpen ? <X size={20} /> : <List size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-zinc-100 bg-white">
          <nav className="max-w-[1400px] mx-auto px-6 py-3 flex flex-col gap-1">
            {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-md transition ${
                    active
                      ? 'text-blue-600 bg-blue-50'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50'
                  }`}
                >
                  <Icon weight="duotone" size={18} />
                  <span>{label}</span>
                </Link>
              )
            })}

            {onSearch && (
              <div className="relative mt-2">
                <MagnifyingGlass
                  weight="duotone"
                  size={16}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
                />
                <input
                  type="text"
                  placeholder="搜尋代號..."
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="num text-sm pl-8 pr-3 py-2 rounded-lg border border-zinc-200 bg-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 w-full transition"
                />
              </div>
            )}

            <button
              onClick={onLogout}
              className="flex items-center gap-2 px-3 py-2.5 text-sm text-zinc-500 hover:text-zinc-800 transition mt-1"
            >
              <SignOut weight="duotone" size={18} />
              <span>登出</span>
            </button>
          </nav>
        </div>
      )}
    </header>
  )
}
