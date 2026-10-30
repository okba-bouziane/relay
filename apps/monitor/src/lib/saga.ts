import type { Order, Service, TimelineEntry } from './types'

export const SERVICES: Service[] = ['orders', 'inventory', 'payments']

/** Groups timeline entries by order, oldest first, keeping only the first copy of each id. */
export function groupByOrder(entries: TimelineEntry[]): Map<string, TimelineEntry[]> {
  const seen = new Set<string>()
  const groups = new Map<string, TimelineEntry[]>()
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    groups.set(entry.orderId, [...(groups.get(entry.orderId) ?? []), entry])
  }
  return groups
}

/** How long the saga took, from the first entry to the last, in milliseconds. */
export function duration(entries: TimelineEntry[]): number | null {
  if (entries.length < 2) return null
  return new Date(entries.at(-1)!.at).getTime() - new Date(entries[0]!.at).getTime()
}

/** A pending order whose last step is older than this is probably stuck (dead-lettered message). */
export const STUCK_AFTER_MS = 8000

export function isStuck(order: Order, entries: TimelineEntry[], now: number): boolean {
  if (order.status !== 'pending') return false
  const last = entries.at(-1)?.at ?? order.created_at
  return now - new Date(last).getTime() > STUCK_AFTER_MS
}

export function formatDzd(amount: number) {
  return `${new Intl.NumberFormat('fr-DZ').format(amount).replace(/\s/g, ' ')} DA`
}
