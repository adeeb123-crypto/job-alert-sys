# Jooble API Integration Design

## Goal

Replace the Indeed and Bayt Playwright scrapers (both blocked by Cloudflare on DigitalOcean) with a single Jooble API integration. Jooble is a free job aggregator that indexes Bayt, Indeed, NaukriGulf, GulfTalent, and others — one integration covers both broken portals.

## Context

- `scrapeIndeed()` returns 0 jobs on the VPS — DigitalOcean IPs are on Cloudflare's blocklist
- `scrapebayt()` only processes the first keyword before Cloudflare blocks subsequent requests
- LinkedIn (`scrapeLinkedIn()`) is unaffected and continues to work
- Jooble's REST API has no Cloudflare, free tier supports up to 500 calls/day

## Architecture

### New file: `src/scrapers/jooble.ts`

Single responsibility: call Jooble's API for each keyword in `config.keywords`, collect results, deduplicate by URL, return `Job[]`.

**API contract:**
```
POST https://jooble.org/api/{JOOBLE_API_KEY}
Content-Type: application/json

Body: {
  "keywords": "<keyword>",
  "location": "United Arab Emirates",
  "datecreated": "day"    ← last 24 hours, native to Jooble
}

Response: {
  "totalCount": 123,
  "jobs": [
    {
      "title": "...",
      "company": "...",
      "location": "...",
      "link": "https://...",
      "snippet": "...",
      "updated": "2026-05-19T..."
    }
  ]
}
```

The scraper loops over `config.keywords`, fires one POST per keyword with a short random delay between requests (500–1500ms), and deduplicates results by `link` before mapping to the `Job` type.

`portal` is set to `'Jooble'` on all returned jobs.

### Modified: `src/scrapers/index.ts`

- Remove `scrapeIndeed` and `scrapebayt` from the `Promise.allSettled` array in `runAllScrapers()`
- Add `scrapeJooble` in their place
- Update the `labels` array accordingly
- Keep the import/export lines for `scrapeIndeed` and `scrapebayt` so the files remain usable for future scraping engine work

### Modified: `src/config.ts`

Add `joobleApiKey: requireEnv('JOOBLE_API_KEY')` to `loadSecrets()`.

### Modified: `src/types/index.ts`

Add `joobleApiKey: string` to the `Secrets` interface.

### Modified: `.env.example`

Add `JOOBLE_API_KEY=` with a comment pointing to jooble.org/api.

## Data flow

```
runAllScrapers()
  ├── scrapeLinkedIn()     ← unchanged, working
  ├── scrapeJooble()       ← new, replaces Indeed + Bayt
  │     ├── POST /api/{key}  keywords[0]
  │     ├── POST /api/{key}  keywords[1]
  │     └── ... (with 500–1500ms delay between calls)
  └── [scrapeNaukriGulf, scrapeGulfTalent remain as-is]

→ dedup by job.id (fingerprint)
→ filter
→ resume tailoring (Claude)
→ Telegram + email
```

## Error handling

- If Jooble returns a non-200 response, log a warning and return an empty array (same pattern as other scrapers)
- If `jobs` array is missing or empty, log and return `[]`
- Individual keyword failures should not abort the whole loop — wrap each call in try/catch

## What is NOT changing

- `scrapeLinkedIn()` — untouched
- `src/filter.ts` — no changes needed
- `src/resumeTailor.ts` — no changes needed
- `src/notifier.ts` — no changes needed
- `src/dedup.ts` — no changes needed
- Old scraper files (`indeed.ts`, `bayt.ts`) — kept on disk, just removed from `runAllScrapers()`

## Credentials

- Sign up at jooble.org/api (free, instant)
- Add `JOOBLE_API_KEY=<key>` to `.env` on both local machine and DigitalOcean VPS
