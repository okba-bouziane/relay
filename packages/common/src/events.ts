import { z } from 'zod'

// The contract between services. Every message on the bus is one of these, validated with zod
// when it is consumed: a service never trusts the shape of what another service sent.

const item = z.object({ sku: z.string(), quantity: z.number().int().positive() })
const pricedLine = item.extend({ unitPrice: z.number().int().nonnegative() })

export const eventSchemas = {
  // The card token goes to payments only; inventory never sees payment details.
  'order.created': z.object({ orderId: z.uuid(), customer: z.string(), items: z.array(item).min(1), cardToken: z.string() }),
  // Inventory owns prices: the total is decided when stock is reserved.
  'stock.reserved': z.object({ orderId: z.uuid(), total: z.number().int(), lines: z.array(pricedLine) }),
  'stock.rejected': z.object({ orderId: z.uuid(), reason: z.string() }),
  'payment.captured': z.object({ orderId: z.uuid(), paymentId: z.uuid(), amount: z.number().int() }),
  'payment.failed': z.object({ orderId: z.uuid(), reason: z.string() }),
  'stock.released': z.object({ orderId: z.uuid() }),
} as const

export type EventType = keyof typeof eventSchemas
export type EventPayload<T extends EventType> = z.infer<(typeof eventSchemas)[T]>

/** What actually travels on RabbitMQ: a unique id (for deduplication) plus the payload. */
export interface Envelope<T extends EventType = EventType> {
  id: string
  type: T
  source: string
  occurredAt: string
  payload: EventPayload<T>
}

export function parseEnvelope(raw: unknown): Envelope {
  const envelope = raw as Envelope
  const schema = eventSchemas[envelope?.type as EventType]
  if (!schema) throw new Error(`Unknown event type: ${String(envelope?.type)}`)
  return { ...envelope, payload: schema.parse(envelope.payload) } as Envelope
}
