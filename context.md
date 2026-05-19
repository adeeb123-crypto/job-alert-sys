# UAE Job Alert System — Project Context

## What This Is

A personal automated job alert system that:
1. Polls UAE job sources every 30 minutes: Jooble API (structured job listings), and web search (Serper.dev → company career pages)
2. Filters jobs against user criteria (keywords, location, seniority, job type)
3. Deduplicates across sources and across poll cycles
4. Uses Claude AI to tailor the resume to each matched job (all sections rewritten, ATS-friendly, human tone)
5. Sends alerts via Telegram: a job card with the posting link, then the full tailored resume as a .md document attachment
6. Email notification wired (Gmail SMTP credentials pending — will activate automatically once set)

Built for: **Adeeb Waiz** (waizadeeb@gmail.com)  
Runtime: Node.js + TypeScript on Windows 11  
GitHub: https://github.com/adeeb123-crypto/job-alert-sys  
Landing page: https://job-alert-sys.vercel.app/ (deployed on Vercel, personal GitHub account)

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict), CommonJS |
| Runner (dev) | `tsx` — use `node_modules\.bin\tsx` on Windows |
| Scheduler | `node-cron` |
| LinkedIn scraper | LinkedIn guest jobs API (HTML regex parsing) — available but not in main pipeline |
| Jooble scraper | Jooble REST API (`jooble.org/api`) — **ACTIVE**, replaces Indeed + Bayt |
| Indeed / Bayt | Playwright headless browser — **REMOVED** from main pipeline, replaced by Jooble |
| NaukriGulf / GulfTalent | Permanent stubs (bot protection — see below) |
| Web job discovery | **Serper.dev** (Google Search API) + **Jina AI Reader** — ACTIVE, replaces Brave |
| Dedup store | `better-sqlite3` (SQLite, WAL mode) |
| AI resume tailor | `@anthropic-ai/sdk` with prompt caching — rewrites all sections, ATS-safe, no jargon |
| PDF renderer | Puppeteer — **Phase 8, not yet built** |
| Notifications | `node-telegram-bot-api` (job card + full resume as .md document) + `nodemailer` (Gmail SMTP — creds pending) |
| Landing page | Single-file HTML (`landing.html` / `index.html`) — deployed to Vercel |
| Deployment | Fly.io + Docker — Phase 9, pending |

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
│   ├── notifier.ts           # Telegram (alert + resume document) + email notifications
│   └── scrapers/
│       ├── index.ts          # Runs all scrapers concurrently (Jooble + WebSearch)
│       ├── browser.ts        # Shared Playwright stealth setup (kept for potential future use)
│       ├── linkedin.ts       # Guest API scraper — available but not in active pipeline
│       ├── jooble.ts         # Jooble API scraper — ACTIVE (replaces Indeed + Bayt)
│       ├── indeed.ts         # Playwright scraper — REMOVED from main pipeline
│       ├── bayt.ts           # Playwright scraper — REMOVED from main pipeline
│       ├── naukrigulf.ts     # Stub — PerimeterX bot protection, permanently disabled
│       ├── gulftalent.ts     # Stub — Akamai CDN blocks all access, permanently disabled
│       ├── websearch.ts      # Serper.dev + Jina AI Reader — ACTIVE
│       └── companyScraper.ts # Curated UAE company career pages — PAUSED (ineffective)
├── config.json               # User criteria + AI cost caps
├── resume.md                 # Adeeb's real resume (used by AI tailor — all sections clean and structured)
├── context.md                # This file — living project context doc
├── landing.html              # Marketing landing page (also deployed as index.html on Vercel)
├── vercel.json               # Vercel static deployment config
├── .env                      # Secrets (gitignored)
├── .env.example              # Template
├── package.json
├── tsconfig.json             # lib: ["ES2022", "dom"] — dom required for page.evaluate() types
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
| 4 | Playwright scrapers (Indeed, Bayt) | Done (replaced by Jooble) |
| 5 | `fetchFullJD()` + Claude resume tailor | Done |
| 6 | Telegram + email notifier | Done (Telegram confirmed; Gmail creds pending) |
| 7 | Full pipeline wiring + cron scheduler | Done |
| 7b | Web search pipeline: Serper.dev + Jina AI | Done |
| 7c | Jooble API scraper (replaces Indeed + Bayt) | Done |
| 7d | Landing page + Vercel deployment | Done |
| 8 | PDF renderer (`pdfRenderer.ts`) | Next — not started |
| 9 | Docker + Fly.io deployment | Pending |

---

## Current Config State

