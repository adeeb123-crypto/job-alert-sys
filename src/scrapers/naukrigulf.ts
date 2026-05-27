import { Job } from '../types';
import { generateFingerprint } from '../dedup';
import { config } from '../config';
import { createBrowser, createStealthContext, randomDelay, homepageFirst } from '../antidetect/stealthBrowser';

function buildSearchUrl(keyword: string): string {
  const q = encodeURIComponent(keyword);
  return `https://www.naukrigulf.com/jobs-in-uae?title=${q}&location=uae`;
}

export async function scrapeNaukriGulf(): Promise<Job[]> {
  const tag = `[${new Date().toISOString()}] [NaukriGulf]`;
  const browser = await createBrowser('www.naukrigulf.com');
  const allJobs: Job[] = [];

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    await homepageFirst(page, 'www.naukrigulf.com');

    // Limit to 3 keywords to reduce detection surface
    for (const keyword of config.keywords.slice(0, 3)) {
      const url = buildSearchUrl(keyword);
      console.log(`${tag} Fetching "${keyword}"...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await randomDelay(3000, 6000);

      const hasJobs = await page
        .waitForSelector(
          '[class*="jobTuple"], [class*="job-card"], article[data-job-id], [class*="srp-jobtuple"]',
          { timeout: 15000 }
        )
        .then(() => true)
        .catch(() => false);

      if (!hasJobs) {
        const title = await page.title();
        console.log(`${tag} "${keyword}" — job cards not found (page: "${title}")`);
        continue;
      }

      const cards = await page.evaluate(() => {
        const results: Array<{
          title: string;
          company: string;
          location: string;
          url: string;
          snippet: string;
        }> = [];

        const cardEls = document.querySelectorAll(
          '[class*="jobTuple"], [class*="job-card"], article[data-job-id], [class*="srp-jobtuple"]'
        );

        cardEls.forEach((card: Element) => {
          const titleEl =
            card.querySelector('[class*="title"] a') ??
            card.querySelector('h3 a') ??
            card.querySelector('h2 a');
          const title = titleEl?.textContent?.trim() ?? '';
          const href = (titleEl as HTMLAnchorElement | null)?.href ?? '';
          const url = href.startsWith('http') ? href : `https://www.naukrigulf.com${href}`;

          const company =
            card.querySelector('[class*="company"], [class*="org-name"]')?.textContent?.trim() ?? 'Unknown';
          const location =
            card.querySelector('[class*="location"], [class*="loc"]')?.textContent?.trim() ?? 'UAE';
          const snippet =
            card.querySelector('[class*="desc"], [class*="summary"]')?.textContent?.trim().slice(0, 300) ?? '';

          if (title && url && !url.endsWith('naukrigulf.com')) {
            results.push({ title, company, location, url, snippet });
          }
        });

        return results;
      });

      console.log(`${tag} "${keyword}" → ${cards.length} job(s) found`);

      for (const c of cards) {
        allJobs.push({
          id: generateFingerprint(c.company, c.title, c.location),
          title: c.title,
          company: c.company,
          location: c.location,
          jobType: 'full-time',
          url: c.url,
          portal: 'NaukriGulf',
          rawJD: `${c.title} at ${c.company} in ${c.location}. ${c.snippet}`.trim(),
          foundAt: new Date(),
        });
      }

      await randomDelay(2000, 4000);
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
  scrapeNaukriGulf().then(jobs => {
    console.log(`\n=== NaukriGulf self-test: ${jobs.length} jobs ===`);
    jobs.slice(0, 5).forEach((j, i) =>
      console.log(`  ${i + 1}. ${j.title} @ ${j.company} | ${j.location}`)
    );
    if (jobs.length === 0) {
      console.log('  (0 results — PerimeterX may still be blocking even with residential proxy)');
    }
    process.exit(0);
  });
}
