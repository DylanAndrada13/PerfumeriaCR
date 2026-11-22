-- Makes sure web_orders accepts every value the shop uses (cash orders included).
-- Safe to run more than once: it replaces only the CHECK rules on payment_method, payment_status
-- and order_status of web_orders. No rows are changed or deleted.
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.web_orders'::regclass and con.contype = 'c'
      and (pg_get_constraintdef(con.oid) ilike '%payment_method%'
        or pg_get_constraintdef(con.oid) ilike '%payment_status%'
        or pg_get_constraintdef(con.oid) ilike '%order_status%')
  loop
    execute format('alter table public.web_orders drop constraint %I', r.conname);
  end loop;

  alter table public.web_orders add constraint web_orders_payment_method_check
    check (payment_method in ('mercado_pago', 'transferencia', 'efectivo'));
  alter table public.web_orders add constraint web_orders_payment_status_check
    check (payment_status in ('pending', 'pending_verification', 'paid', 'failed', 'refunded'));
  alter table public.web_orders add constraint web_orders_order_status_check
    check (order_status in ('pending_review', 'awaiting_payment', 'confirmed', 'preparing', 'ready_for_pickup', 'delivered', 'cancelled'));
end $$;

-- Refresh the API cache so the shop sees the functions right away.
notify pgrst, 'reload schema';

-- Check: this lists the rules now in place. Run it on its own if you want to see them.
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.web_orders'::regclass and contype = 'c';
