# Web Search Pipeline (Serper.dev + Jina AI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken Brave Search API + heavy Playwright JD fetcher in `websearch.ts` with Serper.dev (Google Search) + Jina AI Reader, and add freshness (2-day) and seniority filtering to the web search pipeline.

**Architecture:** `websearch.ts` is self-contained — only this file and env/config change. Serper.dev replaces Brave for search queries (POST to google.serper.dev/search with `tbs: "qdr:d2"` for 2-day freshness). Jina AI Reader (plain GET to `r.jina.ai/{url}`) replaces Playwright browser for JD extraction — no browser needed. Seniority filtering reuses `parseSeniorityFromJD` already exported from `filter.ts`.

**Tech Stack:** Serper.dev REST API, Jina AI Reader (r.jina.ai), existing `parseSeniorityFromJD` from `filter.ts`, native `fetch` (no new npm packages needed)

---

## Who does what

| Task | Owner |
|---|---|
| Sign up at serper.dev, get API key, add to `.env` | **You** |
| Update `.env.example`, `config.ts`, `types/index.ts` | Me |
| Rewrite `websearch.ts` | Me |
| Run self-test, verify leads come through | Both |

---

## Files Changed

- **Modify:** `src/scrapers/websearch.ts` — swap Brave→Serper, Playwright→Jina, add seniority + freshness
- **Modify:** `.env.example` — replace `BRAVE_SEARCH_API_KEY` with `SERPER_API_KEY`
- **Modify:** `src/config.ts` — load `SERPER_API_KEY` instead of `BRAVE_SEARCH_API_KEY`
- **Modify:** `src/types/index.ts` — rename `braveSearchApiKey` → `serperApiKey` in `Secrets`

---

### Task 1: You — Get Serper API key

- [ ] Go to **serper.dev**, sign up with `waizadeeb@gmail.com`
- [ ] Create an API key (free tier: 2,500 queries)
- [ ] Add to your `.env` file:
  ```
  SERPER_API_KEY=your_key_here
  ```
- [ ] Tell me when done — I'll proceed with Task 2

---

### Task 2: Update env, types, and config

**Files:**
- Modify: `.env.example`
- Modify: `src/types/index.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Update `.env.example`**

Replace:
```
# Brave Search API — https://brave.com/search/api/ → Free plan (2,000 queries/month)
BRAVE_SEARCH_API_KEY=
```
With:
```
# Serper.dev Google Search API — https://serper.dev → Free tier: 2,500 queries
SERPER_API_KEY=
```

- [ ] **Step 2: Update `Secrets` interface in `src/types/index.ts`**

Change:
```typescript
braveSearchApiKey: string | null;
```
To:
```typescript
serperApiKey: string | null;
```

- [ ] **Step 3: Update `loadSecrets()` in `src/config.ts`**

Change:
```typescript
braveSearchApiKey: process.env['BRAVE_SEARCH_API_KEY'] ?? null,
```
To:
```typescript
serperApiKey: process.env['SERPER_API_KEY'] ?? null,
```

- [ ] **Step 4: Verify no TypeScript errors**
```bash
npx tsc --noEmit
```
Expected: zero errors

- [ ] **Step 5: Commit**
```bash
git add .env.example src/types/index.ts src/config.ts
git commit -m "chore: swap Brave API key for Serper.dev API key"
```

---

### Task 3: Rewrite websearch.ts

**File:** `src/scrapers/websearch.ts`

This is a full rewrite of the search + JD fetch layer. The `SKIP_DOMAINS`, `CAREER_PATH`, `buildQueries()`, `isSkippedDomain()`, and `extractCompany()` helpers stay unchanged. Everything else changes.

- [ ] **Step 1: Update imports — remove Playwright, add filter**

Replace the top of the file:
```typescript
import { BrowserContext } from 'playwright';
import { WebJobLead } from '../types';
import { config } from '../config';
import { isWebLeadSeen, markWebLeadSeen } from '../dedup';
import { createBrowser, createStealthContext, randomDelay } from './browser';
```
With:
```typescript
import { WebJobLead } from '../types';
import { config } from '../config';
import { isWebLeadSeen, markWebLeadSeen } from '../dedup';
import { parseSeniorityFromJD } from '../filter';
```

- [ ] **Step 2: Replace Brave interfaces + `searchBrave()` with Serper**

Remove the `BraveWebResult`, `BraveResponse` interfaces and the entire `searchBrave()` function.

Add in their place:
```typescript
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
      tbs: 'qdr:d2', // freshness: last 2 days
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
```

- [ ] **Step 3: Replace `JD_SELECTORS` + `fetchJDFromPage()` with Jina AI Reader**

Remove the `JD_SELECTORS` array and the entire `fetchJDFromPage()` function.

Add in their place:
```typescript
// ─── Jina AI Reader — fetches clean text from any URL ────────────────────────

