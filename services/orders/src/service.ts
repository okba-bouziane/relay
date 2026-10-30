import { randomUUID } from 'node:crypto'
import cors from '@fastify/cors'
import { connect } from 'amqplib'
import Fastify from 'fastify'
import { z } from 'zod'
import {
  currentTraceId,
  enqueue,
  markProcessed,
  record,
  TIMELINE_STREAM,
  withTransaction,
  type Envelope,
  type ServiceDeps,
} from '@relay/common'

const CHAOS_KEY = 'relay:chaos'
const SERVICES = ['orders', 'inventory', 'payments'] as const

export interface OrdersConfig {
  rabbitmqUrl: string
  rabbitmqManagementUrl?: string
  serviceUrls: { inventory: string; payments: string }
}

const newOrder = z.object({
  customer: z.string().trim().min(2).max(80),
  items: z
    .array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive().max(20) }))
    .min(1)
    .max(10),
  cardToken: z.string().min(3).max(40),
})

/**
 * Orders starts the saga and listens for its outcome. It never calls inventory or payments
 * directly: it publishes order.created and reacts to what the others publish (choreography).
 */
export function createOrdersService(deps: ServiceDeps, config: OrdersConfig) {
  const { pool, redis, broker, log } = deps

  /** Moves a pending order to its final state. The `status = 'pending'` guard makes it idempotent. */
  async function settle(event: Envelope, orderId: string, status: 'confirmed' | 'cancelled', reason: string | null) {
    const changed = await withTransaction(pool, async (tx) => {
      if (!(await markProcessed(tx, event.id))) return false
      const result = await tx.query("update orders set status = $2, reason = $3, updated_at = now() where id = $1 and status = 'pending'", [
        orderId,
        status,
        reason,
      ])
      return result.rowCount === 1
    })
    if (changed) {
      await record(redis, {
        orderId,
        service: 'orders',
        step: status === 'confirmed' ? 'Order confirmed' : 'Order cancelled',
        status: status === 'confirmed' ? 'ok' : 'failed',
        detail: reason ?? undefined,
      })
    }
  }

  async function start() {
    await broker.consume(['stock.reserved', 'stock.rejected', 'payment.captured', 'payment.failed'], async (event) => {
      switch (event.type) {
        case 'stock.reserved': {
          const { orderId, total } = (event as Envelope<'stock.reserved'>).payload
          await withTransaction(pool, async (tx) => {
            if (await markProcessed(tx, event.id))
              await tx.query('update orders set total = $2, updated_at = now() where id = $1', [orderId, total])
          })
          break
        }
        case 'stock.rejected': {
          const { orderId, reason } = (event as Envelope<'stock.rejected'>).payload
          await settle(event, orderId, 'cancelled', reason)
          break
        }
        case 'payment.captured':
          await settle(event, (event as Envelope<'payment.captured'>).payload.orderId, 'confirmed', null)
          break
        case 'payment.failed': {
          const { orderId, reason } = (event as Envelope<'payment.failed'>).payload
          await settle(event, orderId, 'cancelled', reason)
          break
        }
      }
    })
  }

  const app = Fastify({ logger: false })
  void app.register(cors, { origin: true })

  app.get('/health', async () => ({ ok: true }))

  /**
   * Creates an order and its order.created event in one transaction (outbox). An optional
   * Idempotency-Key makes retries safe: Redis SET NX remembers the first order for 24 hours.
   */
  app.post('/orders', async (request, reply) => {
    const input = newOrder.parse(request.body)
    const key = request.headers['idempotency-key']
    const orderId = randomUUID()
    if (typeof key === 'string' && key.length > 0) {
      const claimed = await redis.set(`relay:idem:${key}`, orderId, 'EX', 86_400, 'NX')
      if (!claimed) {
        const existingId = await redis.get(`relay:idem:${key}`)
        const { rows } = await pool.query('select * from orders where id = $1', [existingId])
        return reply
          .code(200)
          .header('idempotent-replayed', 'true')
          .send(rows[0] ?? { id: existingId })
      }
    }
    const traceId = currentTraceId()
    const order = await withTransaction(pool, async (tx) => {
      const { rows } = await tx.query('insert into orders (id, customer, items, trace_id) values ($1, $2, $3, $4) returning *', [
        orderId,
        input.customer,
        JSON.stringify(input.items),
        traceId,
      ])
      await enqueue(tx, 'order.created', { orderId, customer: input.customer, items: input.items, cardToken: input.cardToken })
      return rows[0]
    })
    await record(redis, { orderId, service: 'orders', step: 'Order placed', status: 'info', detail: input.customer, traceId })
    return reply.code(201).send(order)
  })

  app.get('/orders', async () => (await pool.query('select * from orders order by created_at desc limit 40')).rows)

  app.get('/orders/:id', async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const { rows } = await pool.query('select * from orders where id = $1', [id])
    return rows[0] ?? reply.code(404).send({ error: 'Order not found' })
  })

  /**
   * Server-Sent Events: one long HTTP response the browser reads with EventSource. First the
   * recent history, then every new timeline entry as it is written (XREAD BLOCK waits on Redis).
   */
  app.get('/timeline/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    })
    // writeHead() alone only queues the headers. With an empty timeline nothing else would be
    // written until the first keep-alive, and the browser would not report the stream as open.
    reply.raw.flushHeaders()
    reply.raw.write(': connected\n\n')
    const reader = redis.duplicate() // XREAD BLOCK occupies a connection, so each client gets its own
    let open = true
    request.raw.on('close', () => {
      open = false
      reader.disconnect()
    })
    const send = (id: string, data: string) => reply.raw.write(`id: ${id}\ndata: ${data}\n\n`)

    const history = (await redis.xrevrange(TIMELINE_STREAM, '+', '-', 'COUNT', 300)).reverse()
    let lastId = '$'
    for (const [id, fields] of history) {
      send(id, fields[1]!)
      lastId = id
    }
    void (async () => {
      while (open) {
        const result = await reader.xread('BLOCK', 15_000, 'STREAMS', TIMELINE_STREAM, lastId).catch(() => null)
        if (!open) break
        if (!result) {
          reply.raw.write(': keep-alive\n\n')
          continue
        }
        for (const [id, fields] of result[0]![1]) {
          send(id, fields[1]!)
          lastId = id
        }
      }
    })()
    return reply
  })

  /** Health of the three services and the depth of every queue, for the monitor. */
  app.get('/system', async () => {
    const health = await Promise.all(
      SERVICES.map(async (name) => {
        if (name === 'orders') return { name, ok: true }
        const ok = await fetch(`${config.serviceUrls[name]}/health`, { signal: AbortSignal.timeout(1500) })
          .then((r) => r.ok)
          .catch(() => false)
        return { name, ok }
      }),
    )
    let queues: { name: string; messages: number; consumers: number }[] = []
    if (config.rabbitmqManagementUrl) {
      const url = new URL('/api/queues', config.rabbitmqManagementUrl)
      const auth = Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')
      url.username = ''
      url.password = ''
      queues = await fetch(url, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(1500) })
        .then((r) => (r.ok ? (r.json() as Promise<{ name: string; messages: number; consumers: number }[]>) : []))
        .then((list) =>
          list
            .filter((q) => q.name.endsWith('.events') || q.name.endsWith('.dlq'))
            .map(({ name, messages, consumers }) => ({ name, messages, consumers })),
        )
        .catch(() => [])
    }
    const chaos = await redis.hgetall(CHAOS_KEY)
    return { services: health, queues, chaos: { gatewayDown: chaos.gatewayDown === '1', delayMs: Number(chaos.delayMs ?? 0) } }
  })

  app.put('/chaos', async (request) => {
    const input = z.object({ gatewayDown: z.boolean(), delayMs: z.number().int().min(0).max(5000) }).parse(request.body)
    await redis.hset(CHAOS_KEY, { gatewayDown: input.gatewayDown ? '1' : '0', delayMs: String(input.delayMs) })
    return input
  })

  /** Moves dead-lettered messages back to their service queue with a fresh retry budget. */
  app.post('/dlq/:service/replay', async (request) => {
    const { service } = z.object({ service: z.enum(SERVICES) }).parse(request.params)
    const connection = await connect(config.rabbitmqUrl)
    const channel = await connection.createChannel()
    let moved = 0
    try {
      for (let message = await channel.get(`${service}.dlq`); message; message = await channel.get(`${service}.dlq`)) {
        const headers = { ...(message.properties.headers ?? {}) }
        delete headers['x-attempts']
        delete headers['x-death']
        channel.sendToQueue(`${service}.events`, message.content, { ...message.properties, headers })
        channel.ack(message)
        moved++
      }
    } finally {
      await channel.close()
      await connection.close()
    }
    log.info({ service, moved }, 'replayed dead-lettered messages')
    return { moved }
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', issues: error.issues })
    log.error({ err: error }, 'request failed')
    return reply.code(500).send({ error: 'Internal error' })
  })

  return { app, start }
}
