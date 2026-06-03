# Comprehensive Web Audit Report

This document contains a deep audit of the HTML pages in the El Sanatorio repository.

## 1. Automated Static Analysis (SEO, Basic A11y, Best Practices)
# Deep Web Audit Report

This report covers the automated analysis of all HTML pages in the repository, checking for SEO, Accessibility, and Best Practices.

## Audit for `tours.html`
✅ No major issues found in this file.

---

## Audit for `historia.html`
✅ No major issues found in this file.

---

## Audit for `gracias.html`
✅ No major issues found in this file.

---

## Audit for `contact.html`
✅ No major issues found in this file.

---

## Audit for `google4c66475749693679.html`
### SEO
- [ ] Missing <title> tag
- [ ] Missing meta description
- [ ] Missing <h1> tag
- [ ] Missing og:title

### Accessibility
- [ ] Missing 'lang' attribute in <html> tag

### Content
- [ ] Missing <body> tag

---

## Audit for `privacidad.html`
✅ No major issues found in this file.

---

## Audit for `404.html`
### SEO
- [ ] Missing meta description

---

## Audit for `menu.html`
✅ No major issues found in this file.

---

## Audit for `index.html`
### SEO
- [ ] Meta description is too long (over 160 characters)

---

## Audit for `terminos.html`
✅ No major issues found in this file.

---

## Audit for `experience.html`
### SEO
- [ ] Meta description is too long (over 160 characters)

---

## Audit for `events.html`
✅ No major issues found in this file.

---

## Audit for `tools/booking-calendar/index.html`
✅ No major issues found in this file.

---



## 2. Lighthouse Audit (Performance, Accessibility, SEO, Best Practices)
# Deep Lighthouse Audit

## Audit for index.html
- Performance: 79
- Accessibility: 100
- Best Practices: 100
- SEO: 100

### Accessibility Issues Found:
- Tables do not use `<caption>` instead of cells with the `[colspan]` attribute to indicate a caption.

---

## Audit for menu.html
- Performance: 100
- Accessibility: 100
- Best Practices: 100
- SEO: 100


---

## Audit for experience.html
- Performance: 96
- Accessibility: 99
- Best Practices: 100
- SEO: 100

### Accessibility Issues Found:
- Heading elements are not in a sequentially-descending order

---

## Audit for tours.html
- Performance: 100
- Accessibility: 100
- Best Practices: 100
- SEO: 100


---

## Audit for contact.html
- Performance: 100
- Accessibility: 99
- Best Practices: 100
- SEO: 100

### Accessibility Issues Found:
- Heading elements are not in a sequentially-descending order

---

## Audit for events.html
- Performance: 90
- Accessibility: 96
- Best Practices: 100
- SEO: 100

### Accessibility Issues Found:
- Background and foreground colors do not have a sufficient contrast ratio.
- Elements with visible text labels do not have matching accessible names.

---

## Audit for historia.html
- Performance: 97
- Accessibility: 96
- Best Practices: 100
- SEO: 100

### Accessibility Issues Found:
- Background and foreground colors do not have a sufficient contrast ratio.

---



## Summary of Fixes Required:
1. `index.html` and `experience.html` have meta descriptions that exceed 160 characters.
2. `google4c66475749693679.html` is missing basic HTML structure tags (`<html>` lang, `<body>`, `<title>`, `<h1>`, `meta description`, `og:title`), though this might be intentional if it's purely for Google Site Verification.
3. `404.html` is missing a meta description.
4. `index.html` has a minor accessibility warning about table captions.
5. `experience.html` and `contact.html` have headings that skip levels (not sequentially-descending).
6. `events.html` has some contrast issues and accessible name mismatches.
7. `historia.html` has background/foreground color contrast issues.
