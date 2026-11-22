-- Buyer contact for online orders: phone and an optional note for the local.
-- Run once in the Supabase SQL Editor. It is additive and safe to run again:
-- it only adds two nullable columns to web_orders. No rows are changed or deleted,
-- and shop_products is not touched.
alter table public.web_orders
  add column if not exists customer_phone text,
  add column if not exists customer_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'web_orders_customer_phone_len' and conrelid = 'public.web_orders'::regclass) then
    alter table public.web_orders add constraint web_orders_customer_phone_len check (customer_phone is null or char_length(customer_phone) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'web_orders_customer_note_len' and conrelid = 'public.web_orders'::regclass) then
    alter table public.web_orders add constraint web_orders_customer_note_len check (customer_note is null or char_length(customer_note) <= 300);
  end if;
end $$;

-- Refresh the API cache so the shop and gestión see the new columns right away.
notify pgrst, 'reload schema';
