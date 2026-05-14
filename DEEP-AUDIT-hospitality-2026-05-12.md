# Deep Audit — Hospitality Sites — 2026-05-12

**Repos audited:** el-sanatorio, sushi-pop, be-vida
**Auditor:** Claude (Sonnet 4.6)
**Date:** 2026-05-12

---

## EL-SANATORIO

### Issues Fixed (this session)

**1. Hours inconsistency across pages — P0**

- `index.html` Zone 1 card showed "12:00 PM – 2:00 AM" — wrong opening time
- `index.html` footer hours text showed "Mié – Dom · 6:00 PM – 2:00 AM" — wrong days and wrong time
- `contact.html` hours table showed Lunes/Martes = "Cerrado" — WRONG. Zone 1 operates all 7 days
- `contact.html` hours showed 6 PM open Wed-Thu, 5 PM Sunday — all inconsistent with key facts

Fixed (commit `2b0862b`):
- Zone 1 card: 4:00 PM – 2:00 AM
- Zone 1 patio description: corrected from 12 PM to 4 PM
- Contact.html table: Lunes/Martes = "Zona 1 solo · 4:00 PM – 2:00 AM"; Wed-Sun = "Todas las zonas · 4:00 PM – 2:00 AM"
- Footer hours: "Zona 1: Todos los días 4 PM – 2 AM / Zona 2 & 3: Mié – Dom 4 PM – 2 AM"
- Contact.html laberinto note: removed hardcoded timeslots — replaced with WhatsApp booking note

**2. Schema JSON-LD hours (contact.html) — P0**

Prior JSON-LD: Wed-Thu 18:00-01:00, Fri-Sat 18:00-02:00, Sun 17:00-00:00 (Mon/Tue missing entirely)

Fixed (commit `2b0862b`) to match ground truth:
- Mon-Tue: 16:00-02:00 (Zone 1 only)
- Wed-Sun: 16:00-02:00

**3. historia.html author meta — P2**

Changed `author content="The Maia Group"` → `"El Sanatorio S.A.S."` (commit `2b0862b`)

**4. contact.html meta description still referenced wrong hours — P2**

"Miércoles a Domingo, 6 PM" — fixed to accurate Zone 1/Zone 2-3 hours (commit `dc427fd`)

### Passing Checks

- NIT: 902.051.563-5 correct in all JSON-LD (index.html Organization + LocalBusiness, contact.html, menu.html, experience.html)
- WhatsApp: all links use wa.me/19034598763 — correct
- llevalleva.co: zero instances
- Personal numbers: none in HTML ("+57 300 000 0000" is a placeholder in form fields — correct)
- Canonical tags: present on all pages
- OG + Twitter card: present on all pages
- Forms: data-netlify="true" on both booking forms; Ley 1581 consent checkbox present
- Sitemap: covers all 9 pages
- netlify.toml: full security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- Image alt attributes: all meaningful images have alt text
- Address: Calle 19 #4-23, Centro Histórico, Santa Marta — correct throughout
- Hostel/hostal language: zero instances
- the-maia-group.com: zero instances
- Footer cross-links: maia-legal.com + maia-management.com + maia-management.com/portfolio present
- "Work for us" cross-link: present in index.html → maia-management.com/empleo.html
- Be-Vida cross-link: present in index.html narrative ("prescribes doses with Be Vida spirits")
- Robots.txt: Allow /, sitemap reference correct

### Commits (el-sanatorio)
- `2b0862b` — hours fixes, schema JSON-LD, historia.html author
- `dc427fd` — contact.html meta description hours corrected

---

## SUSHI-POP

### Status
Remote (origin/main) already contained all audit fixes including `og:image:alt`, `twitter:site`, `twitter:image:alt`, and `twitter:creator` tags (commit `0c99bae` and prior). Local branch was reset to match origin/main. No additional commits needed.

### Passing Checks

- Domain: sushi-pop.co correct throughout (canonical, og:url, JSON-LD, sitemap, robots.txt)
- NIT: 901.862.977-7 correct in JSON-LD and footer
- WhatsApp: all CTAs use wa.me/19034598763 — correct (8 instances verified)
- Business description: ghost kitchen delivery model — no "dine-in" language
- llevalleva.co: zero instances
- Personal numbers: none
- og:image:alt: present (remote commit)
- twitter:site: @MaiaGroupCO (remote commit)
- twitter:image:alt: present (remote commit)
- twitter:creator: @sushipopsm (brand-specific handle — correct)
- Schema @type: "Restaurant" — acceptable; no valid Schema.org ghostKitchen type
- Schema address: Calle 24 #3-99, Edificio Banco de Bogotá — parent office, appropriate for ghost kitchen
- Privacy page: /privacy.html with noindex — correct
- netlify.toml: security headers present
- Sitemap: / and /privacy.html — complete for this site
- Forms: none — delivery-only, correct
- robots.txt: correct

### No Open Issues

---

## BE-VIDA

### Issues Fixed (this session)

**1. Blog wellness-tourism.html — wrong brand positioning — P0**

Article positioned Be-Vida as a wellness tourism agency with zero mention of drinks. Replaced entirely (commit `69413d8`) with brand-correct article: "Colombia's Tropical Fruits: Why They Make the Best Cocktails" — covers product lines, craft philosophy, Colombian fruit ingredients, El Sanatorio cross-link. Includes Ley 124/1994 and Ley 30/1986 disclaimers.

**2. the-maia-group.com URLs in footer nav — P1**

