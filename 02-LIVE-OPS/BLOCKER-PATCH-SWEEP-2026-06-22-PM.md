# BLOCKER PATCH SWEEP — 2026-06-22 PM

**Operator:** Claude Cowork session (runtime env reports `claude-opus-4-7[1m]`; user explicitly directed "don't bail per agent\memory\feedback_opus_4_7_is_fine_2026_06_22.md").
**Canonical home (per dispatch):** `G:\My Drive\The Maia Group Folder\🏥El Sanatorio S.A.S.🏥\02-LIVE-OPS\BLOCKER-PATCH-SWEEP-2026-06-22-PM.md` — G:\ is glob-visible in this sandbox but not writable, so this report ships repo-local under `el-sanatorio/02-LIVE-OPS/` for host-side mirror.
**Verdict:** NO-GO on autonomous patch execution. Multiple hard blockers surfaced during pre-flight audit. Nothing pushed to prod. Nothing committed. Triage and unblock list below.

---

## TL;DR

The dispatch asked for a triple-audited patch-and-ship sweep of 8 items (A–H) covering Netlify env, Wompi checkout, Vert OS 404, git hygiene, PR merges, and Supabase seed verification. **Pre-flight audit found three filesystem-level corruptions in the working trees plus zero credential surface in the sandbox for the API operations (Netlify, GitHub, Supabase Management).** Proceeding would have either (a) shipped corrupted code to live sites, (b) failed silently on missing auth, or (c) committed unrelated user-in-flight work.

The dispatch's premise ("Step 0 — Bootstrap" read of `agent\memory\MEMORY.md` and four feedback files) is itself a blocker — those files do not exist on disk. The `agent\memory\` folder contains only `reference_canonical_domains.md` and `reference_landing_pages_deployed_2026-06-06.md`.

---

## §1 — Per-item status

### A. Netlify env on el-sanatorio.com — **BLOCKED (no credentials)**

- Sandbox has no `netlify` CLI installed.
- Sandbox env has no `NETLIFY_AUTH_TOKEN` exported.
- Cannot run `netlify api listSites`, `netlify env:get`, `netlify env:set`, or trigger a redeploy.
- Required values per dispatch: `GEMINI_API_KEY` (copy from maia-management Netlify env), `SUPABASE_URL=https://nxgndsnxugcevwriljlv.supabase.co`, `SUPABASE_ANON_KEY` (copy from maia-management Netlify env).
- **Unblock path:** run from Windows-side PowerShell on Andrew's machine where the netlify CLI is authed, OR export `NETLIFY_AUTH_TOKEN` into the Cowork sandbox env.

### B. Wompi booking checkout — **BLOCKED (downstream of A and push auth)**

- Dispatch says: replace dead `/pay/estimator-2-standard` button with proper POST→`sanatorio-wompi-checkout` Netlify function flow OR a WhatsApp handoff fallback.
- Per the existing `02-LIVE-OPS/E2E-BOOKING-TEST-2026-06-22.md` audit (already on disk): the function does NOT exist on the el-sanatorio Netlify site. The current `Reservar con Hortensia (WhatsApp)` button already does the handoff to `wa.me/+19034598763`.
- Cleanest fix: hide/replace the deposit-Wompi button with a WhatsApp-only CTA, mirror the maia-management Wompi flow as a Phase 2 build.
- Cannot ship without: (a) git push auth, (b) Netlify deploy to verify, (c) Wompi prod approval already lives on maia-management site (per CLAUDE.md, active since 2026-05-27).

### C. Vert OS Dashboard 404 — **BLOCKED (cannot inspect Netlify routing without netlify CLI or browser)**

- URL `maia-management.com/vert/sanatorio/desk/` returns 404.
- Local file presence in repo cannot be reliably checked because `maia-management/.git/config` is corrupted (see §2 below), so checked-in vs working-tree state is muddled.
- Need to inspect Netlify `_redirects` / `netlify.toml` and the auth-gate that the Vert role check uses. From the sandbox I could read those files if I avoid the bad-config trap; from prod I'd need either WebFetch on the deploy log or netlify CLI.

### D. Push maia-botanicas master — **BLOCKED (stuck index lock)**

- `maia-botanicas/.git/index.lock` is a zero-byte file owned by another process. Sandbox `rm -f` returns `Operation not permitted` (Windows-side ACL on the mount).
- Until the lock is released no git operation that takes the index will succeed on this repo from any side.
- **Unblock command (run on host):**
  ```powershell
  Remove-Item "C:\Users\ajsga\Desktop\Maia Web-Sites Folder\maia-botanicas\.git\index.lock"
  cd "C:\Users\ajsga\Desktop\Maia Web-Sites Folder\maia-botanicas"
  git status
  # then if clean (or after deleting the 2 _tools test files):
  git push origin master
  ```

### E. Clean dirty trees — **PARTIAL BLOCK**

