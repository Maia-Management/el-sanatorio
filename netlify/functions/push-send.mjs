/* Netlify Function: push-send
 * Admin-protected. POSTs a notification through FCM HTTP v1 to one or more
 * subscribers. Use this from your own dashboard / scheduled task / Hortensia
 * trigger.
 *
 * Required env vars on Netlify:
 *   SUPABASE_URL              = https://nxgndsnxugcevwriljlv.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY = <service role key>
 *   FIREBASE_SERVICE_ACCOUNT  = <base64-encoded JSON service-account key>
 *   FIREBASE_PROJECT_ID       = <gcp project id>
 *   PUSH_ADMIN_TOKEN          = <random string Andrew picks; high entropy>
 *
 * Request shape:
 *   POST /api/push-send
 *   Headers: x-admin-token: <PUSH_ADMIN_TOKEN>
 *   Body: {
 *     title, body, url, image, tag, segments (optional array),
 *     locale (optional 'es-CO'|'en'),
 *     dry_run (bool — counts but doesn't send)
 *   }
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-token',
  'Content-Type': 'application/json; charset=utf-8',
};

function env(name) { return globalThis.Netlify?.env?.get(name) || process.env[name] || ''; }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: corsHeaders }); }

// ──────────────────────────────────────────────────────────────────────
// Mint OAuth access token from the service-account JWT (no Admin SDK
// dependency — done in pure ESM with WebCrypto).
// ──────────────────────────────────────────────────────────────────────
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64url = (s) => Buffer.from(s).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const pem = sa.private_key;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuf(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const sigB64 = Buffer.from(sig).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${unsigned}.${sigB64}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('oauth2: ' + t);
  }
  const data = await r.json();
  return data.access_token;
}

function pemToBuf(pem) {
  const cleaned = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  return Buffer.from(cleaned, 'base64');
}

// ──────────────────────────────────────────────────────────────────────
// Send one FCM v1 message
// ──────────────────────────────────────────────────────────────────────
async function sendOne(accessToken, projectId, message) {
  const r = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message }),
    }
  );
  return { status: r.status, body: await r.text() };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const adminToken = env('PUSH_ADMIN_TOKEN');
  const provided = req.headers.get('x-admin-token');
  if (!adminToken || provided !== adminToken) return json({ error: 'Unauthorized' }, 401);

  const SUPABASE_URL = env('SUPABASE_URL');
  const SUPABASE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
  const SA_B64 = env('FIREBASE_SERVICE_ACCOUNT');
  const PROJECT_ID = env('FIREBASE_PROJECT_ID');
  if (!SUPABASE_URL || !SUPABASE_KEY || !SA_B64 || !PROJECT_ID) {
    return json({ error: 'Server misconfigured (one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIREBASE_SERVICE_ACCOUNT, FIREBASE_PROJECT_ID)' }, 500);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const { title, body: msgBody, url, image, tag, segments, locale, dry_run } = body || {};
  if (!title || !msgBody) return json({ error: 'title + body required' }, 400);

  // Query subscribers (filter by segments + locale if given)
  let q = `${SUPABASE_URL}/rest/v1/el_sanatorio_push_subscribers?select=token&revoked_at=is.null&limit=10000`;
  if (locale) q += `&locale=eq.${encodeURIComponent(locale)}`;
  if (Array.isArray(segments) && segments.length) {
    q += `&segments=cs.{${segments.join(',')}}`;
  }
  const subsRes = await fetch(q, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!subsRes.ok) return json({ error: 'subscriber query failed', detail: await subsRes.text() }, 502);
  const subs = await subsRes.json();
  if (!subs.length) return json({ ok: true, sent: 0, target: 0 });

  if (dry_run) return json({ ok: true, target: subs.length, dry_run: true });

  // Mint OAuth token
  let sa;
  try { sa = JSON.parse(Buffer.from(SA_B64, 'base64').toString('utf-8')); }
  catch (e) { return json({ error: 'Bad FIREBASE_SERVICE_ACCOUNT (must be base64 JSON)' }, 500); }

  let accessToken;
  try { accessToken = await getAccessToken(sa); }
  catch (e) { return json({ error: 'OAuth failed', detail: String(e).slice(0, 300) }, 502); }

  // Build base message
  const baseData = { url: url || '/', tag: tag || 'sanatorio' };
  if (image) baseData.image = image;

  // Send in parallel with mild concurrency cap
  let sent = 0, failed = 0;
  const failures = [];
  const CHUNK = 50;
  for (let i = 0; i < subs.length; i += CHUNK) {
    const slice = subs.slice(i, i + CHUNK);
    const results = await Promise.allSettled(slice.map((s) => sendOne(accessToken, PROJECT_ID, {
      token: s.token,
      notification: { title, body: msgBody, image },
      data: baseData,
      webpush: {
        notification: {
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          requireInteraction: false,
          vibrate: [200, 100, 200],
        },
        fcm_options: { link: url || '/' },
      },
    })));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.status < 300) sent++;
      else { failed++; failures.push(r.status === 'fulfilled' ? r.value.body?.slice(0, 80) : String(r.reason).slice(0, 80)); }
    }
  }

  return json({ ok: true, sent, failed, target: subs.length, failureSample: failures.slice(0, 5) });
};
