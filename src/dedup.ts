import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'data', 'dedup.db');
const TTL_DAYS = 30;

let db: Database.Database;

export function initDb(): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL'); // better write performance

  // Stores fingerprints of every job we've already processed
  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_jobs (
      id       TEXT    PRIMARY KEY,
      portal   TEXT    NOT NULL,
      found_at INTEGER NOT NULL
    )
  `);

  // One row per calendar day — tracks Claude API usage for the daily cost cap
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_call_log (
      date                TEXT  PRIMARY KEY,
      call_count          INTEGER NOT NULL DEFAULT 0,
      total_input_tokens  INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd  REAL    NOT NULL DEFAULT 0.0
    )
  `);

  // Stores URLs already alerted on from the Google web search feature (7-day TTL)
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_job_leads (
      url       TEXT    PRIMARY KEY,
      title     TEXT    NOT NULL,
      company   TEXT    NOT NULL,
      found_at  INTEGER NOT NULL
    )
  `);
}

// --- Job deduplication ---

export function generateFingerprint(company: string, title: string, location: string): string {
  const raw = `${company.toLowerCase()}${title.toLowerCase()}${location.toLowerCase()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function isDuplicate(fingerprint: string): boolean {
  const row = db.prepare('SELECT id FROM seen_jobs WHERE id = ?').get(fingerprint);
  return row !== undefined;
}

export function markSeen(fingerprint: string, portal: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO seen_jobs (id, portal, found_at) VALUES (?, ?, ?)'
  ).run(fingerprint, portal, Date.now());
}

export function purgeOld(): void {
  const cutoff = Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000;
  const result = db.prepare('DELETE FROM seen_jobs WHERE found_at < ?').run(cutoff);
  console.log(`[${new Date().toISOString()}] Purged ${result.changes} expired job record(s)`);
}

// --- Web job lead deduplication (7-day TTL, keyed by URL) ---

export function isWebLeadSeen(url: string): boolean {
  const row = db.prepare('SELECT url FROM web_job_leads WHERE url = ?').get(url);
  return row !== undefined;
}

export function markWebLeadSeen(url: string, title: string, company: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO web_job_leads (url, title, company, found_at) VALUES (?, ?, ?, ?)'
  ).run(url, title, company, Date.now());
}

export function purgeOldWebLeads(): void {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const result = db.prepare('DELETE FROM web_job_leads WHERE found_at < ?').run(cutoff);
  if (result.changes > 0) {
    console.log(`[${new Date().toISOString()}] Purged ${result.changes} expired web lead(s)`);
  }
}

// --- AI call tracking (daily cost cap) ---

export function getAiCallsToday(): number {
  const today = todayStr();
  const row = db
    .prepare('SELECT call_count FROM ai_call_log WHERE date = ?')
    .get(today) as { call_count: number } | undefined;
  return row?.call_count ?? 0;
}

export function recordAiCall(inputTokens: number, outputTokens: number, costUsd: number): void {
  const today = todayStr();
  db.prepare(`
    INSERT INTO ai_call_log (date, call_count, total_input_tokens, total_output_tokens, estimated_cost_usd)
    VALUES (?, 1, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      call_count          = call_count          + 1,
      total_input_tokens  = total_input_tokens  + excluded.total_input_tokens,
      total_output_tokens = total_output_tokens + excluded.total_output_tokens,
      estimated_cost_usd  = estimated_cost_usd  + excluded.estimated_cost_usd
  `).run(today, inputTokens, outputTokens, costUsd);
}

export function getDailyUsageSummary(): { calls: number; inputTokens: number; outputTokens: number; costUsd: number } {
  const today = todayStr();
  const row = db.prepare('SELECT * FROM ai_call_log WHERE date = ?').get(today) as {
    call_count: number;
    total_input_tokens: number;
    total_output_tokens: number;
    estimated_cost_usd: number;
  } | undefined;

  return {
    calls: row?.call_count ?? 0,
    inputTokens: row?.total_input_tokens ?? 0,
    outputTokens: row?.total_output_tokens ?? 0,
    costUsd: row?.estimated_cost_usd ?? 0,
  };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// --- Inline self-test ---

if (require.main === module) {
  console.log('Running dedup.ts self-test...\n');
  initDb();

  const fp = generateFingerprint('Acme Corp', 'Backend Engineer', 'Dubai');

  // 1. Fresh fingerprint should not be a duplicate
  console.assert(!isDuplicate(fp), 'FAIL: New fingerprint should not be a duplicate');
  console.log('PASS: New fingerprint correctly identified as not duplicate');

  // 2. Mark it seen
  markSeen(fp, 'indeed');
  console.log('PASS: markSeen executed without error');

  // 3. Now it must be a duplicate
  console.assert(isDuplicate(fp), 'FAIL: Fingerprint should now be a duplicate');
  console.log('PASS: Fingerprint correctly identified as duplicate after markSeen');

  // 4. Purge should not remove a fresh record
  purgeOld();
  console.assert(isDuplicate(fp), 'FAIL: Fresh record should survive purge');
  console.log('PASS: Fresh record correctly survived purge');

  // 5. AI call tracking
  recordAiCall(1500, 800, 0.015);
  recordAiCall(1200, 600, 0.012);
  const calls = getAiCallsToday();
  console.assert(calls === 2, `FAIL: Expected 2 AI calls today, got ${calls}`);
  console.log(`PASS: AI call tracking works — ${calls} call(s) recorded today`);

  const summary = getDailyUsageSummary();
  console.log(`\nDaily usage summary:`);
  console.log(`  Calls:         ${summary.calls}`);
  console.log(`  Input tokens:  ${summary.inputTokens}`);
  console.log(`  Output tokens: ${summary.outputTokens}`);
  console.log(`  Est. cost:     $${summary.costUsd.toFixed(4)}`);

  console.log('\nAll tests passed.');
}
