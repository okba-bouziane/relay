import Fastify from 'fastify'
import { z } from 'zod'
import { dzd, enqueue, markProcessed, record, withTransaction, type Envelope, type ServiceDeps } from '@relay/common'

/**
 * Inventory owns products, prices and stock. It reacts to:
 * - order.created    -> reserve every line, or reject the whole order
 * - payment.captured -> the reservation becomes final
 * - payment.failed   -> compensation: put the stock back
 */
export function createInventoryService(deps: ServiceDeps) {
  const { pool, redis, broker, log } = deps

  async function onOrderCreated(event: Envelope<'order.created'>) {
    const { orderId, items } = event.payload
    const outcome = await withTransaction(pool, async (tx) => {
      if (!(await markProcessed(tx, event.id))) return null

      // A savepoint is a checkpoint inside the transaction. If a later line is out of stock, we
      // roll back to it: the earlier lines' reservations disappear, but the inbox row stays and
      // the rejection event is still written, all in the same commit.
      await tx.query('savepoint reserve')
      const lines = []
      for (const item of items) {
        // Conditional UPDATE: checks and reserves in one statement, so two orders racing for
        // the last unit cannot both win.
        const { rows } = await tx.query<{ price: number }>(
          'update products set stock = stock - $2 where sku = $1 and stock >= $2 returning price',
          [item.sku, item.quantity],
        )
        if (!rows[0]) {
          await tx.query('rollback to savepoint reserve')
          const reason = `Out of stock: ${item.sku}`
          await enqueue(tx, 'stock.rejected', { orderId, reason })
          return { reserved: false as const, reason }
        }
        await tx.query("insert into reservations (order_id, sku, quantity, status) values ($1, $2, $3, 'reserved')", [
          orderId,
          item.sku,
          item.quantity,
        ])
        lines.push({ ...item, unitPrice: rows[0].price })
      }
      const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)
      await enqueue(tx, 'stock.reserved', { orderId, total, lines })
      return { reserved: true as const, total }
    })
    if (!outcome) return log.info({ eventId: event.id }, 'duplicate order.created ignored')
    await record(redis, {
      orderId,
      service: 'inventory',
      step: outcome.reserved ? 'Stock reserved' : 'Stock rejected',
      status: outcome.reserved ? 'ok' : 'failed',
      detail: outcome.reserved ? dzd(outcome.total) : outcome.reason,
    })
  }

  async function onPaymentFailed(event: Envelope<'payment.failed'>) {
    const { orderId } = event.payload
    const released = await withTransaction(pool, async (tx) => {
      if (!(await markProcessed(tx, event.id))) return null
      const { rows } = await tx.query<{ sku: string; quantity: number }>(
        "update reservations set status = 'released' where order_id = $1 and status = 'reserved' returning sku, quantity",
        [orderId],
      )
      for (const r of rows) await tx.query('update products set stock = stock + $2 where sku = $1', [r.sku, r.quantity])
      if (rows.length) await enqueue(tx, 'stock.released', { orderId })
      return rows.length
    })
    if (released)
      await record(redis, {
        orderId,
        service: 'inventory',
        step: 'Stock released',
        status: 'compensated',
        detail: `${released} line(s) back on the shelf`,
      })
  }

  async function onPaymentCaptured(event: Envelope<'payment.captured'>) {
    await withTransaction(pool, async (tx) => {
      if (!(await markProcessed(tx, event.id))) return
      await tx.query("update reservations set status = 'committed' where order_id = $1 and status = 'reserved'", [event.payload.orderId])
    })
  }

  const app = Fastify({ logger: false })
  app.get('/health', async () => ({ ok: true }))
  app.get('/products', async () => (await pool.query('select sku, name, price, stock from products order by name')).rows)
  app.post('/products/:sku/restock', async (request, reply) => {
    const { sku } = z.object({ sku: z.string() }).parse(request.params)
    const { quantity } = z.object({ quantity: z.number().int().positive().max(1000) }).parse(request.body)
    const { rows } = await pool.query('update products set stock = stock + $2 where sku = $1 returning sku, name, price, stock', [
      sku,
      quantity,
    ])
    if (!rows[0]) return reply.code(404).send({ error: 'Unknown product' })
    return rows[0]
  })

  async function start() {
    await broker.consume(['order.created', 'payment.failed', 'payment.captured'], async (event) => {
      if (event.type === 'order.created') await onOrderCreated(event as Envelope<'order.created'>)
      if (event.type === 'payment.failed') await onPaymentFailed(event as Envelope<'payment.failed'>)
      if (event.type === 'payment.captured') await onPaymentCaptured(event as Envelope<'payment.captured'>)
    })
  }

  return { app, start }
}
