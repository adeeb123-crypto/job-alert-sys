# Stage 1: Anti-Detection Foundation + Portal Revival — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared residential-proxy + stealth-browser foundation, then wire it into the existing Playwright scrapers to unblock Indeed, Bayt, and NaukriGulf.

**Architecture:** Two new modules (`proxyManager.ts`, `stealthBrowser.ts`) replace the current `browser.ts`. All Playwright scrapers import from `stealthBrowser.ts` instead. The existing filter → dedup → notifier pipeline is untouched.

**Tech Stack:** `playwright-extra`, `puppeteer-extra-plugin-stealth`, SmartProxy residential proxies, existing TypeScript/Node.js stack.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/antidetect/proxyManager.ts` | Proxy credentials + sticky-session config generation |
| Create | `src/antidetect/stealthBrowser.ts` | playwright-extra + stealth plugin, replaces `browser.ts` |
| Modify | `src/scrapers/indeed.ts` | Import stealthBrowser, add homepageFirst |
| Modify | `src/scrapers/bayt.ts` | Import stealthBrowser, add homepageFirst |
| Modify | `src/scrapers/naukrigulf.ts` | Full re-implementation with stealth (was permanent stub) |
| Modify | `src/scrapers/index.ts` | Add indeed + bayt back to runAllScrapers() |
| Modify | `.env.example` | Add proxy vars, fix BRAVE→SERPER, remove dead keys |
| Create | `ecosystem.config.js` | PM2 process config (scheduler only for Stage 1) |
| Modify | `package.json` | Add playwright-extra, puppeteer-extra-plugin-stealth |

---

## Task 1: Install new dependencies + fix .env.example

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install packages**

```bash
npm install playwright-extra puppeteer-extra-plugin-stealth
```

Expected output: packages added to `node_modules/` and `package.json` dependencies.

- [ ] **Step 2: Verify install**

```bash
node -e "require('playwright-extra'); require('puppeteer-extra-plugin-stealth'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Rewrite `.env.example`**

Replace the entire file contents with:

```
# Get this from @BotFather on Telegram
TELEGRAM_BOT_TOKEN=

# Get this from https://console.anthropic.com
CLAUDE_API_KEY=

# Gmail: enable 2FA then create an App Password at https://myaccount.google.com/apppasswords
SMTP_USER=
SMTP_PASS=

# Serper.dev Google Search API — https://serper.dev (free tier: 2,500 queries)
SERPER_API_KEY=

# SmartProxy residential proxies — https://smartproxy.com → Residential plan (~$28/month)
# Leave blank to run without proxy (LinkedIn + WebSearch will still work; Cloudflare sites will be blocked)
PROXY_HOST=gate.smartproxy.com
PROXY_PORT=10000
PROXY_USER=
PROXY_PASS=
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "feat: install playwright-extra + stealth plugin, fix .env.example"
```

---

## Task 2: Build `proxyManager.ts`

**Files:**
- Create: `src/antidetect/proxyManager.ts`

- [ ] **Step 1: Write the self-test first**

Create `src/antidetect/proxyManager.ts` with only the self-test and stub:

```typescript
import * as crypto from 'crypto';

export interface ProxyConfig {
  server: string;
  username: string;
  password: string;
}

export function getProxyConfig(domain?: string): ProxyConfig | null {
  throw new Error('not implemented');
}

export function isProxyConfigured(): boolean {
  throw new Error('not implemented');
}

if (require.main === module) {
  // Test 1: returns null when env vars missing
  delete process.env.PROXY_HOST;
  delete process.env.PROXY_PORT;
  delete process.env.PROXY_USER;
  delete process.env.PROXY_PASS;

  console.assert(getProxyConfig() === null, 'FAIL: Should return null when not configured');
  console.assert(isProxyConfigured() === false, 'FAIL: isProxyConfigured should be false');
  console.log('PASS: returns null when proxy env vars missing');

  // Test 2: returns config with sticky session when vars present
  process.env.PROXY_HOST = 'gate.smartproxy.com';
  process.env.PROXY_PORT = '10000';
  process.env.PROXY_USER = 'testuser';
  process.env.PROXY_PASS = 'testpass';

  const cfg = getProxyConfig('bayt.com');
  console.assert(cfg !== null, 'FAIL: Should return config when vars set');
  console.assert(cfg!.server === 'http://gate.smartproxy.com:10000', `FAIL: Wrong server: ${cfg!.server}`);
  console.assert(cfg!.username.startsWith('testuser-session-'), `FAIL: Missing session: ${cfg!.username}`);
  console.assert(cfg!.password === 'testpass', 'FAIL: Wrong password');
  console.log('PASS: config shape correct with sticky session');

  // Test 3: same domain → same session ID (sticky)
  const cfg2 = getProxyConfig('bayt.com');
  console.assert(cfg!.username === cfg2!.username, 'FAIL: Same domain must yield same session ID');
  console.log('PASS: same domain → same session ID');

  // Test 4: different domains → different session IDs
  const cfg3 = getProxyConfig('indeed.com');
  console.assert(cfg!.username !== cfg3!.username, 'FAIL: Different domains must yield different session IDs');
  console.log('PASS: different domains → different session IDs');

  // Test 5: no domain → username without session suffix
  const cfg4 = getProxyConfig();
  console.assert(cfg4!.username === 'testuser', `FAIL: No domain should not append session: ${cfg4!.username}`);
  console.log('PASS: no domain → plain username');

  console.log('\nAll proxyManager tests passed.');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node_modules\.bin\tsx src\antidetect\proxyManager.ts
```

