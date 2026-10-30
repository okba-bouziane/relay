import { formatDzd, isStuck } from '../lib/saga'
import type { Order, TimelineEntry } from '../lib/types'

export function OrderList({
  orders,
  timeline,
  selected,
  onSelect,
  now,
}: {
  orders: Order[]
  timeline: Map<string, TimelineEntry[]>
  selected: string | null
  onSelect: (id: string) => void
  now: number
}) {
  const counts = { confirmed: 0, cancelled: 0, pending: 0 }
  for (const o of orders) counts[o.status]++
  return (
    <section className="panel orders">
      <h2>
        Orders{' '}
        <span className="counts mono">
          ✓ {counts.confirmed} · ✕ {counts.cancelled} · … {counts.pending}
        </span>
      </h2>
      {orders.length === 0 && <p className="muted">No orders yet.</p>}
      <ul>
        {orders.map((o) => {
          const stuck = isStuck(o, timeline.get(o.id) ?? [], now)
          return (
            <li key={o.id}>
              <button className={`order ${selected === o.id ? 'on' : ''}`} onClick={() => onSelect(o.id)}>
                <span className={`status ${stuck ? 'stuck' : o.status}`}>{stuck ? 'stuck' : o.status}</span>
                <span className="who">{o.customer}</span>
                <span className="mono muted">{o.total !== null ? formatDzd(o.total) : '—'}</span>
                <span className="mono muted small">{new Date(o.created_at).toLocaleTimeString('en-GB')}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
