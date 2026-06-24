/**
 * lib/customer-session.mjs
 *
 * Verifies a Supabase Auth session JWT submitted by the el-sanatorio site,
 * returns the matching `vert_customers` row, or null.
 *
 * Browser sends the access_token from `supabase.auth.getSession()` either as:
 *   - `Authorization: Bearer <jwt>` header (preferred), OR
 *   - the `sb-access-token` cookie set by the Supabase JS client.
 *
 * The JWT is HS256-signed with the project's JWT secret (SUPABASE_JWT_SECRET on
 * the el-sanatorio Netlify site). We verify locally — NO round-trip to GoTrue.
 *
 * If valid: returns
 *   { auth_user_id, email, google_sub, customer:{...vert_customers row} }
 * If invalid / expired / missing: returns null. Callers decide how to react
 * (most fall through to the anonymous path).
 */

import crypto from 'node:crypto';

function env(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || '';
}

function b64urlToBuf(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function decodeJwtPayload(jwt) {
  const parts = String(jwt).split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64urlToBuf(parts[1]).toString('utf-8'));
  } catch {
    return null;
  }
}

function verifyJwtHS256(jwt, secret) {
  const parts = String(jwt).split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const got = b64urlToBuf(sigB64);
  if (expected.length !== got.length) return null;
  if (!crypto.timingSafeEqual(expected, got)) return null;
  const payload = decodeJwtPayload(jwt);
  if (!payload) return null;
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

function extractToken(req) {
  // Authorization: Bearer <token>
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  // sb-access-token cookie set by @supabase/supabase-js when the page sets persistSession:true.
  const cookieHeader = req.headers.get('cookie') || req.headers.get('Cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader
      .split(';')
      .map((kv) => kv.trim())
      .filter(Boolean)
      .map((kv) => {
        const i = kv.indexOf('=');
        return i < 0 ? [kv, ''] : [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))];
      })
  );
  return (
    cookies['sb-access-token'] ||
    cookies['sb-nxgndsnxugcevwriljlv-auth-token'] ||
    null
  );
}

/**
 * Reads the Supabase Auth session from the request, verifies it, returns the
 * matching vert_customers row (auth_user_id-matched). Returns null on any
 * failure path — callers fall through to anonymous handling.
 */
export async function readCustomerSession(req) {
  const SUPABASE_URL = env('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
  const SUPABASE_JWT_SECRET = env('SUPABASE_JWT_SECRET');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;

  const token = extractToken(req);
  if (!token) return null;

  let payload;
  if (SUPABASE_JWT_SECRET) {
    payload = verifyJwtHS256(token, SUPABASE_JWT_SECRET);
  } else {
    // SUPABASE_JWT_SECRET not set — fall back to GoTrue /user verification.
    // (Slower; one HTTPS round-trip per request. Set the secret to skip this.)
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    const u = await r.json();
    payload = {
      sub: u.id,
      email: u.email,
      user_metadata: u.user_metadata,
      app_metadata: u.app_metadata,
    };
  }
  if (!payload || !payload.sub) return null;

  // Match vert_customers on auth_user_id.
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/vert_customers?auth_user_id=eq.${encodeURIComponent(payload.sub)}&select=*&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  const customer = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!customer) {
    // The JWT is valid but the upsert hasn't happened yet (first visit before
    // auth-callback finished). Return the JWT info anyway so the caller can
    // fire the upsert.
    return {
      auth_user_id: payload.sub,
      email: payload.email || null,
      google_sub: payload.user_metadata?.sub || payload.user_metadata?.provider_id || null,
      display_name: payload.user_metadata?.full_name || payload.user_metadata?.name || null,
      avatar_url: payload.user_metadata?.avatar_url || null,
      locale: payload.user_metadata?.locale || null,
      customer: null,
    };
  }
  return {
    auth_user_id: customer.auth_user_id,
    email: customer.email,
    google_sub: customer.google_sub,
    display_name: customer.display_name,
    avatar_url: customer.avatar_url,
    locale: customer.locale,
    customer,
  };
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}
