# Unified Anti-Detection Crawler — Design Spec

**Date:** 2026-05-27  
**Author:** Adeeb Waiz  
**Status:** Approved — ready for implementation planning

---

## Problem

The UAE job alert system currently has one reliable source: LinkedIn (guest API). Indeed, Bayt, and NaukriGulf are blocked by Cloudflare on the DigitalOcean IP. No direct company career pages are monitored at all — every lead comes through aggregators, which means latency, duplicates, and missing companies that don't post to portals.

---

## Goal

Build a unified scraping and crawling system that:
1. Unblocks Indeed and Bayt via residential proxies + browser stealth (Stage 1)
2. Crawls UAE company career pages directly, 24/7, detecting new jobs as they're posted (Stage 2)
3. Runs on the existing DigitalOcean Droplet as a persistent process alongside the current cron scheduler

---

## Approach: Staged Foundation Build (Approach C)

One shared anti-detection foundation. Two stages of delivery.

- **Stage 1 (~2–3 weeks):** Build the foundation, wire it into existing portal scrapers. Indeed + Bayt re-enabled.
- **Stage 2 (ongoing after Stage 1):** Build the persistent crawler on top of the same foundation. Direct company career page monitoring added.

Nothing is thrown away between stages. Stage 1 infrastructure is 100% reused in Stage 2.

---

## Architecture

### Execution Environment

- **Runtime:** DigitalOcean Droplet (always-on) — GitHub Actions dropped as target
- **Process manager:** PM2 — two processes:
  - `scheduler` — existing 30-min cron pipeline (LinkedIn + WebSearch + revived portals)
  - `crawler` — new persistent loop (company career pages)
- **Build:** TypeScript → `dist/` via `tsc`. PM2 runs compiled JS (not `tsx`) for stability on long-running processes.

---

## Stage 1: Anti-Detection Foundation + Portal Revival

### New modules

#### `src/antidetect/proxyManager.ts`
- Holds residential proxy credentials from `.env`
- Exposes `getProxyConfig()` → Playwright-compatible proxy object
- Uses **sticky sessions per domain** (same exit IP reused within a session — rotating mid-session triggers Cloudflare behavioral analysis)
- Falls back gracefully to no-proxy if proxy is unreachable (system degrades, not crashes)

**Proxy provider:** SmartProxy residential plan (~$28/month, 2GB, UAE-targeted exit nodes)  
**`.env` additions:**
```
PROXY_HOST=gate.smartproxy.com
PROXY_PORT=10000
PROXY_USER=
PROXY_PASS=
```

#### `src/antidetect/stealthBrowser.ts` (replaces `src/scrapers/browser.ts`)
- Wraps `playwright-extra` + `puppeteer-stealth-plugin`
- Fixes all Cloudflare fingerprint vectors: canvas, WebGL, `navigator.plugins`, `chrome.runtime`, `permissions` API, `outerWidth`
- Wires proxy in automatically via `proxyManager`
- Exposes human-behavior utilities:
  - `randomDelay(min, max)` — genuinely random ms delay
  - `homepageFirst(page, domain)` — visits root domain before target URL
  - `realisticViewport()` — returns 1920×1080 or 1366×768 randomly

### Upgraded scrapers

| Scraper | Change | Confidence |
|---------|--------|------------|
| `indeed.ts` | Swap `browser.ts` → `stealthBrowser`, add `homepageFirst`, keep single combined OR keyword query | ~75–80% |
| `bayt.ts` | Swap `browser.ts` → `stealthBrowser`, add `homepageFirst` | ~90% |
| `naukrigulf.ts` | Swap `browser.ts` → `stealthBrowser` (PerimeterX — upgraded attempt) | ~40–50% |
| `linkedin.ts` | No change — guest API, no browser needed |  |
| `websearch.ts` | No change — HTTP only, no browser needed |  |

NaukriGulf: if `fail_count > 5` across consecutive runs → auto-disabled, logged. No manual intervention.

### What doesn't change
Filter, dedup, notifier, PDF renderer, `config.json`, `scheduler.ts`, `index.ts` — all untouched.

---

## Stage 2: Persistent Company Career Page Crawler

### New SQLite tables (added to `data/dedup.db`)

```sql
CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  career_url TEXT,
  source TEXT NOT NULL, -- 'manual' | 'discovered'
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE crawl_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id),
  url TEXT NOT NULL,
  type TEXT NOT NULL, -- 'career_page' | 'discovery'
  next_check_at DATETIME NOT NULL,
  last_hash TEXT,
  fail_count INTEGER DEFAULT 0
);
```

Seed: ~100 manually curated UAE tech companies loaded on first run. Each company gets a `crawl_queue` entry with `next_check_at = now`.

---

### Crawler modules

#### `src/crawler/careerPageLocator.ts`
Finds the career URL for a company given its domain. Runs once per company, result stored permanently.

Strategy (in order):
1. Probe common paths: `/careers`, `/jobs`, `/join-us`, `/work-with-us`, `/hiring`, `/opportunities`
2. Fetch homepage, scan `<a>` link text for career keywords
3. Claude AI classification fallback for ambiguous cases

#### `src/crawler/changeDetector.ts`
The heartbeat of the system. Determines if a career page has new jobs.

- Fetches career page HTML
- Strips dynamic noise: timestamps, view counts, ad slots, CSRF tokens
- SHA256-hashes the normalized job listing section
- Compares against `crawl_queue.last_hash`
- Returns `{ changed: boolean, newHash: string }`

