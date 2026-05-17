# UAE Job Alert System — Project Context

## What This Is

A personal automated job alert system that:
1. Scrapes UAE job portals every 30 minutes (LinkedIn, Indeed, Bayt — NaukriGulf/GulfTalent permanently disabled)
2. Filters jobs against user criteria (keywords, location, seniority, job type)
3. Deduplicates across portals and across poll cycles
4. Uses Claude AI to tailor the resume to each matched job (all sections rewritten, ATS-friendly, human tone)
5. Sends alerts via Telegram: a job card with the posting link, then the full tailored resume as a .md document attachment
6. Email notification wired (Gmail SMTP credentials pending — will activate automatically once set)

Built for: **Adeeb Waiz** (waizadeeb@gmail.com)  
Runtime: Node.js + TypeScript on Windows 11, targeting Fly.io deployment  
GitHub: https://github.com/adeeb123-crypto/job-alert-sys

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict), CommonJS |
| Runner (dev) | `tsx` — use `node_modules\.bin\tsx` on Windows |
| Scheduler | `node-cron` |
| LinkedIn scraper | LinkedIn guest jobs API (HTML regex parsing) |
| Indeed / Bayt | Playwright headless browser + stealth anti-detection |
| NaukriGulf / GulfTalent | Permanent stubs (bot protection — see below) |
| Web job discovery | **Paused** — Brave Search API integrated but returns only aggregators; CompanyScraper built but ineffective |
| Dedup store | `better-sqlite3` (SQLite, WAL mode) |
| AI resume tailor | `@anthropic-ai/sdk` with prompt caching — rewrites all sections, ATS-safe, no jargon |
| PDF renderer | Puppeteer — **Phase 8, not yet built** |
| Notifications | `node-telegram-bot-api` (job card + full resume as .md document) + `nodemailer` (Gmail SMTP — creds pending) |
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
│   ├── filter.ts             # 4-dimension job filter
│   ├── scheduler.ts          # Poll cycle orchestrator
│   ├── resumeTailor.ts       # fetchFullJD() + tailorResume() — Phase 5 (DONE)
│   ├── notifier.ts           # Telegram (alert + resume document) + email notifications
│   └── scrapers/
│       ├── index.ts          # Runs all scrapers concurrently (Promise.allSettled)
│       ├── browser.ts        # Shared Playwright stealth setup
│       ├── linkedin.ts       # Guest API scraper — WORKING
│       ├── indeed.ts         # Playwright scraper — WORKING (fromage=1, last 24hrs)
│       ├── bayt.ts           # Playwright scraper — WORKING (first keyword reliable; later keywords intermittently hit Cloudflare)
│       ├── naukrigulf.ts     # Stub — PerimeterX bot protection, permanently disabled
│       ├── gulftalent.ts     # Stub — Akamai CDN blocks all access, permanently disabled
│       ├── websearch.ts      # Brave Search API — PAUSED (returns only aggregators)
│       └── companyScraper.ts # Curated UAE company career pages — PAUSED (ineffective)
├── config.json               # User criteria + AI cost caps
├── resume.md                 # Adeeb's real resume (used by AI tailor — all sections clean and structured)
├── context.md                # This file — living project context doc
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
| 4 | Playwright scrapers (Indeed, Bayt) | Done |
| 5 | `fetchFullJD()` + Claude resume tailor | Done |
| 6 | Telegram + email notifier | Done (Telegram confirmed; Gmail creds pending) |
| 7 | Full pipeline wiring + cron scheduler | Done |
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
- `BRAVE_SEARCH_API_KEY`: configured (real value, $5/month plan — paused)
- `SMTP_USER` / `SMTP_PASS`: **still placeholder** — needs Gmail App Password

---

## Key Design Decisions

### Polling Strategy
- **30-minute interval** for portal scrapers
- Indeed uses `fromage=1` (last 24 hours) + dedup prevents re-alerts → every new job is caught within 30 min of posting
- LinkedIn uses `f_TPR=r3600` (last 1 hour) + `sortBy=DD` — returns few results during off-peak hours, which is expected and correct
- These two together cover the "be first to apply" goal — portal scrapers are the real-time mechanism, not WebSearch

