import { BrowserContext } from 'playwright';
import { WebJobLead } from '../types';
import { config } from '../config';
import { isWebLeadSeen, markWebLeadSeen } from '../dedup';
import { createBrowser, createStealthContext, randomDelay } from './browser';

// Aggregators and news sites — we only want direct company career pages
// Skip portals already covered by dedicated scrapers + noise sites
const SKIP_DOMAINS = new Set([
  'linkedin.com', 'bayt.com', 'indeed.com', 'naukrigulf.com', 'gulftalent.com',
  'glassdoor.com', 'monster.com', 'ziprecruiter.com', 'careerjet.com', 'jobsdb.com',
  'simplyhired.com', 'totaljobs.com', 'naukri.com',
  'gulfnews.com', 'khaleejtimes.com', 'thenationalnews.com',
  'arabianbusiness.com', 'zawya.com', 'menabytes.com', 'wamda.com',
  'dubizzle.com', 'olx.com', 'expatriates.com',
  'duckduckgo.com', 'google.com', 'google.ae', 'bing.com', 'brave.com',
  'youtube.com', 'facebook.com', 'twitter.com', 'instagram.com',
  'wikipedia.org', 'reddit.com',
]);

// URL path segments that suggest a real job listing (not a generic careers homepage)
const CAREER_PATH = /\/(jobs?|careers?|vacancies|openings?|positions?|apply|hiring|join|opportunities?)\b/i;

// ─── Query builder ────────────────────────────────────────────────────────────

// One query per keyword batch — simple format Brave handles reliably.
// Domain filtering (.ae only) is done in code after results come back.
function buildQueries(): string[] {
  const kws = config.keywords;
  const mid = Math.ceil(kws.length / 2);

  const makeQuery = (batch: string[]) => {
    const kwOr = batch.map(k => `"${k}"`).join(' OR ');
    return `${kwOr} UAE careers`;
  };

  return [makeQuery(kws.slice(0, mid)), makeQuery(kws.slice(mid))];
}

// ─── Brave Search API ─────────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

async function searchBrave(query: string): Promise<SearchResult[]> {
  const apiKey = process.env['BRAVE_SEARCH_API_KEY'];
  if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY not set in .env');

  const params = new URLSearchParams({
    q: query,
    count: '10',
  });

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!res.ok) throw new Error(`Brave Search returned HTTP ${res.status}`);

  const data = await res.json() as BraveResponse;

  return (data.web?.results ?? []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? '',
  }));
}

// ─── JD fetching from the actual company career page ─────────────────────────

const JD_SELECTORS = [
  '[class*="job-description"]',
  '[class*="jobDescription"]',
  '[id*="job-description"]',
  '[class*="job-detail"]',
  '[class*="jobDetail"]',
  '[class*="vacancy"]',
  '[class*="role-description"]',
  '[class*="position-description"]',
  'article',
  'main',
];

async function fetchJDFromPage(url: string, context: BrowserContext): Promise<string> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(1000, 2000);

    const text = await page.evaluate((selectors: string[]): string => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t.length > 200) return t.slice(0, 2500);
      }
      return '';
    }, JD_SELECTORS);

    return text;
  } catch {
    return '';
  } finally {
    await page.close();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isSkippedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const skip of SKIP_DOMAINS) {
      if (host.includes(skip)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function extractCompany(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const base = host.replace(/^(careers|jobs|apply|talent|work|people|join)\./i, '');
    const name = base.split('.')[0] ?? base;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'Unknown';
  }
}

// ─── Main exported function ───────────────────────────────────────────────────

export async function searchWebJobs(): Promise<WebJobLead[]> {
  const queries = buildQueries();
  const newLeads: WebJobLead[] = [];

  // Only Playwright for JD page fetching — search itself uses plain fetch
  const browser = await createBrowser();
  const context = await createStealthContext(browser);

  try {
    for (const query of queries) {
      const tag = `[${new Date().toISOString()}] [WebSearch]`;
      console.log(`${tag} Query: ${query.slice(0, 90)}...`);

      let results: SearchResult[] = [];
      try {
        results = await searchBrave(query);
        console.log(`${tag} Brave returned ${results.length} results`);
      } catch (err) {
        console.error(`${tag} Brave search failed: ${(err as Error).message}`);
        continue;
      }

      for (const result of results) {
        if (isSkippedDomain(result.url)) continue;
        if (!CAREER_PATH.test(result.url) && !CAREER_PATH.test(result.title)) continue;
        if (isWebLeadSeen(result.url)) continue;

        const innerTag = `[${new Date().toISOString()}] [WebSearch]`;
        console.log(`${innerTag} NEW: "${result.title}" → ${result.url}`);

        const jdText = await fetchJDFromPage(result.url, context);
        if (jdText) {
          console.log(`${innerTag} Got ${jdText.length} chars of JD text`);
        } else {
          console.log(`${innerTag} No JD extracted — will use search snippet`);
        }

        const lead: WebJobLead = {
          url: result.url,
          title: result.title,
          company: extractCompany(result.url),
          snippet: result.snippet,
          jdText: jdText || undefined,
          foundAt: new Date(),
        };

        markWebLeadSeen(lead.url, lead.title, lead.company);
        newLeads.push(lead);

        await randomDelay(1500, 3000);
      }

      await randomDelay(2000, 3500); // breathe between queries
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`[${new Date().toISOString()}] [WebSearch] Done — ${newLeads.length} new lead(s)`);
  return newLeads;
}

// ─── Self-test ────────────────────────────────────────────────────────────────

if (require.main === module) {
  const { initDb } = require('../dedup') as { initDb: () => void };
  initDb();

  console.log('\n=== WebSearch self-test (Brave Search API → Playwright JD fetch) ===\n');
  console.log('Queries:');
  buildQueries().forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  console.log('\nRunning...\n');

  searchWebJobs().then(leads => {
    console.log(`\n=== ${leads.length} new lead(s) ===`);
    leads.forEach((l, i) => {
      console.log(`\n${i + 1}. ${l.title}`);
      console.log(`   Company : ${l.company}`);
      console.log(`   URL     : ${l.url}`);
      console.log(`   Snippet : ${l.snippet.slice(0, 100)}`);
      if (l.jdText) console.log(`   JD      : ${l.jdText.slice(0, 150)}...`);
    });
    process.exit(0);
  }).catch(err => {
    console.error('Self-test failed:', err);
    process.exit(1);
  });
}
