import { migrateService } from '../../scripts/migrate.ts'

/**
 * Integration tests use their own databases (*_test), their own RabbitMQ virtual host and their
 * own Redis database, so they can run while the dev stack is up without stealing its messages.
 */
export const TEST_ENV = {
  rabbitmq: 'amqp://guest:guest@localhost:5673/relay-test',
  management: 'http://localhost:15673',
  redis: 'redis://localhost:6391/1',
  db: (service: string) => `postgres://relay:relay@localhost:5445/${service}_test`,
}

export default async function setup() {
  const auth = { authorization: `Basic ${Buffer.from('guest:guest').toString('base64')}`, 'content-type': 'application/json' }
  await fetch(`${TEST_ENV.management}/api/vhosts/relay-test`, { method: 'PUT', headers: auth })
  await fetch(`${TEST_ENV.management}/api/permissions/relay-test/guest`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ configure: '.*', write: '.*', read: '.*' }),
  })
  for (const service of ['orders', 'inventory', 'payments']) await migrateService(service, TEST_ENV.db(service))
}
