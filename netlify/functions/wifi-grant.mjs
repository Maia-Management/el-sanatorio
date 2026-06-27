/**
 * Netlify Function: wifi-grant
 * Path: /api/wifi-grant
 *
 * Signed-in fast-path for the WiFi captive portal. Skips the phone+name form
 * entirely — the customer already authenticated via Google + Supabase Auth,
 * so we record the grant and return success. The Wi-Fi network is open
 * (captive-portal pattern, no static password) — router-side MAC
 * authorization is a separate venue config.
 *
 * Replaces the form POST for authenticated users. The phone-form fallback at
 * /api/wifi-signup is still wired for users who decline Google.
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
 *
 * NOTE: WIFI_GUEST_PASSWORD is intentionally NOT required (architecture
 * corrected 2026-06-26 PM).
 */

import { readCustomerSession, jsonResponse } from './lib/customer-session.mjs';
import { recordInteraction, geoFromRequest } from './lib/vert-sync.mjs';

function env(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || '';
}

async function fetchSupabase(path, init = {}) {
  const SUPABASE_URL = env('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export default async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  // WIFI_GUEST_PASSWORD intentionally not required — open captive-portal pattern.
  if (!env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY')) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const session = await readCustomerSession(req);
  if (!session || !session.auth_user_id || !session.customer) {
    return jsonResponse({ error: 'no_session' }, 401);
  }

  const customer = session.customer;
  const now = new Date().toISOString();

  // Persist the grant on the customer row.
  try {
    await fetchSupabase(
      `/rest/v1/vert_customers?id=eq.${encodeURIComponent(customer.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          wifi_granted_at: now,
          last_seen_at: now,
          updated_at: now,
        }),
      }
    );
  } catch (e) {
    console.warn('[wifi-grant] patch failed:', String(e).slice(0, 200));
  }

  // Canonical event — cross-brand-feeders v1-sanatorio-to-sushipop reads this.
  const geo = geoFromRequest(req);
  try {
    await recordInteraction({
      kind: 'wifi_portal_signup',
      source: 'google_sso',
      phone: customer.phone || null,
      page: '/wifi/',
      geo,
      payload: {
        ssid: 'El Sanatorio Wi-Fi',
        source: 'google_sso',
        vert_customer_id: customer.id,
        email: customer.email,
        display_name: customer.display_name,
        habeas_data_consent: Boolean(customer.habeas_data_consent_at),
      },
    });
  } catch (e) {
    console.warn('[wifi-grant] recordInteraction failed:', String(e).slice(0, 200));
  }

  return jsonResponse({
    ok: true,
    redirect: '/menu/',
    ssid: 'El Sanatorio Wi-Fi',
    display_name: customer.display_name,
    message: `¡Listo, ${customer.display_name || 'bienvenido'}! Estás conectado.`,
  });
};

export const config = { path: '/api/wifi-grant' };
