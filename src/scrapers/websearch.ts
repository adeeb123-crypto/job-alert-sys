import { WebJobLead } from '../types';
import { config } from '../config';
import { isWebLeadSeen, markWebLeadSeen } from '../dedup';
import { parseSeniorityFromJD } from '../filter';

// Aggregators and news sites — we only want direct company career pages
const SKIP_DOMAINS = new Set([
  'linkedin.com', 'bayt.com', 'indeed.com', 'naukrigulf.com', 'gulftalent.com',
  'glassdoor.com', 'monster.com', 'ziprecruiter.com', 'careerjet.com', 'jobsdb.com',
  'simplyhired.com', 'totaljobs.com', 'naukri.com',
  'gulfnews.com', 'khaleejtimes.com', 'thenationalnews.com',
  'arabianbusiness.com', 'zawya.com', 'menabytes.com', 'wamda.com',
  'dubizzle.com', 'olx.com', 'expatriates.com',
  'duckduckgo.com', 'google.com', 'google.ae', 'bing.com', 'serper.dev',
  'youtube.com', 'facebook.com', 'twitter.com', 'instagram.com',
  'wikipedia.org', 'reddit.com',
]);

// URL path segments that suggest a real job listing (not a generic careers homepage)
const CAREER_PATH = /\/(jobs?|careers?|vacancies|openings?|positions?|apply|hiring|join|opportunities?)\b/i;

// ─── Query builder ────────────────────────────────────────────────────────────

function buildQueries(): string[] {
  const kws = config.keywords;
  const mid = Math.ceil(kws.length / 2);

  const makeQuery = (batch: string[]) => {
    const kwOr = batch.map(k => `"${k}"`).join(' OR ');
    return `${kwOr} UAE careers`;
  };

  return [makeQuery(kws.slice(0, mid)), makeQuery(kws.slice(mid))];
}

// ─── Serper.dev (Google Search) ───────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SerperOrganic {
  title: string;
  link: string;
  snippet: string;
}

interface SerperResponse {
  organic?: SerperOrganic[];
}

async function searchSerper(query: string): Promise<SearchResult[]> {
  const apiKey = process.env['SERPER_API_KEY'];
  if (!apiKey) throw new Error('SERPER_API_KEY not set in .env');

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      num: 10,
      tbs: 'qdr:d2', // freshness: last 2 days only
      gl: 'ae',      // country: UAE
      hl: 'en',      // language: English
    }),
  });

  if (!res.ok) throw new Error(`Serper returned HTTP ${res.status}`);

  const data = await res.json() as SerperResponse;

  return (data.organic ?? []).map(r => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
  }));
}

// ─── Jina AI Reader — fetches clean text from any URL ────────────────────────

async function fetchJDViaJina(url: string): Promise<string> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const text = await res.text();
    return text.slice(0, 3000); // enough for seniority parsing
  } catch {
    return '';
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

// Returns true if the JD is clearly too senior for configured max_years
function isTooSenior(text: string): boolean {
  const parsed = parseSeniorityFromJD(text);
  if (!parsed) return false; // ambiguous — let it through per spec
  return parsed.min > config.seniority.max_years;
}

// ─── Main exported function ───────────────────────────────────────────────────

export async function searchWebJobs(): Promise<WebJobLead[]> {
  const queries = buildQueries();
  const newLeads: WebJobLead[] = [];

  for (const query of queries) {
    const tag = `[${new Date().toISOString()}] [WebSearch]`;
    console.log(`${tag} Query: ${query.slice(0, 90)}`);

    let results: SearchResult[] = [];
    try {
      results = await searchSerper(query);
      console.log(`${tag} Serper returned ${results.length} results`);
    } catch (err) {
      console.error(`${tag} Serper failed: ${(err as Error).message}`);
      continue;
    }

    for (const result of results) {
      if (isSkippedDomain(result.url)) continue;
      if (!CAREER_PATH.test(result.url) && !CAREER_PATH.test(result.title)) continue;
      if (isWebLeadSeen(result.url)) continue;

      const innerTag = `[${new Date().toISOString()}] [WebSearch]`;
      console.log(`${innerTag} Fetching JD: ${result.url}`);

      const jdText = await fetchJDViaJina(result.url);
      const textToCheck = jdText || result.snippet;

      if (isTooSenior(textToCheck)) {
        console.log(`${innerTag} SKIP (too senior): "${result.title}"`);
        continue;
      }

      console.log(`${innerTag} NEW: "${result.title}" @ ${extractCompany(result.url)}`);

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

      await new Promise(r => setTimeout(r, 800));
    }

    await new Promise(r => setTimeout(r, 1200)); // pause between Serper queries
  }

  console.log(`[${new Date().toISOString()}] [WebSearch] Done — ${newLeads.length} new lead(s)`);
  return newLeads;
}

// ─── Self-test ────────────────────────────────────────────────────────────────

if (require.main === module) {
  const { initDb } = require('../dedup') as { initDb: () => void };
  initDb();

  console.log('\n=== WebSearch self-test (Serper.dev → Jina AI Reader) ===\n');
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
