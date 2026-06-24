/**
 * Netlify Function: customer-account-upsert
 * Path: /api/customer-account-upsert
 *
 * Called by /auth/callback/ AFTER `supabase.auth.signInWithOAuth({provider:'google'})`
 * completes and the browser holds a valid session.
 *
 * Job:
 *   1. Verify the Supabase Auth JWT.
 *   2. Upsert a row into `vert_customers` keyed on auth_user_id (idempotent —
 *      same Google account always returns the same vert_customers.id).
 *   3. Match-or-link `vert_customer_identifier` rows for email (and phone if
 *      the customer added one previously via WiFi form / Hortensia).
 *   4. Bump visits_count + last_seen_at when it's a returning user.
 *   5. Write `interactions` rows: kind=google_sso_signin (always) +
 *      kind=customer_recognized (if visits_count > 1).
 *   6. Return { customer_id, display_name, email, avatar_url, locale,
 *               visits_count, is_returning } for the caller to render.
 *
 * The caller (auth/callback page) takes the response and posts a
 * client-computed device_fingerprint_hash in the SAME body so we can persist it.
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
 */

import { readCustomerSession, jsonResponse } from './lib/customer-session.mjs';
import { recordInteraction, geoFromRequest, syncToCustomerActivity } from './lib/vert-sync.mjs';

function env(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || '';
}

const CONSENT_VERSION = 'v1-2026-06-24';

async function fetchSupabase(path, init = {}) {
  const SUPABASE_URL = env('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
}

export default async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  if (!env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY')) {
    return jsonResponse({ error: 'Server misconfigured: Supabase env missing' }, 500);
  }

  const session = await readCustomerSession(req);
  if (!session || !session.auth_user_id) {
    return jsonResponse({ error: 'no_session' }, 401);
  }

  let body = {};
  try { body = await req.json(); } catch {}

  const habeasDataConsent = Boolean(body.habeas_data_consent);
  const termsConsent = Boolean(body.terms_consent);
  const deviceFingerprintHash = String(body.device_fingerprint_hash || '').slice(0, 128) || null;

  const now = new Date().toISOString();
  const email = (session.email || '').toLowerCase().trim();
  const displayName = session.display_name || null;
  const avatarUrl = session.avatar_url || null;
  const locale = session.locale || null;
  const googleSub = session.google_sub || null;

  // Step 1 — does a row already exist for this auth_user_id?
  let customer = session.customer;

  if (!customer) {
    // Try match by email first (might be a pre-existing vert_customers from
    // WhatsApp / WiFi form). If found, claim it.
    if (email) {
      const r = await fetchSupabase(
        `/rest/v1/vert_customers?email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
        { method: 'GET' }
      );
      const rows = r.ok ? await r.json().catch(() => []) : [];
      if (Array.isArray(rows) && rows[0]) customer = rows[0];
    }
  }

  const isReturning = !!customer;

  if (customer) {
    // Update — claim auth_user_id + google_sub, refresh consent, bump visits.
    const patch = {
      auth_user_id: session.auth_user_id,
      google_sub: googleSub,
      email: email || customer.email,
      display_name: displayName || customer.display_name,
      avatar_url: avatarUrl || customer.avatar_url,
      locale: locale || customer.locale,
      last_seen_at: now,
      visits_count: (customer.visits_count || 0) + 1,
      updated_at: now,
      source_brand: customer.source_brand || 'el_sanatorio',
    };
    if (habeasDataConsent && !customer.habeas_data_consent_at) patch.habeas_data_consent_at = now;
    if (termsConsent && !customer.terms_consent_at) patch.terms_consent_at = now;
    if (habeasDataConsent || termsConsent) patch.consent_version = CONSENT_VERSION;
    if (deviceFingerprintHash) patch.device_fingerprint_hash = deviceFingerprintHash;

    const r = await fetchSupabase(
      `/rest/v1/vert_customers?id=eq.${encodeURIComponent(customer.id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    );
    if (r.ok) {
      const updated = await r.json().catch(() => []);
      if (Array.isArray(updated) && updated[0]) customer = updated[0];
    }
  } else {
    // Insert a fresh row.
    const insert = {
      auth_user_id: session.auth_user_id,
      google_sub: googleSub,
      email,
      display_name: displayName,
      avatar_url: avatarUrl,
      locale,
      first_seen_at: now,
      last_seen_at: now,
      visits_count: 1,
      source_brand: 'el_sanatorio',
      habeas_data_consent_at: habeasDataConsent ? now : null,
      terms_consent_at: termsConsent ? now : null,
      consent_version: habeasDataConsent || termsConsent ? CONSENT_VERSION : null,
      device_fingerprint_hash: deviceFingerprintHash,
      ley_1581_consent_at: habeasDataConsent ? now : null,
    };
    const r = await fetchSupabase('/rest/v1/vert_customers', {
      method: 'POST',
      body: JSON.stringify(insert),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return jsonResponse(
        { error: 'upsert_failed', detail: text.slice(0, 200) },
        500
      );
    }
    const created = await r.json().catch(() => []);
    customer = Array.isArray(created) && created[0] ? created[0] : null;
  }

  if (!customer) return jsonResponse({ error: 'upsert_lost_row' }, 500);

  // Ensure email identifier row exists (idempotent).
  if (email) {
    try {
      await fetchSupabase('/rest/v1/vert_customer_identifier', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({
          customer_id: customer.id,
          identifier_type: 'email',
          value: email,
          verified_at: now,
          verified_method: 'manual',
          source_brand: 'el_sanatorio',
        }),
      });
    } catch {}
  }

  // Mirror to customer_activity for the Vert OS contact graph.
  try {
    await syncToCustomerActivity({
      phone: customer.phone || null,
      name: displayName,
      language: locale && locale.startsWith('en') ? 'en' : 'es',
      tags: ['source:google_sso', 'venue:el_sanatorio'],
      isInbound: true,
    });
  } catch {}

  // Write canonical interactions row(s).
  const geo = geoFromRequest(req);
  try {
    await recordInteraction({
      kind: 'google_sso_signin',
      source: 'web',
      phone: customer.phone || null,
      page: '/auth/callback/',
      geo,
      payload: {
        email,
        display_name: displayName,
        is_returning: isReturning,
        visits_count: customer.visits_count,
        vert_customer_id: customer.id,
      },
    });
  } catch {}

  if (isReturning) {
    try {
      await recordInteraction({
        kind: 'customer_recognized',
        source: 'web',
        phone: customer.phone || null,
        page: '/auth/callback/',
        geo,
        payload: {
          brand: 'el_sanatorio',
          vert_customer_id: customer.id,
          visits_count: customer.visits_count,
          last_seen_at_other_brand: customer.last_seen_at,
        },
      });
    } catch {}
  }

  return jsonResponse({
    customer_id: customer.id,
    email: customer.email,
    display_name: customer.display_name,
    avatar_url: customer.avatar_url,
    locale: customer.locale,
    visits_count: customer.visits_count,
    is_returning: isReturning,
  });
};

export const config = { path: '/api/customer-account-upsert' };