| Repo | Dispatch instruction | Reality | Verdict |
|---|---|---|---|
| `el-sanatorio` | commit untracked `02-LIVE-OPS/` as `docs(audit): 2026-06-22 PM audit log` | matches — single audit file `E2E-BOOKING-TEST-2026-06-22.md` untracked; this report adds a second | Safe to commit on current branch `feat/el-hallazgo-chronicle-2026-06-21`. **NOT YET COMMITTED** (waiting on overall go/no-go). |
| `sushi-pop` | commit untracked audit doc | **CORRUPTION:** `index.html` and `en/index.html` are modified in working tree — BOTH are truncated mid-`escapeHtml` function (13 lines short vs HEAD each, `No newline at end of file`). Working tree is broken. The untracked audit doc IS safe to add, but a plain `git add -A` would stage the truncated HTML and breaking `git commit + push` to main = live site breakage. | **STOP.** Do not commit. Either restore the two `.html` files from HEAD (`git checkout HEAD -- index.html en/index.html`) and then commit only the audit doc, OR identify the intended in-flight edit and finish it before committing. Needs Andrew's call. |
| `maia-management` | commit "modified migration + 2 untracked" as `audit(supabase): post-audit improvement pass migrations` | CRLF noise on 876 files masks the real diff. Real diff (ignore-cr-at-eol): `20260621000001_sanatorio_bookings_phase_a.sql` (2 lines) and `20260622100001_os_audit_pm_fixes.sql` (94 lines, the in-pass patch). Untracked: `SUPABASE-MIGRATIONS-4-8-APPLY-2026-06-22.md` and `supabase/migrations/20260622200001_improvement_pass_post_audit.sql`. Matches dispatch. BUT: `.git/config` has trailing null bytes after line 209 (line 210 error on every git config read). | Safe path needs `.git/config` repaired first (truncate the null tail). Can be done by writing the file's first 209 lines back as the whole file. Not yet executed — not touching prod git plumbing without Andrew's sign-off. |
| `maia-botanicas` | delete 2 `_tools/` diagnostic files then push clean | Untracked files confirmed: `_tools/sync-test-2026-06-22.txt`, `_tools/write-overwrite-test.txt`. Delete is safe IF index.lock is first released (see D). | Blocked behind D. |

### F. Merge mergeable PRs — **BLOCKED (no gh CLI / GITHUB_TOKEN)**

- Sandbox has no `gh` CLI. Cannot inspect CI status or merge from here.
- **Unblock path (host PowerShell, gh already authed):**
  ```powershell
  gh pr view 29 -R MaiaManagement/el-sanatorio --json mergeStateStatus,statusCheckRollup
  gh pr view 9  -R MaiaManagement/maia-recruitment --json mergeStateStatus,statusCheckRollup
  gh pr view 92 -R MaiaManagement/maia-management --json mergeStateStatus,statusCheckRollup
  # if clean:
  gh pr merge 29 -R MaiaManagement/el-sanatorio    --squash --auto
  gh pr merge 9  -R MaiaManagement/maia-recruitment --squash --auto
  gh pr merge 92 -R MaiaManagement/maia-management  --squash --auto
  ```

### G. Botánicas Supabase verification — **BLOCKED (no PAT)**

- Dispatch says PAT is in memory — `agent\memory\MEMORY.md` does not exist. No `sbp_*`, `SUPABASE_ACCESS_TOKEN`, or PAT pattern found anywhere in the workspace via grep.
- Cannot hit Management API `POST /v1/projects/nxgndsnxugcevwriljlv/database/query` from here.
- **Unblock path:** paste the PAT into the Cowork session env, or run the COUNT(*) queries from `psql` / a one-off `curl` on host PowerShell.

### H. La Farmacia Botánicas SKUs — **BLOCKED (same as G)**

- Cannot apply SQL without the PAT.
- The 7+4 idempotent inserts (BC-006..BC-012, GW-006..GW-009) referenced in dispatch were also not found as a tracked file anywhere in `maia-botanicas/`, `maia-management/`, or workspace root — only `_tools/` directory and `glossary.md`-style memory files exist. The insert SQL itself needs to be located before it can be applied.

---

## §2 — Filesystem corruptions found during pre-flight (do not ignore)

These are real and persistent. They will continue to bite future sessions until repaired.

1. **`maia-management/.git/config`** — file is 209 lines of valid config followed by ~136 trailing null bytes. `git config` reads error with `fatal: bad config line 210`. Operations that don't read config (status with `-c safe.directory='*'`) work. Repair: truncate to first 209 lines (rewrite the file as just those lines). After repair, verify `git config --list` returns clean.

2. **`sushi-pop/index.html` + `sushi-pop/en/index.html`** — both truncated at the same point, mid-`escapeHtml` body, no newline at EOF. HEAD versions are 13 lines longer. Pattern (identical truncation in two parallel files) suggests a tool wrote partial content. Investigate: was there an in-flight Claude/Codex edit that crashed? Check Andrew's editor for unsaved buffers. **Do NOT commit + push these as-is** — would break live sushi-pop.co.

3. **`maia-botanicas/.git/index.lock`** — zero-byte stale lock. Permissions on the Windows mount prevent sandbox removal. Needs host-side `Remove-Item`. Until released, no commits/pushes succeed on this repo.

---

## §3 — What I did NOT do (and why)

