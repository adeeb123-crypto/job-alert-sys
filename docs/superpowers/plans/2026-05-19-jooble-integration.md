# Jooble API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Cloudflare-blocked Indeed and Bayt Playwright scrapers with a single Jooble REST API integration that returns UAE software engineering jobs from the last 24 hours.

**Architecture:** A new `scrapeJooble()` function loops over all configured keywords, fires one POST request per keyword to the Jooble API with a 24h freshness filter, deduplicates results by URL, and returns `Job[]`. The old scrapers stay on disk but are removed from `runAllScrapers()`. No Playwright or browser automation is needed for this integration.

**Tech Stack:** Node.js built-in `https` module, TypeScript, existing `Job` type and `generateFingerprint` dedup utility, tsx runner.

---

### Task 1: Wire up Jooble credentials

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add `joobleApiKey` to the Secrets interface**

Open `src/types/index.ts`. The current `Secrets` interface ends at line 56. Replace the interface body with:

```typescript
export interface Secrets {
  telegramBotToken: string;
  claudeApiKey: string;
  smtpUser: string;
  smtpPass: string;
  braveSearchApiKey: string | null;
  joobleApiKey: string;
}
```

- [ ] **Step 2: Load JOOBLE_API_KEY in config**

Open `src/config.ts`. The `loadSecrets()` function currently returns an object literal. Add `joobleApiKey` to it:

```typescript
function loadSecrets(): Secrets {
  return {
    telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    claudeApiKey: requireEnv('CLAUDE_API_KEY'),
    smtpUser: requireEnv('SMTP_USER'),
    smtpPass: requireEnv('SMTP_PASS'),
    braveSearchApiKey: process.env['BRAVE_SEARCH_API_KEY'] ?? null,
    joobleApiKey: requireEnv('JOOBLE_API_KEY'),
  };
}
```

- [ ] **Step 3: Document the new env var**

Open `.env.example`. Append at the bottom:

```
# Jooble API — https://jooble.org/api (free, instant signup, no credit card)
JOOBLE_API_KEY=
```

- [ ] **Step 4: Add your actual key to .env on this machine**

Sign up at https://jooble.org/api to get your API key (takes ~1 minute, no credit card).
Then open `.env` and add:

```
JOOBLE_API_KEY=your_actual_key_here
```

- [ ] **Step 5: Verify TypeScript compiles**

Run:
```
npx tsc --noEmit
```
Expected: no errors. If you see `Property 'joobleApiKey' does not exist on type 'Secrets'`, check that you saved both `types/index.ts` and `config.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/config.ts .env.example
git commit -m "feat: add JOOBLE_API_KEY to Secrets and config"
```

---

### Task 2: Create the Jooble scraper

**Files:**
- Create: `src/scrapers/jooble.ts`

- [ ] **Step 1: Create `src/scrapers/jooble.ts` with this content**

