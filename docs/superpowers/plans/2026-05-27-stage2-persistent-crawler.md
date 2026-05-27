# Stage 2: Persistent Company Career Page Crawler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, queue-based crawler that monitors UAE company career pages 24/7, detects new job postings via content-hash change detection, extracts structured job data, and pipes matches through the existing filter → dedup → notifier pipeline.

**Architecture:** A standalone PM2 process (`crawler`) runs a continuous queue-drain loop. SQLite stores the company list and crawl queue. Two new tables are added to the existing `data/dedup.db`. Career page content is fetched via Jina AI Reader first, Playwright fallback for SPAs. Change detection uses SHA256 hashing on normalized content. Discovery Engine runs once daily to find new UAE companies.

**Tech Stack:** `better-sqlite3` (existing), `playwright-extra` + `stealthBrowser.ts` (from Stage 1), Jina AI Reader (HTTP, free, no API key), Serper.dev (existing), existing filter/dedup/notifier pipeline.

**Prerequisite:** Stage 1 complete — `src/antidetect/stealthBrowser.ts` and `src/antidetect/proxyManager.ts` must exist.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/crawler/companyStore.ts` | CRUD for companies table + seed data loader |
| Create | `src/crawler/crawlQueue.ts` | Queue management — next item, reschedule, fail tracking |
| Create | `src/crawler/careerPageLocator.ts` | Finds career URL for a company domain |
| Create | `src/crawler/changeDetector.ts` | SHA256 hash comparison, strips dynamic noise |
| Create | `src/crawler/jobExtractor.ts` | Jina AI first → Playwright fallback → Job[] output |
| Create | `src/crawler/discoveryEngine.ts` | Finds new UAE companies via Serper + tech hub directories |
| Create | `src/crawler/index.ts` | Main continuous loop — orchestrates all modules |
| Create | `src/data/uaeCompanies.ts` | Seed list of ~100 UAE tech companies |
| Modify | `src/dedup.ts` | Add `initCrawlerTables()` — two new SQLite tables |
| Modify | `ecosystem.config.js` | Add `crawler` process |

---

## Task 1: Add crawler tables to SQLite (`dedup.ts`)

**Files:**
- Modify: `src/dedup.ts`

- [ ] **Step 1: Write the self-test first**

Add this block at the end of the existing self-test in `dedup.ts` (inside `if (require.main === module)`), after `console.log('\nAll tests passed.');`:

```typescript
  // Crawler table tests
  initCrawlerTables();

  // companies table
  const db2 = (db as any); // access internal db for test assertions
  const companyRow = db2.prepare(
    "INSERT OR IGNORE INTO companies (name, domain, source) VALUES ('TestCorp', 'testcorp.ae', 'manual')"
  ).run();
  console.assert(companyRow.changes >= 0, 'FAIL: companies INSERT failed');
  console.log('PASS: companies table insert works');

  const fetchedCompany = db2.prepare("SELECT * FROM companies WHERE domain = 'testcorp.ae'").get();
  console.assert(fetchedCompany !== undefined, 'FAIL: companies SELECT returned nothing');
  console.log('PASS: companies table SELECT works');

  // crawl_queue table
  const queueRow = db2.prepare(
    "INSERT OR IGNORE INTO crawl_queue (company_id, url, type, next_check_at) VALUES (?, 'https://testcorp.ae/careers', 'career_page', ?)"
  ).run(fetchedCompany.id, Date.now());
  console.assert(queueRow.changes >= 0, 'FAIL: crawl_queue INSERT failed');
  console.log('PASS: crawl_queue table insert works');

  console.log('\nAll dedup + crawler table tests passed.');
```

- [ ] **Step 2: Run to verify test fails (function not defined)**

```bash
node_modules\.bin\tsx src\dedup.ts
```

Expected: `ReferenceError: initCrawlerTables is not defined`

- [ ] **Step 3: Add `initCrawlerTables()` to `dedup.ts`**

Add this function after the existing `initDb()` function:

```typescript
export function initCrawlerTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      domain      TEXT    NOT NULL UNIQUE,
      career_url  TEXT,
      source      TEXT    NOT NULL DEFAULT 'manual',
      added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      is_active   INTEGER NOT NULL DEFAULT 1
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS crawl_queue (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id     INTEGER NOT NULL REFERENCES companies(id),
      url            TEXT    NOT NULL,
      type           TEXT    NOT NULL DEFAULT 'career_page',
      next_check_at  INTEGER NOT NULL,
      last_hash      TEXT,
      fail_count     INTEGER NOT NULL DEFAULT 0
    )
  `);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node_modules\.bin\tsx src\dedup.ts
```

Expected: all existing tests pass, plus:
```
PASS: companies table insert works
PASS: companies table SELECT works
PASS: crawl_queue table insert works

All dedup + crawler table tests passed.
```

- [ ] **Step 5: Commit**

```bash
git add src/dedup.ts
git commit -m "feat: add companies + crawl_queue tables to SQLite via initCrawlerTables()"
```

---

## Task 2: UAE company seed list (`uaeCompanies.ts`)

**Files:**
- Create: `src/data/uaeCompanies.ts`

- [ ] **Step 1: Create seed data file**

Create `src/data/uaeCompanies.ts`:

```typescript
export interface SeedCompany {
  name: string;
  domain: string;
}

export const UAE_COMPANIES: SeedCompany[] = [
  // Big Tech & Global presence in UAE
  { name: 'Microsoft UAE', domain: 'microsoft.com' },
  { name: 'Google UAE', domain: 'careers.google.com' },
  { name: 'Amazon UAE', domain: 'amazon.jobs' },
  { name: 'IBM UAE', domain: 'ibm.com' },
  { name: 'Oracle UAE', domain: 'oracle.com' },
  { name: 'SAP UAE', domain: 'sap.com' },
  { name: 'Cisco UAE', domain: 'cisco.com' },
  { name: 'Accenture UAE', domain: 'accenture.com' },
  { name: 'PwC UAE', domain: 'pwc.com' },
  { name: 'Deloitte UAE', domain: 'deloitte.com' },

  // UAE Tech & Startups
  { name: 'Careem', domain: 'careem.com' },
  { name: 'Noon', domain: 'noon.com' },
  { name: 'Dubizzle', domain: 'dubizzle.com' },
  { name: 'Propertyfinder', domain: 'propertyfinder.ae' },
  { name: 'Property Monitor', domain: 'propertymonitor.ae' },
  { name: 'Bayt', domain: 'bayt.com' },
  { name: 'Fetchr', domain: 'fetchr.us' },
  { name: 'Anghami', domain: 'anghami.com' },
  { name: 'Yalla', domain: 'yallamotor.com' },
  { name: 'Holo', domain: 'myholo.com' },
  { name: 'Sarwa', domain: 'sarwa.co' },
  { name: 'Finerd', domain: 'finerd.com' },
  { name: 'Ziina', domain: 'ziina.com' },
  { name: 'YAP', domain: 'yap.com' },
  { name: 'Tabby', domain: 'tabby.ai' },
  { name: 'Tamara', domain: 'tamara.co' },

  // Telecom
  { name: 'Etisalat (e&)', domain: 'careers.eand.com' },
  { name: 'Du Telecom', domain: 'du.ae' },

  // Banking & Fintech
  { name: 'Emirates NBD', domain: 'emiratesnbd.com' },
  { name: 'First Abu Dhabi Bank', domain: 'fab.ae' },
  { name: 'Abu Dhabi Commercial Bank', domain: 'adcb.com' },
  { name: 'Mashreq Bank', domain: 'mashreqbank.com' },
  { name: 'RAKBANK', domain: 'rakbank.ae' },
  { name: 'Commercial Bank of Dubai', domain: 'cbd.ae' },
  { name: 'Network International', domain: 'network.ae' },
  { name: 'PayTabs', domain: 'paytabs.com' },

  // Government & Semi-Government Tech
  { name: 'ADNOC', domain: 'adnoc.ae' },
  { name: 'Mubadala', domain: 'mubadala.com' },
  { name: 'G42', domain: 'g42.ai' },
  { name: 'Pure Health', domain: 'purehealth.ae' },
  { name: 'DEWA', domain: 'dewa.gov.ae' },
  { name: 'Smart Dubai', domain: 'smartdubai.ae' },
  { name: 'Abu Dhabi Digital Authority', domain: 'adda.gov.ae' },

  // Logistics & Supply Chain
  { name: 'DP World', domain: 'dpworld.com' },
  { name: 'Aramex', domain: 'aramex.com' },
  { name: 'Emirates SkyCargo', domain: 'skycargo.com' },
  { name: 'Agility Logistics', domain: 'agility.com' },

  // Aviation & Travel
  { name: 'Emirates Airlines', domain: 'emirates.com' },
  { name: 'Etihad Airways', domain: 'etihad.com' },
  { name: 'flydubai', domain: 'flydubai.com' },
  { name: 'Air Arabia', domain: 'airarabia.com' },
  { name: 'dnata', domain: 'dnata.com' },

  // Healthcare Tech
  { name: 'Mediclinic UAE', domain: 'mediclinic.ae' },
  { name: 'NMC Healthcare', domain: 'nmchealth.ae' },
  { name: 'Aster DM Healthcare', domain: 'asterdmhealthcare.com' },

  // Retail & E-commerce
  { name: 'Alshaya Group', domain: 'alshaya.com' },
  { name: 'Majid Al Futtaim', domain: 'majidalfuttaim.com' },
  { name: 'Lulu Hypermarket', domain: 'luluhypermarket.com' },
  { name: 'EMAAR', domain: 'emaar.com' },

  // Consulting & Services
  { name: 'McKinsey UAE', domain: 'mckinsey.com' },
  { name: 'BCG UAE', domain: 'bcg.com' },
  { name: 'Booz Allen Hamilton UAE', domain: 'boozallen.com' },
  { name: 'EY UAE', domain: 'ey.com' },
  { name: 'KPMG UAE', domain: 'kpmg.com' },

  // Media & Entertainment
  { name: 'OSN', domain: 'osn.com' },
  { name: 'MBC Group', domain: 'mbc.net' },
  { name: 'Dubai Media', domain: 'dmi.ae' },

  // Education Tech
  { name: 'Alef Education', domain: 'alefeducation.com' },
  { name: 'GEMS Education', domain: 'gemseducation.com' },

  // Cybersecurity
  { name: 'CPX', domain: 'cpx.net' },
  { name: 'DarkMatter', domain: 'darkmatter.ae' },

  // Cloud & Infrastructure
  { name: 'Khazna Data Centers', domain: 'khazna.ae' },
  { name: 'Gulf Data Hub', domain: 'gulfdatahub.com' },

  // Real Estate Tech
  { name: 'Bayut', domain: 'bayut.com' },
  { name: 'Huspy', domain: 'huspy.com' },
  { name: 'SmartCrowd', domain: 'smartcrowd.ae' },

  // Gaming & Entertainment
  { name: 'YallaPlay', domain: 'yallaplay.com' },
  { name: 'Tamatem', domain: 'tamatem.co' },

  // HR Tech
  { name: 'Bayzat', domain: 'bayzat.com' },
  { name: 'Workday UAE', domain: 'workday.com' },

  // Food Tech
  { name: 'Talabat', domain: 'talabat.com' },
  { name: 'Deliveroo UAE', domain: 'deliveroo.ae' },
  { name: 'Kitopi', domain: 'kitopi.com' },

  // Mobility
  { name: 'CAFU', domain: 'cafu.com' },
  { name: 'Swvl', domain: 'swvl.com' },

  // PropTech / Smart Cities
  { name: 'Propy', domain: 'propy.com' },
  { name: 'Silta', domain: 'silta.io' },

  // Staffing & Recruitment Tech
  { name: 'Hiredge', domain: 'hiredge.com' },
  { name: 'GulfTalent', domain: 'gulftalent.com' },
  { name: 'NaukriGulf', domain: 'naukrigulf.com' },
];
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
node_modules\.bin\tsx node_modules\.bin\tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/data/uaeCompanies.ts
git commit -m "feat: add UAE company seed list (~90 companies)"
```

