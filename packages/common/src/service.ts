import { Redis } from 'ioredis'
import { connectBroker, type Broker } from './broker.ts'
import { createPool, type Pool } from './db.ts'
import { createLogger, type Logger } from './logger.ts'
import { startOutboxRelay } from './outbox.ts'

export interface ServiceDeps {
  name: string
  pool: Pool
  redis: Redis
  broker: Broker
  log: Logger
}

/** Connects a service to its database, Redis and RabbitMQ, and starts its outbox relay. */
export async function connectDeps(name: string, urls: { database: string; redis: string; rabbitmq: string }) {
  const log = createLogger(name)
  const pool = createPool(urls.database)
  const redis = new Redis(urls.redis, { maxRetriesPerRequest: null })
  const broker = await connectBroker(urls.rabbitmq, name, log)
  const stopRelay = startOutboxRelay(pool, broker.publisher, log)
  const deps: ServiceDeps = { name, pool, redis, broker, log }
  const close = async () => {
    stopRelay()
    await broker.close()
    redis.disconnect()
    await pool.end()
  }
  return { deps, close }
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}
