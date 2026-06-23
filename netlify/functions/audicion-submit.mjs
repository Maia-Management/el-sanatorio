/**
 * Netlify Function: audicion-submit
 * Path on site: /.netlify/functions/audicion-submit
 *
 * Relay for the /audicion landing page. Writes form submissions to Supabase
 * using the SERVICE_ROLE_KEY (server-side only), so the anon key never sits on the page.
 *
 * Drop this file into:  netlify/functions/audicion-submit.mjs  in the el-sanatorio repo.
 *
 * Required env vars on the Netlify project for el-sanatorio:
 *   SUPABASE_URL              = https://nxgndsnxugcevwriljlv.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY = <service-role key from Supabase project settings → API>
 *
 * Allow-list of writable tables (anti-injection):
 *   - el_sanatorio_launch_waitlist
 *   - el_sanatorio_actor_applicants
 */

import { syncToCustomerActivity } from './lib/vert-sync.mjs';

const ALLOWED_TABLES = new Set([
  'el_sanatorio_launch_waitlist',
  'el_sanatorio_actor_applicants',
]);

const ALLOWED_FIELDS = {
  el_sanatorio_launch_waitlist: ['name', 'email', 'phone', 'city', 'source', 'created_at'],
  el_sanatorio_actor_applicants: ['name', 'age', 'phone', 'email', 'city', 'role', 'experience', 'link', 'source', 'created_at'],
};

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const { table, payload } = body || {};
  if (!ALLOWED_TABLES.has(table)) return new Response('Bad table', { status: 400 });
  if (!payload || typeof payload !== 'object') return new Response('Bad payload', { status: 400 });
  // Server-side spam honeypot — bots fill the 'website' field; humans can't see it.
  if (payload.website) return new Response(JSON.stringify({ ok: true, _spam: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  // Whitelist fields, coerce strings, cap lengths.
  const clean = {};
  for (const k of ALLOWED_FIELDS[table]) {
    const v = payload[k];
    if (v == null) continue;
    if (k === 'age') { clean.age = Math.max(0, Math.min(120, Number(v) || 0)); continue; }
    clean[k] = String(v).slice(0, 500);
  }
  if (!clean.email && !clean.phone) return new Response('Need email or phone', { status: 400 });
  if (!clean.created_at) clean.created_at = new Date().toISOString();
  if (!clean.source) clean.source = 'audicion-landing';

  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(clean),
  });
  if (!r.ok) {
    const txt = await r.text();
    return new Response(JSON.stringify({ error: 'Supabase error', detail: txt }), { status: 502 });
  }

  // ── Vert OS sync — fire-and-forget upsert to customer_activity ───────────
  // Phones land here from /lp/cuidadores + actor_applicants. Waitlist often
  // has only email — syncToCustomerActivity is keyed on phone and silently
  // skips when no phone is present, so this is safe to always call.
  try {
    await syncToCustomerActivity({
      phone: clean.phone,
      name: clean.name,
      language: 'es',
      tags: [`source:${clean.source || 'audicion-landing'}`, table === 'el_sanatorio_actor_applicants' ? 'role:actor' : 'role:guest'],
    });
  } catch { /* never block the user response on sync */ }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = { path: '/api/audicion-submit' };
