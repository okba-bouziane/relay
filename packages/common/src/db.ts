import pg from 'pg'

export type Pool = pg.Pool
export type Tx = pg.PoolClient

export function createPool(connectionString: string) {
  return new pg.Pool({ connectionString, max: 10 })
}

/** Runs `work` in one database transaction: everything commits together or nothing does. */
export async function withTransaction<T>(pool: Pool, work: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect()
  try {
    await tx.query('begin')
    const result = await work(tx)
    await tx.query('commit')
    return result
  } catch (error) {
    await tx.query('rollback')
    throw error
  } finally {
    tx.release()
  }
}

/** The tables every service needs for reliable messaging. */
export const MESSAGING_TABLES = `
create table if not exists outbox (
  id           bigint generated always as identity primary key,
  event_id     uuid not null unique,
  type         text not null,
  payload      jsonb not null,
  headers      jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_unpublished_idx on outbox (id) where published_at is null;

create table if not exists processed_messages (
  event_id     uuid primary key,
  processed_at timestamptz not null default now()
);
`