### LinkedIn Scraper
- Uses undocumented public endpoint: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`
- No auth required — works as a guest
- HTML job cards parsed with regex
- 1–2s polite delay between keywords

### Indeed Scraper
- Single Boolean OR query covering all config keywords — avoids N separate page loads that trigger Cloudflare
- `fromage=1` = jobs posted in last 24 hours
- Key selector: `a.jcs-JobTitle[data-jk]` with `data-jk` as job key

### Bayt Scraper
- Per-keyword slug URL loop using a single shared browser context
- First keyword ("software engineer") reliably returns results (30 jobs in live test)
- Subsequent keywords intermittently hit Cloudflare challenge ("Just a moment...") — this is rate-limit behavior, not a code defect; full poll cycles with fresh context typically do better
- Selector: `li[data-js-job], #results_list > li`

### NaukriGulf / GulfTalent — Permanent Stubs
- NaukriGulf: PerimeterX bot protection — JS challenge prevents all automation
- GulfTalent: Akamai CDN hard-blocks at IP/TLS fingerprint level + pure AngularJS CSR (no server-rendered data anyway)
- Both return `[]` immediately

### WebSearch — Paused
- **Original goal**: find jobs on UAE company `.ae` career pages not listed on aggregators
- **Brave Search API integrated** but fundamentally broken for this purpose:
  - `site:.ae` in query → 0 results (Brave index has very few .ae career pages)
  - Without `site:.ae` → 20 results per run, all aggregators (Bayt, GulfTalent, Indeed, LinkedIn, Glassdoor)
  - `country`/`search_lang`/`freshness` API params cause HTTP 422 on paid plan
- **CompanyScraper built** (`src/scrapers/companyScraper.ts`): 26 curated UAE tech company career pages. Playwright visits each page, extracts keyword-matching job links. Tested — most pages returned 0 matches, 1 returned a stale result. Paused.
- **Strategic decision**: the portal scrapers already cover the "latest jobs, first to apply" goal

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
- No truncated inline preview — full document is the delivery mechanism

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

## Open Items (Priority Order)

### Immediate
1. **End-to-end pipeline test** — run `node_modules\.bin\tsx src\index.ts` and confirm: a Telegram alert fires with a job card (title, company, posting link) followed immediately by a `.md` resume document. This verifies scrape → filter → Claude → notify all work together. Nothing else should be built until this is green.

### Phase 8 (Next Build)
2. **PDF renderer** — create `src/pdfRenderer.ts`:
   - Input: `tailoredMarkdown: string`
   - Output: `Buffer` (PDF)
   - Stack: `marked` (markdown → HTML) → Puppeteer `page.pdf()`
   - Wire into `notifier.ts` `sendEmail()` — add `attachments: [{ filename: 'resume.pdf', content: pdfBuffer }]`
   - Both `marked` (^4.3.0) and `puppeteer` are already in `package.json`

### Credentials
3. **Gmail SMTP** — `SMTP_USER` / `SMTP_PASS` still placeholder — user will provide creds in a future session
   - Gmail → Google Account → Security → 2-Step Verification → App Passwords → Mail → Generate
   - 16-character password → `SMTP_PASS`; Gmail address → `SMTP_USER`
   - No code changes needed — `notifier.ts` already checks for placeholder and skips gracefully

### Deferred
4. **WebSearch / CompanyScraper** — paused, revisit after Phase 8
5. **Bayt multi-keyword Cloudflare** — if broader Bayt coverage is needed, add longer delays between keywords or rotate browser context; currently deprioritised
6. **Docker + Fly.io** — Phase 9, after full local pipeline verified

---

## How to Run

```bash
# Install deps (use Bash — PowerShell blocks npm.ps1 on this machine)
npm install

# Install Playwright browser (one-time per machine)
npx playwright install chromium

# Self-test individual scrapers
node_modules\.bin\tsx src\scrapers\linkedin.ts
node_modules\.bin\tsx src\scrapers\indeed.ts
node_modules\.bin\tsx src\scrapers\bayt.ts

# Run full app
node_modules\.bin\tsx src\index.ts
```

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
| Brave returns only aggregators | Brave index has no `.ae` career pages; `site:.ae` returns 0 results | WebSearch paused |
| `poll_interval_minutes: 5` | Misconfigured — would exhaust API quotas | Corrected to 30 |
| resume.md VAI section malformed | All bullets collapsed into one line in source file | Rewrote all sections with correct Markdown structure |
| Telegram only showed 350-char resume preview | `buildJobTelegramHtml` truncated output | Replaced with `bot.sendDocument()` sending full .md file |
| Claude resume output potentially truncated | `max_tokens: 2000` too tight for full rewrite | Raised to 3000 in config.json |

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