Expected: throws `Error: not implemented`

- [ ] **Step 3: Implement the module**

Replace the stub functions with the real implementation:

```typescript
import * as crypto from 'crypto';

export interface ProxyConfig {
  server: string;
  username: string;
  password: string;
}

function domainSessionId(domain: string): string {
  return crypto.createHash('md5').update(domain).digest('hex').slice(0, 8);
}

export function getProxyConfig(domain?: string): ProxyConfig | null {
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  const user = process.env.PROXY_USER;
  const pass = process.env.PROXY_PASS;

  if (!host || !port || !user || !pass) return null;

  const username = domain ? `${user}-session-${domainSessionId(domain)}` : user;

  return {
    server: `http://${host}:${port}`,
    username,
    password: pass,
  };
}

export function isProxyConfigured(): boolean {
  return !!(
    process.env.PROXY_HOST &&
    process.env.PROXY_PORT &&
    process.env.PROXY_USER &&
    process.env.PROXY_PASS
  );
}

if (require.main === module) {
  // ... (self-test from Step 1 — keep it here)
```

Keep the entire self-test block from Step 1 at the bottom.

- [ ] **Step 4: Run test to verify it passes**

```bash
node_modules\.bin\tsx src\antidetect\proxyManager.ts
```

Expected:
```
PASS: returns null when proxy env vars missing
PASS: config shape correct with sticky session
PASS: same domain → same session ID
PASS: different domains → different session IDs
PASS: no domain → plain username

All proxyManager tests passed.
```

- [ ] **Step 5: Commit**

```bash
git add src/antidetect/proxyManager.ts
git commit -m "feat: add proxyManager with sticky-session residential proxy support"
```

---

## Task 3: Build `stealthBrowser.ts`

**Files:**
- Create: `src/antidetect/stealthBrowser.ts`

- [ ] **Step 1: Write self-test stubs first**

Create `src/antidetect/stealthBrowser.ts`:

```typescript
import { chromium as playwrightExtraChromium } from 'playwright-extra';
import type { Browser, BrowserContext, Page } from 'playwright';
import { getProxyConfig } from './proxyManager';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
playwrightExtraChromium.use(StealthPlugin());

export async function createBrowser(domain?: string): Promise<Browser> {
  throw new Error('not implemented');
}

export async function createStealthContext(browser: Browser): Promise<BrowserContext> {
  throw new Error('not implemented');
}

export async function homepageFirst(page: Page, domain: string): Promise<void> {
  throw new Error('not implemented');
}

export function realisticViewport(): { width: number; height: number } {
  throw new Error('not implemented');
}

export const randomDelay = (min = 2000, max = 4000): Promise<void> =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

if (require.main === module) {
  (async () => {
    // Test 1: realisticViewport returns one of two valid sizes
    const v = realisticViewport();
    const validSizes = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
    ];
    const isValid = validSizes.some(s => s.width === v.width && s.height === v.height);
    console.assert(isValid, `FAIL: Unexpected viewport: ${JSON.stringify(v)}`);
    console.log(`PASS: realisticViewport → ${v.width}x${v.height}`);

    // Test 2: randomDelay stays within bounds
    const start = Date.now();
    await randomDelay(100, 200);
    const elapsed = Date.now() - start;
    console.assert(elapsed >= 100 && elapsed <= 400, `FAIL: randomDelay out of bounds: ${elapsed}ms`);
    console.log(`PASS: randomDelay(100,200) → ${elapsed}ms`);

    // Test 3: createBrowser launches without crashing (proxy optional)
    console.log('Testing createBrowser (no proxy)...');
    const browser = await createBrowser();
    console.assert(browser !== null, 'FAIL: createBrowser returned null');
    console.log('PASS: createBrowser launched');

    // Test 4: createStealthContext creates a context
    const context = await createStealthContext(browser);
    console.assert(context !== null, 'FAIL: createStealthContext returned null');
    console.log('PASS: createStealthContext created');

    await browser.close();
    console.log('\nAll stealthBrowser tests passed.');
    process.exit(0);
  })();
}
```

- [ ] **Step 2: Run to verify stubs fail**

```bash
node_modules\.bin\tsx src\antidetect\stealthBrowser.ts
```

Expected: `realisticViewport` fails with `not implemented`

- [ ] **Step 3: Implement all functions**

Replace the stub functions with real implementations:

```typescript
export async function createBrowser(domain?: string): Promise<Browser> {
  const proxyConfig = getProxyConfig(domain);

  const browser = await playwrightExtraChromium.launch({
    headless: true,
    proxy: proxyConfig ?? undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  return browser as unknown as Browser;
}

export async function createStealthContext(browser: Browser): Promise<BrowserContext> {
  const viewport = realisticViewport();

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport,
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  return context;
}

export async function homepageFirst(page: Page, domain: string): Promise<void> {
  const homepage = domain.startsWith('http') ? domain : `https://${domain}`;
  await page.goto(homepage, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await randomDelay(1500, 3000);
}

export function realisticViewport(): { width: number; height: number } {
  return Math.random() > 0.5 ? { width: 1920, height: 1080 } : { width: 1366, height: 768 };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node_modules\.bin\tsx src\antidetect\stealthBrowser.ts
```

Expected:
```
PASS: realisticViewport → 1920x1080  (or 1366x768)
PASS: randomDelay(100,200) → ~150ms
Testing createBrowser (no proxy)...
PASS: createBrowser launched
PASS: createStealthContext created

All stealthBrowser tests passed.
```

- [ ] **Step 5: Commit**

```bash
git add src/antidetect/stealthBrowser.ts
git commit -m "feat: add stealthBrowser with playwright-extra + stealth plugin + proxy wiring"
```

---

## Task 4: Update `indeed.ts`

**Files:**
- Modify: `src/scrapers/indeed.ts`

- [ ] **Step 1: Swap import and add homepageFirst**

Change line 4 from:
```typescript
import { createBrowser, createStealthContext, randomDelay } from './browser';
```
To:
```typescript
import { createBrowser, createStealthContext, randomDelay, homepageFirst } from '../antidetect/stealthBrowser';
```

- [ ] **Step 2: Pass domain to createBrowser and add homepage visit**

Change line 21 (`const browser = await createBrowser();`) to:
```typescript
const browser = await createBrowser('ae.indeed.com');
```

After `const page = await context.newPage();` (line 27), add:
```typescript
await homepageFirst(page, 'ae.indeed.com');
```

- [ ] **Step 3: Self-test run**

```bash
node_modules\.bin\tsx src\scrapers\indeed.ts
```

Expected (with proxy configured): job cards found, job list printed.
Expected (without proxy): page title logged, 0 results — that is correct and expected until proxy is added.

- [ ] **Step 4: Commit**

```bash
git add src/scrapers/indeed.ts
git commit -m "feat: wire indeed.ts to stealthBrowser with proxy + homepageFirst"
```

---

## Task 5: Update `bayt.ts`

**Files:**
- Modify: `src/scrapers/bayt.ts`

- [ ] **Step 1: Swap import and add homepageFirst**

Change line 4 from:
```typescript
import { createBrowser, createStealthContext, randomDelay } from './browser';
```
To:
```typescript
import { createBrowser, createStealthContext, randomDelay, homepageFirst } from '../antidetect/stealthBrowser';
```

- [ ] **Step 2: Pass domain to createBrowser and add homepage visit**

Change `const browser = await createBrowser();` to:
```typescript
const browser = await createBrowser('www.bayt.com');
```

After `const page = await context.newPage();`, add:
```typescript
await homepageFirst(page, 'www.bayt.com');
```

- [ ] **Step 3: Self-test run**

```bash
node_modules\.bin\tsx src\scrapers\bayt.ts
```

Expected (with proxy): job listings found per keyword.
Expected (without proxy): 0 results with "job list not found" — correct until proxy added.

- [ ] **Step 4: Commit**

```bash
git add src/scrapers/bayt.ts
git commit -m "feat: wire bayt.ts to stealthBrowser with proxy + homepageFirst"
```

---

## Task 6: Re-implement `naukrigulf.ts`

**Files:**
- Modify: `src/scrapers/naukrigulf.ts`

- [ ] **Step 1: Replace the stub with a real implementation**

Overwrite `src/scrapers/naukrigulf.ts` entirely:

```typescript
import { Job } from '../types';
import { generateFingerprint } from '../dedup';
import { config } from '../config';
import { createBrowser, createStealthContext, randomDelay, homepageFirst } from '../antidetect/stealthBrowser';

function buildSearchUrl(keyword: string): string {
  const q = encodeURIComponent(keyword);
  return `https://www.naukrigulf.com/jobs-in-uae?title=${q}&location=uae`;
}

export async function scrapeNaukriGulf(): Promise<Job[]> {
  const tag = `[${new Date().toISOString()}] [NaukriGulf]`;
  const browser = await createBrowser('www.naukrigulf.com');
  const allJobs: Job[] = [];

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    await homepageFirst(page, 'www.naukrigulf.com');

    // Limit to 3 keywords to reduce detection surface
    for (const keyword of config.keywords.slice(0, 3)) {
      const url = buildSearchUrl(keyword);
      console.log(`${tag} Fetching "${keyword}"...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await randomDelay(3000, 6000);

      const hasJobs = await page
        .waitForSelector(
          '[class*="jobTuple"], [class*="job-card"], article[data-job-id], [class*="srp-jobtuple"]',
          { timeout: 15000 }
        )
        .then(() => true)
        .catch(() => false);

      if (!hasJobs) {
        const title = await page.title();
        console.log(`${tag} "${keyword}" — job cards not found (page: "${title}")`);
        continue;
      }

      const cards = await page.evaluate(() => {
        const results: Array<{
          title: string;
          company: string;
          location: string;
          url: string;
          snippet: string;
        }> = [];

        const cardEls = document.querySelectorAll(
          '[class*="jobTuple"], [class*="job-card"], article[data-job-id], [class*="srp-jobtuple"]'
        );

        cardEls.forEach((card: Element) => {
          const titleEl =
            card.querySelector('[class*="title"] a') ??
            card.querySelector('h3 a') ??
            card.querySelector('h2 a');
          const title = titleEl?.textContent?.trim() ?? '';
          const href = (titleEl as HTMLAnchorElement | null)?.href ?? '';
          const url = href.startsWith('http') ? href : `https://www.naukrigulf.com${href}`;

          const company =
            card.querySelector('[class*="company"], [class*="org-name"]')?.textContent?.trim() ?? 'Unknown';
          const location =
            card.querySelector('[class*="location"], [class*="loc"]')?.textContent?.trim() ?? 'UAE';
          const snippet =
            card.querySelector('[class*="desc"], [class*="summary"]')?.textContent?.trim().slice(0, 300) ?? '';

          if (title && url && !url.endsWith('naukrigulf.com')) {
            results.push({ title, company, location, url, snippet });
          }
        });

        return results;
      });

      console.log(`${tag} "${keyword}" → ${cards.length} job(s) found`);

      for (const c of cards) {
        allJobs.push({
          id: generateFingerprint(c.company, c.title, c.location),
          title: c.title,
          company: c.company,
          location: c.location,
          jobType: 'full-time',
          url: c.url,
          portal: 'NaukriGulf',
          rawJD: `${c.title} at ${c.company} in ${c.location}. ${c.snippet}`.trim(),
          foundAt: new Date(),
        });
      }

      await randomDelay(2000, 4000);
    }
  } catch (err) {
    console.error(`${tag} Error: ${(err as Error).message}`);
  } finally {
    await browser.close();
  }

  return allJobs;
}

