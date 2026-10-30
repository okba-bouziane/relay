import { useState } from 'react'
import { api, JAEGER_URL, RABBITMQ_URL } from '../lib/api'
import type { SystemState } from '../lib/types'

export function SystemPanel({ system, refresh }: { system: SystemState | null; refresh: () => Promise<void> }) {
  const [message, setMessage] = useState<string | null>(null)
  // Shown at once while the change is saved, so the controls never lag behind a click.
  const [pendingChaos, setPendingChaos] = useState<SystemState['chaos'] | null>(null)
  if (!system)
    return (
      <section className="panel">
        <h2>System</h2>
        <p className="muted">Connecting…</p>
      </section>
    )
  const chaos = pendingChaos ?? system.chaos

  async function setChaos(next: SystemState['chaos']) {
    setPendingChaos(next)
    try {
      await api.setChaos(next)
      await refresh()
    } finally {
      setPendingChaos(null)
    }
  }

  async function replay(service: string) {
    try {
      const { moved } = await api.replay(service)
      setMessage(`${moved} message${moved === 1 ? '' : 's'} sent back to ${service}`)
    } catch (e) {
      setMessage(`Replay failed: ${(e as Error).message}`)
    }
    await refresh()
  }

  const queues = ['orders', 'inventory', 'payments'].map((s) => ({
    service: s,
    events: system.queues.find((q) => q.name === `${s}.events`),
    dlq: system.queues.find((q) => q.name === `${s}.dlq`),
  }))

  return (
    <>
      <section className="panel">
        <h2>Services &amp; queues</h2>
        <table className="queues">
          <thead>
            <tr>
              <th>Service</th>
              <th>Queue</th>
              <th>Dead letters</th>
            </tr>
          </thead>
          <tbody>
            {queues.map((q) => {
              const health = system.services.find((s) => s.name === q.service)
              const dead = q.dlq?.messages ?? 0
              return (
                <tr key={q.service}>
                  <td>
                    <span className={`dot ${health?.ok ? 'up' : 'down'}`} aria-label={health?.ok ? 'up' : 'down'} />
                    <span className={`svc ${q.service}`}>{q.service}</span>
                  </td>
                  <td className="mono">{q.events ? `${q.events.messages} · ${q.events.consumers}c` : '—'}</td>
                  <td>
                    {dead > 0 ? (
                      <button className="btn small danger" onClick={() => void replay(q.service)}>
                        {dead} · replay
                      </button>
                    ) : (
                      <span className="mono muted">0</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {message && <p className="note">{message}</p>}
        <p className="links">
          <a href={JAEGER_URL} target="_blank" rel="noreferrer">
            Jaeger traces ↗
          </a>
          <a href={RABBITMQ_URL} target="_blank" rel="noreferrer">
            RabbitMQ ↗
          </a>
        </p>
      </section>

      <section className="panel">
        <h2>Chaos</h2>
        <label className="toggle">
          <input type="checkbox" checked={chaos.gatewayDown} onChange={(e) => void setChaos({ ...chaos, gatewayDown: e.target.checked })} />
          <span>
            <strong>Card gateway down</strong>
            <span className="muted">Payments retries 3 times, then dead-letters the message.</span>
          </span>
        </label>
        <label className="slider">
          <span>
            Gateway latency <span className="mono">{chaos.delayMs} ms</span>
          </span>
          <input
            type="range"
            min={0}
            max={3000}
            step={250}
            value={chaos.delayMs}
            onChange={(e) => void setChaos({ ...chaos, delayMs: Number(e.target.value) })}
          />
        </label>
      </section>
    </>
  )
}
