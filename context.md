# UAE Job Alert System — Project Context

## What This Is

A personal automated job alert system that:
1. Polls UAE job sources every 30 minutes
2. Filters jobs against user criteria (keywords, location, seniority, job type)
3. Deduplicates across sources and across poll cycles
4. Uses Claude AI to tailor the resume to each matched job (daily cap configurable — currently 0 to protect tokens)
5. Sends alerts via Telegram: a job card with the posting link, then the full tailored resume as a .md document attachment
6. Email notification wired (Gmail SMTP + PDF attachment via Puppeteer)

Built for: **Adeeb Waiz** (waizadeeb@gmail.com)
Runtime: Node.js + TypeScript
GitHub: https://github.com/adeeb123-crypto/job-alert-sys

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict), CommonJS |
| Runner (dev) | `tsx` — use `node_modules\.bin\tsx` on Windows |
| Scheduler | `node-cron` |
| LinkedIn scraper | LinkedIn guest jobs API (HTML regex parsing) — **ACTIVE, only working portal** |
| Indeed / Bayt | Playwright scrapers — **blocked by Cloudflare on DigitalOcean IPs** |
| Jooble API | REST API scraper — **DROPPED** (data quality/timing inaccurate) |
| NaukriGulf / GulfTalent | Permanent stubs (bot protection — see below) |
| Web job discovery | Serper.dev (Google Search API) + Jina AI Reader — ACTIVE |
| Dedup store | `better-sqlite3` (SQLite, WAL mode) |
| AI resume tailor | `@anthropic-ai/sdk` with prompt caching — cap currently **0** (protecting tokens) |
| PDF renderer | `pdfRenderer.ts` — built (Puppeteer + marked), wired into email notifier |
| Notifications | `node-telegram-bot-api` (job card + full resume as .md document) + `nodemailer` (Gmail SMTP + PDF attachment) |
| Landing page | Single-file HTML (`landing.html`) — deployed to Vercel |

---

## Project Structure

```
job-alert-system/
├── src/
│   ├── index.ts              # Entry point + cron wiring
│   ├── config.ts             # Loads config.json + .env, validates both
│   ├── types/index.ts        # All shared interfaces (Job, ParsedJD, TailoringResult, WebJobLead, Secrets)
│   ├── dedup.ts              # SQLite dedup + AI cost tracking + web lead dedup
│   ├── filter.ts             # 4-dimension job filter + parseSeniorityFromJD()
│   ├── scheduler.ts          # Poll cycle orchestrator
│   ├── resumeTailor.ts       # fetchFullJD() + tailorResume() — Phase 5 (DONE)
│   ├── notifier.ts           # Telegram (alert + resume document) + email (PDF attachment)
│   ├── pdfRenderer.ts        # Puppeteer + marked → PDF Buffer — Phase 8 (DONE)
│   └── scrapers/
│       ├── index.ts          # Runs all scrapers concurrently
│       ├── browser.ts        # Shared Playwright stealth setup (basic — upgrade planned)
│       ├── linkedin.ts       # Guest API scraper — ACTIVE (only working portal)
│       ├── jooble.ts         # Jooble API scraper — present but DROPPED (bad data quality)
│       ├── indeed.ts         # Playwright scraper — Cloudflare blocked, kept for future stealth engine
│       ├── bayt.ts           # Playwright scraper — Cloudflare blocked, kept for future stealth engine
│       ├── naukrigulf.ts     # Stub — PerimeterX bot protection, permanently disabled
│       ├── gulftalent.ts     # Stub — Akamai CDN blocks all access, permanently disabled
│       ├── websearch.ts      # Serper.dev + Jina AI Reader — ACTIVE
│       └── companyScraper.ts # Curated UAE company career pages — PAUSED
├── src/antidetect/           # NEW (Stage 1)
│   ├── proxyManager.ts       # SmartProxy residential proxy config, sticky sessions
│   └── stealthBrowser.ts     # playwright-extra + stealth plugin, replaces browser.ts
├── src/crawler/              # NEW (Stage 2)
│   ├── index.ts              # Persistent main loop — runs 24/7 as PM2 process
│   ├── companyStore.ts       # companies table CRUD + seed loader
│   ├── crawlQueue.ts         # crawl_queue table — batch dequeue, reschedule, fail tracking
│   ├── careerPageLocator.ts  # Finds career URL for a domain (probe → link scan → Claude)
│   ├── changeDetector.ts     # SHA256 hash change detection, strips dynamic noise
│   ├── jobExtractor.ts       # Jina AI first, Playwright fallback → Job[]
│   └── discoveryEngine.ts    # Daily Serper + tech hub discovery of new UAE companies
├── src/data/
│   └── uaeCompanies.ts       # NEW — seed list of ~90 UAE tech companies
├── ecosystem.config.js       # NEW — PM2 dual-process config (scheduler + crawler)
├── docs/
│   └── superpowers/
│       ├── specs/            # Design documents
│       └── plans/            # Implementation plans
├── config.json               # User criteria + AI cost caps
├── resume.md                 # Adeeb's real resume (used by AI tailor)
├── context.md                # This file — living project context doc
├── landing.html              # Marketing landing page (deployed to Vercel)
├── vercel.json               # Vercel static deployment config
├── .env                      # Secrets (gitignored)
├── .env.example              # Template
├── package.json
├── tsconfig.json
└── data/
    └── dedup.db              # SQLite DB (gitignored)
```

