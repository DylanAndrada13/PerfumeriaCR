-- Draft only: review before applying. Adds Mercado Pago OAuth connection storage.
-- Does not modify existing products, purchases, or web order items.
alter table public.web_orders
  add column if not exists mp_preference_id text,
  add column if not exists mp_payment_id text,
  add column if not exists mp_seller_id text;

create unique index if not exists web_orders_mp_preference_id_uq
  on public.web_orders(mp_preference_id) where mp_preference_id is not null;
create index if not exists web_orders_mp_seller_idx
  on public.web_orders(mp_seller_id, created_at desc);

create table if not exists public.mp_seller_connections (
  seller_user_id text primary key,
  seller_nickname text,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  token_expires_at timestamptz not null,
  is_active boolean not null default false,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists mp_seller_connections_single_active_uq
  on public.mp_seller_connections(is_active) where is_active;
alter table public.mp_seller_connections enable row level security;
revoke all on public.mp_seller_connections from anon, authenticated;
grant all on public.mp_seller_connections to service_role;

create or replace function public.save_mp_seller_connection(
  p_seller_user_id text,
  p_seller_nickname text,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text,
  p_token_expires_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.mp_seller_connections set is_active = false, updated_at = now() where is_active;
  insert into public.mp_seller_connections (
    seller_user_id, seller_nickname, access_token_ciphertext, refresh_token_ciphertext,
    token_expires_at, is_active, connected_at, updated_at
  ) values (
    p_seller_user_id, p_seller_nickname, p_access_token_ciphertext, p_refresh_token_ciphertext,
    p_token_expires_at, true, now(), now()
  ) on conflict (seller_user_id) do update set
    seller_nickname = excluded.seller_nickname,
    access_token_ciphertext = excluded.access_token_ciphertext,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    token_expires_at = excluded.token_expires_at,
    is_active = true,
    connected_at = now(),
    updated_at = now();
end;
$$;
revoke all on function public.save_mp_seller_connection(text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_mp_seller_connection(text, text, text, text, timestamptz) to service_role;

-- Old seller connections remain available for validating their pending payment webhooks.
-- Only one connection is active for creating new checkout sessions.
