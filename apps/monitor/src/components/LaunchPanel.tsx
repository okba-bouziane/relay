import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatDzd } from '../lib/saga'
import type { Product } from '../lib/types'

const SCENARIOS = [
  {
    label: 'Happy path',
    hint: 'stock ok, card ok',
    customer: 'Amina Belkacem',
    items: [
      { sku: 'PHONE-128', quantity: 1 },
      { sku: 'DATES-1', quantity: 2 },
    ],
    cardToken: 'tok_ok',
  },
  {
    label: 'Out of stock',
    hint: 'inventory rejects',
    customer: 'Rachid Ouali',
    items: [{ sku: 'KETTLE-2', quantity: 3 }],
    cardToken: 'tok_ok',
  },
  {
    label: 'Card declined',
    hint: 'payment fails, stock released',
    customer: 'Sara Meziane',
    items: [{ sku: 'LAPTOP-15', quantity: 1 }],
    cardToken: 'tok_declined',
  },
  {
    label: 'Over the limit',
    hint: '512 000 DA, card limit 500 000',
    customer: 'Mehdi Bensalem',
    items: [{ sku: 'LAPTOP-15', quantity: 4 }],
    cardToken: 'tok_ok',
  },
]

export function LaunchPanel({ onPlaced }: { onPlaced: (orderId: string) => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [custom, setCustom] = useState({ sku: 'OLIVE-5L', quantity: 1, cardToken: 'tok_ok' })

  const loadProducts = () =>
    api
      .products()
      .then(setProducts)
      .catch(() => undefined)
  useEffect(() => {
    void loadProducts()
  }, [])

  async function place(label: string, body: Parameters<typeof api.placeOrder>[0]) {
    setBusy(label)
    setError(null)
    try {
      const order = await api.placeOrder(body)
      onPlaced(order.id)
      setTimeout(() => void loadProducts(), 800)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel">
      <h2>Launch an order</h2>
      <div className="scenarios">
        {SCENARIOS.map((s) => (
          <button key={s.label} className="btn scenario" disabled={!!busy} onClick={() => place(s.label, s)}>
            <strong>{s.label}</strong>
            <span className="muted">{s.hint}</span>
          </button>
        ))}
      </div>
      <form
        className="custom"
        onSubmit={(e) => {
          e.preventDefault()
          void place('custom', {
            customer: 'Walk-in customer',
            items: [{ sku: custom.sku, quantity: custom.quantity }],
            cardToken: custom.cardToken,
          })
        }}
      >
        <label className="sr-only" htmlFor="sku">
          Product
        </label>
        <select id="sku" className="input" value={custom.sku} onChange={(e) => setCustom({ ...custom, sku: e.target.value })}>
          {products.map((p) => (
            <option key={p.sku} value={p.sku}>
              {p.name} · {formatDzd(p.price)} · {p.stock} left
            </option>
          ))}
        </select>
        <div className="row">
          <label className="sr-only" htmlFor="qty">
            Quantity
          </label>
          <input
            id="qty"
            className="input"
            type="number"
            min={1}
            max={20}
            value={custom.quantity}
            onChange={(e) => setCustom({ ...custom, quantity: Number(e.target.value) })}
          />
          <label className="sr-only" htmlFor="card">
            Card
          </label>
          <select
            id="card"
            className="input"
            value={custom.cardToken}
            onChange={(e) => setCustom({ ...custom, cardToken: e.target.value })}
          >
            <option value="tok_ok">Card OK</option>
            <option value="tok_declined">Declined</option>
            <option value="tok_insufficient">No funds</option>
          </select>
          <button className="btn primary" disabled={!!busy}>
            Send
          </button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