---

## Phase Progress

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Project scaffold, config, types, secrets | Done |
| 2 | SQLite dedup | Done |
| 3 | LinkedIn scraper + filter | Done |
| 4 | Playwright scrapers (Indeed, Bayt) | Done (blocked by Cloudflare on VPS) |
| 5 | `fetchFullJD()` + Claude resume tailor | Done |
| 6 | Telegram + email notifier | Done |
| 7 | Full pipeline wiring + cron scheduler | Done |
| 7b | Web search pipeline: Serper.dev + Jina AI | Done |
| 7c | Jooble API scraper | Done (dropped — bad data quality/timing) |
| 7d | Landing page + Vercel deployment | Done |
| 8 | PDF renderer (`pdfRenderer.ts`) | Done |
| 9 | GitHub Actions + stealth browser | **DROPPED** — replaced by Unified Crawler plan |
| 9b | Unified Crawler: Stage 1 (anti-detection + portal revival) | **Next — plan written, not yet implemented** |
| 9c | Unified Crawler: Stage 2 (persistent career page crawler) | **Next — plan written, not yet implemented** |
| 10 | Docker + Fly.io deployment | Deferred |

---

## Unified Crawler Plan — Replacing Phase 9 (session 2026-05-27)

**Why Phase 9 (GitHub Actions) was dropped:**
A persistent 24/7 career page crawler cannot run on GitHub Actions (6-hour job limit, no persistent process). The DigitalOcean Droplet is permanent. GitHub Actions is dropped entirely.

**Approach chosen: Staged Foundation Build (Approach C)**

### Stage 1 — Anti-Detection Foundation + Portal Revival
Plan: `docs/superpowers/plans/2026-05-27-stage1-antidetect-portal-revival.md`

- New module `src/antidetect/proxyManager.ts` — residential proxy config with sticky sessions per domain
- New module `src/antidetect/stealthBrowser.ts` — replaces `browser.ts`, uses `playwright-extra` + `puppeteer-extra-plugin-stealth`
- **Proxy provider:** SmartProxy residential (~$28/month, UAE-targeted exit nodes)
- Indeed, Bayt re-enabled (~90% and ~75-80% confidence respectively)
- NaukriGulf upgraded attempt (~40-50% — PerimeterX, no guarantees)
- `ecosystem.config.js` added for PM2

**What Adeeb must do before Stage 1 runs:** Sign up at smartproxy.com, get `PROXY_USER` + `PROXY_PASS`, add to `.env` on DO server.

### Stage 2 — Persistent Company Career Page Crawler
Plan: `docs/superpowers/plans/2026-05-27-stage2-persistent-crawler.md`

