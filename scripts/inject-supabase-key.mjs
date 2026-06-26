#!/usr/bin/env node
// scripts/inject-supabase-key.mjs
//
// Build-time substitution: replaces REPLACE_WITH_ANON_KEY_AT_DEPLOY in the
// captive-portal / auth-callback / account JS with the SUPABASE_ANON_KEY env
// var set in Netlify project settings.
//
// The Supabase "anon" key is publishable client-side material (the SDK ships
// it to the browser) — its only protection is Row-Level Security on the
// server. Inlining it into the static HTML is safe by design.
//
// Run via `npm run build` (wired in netlify.toml [build] command).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PLACEHOLDER = 'REPLACE_WITH_ANON_KEY_AT_DEPLOY';
const KEY = process.env.SUPABASE_ANON_KEY;

// Files to patch (relative to repo root).
const TARGETS = [
  'wifi/index.html',
  'auth/callback/index.html',
];

if (!KEY) {
  console.warn('[inject-supabase-key] SUPABASE_ANON_KEY env var not set — leaving placeholder in place.');
  console.warn('[inject-supabase-key] Captive portal /wifi and /auth/callback will show a config error to users.');
  console.warn('[inject-supabase-key] Set SUPABASE_ANON_KEY in Netlify site env vars to fix.');
  // Don't fail the build — let the page render its own "no configurada" message.
  process.exit(0);
}

let replacedCount = 0;
for (const rel of TARGETS) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    console.warn(`[inject-supabase-key] skip (not found): ${rel}`);
    continue;
  }
  const before = readFileSync(abs, 'utf8');
  if (!before.includes(PLACEHOLDER)) {
    console.log(`[inject-supabase-key] no placeholder in ${rel} (skip)`);
    continue;
  }
  const after = before.split(PLACEHOLDER).join(KEY);
  writeFileSync(abs, after, 'utf8');
  const n = (before.match(new RegExp(PLACEHOLDER, 'g')) || []).length;
  replacedCount += n;
  console.log(`[inject-supabase-key] substituted ${n} occurrence(s) in ${rel}`);
}

console.log(`[inject-supabase-key] done — total ${replacedCount} placeholder occurrence(s) replaced.`);
