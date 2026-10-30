import { randomUUID } from 'node:crypto'
import type { Pool, Tx } from './db.ts'
import type { EventPayload, EventType } from './events.ts'
import type { Logger } from './logger.ts'
import { currentTraceHeaders } from './tracing.ts'

/**
 * Transactional outbox, part 1: instead of publishing to RabbitMQ in the middle of a request
 * (and risking "row saved but message lost", or "message sent but transaction rolled back"),
 * the event is inserted into the `outbox` table in the SAME transaction as the business change.
 */
export async function enqueue<T extends EventType>(tx: Tx, type: T, payload: EventPayload<T>) {
  await tx.query('insert into outbox (event_id, type, payload, headers) values ($1, $2, $3, $4)', [
    randomUUID(),
    type,
    payload,
    currentTraceHeaders(),
  ])
}

export interface Publisher {
  publish(row: OutboxRow): Promise<void>
}

export interface OutboxRow {
  id: string
  event_id: string
  type: string
  payload: unknown
  headers: Record<string, string>
  created_at: Date
}

/**
 * Transactional outbox, part 2: a relay loop publishes committed rows and marks them sent.
 * FOR UPDATE SKIP LOCKED lets several instances of a service run relays without sending the
 * same row twice. If the process dies after publishing but before marking, the row is sent
 * again on restart: delivery is "at least once", which is why consumers deduplicate (inbox.ts).
 */
export async function relayOnce(pool: Pool, publisher: Publisher, batchSize = 50): Promise<number> {
  const tx = await pool.connect()
  try {
    await tx.query('begin')
    const { rows } = await tx.query<OutboxRow>(
      'select * from outbox where published_at is null order by id limit $1 for update skip locked',
      [batchSize],
    )
    for (const row of rows) {
      await publisher.publish(row)
    }
    if (rows.length) {
      await tx.query('update outbox set published_at = now() where id = any($1)', [rows.map((r) => r.id)])
    }
    await tx.query('commit')
    return rows.length
  } catch (error) {
    await tx.query('rollback')
    throw error
  } finally {
    tx.release()
  }
}

export function startOutboxRelay(pool: Pool, publisher: Publisher, log: Logger, intervalMs = 200) {
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  const tick = async () => {
    try {
      // Drain quickly while there is work, then wait for the next tick.
      while (!stopped && (await relayOnce(pool, publisher)) > 0) {
        /* keep going */
      }
    } catch (error) {
      log.error({ err: error }, 'outbox relay failed, will retry')
    }
    if (!stopped) timer = setTimeout(tick, intervalMs)
  }
  void tick()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