**`config.json` key values:**
- `poll_interval_minutes`: 30
- `keywords`: software engineer, backend engineer, backend developer, full stack developer, full stack engineer, fullstack developer, fullstack engineer, node.js developer, software developer
- `seniority`: min 2 years, max 10 years
- `ai.max_calls_per_day`: 25
- `ai.max_tokens`: 3000 (raised from 2000 — needed headroom for full resume rewrite)
- `notifications.telegram.chat_id`: configured (real value)
- `notifications.email.from/to`: still placeholder — waiting on SMTP creds

**`.env` key state:**
- `TELEGRAM_BOT_TOKEN`: configured (real value)
- `CLAUDE_API_KEY`: configured (real value)
- `SERPER_API_KEY`: configured (Serper.dev — free tier 2,500 queries)
- `JOOBLE_API_KEY`: configured (Jooble API — free)
- `SMTP_USER` / `SMTP_PASS`: **still placeholder** — needs Gmail App Password

**`.env.example` template includes:**
```
TELEGRAM_BOT_TOKEN=
CLAUDE_API_KEY=
SMTP_USER=
SMTP_PASS=
SERPER_API_KEY=
JOOBLE_API_KEY=
```

---

## Active Scrapers / Sources

### Jooble API (`src/scrapers/jooble.ts`) — ACTIVE
- Replaced Indeed + Bayt (Playwright scrapers removed from main pipeline)
- REST API: POST to `jooble.org/api/{JOOBLE_API_KEY}`
- Searches all config keywords in one call, UAE location filter
- Free plan, instant signup, no credit card
- Returns structured job data: title, company, location, salary, snippet, url