All 6 files (index.html, botanicas.html, esenciales.html, nosotros.html, vital.html, wholesale.html) linked to the-maia-group.com. Fixed (commit `69413d8`) to maia-management.com/portfolio. JSON-LD parentOrganization URL also corrected.

**3. Sitemap hoteles.html URL — P2**

Listed as /hoteles.html; canonical in hoteles.html says /hoteles. Fixed (commit `69413d8`) to /hoteles with hreflang alternates.

**4. netlify.toml missing hoteles clean-URL rules — P2**

Added 301 redirect /hoteles.html → /hoteles and 200 rewrite /hoteles → /hoteles.html (commit `69413d8`).

**5. hoteles.html truncated — missing closing tags + disclaimers — P0**

File ended mid-tag (no `</footer>`, `</body>`, `</html>`). Also missing mandatory Ley 124/1994 and Ley 30/1986 disclaimers. Fixed (commit `aaf9899`): completed footer with alcohol disclaimers, proper closing tags.

**6. sushipop.co wrong domain in be-vida — P1**

`index.html` had a cross-link to `https://sushipop.co` — incorrect domain (should be sushi-pop.co). `hoteles.html` footer also had `sushipop.co`. Both fixed (commit `aaf9899`).

### Passing Checks

- NIT: 901.862.977-7 correct throughout (index.html JSON-LD, footers, privacy pages, terms pages)
- WhatsApp: all CTAs use wa.me/19034598763 — correct (no personal numbers)
- llevalleva.co: zero instances
- Alcohol disclaimers (Ley 124/1994 + Ley 30/1986): present in index.html, botanicas.html, esenciales.html, nosotros.html, vital.html, wholesale.html, hoteles.html, blog article
- Age restriction (18+): stated in terminos-de-uso.html, terms.html, politica-de-privacidad.html
- Business description: no wellness/health brand positioning in product pages
- Forms: data-netlify="true" on contact form; Ley 1581 consent present; action="/thank-you" pointing to existing page
- Canonical tags: present on all pages
- OG + Twitter meta: present on all pages
- netlify.toml: full security headers
- the-maia-group.com: zero instances in main files (only in .claude/worktrees — historical)
- El Sanatorio cross-link: present in hoteles.html footer and index.html narrative

### Commits (be-vida)
- `69413d8` — blog rewrite, the-maia-group.com URLs, sitemap, netlify.toml hoteles redirects
- `aaf9899` — hoteles.html truncation fix + disclaimers + closing tags; sushipop.co → sushi-pop.co

---

## CROSS-REPO SUMMARY

| Check | el-sanatorio | sushi-pop | be-vida |
|---|---|---|---|
| Correct NIT | PASS (902.051.563-5) | PASS (901.862.977-7) | PASS (901.862.977-7) |
| WhatsApp = bot number | PASS | PASS | PASS |
| llevalleva.co absent | PASS | PASS | PASS |
| Personal numbers absent | PASS | PASS | PASS |
| Hours consistency | FIXED | N/A | N/A |
| Business type accurate | PASS | PASS | FIXED (blog) |
| data-netlify on forms | PASS | N/A | PASS |
| Ley 1581 consent | PASS | N/A | PASS |
| Alcohol disclaimers | N/A | N/A | PASS (all pages incl. hoteles) |
| Security headers | PASS | PASS | PASS |
| Canonical tags | PASS | PASS | PASS |
| OG/Twitter meta complete | PASS | PASS (og:image:alt + twitter:site added) | PASS |
| Image alt attributes | PASS | PASS | PASS |
| Sitemap accuracy | PASS | PASS | FIXED (hoteles URL) |
| the-maia-group.com absent | PASS | N/A | FIXED |
| sushipop.co absent | PASS | PASS | FIXED |
| File integrity (no truncation) | PASS | PASS | FIXED (hoteles.html) |
| Ecosystem cross-links present | PASS (be-vida, maia-management) | PASS (maia-management footer) | PASS (el-sanatorio, sushi-pop) |

---

## Open Items — Andrew Decision Required

1. **El Sanatorio — contact.html og:description** still says "Yakitori gastro bar & horror experience" — functional but generic. If Andrew wants a more specific description that mentions the hours/zones model, provide preferred copy.

2. **Sushi Pop — twitter:creator handle** — remote uses `@sushipopsm`. Confirm this is a live Twitter/X account or update to `@MaiaGroupCO` as the parent if there is no dedicated Sushi Pop account.

3. **Be-Vida Vital product line** — described as "wellness shots" and "functional wellness" in product pages. Technically a product category descriptor, but should be reviewed to ensure it doesn't drift into inadvertent health claims under Colombian consumer law.

4. **Be-Vida hoteles.html** — the keywords meta includes "retiros de wellness." Low priority — keywords meta is not indexed by Google — but worth flagging for brand consistency.

5. **El Sanatorio — no direct Sushi Pop cross-link** in footer nav. Currently linked by narrative in index.html body only. Consider adding sushi-pop.co to the footer ecosystem nav alongside be-vida.com.

6. **Sushi Pop — single-page site** — no blog or articles section. If SEO growth is a priority for sushi-pop.co, an article about Japanese-Colombian fusion or delivery-friendly sushi in Santa Marta would help long-tail rankings.

---

## Push Status

| Repo | Branch | Pushed | Commit |
|---|---|---|---|
| el-sanatorio | master | YES | dc427fd |
| sushi-pop | main | N/A (reset to origin/main 0c99bae — already had fixes) | — |
| be-vida | master | YES | aaf9899 |

*Audit completed 2026-05-12. Auditor: Claude (Sonnet 4.6)*
