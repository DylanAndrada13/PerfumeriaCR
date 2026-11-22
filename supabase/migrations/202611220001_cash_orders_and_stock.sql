-- Cash orders and stock discount for the online shop.
-- Run once in the Supabase SQL Editor. It is additive and safe to run again:
--   * adds columns to web_orders (no data is removed),
--   * adds the order status 'pending_review' for cash orders waiting for the local,
--   * adds functions that change ONLY shop_products.stock of the products in an order.
-- It never inserts, deletes or overwrites products, and never touches other columns of shop_products.

alter table public.web_orders
  add column if not exists stock_applied_at timestamptz,
  add column if not exists stock_restored_at timestamptz,
  add column if not exists stock_shortage jsonb,
  add column if not exists reviewed_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists status_note text;

-- Allow 'pending_review' (cash order the local has not accepted yet).
do $$
declare constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname = 'web_orders' and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%order_status%';
  if constraint_name is not null then
    execute format('alter table public.web_orders drop constraint %I', constraint_name);
  end if;
  alter table public.web_orders add constraint web_orders_order_status_check check (order_status in (
    'pending_review', 'awaiting_payment', 'confirmed', 'preparing', 'ready_for_pickup', 'delivered', 'cancelled'
  ));
end $$;

create index if not exists web_orders_order_status_idx on public.web_orders(order_status, created_at desc);

-- Discounts the stock of every product in the order exactly once (guarded by stock_applied_at and a row lock).
-- p_strict = true  (cash orders): fails if any product lacks stock, so the whole order is rolled back.
-- p_strict = false (Mercado Pago, already paid): never goes below 0 and records any shortage for the local.
create or replace function public.apply_web_order_stock(p_order_id uuid, p_strict boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.web_orders%rowtype;
  v_line record;
  v_current integer;
  v_shortage jsonb := '[]'::jsonb;
begin
  select * into v_order from public.web_orders where id = p_order_id for update;
  if not found then raise exception 'web order % not found', p_order_id; end if;
  if v_order.stock_applied_at is not null then
    return jsonb_build_object('applied', false, 'already_applied', true);
  end if;

  for v_line in
    select product_barcode, sum(quantity)::integer as quantity
    from public.web_order_items where order_id = p_order_id
    group by product_barcode order by product_barcode
  loop
    update public.shop_products
      set stock = stock - v_line.quantity
      where barcode = v_line.product_barcode and stock >= v_line.quantity;
    if not found then
      if p_strict then
        raise exception 'insufficient_stock:%', v_line.product_barcode using errcode = 'P0001';
      end if;
      select stock into v_current from public.shop_products where barcode = v_line.product_barcode for update;
      if found then
        update public.shop_products set stock = 0 where barcode = v_line.product_barcode;
      end if;
      v_shortage := v_shortage || jsonb_build_object('barcode', v_line.product_barcode, 'requested', v_line.quantity, 'available', coalesce(v_current, 0));
    end if;
  end loop;

  update public.web_orders
    set stock_applied_at = now(),
        stock_shortage = case when jsonb_array_length(v_shortage) > 0 then v_shortage else null end,
        updated_at = now()
    where id = p_order_id;
  return jsonb_build_object('applied', true, 'shortage', v_shortage);
end;
$$;

-- Gives back the stock of an order that was discounted and then cancelled. Runs at most once.
create or replace function public.restore_web_order_stock(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.web_orders%rowtype;
  v_line record;
begin
  select * into v_order from public.web_orders where id = p_order_id for update;
  if not found or v_order.stock_applied_at is null or v_order.stock_restored_at is not null then
    return false;
  end if;
  for v_line in
    select i.product_barcode, sum(i.quantity)::integer as quantity
    from public.web_order_items i where i.order_id = p_order_id
    group by i.product_barcode order by i.product_barcode
  loop
    -- Products that were short when discounted only get back what was actually taken.
    update public.shop_products
      set stock = stock + greatest(v_line.quantity - coalesce((
        select (s->>'requested')::integer - (s->>'available')::integer
        from jsonb_array_elements(coalesce(v_order.stock_shortage, '[]'::jsonb)) s
        where s->>'barcode' = v_line.product_barcode limit 1), 0), 0)
      where barcode = v_line.product_barcode;
  end loop;
  update public.web_orders set stock_restored_at = now(), updated_at = now() where id = p_order_id;
  return true;
end;
$$;

-- Creates a cash order and reserves its stock in one transaction.
create or replace function public.create_cash_web_order(p_order jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_order->>'payment_method' <> 'efectivo' then raise exception 'cash order expected'; end if;
  perform public.create_web_order(p_order, p_items);
  return public.apply_web_order_stock((p_order->>'id')::uuid, true);
end;
$$;

-- Status changes made by the local. Returns the updated order.
--   accept  : pending_review -> preparing
--   ready   : preparing / confirmed -> ready_for_pickup
--   deliver : preparing / confirmed / ready_for_pickup -> delivered (cash: also marks it paid)
--   reject  : cash order not delivered -> cancelled, and its stock is given back
create or replace function public.set_web_order_status(p_order_id uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.web_orders%rowtype;
begin
  select * into v_order from public.web_orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if p_action = 'accept' and v_order.order_status = 'pending_review' then
    update public.web_orders set order_status = 'preparing', reviewed_at = now(), updated_at = now() where id = p_order_id;
  elsif p_action = 'ready' and v_order.order_status in ('preparing', 'confirmed') then
    update public.web_orders set order_status = 'ready_for_pickup', updated_at = now() where id = p_order_id;
  elsif p_action = 'deliver' and v_order.order_status in ('preparing', 'confirmed', 'ready_for_pickup')
        and (v_order.payment_method = 'efectivo' or v_order.payment_status = 'paid') then
    update public.web_orders
      set order_status = 'delivered', delivered_at = now(), updated_at = now(),
          payment_status = case when v_order.payment_method = 'efectivo' then 'paid' else payment_status end,
          paid_at = case when v_order.payment_method = 'efectivo' then now() else paid_at end
      where id = p_order_id;
  elsif p_action = 'reject' and v_order.payment_method = 'efectivo'
        and v_order.order_status in ('pending_review', 'preparing', 'ready_for_pickup') then
    perform public.restore_web_order_stock(p_order_id);
    update public.web_orders
      set order_status = 'cancelled', payment_status = 'failed', reviewed_at = coalesce(reviewed_at, now()),
          status_note = left(p_note, 300), updated_at = now()
      where id = p_order_id;
  else
    raise exception 'invalid_transition:%:%', p_action, v_order.order_status;
  end if;

  select * into v_order from public.web_orders where id = p_order_id;
  return to_jsonb(v_order);
end;
$$;

revoke all on function public.apply_web_order_stock(uuid, boolean) from public, anon, authenticated;
revoke all on function public.restore_web_order_stock(uuid) from public, anon, authenticated;
revoke all on function public.create_cash_web_order(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.set_web_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_web_order_stock(uuid, boolean) to service_role;
grant execute on function public.restore_web_order_stock(uuid) to service_role;
grant execute on function public.create_cash_web_order(jsonb, jsonb) to service_role;
grant execute on function public.set_web_order_status(uuid, text, text) to service_role;
