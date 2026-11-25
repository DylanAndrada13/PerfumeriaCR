-- Web push subscriptions so the shop can notify buyers when their order changes status.
-- Additive: creates one new table and touches nothing else. Only the server (service role) reads and writes it.
create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists web_push_subscriptions_user_id_idx on public.web_push_subscriptions (user_id);

-- Row level security on with no policies: browsers cannot read or write; the service role bypasses RLS.
alter table public.web_push_subscriptions enable row level security;

notify pgrst, 'reload schema';
