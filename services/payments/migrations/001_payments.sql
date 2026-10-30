create table if not exists payments (
  order_id   uuid primary key,
  card_token text not null,
  amount     integer,
  status     text not null check (status in ('awaiting_stock', 'captured', 'declined', 'voided')),
  reason     text,
  payment_id uuid,
  updated_at timestamptz not null default now()
);
