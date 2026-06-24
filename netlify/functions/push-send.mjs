/* Netlify Function: push-send
 * Path: /api/push-send
 *
 * PIVOTED 2026-06-23 PM from Firebase v1 HTTP API to pure Web Push Protocol
 * (RFC 8030 + VAPID RFC 8292). The Firebase v1 path required a downloaded
 * service-account JSON, which `iam.disableServiceAccountKeyCreation` org
 * policy blocked. This implementation only needs the VAPID public/private
 * keypair — no service account, no JWT signing, no policy override needed.
 *
 * Required env vars on Netlify:
 *   SUPABASE_URL              = https://nxgndsnxugcevwriljlv.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY = <service role key>
 *   VAPID_PUBLIC_KEY          = BE58rk2vbyWwSBlRzUPgFHz2gmPBaLovf4hUpt64BHz8nL_l89oih7KRX0dbcIUJc55NbBw-74tHrUNx7DCxmwk
 *   VAPID_PRIVATE_KEY         = (server-side only — keep secret)
 *   VAPID_SUBJECT             = mailto:andrew@maia-management.com  (or your site URL)
 *   PUSH_ADMIN_TOKEN          = (admin auth secret)
 *
 * Send body:
 *   POST /api/push-send
 *   Headers: x-admin-token: <PUSH_ADMIN_TOKEN>
 *   Body: {
 *     title, body, url, image, tag, segments[], locale?, dry_run?
 *   }
 *
 * Required `web-push` npm package — installed in package.json.
 */

import webpush from 'web-push';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-token',
  'Content-Type': 'application/json; charset=utf-8',
};

function env(name) { return globalThis.Netlify?.env?.get(name) || process.env[name] || ''; }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: corsHeaders }); }

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const adminToken = env('PUSH_ADMIN_TOKEN');
  const provided = req.headers.get('x-admin-token');
  if (!adminToken || provided !== adminToken) return json({ error: 'Unauthorized' }, 401);

  const SUPABASE_URL = env('SUPABASE_URL');
  const SUPABASE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
  const VAPID_PUB = env('VAPID_PUBLIC_KEY');
  const VAPID_PRIV = env('VAPID_PRIVATE_KEY');
  const VAPID_SUBJECT = env('VAPID_SUBJECT') || 'mailto:andrew@maia-management.com';

  if (!SUPABASE_URL || !SUPABASE_KEY) return json({ error: 'Supabase not configured' }, 500);
  if (!VAPID_PUB || !VAPID_PRIV) return json({ error: 'VAPID keypair not configured' }, 500);

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUB, VAPID_PRIV);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const { title, body: msgBody, url, image, tag, segments, locale, dry_run } = body || {};
  if (!title || !msgBody) return json({ error: 'title + body required' }, 400);

  // Query subscribers — need endpoint + p256dh + auth from the augmented table
  let q = `${SUPABASE_URL}/rest/v1/el_sanatorio_push_subscribers?select=endpoint,p256dh,auth,phone,locale&revoked_at=is.null&endpoint=not.is.null&limit=10000`;
  if (locale) q += `&locale=eq.${encodeURIComponent(locale)}`;
  if (Array.isArray(segments) && segments.length) q += `&segments=cs.{${segments.join(',')}}`;
  const subsRes = await fetch(q, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!subsRes.ok) return json({ error: 'subscriber query failed', detail: await subsRes.text() }, 502);
  const subs = await subsRes.json();
  if (!subs.length) return json({ ok: true, sent: 0, target: 0, note: 'no subscribers match' });

  if (dry_run) return json({ ok: true, target: subs.length, dry_run: true });

  // Compose notification payload (will be encrypted + sent by web-push)
  const payload = JSON.stringify({
    title,
    body: msgBody,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    image: image || undefined,
    tag: tag || 'sanatorio',
    data: { url: url || '/', ts: Date.now() },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  });

  let sent = 0, failed = 0, gone = 0;
  const failureSample = [];
  const goneEndpoints = [];

  // Concurrency cap to avoid rate limits + Netlify timeout
  const CHUNK = 30;
  for (let i = 0; i < subs.length; i += CHUNK) {
    const slice = subs.slice(i, i + CHUNK);
    const results = await Promise.allSettled(slice.map((s) => webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload,
      { TTL: 60 * 60 * 24 } // 24h
    )));
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        sent++;
      } else {
        const err = r.reason;
        const statusCode = err?.statusCode || 0;
        if (statusCode === 404 || statusCode === 410) {
          // Subscriber unsubscribed/expired — mark revoked
          gone++;
          goneEndpoints.push(slice[idx].endpoint);
        } else {
          failed++;
          failureSample.push({ status: statusCode, msg: (err?.body || String(err)).slice(0, 80) });
        }
      }
    });
  }

  // Mark gone subscribers as revoked (best-effort, fire and forget)
  if (goneEndpoints.length) {
    fetch(`${SUPABASE_URL}/rest/v1/el_sanatorio_push_subscribers?endpoint=in.(${goneEndpoints.slice(0, 50).map(encodeURIComponent).join(',')})`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    }).catch(() => {});
  }

  return json({ ok: true, sent, failed, gone, target: subs.length, failureSample: failureSample.slice(0, 5) });
};
