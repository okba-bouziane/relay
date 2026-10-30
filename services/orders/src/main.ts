import { connectDeps, requireEnv } from '@relay/common'
import { createOrdersService } from './service.ts'

const { deps, close } = await connectDeps('orders', {
  database: requireEnv('ORDERS_DATABASE_URL'),
  redis: requireEnv('REDIS_URL'),
  rabbitmq: requireEnv('RABBITMQ_URL'),
})
const service = createOrdersService(deps, {
  rabbitmqUrl: requireEnv('RABBITMQ_URL'),
  rabbitmqManagementUrl: process.env.RABBITMQ_MANAGEMENT_URL,
  serviceUrls: {
    inventory: process.env.INVENTORY_URL ?? `http://localhost:${process.env.INVENTORY_PORT ?? 3442}`,
    payments: process.env.PAYMENTS_URL ?? `http://localhost:${process.env.PAYMENTS_PORT ?? 3443}`,
  },
})
await service.start()
const port = Number(process.env.ORDERS_PORT)
await service.app.listen({ port, host: '0.0.0.0' })
deps.log.info(`orders listening on http://localhost:${port}`)

// Graceful shutdown: stop taking HTTP requests, then close the broker and the pools.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await service.app.close()
    await close()
    process.exit(0)
  })
}
