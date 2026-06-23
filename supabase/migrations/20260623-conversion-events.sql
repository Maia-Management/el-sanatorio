-- Migration: el_sanatorio_conversion_events
-- Written by /api/track-conversion. Source of truth for our own attribution model.

create table if not exists public.el_sanatorio_conversion_events (
  id           bigserial primary key,
  event_name   text not null,
  session_id   text,
  page         text,
  props        jsonb not null default '{}'::jsonb,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  fbclid       text,
  gclid        text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_conv_event_name on public.el_sanatorio_conversion_events (event_name, created_at desc);
create index if not exists idx_conv_session on public.el_sanatorio_conversion_events (session_id);
create index if not exists idx_conv_utm_campaign on public.el_sanatorio_conversion_events (utm_campaign) where utm_campaign is not null;

alter table public.el_sanatorio_conversion_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where polname = 'conv_evt_anon_deny' and tablename = 'el_sanatorio_conversion_events') then
    create policy conv_evt_anon_deny on public.el_sanatorio_conversion_events
      for all to anon using (false) with check (false);
  end if;
end$$;

comment on table public.el_sanatorio_conversion_events is
  'Conversion event log from maiaTrack() — feeds our own attribution and CAPI dedupe model.';
