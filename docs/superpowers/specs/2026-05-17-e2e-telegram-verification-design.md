# End-to-End Telegram Verification — Design Spec
Date: 2026-05-17

## Goal
Verify the full pipeline works: scrape latest UAE jobs → filter → Claude tailors resume (capped at 4 calls) → Telegram delivers job card + `.md` resume file for every match.

## Scope
Telegram delivery only. Phase 8 (PDF/email), Docker, and Fly.io are out of scope for this session.

## What Changes
1. `config.json`: `ai.max_calls_per_day` → `4` (down from 25)
2. `src/scrapers/bayt.ts`: add a last-24-hours date filter to the search URL (same intent as Indeed's `fromage=1`) — currently missing, Bayt returns jobs of any age

All other pipeline logic is already implemented and correct.

## Expected Behavior
- Scrapers run concurrently: LinkedIn (last 1hr), Indeed (last 24hrs), Bayt (per-keyword)
- Filter: keyword + UAE location + full-time/contract + seniority 2–10 yrs
- For each new (non-duplicate) match:
  - Calls `tailorResume()` if under the 4-call cap → Claude rewrites all resume sections
  - Calls `notifyJob()` regardless → sends job card HTML to Telegram
  - If tailoring succeeded: also sends `.md` resume file via `sendDocument()`
  - If cap reached: job card only, with "tailoring skipped" note
- Email path: gracefully skipped (SMTP creds are placeholder)

## Success Criteria
1. At least one Telegram message received with a job card containing a clickable posting URL
2. At least one `.md` file received in Telegram with a rewritten resume (all sections edited, no banned buzzwords)
3. No unhandled errors in the console

## Fallback
If 0 matches fire (off-peak, all filtered out): clear the `seen_jobs` table in `data/dedup.db` and rerun. This forces all scraped jobs to appear new.

## Out of Scope
- PDF renderer (`src/pdfRenderer.ts`) — Phase 8
- Gmail SMTP — needs App Password credential
- Docker + Fly.io — Phase 9