- Runs as second PM2 process (`crawler`) alongside existing `scheduler`
- Two new SQLite tables: `companies` + `crawl_queue` (added to `data/dedup.db`)
- Seeds with ~90 curated UAE companies (`src/data/uaeCompanies.ts`)
- Modules: `companyStore`, `crawlQueue`, `changeDetector`, `careerPageLocator`, `jobExtractor`, `discoveryEngine`
- Change detection: SHA256 hash of normalized career page content
- Job extraction: Jina AI Reader first, Playwright fallback for SPAs
- Freshness: crawl timestamp + explicit date extraction + sitemap.xml `lastmod` + job ID delta
- Discovery: daily Serper queries + UAE tech hub directories (in5, Hub71, DIFC)
- Outputs `Job[]` with `portal: 'CareerPage'` — plugs straight into existing filter → dedup → notifier
- PM2 memory guardrail: `max_memory_restart: 500M`, browser instances recycled every 50 fetches

**Key verified export names (for crawler/index.ts):**
- `notifyJob(job, tailoringResult)` from `notifier.ts`
- `filterJobs(jobs, config)` from `filter.ts`

---

## Current Config State

**`config.json` key values:**
- `poll_interval_minutes`: 30
- `keywords`: software engineer, backend engineer, backend developer, full stack developer, full stack engineer, fullstack developer, fullstack engineer, node.js developer, software developer
- `seniority`: min 2 years, max 10 years
- `ai.max_calls_per_day`: **0** (temporarily disabled — protecting Claude tokens)
- `ai.max_tokens`: 3000
- `notifications.telegram.chat_id`: configured (real value)
- `notifications.email.from/to`: waizadeeb@gmail.com

**`.env` key state:**
- `TELEGRAM_BOT_TOKEN`: configured
- `CLAUDE_API_KEY`: configured
- `SERPER_API_KEY`: configured (Serper.dev — replaced Brave Search)
- `BRAVE_SEARCH_API_KEY`: **cancelled and removed** (2026-05-27)
- `JOOBLE_API_KEY`: configured (kept in .env but scraper dropped from pipeline)
- `SMTP_USER` / `SMTP_PASS`: configured (Gmail App Password)
- `PROXY_HOST` / `PROXY_PORT` / `PROXY_USER` / `PROXY_PASS`: **pending** — needs SmartProxy signup

**`.env.example` template (updated in Stage 1 Task 1):**
```
TELEGRAM_BOT_TOKEN=
CLAUDE_API_KEY=
SMTP_USER=
SMTP_PASS=
SERPER_API_KEY=
PROXY_HOST=gate.smartproxy.com
PROXY_PORT=10000
PROXY_USER=
PROXY_PASS=
```

---

## Active Scrapers / Sources

### LinkedIn (`src/scrapers/linkedin.ts`) — ACTIVE, only working portal
- LinkedIn guest jobs API — no auth, no Cloudflare protection
- Time filter: `r86400` (last 24 hours), sorted date descending
- Loops all config keywords with delays
- Returns ~80 raw jobs / ~22 unique per run (solid coverage)

### Serper.dev Web Search (`src/scrapers/websearch.ts`) — ACTIVE
- POST to `google.serper.dev/search` with `tbs: 'qdr:d2'`, `gl: 'ae'`, `hl: 'en'`
- Post-filters: skips aggregators, requires career URL pattern, UAE signal check
- Jina AI Reader fetches full JD text (free, no API key)
- Result: `WebJobLead[]` — Telegram card only, no Claude tailoring

### NaukriGulf (`src/scrapers/naukrigulf.ts`) — Stub → Re-implement in Stage 1
- Currently returns `[]` (PerimeterX permanent stub)
- Stage 1 will attempt full re-implementation with stealthBrowser (40-50% success chance)
- GulfTalent remains permanent stub (Akamai CDN — not worth attempting)

### Jooble (`src/scrapers/jooble.ts`) — DROPPED
- File exists, exported but not called in `runAllScrapers()`
- Reason: inaccurate job timing (24h filter unreliable), stale listings
- Kept on disk for reference

### Indeed / Bayt — Cloudflare Blocked → Will be revived in Stage 1
- Files exist, not in `runAllScrapers()`
- Blocked on DigitalOcean + local test confirmed Cloudflare 403
- Stage 1 re-enables with stealthBrowser + SmartProxy residential IPs

---

## Key Design Decisions

### Scraper Architecture
- Each scraper exports `(): Promise<Job[]>` — clean interface, easy to swap
- `runAllScrapers()` uses `Promise.allSettled` — one failure doesn't kill others
- Cross-portal dedup by SHA256 fingerprint (company + title + location)

