create table if not exists products (
  sku   text primary key,
  name  text not null,
  price integer not null check (price > 0),
  -- Available units. Reserved units are subtracted at once, so stock can never go negative.
  stock integer not null check (stock >= 0)
);

create table if not exists reservations (
  order_id uuid not null,
  sku      text not null references products (sku),
  quantity integer not null check (quantity > 0),
  status   text not null check (status in ('reserved', 'committed', 'released')),
  primary key (order_id, sku)
);
