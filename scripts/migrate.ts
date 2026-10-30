// Applies each service's SQL migrations to that service's own database.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createPool, MESSAGING_TABLES } from '@relay/common'

export async function migrateService(service: string, url: string) {
  const pool = createPool(url)
  const dir = path.resolve(import.meta.dirname, `../services/${service}/migrations`)
  await pool.query(MESSAGING_TABLES)
  for (const file of (await readdir(dir)).sort()) {
    await pool.query(await readFile(path.join(dir, file), 'utf8'))
  }
  await pool.end()
}

if (import.meta.main) {
  for (const service of ['orders', 'inventory', 'payments']) {
    await migrateService(service, process.env[`${service.toUpperCase()}_DATABASE_URL`]!)
    console.log(`migrated ${service}`)
  }
}
