-- Pickup options for online orders: at one of the two shops or at a meeting point with 3 possible dates.
-- Run once in the Supabase SQL Editor. It is additive and safe to run again:
--   * adds web_orders.pickup_type ('local' or 'encuentro') and web_orders.pickup_dates (up to 3 dates),
--   * widens the pickup_point rule so it also accepts 'Local Itatí' and 'Local La Haya'
--     (every value accepted before is still accepted).
-- No rows are changed or deleted, and shop_products is not touched.
alter table public.web_orders
  add column if not exists pickup_type text,
  add column if not exists pickup_dates date[];

do $$
declare r record;
begin
  if not exists (select 1 from pg_constraint where conname = 'web_orders_pickup_type_check' and conrelid = 'public.web_orders'::regclass) then
    alter table public.web_orders add constraint web_orders_pickup_type_check check (pickup_type is null or pickup_type in ('local', 'encuentro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'web_orders_pickup_dates_len' and conrelid = 'public.web_orders'::regclass) then
    alter table public.web_orders add constraint web_orders_pickup_dates_len check (pickup_dates is null or cardinality(pickup_dates) <= 3);
  end if;

  for r in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.web_orders'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%pickup_point%'
  loop
    execute format('alter table public.web_orders drop constraint %I', r.conname);
  end loop;
  alter table public.web_orders add constraint web_orders_pickup_point_check check (pickup_point in (
    'Local Itatí', 'Local La Haya',
    'Coto Lanús', 'Ciclón Caraza', 'UPA Recondo', 'Maxi Carrefour', 'Santa Marta'
  ));
end $$;

-- Refresh the API cache so the shop and gestión see the new columns right away.
notify pgrst, 'reload schema';
