// Resets every service's data and stocks the catalog. Run: npm run db:seed
import { Redis } from 'ioredis'
import { createPool } from '@relay/common'

const products = [
  ['PHONE-128', 'Smartphone 128 GB', 42_000, 25],
  ['LAPTOP-15', 'Laptop 15"', 128_000, 6],
  ['TV-55', 'Television 55"', 96_000, 4],
  ['COUSCOUS-5', 'Couscous, 5 kg', 1_250, 200],
  ['OLIVE-5L', 'Olive oil, 5 L', 7_800, 60],
  ['DATES-1', 'Deglet Nour dates, 1 kg', 1_400, 150],
  ['FAN-40', 'Standing fan', 8_900, 12],
  ['KETTLE-2', 'Electric kettle', 4_300, 1],
] as const

const inventory = createPool(process.env.INVENTORY_DATABASE_URL!)
await inventory.query('truncate reservations, products, outbox, processed_messages')
for (const [sku, name, price, stock] of products) {
  await inventory.query('insert into products (sku, name, price, stock) values ($1, $2, $3, $4)', [sku, name, price, stock])
}
await inventory.end()

for (const db of ['ORDERS', 'PAYMENTS']) {
  const pool = createPool(process.env[`${db}_DATABASE_URL`]!)
  await pool.query(`truncate ${db === 'ORDERS' ? 'orders' : 'payments'}, outbox, processed_messages`)
  await pool.end()
}

const redis = new Redis(process.env.REDIS_URL!)
await redis.del('relay:timeline', 'relay:chaos')
redis.disconnect()
console.log(`Seeded ${products.length} products; orders, payments and the timeline are empty.`)
