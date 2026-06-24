/* Netlify Function: push-subscribe
 * PIVOTED 2026-06-23 PM — now stores Web Push Protocol subscription fields
 * (endpoint + p256dh + auth) instead of FCM tokens.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

import { syncToCustomerActivity, recordInteraction, geoFromRequest } from './lib/vert-sync.mjs';

function env(name) { return globalThis.Netlify?.env?.get(name) || process.env[name] || ''; }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: corsHeaders }); }

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const SUPABASE_URL = env('SUPABASE_URL');
  const SUPABASE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_KEY) return json({ error: 'Server misconfigured' }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

  // Honeypot
  if (body?.website) return json({ ok: true, _spam: true });

  const endpoint = String(body?.endpoint || '');
  const p256dh = String(body?.p256dh || '');
  const auth = String(body?.auth || '');
  if (!endpoint || !p256dh || !auth) return json({ error: 'endpoint/p256dh/auth required' }, 400);
  if (endpoint.length > 500 || p256dh.length > 200 || auth.length > 100) return json({ error: 'field too long' }, 400);

  const clean = {
    endpoint,
    p256dh,
    auth,
    phone: body.phone ? String(body.phone).slice(0, 30) : null,
    name: body.name ? String(body.name).slice(0, 80) : null,
    locale: String(body.locale || '').slice(0, 16) || null,
    page: String(body.page || '').slice(0, 200) || null,
    utm: body.utm && typeof body.utm === 'object' ? body.utm : null,
    ua: String(body.ua || '').slice(0, 300) || null,
    tz: String(body.tz || '').slice(0, 80) || null,
    last_seen_at: new Date().toISOString(),
  };

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/el_sanatorio_push_subscribers?on_conflict=endpoint`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(clean),
    }
  );
  if (!r.ok) {
    const txt = await r.text();
    return json({ error: 'Supabase error', detail: txt.slice(0, 300) }, 502);
  }

  // Vert sync (fire-and-forget)
  try {
    const geo = geoFromRequest(req);
    if (clean.phone) {
      await syncToCustomerActivity({
        phone: clean.phone,
        name: clean.name,
        language: clean.locale === 'en' ? 'en' : 'es',
        tags: ['channel:webpush', `source:${clean.page || 'unknown'}`],
      });
    }
    await recordInteraction({
      kind: 'push_subscribed',
      source: 'web',
      phone: clean.phone,
      page: clean.page,
      geo,
      utm: clean.utm,
      payload: { tz: clean.tz, ua: clean.ua },
    });
  } catch {}

  return json({ ok: true });
};
