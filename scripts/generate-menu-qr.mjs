#!/usr/bin/env node
/* ===========================================================================
 * generate-menu-qr.mjs
 * ---------------------------------------------------------------------------
 * Generates 3 sizes of branded printable QR poster PDF per menu, plus a
 * developer "all-in-one" sheet. 9 PDFs total written to outputs/qr-posters/.
 *
 *   menus  = chuzo · bar · tickets
 *   sizes  = aframe (A3, street) · tabletent (A6 folded, table) · wall (A4)
 *
 * Each QR links to a slug + qr_source-tagged URL so scans are trackable
 * via menu_qr_redirects (qr-track.mjs Netlify function).
 *
 * USAGE:
 *   node scripts/generate-menu-qr.mjs            # all 9 PDFs to ./outputs/qr-posters/
 *   node scripts/generate-menu-qr.mjs --out /custom/path
 *
 * Requires: npm i qrcode pdfkit (dev deps)
 * =========================================================================== */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_ARG = process.argv.find((a) => a.startsWith("--out="));
const OUT_DIR = OUT_ARG
  ? OUT_ARG.split("=")[1]
  : path.join(ROOT, "..", "..", "outputs", "qr-posters"); // also writes to repo `outputs/`

const BASE = "https://el-sanatorio.com";

// ── Menu config: branding + copy per QR poster ─────────────────────
const MENUS = {
  chuzo: {
    name: "Chuzo Tokyo",
    tagline_es: "Yakitori para caminar",
    tagline_en: "Yakitori to-go",
    accent: "#D9621E",
    bg: "#0F0D0B",
    cream: "#EFE6D5",
    url: `${BASE}/menu/chuzo`,
    cta_es: "Escanea · pide · camina",
    cta_sub_es: "WhatsApp · Wompi · COP",
    eyebrow: "Counter de calle · Calle 19"
  },
  bar: {
    name: "El Sanatorio · Barra",
    tagline_es: "El Doctor receta los cócteles",
    tagline_en: "The Doctor prescribes the cocktails",
    accent: "#B7372D",
    bg: "#0B0908",
    cream: "#EFE6D5",
    url: `${BASE}/menu/bar`,
    cta_es: "Escanea · ordena al Doctor",
    cta_sub_es: "Jeringas · prescripciones · sake",
    eyebrow: "Archivo Clínico · Barra"
  },
  tickets: {
    name: "El Sanatorio · Admisiones",
    tagline_es: "Hospital del Tórax · entradas",
    tagline_en: "Hospital admissions",
    accent: "#1B7A8C",
    bg: "#0C0E10",
    cream: "#F0EAE0",
    url: `${BASE}/menu/tickets`,
    cta_es: "Escanea · reserva admisión",
    cta_sub_es: "Cuidadores Santa Marta · 2 por 1",
    eyebrow: "Admisiones · Hospital del Tórax"
  }
};

// ── Poster sizes (PDFKit point system, 72pt = 1in) ─────────────────
const SIZES = {
  aframe: { w: 841.89, h: 1190.55, qrSize: 460, title: "A3 · A-frame street" },
  tabletent: { w: 297.64, h: 420.94, qrSize: 200, title: "A6 · Table tent" },
  wall: { w: 595.28, h: 841.89, qrSize: 360, title: "A4 · Wall poster" }
};

async function ensureDeps() {
  try {
    await import("qrcode");
    await import("pdfkit");
  } catch (e) {
    console.error("✗ Missing deps. Run: npm install --save-dev qrcode pdfkit");
    process.exit(1);
  }
}

async function makeQrPng(text, sizePx, light, dark) {
  const QR = (await import("qrcode")).default;
  return QR.toBuffer(text, {
    errorCorrectionLevel: "H", // 30% redundancy → still scannable behind a sticker
    type: "png",
    margin: 1,
    width: sizePx,
    color: { dark, light }
  });
}

