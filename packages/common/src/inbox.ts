import type { Tx } from './db.ts'

/**
 * Idempotent consumer ("inbox"): RabbitMQ may deliver a message more than once (redelivery after
 * a crash, an outbox row published twice). Recording the event id in the same transaction as the
 * handler's writes means a duplicate is detected and skipped, and a half-done handler leaves no trace.
 * Returns false when the event was already processed.
 */
export async function markProcessed(tx: Tx, eventId: string): Promise<boolean> {
  const result = await tx.query('insert into processed_messages (event_id) values ($1) on conflict do nothing', [eventId])
  return result.rowCount === 1
}
