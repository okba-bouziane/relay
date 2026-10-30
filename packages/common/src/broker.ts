import { connect, type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib'
import { parseEnvelope, type Envelope, type EventType } from './events.ts'
import type { Logger } from './logger.ts'
import type { OutboxRow, Publisher } from './outbox.ts'
import { contextFromHeaders, inSpan, SpanKind } from './tracing.ts'

/** One topic exchange for all domain events; the routing key is the event type ("order.created"). */
export const EXCHANGE = 'relay.events'
/** Messages that keep failing end up here, one dead-letter queue per service. */
export const DEAD_LETTER_EXCHANGE = 'relay.dead-letter'
export const MAX_ATTEMPTS = 3

export type Handler = (event: Envelope) => Promise<void>

export interface Broker {
  publisher: Publisher
  consume(bindings: EventType[], handler: Handler): Promise<void>
  close(): Promise<void>
  queue: string
}

/**
 * Declares the topology (idempotent: safe to run on every start) and returns a publisher and a
 * consumer for one service. Queues are durable and messages persistent, so a RabbitMQ restart
 * loses nothing.
 */
export async function connectBroker(url: string, service: string, log: Logger): Promise<Broker> {
  const connection: ChannelModel = await connect(url)
  const publishChannel: ConfirmChannel = await connection.createConfirmChannel()
  const consumeChannel: Channel = await connection.createChannel()
  const queue = `${service}.events`
  const deadLetterQueue = `${service}.dlq`

  await publishChannel.assertExchange(EXCHANGE, 'topic', { durable: true })
  await publishChannel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true })
  await consumeChannel.assertQueue(queue, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE, 'x-dead-letter-routing-key': queue },
  })
  await consumeChannel.assertQueue(deadLetterQueue, { durable: true })
  await consumeChannel.bindQueue(deadLetterQueue, DEAD_LETTER_EXCHANGE, queue)
  // Handle a few messages at a time per service instance; the rest wait in the queue.
  await consumeChannel.prefetch(10)

  const publisher: Publisher = {
    publish: (row: OutboxRow) =>
      new Promise<void>((resolve, reject) => {
        // A confirm channel calls back once RabbitMQ has safely stored the message. Only then
        // does the outbox mark the row as published.
        publishChannel.publish(
          EXCHANGE,
          row.type,
          Buffer.from(
            JSON.stringify({
              id: row.event_id,
              type: row.type,
              source: service,
              occurredAt: row.created_at.toISOString(),
              payload: row.payload,
            }),
          ),
          { persistent: true, messageId: row.event_id, contentType: 'application/json', headers: row.headers },
          (error) => (error ? reject(error) : resolve()),
        )
      }),
  }

  async function consume(bindings: EventType[], handler: Handler) {
    for (const key of bindings) await consumeChannel.bindQueue(queue, EXCHANGE, key)

    await consumeChannel.consume(queue, (message: ConsumeMessage | null) => {
      if (!message) return
      void handle(message)
    })

    async function handle(message: ConsumeMessage) {
      const headers = (message.properties.headers ?? {}) as Record<string, unknown>
      const attempts = Number(headers['x-attempts'] ?? 0)
      let envelope: Envelope
      try {
        envelope = parseEnvelope(JSON.parse(message.content.toString()))
      } catch (error) {
        // A message that cannot be parsed will never succeed: dead-letter it at once.
        log.error({ err: error }, 'invalid message, sending to dead-letter queue')
        consumeChannel.nack(message, false, false)
        return
      }

      try {
        await inSpan(`consume ${envelope.type}`, SpanKind.CONSUMER, contextFromHeaders(headers), () => handler(envelope))
        consumeChannel.ack(message)
      } catch (error) {
        if (attempts + 1 < MAX_ATTEMPTS) {
          // Retry with exponential backoff: 500 ms, 1 s, ... then give up.
          const delay = 500 * 2 ** attempts
          log.warn({ err: error, type: envelope.type, attempt: attempts + 1, delay }, 'handler failed, retrying')
          await new Promise((r) => setTimeout(r, delay))
          consumeChannel.sendToQueue(queue, message.content, {
            ...message.properties,
            headers: { ...headers, 'x-attempts': attempts + 1, 'x-last-error': (error as Error).message },
          })
          consumeChannel.ack(message)
        } else {
          log.error({ err: error, type: envelope.type }, 'handler failed too many times, dead-lettering')
          consumeChannel.nack(message, false, false)
        }
      }
    }
  }

  return {
    publisher,
    consume,
    queue,
    close: async () => {
      await consumeChannel.close().catch(() => undefined)
      await publishChannel.close().catch(() => undefined)
      await connection.close().catch(() => undefined)
    },
  }
}
