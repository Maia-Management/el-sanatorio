import { recordInteraction, geoFromRequest } from './lib/vert-sync.mjs';
/* ===========================================================================
 * qr-track.mjs · Netlify Function
 * ---------------------------------------------------------------------------
 * Cookieless beacon endpoint to count QR scans per (slug, qr-source) pair.
 * Writes to Supabase if SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set;
 * otherwise no-ops (still 204s the request).
 *
 * Habeas Data (Ley 1581) note: we record NO personal data. Only an
 * aggregate count of (slug, qr_source). No IP, no UA fingerprint, no cookie.
 * This is the menu_qr_redirects v1 — single-table, append-only counter.
 *
 * Table (if used):
 *   menu_qr_redirects (
 *     id bigserial pk,
 *     slug text,              -- chuzo | bar | tickets
 *     qr_source text,         -- aframe | tabletent | wall | etc
 *     scanned_at timestamptz default now()
 *   )
 * =========================================================================== */

export default async (request, context) => {
  const url = new URL(request.url);
  const slug = (url.searchParams.get("slug") || "").slice(0, 32);
  const qrSource = (url.searchParams.get("qr") || "").slice(0, 32);
  if (!slug || !qrSource) {
    return new Response(null, { status: 204 });
  }
  const supaUrl = Netlify.env.get("SUPABASE_URL");
  const supaKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !supaKey) {
    // No Supabase configured — still 204, beacon is fire-and-forget.
    return new Response(null, { status: 204 });
  }
  try {
    await fetch(`${supaUrl}/rest/v1/menu_qr_redirects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supaKey,
        "Authorization": `Bearer ${supaKey}`,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ slug, qr_source: qrSource })
    });
  } catch (_) {
    // Swallow — we never block a scan on telemetry failure.
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/.netlify/functions/qr-track" };
