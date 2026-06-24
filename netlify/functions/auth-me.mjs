/**
 * Netlify Function: auth-me
 * Path: /api/auth/me
 *
 * Returns the current customer's identity (verified via Supabase JWT) so the
 * front-end can render a personalized state without exposing the service_role
 * key. Returns 401 if no session.
 *
 * Response 200:
 *   { customer_id, display_name, email, avatar_url, visits_count, locale }
 * Response 401:
 *   { error: 'no_session' }
 */

import { readCustomerSession, jsonResponse } from './lib/customer-session.mjs';

export default async (req) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }
  const s = await readCustomerSession(req);
  if (!s || !s.auth_user_id) return jsonResponse({ error: 'no_session' }, 401);

  if (!s.customer) {
    // Auth is valid but the upsert hasn't happened. Caller should redirect to
    // /auth/callback/ to complete the upsert.
    return jsonResponse({
      pending_upsert: true,
      email: s.email,
      display_name: s.display_name,
    });
  }

  return jsonResponse({
    customer_id: s.customer.id,
    display_name: s.customer.display_name,
    email: s.customer.email,
    avatar_url: s.customer.avatar_url,
    locale: s.customer.locale,
    visits_count: s.customer.visits_count || 1,
    is_returning: (s.customer.visits_count || 1) > 1,
    has_wifi_password: Boolean(s.customer.wifi_password),
  });
};

export const config = { path: '/api/auth/me' };
