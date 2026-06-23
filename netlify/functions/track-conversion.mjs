/* Netlify Function: track-conversion
 * Path: /api/track-conversion
 *
 * Receives events from maiaTrack(). Persists to Supabase
 * el_sanatorio_conversion_events for our own attribution model, AND relays
 * to Meta Conversions API server-side (CAPI) when META_PIXEL_ID +
 * META_CAPI_TOKEN are set.
 *
 * Why server-side CAPI: post iOS-14 + Chrome 3rd-party-cookie deprecation,
 * browser pixel attribution rate drops 30-60%. CAPI sends the same event
 * with hashed PII directly from the server to Meta, lifting attribution.
 *
 * Required env vars on Netlify (all optional except Supabase):
 *   SUPABASE_URL              = https://nxgndsnxugcevwriljlv.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY = <key>
 *   META_PIXEL_ID             = numeric pixel id (when Meta portfolio unfrozen)
 *   META_CAPI_TOKEN           = Meta system-user access token
 *   META_CAPI_TEST_CODE       = optional, for Meta's "Test Events" tool
 */

import { recordInteraction, geoFromRequest } from './lib/vert-sync.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

function env(name) { return globalThis.Netlify?.env?.get(name) || process.env[name] || ''; }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: corsHeaders }); }

async function sha256(s) {
  const data = new TextEncoder().encode(String(s).trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Map our event names to Meta standard events
const META_EVENT_MAP = {
  page_view: 'PageView',
  waitlist_signup: 'Lead',
  casting_apply: 'CompleteRegistration',
  contact_submit: 'Lead',
  push_subscribed: 'Subscribe',
  estimator_submit: 'InitiateCheckout',
  wompi_deposit_clicked: 'AddPaymentInfo',
  hortensia_open: 'Contact',
  wa_clicked: 'Contact',
  cuidadores_check: 'Lead',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const { name, props } = body || {};
  if (!name || typeof name !== 'string' || name.length > 80) return json({ error: 'Bad name' }, 400);

  // Persist to Supabase (best-effort, non-blocking for CAPI)
  const SUPABASE_URL = env('SUPABASE_URL');
  const SUPABASE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
  const writeSupabase = async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/el_sanatorio_conversion_events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          event_name: name,
          props: props || {},
          session_id: props?.session_id || null,
          page: props?.page_location || null,
          utm_source: props?.utm_source || null,
          utm_medium: props?.utm_medium || null,
          utm_campaign: props?.utm_campaign || null,
          fbclid: props?.fbclid || null,
          gclid: props?.gclid || null,
          created_at: props?.ts || new Date().toISOString(),
        }),
      });
    } catch {}
  };

  // Relay to Meta CAPI (best-effort)
  const META_PIXEL_ID = env('META_PIXEL_ID');
  const META_CAPI_TOKEN = env('META_CAPI_TOKEN');
  const META_TEST = env('META_CAPI_TEST_CODE');
  const writeMeta = async () => {
    if (!META_PIXEL_ID || !META_CAPI_TOKEN) return;
    const metaName = META_EVENT_MAP[name];
    if (!metaName) return;
    try {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-nf-client-connection-ip')
        || '';
      const ua = req.headers.get('user-agent') || '';
      const event = {
        event_name: metaName,
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: props?.page_location ? `https://el-sanatorio.com${props.page_location}` : undefined,
        action_source: 'website',
        user_data: {
          client_ip_address: ip,
          client_user_agent: ua,
          fbc: props?.fbclid ? `fb.1.${Date.now()}.${props.fbclid}` : undefined,
          fbp: props?.fbp,
        },
        custom_data: {
          source: 'maia_track',
          ...(props?.utm_source ? { utm_source: props.utm_source } : {}),
          ...(props?.utm_campaign ? { utm_campaign: props.utm_campaign } : {}),
        },
      };
      const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_CAPI_TOKEN)}`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [event], ...(META_TEST ? { test_event_code: META_TEST } : {}) }),
      });
    } catch {}
  };

  // ── Vert OS canonical event log ─────────────────────────────────────
  const writeVert = async () => {
    try {
      const geo = geoFromRequest(req);
      await recordInteraction({
        kind: name,
        source: 'web',
        sessionId: props?.session_id,
        page: props?.page_location,
        geo,
        utm: {
          utm_source: props?.utm_source,
          utm_medium: props?.utm_medium,
          utm_campaign: props?.utm_campaign,
          utm_term: props?.utm_term,
          utm_content: props?.utm_content,
          fbclid: props?.fbclid,
          gclid: props?.gclid,
        },
        payload: props || {},
      });
    } catch {}
  };

  await Promise.allSettled([writeSupabase(), writeMeta(), writeVert()]);
  return json({ ok: true });
};
