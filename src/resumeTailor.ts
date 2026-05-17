import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { Job, TailoringResult } from './types';
import { config, secrets } from './config';
import { getAiCallsToday, recordAiCall } from './dedup';
import { createBrowser, createStealthContext, randomDelay } from './scrapers/browser';

const MODEL = 'claude-opus-4-7';

// Pricing for claude-opus-4-7 (USD per million tokens)
const INPUT_COST_PER_M  = 5.00;
const OUTPUT_COST_PER_M = 25.00;

// LinkedIn guest API — no auth needed, returns HTML for a single job posting
const LI_JOB_API = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

// Read and cache resume.md on first use — content never changes between runs
let _resumeCache: string | null = null;
function loadResume(): string {
  if (!_resumeCache) {
    const p = path.resolve(process.cwd(), config.resume_path);
    _resumeCache = fs.readFileSync(p, 'utf-8');
  }
  return _resumeCache;
}

// Lazy Anthropic client — avoids constructing before secrets are loaded
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: secrets.claudeApiKey });
  }
  return _client;
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M
       + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
}

// Extract the numeric job ID from a LinkedIn URL
// e.g. https://www.linkedin.com/jobs/view/4242421316/?... → "4242421316"
function linkedInJobId(url: string): string | null {
  const m = url.match(/\/(\d{7,})\/?(?:[?#]|$)/);
  return m?.[1] ?? null;
}

// Decode common HTML entities and strip tags, preserving newlines at block boundaries
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|div|h[1-6]|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- JD fetchers ---

async function fetchLinkedInJD(url: string): Promise<string> {
  const jobId = linkedInJobId(url);
  if (!jobId) return '';

  try {
    const res = await fetch(`${LI_JOB_API}/${jobId}`, { headers: FETCH_HEADERS });
    if (!res.ok) return '';

    const html = await res.text();

    // LinkedIn returns an <article> with a show-more-less__text div for the description
    const descMatch = html.match(
      /<(?:div|section)[^>]*class="[^"]*(?:show-more-less-html__markup|description__text)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section)>/i
    );
    const raw = descMatch?.[1] ?? html;
    return htmlToText(raw).slice(0, 8_000);
  } catch {
    return '';
  }
}

async function fetchPlaywrightJD(url: string): Promise<string> {
  const browser = await createBrowser();
  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await randomDelay(1_500, 2_500);

    const text = await page.evaluate(() => {
      const candidates = [
        '[data-testid="jobDescriptionText"]',
        '#jobDescriptionText',
        '.jobDescriptionContent',
        '[class*="description"]',
        'main article',
        'main',
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el && (el.textContent?.length ?? 0) > 200) {
          return el.textContent?.trim() ?? '';
        }
      }
      return document.body.textContent?.trim() ?? '';
    });

    return text.replace(/\s{3,}/g, '\n\n').trim().slice(0, 8_000);
  } catch {
    return '';
  } finally {
    await browser.close();
  }
}

// Public: fetch the full job description for a matched job.
// Falls back to job.rawJD if the fetch returns too little content.
export async function fetchFullJD(job: Job): Promise<string> {
  const tag = `[ResumeTailor][${job.portal}]`;
  try {
    let jd = '';

    if (job.portal === 'LinkedIn') {
      jd = await fetchLinkedInJD(job.url);
    } else if (job.portal === 'Indeed' || job.portal === 'Bayt') {
      jd = await fetchPlaywrightJD(job.url);
    }

    if (jd.length < 200) {
      console.log(`${tag} JD fetch returned ${jd.length} chars — using rawJD fallback`);
      return job.rawJD;
    }

    console.log(`${tag} Fetched full JD (${jd.length} chars)`);
    return jd;
  } catch (err) {
    console.error(`${tag} fetchFullJD error: ${(err as Error).message}`);
    return job.rawJD;
  }
}