---

## Task 3: Build `companyStore.ts`

**Files:**
- Create: `src/crawler/companyStore.ts`

- [ ] **Step 1: Write self-test and stubs**

Create `src/crawler/companyStore.ts`:

```typescript
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { UAE_COMPANIES } from '../data/uaeCompanies';

const DB_PATH = path.resolve(process.cwd(), 'data', 'dedup.db');

export interface Company {
  id: number;
  name: string;
  domain: string;
  career_url: string | null;
  source: string;
  added_at: number;
  is_active: number;
}

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function seedCompanies(): void {
  throw new Error('not implemented');
}

export function getActiveCompanies(): Company[] {
  throw new Error('not implemented');
}

export function upsertCompany(name: string, domain: string, source: 'manual' | 'discovered'): number {
  throw new Error('not implemented');
}

export function setCareerUrl(companyId: number, careerUrl: string): void {
  throw new Error('not implemented');
}

export function disableCompany(companyId: number): void {
  throw new Error('not implemented');
}

if (require.main === module) {
  seedCompanies();

  const companies = getActiveCompanies();
  console.assert(companies.length >= 80, `FAIL: Expected >=80 seeded companies, got ${companies.length}`);
  console.log(`PASS: seedCompanies → ${companies.length} active companies`);

  const id = upsertCompany('Test Corp', 'test-unique-domain.ae', 'discovered');
  console.assert(typeof id === 'number' && id > 0, `FAIL: upsertCompany returned invalid id: ${id}`);
  console.log(`PASS: upsertCompany → id=${id}`);

  const id2 = upsertCompany('Test Corp', 'test-unique-domain.ae', 'discovered');
  console.assert(id === id2, `FAIL: upsert of existing domain should return same id: ${id} vs ${id2}`);
  console.log('PASS: upsertCompany idempotent for duplicate domain');

  setCareerUrl(id, 'https://test-unique-domain.ae/careers');
  const updated = getActiveCompanies().find(c => c.id === id);
  console.assert(updated?.career_url === 'https://test-unique-domain.ae/careers', 'FAIL: setCareerUrl not persisted');
  console.log('PASS: setCareerUrl persisted correctly');

  disableCompany(id);
  const afterDisable = getActiveCompanies().find(c => c.id === id);
  console.assert(afterDisable === undefined, 'FAIL: disabled company should not appear in getActiveCompanies');
  console.log('PASS: disableCompany removes from active list');

  console.log('\nAll companyStore tests passed.');
  process.exit(0);
}
```

- [ ] **Step 2: Run to verify stubs fail**

```bash
node_modules\.bin\tsx src\crawler\companyStore.ts
```

Expected: `Error: not implemented`

- [ ] **Step 3: Implement all functions**

Replace all stub functions:

```typescript
export function seedCompanies(): void {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      domain      TEXT    NOT NULL UNIQUE,
      career_url  TEXT,
      source      TEXT    NOT NULL DEFAULT 'manual',
      added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      is_active   INTEGER NOT NULL DEFAULT 1
    )
  `);

  const insert = database.prepare(
    'INSERT OR IGNORE INTO companies (name, domain, source) VALUES (?, ?, ?)'
  );
  const insertMany = database.transaction(() => {
    for (const c of UAE_COMPANIES) {
      insert.run(c.name, c.domain, 'manual');
    }
  });
  insertMany();
}

export function getActiveCompanies(): Company[] {
  return getDb()
    .prepare('SELECT * FROM companies WHERE is_active = 1')
    .all() as Company[];
}

export function upsertCompany(name: string, domain: string, source: 'manual' | 'discovered'): number {
  const database = getDb();
  database.prepare(
    'INSERT OR IGNORE INTO companies (name, domain, source) VALUES (?, ?, ?)'
  ).run(name, domain, source);
  const row = database.prepare('SELECT id FROM companies WHERE domain = ?').get(domain) as { id: number };
  return row.id;
}

export function setCareerUrl(companyId: number, careerUrl: string): void {
  getDb()
    .prepare('UPDATE companies SET career_url = ? WHERE id = ?')
    .run(careerUrl, companyId);
}

