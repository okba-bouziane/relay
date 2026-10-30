import { describe, expect, it } from 'vitest'
import { parseEnvelope } from '../../packages/common/src/events.ts'
import { groupByOrder, isStuck } from '../../apps/monitor/src/lib/saga.ts'
import type { Order, TimelineEntry } from '../../apps/monitor/src/lib/types.ts'

const orderId = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

describe('event contracts', () => {
  it('accepts a well-formed envelope', () => {
    const envelope = parseEnvelope({
      id: 'e1',
      type: 'stock.rejected',
      source: 'inventory',
      occurredAt: '2026-10-30T10:00:00Z',
      payload: { orderId, reason: 'Out of stock: KETTLE-2' },
    })
    expect(envelope.payload).toEqual({ orderId, reason: 'Out of stock: KETTLE-2' })
  })

  it('rejects unknown types and bad payloads', () => {
    expect(() => parseEnvelope({ id: 'e1', type: 'order.teleported', payload: {} })).toThrow('Unknown event type')
    expect(() => parseEnvelope({ id: 'e1', type: 'stock.reserved', payload: { orderId, total: 'lots' } })).toThrow()
  })

  it('keeps payment details out of inventory events', () => {
    const reserved = parseEnvelope({ id: 'e2', type: 'stock.reserved', payload: { orderId, total: 100, lines: [], cardToken: 'tok_ok' } })
    expect(reserved.payload).not.toHaveProperty('cardToken')
  })
})

describe('monitor helpers', () => {
  const entry = (id: string, at: string): TimelineEntry => ({ id, orderId, service: 'orders', step: 'x', status: 'ok', at })

  it('groups the timeline by order and drops repeated entries', () => {
    const groups = groupByOrder([
      entry('1-0', '2026-10-30T10:00:00Z'),
      entry('1-0', '2026-10-30T10:00:00Z'),
      entry('2-0', '2026-10-30T10:00:01Z'),
    ])
    expect(groups.get(orderId)?.map((e) => e.id)).toEqual(['1-0', '2-0'])
  })

  it('calls a pending order stuck when nothing happened for a while', () => {
    const order = { id: orderId, status: 'pending', created_at: '2026-10-30T10:00:00Z' } as Order
    const entries = [entry('1-0', '2026-10-30T10:00:01Z')]
    expect(isStuck(order, entries, Date.parse('2026-10-30T10:00:05Z'))).toBe(false)
    expect(isStuck(order, entries, Date.parse('2026-10-30T10:00:20Z'))).toBe(true)
    expect(isStuck({ ...order, status: 'confirmed' }, entries, Date.parse('2026-10-30T11:00:00Z'))).toBe(false)
  })
})
