import { Job } from '../types';
import { generateFingerprint } from '../dedup';
import { config } from '../config';

// LinkedIn's public guest jobs API — no auth needed, returns HTML job cards
const GUEST_API = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const GEO_ID_UAE = '104305776';

// f_TPR=r86400 → jobs posted in the last 24 hours
// sortBy=DD    → date descending (newest first)
// Dedup prevents re-alerting on already-seen jobs across poll cycles
const TIME_FILTER = 'r86400';
const SORT_BY_DATE = 'DD';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

interface RawCard {
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt: string;
}

function parseJobCards(html: string): RawCard[] {
  const cards: RawCard[] = [];

  // Each job is wrapped in an <li>...</li> block
  const liPattern = /<li>([\s\S]*?)<\/li>/g;
  let match: RegExpExecArray | null;

  while ((match = liPattern.exec(html)) !== null) {
    const li = match[1];

    const titleMatch = li.match(/class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/);
    const title = titleMatch?.[1]?.replace(/<[^>]*>/g, '').trim() ?? '';

    const companyMatch = li.match(/class="base-search-card__subtitle"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const company = companyMatch?.[1]?.replace(/<[^>]*>/g, '').trim() ?? 'Unknown';

    const locationMatch = li.match(/class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>/);
    const location = locationMatch?.[1]?.replace(/<[^>]*>/g, '').trim() ?? config.location;

    // href on the full-link anchor, with HTML entities decoded
    const urlMatch = li.match(/class="base-card__full-link[^"]*"[^>]*href="([^"]+)"/);
    const url = (urlMatch?.[1] ?? '').replace(/&amp;/g, '&');

    const dateMatch = li.match(/datetime="([^"]+)"/);
    const postedAt = dateMatch?.[1] ?? '';

    if (title && url) {
      cards.push({ title, company, location, url, postedAt });
    }
  }

  return cards;
}

async function fetchPage(keyword: string, start: number): Promise<RawCard[]> {
  const params = new URLSearchParams({
    keywords: keyword,
    location: 'United Arab Emirates',
    geoId: GEO_ID_UAE,
    sortBy: SORT_BY_DATE,
    f_TPR: TIME_FILTER,
    start: String(start),
  });

  const res = await fetch(`${GUEST_API}?${params}`, { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for keyword "${keyword}" start=${start}`);
  }

  const html = await res.text();
  return parseJobCards(html);
}

export async function scrapeLinkedIn(): Promise<Job[]> {
  const jobs: Job[] = [];

  for (const keyword of config.keywords) {
    try {
      console.log(`[${new Date().toISOString()}] [LinkedIn] Fetching "${keyword}"...`);

      // Fetch first page only — 25 most recent jobs per keyword
      const cards = await fetchPage(keyword, 0);

      for (const card of cards) {
        jobs.push({
          id: generateFingerprint(card.company, card.title, card.location),
          title: card.title,
          company: card.company,
          location: card.location,
          jobType: 'full-time',
          url: card.url,
          portal: 'LinkedIn',
          // rawJD will be populated when we visit the job page in Phase 5
          rawJD: `${card.title} ${card.company} ${card.location}`,
          foundAt: card.postedAt ? new Date(card.postedAt) : new Date(),
        });
      }

      console.log(
        `[${new Date().toISOString()}] [LinkedIn] "${keyword}" → ${cards.length} listings`
      );

      // Polite delay between keywords to avoid rate limiting
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] [LinkedIn] Error for "${keyword}": ${(err as Error).message}`
      );
    }
  }

  return jobs;
}