export function disableCompany(companyId: number): void {
  getDb()
    .prepare('UPDATE companies SET is_active = 0 WHERE id = ?')
    .run(companyId);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node_modules\.bin\tsx src\crawler\companyStore.ts
```

Expected:
```
PASS: seedCompanies → 90 active companies  (number may vary)
PASS: upsertCompany → id=91
PASS: upsertCompany idempotent for duplicate domain
PASS: setCareerUrl persisted correctly
PASS: disableCompany removes from active list

All companyStore tests passed.
```

- [ ] **Step 5: Commit**

```bash
git add src/crawler/companyStore.ts
git commit -m "feat: add companyStore with seed loading and CRUD"
```

---

## Task 4: Build `crawlQueue.ts`

**Files:**
- Create: `src/crawler/crawlQueue.ts`

- [ ] **Step 1: Write self-test and stubs**

Create `src/crawler/crawlQueue.ts`:

```typescript
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { seedCompanies, getActiveCompanies } from './companyStore';

const DB_PATH = path.resolve(process.cwd(), 'data', 'dedup.db');

export interface QueueItem {
  id: number;
  company_id: number;
  url: string;
  type: string;
  next_check_at: number;
  last_hash: string | null;
  fail_count: number;
}

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function initQueue(): void {
  throw new Error('not implemented');
}

export function seedQueueFromCompanies(): void {
  throw new Error('not implemented');
}

export function getNextBatch(batchSize: number): QueueItem[] {
  throw new Error('not implemented');
}

export function reschedule(itemId: number, nextCheckAt: number, newHash?: string): void {
  throw new Error('not implemented');
}

export function incrementFailCount(itemId: number): void {
  throw new Error('not implemented');
}

export function addToQueue(companyId: number, url: string, type: 'career_page' | 'discovery'): void {
  throw new Error('not implemented');
}

if (require.main === module) {
  seedCompanies();
  initQueue();
  seedQueueFromCompanies();

  // Test: batch returns items due now
  const batch = getNextBatch(5);
  console.assert(batch.length <= 5, `FAIL: Batch too large: ${batch.length}`);
  console.log(`PASS: getNextBatch(5) → ${batch.length} item(s)`);

  if (batch.length > 0) {
    const item = batch[0];

    // Test: reschedule updates next_check_at
    const future = Date.now() + 6 * 60 * 60 * 1000;
    reschedule(item.id, future, 'testhash');
    const afterReschedule = getNextBatch(100).find(i => i.id === item.id);
    console.assert(afterReschedule === undefined, 'FAIL: Rescheduled item should not appear in immediate batch');
    console.log('PASS: reschedule defers item correctly');

    // Test: incrementFailCount
    incrementFailCount(item.id);
    const dbItem = getDb().prepare('SELECT fail_count FROM crawl_queue WHERE id = ?').get(item.id) as { fail_count: number };
    console.assert(dbItem.fail_count === 1, `FAIL: Expected fail_count=1, got ${dbItem.fail_count}`);
    console.log('PASS: incrementFailCount works');
  }

  // Test: addToQueue inserts new item
  const companies = getActiveCompanies();
  if (companies.length > 0) {
    addToQueue(companies[0].id, 'https://test.ae/careers', 'career_page');
    console.log('PASS: addToQueue executed without error');
  }

  console.log('\nAll crawlQueue tests passed.');
  process.exit(0);
}
```

- [ ] **Step 2: Run to verify stubs fail**

```bash
node_modules\.bin\tsx src\crawler\crawlQueue.ts
```

Expected: `Error: not implemented`

- [ ] **Step 3: Implement all functions**

Replace stub functions:

```typescript
export function initQueue(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS crawl_queue (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id     INTEGER NOT NULL REFERENCES companies(id),
      url            TEXT    NOT NULL,
      type           TEXT    NOT NULL DEFAULT 'career_page',
      next_check_at  INTEGER NOT NULL,
      last_hash      TEXT,
      fail_count     INTEGER NOT NULL DEFAULT 0
    )
  `);
}

export function seedQueueFromCompanies(): void {
  const database = getDb();
  const companies = database.prepare('SELECT id, career_url, domain FROM companies WHERE is_active = 1').all() as Array<{
    id: number;
    career_url: string | null;
    domain: string;
  }>;

  const insert = database.prepare(`
    INSERT OR IGNORE INTO crawl_queue (company_id, url, type, next_check_at)
    VALUES (?, ?, 'career_page', ?)
  `);

  const now = Date.now();
  const insertAll = database.transaction(() => {
    for (const company of companies) {
      const url = company.career_url ?? `https://${company.domain}/careers`;
      insert.run(company.id, url, now);
    }
  });
  insertAll();
}

export function getNextBatch(batchSize: number): QueueItem[] {
  const now = Date.now();
  return getDb()
    .prepare(
      'SELECT * FROM crawl_queue WHERE next_check_at <= ? ORDER BY next_check_at ASC LIMIT ?'
    )
    .all(now, batchSize) as QueueItem[];
}

export function reschedule(itemId: number, nextCheckAt: number, newHash?: string): void {
  if (newHash !== undefined) {
    getDb()
      .prepare('UPDATE crawl_queue SET next_check_at = ?, last_hash = ?, fail_count = 0 WHERE id = ?')
      .run(nextCheckAt, newHash, itemId);
  } else {
    getDb()
      .prepare('UPDATE crawl_queue SET next_check_at = ?, fail_count = 0 WHERE id = ?')
      .run(nextCheckAt, itemId);
  }
}

export function incrementFailCount(itemId: number): void {
  getDb()
    .prepare('UPDATE crawl_queue SET fail_count = fail_count + 1 WHERE id = ?')
    .run(itemId);
}

