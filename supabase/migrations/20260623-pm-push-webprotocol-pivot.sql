-- Migration: pivot push_subscribers from FCM token model to Web Push Protocol
-- Add endpoint/p256dh/auth columns. Token column kept for back-compat but nullable.

alter table if exists public.el_sanatorio_push_subscribers
  add column if not exists endpoint text,
  add column if not exists p256dh text,
  add column if not exists auth text;

-- Make endpoint unique (replaces token uniqueness for new subscribers)
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where indexname = 'el_sanatorio_push_subscribers_endpoint_key'
  ) then
    create unique index el_sanatorio_push_subscribers_endpoint_key
      on public.el_sanatorio_push_subscribers(endpoint)
      where endpoint is not null;
  end if;
end$$;

-- Old token column becomes nullable so new subscribers don't need it
alter table public.el_sanatorio_push_subscribers
  alter column token drop not null;
