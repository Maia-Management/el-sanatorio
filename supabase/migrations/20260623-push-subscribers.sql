-- Migration: el_sanatorio_push_subscribers
-- Apply via Supabase SQL editor on project nxgndsnxugcevwriljlv.
-- Stores FCM tokens collected by /api/push-subscribe.

create extension if not exists pgcrypto;

create table if not exists public.el_sanatorio_push_subscribers (
  id           uuid primary key default gen_random_uuid(),
  token        text unique not null,
  locale       text,
  page         text,
  utm          jsonb,
  ua           text,
  tz           text,
  segments     text[] not null default '{}',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz
);

-- Helpful indexes
create index if not exists idx_push_subs_locale on public.el_sanatorio_push_subscribers (locale) where revoked_at is null;
create index if not exists idx_push_subs_segments on public.el_sanatorio_push_subscribers using gin (segments) where revoked_at is null;
create index if not exists idx_push_subs_last_seen on public.el_sanatorio_push_subscribers (last_seen_at desc);

-- RLS — service-role only writes. anon never reads.
alter table public.el_sanatorio_push_subscribers enable row level security;

-- Service role bypasses RLS automatically; explicit deny for anon
do $$
begin
  if not exists (select 1 from pg_policies where polname = 'push_subs_anon_deny' and tablename = 'el_sanatorio_push_subscribers') then
    create policy push_subs_anon_deny on public.el_sanatorio_push_subscribers
      for all to anon using (false) with check (false);
  end if;
end$$;

comment on table public.el_sanatorio_push_subscribers is
  'FCM tokens for El Sanatorio web push (organic re-engagement). Written by /api/push-subscribe (service role). Read by /api/push-send (service role) for broadcast.';
