'use client'

import { useEffect, useRef } from 'react'

interface Props {
  stockId: string
  market: string  // 'TWSE' | 'TPEX'
}

declare global {
  interface Window {
    TradingView: {
      widget: new (config: Record<string, unknown>) => unknown
    }
  }
}

export default function TradingViewChart({ stockId, market }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scriptRef = useRef<HTMLScriptElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const containerId = `tv_${stockId}_${market}`
    containerRef.current.id = containerId

    const initWidget = () => {
      if (!window.TradingView || !document.getElementById(containerId)) return
      new window.TradingView.widget({
        autosize: true,
        symbol: `${market}:${stockId}`,
        interval: 'D',
        timezone: 'Asia/Taipei',
        theme: 'light',
        style: '1',
        locale: 'zh_TW',
        toolbar_bg: '#f9fafb',
        enable_publishing: false,
        withdateranges: true,
        hide_side_toolbar: false,
        allow_symbol_change: false,
        save_image: false,
        container_id: containerId,
        studies: [
          'RSI@tv-basicstudies',
          'MACD@tv-basicstudies',
        ],
        show_popup_button: true,
        popup_width: '1000',
        popup_height: '650',
      })
    }

    if (window.TradingView) {
      initWidget()
    } else {
      const script = document.createElement('script')
      script.src = 'https://s3.tradingview.com/tv.js'
      script.async = true
      script.onload = initWidget
      document.head.appendChild(script)
      scriptRef.current = script
    }

    return () => {
      if (scriptRef.current && document.head.contains(scriptRef.current)) {
        document.head.removeChild(scriptRef.current)
        scriptRef.current = null
      }
      // clear widget container
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [stockId, market])

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ height: 520 }}
    />
  )
}
