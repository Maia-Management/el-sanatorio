/**
 * Netlify Function: wifi-signup
 * Path on site: /api/wifi-signup  →  /.netlify/functions/wifi-signup
 *
 * Captive-portal producer for the cross-brand-feeders rule engine in
 * maia-management/netlify/functions/lib/cross-brand-feeders/rules.mjs
 * (rule v1-sanatorio-to-sushipop listens for event_type=wifi_portal_signup).
 *
 * Flow:
 *   1. Validate body + honeypot.
 *   2. syncToCustomerActivity → upsert into customer_activity (brand=el_sanatorio).
 *   3. recordInteraction(kind=wifi_portal_signup) → insert into interactions.
 *      This is the canonical signal the cross-brand feeder cron reads.
 *   4. Return { ok:true, wifi_password } so the page can display it.
 *
 * Required env vars on the el-sanatorio Netlify site:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WIFI_GUEST_PASSWORD       ← the actual WPA2 PSK shown to guests
 */

import {
  syncToCustomerActivity,
  recordInteraction,
  normalizePhone,
  geoFromRequest,
} from './lib/vert-sync.mjs';

function env(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || '';
}

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  // Required env — must be set on Netlify project.
  const wifiPassword = env('WIFI_GUEST_PASSWORD');
  if (!wifiPassword) {
    return json({ error: 'Server misconfigured: WIFI_GUEST_PASSWORD not set' }, 500);
  }
  if (!env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY')) {
    return json({ error: 'Server misconfigured: Supabase env missing' }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  // Honeypot — bots fill `website`. Humans never see it.
  if (body && body.website) {
    return json({ ok: true, _spam: true });
  }

  const name = String(body?.name || '').trim().slice(0, 120);
  const phoneRaw = String(body?.phone || '').trim();
  const phone = normalizePhone(phoneRaw);
  const email = body?.email ? String(body.email).trim().slice(0, 200) : null;
  const whatsappConsent = Boolean(body?.whatsapp_consent);
  const ssid = String(body?.ssid || 'El Sanatorio Wi-Fi').slice(0, 80);

  if (!name) return json({ error: 'Falta el nombre.' }, 400);
  if (!phone) return json({ error: 'Celular no válido.' }, 400);
  if (!whatsappConsent) return json({ error: 'Falta la autorización Habeas Data.' }, 400);

  const userAgent = req.headers.get('user-agent') || null;
  const geo = geoFromRequest(req);

  // 1. Upsert into customer_activity (Vert OS contact graph).
  //    Fire-and-forget — never block the guest behind a sync error.
  try {
    await syncToCustomerActivity({
      phone,
      name,
      language: 'es',
      tags: [
        'source:wifi_portal',
        'venue:el_sanatorio',
        ...(email ? ['has:email'] : []),
      ],
      isInbound: true,
    });
  } catch (e) {
    console.warn('[wifi-signup] customer_activity sync failed:', String(e).slice(0, 200));
  }

  // 2. Record the canonical wifi_portal_signup interaction.
  //    THIS row is what cross-brand-feeders v1-sanatorio-to-sushipop reads.
  try {
    await recordInteraction({
      kind: 'wifi_portal_signup',
      source: 'wifi_portal',
      phone,
      page: '/wifi/',
      geo,
      payload: {
        ssid,
        name,
        email: email || null,
        whatsapp_consent: whatsappConsent,
        user_agent: userAgent,
      },
    });
  } catch (e) {
    console.warn('[wifi-signup] interaction insert failed:', String(e).slice(0, 200));
  }

  return json({
    ok: true,
    wifi_password: wifiPassword,
  });
};

export const config = { path: '/api/wifi-signup' };