export function addToQueue(companyId: number, url: string, type: 'career_page' | 'discovery'): void {
  getDb()
    .prepare(
      'INSERT OR IGNORE INTO crawl_queue (company_id, url, type, next_check_at) VALUES (?, ?, ?, ?)'
    )
    .run(companyId, url, type, Date.now());
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node_modules\.bin\tsx src\crawler\crawlQueue.ts
```

Expected: all PASS lines, no failures.

- [ ] **Step 5: Commit**

```bash
git add src/crawler/crawlQueue.ts
git commit -m "feat: add crawlQueue with batch dequeue, reschedule, fail tracking"
```

---

## Task 5: Build `changeDetector.ts`

**Files:**
- Create: `src/crawler/changeDetector.ts`

- [ ] **Step 1: Write self-test and stubs**

Create `src/crawler/changeDetector.ts`:

```typescript
import * as crypto from 'crypto';

export interface ChangeResult {
  changed: boolean;
  newHash: string;
}

export function normalizeContent(html: string): string {
  throw new Error('not implemented');
}

export function hashContent(normalized: string): string {
  throw new Error('not implemented');
}

export function detectChange(html: string, lastHash: string | null): ChangeResult {
  throw new Error('not implemented');
}

if (require.main === module) {
  // Test 1: normalizeContent strips timestamps and view counts
  const raw = `<div class="jobs">
    <div class="job">Backend Engineer</div>
    <span class="views">1,234 views</span>
    <span class="posted">2 hours ago</span>
    <script>var t = Date.now();</script>
  </div>`;

  const normalized = normalizeContent(raw);
  console.assert(!normalized.includes('1,234 views'), 'FAIL: view count not stripped');
  console.assert(!normalized.includes('2 hours ago'), 'FAIL: timestamp not stripped');
  console.assert(!normalized.includes('<script>'), 'FAIL: script tags not stripped');
  console.assert(normalized.includes('Backend Engineer'), 'FAIL: job content removed');
  console.log('PASS: normalizeContent strips dynamic noise');

  // Test 2: hashContent is deterministic
  const h1 = hashContent('same content');
  const h2 = hashContent('same content');
  console.assert(h1 === h2, 'FAIL: hashContent not deterministic');
  console.assert(h1.length === 64, `FAIL: Expected 64-char SHA256, got ${h1.length}`);
  console.log('PASS: hashContent deterministic, 64-char hex');

  // Test 3: detectChange — null lastHash always reports changed (first visit)
  const r1 = detectChange('<div>Job A</div>', null);
  console.assert(r1.changed === true, 'FAIL: null lastHash should always report changed');
  console.assert(typeof r1.newHash === 'string', 'FAIL: newHash should be string');
  console.log('PASS: detectChange → changed=true on first visit (null lastHash)');

  // Test 4: detectChange — same content → not changed
  const r2 = detectChange('<div>Job A</div>', r1.newHash);
  console.assert(r2.changed === false, 'FAIL: Same content should not report changed');
  console.log('PASS: detectChange → changed=false on same content');

  // Test 5: detectChange — different content → changed
  const r3 = detectChange('<div>Job A</div><div>Job B (NEW)</div>', r1.newHash);
  console.assert(r3.changed === true, 'FAIL: New content should report changed');
  console.assert(r3.newHash !== r1.newHash, 'FAIL: New content should have different hash');
  console.log('PASS: detectChange → changed=true on new content');

  console.log('\nAll changeDetector tests passed.');
  process.exit(0);
}
```

- [ ] **Step 2: Run to verify stubs fail**

```bash
node_modules\.bin\tsx src\crawler\changeDetector.ts
```

Expected: `Error: not implemented`

- [ ] **Step 3: Implement all functions**

```typescript
export function normalizeContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')  // strip script blocks
    .replace(/<style[\s\S]*?<\/style>/gi, '')    // strip style blocks
    .replace(/\d[\d,]*\s*(view|visitor|applicant)s?/gi, '')  // strip view counts
    .replace(/\b\d+\s*(second|minute|hour|day|week|month|year)s?\s*ago\b/gi, '')  // strip relative dates
    .replace(/\b(today|yesterday|just now)\b/gi, '')  // strip relative date words
    .replace(/<!--[\s\S]*?-->/g, '')  // strip HTML comments
    .replace(/\s+/g, ' ')  // collapse whitespace
    .trim();
}

export function hashContent(normalized: string): string {
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function detectChange(html: string, lastHash: string | null): ChangeResult {
  const normalized = normalizeContent(html);
  const newHash = hashContent(normalized);

  if (lastHash === null) {
    return { changed: true, newHash };
  }

  return { changed: newHash !== lastHash, newHash };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node_modules\.bin\tsx src\crawler\changeDetector.ts
```

Expected: all 5 PASS lines.

- [ ] **Step 5: Commit**

```bash
git add src/crawler/changeDetector.ts
git commit -m "feat: add changeDetector with SHA256 hashing and dynamic-noise stripping"
```

---

## Task 6: Build `careerPageLocator.ts`

**Files:**
- Create: `src/crawler/careerPageLocator.ts`

- [ ] **Step 1: Create the module**

Create `src/crawler/careerPageLocator.ts`:

```typescript
import { createBrowser, createStealthContext, randomDelay, homepageFirst } from '../antidetect/stealthBrowser';

const CAREER_PATHS = [
  '/careers',
  '/jobs',
  '/join-us',
  '/work-with-us',
  '/hiring',
  '/opportunities',
  '/careers/jobs',
  '/about/careers',
  '/company/careers',
  '/en/careers',
];

const CAREER_LINK_PATTERNS = /career|job|hiring|work with us|join us|join our team|opportunities|vacancies/i;

export async function locateCareerPage(domain: string): Promise<string | null> {
  const base = domain.startsWith('http') ? domain : `https://${domain}`;
  const browser = await createBrowser(domain);

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    // Step 1: probe common paths
    for (const path of CAREER_PATHS) {
      const url = `${base}${path}`;
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (response && response.status() < 400) {
          const finalUrl = page.url();
          if (!finalUrl.includes('404') && !finalUrl.includes('error')) {
            console.log(`[CareerLocator] Found via path probe: ${finalUrl}`);
            return finalUrl;
          }
        }
      } catch {
        // path doesn't exist, try next
      }
      await randomDelay(500, 1000);
    }

    // Step 2: scan homepage for career links
    await homepageFirst(page, base);

    const careerLink = await page.evaluate((pattern: string) => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
      const regex = new RegExp(pattern, 'i');
      const match = links.find(
        a => regex.test(a.textContent ?? '') || regex.test(a.href)
      );
      return match?.href ?? null;
    }, CAREER_LINK_PATTERNS.source);

    if (careerLink) {
      console.log(`[CareerLocator] Found via link scan: ${careerLink}`);
      return careerLink;
    }

    console.log(`[CareerLocator] Could not locate career page for ${domain}`);
    return null;
  } catch (err) {
    console.error(`[CareerLocator] Error for ${domain}: ${(err as Error).message}`);
    return null;
  } finally {
    await browser.close();
  }
}