```typescript
import * as https from 'https';
import { Job } from '../types';
import { generateFingerprint } from '../dedup';
import { config, secrets } from '../config';

interface JoobleJob {
  title: string;
  company: string;
  location: string;
  link: string;
  snippet: string;
  updated: string;
}

interface JoobleResponse {
  totalCount: number;
  jobs: JoobleJob[];
}

function postJson(apiKey: string, body: object): Promise<JoobleResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options: https.RequestOptions = {
      hostname: 'jooble.org',
      path: `/api/${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Jooble API returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data) as JoobleResponse);
        } catch {
          reject(new Error(`Jooble response is not valid JSON: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

export async function scrapeJooble(): Promise<Job[]> {
  const tag = `[${new Date().toISOString()}] [Jooble]`;
  const seenLinks = new Set<string>();
  const allJobs: Job[] = [];

  for (const keyword of config.keywords) {
    try {
      console.log(`${tag} Fetching "${keyword}"...`);

      const response = await postJson(secrets.joobleApiKey, {
        keywords: keyword,
        location: 'United Arab Emirates',
        datecreated: 'day',
      });

      const jobs = response.jobs ?? [];
      console.log(`${tag} "${keyword}" → ${jobs.length} result(s)`);

      for (const j of jobs) {
        const link = j.link?.trim();
        if (!link || seenLinks.has(link)) continue;
        seenLinks.add(link);

        const title = j.title?.trim() ?? '';
        const company = j.company?.trim() || 'Unknown';
        const location = j.location?.trim() || 'UAE';

        if (!title) continue;

        allJobs.push({
          id: generateFingerprint(company, title, location),
          title,
          company,
          location,
          jobType: 'full-time',
          url: link,
          portal: 'Jooble',
          rawJD: `${title} at ${company} in ${location}. ${(j.snippet ?? '').trim()}`.trim(),
          foundAt: new Date(),
        });
      }
    } catch (err) {
      console.error(`${tag} "${keyword}" failed: ${(err as Error).message}`);
    }

    await randomDelay(500, 1500);
  }

  console.log(`${tag} Total: ${allJobs.length} unique job(s) across all keywords`);
  return allJobs;
}

// Self-test
if (require.main === module) {
  scrapeJooble().then(jobs => {
    console.log(`\n=== Jooble self-test: ${jobs.length} jobs ===`);
    jobs.slice(0, 5).forEach((j, i) =>
      console.log(`  ${i + 1}. ${j.title} @ ${j.company} | ${j.location} | ${j.url.slice(0, 70)}`)
    );
    if (jobs.length === 0) console.log('  (0 results — check API key and logs above)');
    process.exit(0);
  }).catch(err => {
    console.error('Jooble self-test error:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Run the self-test locally**

```
npx tsx src/scrapers/jooble.ts
```

Expected output — something like:
```
[2026-05-19T...] [Jooble] Fetching "software engineer"...
[2026-05-19T...] [Jooble] "software engineer" → 12 result(s)
[2026-05-19T...] [Jooble] Fetching "backend engineer"...
...
[2026-05-19T...] [Jooble] Total: 47 unique job(s) across all keywords

=== Jooble self-test: 47 jobs ===
  1. Software Engineer @ Accenture | Dubai, UAE | https://...
  2. Backend Developer @ Amazon | Abu Dhabi, UAE | https://...
  ...
```

If you get `0 results`, check:
1. `JOOBLE_API_KEY` is set correctly in `.env`
2. The API key is active (log in to jooble.org/api to verify)
3. Look for `failed:` lines in the output — an HTTP 4xx means an invalid key

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/scrapers/jooble.ts
git commit -m "feat: add Jooble API scraper replacing Indeed and Bayt"
```

---

### Task 3: Swap Indeed + Bayt out of runAllScrapers

**Files:**
- Modify: `src/scrapers/index.ts`

- [ ] **Step 1: Replace the contents of `src/scrapers/index.ts`**

The current file imports and calls `scrapeIndeed` and `scrapebayt`. Replace the entire file with:

```typescript
import { Job } from '../types';
import { scrapeLinkedIn } from './linkedin';
import { scrapeJooble } from './jooble';
import { scrapeNaukriGulf } from './naukrigulf';
import { scrapeGulfTalent } from './gulftalent';
import { scrapeCompanyPages } from './companyScraper';

export { scrapeLinkedIn } from './linkedin';
export { scrapeJooble } from './jooble';
export { scrapeNaukriGulf } from './naukrigulf';
export { scrapeGulfTalent } from './gulftalent';
export { scrapeCompanyPages } from './companyScraper';
// Kept for future scraping engine work — not active in pipeline
export { scrapeIndeed } from './indeed';
export { scrapebayt } from './bayt';

export async function runAllScrapers(): Promise<Job[]> {
  console.log(`[${new Date().toISOString()}] Running all scrapers...`);

  const results = await Promise.allSettled([
    scrapeLinkedIn(),
    scrapeJooble(),
    scrapeNaukriGulf(),
    scrapeGulfTalent(),
  ]);

  const labels = ['LinkedIn', 'Jooble', 'NaukriGulf', 'GulfTalent'];
  const raw: Job[] = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`[${new Date().toISOString()}] [${labels[i]}] → ${result.value.length} jobs`);
      raw.push(...result.value);
    } else {
      console.error(
        `[${new Date().toISOString()}] [${labels[i]}] FAILED: ${result.reason?.message ?? result.reason}`
      );
    }
  });

  // Cross-portal dedup: keep the first portal that found a given job fingerprint
  const seen = new Set<string>();
  const unique: Job[] = [];
  for (const job of raw) {
    if (!seen.has(job.id)) {
      seen.add(job.id);
      unique.push(job);
    }
  }

  console.log(
    `[${new Date().toISOString()}] Scrapers done — ${raw.length} total, ${unique.length} unique across portals`
  );

  return unique;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/scrapers/index.ts
git commit -m "feat: replace Indeed+Bayt with Jooble in runAllScrapers"
```

---

### Task 4: Run the full pipeline locally

**Files:** none (verification only)

- [ ] **Step 1: Run the full pipeline**

```
npx tsx src/index.ts
```

Watch the logs. You should see:
```
[...] Running all scrapers...
[...] [LinkedIn] → N jobs
[...] [Jooble] Fetching "software engineer"...
[...] [Jooble] "software engineer" → N result(s)
...
[...] [Jooble] Total: N unique job(s) across all keywords
[...] [NaukriGulf] → N jobs
[...] [GulfTalent] → N jobs
[...] Scrapers done — N total, N unique across portals
```

- [ ] **Step 2: Confirm Telegram receives notifications**

If matched jobs exist and pass the daily AI cap, your Telegram should receive:
- A job card message (HTML with title, company, location, link)
- A `.md` resume file as a document

If you get `0 unique across portals` but no errors, the dedup DB has seen these jobs before. Clear it:
```
node -e "const Database = require('better-sqlite3'); const db = new Database('data/jobs.db'); db.prepare('DELETE FROM seen_jobs').run(); console.log('cleared');"
```
Then re-run `npx tsx src/index.ts`.

---

### Task 5: Deploy to DigitalOcean VPS

**Files:** none (server operations)

- [ ] **Step 1: Push changes to GitHub**

```bash
git push origin master
```

- [ ] **Step 2: SSH into the VPS and pull**

```bash
ssh root@<your-vps-ip>
cd /root/job-alert-sys
git pull origin master
```

- [ ] **Step 3: Add JOOBLE_API_KEY to the server's .env**

While SSH'd in:
```bash
echo "JOOBLE_API_KEY=your_actual_key_here" >> .env
```

Verify it's there:
```bash
grep JOOBLE_API_KEY .env
```
Expected: `JOOBLE_API_KEY=your_actual_key_here`

- [ ] **Step 4: Restart PM2**

```bash
pm2 restart job-alert
pm2 logs job-alert --lines 50
```

Expected in logs: `[Jooble] Fetching "software engineer"...` — confirming the new scraper is running.

- [ ] **Step 5: Verify end-to-end on server**

Wait for the first poll cycle (up to 30 minutes, or trigger manually):
```bash
pm2 restart job-alert   # forces an immediate run
pm2 logs job-alert --lines 100
```

Check your Telegram for job card messages. If none arrive:
1. Look for `FAILED:` lines in the logs
2. Confirm `JOOBLE_API_KEY` is not empty: `grep JOOBLE ^.env`
3. Clear the dedup DB on the server and restart again (same command as Task 4 Step 2, run from `/root/job-alert-sys`)
