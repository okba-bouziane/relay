import type { Order, Product, SystemState } from './types'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON body when there is one: Fastify rejects an empty body sent as application/json.
  const headers = { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers }
  const res = await fetch(`/api${path}`, { ...init, headers })
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  orders: () => call<Order[]>('/orders'),
  products: () => fetch('/inventory/products').then((r) => r.json() as Promise<Product[]>),
  system: () => call<SystemState>('/system'),
  placeOrder: (body: { customer: string; items: { sku: string; quantity: number }[]; cardToken: string }) =>
    call<Order>('/orders', { method: 'POST', body: JSON.stringify(body), headers: { 'idempotency-key': crypto.randomUUID() } }),
  setChaos: (chaos: SystemState['chaos']) => call('/chaos', { method: 'PUT', body: JSON.stringify(chaos) }),
  replay: (service: string) => call<{ moved: number }>(`/dlq/${service}/replay`, { method: 'POST' }),
}

export const JAEGER_URL = 'http://localhost:16687'
export const RABBITMQ_URL = 'http://localhost:15673'