async function renderPoster({ menu, size, sizeKey }) {
  const PDFDocument = (await import("pdfkit")).default;
  const m = MENUS[menu];
  const s = SIZES[size];
  const qrUrl = `${m.url}?qr=${sizeKey}`;
  const png = await makeQrPng(qrUrl, s.qrSize * 4, m.cream, m.bg);

  const doc = new PDFDocument({ size: [s.w, s.h], margins: { top: 0, left: 0, right: 0, bottom: 0 } });
  const file = path.join(OUT_DIR, `${menu}-${size}.pdf`);
  await fs.mkdir(OUT_DIR, { recursive: true });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  // Background
  doc.rect(0, 0, s.w, s.h).fill(m.bg);

  // Top eyebrow band
  doc.rect(0, 0, s.w, 32).fill(m.accent);
  doc.fillColor(m.bg).font("Helvetica-Bold")
    .fontSize(size === "tabletent" ? 7 : 11)
    .text(m.eyebrow.toUpperCase(), 16, 11, { width: s.w - 32, align: "left" });

  // Brand
  const brandY = size === "tabletent" ? 56 : 88;
  doc.fillColor(m.cream)
    .font("Times-Roman")
    .fontSize(size === "tabletent" ? 18 : size === "wall" ? 36 : 56)
    .text(m.name, 24, brandY, { width: s.w - 48, align: "left", lineGap: -4 });

  // Tagline
  const taglineY = brandY + (size === "tabletent" ? 22 : size === "wall" ? 44 : 66);
  doc.fillColor(m.cream).opacity(0.78)
    .font("Times-Italic")
    .fontSize(size === "tabletent" ? 10 : size === "wall" ? 16 : 22)
    .text(m.tagline_es, 24, taglineY, { width: s.w - 48, align: "left" });
  doc.opacity(1);

  // QR centered
  const qrY = taglineY + (size === "tabletent" ? 30 : size === "wall" ? 60 : 100);
  const qrX = (s.w - s.qrSize) / 2;
  doc.image(png, qrX, qrY, { width: s.qrSize, height: s.qrSize });

  // CTA below QR
  const ctaY = qrY + s.qrSize + (size === "tabletent" ? 16 : 28);
  doc.fillColor(m.accent)
    .font("Helvetica-Bold")
    .fontSize(size === "tabletent" ? 11 : size === "wall" ? 18 : 26)
    .text(m.cta_es.toUpperCase(), 0, ctaY, { width: s.w, align: "center", characterSpacing: 1 });

  // Subline
  doc.fillColor(m.cream).opacity(0.6)
    .font("Helvetica")
    .fontSize(size === "tabletent" ? 8 : size === "wall" ? 11 : 15)
    .text(m.cta_sub_es, 0, ctaY + (size === "tabletent" ? 16 : 28), { width: s.w, align: "center" });
  doc.opacity(1);

  // URL footer (small)
  doc.fillColor(m.cream).opacity(0.45)
    .font("Helvetica")
    .fontSize(size === "tabletent" ? 6 : size === "wall" ? 9 : 12)
    .text(m.url.replace(/^https?:\/\//, ""), 0, s.h - (size === "tabletent" ? 32 : 56), { width: s.w, align: "center" });
  doc.opacity(1);

  // Bottom band
  doc.rect(0, s.h - 18, s.w, 18).fill(m.accent);
  doc.fillColor(m.bg)
    .font("Helvetica")
    .fontSize(size === "tabletent" ? 5 : 7)
    .text("EL SANATORIO S.A.S. · NIT 902.051.563-5 · Calle 19 #4-23, Centro Histórico, Santa Marta", 0, s.h - 12, { width: s.w, align: "center" });

  doc.end();
  await new Promise((resolve) => doc.on("end", resolve));
  await fs.writeFile(file, Buffer.concat(chunks));
  return file;
}

async function main() {
  await ensureDeps();
  const made = [];
  for (const menu of Object.keys(MENUS)) {
    for (const size of Object.keys(SIZES)) {
      const f = await renderPoster({ menu, size, sizeKey: size });
      console.log(`  ✓ ${path.basename(f)}`);
      made.push(f);
    }
  }
  console.log(`\nGenerated ${made.length} PDFs → ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
