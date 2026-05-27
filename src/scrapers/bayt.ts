import { Job } from '../types';
import { generateFingerprint } from '../dedup';
import { config } from '../config';
import { createBrowser, createStealthContext, randomDelay, homepageFirst } from '../antidetect/stealthBrowser';

function buildSearchUrl(keyword: string): string {
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `https://www.bayt.com/en/uae/jobs/${slug}-jobs/`;
}

async function passCloudflareChallenge(page: import('playwright').Page, tag: string): Promise<void> {
  // Wait up to 12s for "Just a moment..." to auto-complete and redirect
  const title = await page.title();
  if (!title.toLowerCase().includes('just a moment') && !title.toLowerCase().includes('checking')) return;

  console.log(`${tag} Cloudflare challenge detected — waiting for it to complete...`);
  try {
    await page.waitForFunction(
      () => !document.title.toLowerCase().includes('just a moment') && !document.title.toLowerCase().includes('checking'),
      { timeout: 15000 }
    );
    await randomDelay(1000, 2000);
    console.log(`${tag} Cloudflare challenge passed (title: "${await page.title()}")`);
  } catch {
    console.log(`${tag} Cloudflare challenge did not complete in time`);
  }
}

export async function scrapebayt(): Promise<Job[]> {
  const tag = `[${new Date().toISOString()}] [Bayt]`;
  const browser = await createBrowser('www.bayt.com');
  const allJobs: Job[] = [];

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();
    await homepageFirst(page, 'www.bayt.com');
    await passCloudflareChallenge(page, tag);

    for (const keyword of config.keywords) {
      const url = buildSearchUrl(keyword);
      console.log(`${tag} Fetching "${keyword}"...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await passCloudflareChallenge(page, tag);
      await randomDelay(2000, 3000);

      const hasJobs = await page
        .waitForSelector('#results_list, [data-js-job], .has-pointer-d li', { timeout: 15000 })
        .then(() => true)
        .catch(() => false);

      if (!hasJobs) {
        const title = await page.title();
        console.log(`${tag} "${keyword}" — job list not found (page: "${title}")`);
        continue;
      }

      const cards = await page.evaluate(() => {
        const results: Array<{
          title: string;
          company: string;
          location: string;
          url: string;
          snippet: string;
          postedText: string;
        }> = [];

        const cardEls = document.querySelectorAll(
          'li[data-js-job], #results_list > li, .has-pointer-d > li'
        );

        cardEls.forEach((card: Element) => {
          const titleEl =
            card.querySelector('h2.jb-title a') ??
            card.querySelector('h2 a') ??
            card.querySelector('[class*="title"] a') ??
            card.querySelector('a[href*="/job/"]');
          const title = titleEl?.textContent?.trim() ?? '';
          const href = (titleEl as HTMLAnchorElement | null)?.href ?? '';
          const url = href.startsWith('http') ? href : `https://www.bayt.com${href}`;

          const companyEl =
            card.querySelector('[data-automation="job-item-company-name"]') ??
            card.querySelector('.t-muted a') ??
            card.querySelector('[class*="company"]');
          const company = companyEl?.textContent?.trim() ?? 'Unknown';

          const locationEl =
            card.querySelector('[data-automation="job-location"]') ??
            card.querySelector('[class*="location"]') ??
            card.querySelector('.t-muted span');
          const location = locationEl?.textContent?.trim() ?? 'UAE';

          const snippetEl =
            card.querySelector('.jb-descr') ??
            card.querySelector('[class*="description"], [class*="snippet"]');
          const snippet = snippetEl?.textContent?.trim().slice(0, 300) ?? '';

          // Grab any text that looks like a posting date
          const dateEl =
            card.querySelector('time') ??
            card.querySelector('[class*="date"]') ??
            card.querySelector('[class*="post"]');
          const postedText = dateEl?.textContent?.trim().toLowerCase() ?? '';

          if (title && url) {
            results.push({ title, company, location, url, snippet, postedText });
          }
        });

        return results;
      });

      // Keep only jobs posted today or within the last 24 hours.
      // Bayt shows strings like "Today", "2 hours ago", "1 day ago", "3 days ago", "30+ days".
      // Drop anything with N > 1 before "day" and anything with "week"/"month"/"year".
      const fresh = cards.filter(c => {
        const t = c.postedText;
        if (!t) return true; // no date info — let it through, dedup handles repeats
        if (/week|month|year/.test(t)) return false;
        const daysMatch = t.match(/(\d+)\s*day/);
        if (daysMatch && parseInt(daysMatch[1], 10) > 1) return false;
        return true;
      });

      console.log(`${tag} "${keyword}" → ${cards.length} card(s), ${fresh.length} fresh (≤24h)`);

      for (const c of fresh) {
        allJobs.push({
          id: generateFingerprint(c.company, c.title, c.location),
          title: c.title,
          company: c.company,
          location: c.location,
          jobType: 'full-time',
          url: c.url,
          portal: 'Bayt',
          rawJD: `${c.title} at ${c.company} in ${c.location}. ${c.snippet}`.trim(),
          foundAt: new Date(),
        });
      }

      await randomDelay(1500, 2500);
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
  scrapebayt().then(jobs => {
    console.log(`\n=== Bayt self-test: ${jobs.length} jobs ===`);
    jobs.slice(0, 5).forEach((j, i) =>
      console.log(`  ${i + 1}. ${j.title} @ ${j.company} | ${j.location}`)
    );
    if (jobs.length === 0) console.log('  (0 results — check logs above for reason)');
    process.exit(0);
  });
}
