# Master Prompt — UAE Job Alert & Resume Tailoring System
> Feed this entire file to Claude Code at the start of a new session to begin development.

---

## YOUR ROLE

You are an expert Node.js + TypeScript engineer. You will build a personal, automated job alert and resume tailoring system for the UAE job market from scratch, following the PRD below precisely. You will work incrementally, confirming each phase before moving to the next. You write clean, well-commented TypeScript. You do not skip steps, do not hallucinate dependencies, and always verify your work compiles and runs before declaring a step done.

---

## CONTEXT — WHY THIS EXISTS

The UAE job market is hyper-competitive. Within 10 minutes of a job posting going live, hundreds of applications arrive. This system exists to ensure the owner is always among the first 10–20 applicants — by monitoring all major job portals continuously, filtering matches, tailoring a resume using AI, and delivering everything via Telegram and email before most candidates even see the posting.

This is a personal-use tool. There is no multi-user requirement, no auth layer, no public-facing UI in Phase 1.

---

## PRD — FULL SPECIFICATION

### 1. Problem Statement

Monitor UAE job portals every 5 minutes. When a matching job is found, extract the JD, tailor a base `resume.md` using the Claude API, render a PDF, and push it to the owner via Telegram and email — all automatically, around the clock.

---

### 2. Goals

- Poll all major UAE job portals continuously (every 5 minutes)
- Filter postings by configurable keywords and seniority level
- Deduplicate the same job appearing across multiple portals
- Parse the JD, tailor `resume.md` using Claude API, render PDF, and deliver via Telegram + email

---

### 3. Out of Scope (Phase 1)

- Auto-applying (owner verifies and applies manually)
- Web UI dashboard (Phase 2)
- Telegram bot commands to update config (Phase 3)
- Cover letter generation (Phase 3)

---

### 4. Portal Ingestion Strategy

| Portal | Method | Notes |
|---|---|---|
| LinkedIn | RSS polling | `https://www.linkedin.com/jobs/search/?keywords=KEYWORD&location=UAE&f_TPR=r300` — no auth needed, unofficial but stable |
| Indeed | RSS polling | `https://www.indeed.com/rss?q=KEYWORD&l=UAE` — official RSS, cleanest source |
| NaukriGulf | Playwright scraper | No public RSS, needs headless browser |
| Bayt.com | Playwright scraper | Some listing pages scrapeable without login |
| GulfTalent | Playwright scraper | Lighter site, easier to scrape |

**Polling behaviour:**
- Poll interval: every 5 minutes (configurable via `config.json`)
- RSS feeds: use `rss-parser` npm package
- Scrapers: use `playwright` in headless mode with randomised delay (2–4s between requests) and a realistic user-agent string
- On rate limit or block: log the error, skip the portal for that cycle, retry on the next cycle — do NOT crash the process

---

### 5. Filtering Logic

All filtering rules are driven by `config.json`. No hardcoded values.

**Keyword matching:**
- Up to 5 active keywords at a time (e.g. `["software engineer", "backend developer", "full stack developer"]`)
- Match case-insensitively against: job title + first 500 characters of the JD body
- A job passes if ANY keyword matches

**Seniority filtering:**
- Config format: `{ "min_years": 2, "max_years": 10 }`
- Parse the JD for patterns: `"X-Y years"`, `"minimum X years"`, `"X+ years"`, `"senior"`, `"junior"`, `"mid-level"`, `"entry level"`
- If seniority is ambiguous or not mentioned: **let it through** (do not filter out)
- Map `"junior"` → ~0–2 years, `"mid"` → ~2–5 years, `"senior"` → ~5+ years

**Job type:** Accept both `full-time` and `contract`

**Location:** Match any of: `Dubai`, `Abu Dhabi`, `Sharjah`, `UAE`, `Remote (UAE)` — case-insensitive

---

### 6. Deduplication

- On every new job found, generate a fingerprint: `SHA256(company_name.toLowerCase() + job_title.toLowerCase() + location.toLowerCase())`
- Store fingerprints in SQLite (`/data/dedup.db`) with a `found_at` timestamp
- TTL: 30 days — purge records older than 30 days on each scheduler run
- If a fingerprint already exists in the DB: **skip silently** — no notification, no processing
- Store which portal found it first (for reference in the notification)

---

### 7. AI Processing Pipeline

Triggered once per job that passes filtering + deduplication.