// System prompt kept stable so the cache prefix never changes between calls.
// The resume.md content is appended here — also stable within a session.
// cache_control: ephemeral caches this prefix for 5 min (requires ≥ 4096 tokens
// for Opus 4.7; shorter resumes will skip caching silently but the code is correct).
const SYSTEM_PROMPT_BASE = `\
You are an expert resume tailoring specialist with deep experience in UAE tech hiring.
Your task is to tailor a candidate's resume to a specific job description.

Guidelines:
- Edit ALL sections: Summary, Skills, and every Experience bullet — not just reorder, but rewrite to fit the role
- Mirror the job's language and keywords where they genuinely match the candidate's background
- Never invent skills, titles, or experience the candidate does not have
- Preserve all factual details (dates, company names, metrics)
- Output the complete tailored resume in Markdown — no preamble, no explanation
- Aim for a tight two-page length; trim lower-relevance bullet points if needed
- Put the most relevant experience section first when it helps the fit

Tone and style:
- Write in a natural, human voice — clear and direct, not consultant-speak
- Use specific, concrete action verbs. Never use: architected, engineered, leveraged, utilized, spearheaded, streamlined, orchestrated, synergized, robust, cutting-edge, innovative, dynamic, or similar jargon
- Do not add unnecessary hyphens within sentences or colons where they break reading flow
- Do not use filler phrases like "responsible for", "tasked with", or "helped to"

Formatting:
- Format for ATS parsers: clean section headers, no tables, no columns, standard Markdown only
- Use simple bullet points starting with a verb
- No decorative separators or special characters`;

// Public: call Claude to tailor the resume for a matched job.
// Returns null if the daily cap is reached or the API call fails.
export async function tailorResume(job: Job): Promise<TailoringResult | null> {
  const tag = `[ResumeTailor]`;

  // --- Cost protection 1: daily cap ---
  const callsToday = getAiCallsToday();
  if (callsToday >= config.ai.max_calls_per_day) {
    console.log(
      `${tag} Daily cap of ${config.ai.max_calls_per_day} calls reached — ` +
      `skipping "${job.title}" at ${job.company}`
    );
    return null;
  }

  console.log(
    `${tag} Tailoring for "${job.title}" at ${job.company} ` +
    `(call ${callsToday + 1}/${config.ai.max_calls_per_day})`
  );

  // Fetch full job description
  const fullJD = await fetchFullJD(job);

  // Load resume (cached in memory after first read)
  const resumeText = loadResume();

  // Build the cached system block: instructions + resume (stable across all calls)
  const cachedSystem = `${SYSTEM_PROMPT_BASE}\n\n---\n\n## CANDIDATE RESUME\n\n${resumeText}`;

  // Build the volatile user message: unique per job
  const userMessage = [
    'Tailor the candidate\'s resume for the job below.',
    '',
    `**Job Title:** ${job.title}`,
    `**Company:** ${job.company}`,
    `**Location:** ${job.location}`,
    `**Portal:** ${job.portal}`,
    '',
    '**Job Description:**',
    fullJD,
    '',
    'Output the complete tailored resume in Markdown. Do not include any preamble.',
  ].join('\n');

  // --- Cost protection 2: prompt caching on the stable system + resume prefix ---
  const client = getClient();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: config.ai.max_tokens,
      system: [
        {
          type: 'text',
          text: cachedSystem,
          cache_control: { type: 'ephemeral' }, // caches system + resume prefix
        },
      ],
      messages: [
        {
          role: 'user',
          content: userMessage, // volatile — not cached
        },
      ],
    });
  } catch (err) {
    console.error(`${tag} Claude API error: ${(err as Error).message}`);
    return null;
  }

  // Extract text from response
  const tailoredMarkdown = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const inputTokens  = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cacheRead    = response.usage.cache_read_input_tokens ?? 0;
  const cacheWrite   = response.usage.cache_creation_input_tokens ?? 0;
  const estimatedCostUsd = estimateCost(inputTokens, outputTokens);

  // --- Cost protection 3: log every call for daily cost tracking ---
  recordAiCall(inputTokens, outputTokens, estimatedCostUsd);

  console.log(
    `${tag} Done — in=${inputTokens} out=${outputTokens} ` +
    `cache_read=${cacheRead} cache_write=${cacheWrite} ` +
    `cost=$${estimatedCostUsd.toFixed(4)}`
  );

  return { tailoredMarkdown, inputTokens, outputTokens, estimatedCostUsd };
}

