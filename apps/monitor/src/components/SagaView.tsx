import { JAEGER_URL } from '../lib/api'
import { duration, formatDzd, SERVICES } from '../lib/saga'
import type { Order, TimelineEntry } from '../lib/types'

/**
 * Swimlanes: one row per service, steps placed left to right in the order they happened.
 * It shows the saga the way it really runs: no service calls another, each reacts to events.
 */
export function SagaView({ order, entries, stuck }: { order: Order | undefined; entries: TimelineEntry[]; stuck: boolean }) {
  if (!order) {
    return (
      <section className="panel saga empty">
        <p className="muted">Launch an order or pick one from the list to watch its saga.</p>
      </section>
    )
  }
  const took = duration(entries)
  return (
    <section className="panel saga" aria-label="Saga timeline">
      <header className="saga-head">
        <div>
          <p className="mono muted small">order {order.id.slice(0, 8)}</p>
          <h1>{order.customer}</h1>
          <p className="muted">
            {order.items.map((i) => `${i.quantity} × ${i.sku}`).join(', ')}
            {order.total !== null && (
              <>
                {' '}
                · <strong className="mono">{formatDzd(order.total)}</strong>
              </>
            )}
          </p>
        </div>
        <div className="saga-meta">
          <span className={`status ${stuck ? 'stuck' : order.status}`}>{stuck ? 'stuck' : order.status}</span>
          {took !== null && <span className="mono muted small">{took} ms end to end</span>}
          {order.trace_id && (
            <a className="mono small" href={`${JAEGER_URL}/trace/${order.trace_id}`} target="_blank" rel="noreferrer">
              trace {order.trace_id.slice(0, 8)} ↗
            </a>
          )}
        </div>
      </header>

      <div className="lanes" style={{ gridTemplateColumns: `110px repeat(${Math.max(entries.length, 4)}, minmax(120px, 1fr))` }}>
        {SERVICES.map((service) => (
          <div key={service} className="lane" style={{ display: 'contents' }}>
            <div className={`lane-name svc ${service}`}>{service}</div>
            {Array.from({ length: Math.max(entries.length, 4) }, (_, i) => {
              const entry = entries[i]
              return (
                <div key={i} className="cell">
                  {entry && entry.service === service && (
                    <div className={`step ${entry.status} ${service}`} title={entry.at}>
                      <span className="step-name">{entry.step}</span>
                      {entry.detail && <span className="step-detail">{entry.detail}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {order.reason && <p className="reason">Why: {order.reason}</p>}
      {stuck && (
        <p className="reason">
          A message for this order failed too many times and is waiting in a dead-letter queue. Fix the cause, then replay it.
        </p>
      )}
    </section>
  )
}