**Step 1 — JD extraction:**
- Strip HTML tags from the raw JD
- Extract structured fields: `job_title`, `company_name`, `location`, `job_type`, `required_skills[]`, `years_of_experience`, `raw_text`
- Use regex + heuristics, not AI, for this step (save API cost)

**Step 2 — Resume tailoring (Claude API):**
- Model: `claude-sonnet-4-5` (or latest Sonnet available)
- Input: full JD text + contents of `resume.md`
- System prompt (use exactly this):

```
You are a professional resume editor. You will receive a job description and a base resume in Markdown format. Your task is to tailor the resume to the job description by:
1. Reordering bullet points within each role to prioritise skills and experience most relevant to the JD
2. Adjusting the professional summary to mirror the language and priorities of the JD
3. Emphasising technologies, tools, and methodologies mentioned in the JD that already exist in the resume

STRICT RULES:
- Do NOT add any experience, skills, technologies, or roles that are not already in the resume
- Do NOT fabricate, invent, or exaggerate anything
- Do NOT change job titles, company names, dates, or factual information
- Only reorder, rephrase, and emphasise what already exists
- Output the complete tailored resume in Markdown format only — no preamble, no explanation, no commentary
```

- `max_tokens`: 2000
- Output: full tailored resume as a Markdown string

**Step 3 — PDF rendering:**
- Convert the tailored Markdown to styled HTML, then render to PDF using Puppeteer
- Use a clean, professional CSS style (dark headings, readable body font, proper spacing)
- Save temporarily to `/tmp/resume_<jobId>.pdf`
- Delete the file after it has been sent via both notification channels

---

### 8. Notification Delivery

Both channels fire simultaneously for every new matching job.

**Telegram (instant alert):**
- Send a text message:
  ```
  🔔 New Job Match

  📌 [Job Title] @ [Company]
  📍 [Location] | [Job Type]
  🌐 Source: [Portal Name]
  🔗 [Job URL]

  🛠 Detected skills: [comma-separated skill list]
  📅 Seniority signal: [what was parsed, e.g. "3-5 years" or "Not specified"]
  ```
- Attach the tailored resume PDF as a document

**Email (full detail):**
- Subject: `[Job Alert] [Job Title] @ [Company Name]`
- Body (HTML email):
  - Job title, company, location, source portal, link
  - Skills match summary
  - Full JD text (plain, inside a `<pre>` block or clean section)
- Attachment: tailored resume PDF
- Sent via Nodemailer

---

### 9. Configuration

**`config.json`** — structure only, no secrets:
```json
{
  "keywords": [
    "software engineer",
    "backend developer",
    "full stack developer",
    "node.js developer",
    "software developer"
  ],
  "seniority": {
    "min_years": 2,
    "max_years": 10
  },
  "job_types": ["full-time", "contract"],
  "location": "UAE",
  "poll_interval_minutes": 5,
  "notifications": {
    "telegram": {
      "chat_id": "TELEGRAM_CHAT_ID"
    },
    "email": {
      "smtp_host": "smtp.gmail.com",
      "smtp_port": 587,
      "from": "FROM_EMAIL",
      "to": "TO_EMAIL"
    }
  },
  "resume_path": "./resume.md"
}
```

**`.env`** — all secrets:
```env
TELEGRAM_BOT_TOKEN=
CLAUDE_API_KEY=
SMTP_USER=
SMTP_PASS=
```

**`.env.example`** must be committed. **`.env`** must be in `.gitignore`.

---

### 10. Tech Stack

| Concern | Package/Tool | Version constraint |
|---|---|---|
| Runtime | Node.js + TypeScript | Node 20+, TS 5+ |
| Scheduler | `node-cron` | latest |
| RSS parsing | `rss-parser` | latest |
| Scraping | `playwright` | latest |
| Dedup store | `better-sqlite3` + `@types/better-sqlite3` | latest |
| AI | `@anthropic-ai/sdk` | latest |
| PDF | `puppeteer` | latest |
| Markdown → HTML | `marked` | latest |
| Telegram | `node-telegram-bot-api` | latest |
| Email | `nodemailer` + `@types/nodemailer` | latest |
| Hashing | Node built-in `crypto` | — |
| Env loading | `dotenv` | latest |

---

### 11. Folder Structure

Build exactly this structure:

```
/job-alert-system
  /src
    index.ts                ← entry point: loads config, starts scheduler
    scheduler.ts            ← orchestrates each poll cycle
    config.ts               ← loads and validates config.json + .env
    /scrapers
      index.ts              ← exports runAllScrapers()
      linkedin.ts           ← RSS scraper
      indeed.ts             ← RSS scraper
      naukriGulf.ts         ← Playwright scraper
      bayt.ts               ← Playwright scraper
      gulfTalent.ts         ← Playwright scraper
    filter.ts               ← keyword, seniority, location, job type filtering
    dedup.ts                ← SQLite fingerprint store (init, check, insert, purge)
    jdParser.ts             ← strip HTML, extract structured JD fields
    resumeTailor.ts         ← Claude API call with system prompt
    pdfRenderer.ts          ← Markdown → HTML → PDF via Puppeteer
    notifier.ts             ← Telegram + email dispatch
    /types
      index.ts              ← shared TypeScript interfaces (Job, Config, ParsedJD, etc.)
  /data
    dedup.db                ← SQLite file (gitignored, persisted on fly.io volume)
  resume.md                 ← base resume (owner fills this in)
  config.json               ← all non-secret settings
  .env                      ← secrets (gitignored)
  .env.example              ← committed example env file
  .gitignore
  Dockerfile
  fly.toml                  ← fly.io deployment config
  package.json
  tsconfig.json
  README.md
```

---

### 12. Key Interfaces (types/index.ts)

Define at minimum:

```typescript
export interface Job {
  id: string;               // SHA256 fingerprint
  title: string;
  company: string;
  location: string;
  jobType: string;
  url: string;
  portal: string;
  rawJD: string;
  foundAt: Date;
}

export interface ParsedJD {
  jobTitle: string;
  companyName: string;
  location: string;
  jobType: string;
  requiredSkills: string[];
  yearsOfExperience: string;  // raw parsed string e.g. "3-5 years" or "Not specified"
  rawText: string;
}

export interface Config {
  keywords: string[];
  seniority: { min_years: number; max_years: number };
  job_types: string[];
  location: string;
  poll_interval_minutes: number;
  notifications: {
    telegram: { chat_id: string };
    email: { smtp_host: string; smtp_port: number; from: string; to: string };
  };
  resume_path: string;
}
```

---

### 13. Dockerfile

```dockerfile
FROM node:20-slim

# Install Playwright system dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    wget \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

VOLUME ["/data"]

CMD ["node", "dist/index.js"]
```

---

### 14. fly.toml (fly.io deployment)

```toml
app = "job-alert-system"
primary_region = "dxb"

[build]

[mounts]
  source = "job_alert_data"
  destination = "/data"

[[services]]
  internal_port = 3000
  protocol = "tcp"

[env]
  NODE_ENV = "production"
```

---

### 15. Risks & Mitigations to Implement

| Risk | Implementation requirement |
|---|---|
| Portal blocks scraper | Randomised 2–4s delay per request, realistic user-agent header, Playwright stealth mode. On error: log + skip, never crash |
| SQLite lost on redeploy | All SQLite files write to `/data/` — the fly.io mounted volume |
| Claude API cost spike | Hard `max_tokens: 2000` cap on every API call. Log token usage per call |
| Duplicate notifications | Fingerprint hash check in dedup.ts — if exists in DB, skip entire pipeline |
| PDF temp file leak | Delete `/tmp/resume_<jobId>.pdf` after both notifications confirm sent |

---

## BUILD INSTRUCTIONS FOR CLAUDE CODE

### How to proceed

Work through the following phases in order. **Do not skip ahead.** After completing each phase, summarise what was built and what the next phase is, then wait for confirmation before continuing — unless I explicitly say "keep going" or "build it all".

---

### Phase 1 — Project scaffold & config (start here)

1. Create the full folder structure above
2. Initialise `package.json` with all dependencies listed in the tech stack
3. Create `tsconfig.json` (strict mode, `outDir: dist`, `rootDir: src`)
4. Create `types/index.ts` with all interfaces defined above
5. Create `config.ts` — loads `config.json` and merges `.env` secrets, validates required fields, throws a clear error if anything is missing
6. Create `.env.example`, `.gitignore`, and a starter `resume.md` with placeholder content
7. Create a minimal `index.ts` that loads config and logs "System starting..." — confirm it compiles with `tsc --noEmit`

**Done when:** `npm run build` succeeds with zero errors.

---

### Phase 2 — Deduplication store

1. Implement `dedup.ts`:
   - `initDb()` — creates the SQLite table if not exists: `(id TEXT PRIMARY KEY, portal TEXT, found_at INTEGER)`
   - `isDuplicate(fingerprint: string): boolean`
   - `markSeen(fingerprint: string, portal: string): void`
   - `purgeOld(): void` — deletes records older than 30 days
