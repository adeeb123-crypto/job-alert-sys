import { Job } from '../types';
import { scrapeLinkedIn } from './linkedin';
import { scrapeJooble } from './jooble';
import { scrapeNaukriGulf } from './naukrigulf';
import { scrapeGulfTalent } from './gulftalent';
import { scrapeCompanyPages } from './companyScraper';

export { scrapeLinkedIn } from './linkedin';
export { scrapeJooble } from './jooble';
export { scrapeNaukriGulf } from './naukrigulf';
export { scrapeGulfTalent } from './gulftalent';
export { scrapeCompanyPages } from './companyScraper';
// Kept for future scraping engine work — not active in pipeline
export { scrapeIndeed } from './indeed';
export { scrapebayt } from './bayt';

export async function runAllScrapers(): Promise<Job[]> {
  console.log(`[${new Date().toISOString()}] Running all scrapers...`);

  const results = await Promise.allSettled([
    scrapeLinkedIn(),
    scrapeJooble(),
    scrapeNaukriGulf(),
    scrapeGulfTalent(),
  ]);

  const labels = ['LinkedIn', 'Jooble', 'NaukriGulf', 'GulfTalent'];
  const raw: Job[] = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`[${new Date().toISOString()}] [${labels[i]}] → ${result.value.length} jobs`);
      raw.push(...result.value);
    } else {
      console.error(
        `[${new Date().toISOString()}] [${labels[i]}] FAILED: ${result.reason?.message ?? result.reason}`
      );
    }
  });

  // Cross-portal dedup: keep the first portal that found a given job fingerprint
  const seen = new Set<string>();
  const unique: Job[] = [];
  for (const job of raw) {
    if (!seen.has(job.id)) {
      seen.add(job.id);
      unique.push(job);
    }
  }

  console.log(
    `[${new Date().toISOString()}] Scrapers done — ${raw.length} total, ${unique.length} unique across portals`
  );

  return unique;
}