// --- Self-test ---

if (require.main === module) {
  const { initDb, getDailyUsageSummary } = require('./dedup') as typeof import('./dedup');

  (async () => {
    console.log('=== Phase 5 self-test: resumeTailor.ts ===\n');

    initDb();

    const callsToday = getAiCallsToday();
    const summary    = getDailyUsageSummary();
    console.log(`Daily cap:    ${callsToday}/${config.ai.max_calls_per_day} calls used today`);
    console.log(`Daily cost:   $${summary.costUsd.toFixed(4)} (${summary.inputTokens} in / ${summary.outputTokens} out tokens)`);
    console.log(`Model:        ${MODEL}`);
    console.log(`Max tokens:   ${config.ai.max_tokens}`);
    console.log(`Resume path:  ${config.resume_path}\n`);

    // Test 1: LinkedIn JD fetch
    const testLinkedInUrl = 'https://www.linkedin.com/jobs/view/4124882929/';
    console.log(`[Test 1] Fetching LinkedIn JD: ${testLinkedInUrl}`);
    const liJD = await fetchLinkedInJD(testLinkedInUrl);
    console.log(`  → ${liJD.length} chars`);
    if (liJD.length > 0) {
      console.log(`  → Preview: "${liJD.slice(0, 120).replace(/\n/g, ' ')}..."`);
    }

    // Test 2: daily cap guard
    if (callsToday >= config.ai.max_calls_per_day) {
      console.log('\n[Test 2] Daily cap already reached — tailorResume() would return null. ✓');
      process.exit(0);
    }

    // Test 3: skip if API key is a placeholder
    const keyLooksReal = secrets.claudeApiKey.startsWith('sk-ant-');
    if (!keyLooksReal) {
      console.log('\n[Test 2] CLAUDE_API_KEY appears to be a placeholder — skipping live API call.');
      console.log('         Fill in a real key in .env to test the full tailoring pipeline.');
      process.exit(0);
    }

    // Test 4: real tailoring call with a fabricated short job
    const mockJob: Job = {
      id: 'self-test-001',
      title: 'Senior Full Stack Developer',
      company: 'Acme Tech Dubai',
      location: 'Dubai, UAE',
      jobType: 'full-time',
      url: testLinkedInUrl,
      portal: 'LinkedIn',
      rawJD: liJD.length > 200 ? liJD : [
        'We are looking for a Senior Full Stack Developer with 3+ years of experience.',
        'Skills: React, Node.js, TypeScript, PostgreSQL, Docker, Azure.',
        'Responsibilities: Build scalable APIs, develop frontend features, own CI/CD pipelines.',
        'Nice to have: .NET, Redis, Kubernetes.',
      ].join('\n'),
      foundAt: new Date(),
    };

    console.log(`\n[Test 2] Running real tailoring call for mock job "${mockJob.title}" at ${mockJob.company}...`);
    const result = await tailorResume(mockJob);

    if (!result) {
      console.log('  → tailorResume returned null (cap hit or error)');
      process.exit(1);
    }

    console.log('\n=== Result ===');
    console.log(`Input tokens:  ${result.inputTokens}`);
    console.log(`Output tokens: ${result.outputTokens}`);
    console.log(`Est. cost:     $${result.estimatedCostUsd.toFixed(4)}`);
    console.log('\nTailored resume (first 600 chars):');
    console.log(result.tailoredMarkdown.slice(0, 600));
    console.log('\nAll tests passed.');
    process.exit(0);
  })().catch(err => {
    console.error('Self-test failed:', err.message);
    process.exit(1);
  });
}