// Self-test
if (require.main === module) {
  const testDomain = process.argv[2] ?? 'careem.com';
  console.log(`Testing career page location for: ${testDomain}`);

  locateCareerPage(testDomain).then(url => {
    if (url) {
      console.log(`\nFOUND: ${url}`);
    } else {
      console.log('\nNOT FOUND — may need manual career URL entry');
    }
    process.exit(0);
  });
}
```

- [ ] **Step 2: Test with a known company**

```bash
node_modules\.bin\tsx src\crawler\careerPageLocator.ts careem.com
```

Expected: prints career page URL for Careem (e.g. `https://careem.com/careers` or similar).

- [ ] **Step 3: Test with another company**

```bash
node_modules\.bin\tsx src\crawler\careerPageLocator.ts tabby.ai
```

Expected: prints a careers URL or "NOT FOUND".

- [ ] **Step 4: Commit**

```bash
git add src/crawler/careerPageLocator.ts
git commit -m "feat: add careerPageLocator with path probing and link text scanning"
```

---

## Task 7: Build `jobExtractor.ts`

**Files:**
- Create: `src/crawler/jobExtractor.ts`

- [ ] **Step 1: Create the module**

Create `src/crawler/jobExtractor.ts`:

```typescript
import { Job } from '../types';
import { generateFingerprint } from '../dedup';
import { createBrowser, createStealthContext, randomDelay } from '../antidetect/stealthBrowser';

const JINA_BASE = 'https://r.jina.ai/';

interface RawJobCard {
  title: string;
  company: string;
  location: string;
  url: string;
  snippet: string;
  postedText: string;
}

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const response = await fetch(`${JINA_BASE}${url}`, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchViaPlaywright(url: string): Promise<string | null> {
  const domain = new URL(url).hostname;
  const browser = await createBrowser(domain);
  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(2000, 4000);
    return await page.content();
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

function parseJobsFromText(text: string, companyName: string, sourceUrl: string): Job[] {
  const jobs: Job[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Look for lines that look like job titles near apply/view links
  const jobTitlePattern = /^(senior|junior|lead|principal|staff|mid|associate)?\s*(software|backend|frontend|full.?stack|mobile|data|devops|platform|cloud|security|site reliability|machine learning|ml|ai|product|engineering)\s*(engineer|developer|architect|manager|analyst|lead|specialist)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (jobTitlePattern.test(line) && line.length < 120) {
      // Look for location near this line
      const windowLines = lines.slice(Math.max(0, i - 3), i + 4).join(' ');
      const locationMatch = windowLines.match(/dubai|abu dhabi|sharjah|uae|united arab emirates|remote/i);
      const location = locationMatch ? locationMatch[0] : 'UAE';

      // Look for a date near this line
      const dateMatch = windowLines.match(/\d+\s*(hour|day|week)s?\s*ago|today|yesterday|\d{4}-\d{2}-\d{2}/i);
      const postedText = dateMatch ? dateMatch[0] : '';

      jobs.push({
        id: generateFingerprint(companyName, line, location),
        title: line,
        company: companyName,
        location,
        jobType: 'full-time',
        url: sourceUrl,
        portal: 'CareerPage',
        rawJD: windowLines.slice(0, 500),
        foundAt: new Date(),
      });
    }
  }

  return jobs;
}

export async function extractJobs(url: string, companyName: string, detectedAt: Date): Promise<Job[]> {
  // Pass 1: Jina AI Reader
  let text = await fetchViaJina(url);

  if (!text || text.length < 200) {
    // Pass 2: Playwright fallback for SPAs
    console.log(`[JobExtractor] Jina insufficient for ${url}, trying Playwright...`);
    const html = await fetchViaPlaywright(url);
    if (!html) {
      console.log(`[JobExtractor] Both methods failed for ${url}`);
      return [];
    }
    // Convert HTML to plain text via simple tag stripping
    text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }

  const jobs = parseJobsFromText(text, companyName, url);
  console.log(`[JobExtractor] Extracted ${jobs.length} potential job(s) from ${url}`);
  return jobs;
}

// Self-test
if (require.main === module) {
  const testUrl = process.argv[2] ?? 'https://careem.com/careers';
  const testCompany = process.argv[3] ?? 'Careem';

  console.log(`Testing job extraction from: ${testUrl}`);
  extractJobs(testUrl, testCompany, new Date()).then(jobs => {
    console.log(`\n=== Extracted ${jobs.length} job(s) ===`);
    jobs.slice(0, 5).forEach((j, i) =>
      console.log(`  ${i + 1}. ${j.title} | ${j.location}`)
    );
    process.exit(0);
  });
}
```

- [ ] **Step 2: Test against a live career page**

```bash
node_modules\.bin\tsx src\crawler\jobExtractor.ts https://careem.com/careers Careem
```

Expected: prints extracted job titles from Careem's career page. Even partial results (1–5 jobs) mean the module works. 0 results means the page structure needs the Playwright fallback path.

- [ ] **Step 3: Commit**