// Self-test
if (require.main === module) {
  scrapeNaukriGulf().then(jobs => {
    console.log(`\n=== NaukriGulf self-test: ${jobs.length} jobs ===`);
    jobs.slice(0, 5).forEach((j, i) =>
      console.log(`  ${i + 1}. ${j.title} @ ${j.company} | ${j.location}`)
    );
    if (jobs.length === 0) {
      console.log('  (0 results — PerimeterX may still be blocking even with residential proxy)');
    }
    process.exit(0);
  });
}
```

- [ ] **Step 2: Self-test run**

```bash
node_modules\.bin\tsx src\scrapers\naukrigulf.ts
```

Expected: Either job cards found (proxy working, PerimeterX bypassed) or 0 results with "job cards not found" (PerimeterX still blocking — acceptable outcome).

- [ ] **Step 3: Commit**

```bash
git add src/scrapers/naukrigulf.ts
git commit -m "feat: re-implement naukrigulf.ts with stealth browser (was permanent stub)"
```

---

## Task 7: Update `scrapers/index.ts` — add Indeed + Bayt back to pipeline

**Files:**
- Modify: `src/scrapers/index.ts`

- [ ] **Step 1: Add imports at top of file**

Add these two imports after the existing imports:
```typescript
import { scrapeIndeed } from './indeed';
import { scrapebayt } from './bayt';
```

- [ ] **Step 2: Add Indeed + Bayt to runAllScrapers**

Replace the `Promise.allSettled` call and `labels` array:

```typescript
const results = await Promise.allSettled([
  scrapeLinkedIn(),
  scrapeIndeed(),
  scrapebayt(),
  scrapeNaukriGulf(),
  scrapeGulfTalent(),
]);