async function fetchJDViaJina(url: string): Promise<string> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const text = await res.text();
    return text.slice(0, 3000); // enough for seniority parsing, caps cost
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Add seniority guard helper**

Add after `fetchJDViaJina`:
```typescript
// Returns true if the JD is clearly too senior for our configured max_years
function isTooSenior(text: string): boolean {
  const parsed = parseSeniorityFromJD(text);
  if (!parsed) return false; // ambiguous — let it through per spec
  return parsed.min > config.seniority.max_years;
}
```

- [ ] **Step 5: Rewrite `searchWebJobs()` — no more browser**

Replace the entire `searchWebJobs()` function with:
```typescript
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

      await new Promise(r => setTimeout(r, 800)); // small pause between Jina calls
    }

    await new Promise(r => setTimeout(r, 1200)); // pause between Serper queries
  }

  console.log(`[${new Date().toISOString()}] [WebSearch] Done — ${newLeads.length} new lead(s)`);
  return newLeads;
}
```

- [ ] **Step 6: Update self-test comment**

Change:
```typescript
console.log('\n=== WebSearch self-test (Brave Search API → Playwright JD fetch) ===\n');
```
To:
```typescript
console.log('\n=== WebSearch self-test (Serper.dev → Jina AI Reader) ===\n');
```

- [ ] **Step 7: Verify TypeScript compiles**
```bash
npx tsc --noEmit
```
Expected: zero errors

- [ ] **Step 8: Commit**
```bash
git add src/scrapers/websearch.ts
git commit -m "feat: replace Brave+Playwright with Serper.dev+Jina AI in web search"
```

---

### Task 4: Test

- [ ] **Step 1: Run the self-test**
```bash
npx ts-node src/scrapers/websearch.ts
```

Expected output:
```
=== WebSearch self-test (Serper.dev → Jina AI Reader) ===

Queries:
  1. "software engineer" OR "backend developer" UAE careers
  2. "full stack developer" OR "node.js developer" UAE careers

Running...

[WebSearch] Query: "software engineer" OR "backend developer" UAE careers
[WebSearch] Serper returned 10 results
[WebSearch] Fetching JD: https://somecompany.com/careers/...
[WebSearch] NEW: "Backend Engineer @ Noon" → https://...
...
[WebSearch] Done — 3 new lead(s)
```

- [ ] **Step 2: Verify seniority filtering is working**

Look for lines like:
```
[WebSearch] SKIP (too senior): "VP of Engineering @ Company"
```
If `max_years` in `config.json` is e.g. 10 and a result requires 15+ years, it should be skipped.

- [ ] **Step 3: Push to GitHub**
```bash
git push origin master
```

---

## What changes vs. what stays

| Component | Before | After |
|---|---|---|
| Search API | Brave Search (broken) | Serper.dev (Google, working) |
| JD fetching | Playwright browser | Jina AI Reader (plain HTTP) |
| Freshness | None | `tbs: "qdr:d2"` — last 2 days |
| Seniority check | None in web pipeline | `parseSeniorityFromJD` + `isTooSenior()` |
| Browser needed | Yes (heavy) | No (removed from this file) |
| New npm packages | None | None |