### Polling Strategy
- 30-minute interval
- LinkedIn covers aggregator side
- WebSearch covers direct company career pages not on aggregators

### Browser Stealth (Current — Basic, Upgrade Planned)
- `src/scrapers/browser.ts` — only masks `navigator.webdriver`
- Stage 1 replaces this with `src/antidetect/stealthBrowser.ts`:
  - `playwright-extra` + `puppeteer-extra-plugin-stealth`
  - Fixes: canvas, WebGL, `navigator.plugins`, `chrome.runtime`, `permissions` API, `outerWidth`
  - Wires SmartProxy residential proxies automatically
  - Adds `homepageFirst()`, `realisticViewport()`, proper `randomDelay()`
- `src/antidetect/proxyManager.ts` — manages proxy config with sticky sessions per domain

### AI Resume Tailoring — Tone and Style Rules
- Edit ALL sections: Summary, Skills, every Experience bullet
- Mirror job language where genuinely fitting
- Never invent skills, titles, or experience
- Banned words: architected, engineered, leveraged, utilized, spearheaded, streamlined, orchestrated, synergized, robust, cutting-edge, innovative, dynamic
- No filler: "responsible for", "tasked with", "helped to"
- ATS-safe Markdown only

### Telegram Delivery
- Job card: title, company, location, type, portal, posting link
- Resume: full tailored Markdown via `bot.sendDocument()` as `.md` file
- Web leads: simpler card, no resume

### Dedup
- SHA256: `company.toLowerCase() + title.toLowerCase() + location.toLowerCase()`
- SQLite `seen_jobs` table — 30-day TTL
- Web leads: `web_job_leads` table — URL-keyed, 7-day TTL

### Filter (4 dimensions)
1. Keyword — title or first 500 chars of rawJD (with 2-token fallback)
2. Location — dubai, abu dhabi, sharjah, uae, united arab emirates, remote (uae)
3. Job type — full-time or contract
4. Seniority — regex parses years from JD; ambiguous = pass

### PDF Renderer
- `pdfRenderer.ts`: `marked` (markdown → HTML) → Puppeteer `page.pdf()`
- Wired into `notifier.ts` — email gets PDF attachment, Telegram gets .md document

---

## Landing Page