2. Write a quick inline test at the bottom (behind `if (require.main === module)`) that inserts a record, checks it's a duplicate, and purges — log pass/fail

**Done when:** `npx ts-node src/dedup.ts` runs and logs pass.

---

### Phase 3 — Indeed + LinkedIn RSS scrapers

1. Implement `scrapers/indeed.ts` — polls RSS for each keyword in config, returns `Job[]`
2. Implement `scrapers/linkedin.ts` — polls RSS for each keyword in config, returns `Job[]`
3. Implement `scrapers/index.ts` — calls all scrapers, deduplicates results by fingerprint across portals, returns unified `Job[]`
4. Implement `filter.ts` — applies keyword, seniority, location, job type filters. Returns `Job[]`
5. Wire up a test run in `scheduler.ts` (stub): scrape → filter → log matching jobs to console (no AI, no notification yet)

**Done when:** Running the scheduler stub logs at least the structure of matching jobs from Indeed/LinkedIn (even if no live jobs match at that moment, the pipeline should run without errors).

---

### Phase 4 — Playwright scrapers

1. Implement `scrapers/naukriGulf.ts`
2. Implement `scrapers/bayt.ts`
3. Implement `scrapers/gulfTalent.ts`
4. Add all three to `scrapers/index.ts`
5. Implement proper error handling — each scraper runs in try/catch, logs failures, and returns empty array on error (never throws to scheduler)

**Done when:** All five scrapers run without crashing. Errors are caught and logged gracefully.

---

### Phase 5 — JD parsing + AI resume tailoring

1. Implement `jdParser.ts` — strips HTML, extracts `ParsedJD` fields using regex heuristics
2. Implement `resumeTailor.ts` — calls Claude API with the exact system prompt from Section 7, returns tailored Markdown string
3. Implement `pdfRenderer.ts` — converts Markdown → HTML (via `marked`) → PDF (via Puppeteer), saves to `/tmp/resume_<jobId>.pdf`, returns the file path

**Done when:** Given a sample JD string and `resume.md`, `resumeTailor.ts` returns a tailored Markdown string and `pdfRenderer.ts` saves a valid PDF.

---

### Phase 6 — Notifications

1. Implement `notifier.ts`:
   - `sendTelegram(job, parsedJD, pdfPath)` — sends the formatted message + PDF attachment
   - `sendEmail(job, parsedJD, pdfPath)` — sends HTML email with PDF attachment via Nodemailer
   - `notify(job, parsedJD, pdfPath)` — calls both in parallel (`Promise.all`), then deletes the PDF file

**Done when:** A test call to `notify()` with mock data sends a real Telegram message and email.

---

### Phase 7 — Full integration + scheduler

1. Implement the full `scheduler.ts` orchestration loop:
   ```
   runAllScrapers() → filter() → for each new job:
     isDuplicate? skip : markSeen() → parsedJD() → tailorResume() → renderPDF() → notify()
   ```
2. Wire up `node-cron` in `index.ts` to run the scheduler every N minutes (from config)
3. Add `purgeOld()` to run once daily (separate cron)
4. Add console logging at every step with timestamps

**Done when:** The full system runs end-to-end. A matching job produces a Telegram message and email with attached PDF.

---

### Phase 8 — Dockerfile + deployment

1. Finalise `Dockerfile` (from Section 13)
2. Create `fly.toml` (from Section 14)
3. Create `README.md` with:
   - Setup instructions (clone, fill `.env`, add `resume.md`, deploy)
   - How to update keywords (`config.json`)
   - fly.io deployment commands (`fly launch`, `fly deploy`, `fly volumes create`)
4. Confirm `npm run build && docker build .` succeeds locally

**Done when:** Docker image builds successfully. README covers all setup steps clearly.

---

## GENERAL RULES FOR THIS BUILD

- **TypeScript strict mode** — no `any` types unless absolutely unavoidable, and always commented
- **No hardcoded values** — everything configurable comes from `config.json` or `.env`
- **Every external call wrapped in try/catch** — scrapers, Claude API, Telegram, email — none of these should ever crash the process
- **Log with timestamps** — use `console.log(`[${new Date().toISOString()}] ...`)` format throughout
- **No unused imports or dead code**
- **Ask before adding any dependency not listed in the tech stack**
- **Confirm each phase is complete before starting the next one** unless explicitly told to continue

---

## START

Begin with **Phase 1**. Create the project scaffold now.
