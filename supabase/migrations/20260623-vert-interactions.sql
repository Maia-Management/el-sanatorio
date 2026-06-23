-- Migration: Vert OS unified interactions event log.
-- Every web event, chat turn, QR scan, dice roll, ad click, push send, etc.
-- across all Maia brands lands here. Drives cross-brand attribution,
-- nurture-cron triggers, ad ROI calc, dashboard feeds.
--
-- Brand-prefixed tables (el_sanatorio_*, sushi_pop_*) keep operational
-- payloads; this table holds the canonical "X happened to phone Y at brand Z
-- with UTM W". Joinable to customer_activity on (brand, phone).
--
-- Apply via Supabase SQL editor on nxgndsnxugcevwriljlv.

create extension if not exists pgcrypto;

create table if not exists public.interactions (
  id            bigserial primary key,
  brand         text not null check (brand in (
    'el_sanatorio','sushi_pop','chuzo_tokyo','la_farmacia',
    'maia_recruitment','maia_botanicas','maia_management',
    'maia_legal','maia_contable','maia_realty','maia_masters',
    'cross_brand'
  )),
  kind          text not null,         -- 'page_view'|'form_submit'|'chat_turn'|'qr_scan'|'dice_play'|'push_send'|'push_click'|'wa_inbound'|'wa_send'|'ad_click'|'tx_paid'|'tx_refund'|...
  source        text,                  -- 'web'|'whatsapp'|'phone'|'walk_in'|'meta_ad'|'google_ad'|'organic'|...
  phone         text,                  -- E.164 if known
  session_id    text,                  -- ties back to maia_track session
  page          text,
  city          text,
  region        text,
  country       text,                  -- ISO 3166-1 alpha-2; locals = CO
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_term      text,
  utm_content   text,
  fbclid        text,
  gclid         text,
  amount_cop    numeric,               -- for tx_* kinds, the COP value
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- Drives dashboard "today across all brands" feed
create index if not exists idx_interactions_brand_time on public.interactions (brand, created_at desc);
-- Drives "all activity for this person"
create index if not exists idx_interactions_phone_time on public.interactions (phone, created_at desc) where phone is not null;
-- Drives "ROI of campaign X"
create index if not exists idx_interactions_campaign on public.interactions (utm_campaign, kind, created_at desc) where utm_campaign is not null;
-- Drives "locals vs overseas" geo splits
create index if not exists idx_interactions_country_kind on public.interactions (country, kind, created_at desc) where country is not null;
-- Drives "today's events of kind X"
create index if not exists idx_interactions_kind_time on public.interactions (kind, created_at desc);

alter table public.interactions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where polname = 'interactions_anon_deny' and tablename = 'interactions') then
    create policy interactions_anon_deny on public.interactions
      for all to anon using (false) with check (false);
  end if;
end$$;

comment on table public.interactions is
  'Vert OS canonical event log — every meaningful event across every Maia brand. Written by every Maia site/MCP/Netlify-function. Read by Vert dashboard + nurture-cron + ad ROI calc.';

-- ─────────────────────────────────────────────────────────────────────
-- Augment push subscribers with phone so we can apply optouts
-- ─────────────────────────────────────────────────────────────────────
alter table if exists public.el_sanatorio_push_subscribers
  add column if not exists phone text,
  add column if not exists name text;
create index if not exists idx_push_phone on public.el_sanatorio_push_subscribers (phone) where phone is not null;
