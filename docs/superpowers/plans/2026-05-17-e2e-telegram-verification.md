# E2E Telegram Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two targeted fixes then run the full pipeline to verify Telegram delivers job cards and tailored resume files end-to-end.

**Architecture:** Two config/code changes only — cap Claude API calls at 4 for the test run, and add a `?date_posted=1` query param to Bayt search URLs so it returns only last-24-hour jobs (matching Indeed's `fromage=1` behaviour). No new files. No new abstractions. Then run `tsx src/index.ts` and watch Telegram.

**Tech Stack:** TypeScript, tsx, node-telegram-bot-api, @anthropic-ai/sdk, Playwright (Bayt/Indeed scrapers)

---

## Files Touched

| File | Change |
|------|--------|
| `config.json` | `ai.max_calls_per_day`: 25 → 4 |
| `src/scrapers/bayt.ts` | `buildSearchUrl()`: append `?date_posted=1` to URL |

---

### Task 1: Cap Claude API calls at 4

**Files:**
- Modify: `config.json`

- [ ] **Step 1: Edit config.json**

Open `config.json` and change line 16 from:
```json
"max_calls_per_day": 25
```
to:
```json
"max_calls_per_day": 4
```

Full `ai` block after change:
```json
"ai": {
  "max_calls_per_day": 4,
  "max_tokens": 3000
}
```

- [ ] **Step 2: Verify the value loaded correctly**

Run:
```
node_modules\.bin\tsx -e "import('./src/config.ts').then(m => console.log('cap:', m.config.ai.max_calls_per_day))"
```
Expected output:
```
cap: 4
```

- [ ] **Step 3: Commit**

```bash
git add config.json
git commit -m "config: cap Claude calls at 4 for e2e test run"
```

---

### Task 2: Add Bayt last-24-hours date filter

**Files:**
- Modify: `src/scrapers/bayt.ts`

Context: `buildSearchUrl` currently returns `https://www.bayt.com/en/uae/jobs/{keyword}-jobs/` with no date filter. Bayt supports `?date_posted=1` for last 24 hours (same intent as Indeed's `fromage=1`).

- [ ] **Step 1: Update buildSearchUrl in bayt.ts**

Find this function (lines 6–9):
```typescript
function buildSearchUrl(keyword: string): string {
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `https://www.bayt.com/en/uae/jobs/${slug}-jobs/`;
}
```

Replace with:
```typescript
function buildSearchUrl(keyword: string): string {
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `https://www.bayt.com/en/uae/jobs/${slug}-jobs/?date_posted=1`;
}
```

- [ ] **Step 2: Verify the URL shape is correct**

Run:
```
node_modules\.bin\tsx -e "
const k = 'software engineer';
const slug = k.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-${'$'}/g, '');
console.log('https://www.bayt.com/en/uae/jobs/' + slug + '-jobs/?date_posted=1');
"
```
Expected output:
```
https://www.bayt.com/en/uae/jobs/software-engineer-jobs/?date_posted=1
```

- [ ] **Step 3: Run Bayt self-test to confirm scraper still works**

```
node_modules\.bin\tsx src\scrapers\bayt.ts
```

Watch the logs. Expected: at least one keyword returns job cards. If Bayt returns 0 results for ALL keywords (Cloudflare challenge), that's intermittent rate-limiting unrelated to the URL change — it will recover in the real poll cycle. If you see job cards even for one keyword, the change is good.

- [ ] **Step 4: Commit**

```bash
git add src/scrapers/bayt.ts
git commit -m "feat(bayt): add date_posted=1 filter for last-24-hours jobs"
```

---

### Task 3: Run the full pipeline and verify Telegram

**Files:** None — read-only verification step.

- [ ] **Step 1: Run the full pipeline**

```
node_modules\.bin\tsx src\index.ts
```

The app runs `runCycle()` immediately on start, then starts the 30-minute cron. Watch the console output for the scrape → filter → tailor → notify sequence.

- [ ] **Step 2: Check Telegram — success criteria**

Open Telegram and confirm:

**For each new matched job (up to 4 tailored):**
- Message 1: HTML job card containing job title, company, location, portal, and a clickable "View Posting" link
- Message 2: A `.md` file named `resume_<Company>.md` — open it and confirm all sections are rewritten (Summary, Skills, every Experience bullet). No banned words: architected, engineered, leveraged, utilized, spearheaded, streamlined, orchestrated, synergized, robust.

**For any match beyond the 4-call cap:**
- Message: HTML job card only, with text "Resume tailoring skipped (daily cap reached or AI unavailable)"

- [ ] **Step 3: Check console for errors**

Expected console pattern for a successful run:
```
[<timestamp>] ── Portal poll cycle started ───
[<timestamp>] Scraped N unique jobs across all portals
[<timestamp>] After filtering: M job(s) match your criteria
[<timestamp>] [NEW] LinkedIn | Software Engineer @ Acme (Dubai, UAE)
[<timestamp>] [ResumeTailor] Tailoring for "Software Engineer" at Acme (call 1/4)
[<timestamp>] [ResumeTailor] Done — in=XXXX out=XXXX cache_read=XXXX cost=$0.XXXX
[<timestamp>] [Notifier] Telegram alert sent for "Software Engineer"
[<timestamp>] [Notifier] Telegram resume document sent for "Software Engineer"
[<timestamp>] ── Portal cycle done — M new job(s) processed ──
```

No `[ERROR]` lines should appear.

- [ ] **Step 4: Handle 0 matches (fallback)**

If the cycle completes with `0 new job(s) processed`, the dedup database may have stale entries from prior scraper self-tests, or scrapers hit an off-peak window. Clear seen jobs and rerun:

```
node_modules\.bin\tsx -e "
const Database = require('better-sqlite3');
const db = new Database('./data/dedup.db');
const result = db.prepare('DELETE FROM seen_jobs').run();
console.log('Cleared', result.changes, 'seen jobs');
db.close();
"
```

Then stop the running process (`Ctrl+C`) and rerun:
```
node_modules\.bin\tsx src\index.ts
```

- [ ] **Step 5: Commit verification note (optional)**

If everything worked, update the spec to mark the verification complete:

```bash
git add .
git commit -m "chore: e2e Telegram verification passed"
```
