import { Job, Config } from './types';

const UAE_LOCATIONS = ['dubai', 'abu dhabi', 'sharjah', 'uae', 'united arab emirates', 'remote (uae)'];

// Maps seniority words to approximate year ranges for comparison
const SENIORITY_MAP: Record<string, { min: number; max: number }> = {
  'entry level': { min: 0, max: 2 },
  'entry-level': { min: 0, max: 2 },
  junior: { min: 0, max: 2 },
  'mid-level': { min: 2, max: 5 },
  mid: { min: 2, max: 5 },
  'mid level': { min: 2, max: 5 },
  senior: { min: 5, max: 20 },
  lead: { min: 5, max: 20 },
  principal: { min: 8, max: 20 },
  staff: { min: 6, max: 20 },
};

/**
 * Parses the JD text for year experience signals.
 * Returns { min, max } if found, or null if the JD gives no seniority signal.
 */
function parseSeniorityFromJD(text: string): { min: number; max: number } | null {
  const lower = text.toLowerCase();

  // Check seniority words first
  for (const [word, range] of Object.entries(SENIORITY_MAP)) {
    if (lower.includes(word)) return range;
  }

  // "X-Y years" or "X to Y years"
  const rangeMatch = lower.match(/(\d+)\s*[-–to]+\s*(\d+)\s*\+?\s*years?/);
  if (rangeMatch) {
    return { min: parseInt(rangeMatch[1], 10), max: parseInt(rangeMatch[2], 10) };
  }

  // "X+ years" or "minimum X years" or "at least X years"
  const minMatch = lower.match(/(?:minimum|at least|(\d+)\+)\s*(\d+)?\s*years?/);
  if (minMatch) {
    const years = parseInt(minMatch[1] ?? minMatch[2] ?? '0', 10);
    return { min: years, max: 99 };
  }

  // "X years" standalone
  const singleMatch = lower.match(/(\d+)\s*years?\s*(?:of\s+)?(?:experience|exp)/);
  if (singleMatch) {
    const years = parseInt(singleMatch[1], 10);
    return { min: years, max: years + 2 };
  }

  return null; // ambiguous — caller should let it through
}

// Core tech words extracted from keywords — used for single-word fallback matching
// so titles like "Software Development Engineer" or "Backend Node.js Engineer" still pass
const KEYWORD_TOKENS = [
  'software', 'backend', 'fullstack', 'full stack', 'full-stack',
  'node', 'nodejs', 'node.js', 'developer', 'engineer',
];

function matchesKeyword(job: Job, keywords: string[]): boolean {
  const searchText = `${job.title} ${job.rawJD.slice(0, 500)}`.toLowerCase();

  // Exact phrase match first
  if (keywords.some(kw => searchText.includes(kw.toLowerCase()))) return true;

  // Fallback: title contains at least two core tech tokens
  // Catches "Software Development Engineer", "Backend Node.js Engineer", etc.
  const titleLower = job.title.toLowerCase();
  const tokenHits = KEYWORD_TOKENS.filter(t => titleLower.includes(t));
  return tokenHits.length >= 2;
}

function matchesLocation(job: Job, configLocation: string): boolean {
  const loc = job.location.toLowerCase();
  const title = job.title.toLowerCase();
  const jd = job.rawJD.slice(0, 300).toLowerCase();
  const combined = `${loc} ${title} ${jd}`;
  return UAE_LOCATIONS.some(uaeLoc => combined.includes(uaeLoc));
}

function matchesJobType(job: Job, allowedTypes: string[]): boolean {
  if (!job.jobType) return true; // unknown type — let it through
  const jt = job.jobType.toLowerCase();
  return allowedTypes.some(t => jt.includes(t.toLowerCase()));
}

function matchesSeniority(
  job: Job,
  seniority: { min_years: number; max_years: number }
): boolean {
  const parsed = parseSeniorityFromJD(job.rawJD);

  // Spec: if ambiguous or not mentioned, let it through
  if (!parsed) return true;

  // Passes if ranges overlap at all
  return parsed.max >= seniority.min_years && parsed.min <= seniority.max_years;
}

export function filterJobs(jobs: Job[], config: Config): Job[] {
  const results: Job[] = [];

  for (const job of jobs) {
    const reasons: string[] = [];

    if (!matchesKeyword(job, config.keywords)) {
      reasons.push('keyword');
    }
    if (!matchesLocation(job, config.location)) {
      reasons.push('location');
    }
    if (!matchesJobType(job, config.job_types)) {
      reasons.push('jobType');
    }
    if (!matchesSeniority(job, config.seniority)) {
      reasons.push('seniority');
    }

    if (reasons.length === 0) {
      results.push(job);
    } else {
      console.log(
        `[${new Date().toISOString()}] [Filter] SKIP "${job.title}" @ ${job.company} — failed: ${reasons.join(', ')}`
      );
    }
  }

  return results;
}

// Export the seniority parser so jdParser.ts can reuse it in Phase 5
export { parseSeniorityFromJD };