### Serper.dev Web Search (`src/scrapers/websearch.ts`) — ACTIVE
- Replaced Brave Search API (which only returned aggregators and didn't support freshness/geo params on paid plan)
- POST to `google.serper.dev/search` with:
  - `tbs: 'qdr:d2'` — freshness: last 2 days only
  - `gl: 'ae'` — geo: UAE
  - `hl: 'en'` — language: English
  - `num: 10` — results per query
- Builds 2 queries from config keywords (batched halves)
- Post-filters:
  - Skips known aggregators (LinkedIn, Bayt, Indeed, Glassdoor, etc.)
  - Requires career path in URL or title (`/jobs`, `/careers`, `/apply`, etc.)
  - UAE signal check on title + snippet + URL (Dubai, Abu Dhabi, Sharjah, UAE, .ae etc.)
  - Dedup check against `web_job_leads` SQLite table
- Jina AI Reader: fetches full JD text from each candidate URL (`GET https://r.jina.ai/{url}`) — no API key required, free public service
- Seniority check: `parseSeniorityFromJD()` from `filter.ts` — skips if `parsed.min > config.seniority.max_years`
- Result: `WebJobLead[]` (url, title, company, snippet, jdText, foundAt) — sent to Telegram without Claude tailoring

### NaukriGulf / GulfTalent — Permanent Stubs
- NaukriGulf: PerimeterX bot protection — JS challenge prevents all automation
- GulfTalent: Akamai CDN hard-blocks at IP/TLS fingerprint level + pure AngularJS CSR (no server-rendered data anyway)
- Both return `[]` immediately

---

## Key Design Decisions

### Polling Strategy
- **30-minute interval** for all sources
- Jooble covers the structured portal side (replaces Indeed/Bayt — same "latest jobs" goal, no bot issues)
- WebSearch covers direct company career pages not on aggregators
- Dedup prevents re-alerts across poll cycles

### Jooble vs. Indeed/Bayt
- Indeed and Bayt were Playwright-based — heavy, slow, bot detection risk
- Jooble is a clean REST API: no browser, no stealth, no Cloudflare risk
- Tradeoff: Jooble aggregates from many portals including Indeed/Bayt, so coverage is similar or better

### WebSearch Pipeline Design
- **Goal**: find jobs on UAE company `.ae` and `.com/ae` career pages not listed on aggregators
- **Serper.dev** chosen over: Brave (broken geo/freshness params), SerpAPI (same product, higher price), Google CSE (limited, no freshness)
- **Jina AI Reader** for JD fetching: free public service, no API key, clean text extraction — replaces Playwright browser for this use case
- **Expected behavior**: 0 leads is normal if no new company career pages were indexed by Google in last 2 days matching keywords + UAE; aggregators are correctly rejected

### AI Resume Tailoring — Tone and Style Rules
The system prompt in `resumeTailor.ts` instructs Claude to:
- Edit ALL sections: Summary, Skills, and every Experience bullet (not just reorder)
- Mirror job language where it genuinely fits the candidate's background
- Never invent skills, titles, or experience
- Use specific, concrete action verbs — banned words: architected, engineered, leveraged, utilized, spearheaded, streamlined, orchestrated, synergized, robust, cutting-edge, innovative, dynamic
- Avoid filler phrases: "responsible for", "tasked with", "helped to"
- No unnecessary hyphens within sentences or colons that break reading flow
- ATS-safe formatting: clean section headers, no tables or columns, standard Markdown only
- Natural human voice throughout

### Telegram Delivery
- **Alert message**: job title, company, location, type, portal, clickable posting link, one-line note about attached resume
- **Resume document**: full tailored Markdown sent via `bot.sendDocument()` as a `.md` file named after the company (e.g. `resume_Acme_Tech.md`)
- Web search leads: simpler Telegram card (title, company, URL) — no Claude tailoring for web leads

### Dedup
- SHA256 fingerprint: `company.toLowerCase() + title.toLowerCase() + location.toLowerCase()`
- SQLite `seen_jobs` table — 30-day TTL
- Web leads: separate `web_job_leads` table — URL-keyed, 7-day TTL

### Filter (4 dimensions)
1. Keyword — title or first 500 chars of rawJD
2. Location — dubai, abu dhabi, sharjah, uae, united arab emirates, remote (uae)
3. Job type — full-time or contract
4. Seniority — regex parses years from JD; ambiguous = pass

### Claude Cost Protection
1. Daily call cap (`ai.max_calls_per_day` = 25)
2. Prompt caching — system prompt + resume.md as stable cached prefix
3. Per-call cost logging to `ai_call_log` SQLite table

---

## Landing Page

**URL:** https://job-alert-sys.vercel.app/  
**File:** `landing.html` (committed) / `index.html` (Vercel root)  
**Repo:** https://github.com/adeeb123-crypto/job-alert-sys (personal GitHub account: adeeb123-crypto)

**Design:** Clean & Premium — cream background (#fafaf8), gold accents (#c9a96e), dark charcoal (#1a1a1a), Cormorant Garamond + DM Sans fonts

**Features:**
- Split hero: text left, animated Telegram notification card right (cycles 4 UAE job alerts every 4s)
- Stats bar: "5 min avg alert time / 5 portals monitored / Top 10% applicants"
- How It Works: 4-step flow
- Feature cards grid (6 cards)
- Portal logos section
- CTA with Formspree waitlist form + stacked blurred avatars + localStorage counter (seeded 51–93, increments 20% per visit)
- Hamburger mobile nav
- Scroll reveal animations via IntersectionObserver

**Formspree:** Form action is `https://formspree.io/f/YOUR_FORMSPREE_ID` — **still placeholder**, needs real form ID from formspree.io (free tier, no backend needed)

**Deployment:** Vercel with `vercel.json` using `@vercel/static` builder. Personal GitHub account (adeeb123-crypto) — NOT the work account. Windows Credential Manager was cleared to ensure correct GitHub identity.

---

## Open Items (Priority Order)

### Immediate
1. **End-to-end pipeline test** — run `node_modules\.bin\tsx src\index.ts` and confirm: a Telegram alert fires with a job card (title, company, posting link) followed immediately by a `.md` resume document. This verifies scrape → filter → Claude → notify all work together.

2. **Formspree form ID** — replace `YOUR_FORMSPREE_ID` in `landing.html` with real ID from formspree.io, then redeploy to Vercel.

### Phase 8 (Next Build)
3. **PDF renderer** — create `src/pdfRenderer.ts`:
   - Input: `tailoredMarkdown: string`
   - Output: `Buffer` (PDF)
   - Stack: `marked` (markdown → HTML) → Puppeteer `page.pdf()`
   - Wire into `notifier.ts` `sendEmail()` — add `attachments: [{ filename: 'resume.pdf', content: pdfBuffer }]`
   - Both `marked` (^4.3.0) and `puppeteer` are already in `package.json`

### Credentials
4. **Gmail SMTP** — `SMTP_USER` / `SMTP_PASS` still placeholder — user will provide creds in a future session
   - Gmail → Google Account → Security → 2-Step Verification → App Passwords → Mail → Generate
   - 16-character password → `SMTP_PASS`; Gmail address → `SMTP_USER`
   - No code changes needed — `notifier.ts` already checks for placeholder and skips gracefully

### Deferred
5. **CompanyScraper** — paused; Serper+Jina pipeline now covers the company career page use case
6. **Custom domain** — user interested in `jobalertsuae.com` (~$11/year); Vercel handles SSL automatically; buy when ready to go public
7. **Docker + Fly.io** — Phase 9, after full local pipeline verified

---

## How to Run

```bash
# Install deps (use Bash — PowerShell blocks npm.ps1 on this machine)
npm install

# Install Playwright browser (needed only if using Playwright scrapers directly)
npx playwright install chromium

# Self-test individual scrapers
node_modules\.bin\tsx src\scrapers\jooble.ts
node_modules\.bin\tsx src\scrapers\websearch.ts
node_modules\.bin\tsx src\scrapers\linkedin.ts

# Run full app
node_modules\.bin\tsx src\index.ts
```

**WebSearch self-test output (expected):**
```
=== WebSearch self-test (Serper.dev → Jina AI Reader) ===
[WebSearch] Query: "software engineer" OR "backend developer" UAE careers
[WebSearch] Serper returned 10 results
[WebSearch] SKIP (aggregator): "Software Engineer Jobs in UAE - LinkedIn"
[WebSearch] SKIP (not UAE): "Backend Engineer - Monterrey"
[WebSearch] Fetching JD: https://somecompany.ae/careers/backend-engineer
[WebSearch] NEW: "Backend Engineer" @ Somecompany
[WebSearch] Done — 1 new lead(s)
```
Zero leads is normal if no new direct company career pages appeared in the last 2 days for these keywords.

---

## Errors Encountered and Fixed (Cumulative)

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `npm install` blocked in PowerShell | Windows script execution policy | Use Bash for all npm/node commands |
| LinkedIn RSS returned HTML | LinkedIn discontinued RSS | Rewrote to guest jobs API + regex |
| Indeed RSS returned 403 | Bot detection | Converted to Playwright |
| LinkedIn returning stale jobs | Default sort = relevance | Added `sortBy=DD` + `f_TPR=r3600` |
| 0 jobs passing keyword filter | LinkedIn returns title variants | Expanded config keywords |
| TypeScript errors on DOM types in `page.evaluate()` | `tsconfig.json` missing `"dom"` | Added `"dom"` to lib array |
| Indeed scraper returned 0 jobs | Old selector gone from DOM | New selector: `a.jcs-JobTitle[data-jk]` |
| NaukriGulf timeout | PerimeterX bot protection | Permanent stub |
| GulfTalent 403 | Akamai CDN hard-block | Permanent stub |
| `isNewJob is not a function` | Wrong export name | Fixed to `isDuplicate` |
| `Cannot read properties of undefined` on dedup | `initDb()` not called | Added `initDb()` before dedup usage |
| DDG web search returns 0 / CAPTCHA | IP-level bot detection | Replaced with Brave Search API |
| Brave API HTTP 422 | Invalid params (`freshness`, `country`, `search_lang`) on paid plan | Removed those params |
| Brave returns only aggregators | Brave index has no `.ae` career pages; `site:.ae` returns 0 results | Replaced Brave with Serper.dev |
| Serper returning global jobs (Mexico) | Missing geo restriction | Added `gl: 'ae'` param + `isUAEResult()` post-filter |
| `poll_interval_minutes: 5` | Misconfigured — would exhaust API quotas | Corrected to 30 |
| resume.md VAI section malformed | All bullets collapsed into one line in source file | Rewrote all sections with correct Markdown structure |
| Telegram only showed 350-char resume preview | `buildJobTelegramHtml` truncated output | Replaced with `bot.sendDocument()` sending full .md file |
| Claude resume output potentially truncated | `max_tokens: 2000` too tight for full rewrite | Raised to 3000 in config.json |
| Vercel "No Output Directory 'public'" | Vercel expected SPA build output | Added `vercel.json` with `@vercel/static` builder |
| Vercel deployment blocked | Work GitHub OAuth token in Windows Credential Manager | Cleared Credential Manager, set personal git config, pushed from personal account |
| Vercel only showing initial commit | `index.html` / `landing.html` was untracked — never committed | Committed files and pushed fresh |

---

## Phase 8 Detail — PDF Renderer (Next)

File to create: `src/pdfRenderer.ts`

```typescript
import puppeteer from 'puppeteer';
import { marked } from 'marked';

export async function renderPdf(markdown: string): Promise<Buffer> {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{font-family:sans-serif;padding:40px;max-width:800px;margin:auto}</style>
    </head><body>${marked(markdown)}</body></html>`;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({ format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });
  await browser.close();
  return Buffer.from(pdf);
}
```

Wire into `notifier.ts` `sendEmail()` — add `attachments: [{ filename: 'resume.pdf', content: pdfBuffer }]` to the nodemailer `sendMail` call.

---

## Resume Summary

**Adeeb Waiz** — Full Stack Developer, 3 years experience  
Skills: C#, .NET Core, React, Next.js, Angular, Node.js, TypeScript, SQL Server, PostgreSQL, MongoDB, Redis, Azure, Docker, Kubernetes, GitHub Actions  
Experience: Market-i (Jan 2024–Present), INTELPEEK (Jan 2022–Dec 2023), VAI Marketing (intern, Jun–Dec 2021)  
Education: Bachelor CS, BITS Dubai, 2019