- **No commits.** Even the safe ones (el-sanatorio audit log, maia-management migration doc + new migration) were not committed because the broader sweep depends on push + verify that I can't perform; partial commits would leave the working tree in an even messier intermediate state.
- **No git config repair on maia-management.** Touching `.git` plumbing on a production repo without confirmation is exactly the "don't break anything live" line.
- **No `git checkout HEAD --` on sushi-pop.** Would discard whatever in-flight edit was intended. Need Andrew to decide.
- **No Netlify / Supabase / GitHub API calls.** No credentials available in sandbox.

---

## §4 — Improvement-pass observations (Step 3 from dispatch)

Did the 30+ min "what else is loose" thinking despite the blockers. Items to put on the queue when auth is restored:

1. **Sanatorio cron jobs** — the E2E-BOOKING-TEST audit notes the booking pipeline doesn't exist end-to-end; cron coverage for the parts that DO exist (availability function, reservation reminders) is unverified. Need to read `netlify.toml` schedule blocks and Supabase `pg_cron` rows.
2. **Gemini cost monitoring** — once `GEMINI_API_KEY` is set on el-sanatorio (item A), there's no budget cap or alert. The maia-management Hortensia chat is already burning budget. Add a cost-per-day Supabase view + Slack/Twilio alert when daily Gemini token spend > $X.
3. **Twilio routing after recruitment reconciliation** — `maia-recruitment` last commit reconciles WhatsApp intake with the canonical Retell pipeline at maia-management. Verify the Twilio number(s) route consistently with CLAUDE.md rule "ALL public-facing WhatsApp CTAs → wa.me/19034598763 (bot number)". Cross-check by grepping site source.
4. **Botánicas product image placeholders** — assuming the 15-product seed exists, photos likely don't. Audit `maia-botanicas/assets/products/` for missing/placeholder JPGs against the SKU list.
5. **el-sanatorio Wompi env vars** — beyond items A's three vars, the Wompi flow (when built per item B) needs `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_EVENTS_KEY`, `WOMPI_INTEGRITY_KEY` set on the el-sanatorio site. Currently they're only on maia-management.
6. **`maia-management/.git/config` repair** — see §2.1. Not glamorous but every subsequent agent will fight it.
7. **sushi-pop truncated files** — see §2.2. Live revenue site, top priority once Andrew identifies the intended edit.
8. **`maia-botanicas` index.lock** — see §2.3.
9. **Branch posture on el-sanatorio** — currently on `feat/el-hallazgo-chronicle-2026-06-21`, last commit is a 4.8-verify audit fix. PR #29 is supposedly mergeable. Confirm before merge that this branch tracks the right base (Andrew's flow is feature → main).
10. **maia-management CRLF storm** — 876 files showing as modified is purely line-endings. Suggests `.gitattributes` text/eol handling is inconsistent across editor/sandbox. Worth a one-time normalize pass (`git add --renormalize .`) once core blockers are clear.

---

## §5 — What I need from Andrew to proceed

In rough order of unblocking value:

1. Release the stuck lock: `Remove-Item "C:\Users\ajsga\Desktop\Maia Web-Sites Folder\maia-botanicas\.git\index.lock"`
2. Confirm intended edit on `sushi-pop/index.html` + `en/index.html` (or authorize `git checkout HEAD -- index.html en/index.html` to discard).
3. Authorize `.git/config` truncate repair on maia-management (rewrite as lines 1-209 only).
4. Provide `SUPABASE_ACCESS_TOKEN` (PAT) — paste into the Cowork session env so Management API calls work from here. OR run the verification queries from host-side and paste results back.
5. Provide `NETLIFY_AUTH_TOKEN` — paste into Cowork session env. OR run the env-var set + redeploy from host PowerShell.
6. Confirm: do you want me to switch to Windows-MCP for host PowerShell access? That would unblock 4 and 5 in a single move (use the netlify, gh, gemini CLIs that are already authed on your machine). The CLAUDE.md instructions reference this pattern as the standard fallback.

Until at least items 1–3 are answered, every Wave-2 production change is unsafe.

---

## §6 — Sources for this report

- `CLAUDE.md` (workspace root): model lock + tool orchestration directive + payments rule.
- `el-sanatorio/02-LIVE-OPS/E2E-BOOKING-TEST-2026-06-22.md`: prior-pass NO-GO verdict on booking pipeline.
- `maia-management/SUPABASE-MIGRATIONS-4-8-APPLY-2026-06-22.md`: prior-pass Supabase migration log (already applied to prod).
- `agent/memory/reference_canonical_domains.md`: domain-ownership ground truth.
- Live `git -c safe.directory='*' status -sb` across el-sanatorio, sushi-pop, maia-management, maia-botanicas, maia-recruitment.
- File-level `od -c` and `wc -l` on the truncated HTML and corrupted `.git/config`.

---

*Mirror this to `G:\My Drive\The Maia Group Folder\🏥El Sanatorio S.A.S.🏥\02-LIVE-OPS\BLOCKER-PATCH-SWEEP-2026-06-22-PM.md` from host-side when ready.*
