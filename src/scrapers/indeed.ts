import { Job } from '../types';
import { generateFingerprint } from '../dedup';
import { config } from '../config';
import { createBrowser, createStealthContext, randomDelay } from './browser';

function buildSearchUrl(): string {
  // Single OR query across all keywords — avoids triggering Cloudflare on per-keyword loops
  const q = config.keywords.map(k => `"${k}"`).join(' OR ');
  const params = new URLSearchParams({
    q,
    l: 'United Arab Emirates',
    sort: 'date',
    fromage: '1',
  });
  return `https://ae.indeed.com/jobs?${params}`;
}

export async function scrapeIndeed(): Promise<Job[]> {
  const tag = `[${new Date().toISOString()}] [Indeed]`;
  const browser = await createBrowser();
  const allJobs: Job[] = [];

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    console.log(`${tag} Fetching all keywords (combined OR query)...`);
    await page.goto(buildSearchUrl(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 4000);

    const hasJobs = await page
      .waitForSelector('a.jcs-JobTitle[data-jk], td.resultContent', { timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (!hasJobs) {
      const title = await page.title();
      console.log(`${tag} Job cards not found (page: "${title}")`);
    } else {
      const cards = await page.evaluate(() => {
        const results: Array<{
          title: string;
          company: string;
          location: string;
          url: string;
          snippet: string;
        }> = [];

        const titleLinks = document.querySelectorAll<HTMLAnchorElement>('a.jcs-JobTitle[data-jk]');

        titleLinks.forEach(link => {
          const jk = link.getAttribute('data-jk') ?? '';
          if (!jk) return;

          const title = link.textContent?.trim() ?? '';
          const url = `https://ae.indeed.com/viewjob?jk=${jk}`;

          let container: Element | null = link;
          for (let i = 0; i < 8; i++) {
            container = container?.parentElement ?? null;
            if (container?.tagName === 'TD' || container?.classList.contains('resultContent')) break;
          }

          const companyEl =
            container?.querySelector('[data-testid="company-name"]') ??
            container?.querySelector('.companyName') ??
            container?.querySelector('[class*="companyName"]');
          const company = companyEl?.textContent?.trim() ?? 'Unknown';

          const locationEl =
            container?.querySelector('[data-testid="text-location"]') ??
            container?.querySelector('.companyLocation') ??
            container?.querySelector('[class*="location"]');
          const location = locationEl?.textContent?.trim() ?? 'UAE';

          const snippetEl =
            container?.querySelector('.job-snippet') ??
            container?.querySelector('[class*="snippet"]') ??
            container?.querySelector('[class*="Snippet"]');
          const snippet = snippetEl?.textContent?.trim().slice(0, 300) ?? '';

          if (title) {
            results.push({ title, company, location, url, snippet });
          }
        });

        return results;
      });

      console.log(`${tag} ${cards.length} job card(s) found`);

      for (const c of cards) {
        allJobs.push({
          id: generateFingerprint(c.company, c.title, c.location),
          title: c.title,
          company: c.company,
          location: c.location,
          jobType: 'full-time',
          url: c.url,
          portal: 'Indeed',
          rawJD: `${c.title} at ${c.company} in ${c.location}. ${c.snippet}`.trim(),
          foundAt: new Date(),
        });
      }
    }
  } catch (err) {
    console.error(`${tag} Error: ${(err as Error).message}`);
  } finally {
    await browser.close();
  }

  return allJobs;
}

// Self-test
if (require.main === module) {
  scrapeIndeed().then(jobs => {
    console.log(`\n=== Indeed self-test: ${jobs.length} jobs ===`);
    jobs.slice(0, 5).forEach((j, i) =>
      console.log(`  ${i + 1}. ${j.title} @ ${j.company} | ${j.location} | ${j.url.slice(0, 70)}`)
    );
    if (jobs.length === 0) console.log('  (0 results — check logs above for reason)');
    process.exit(0);
  });
}
