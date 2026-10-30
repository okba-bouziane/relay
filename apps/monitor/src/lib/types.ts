export type Service = 'orders' | 'inventory' | 'payments'

export interface Order {
  id: string
  customer: string
  items: { sku: string; quantity: number }[]
  total: number | null
  status: 'pending' | 'confirmed' | 'cancelled'
  reason: string | null
  trace_id: string | null
  created_at: string
}

export interface TimelineEntry {
  id: string
  orderId: string
  service: Service
  step: string
  status: 'ok' | 'failed' | 'compensated' | 'info'
  detail?: string
  traceId?: string | null
  at: string
}

export interface Product {
  sku: string
  name: string
  price: number
  stock: number
}

export interface SystemState {
  services: { name: Service; ok: boolean }[]
  queues: { name: string; messages: number; consumers: number }[]
  chaos: { gatewayDown: boolean; delayMs: number }
}
