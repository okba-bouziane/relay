import { useMemo, useState } from 'react'
import { LaunchPanel } from './components/LaunchPanel'
import { OrderList } from './components/OrderList'
import { SagaView } from './components/SagaView'
import { SystemPanel } from './components/SystemPanel'
import { useNow, useOrders, useSystem, useTimeline } from './lib/hooks'
import { groupByOrder, isStuck } from './lib/saga'

export default function App() {
  const { entries, connected } = useTimeline()
  const orders = useOrders()
  const system = useSystem()
  const now = useNow()
  const [selected, setSelected] = useState<string | null>(null)
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light')

  const timeline = useMemo(() => groupByOrder(entries), [entries])
  const list = orders.data ?? []
  const current = list.find((o) => o.id === selected) ?? list[0]
  const currentEntries = current ? (timeline.get(current.id) ?? []) : []

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('relay-theme', next)
    } catch {
      /* storage blocked */
    }
    setTheme(next)
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <path
              d="M9 11h9a4 4 0 0 1 0 8h-1l5 4M9 11v12"
              fill="none"
              stroke="#fff"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <strong>Relay</strong>
            <span className="muted small">order saga · orders → inventory → payments</span>
          </div>
        </div>
        <div className="top-right">
          <span className={`live ${connected ? 'on' : ''}`} role="status">
            {connected ? 'live' : 'reconnecting'}
          </span>
          <button className="btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main className="grid">
        <div className="col">
          <LaunchPanel
            onPlaced={(id) => {
              setSelected(id)
              void orders.refresh()
            }}
          />
          <SystemPanel system={system.data} refresh={system.refresh} />
        </div>
        <div className="col wide">
          <SagaView order={current} entries={currentEntries} stuck={current ? isStuck(current, currentEntries, now) : false} />
          <OrderList orders={list} timeline={timeline} selected={current?.id ?? null} onSelect={setSelected} now={now} />
        </div>
      </main>
    </div>
  )
}