```bash
git add src/crawler/jobExtractor.ts
git commit -m "feat: add jobExtractor with Jina AI first-pass and Playwright fallback"
```

---

## Task 8: Build `discoveryEngine.ts`

**Files:**
- Create: `src/crawler/discoveryEngine.ts`

- [ ] **Step 1: Create the module**

Create `src/crawler/discoveryEngine.ts`:

```typescript
import { upsertCompany } from './companyStore';
import { addToQueue } from './crawlQueue';

const SERPER_API_URL = 'https://google.serper.dev/search';
const DISCOVERY_QUERIES = [
  '"careers" site:.ae software engineer',
  '"we are hiring" site:.ae developer',
  'UAE tech startup software engineer careers 2024',
  'Dubai fintech software engineer jobs career page',
  'Abu Dhabi tech company backend engineer careers',
];

const UAE_TECH_HUB_DOMAINS = [
  'startups.in5.ae',
  'hub71.com',
  'difcfintechhive.ae',
];

function extractDomain(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isAggregatorDomain(domain: string): boolean {
  const aggregators = ['linkedin.com', 'indeed.com', 'bayt.com', 'glassdoor.com', 'naukrigulf.com', 'gulftalent.com', 'monster.com', 'ziprecruiter.com'];
  return aggregators.some(a => domain.includes(a));
}

async function discoverViaSerper(serperApiKey: string): Promise<string[]> {
  const domains: string[] = [];

  for (const query of DISCOVERY_QUERIES) {
    try {
      const response = await fetch(SERPER_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': serperApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, gl: 'ae', hl: 'en', num: 10 }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;
      const data = await response.json() as { organic?: Array<{ link: string }> };

      for (const result of data.organic ?? []) {
        const domain = extractDomain(result.link);
        if (domain && !isAggregatorDomain(domain)) {
          domains.push(domain);
        }
      }
    } catch {
      // continue with next query
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return [...new Set(domains)];
}

async function validateCareerPage(domain: string): Promise<string | null> {
  const careerPaths = ['/careers', '/jobs', '/join-us'];
  for (const path of careerPaths) {
    try {
      const url = `https://${domain}${path}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok && res.status < 400) return url;
    } catch {
      // try next path
    }
  }
  return null;
}

export async function runDiscovery(): Promise<number> {
  const serperApiKey = process.env.SERPER_API_KEY;
  if (!serperApiKey) {
    console.log('[Discovery] SERPER_API_KEY not set — skipping discovery');
    return 0;
  }

  console.log('[Discovery] Starting daily company discovery...');
  const domains = await discoverViaSerper(serperApiKey);
  console.log(`[Discovery] Serper returned ${domains.length} candidate domain(s)`);

  let added = 0;
  for (const domain of domains) {
    const careerUrl = await validateCareerPage(domain);
    if (careerUrl) {
      const companyId = upsertCompany(domain, domain, 'discovered');
      addToQueue(companyId, careerUrl, 'career_page');
      added++;
      console.log(`[Discovery] Added: ${domain} → ${careerUrl}`);
    }
  }

  console.log(`[Discovery] Done — ${added} new company/companies added`);
  return added;
}

// Self-test
if (require.main === module) {
  runDiscovery().then(count => {
    console.log(`\nDiscovery complete — ${count} new companies added`);
    process.exit(0);
  });
}
```

- [ ] **Step 2: Test discovery**

```bash
node_modules\.bin\tsx src\crawler\discoveryEngine.ts
```

Expected: Serper queries run, some domains discovered, validated, added. Count of new companies printed. (Actual count varies — 0 is acceptable if no new valid domains found.)

- [ ] **Step 3: Commit**

```bash
git add src/crawler/discoveryEngine.ts
git commit -m "feat: add discoveryEngine — Serper-based UAE company discovery with career page validation"
```

---

## Task 9: Build `crawler/index.ts` — main loop

**Files:**
- Create: `src/crawler/index.ts`

- [ ] **Step 1: Create the main loop**

Create `src/crawler/index.ts`:

```typescript
import * as dotenv from 'dotenv';
dotenv.config();

import { initDb } from '../dedup';
import { seedCompanies, getActiveCompanies, setCareerUrl, disableCompany } from './companyStore';
import {
  initQueue,
  seedQueueFromCompanies,
  getNextBatch,
  reschedule,
  incrementFailCount,
  addToQueue,
} from './crawlQueue';
import { locateCareerPage } from './careerPageLocator';
import { detectChange } from './changeDetector';
import { extractJobs } from './jobExtractor';
import { runDiscovery } from './discoveryEngine';
import { isDuplicate, markSeen } from '../dedup';
import { filterJobs } from '../filter';
import { config } from '../config';
import { notifyJob } from '../notifier';
import { createBrowser, createStealthContext } from '../antidetect/stealthBrowser';

const BATCH_SIZE = 3;
const CHECK_INTERVAL_HOT_MS = 2 * 60 * 60 * 1000;   // 2h — company just had changes
const CHECK_INTERVAL_QUIET_MS = 6 * 60 * 60 * 1000;  // 6h — no recent changes
const FAIL_DISABLE_THRESHOLD = 5;
const DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;   // run discovery once per day
const DOMAIN_GAP_MS = 60 * 1000;  // min 60s between requests to the same domain

const domainLastFetched = new Map<string, number>();
let lastDiscoveryRun = 0;
let browserUseCount = 0;
const BROWSER_RECYCLE_AFTER = 50;

function getDomainFromUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

async function enforcedomainGap(domain: string): Promise<void> {
  const last = domainLastFetched.get(domain) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < DOMAIN_GAP_MS) {
    await new Promise(r => setTimeout(r, DOMAIN_GAP_MS - elapsed));
  }
  domainLastFetched.set(domain, Date.now());
}