#### `src/crawler/jobExtractor.ts`
Extracts structured job data from a changed page. Two-pass, never one-shot:

**Pass 1 — Jina AI Reader:** POST URL to Jina, receive clean markdown. Handles most SPAs. Parse for title, location, type, apply link, posted date.

**Pass 2 — Playwright fallback:** Full browser render, wait for JS hydration, DOM extraction. Catches React/Angular SPAs Jina can't reach.

If both fail 3× consecutively: company flagged `needs_manual_review`, Telegram alert sent to Adeeb: *"Can't scrape [Company] — may need manual career URL update."* Never silently drops a source.

#### Freshness — four layers

| Layer | Coverage |
|-------|----------|
| Crawl timestamp | Always available — "Detected new 2026-05-27 06:14" |
| Explicit date extraction | Jina extracts "Posted 3 days ago" / "2026-05-24" as plain text — parsed via regex |
| Sitemap.xml `lastmod` | Checked before loading career page — ~40% of sites have it |
| Job ID delta | Sequential IDs (e.g. `?id=10045` vs last seen `10032`) — 13 new jobs detected without parsing content |

Every Telegram alert from the crawler includes freshness information — either an explicit posted date or "Detected new [timestamp] / Sitemap updated [date]".

#### `src/crawler/discoveryEngine.ts`
Runs once per day (not every crawl cycle). Finds new UAE companies to add to the seed list.

Three methods:
1. **Serper queries:** `"careers" site:.ae`, `"software engineer" Dubai jobs career page`
2. **UAE tech hub directories:** in5 Dubai, Hub71 Abu Dhabi, DIFC Fintech Hive — scraped once per day, parsed for company domains
3. **Link following:** Crawl existing companies' homepages for links to other UAE tech companies

Validation before insert: probe `/careers` path on discovered domain. If career page found → insert into `companies` + `crawl_queue`. Deduplication on `domain` column.

#### `src/crawler/index.ts` — main loop
Runs forever. No cron — continuous queue drain.

```
while (true) {
  items = crawlQueue.getNext(batchSize=3, where next_check_at <= now)
  if (items.length === 0) { sleep(30s); continue; }
  
  for each item:
    html = stealthBrowser.fetch(item.url)
    { changed, newHash } = changeDetector.check(html, item.last_hash)
    if changed:
      jobs = jobExtractor.extract(html)
      filtered = filter.apply(jobs)
      new = dedup.check(filtered)
      notifier.send(new)
      reschedule(item, next_check_at = now + 2h)  // hot company
    else:
      reschedule(item, next_check_at = now + 6h)  // quiet company
    
    if item.fail_count > 5:
      companies.setActive(item.company_id, false)
      notifier.sendTelegram("Can't scrape [Company] — needs manual career URL review")
      continue
    
    crawlQueue.update(item, newHash, fail_count)
    randomDelay(3000, 7000)
    enforceDomainGap(item.domain, minGap=60s)
}
```

**Resource guardrails:**
- Max 3 concurrent Playwright instances
- Each instance recycled after 50 page loads (memory leak prevention)
- PM2 `max_memory_restart: 500M`
- Logs to `logs/crawler.log`, rotated daily

---

## Data Flow (end-to-end)

```
[crawl_queue] → stealthBrowser.fetch(url)
             → changeDetector.hasChanged()
             → jobExtractor.extractJobs()    ← Jina first, Playwright fallback
             → filter.apply()                ← existing filter.ts, unchanged
             → dedup.check()                 ← existing dedup.ts, unchanged
             → notifier.send()               ← existing notifier.ts, unchanged
             → crawl_queue.reschedule()
```

Crawler output is indistinguishable from portal scraper output to the downstream pipeline.

---

## Deployment

### PM2 ecosystem config (`ecosystem.config.js`)
```js
module.exports = {
  apps: [
    {
      name: 'scheduler',
      script: 'dist/index.js',
      max_memory_restart: '300M'
    },
    {
      name: 'crawler',
      script: 'dist/crawler/index.js',
      max_memory_restart: '500M'
    }
  ]
}
```

### Deploy sequence
```bash
npm run build          # tsc compiles both entry points
pm2 start ecosystem.config.js
pm2 save
pm2 startup            # persist across server reboots
```

---

## What Adeeb Must Do (2 things only he can do)

1. **Sign up for SmartProxy** — residential plan, ~$28/month. Get `PROXY_HOST`, `PROXY_PORT`, `PROXY_USER`, `PROXY_PASS`. Add to `.env` on DO server.

2. **Approve the seed company list** — implementation will include a starter list of ~100 UAE tech companies with domains. Adeeb reviews and approves before first crawl run.

Everything else — all code, all config, all deployment files — is handled in implementation.

---

## Out of Scope

- GitHub Actions migration (dropped — DO handles everything)
- Docker / Fly.io (Phase 10, deferred)
- Custom domain for landing page
- Formspree ID for landing page
- Re-enabling Claude AI cap (separate config change after pipeline is stable)

---

## Success Criteria

- Indeed and Bayt return job results at least 70% of runs (proxy + stealth working)
- Crawler processes company career pages continuously with < 5% silent failures
- Every Telegram alert from the crawler includes a freshness signal
- Memory stays below 500MB per process over 24h run
- NaukriGulf: either works or auto-disables cleanly — no crashes

---

## New Dependencies

```
playwright-extra
puppeteer-extra-plugin-stealth
```

No other new npm dependencies. Jina AI Reader is already in use (HTTP call, no package). SmartProxy is a service credential, not a package.
