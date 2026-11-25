-- Bank transfer payments and the online payment surcharge.
-- Run once in the Supabase SQL Editor. It is additive and safe to run again:
--   * adds nullable columns to web_orders: subtotal_amount, surcharge_rate, surcharge_amount,
--     customer_dni and payment_confirmed_at (no rows are changed or deleted),
--   * replaces create_web_order so the order total may include a surcharge saved with the order
--     (orders without a surcharge are checked exactly as before),
--   * adds create_transfer_web_order: saves a transfer order and reserves its stock, like cash,
--   * replaces set_web_order_status with the same actions as before plus 'confirm_payment'
--     (the local saw the transfer arrive) and 'reject' for transfers that were never confirmed.
-- shop_products only changes through the existing stock functions (stock column only).

alter table public.web_orders
  add column if not exists subtotal_amount numeric(12,2),
  add column if not exists surcharge_rate numeric(6,4),
  add column if not exists surcharge_amount numeric(12,2) not null default 0,
  add column if not exists customer_dni text,
  add column if not exists payment_confirmed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'web_orders_surcharge_check' and conrelid = 'public.web_orders'::regclass) then
    alter table public.web_orders add constraint web_orders_surcharge_check check (surcharge_amount >= 0 and (surcharge_rate is null or surcharge_rate between 0 and 1));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'web_orders_customer_dni_len' and conrelid = 'public.web_orders'::regclass) then
    alter table public.web_orders add constraint web_orders_customer_dni_len check (customer_dni is null or customer_dni ~ '^[0-9]{6,9}$');
  end if;
end $$;

-- Header and item snapshots in one transaction. total_amount = items + surcharge_amount (0 when absent).
create or replace function public.create_web_order(p_order jsonb, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal numeric;
  v_surcharge numeric := coalesce(nullif(p_order->>'surcharge_amount', '')::numeric, 0);
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'web order requires at least one item';
  end if;
  select coalesce(sum(item.quantity * item.unit_price), 0) into v_subtotal
  from jsonb_to_recordset(p_items) as item(quantity integer, unit_price numeric);
  if v_surcharge < 0 or (p_order->>'total_amount')::numeric <> v_subtotal + v_surcharge then
    raise exception 'web order total does not match its items';
  end if;

  insert into public.web_orders (
    id, order_number, checkout_key, user_id, customer_name, customer_email,
    pickup_point, payment_method, payment_status, order_status, currency, total_amount,
    subtotal_amount, surcharge_rate, surcharge_amount, customer_dni
  ) values (
    (p_order->>'id')::uuid, p_order->>'order_number', (p_order->>'checkout_key')::uuid,
    (p_order->>'user_id')::uuid, p_order->>'customer_name', p_order->>'customer_email',
    p_order->>'pickup_point', p_order->>'payment_method', p_order->>'payment_status',
    p_order->>'order_status', p_order->>'currency', (p_order->>'total_amount')::numeric,
    v_subtotal, nullif(p_order->>'surcharge_rate', '')::numeric, v_surcharge, nullif(p_order->>'customer_dni', '')
  );

  insert into public.web_order_items (order_id, product_barcode, product_name, image_url, quantity, unit_price)
  select (p_order->>'id')::uuid, item.product_barcode, item.product_name, item.image_url, item.quantity, item.unit_price
  from jsonb_to_recordset(p_items) as item(
    product_barcode text, product_name text, image_url text, quantity integer, unit_price numeric
  );
end;
$$;

-- Creates a transfer order and reserves its stock in one transaction (like cash orders).
create or replace function public.create_transfer_web_order(p_order jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_order->>'payment_method' <> 'transferencia' then raise exception 'transfer order expected'; end if;
  perform public.create_web_order(p_order, p_items);
  return public.apply_web_order_stock((p_order->>'id')::uuid, true);
end;
$$;

-- Status changes made by the local. Returns the updated order.
--   accept          : cash, pending_review -> preparing
--   confirm_payment : transfer waiting for verification -> paid, confirmed (shows under Pagados)
--   ready           : preparing / confirmed -> ready_for_pickup
--   deliver         : preparing / confirmed / ready_for_pickup -> delivered (cash: also marks it paid)
--   reject          : cash order not delivered, or transfer not yet confirmed -> cancelled, stock given back
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

  if p_action = 'accept' and v_order.order_status = 'pending_review' and v_order.payment_method = 'efectivo' then
    update public.web_orders set order_status = 'preparing', reviewed_at = now(), updated_at = now() where id = p_order_id;
  elsif p_action = 'confirm_payment' and v_order.payment_method = 'transferencia'
        and v_order.order_status = 'pending_review' and v_order.payment_status in ('pending', 'pending_verification') then
    update public.web_orders
      set payment_status = 'paid', paid_at = now(), payment_confirmed_at = now(), reviewed_at = now(),
          order_status = 'confirmed', updated_at = now()
      where id = p_order_id;
  elsif p_action = 'ready' and v_order.order_status in ('preparing', 'confirmed') then
    update public.web_orders set order_status = 'ready_for_pickup', updated_at = now() where id = p_order_id;
  elsif p_action = 'deliver' and v_order.order_status in ('preparing', 'confirmed', 'ready_for_pickup')
        and (v_order.payment_method = 'efectivo' or v_order.payment_status = 'paid') then
    update public.web_orders
      set order_status = 'delivered', delivered_at = now(), updated_at = now(),
          payment_status = case when v_order.payment_method = 'efectivo' then 'paid' else payment_status end,
          paid_at = case when v_order.payment_method = 'efectivo' then now() else paid_at end
      where id = p_order_id;
  elsif p_action = 'reject' and (
          (v_order.payment_method = 'efectivo' and v_order.order_status in ('pending_review', 'preparing', 'ready_for_pickup'))
       or (v_order.payment_method = 'transferencia' and v_order.order_status = 'pending_review' and v_order.payment_status <> 'paid')) then
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

revoke all on function public.create_web_order(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.create_transfer_web_order(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.set_web_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_web_order(jsonb, jsonb) to service_role;
grant execute on function public.create_transfer_web_order(jsonb, jsonb) to service_role;
grant execute on function public.set_web_order_status(uuid, text, text) to service_role;

-- Refresh the API cache so the shop and gestión see the new columns and functions right away.
notify pgrst, 'reload schema';
