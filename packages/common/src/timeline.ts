import type { Redis } from 'ioredis'

export const TIMELINE_STREAM = 'relay:timeline'

export interface TimelineEntry {
  orderId: string
  service: string
  step: string
  status: 'ok' | 'failed' | 'compensated' | 'info'
  detail?: string
  traceId?: string | null
}

/**
 * A Redis Stream is an append-only log with ids ordered by time. Every service writes what it
 * did for an order; the monitor reads the stream live (XREAD BLOCK) and replays it on load.
 * It is for humans watching, not for business logic: losing it never breaks an order.
 */
export async function record(redis: Redis, entry: TimelineEntry) {
  await redis.xadd(TIMELINE_STREAM, 'MAXLEN', '~', '5000', '*', 'data', JSON.stringify({ ...entry, at: new Date().toISOString() }))
}

/** "44800" -> "44 800 DA", for timeline details people read. */
export function dzd(amount: number) {
  return `${new Intl.NumberFormat('fr-DZ').format(amount).replace(/\s/g, ' ')} DA`
}