async function processItem(item: { id: number; company_id: number; url: string; last_hash: string | null; fail_count: number }): Promise<void> {
  const domain = getDomainFromUrl(item.url);

  await enforcedomainGap(domain);

  // If career_url not yet discovered, locate it first
  const companies = getActiveCompanies();
  const company = companies.find(c => c.id === item.company_id);
  if (!company) return;

  let targetUrl = item.url;
  if (!company.career_url) {
    const found = await locateCareerPage(company.domain);
    if (!found) {
      incrementFailCount(item.id);
      if (item.fail_count + 1 >= FAIL_DISABLE_THRESHOLD) {
        disableCompany(company.id);
        console.log(`[Crawler] Disabled ${company.name} — career page not found after ${FAIL_DISABLE_THRESHOLD} attempts`);
      }
      return;
    }
    setCareerUrl(company.id, found);
    targetUrl = found;
  }

  // Fetch page and detect changes
  let html: string | null = null;
  try {
    const response = await fetch(`https://r.jina.ai/${targetUrl}`, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) html = await response.text();
  } catch {
    html = null;
  }

  if (!html) {
    incrementFailCount(item.id);
    if (item.fail_count + 1 >= FAIL_DISABLE_THRESHOLD) {
      disableCompany(company.id);
      console.error(`[Crawler] Disabled ${company.name} (${targetUrl}) — fetch failed ${FAIL_DISABLE_THRESHOLD} times`);
    }
    return;
  }

  const { changed, newHash } = detectChange(html, item.last_hash);

  if (!changed) {
    reschedule(item.id, Date.now() + CHECK_INTERVAL_QUIET_MS, newHash);
    return;
  }

  // Content changed — extract jobs
  const rawJobs = await extractJobs(targetUrl, company.name, new Date());
  const filtered = filterJobs(rawJobs, config);
  const newJobs = filtered.filter(j => !isDuplicate(j.id));

  for (const job of newJobs) {
    markSeen(job.id, 'CareerPage');
    await notifyJob(job, null);
    console.log(`[Crawler] New job sent: ${job.title} @ ${job.company}`);
  }

  reschedule(item.id, Date.now() + CHECK_INTERVAL_HOT_MS, newHash);
}

async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Crawler starting...`);

  initDb();
  seedCompanies();
  initQueue();
  seedQueueFromCompanies();

  const companies = getActiveCompanies();
  console.log(`[Crawler] ${companies.length} active companies in queue`);

  while (true) {
    // Daily discovery
    if (Date.now() - lastDiscoveryRun > DISCOVERY_INTERVAL_MS) {
      lastDiscoveryRun = Date.now();
      runDiscovery().catch(e => console.error('[Discovery] Error:', e.message));
    }

    const batch = getNextBatch(BATCH_SIZE);

    if (batch.length === 0) {
      await new Promise(r => setTimeout(r, 30_000)); // idle wait
      continue;
    }

    for (const item of batch) {
      try {
        await processItem(item);
      } catch (err) {
        console.error(`[Crawler] Error processing item ${item.id}: ${(err as Error).message}`);
        incrementFailCount(item.id);
      }
    }
  }
}

main().catch(err => {
  console.error('[Crawler] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

```bash
node_modules\.bin\tsc --noEmit
```

Expected: 0 errors. The correct export names are already in the code above — `notifyJob` from `notifier.ts`, `filterJobs(jobs, config)` from `filter.ts`.

- [ ] **Step 4: Typecheck passes**

```bash
node_modules\.bin\tsx node_modules\.bin\tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Test crawler startup**

```bash
node_modules\.bin\tsx src\crawler\index.ts
```

Watch for 30–60 seconds. Expected output:
```
[timestamp] Crawler starting...
[Crawler] 90 active companies in queue
[CareerLocator] Found via path probe: https://careem.com/careers
...
```

Ctrl+C to stop. Any output showing companies being processed = success.

- [ ] **Step 6: Commit**

```bash
git add src/crawler/index.ts
git commit -m "feat: add crawler main loop — continuous queue drain with change detection and job extraction"
```

---

## Task 10: Update `ecosystem.config.js` + build + deploy

**Files:**
- Modify: `ecosystem.config.js`

- [ ] **Step 1: Add crawler process**

Update `ecosystem.config.js`:

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
    {
      name: 'crawler',
      script: 'dist/crawler/index.js',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: `dist/crawler/index.js` and all other dist files generated without errors.

- [ ] **Step 3: Deploy on DO server**

```bash
git add -A
git commit -m "feat: complete Stage 2 persistent crawler"
git push origin master
```

On the DO server:
```bash
git pull origin master
npm install
npm run build
pm2 restart ecosystem.config.js
pm2 save
```

- [ ] **Step 4: Verify both processes running**

```bash
pm2 status
```

Expected:
```
┌──────────┬────────┬─────────┬───────┐
│ scheduler│ online │ ...     │ ...   │
│ crawler  │ online │ ...     │ ...   │
└──────────┴────────┴─────────┴───────┘
```

- [ ] **Step 5: Watch crawler logs for 5 minutes**

```bash
pm2 logs crawler --lines 50
```

Expected: career page locator running, change detection running, at least some companies being processed per minute.

- [ ] **Step 6: Final commit**

```bash
git add ecosystem.config.js
git commit -m "feat: add crawler process to PM2 ecosystem config"
```

---

## Done — Stage 2 complete when:

- [ ] `pm2 status` shows both `scheduler` and `crawler` as `online`
- [ ] `pm2 logs crawler` shows companies being processed (no crash loop)
- [ ] At least one Telegram alert received from `portal: 'CareerPage'`
- [ ] Memory stays under 500MB for crawler process over 1h run (`pm2 monit`)
