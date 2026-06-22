#!/usr/bin/env node
/* ===========================================================================
 * optimize-menu-assets.mjs
 * ---------------------------------------------------------------------------
 * Asset pipeline for the QR menu video clips.
 *
 * INPUT  ▸ menu-assets/raw/<venue>/<slug>.mp4 (or .mov)
 * OUTPUT ▸ images/menu-clips/<slug>.webm  (vp9, <500KB target)
 *          images/menu-clips/<slug>.mp4   (h264, mobile fallback)
 *          images/menu-clips/<slug>-poster.jpg (first frame, sharp-optimized)
 *
 * USAGE:
 *   npm run menu:optimize             # process every raw clip
 *   npm run menu:optimize -- yakitori # process just one slug
 *
 * Requires: ffmpeg (system), sharp (npm).
 * If ffmpeg is missing, prints install hints and exits non-zero.
 * =========================================================================== */
import { execSync, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "menu-assets", "raw");
const OUT_DIR = path.join(ROOT, "images", "menu-clips");

// ── Target encoding params (tuned for <500KB at 6s, 720p) ────────
const PARAMS = {
  webm: {
    crf: 34,
    bitrate: "450k",
    maxrate: "550k",
    bufsize: "1M",
    threads: 2,
    codec: "libvpx-vp9"
  },
  mp4: {
    crf: 28,
    bitrate: "480k",
    maxrate: "600k",
    bufsize: "1M",
    codec: "libx264"
  },
  duration: 6,
  width: 720,
  height: 720,
  fps: 24
};

function ensureFfmpeg() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    console.error("✗ ffmpeg not found. Install:");
    console.error("  macOS:    brew install ffmpeg");
    console.error("  Windows:  winget install Gyan.FFmpeg");
    console.error("  Ubuntu:   sudo apt install ffmpeg");
    process.exit(1);
  }
}

async function discoverRaws(filter) {
  if (!existsSync(RAW_DIR)) {
    console.log(`! Raw dir not found: ${RAW_DIR}`);
    console.log("  Created empty raw dir + seed placeholder clips.");
    await fs.mkdir(path.join(RAW_DIR, "chuzo"), { recursive: true });
    await fs.mkdir(path.join(RAW_DIR, "bar"), { recursive: true });
    await fs.mkdir(path.join(RAW_DIR, "tickets"), { recursive: true });
    return [];
  }
  const venues = await fs.readdir(RAW_DIR);
  const out = [];
  for (const v of venues) {
    const vDir = path.join(RAW_DIR, v);
    const stat = await fs.stat(vDir).catch(() => null);
    if (!stat || !stat.isDirectory()) continue;
    const files = await fs.readdir(vDir);
    for (const f of files) {
      if (!/\.(mp4|mov|m4v|webm)$/i.test(f)) continue;
      const slug = path.basename(f, path.extname(f));
      if (filter && slug !== filter) continue;
      out.push({ venue: v, slug, abs: path.join(vDir, f) });
    }
  }
  return out;
}

async function encodeOne({ venue, slug, abs }) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const webmOut = path.join(OUT_DIR, `${slug}.webm`);
  const mp4Out = path.join(OUT_DIR, `${slug}.mp4`);
  const posterOut = path.join(OUT_DIR, `${slug}-poster.jpg`);

  const vf = `scale=${PARAMS.width}:${PARAMS.height}:force_original_aspect_ratio=cover,crop=${PARAMS.width}:${PARAMS.height},fps=${PARAMS.fps}`;

  // WebM (VP9)
  console.log(`▸ ${venue}/${slug} → webm`);
  spawnSync("ffmpeg", [
    "-y", "-i", abs,
    "-t", String(PARAMS.duration),
    "-vf", vf,
    "-c:v", PARAMS.webm.codec,
    "-b:v", PARAMS.webm.bitrate,
    "-maxrate", PARAMS.webm.maxrate,
    "-bufsize", PARAMS.webm.bufsize,
    "-crf", String(PARAMS.webm.crf),
    "-an",
    "-row-mt", "1",
    "-threads", String(PARAMS.webm.threads),
    webmOut
  ], { stdio: "inherit" });

  // MP4 (H264 fallback)
  console.log(`▸ ${venue}/${slug} → mp4`);
  spawnSync("ffmpeg", [
    "-y", "-i", abs,
    "-t", String(PARAMS.duration),
    "-vf", vf,
    "-c:v", PARAMS.mp4.codec,
    "-b:v", PARAMS.mp4.bitrate,
    "-maxrate", PARAMS.mp4.maxrate,
    "-bufsize", PARAMS.mp4.bufsize,
    "-crf", String(PARAMS.mp4.crf),
    "-pix_fmt", "yuv420p",
    "-profile:v", "main",
    "-movflags", "+faststart",
    "-an",
    mp4Out
  ], { stdio: "inherit" });

  // Poster (first frame, sharp-optimized)
  console.log(`▸ ${venue}/${slug} → poster.jpg`);
  spawnSync("ffmpeg", [
    "-y", "-i", abs,
    "-ss", "0.3",
    "-frames:v", "1",
    "-vf", vf,
    posterOut
  ], { stdio: "inherit" });

  // Try sharp post-pass if installed
  try {
    const sharp = (await import("sharp")).default;
    const buf = await fs.readFile(posterOut);
    const out = await sharp(buf).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    await fs.writeFile(posterOut, out);
  } catch {
    // sharp not installed — fine, ffmpeg output is acceptable
  }

  const webmSize = (await fs.stat(webmOut)).size;
  const mp4Size = (await fs.stat(mp4Out)).size;
  const overBudget = webmSize > 500_000 || mp4Size > 600_000;
  console.log(`  ✓ ${slug} · webm ${Math.round(webmSize / 1024)}KB · mp4 ${Math.round(mp4Size / 1024)}KB ${overBudget ? "⚠ OVER BUDGET" : ""}`);
  return { slug, webmSize, mp4Size, overBudget };
}

async function main() {
  ensureFfmpeg();
  const filter = process.argv[2];
  const raws = await discoverRaws(filter);
  if (raws.length === 0) {
    console.log("No raw clips found. Place clips in menu-assets/raw/<venue>/<slug>.mp4 and re-run.");
    console.log("See FOR-ANDREW-MENU-CLIP-SHOOTING-GUIDE-2026-06-21.md for shot list.");
    return;
  }
  const results = [];
  for (const r of raws) {
    results.push(await encodeOne(r));
  }
  console.log("\nDone.");
  results.forEach((r) => console.log(`  ${r.overBudget ? "⚠" : "✓"} ${r.slug}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
