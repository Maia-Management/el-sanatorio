/* ===========================================================================
   Netlify Function — sanatorio-availability
   2026-06-21
   Returns booked dates (next 30 days) by querying Supabase production.
   The widget uses this to mark "is-busy" nights in the availability grid.

   Env vars:
   - SUPABASE_URL          (is_secret: false — URLs are not secret)
   - SUPABASE_ANON_KEY     (is_secret: true — high-entropy)

   Reads from public.el_sanatorio_bookings — table per
   MAIA-BOT-RECEPTIONIST-PERSONA-2026-06-21.md §implementation. If the
   table doesn't exist yet, returns empty busy_dates so UI still renders
   all nights as available (degraded but functional).

   Bucket logic: a night is BUSY when confirmed bookings reach the 30%
   capacity tier from SANATORIO-PHASE-1-OPERATIONAL-PLAN-v2 §4.4 (30/100
   pax cap for Cuidadores, 100 cap overall — we flag at 80% to leave room).
   =========================================================================== */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=180',
  'Content-Type': 'application/json; charset=utf-8'
};

function env(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || '';
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

const CAPACITY_PER_NIGHT = 100;
const BUSY_THRESHOLD = 0.8;  // 80% capacity = flag as busy

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const supaUrl = env('SUPABASE_URL');
  const supaKey = env('SUPABASE_ANON_KEY');

  if (!supaUrl || !supaKey) {
    return json({ configured: false, busy_dates: [], message: 'Availability check temporarily offline — book via WhatsApp.' });
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const horizon = new Date(today); horizon.setDate(today.getDate() + 30);

  try {
    // PostgREST select with date filter — aggregate by night_date
    // (table per the persona spec — soft-fail if it doesn't exist yet)
    const url = `${supaUrl.replace(/\/$/, '')}/rest/v1/el_sanatorio_bookings?select=night_date,party_size&night_date=gte.${today.toISOString().slice(0,10)}&night_date=lte.${horizon.toISOString().slice(0,10)}&status=in.(confirmed,paid)`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      headers: {
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
        Accept: 'application/json'
      },
      signal: ctrl.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      // table may not exist yet (404) or RLS missing — return empty gracefully
      return json({ configured: false, busy_dates: [], message: 'Bookings table not yet provisioned.' });
    }
    const rows = await res.json();
    const totals = new Map();
    for (const r of rows) {
      const key = r.night_date;
      totals.set(key, (totals.get(key) || 0) + (parseInt(r.party_size, 10) || 0));
    }
    const busy_dates = [];
    for (const [date, count] of totals) {
      if (count >= CAPACITY_PER_NIGHT * BUSY_THRESHOLD) busy_dates.push(date);
    }

    return json({ configured: true, busy_dates, capacity: CAPACITY_PER_NIGHT, threshold: BUSY_THRESHOLD });
  } catch (err) {
    console.error('sanatorio-availability failed', err?.message || err);
    return json({ configured: false, busy_dates: [], message: 'Availability check failed — book via WhatsApp.' });
  }
};

export const config = { path: '/.netlify/functions/sanatorio-availability' };
