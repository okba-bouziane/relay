import { connectDeps, requireEnv } from '@relay/common'
import { createInventoryService } from './service.ts'

const { deps, close } = await connectDeps('inventory', {
  database: requireEnv('INVENTORY_DATABASE_URL'),
  redis: requireEnv('REDIS_URL'),
  rabbitmq: requireEnv('RABBITMQ_URL'),
})
const service = createInventoryService(deps)
await service.start()
const port = Number(process.env.INVENTORY_PORT)
await service.app.listen({ port, host: '0.0.0.0' })
deps.log.info(`inventory listening on http://localhost:${port}`)

// Graceful shutdown: stop taking HTTP requests, then close the broker and the pools.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await service.app.close()
    await close()
    process.exit(0)
  })
}