**URL:** https://job-alert-sys.vercel.app/
**File:** `landing.html`
**Repo:** https://github.com/adeeb123-crypto/job-alert-sys (personal GitHub: adeeb123-crypto)
**Design:** Cream (#fafaf8), gold (#c9a96e), Cormorant Garamond + DM Sans
**Formspree:** `YOUR_FORMSPREE_ID` still placeholder — needs real ID from formspree.io

---

## How to Run

```bash
# Install deps (use Bash on Windows — PowerShell blocks npm.ps1)
npm install

# Install Playwright browser
npx playwright install chromium

# Self-test individual scrapers
node_modules\.bin\tsx src\scrapers\linkedin.ts
node_modules\.bin\tsx src\scrapers\websearch.ts
node_modules\.bin\tsx src\scrapers\jooble.ts

# Run full pipeline
node_modules\.bin\tsx src\index.ts
```

---

## Errors Encountered and Fixed (Cumulative)

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `npm install` blocked in PowerShell | Windows execution policy | Use Bash |
| LinkedIn RSS returned HTML | LinkedIn discontinued RSS | Rewrote to guest API + regex |
| Indeed RSS 403 | Bot detection | Converted to Playwright |
| LinkedIn returning stale jobs | Default sort = relevance | Added `sortBy=DD` + `f_TPR=r86400` |
| 0 jobs passing keyword filter | LinkedIn returns title variants | Expanded keywords + 2-token fallback |
| TypeScript errors on DOM types | `tsconfig.json` missing `"dom"` | Added `"dom"` to lib array |
| Indeed scraper returned 0 | Old selector | New selector: `a.jcs-JobTitle[data-jk]` |
| NaukriGulf timeout | PerimeterX | Permanent stub |
| GulfTalent 403 | Akamai CDN | Permanent stub |
| `isNewJob is not a function` | Wrong export name | Fixed to `isDuplicate` |
| `Cannot read properties` on dedup | `initDb()` not called | Added `initDb()` before dedup |
| DDG returns 0 / CAPTCHA | IP bot detection | Replaced with Brave Search |
| Brave API HTTP 422 | Invalid params on paid plan | Removed params |
| Brave returns only aggregators | No `.ae` career pages in index | Replaced with Serper.dev |
| Serper returning global jobs | Missing geo | Added `gl: 'ae'` + `isUAEResult()` |
| `poll_interval_minutes: 5` | Misconfigured | Corrected to 30 |
| resume.md malformed | Bullets collapsed | Rewrote with correct Markdown |
| Telegram showed 350-char preview | `buildJobTelegramHtml` truncated | Replaced with `bot.sendDocument()` |
| Claude output truncated | `max_tokens: 2000` too tight | Raised to 3000 |
| Vercel "No Output Directory" | Expected SPA build | Added `vercel.json` with static builder |
| Vercel deployment blocked | Work GitHub token in Credential Manager | Cleared Credential Manager, used personal account |
| `marked` TypeScript error | No type declarations in marked v4 | Replaced import with `require` + cast |
| Puppeteer `networkidle0` invalid | Not valid for `setContent` | Changed to `'load'` |
| `better-sqlite3` build error on server | Missing `make` build tool | `apt install build-essential python3` |
| GitHub password auth rejected | GitHub removed password auth 2021 | Use Personal Access Token |
| PM2 argument truncation | Args after `--` truncated | Created `start.sh` wrapper |
| Indeed/Bayt 403 on server | Cloudflare blocklist (DigitalOcean IPs) | Replaced with Jooble (then dropped Jooble too) |
| Jooble 403 locally | Missing/malformed `JOOBLE_API_KEY` in `.env` | Fixed .env syntax |
| Jooble data quality | Stale listings, inaccurate 24h filter | Dropped Jooble, plan Phase 9 stealth |
| SERPER_API_KEY in .env.example | Implementer regression | Fixed to BRAVE_SEARCH_API_KEY |
| BRAVE_SEARCH_API_KEY still in .env.example | Stale key after Brave replaced by Serper | Fixed in Stage 1 Task 1 (.env.example rewritten) |
| Brave API key active despite service unused | Oversight | Cancelled 2026-05-27; SERPER_API_KEY is the active key |

---

## Open Items (Priority Order)

### Stage 1 — Next Build (plan ready)
1. **Sign up for SmartProxy** — Adeeb's one required action. smartproxy.com, residential plan ~$28/month. Get `PROXY_USER` + `PROXY_PASS`. Add to `.env` on DO server.
2. **Execute Stage 1 plan** — `docs/superpowers/plans/2026-05-27-stage1-antidetect-portal-revival.md`
   - Build `proxyManager.ts` + `stealthBrowser.ts`
   - Re-enable Indeed, Bayt, NaukriGulf with stealth + proxy
   - `ecosystem.config.js` for PM2

### Stage 2 — After Stage 1 Confirmed Working
3. **Execute Stage 2 plan** — `docs/superpowers/plans/2026-05-27-stage2-persistent-crawler.md`
   - 90-company seed list, crawl queue, change detection, career page locator
   - Persistent PM2 crawler process
   - Daily discovery engine

### Credentials / Config
4. **Re-enable AI cap** — set `ai.max_calls_per_day` from 0 to desired number once pipeline stable
5. **Formspree form ID** — replace `YOUR_FORMSPREE_ID` in `landing.html`, redeploy to Vercel

### Deferred
6. **Custom domain** — `jobalertsuae.com` (~$11/year) when ready to go public
7. **Docker + Fly.io** — Phase 10, after crawler confirmed stable

---

## Resume Summary

**Adeeb Waiz** — Full Stack Developer, 3 years experience
Skills: C#, .NET Core, React, Next.js, Angular, Node.js, TypeScript, SQL Server, PostgreSQL, MongoDB, Redis, Azure, Docker, Kubernetes, GitHub Actions
Experience: Market-i (Jan 2024–Present), INTELPEEK (Jan 2022–Dec 2023), VAI Marketing (intern, Jun–Dec 2021)
Education: Bachelor CS, BITS Dubai, 2019
