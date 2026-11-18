-- Draft only: review before applying to the shared Supabase project.
-- Adds separate online-order tables; does not alter shop_products or shop_purchases.
create table if not exists public.web_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  checkout_key uuid not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_name text not null,
  customer_email text not null,
  pickup_point text not null check (pickup_point in ('Coto Lanús', 'Ciclón Caraza', 'UPA Recondo', 'Maxi Carrefour', 'Santa Marta')),
  payment_method text not null check (payment_method in ('mercado_pago', 'transferencia', 'efectivo')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'pending_verification', 'paid', 'failed', 'refunded')),
  order_status text not null default 'awaiting_payment' check (order_status in ('awaiting_payment', 'confirmed', 'preparing', 'ready_for_pickup', 'delivered', 'cancelled')),
  currency text not null default 'ARS' check (currency = 'ARS'),
  total_amount numeric(12,2) not null check (total_amount > 0),
  mp_order_id text unique,
  mp_checkout_url text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.web_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.web_orders(id) on delete restrict,
  product_barcode text not null,
  product_name text not null,
  image_url text,
  quantity integer not null check (quantity between 1 and 99),
  unit_price numeric(12,2) not null check (unit_price > 0),
  line_total numeric(12,2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now()
);

create index if not exists web_orders_user_created_idx on public.web_orders(user_id, created_at desc);
create index if not exists web_orders_payment_status_idx on public.web_orders(payment_status, created_at desc);
create index if not exists web_order_items_order_idx on public.web_order_items(order_id);

-- Keep header and immutable item snapshots in one transaction.
create or replace function public.create_web_order(p_order jsonb, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'web order requires at least one item';
  end if;
  if (p_order->>'total_amount')::numeric <> (
    select coalesce(sum(item.quantity * item.unit_price), 0)
    from jsonb_to_recordset(p_items) as item(quantity integer, unit_price numeric)
  ) then
    raise exception 'web order total does not match its items';
  end if;

  insert into public.web_orders (
    id, order_number, checkout_key, user_id, customer_name, customer_email,
    pickup_point, payment_method, payment_status, order_status, currency, total_amount
  ) values (
    (p_order->>'id')::uuid, p_order->>'order_number', (p_order->>'checkout_key')::uuid,
    (p_order->>'user_id')::uuid, p_order->>'customer_name', p_order->>'customer_email',
    p_order->>'pickup_point', p_order->>'payment_method', p_order->>'payment_status',
    p_order->>'order_status', p_order->>'currency', (p_order->>'total_amount')::numeric
  );

  insert into public.web_order_items (order_id, product_barcode, product_name, image_url, quantity, unit_price)
  select (p_order->>'id')::uuid, item.product_barcode, item.product_name, item.image_url, item.quantity, item.unit_price
  from jsonb_to_recordset(p_items) as item(
    product_barcode text, product_name text, image_url text, quantity integer, unit_price numeric
  );
end;
$$;
revoke all on function public.create_web_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_web_order(jsonb, jsonb) to service_role;

alter table public.web_orders enable row level security;
alter table public.web_order_items enable row level security;

create policy "Customers read their own web orders" on public.web_orders
  for select using (auth.uid() = user_id);
create policy "Customers read items of their own web orders" on public.web_order_items
  for select using (exists (
    select 1 from public.web_orders o where o.id = web_order_items.order_id and o.user_id = auth.uid()
  ));

-- No customer insert/update/delete policies: privileged server endpoints own all writes.