const labels = ['LinkedIn', 'Indeed', 'Bayt', 'NaukriGulf', 'GulfTalent'];
```

- [ ] **Step 3: Typecheck**

```bash
node_modules\.bin\tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run full pipeline dry-run**

```bash
node_modules\.bin\tsx src\scrapers\index.ts
```

Wait — `index.ts` doesn't have a self-test block. Run the scheduler instead:

```bash
node_modules\.bin\tsx src\index.ts
```

Watch the first poll cycle complete. Expected output: LinkedIn returns jobs, Indeed/Bayt log their status (jobs found if proxy configured, "not found" if no proxy yet), NaukriGulf/GulfTalent log their result.

- [ ] **Step 5: Commit**

```bash
git add src/scrapers/index.ts
git commit -m "feat: add Indeed and Bayt back to runAllScrapers pipeline"
```

---

## Task 8: Create `ecosystem.config.js`

**Files:**
- Create: `ecosystem.config.js`

- [ ] **Step 1: Create the file**

```javascript
module.exports = {
  apps: [
    {
      name: 'scheduler',
      script: 'dist/index.js',
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

(Stage 2 will add the `crawler` process to this file.)

- [ ] **Step 2: Verify PM2 can read it (on DO server)**

```bash
pm2 start ecosystem.config.js --no-daemon
```

Expected: `scheduler` process starts and runs the first poll cycle.

- [ ] **Step 3: Commit**

```bash
git add ecosystem.config.js
git commit -m "feat: add PM2 ecosystem.config.js for production deployment"
```

---

## Task 9: Deploy to DO + verify with real proxy

> **Prerequisite:** Adeeb has signed up for SmartProxy, has PROXY_USER and PROXY_PASS values.

**Files:**
- None (server-side setup only)

- [ ] **Step 1: Add proxy vars to .env on DO server**

SSH into the DO droplet and open `.env`:
```bash
nano .env
```

Add:
```
PROXY_HOST=gate.smartproxy.com
PROXY_PORT=10000
PROXY_USER=<your SmartProxy username>
PROXY_PASS=<your SmartProxy password>
```

- [ ] **Step 2: Pull latest code on server**

```bash
git pull origin master
npm install
npm run build
```

- [ ] **Step 3: Self-test Indeed from server**

```bash
node dist/scrapers/indeed.js
```

Expected: job cards found from ae.indeed.com — this confirms the proxy is routing correctly and Cloudflare is bypassed.

- [ ] **Step 4: Self-test Bayt from server**

```bash
node dist/scrapers/bayt.js
```

Expected: job listings returned per keyword.

- [ ] **Step 5: Restart PM2**

```bash
pm2 restart ecosystem.config.js
pm2 save
```

- [ ] **Step 6: Watch one full poll cycle**

```bash
pm2 logs scheduler --lines 50
```

Expected: LinkedIn + Indeed + Bayt all return jobs. Any matches flow through filter → dedup → Telegram.

---

## Done — Stage 1 complete when:

- [ ] `node_modules\.bin\tsx src\antidetect\proxyManager.ts` — all tests pass
- [ ] `node_modules\.bin\tsx src\antidetect\stealthBrowser.ts` — all tests pass
- [ ] Indeed self-test on DO server returns job results
- [ ] Bayt self-test on DO server returns job results
- [ ] Full poll cycle in PM2 logs shows all three portals active

Stage 2 plan: `docs/superpowers/plans/2026-05-27-stage2-persistent-crawler.md`
