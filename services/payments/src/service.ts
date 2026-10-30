import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { dzd, enqueue, markProcessed, record, withTransaction, type Envelope, type ServiceDeps } from '@relay/common'

export const CHAOS_KEY = 'relay:chaos'
const CARD_LIMIT = 500_000

/**
 * A pretend card gateway. Test tokens choose the outcome:
 *   tok_ok (or anything else) -> approved
 *   tok_declined              -> declined by the issuer
 *   tok_insufficient          -> not enough funds
 * Amounts over the card limit are declined. When "gateway down" chaos is on, every call throws:
 * the message is retried, then lands in the dead-letter queue.
 */
async function charge(
  redis: ServiceDeps['redis'],
  cardToken: string,
  amount: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const chaos = await redis.hgetall(CHAOS_KEY)
  const delay = Number(chaos.delayMs ?? 0)
  if (delay > 0) await new Promise((r) => setTimeout(r, delay))
  if (chaos.gatewayDown === '1') throw new Error('Card gateway timeout')
  if (cardToken === 'tok_declined') return { ok: false, reason: 'Card declined by the issuer' }
  if (cardToken === 'tok_insufficient') return { ok: false, reason: 'Insufficient funds' }
  if (amount > CARD_LIMIT) return { ok: false, reason: 'Over the card limit' }
  return { ok: true }
}

/**
 * Payments stores the card token as soon as an order exists, and charges only once inventory has
 * reserved the stock (stock.reserved carries the final total).
 */
export function createPaymentsService(deps: ServiceDeps) {
  const { pool, redis, broker, log } = deps

  async function onOrderCreated(event: Envelope<'order.created'>) {
    await withTransaction(pool, async (tx) => {
      if (!(await markProcessed(tx, event.id))) return
      await tx.query("insert into payments (order_id, card_token, status) values ($1, $2, 'awaiting_stock') on conflict do nothing", [
        event.payload.orderId,
        event.payload.cardToken,
      ])
    })
  }

  async function onStockRejected(event: Envelope<'stock.rejected'>) {
    await withTransaction(pool, async (tx) => {
      if (!(await markProcessed(tx, event.id))) return
      await tx.query(
        "update payments set status = 'voided', reason = $2, updated_at = now() where order_id = $1 and status = 'awaiting_stock'",
        [event.payload.orderId, event.payload.reason],
      )
    })
  }

  async function onStockReserved(event: Envelope<'stock.reserved'>) {
    const { orderId, total } = event.payload
    // Read first, charge outside the transaction (a slow gateway must not hold row locks),
    // then record the result atomically with the inbox row and the outgoing event.
    const { rows } = await pool.query<{ card_token: string; status: string }>(
      'select card_token, status from payments where order_id = $1',
      [orderId],
    )
    const payment = rows[0]
    if (!payment) throw new Error(`No payment record for order ${orderId} yet`)
    if (payment.status !== 'awaiting_stock') return log.info({ orderId }, 'payment already settled, ignoring')

    const result = await charge(redis, payment.card_token, total)

    const applied = await withTransaction(pool, async (tx) => {
      if (!(await markProcessed(tx, event.id))) return false
      if (result.ok) {
        const paymentId = randomUUID()
        await tx.query("update payments set status = 'captured', amount = $2, payment_id = $3, updated_at = now() where order_id = $1", [
          orderId,
          total,
          paymentId,
        ])
        await enqueue(tx, 'payment.captured', { orderId, paymentId, amount: total })
      } else {
        await tx.query("update payments set status = 'declined', amount = $2, reason = $3, updated_at = now() where order_id = $1", [
          orderId,
          total,
          result.reason,
        ])
        await enqueue(tx, 'payment.failed', { orderId, reason: result.reason })
      }
      return true
    })
    if (applied) {
      await record(redis, {
        orderId,
        service: 'payments',
        step: result.ok ? 'Payment captured' : 'Payment declined',
        status: result.ok ? 'ok' : 'failed',
        detail: result.ok ? dzd(total) : result.reason,
      })
    }
  }

  const app = Fastify({ logger: false })
  app.get('/health', async () => ({ ok: true }))
  app.get(
    '/payments',
    async () =>
      (await pool.query('select order_id, amount, status, reason, updated_at from payments order by updated_at desc limit 50')).rows,
  )

  async function start() {
    await broker.consume(['order.created', 'stock.reserved', 'stock.rejected'], async (event) => {
      if (event.type === 'order.created') await onOrderCreated(event as Envelope<'order.created'>)
      if (event.type === 'stock.reserved') await onStockReserved(event as Envelope<'stock.reserved'>)
      if (event.type === 'stock.rejected') await onStockRejected(event as Envelope<'stock.rejected'>)
    })
  }

  return { app, start }
}
