create table if not exists orders (
  id         uuid primary key,
  customer   text not null,
  items      jsonb not null,
  total      integer,
  status     text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  reason     text,
  trace_id   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_created_idx on orders (created_at desc);
