/* Netlify Function: push-subscribe
 * Path on site: /api/push-subscribe (via the /api/* rewrite added in audit-pass-4)
 *
 * Persists FCM tokens to Supabase. Idempotent: same token = upsert, updates
 * last_seen_at + page + utm. Validates against allowed columns + size caps.
 *
 * Required env vars on Netlify:
 *   SUPABASE_URL              = https://nxgndsnxugcevwriljlv.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY = <service role key>
 *
 * Table: el_sanatorio_push_subscribers (see supabase/migrations file shipped
 * with this commit). Schema:
 *   id uuid pk default gen_random_uuid()
 *   token text unique not null
 *   locale text
 *   page text
 *   utm jsonb
 *   ua text
 *   tz text
 *   created_at timestamptz default now()
 *   last_seen_at timestamptz default now()
 *   segments text[] default '{}'
 *   revoked_at timestamptz
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

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

  // Honeypot — payload.website is not used; if present silently accept.
  if (body?.website) return json({ ok: true, _spam: true });

  const token = String(body?.token || '');
  if (!token || token.length < 20 || token.length > 500) return json({ error: 'Bad token' }, 400);

  const clean = {
    token,
    locale: String(body.locale || '').slice(0, 16) || null,
    page: String(body.page || '').slice(0, 200) || null,
    utm: body.utm && typeof body.utm === 'object' ? body.utm : null,
    ua: String(body.ua || '').slice(0, 300) || null,
    tz: String(body.tz || '').slice(0, 80) || null,
    last_seen_at: new Date().toISOString(),
  };

  // Upsert on conflict(token) — increments last_seen_at, keeps original created_at.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/el_sanatorio_push_subscribers?on_conflict=token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(clean),
  });
  if (!r.ok) {
    const txt = await r.text();
    return json({ error: 'Supabase error', detail: txt.slice(0, 300) }, 502);
  }
  return json({ ok: true });
};
