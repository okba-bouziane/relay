import { randomUUID } from 'node:crypto'
import { connect } from 'amqplib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectDeps, EXCHANGE, TIMELINE_STREAM } from '../../packages/common/src/index.ts'
import { createInventoryService } from '../../services/inventory/src/service.ts'
import { createOrdersService } from '../../services/orders/src/service.ts'
import { createPaymentsService } from '../../services/payments/src/service.ts'
import { TEST_ENV } from './setup.ts'

type Started = Awaited<ReturnType<typeof connectDeps>>
const running: Started[] = []
let orders: ReturnType<typeof createOrdersService>
let inventoryDeps: Started['deps']

/** Polls until `check` returns a value, like a person refreshing the page. */
async function eventually<T>(check: () => Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function start(name: string) {
  const started = await connectDeps(name, { database: TEST_ENV.db(name), redis: TEST_ENV.redis, rabbitmq: TEST_ENV.rabbitmq })
  running.push(started)
  return started
}

beforeAll(async () => {
  const o = await start('orders')
  const i = await start('inventory')
  const p = await start('payments')
  inventoryDeps = i.deps
  orders = createOrdersService(o.deps, {
    rabbitmqUrl: TEST_ENV.rabbitmq,
    serviceUrls: { inventory: 'http://localhost:1', payments: 'http://localhost:1' },
  })
  await orders.start()
  await createInventoryService(i.deps).start()
  await createPaymentsService(p.deps).start()
})

afterAll(async () => {
  for (const s of running) await s.close()
})

beforeEach(async () => {
  const [o, i, p] = running.map((s) => s.deps)
  await o!.pool.query('truncate orders, outbox, processed_messages')
  await i!.pool.query('truncate reservations, products, outbox, processed_messages')
  await p!.pool.query('truncate payments, outbox, processed_messages')
  await i!.pool.query("insert into products (sku, name, price, stock) values ('PHONE', 'Phone', 42000, 5), ('KETTLE', 'Kettle', 4300, 1)")
  await o!.redis.del(TIMELINE_STREAM, 'relay:chaos')
})

async function placeOrder(items: { sku: string; quantity: number }[], cardToken = 'tok_ok', key?: string) {
  const res = await orders.app.inject({
    method: 'POST',
    url: '/orders',
    payload: { customer: 'Test', items, cardToken },
    headers: key ? { 'idempotency-key': key } : {},
  })
  return { status: res.statusCode, order: res.json() as { id: string } }
}

const orderStatus = (id: string) => async () => {
  const res = await orders.app.inject({ method: 'GET', url: `/orders/${id}` })
  const order = res.json() as { status: string; total: number | null; reason: string | null }
  return order.status === 'pending' ? null : order
}

const stockOf = async (sku: string) =>
  (await inventoryDeps.pool.query<{ stock: number }>('select stock from products where sku = $1', [sku])).rows[0]!.stock

describe('order saga', () => {
  it('confirms an order when stock and payment succeed', async () => {
    const { order } = await placeOrder([{ sku: 'PHONE', quantity: 2 }])
    const final = await eventually(orderStatus(order.id))
    expect(final).toMatchObject({ status: 'confirmed', total: 84_000 })
    expect(await stockOf('PHONE')).toBe(3)
  })

  it('cancels when stock is short and leaves stock untouched', async () => {
    const { order } = await placeOrder([
      { sku: 'PHONE', quantity: 1 },
      { sku: 'KETTLE', quantity: 2 },
    ])
    const final = await eventually(orderStatus(order.id))
    expect(final).toMatchObject({ status: 'cancelled', reason: 'Out of stock: KETTLE' })
    // The savepoint undid the PHONE reservation made before KETTLE failed.
    expect(await stockOf('PHONE')).toBe(5)
  })

  it('compensates: a declined card puts the reserved stock back', async () => {
    const { order } = await placeOrder([{ sku: 'PHONE', quantity: 1 }], 'tok_declined')
    expect(await eventually(orderStatus(order.id))).toMatchObject({ status: 'cancelled', reason: 'Card declined by the issuer' })
    await eventually(async () => (await stockOf('PHONE')) === 5)
  })

  it('processes a duplicated message only once', async () => {
    const { order } = await placeOrder([{ sku: 'PHONE', quantity: 1 }])
    await eventually(orderStatus(order.id))
    // Publish the same order.created again with the same event id, as a redelivery would.
    const { rows } = await running[0]!.deps.pool.query("select event_id, payload from outbox where type = 'order.created'")
    const connection = await connect(TEST_ENV.rabbitmq)
    const channel = await connection.createChannel()
    channel.publish(
      EXCHANGE,
      'order.created',
      Buffer.from(
        JSON.stringify({
          id: rows[0].event_id,
          type: 'order.created',
          source: 'test',
          occurredAt: new Date().toISOString(),
          payload: rows[0].payload,
        }),
      ),
    )
    await new Promise((r) => setTimeout(r, 800))
    await connection.close()
    expect(await stockOf('PHONE')).toBe(4)
  })

  it('makes order creation idempotent with an Idempotency-Key', async () => {
    const key = randomUUID()
    const first = await placeOrder([{ sku: 'PHONE', quantity: 1 }], 'tok_ok', key)
    const second = await placeOrder([{ sku: 'PHONE', quantity: 1 }], 'tok_ok', key)
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.order.id).toBe(first.order.id)
  })

  it('dead-letters after three failures, then succeeds when replayed', async () => {
    await running[0]!.deps.redis.hset('relay:chaos', { gatewayDown: '1', delayMs: '0' })
    const { order } = await placeOrder([{ sku: 'PHONE', quantity: 1 }])

    // 1st try + 2 retries (0.5 s, 1 s backoff), then the dead-letter queue.
    const connection = await connect(TEST_ENV.rabbitmq)
    const channel = await connection.createChannel()
    await eventually(async () => (await channel.checkQueue('payments.dlq')).messageCount === 1, 15_000)
    expect((await orders.app.inject({ method: 'GET', url: `/orders/${order.id}` })).json()).toMatchObject({ status: 'pending' })

    await running[0]!.deps.redis.hset('relay:chaos', { gatewayDown: '0' })
    const replay = await orders.app.inject({ method: 'POST', url: '/dlq/payments/replay' })
    expect(replay.json()).toEqual({ moved: 1 })
    expect(await eventually(orderStatus(order.id))).toMatchObject({ status: 'confirmed' })
    await connection.close()
  })
})
