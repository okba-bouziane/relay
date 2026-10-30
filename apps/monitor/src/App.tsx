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
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark')

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
            <rect width="32" height="32" rx="9" fill="var(--panel-2)" stroke="var(--line)" />
            <circle cx="8" cy="16" r="3.5" fill="var(--orders)" />
            <circle cx="16" cy="16" r="3.5" fill="var(--inventory)" />
            <circle cx="24" cy="16" r="3.5" fill="var(--payments)" />
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
            {theme === 'dark' ? '☀' : '☾'}
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
