import { Job } from '../types';
import { generateFingerprint } from '../dedup';
import { config } from '../config';
import { createBrowser, createStealthContext, randomDelay } from './browser';

// ─── Curated UAE tech company career pages ────────────────────────────────────
// Source: NaukriGulf IT companies in UAE (topCompanyInLocAndInd endpoint)

interface CompanyPage {
  name: string;
  url: string;
}

const UAE_TECH_COMPANIES: CompanyPage[] = [
  { name: 'Accenture Middle East',        url: 'https://www.accenture.com/ae-en/careers/jobsearch' },
  { name: 'Alpha Data',                   url: 'https://www.alphadata.ae/careers/' },
  { name: 'Astrolabs',                    url: 'https://astrolabs.com/jobs' },
  { name: 'Azdan',                        url: 'https://azdan.com/careers/' },
  { name: 'Bosch Middle East',            url: 'https://www.bosch.ae/careers/' },
  { name: 'Careem',                       url: 'https://careers.careem.com/' },
  { name: 'Carma',                        url: 'https://www.carma.ai/careers' },
  { name: 'Codebase Technologies',        url: 'https://www.codebasetechnologies.com/careers' },
  { name: 'Dicetek',                      url: 'https://dicetek.com/career/' },
  { name: 'Eastnets',                     url: 'https://www.eastnets.com/about-us/careers/' },
  { name: 'Emaratech',                    url: 'https://emaratech.net/careers/' },
  { name: 'FACTS Computer Software',      url: 'https://www.factsgroup.ae/careers/' },
  { name: 'Fluid Codes',                  url: 'https://fluidcodes.com/careers' },
  { name: 'Grubtech',                     url: 'https://grubtech.com/careers/' },
  { name: 'Intertec Systems',             url: 'https://www.intertec.ae/careers' },
  { name: 'Lean Technologies',            url: 'https://lean.sa/careers/' },
  { name: 'Mondia Group',                 url: 'https://www.mondiagroup.com/careers' },
  { name: 'Oracle UAE',                   url: 'https://www.oracle.com/ae/careers/' },
  { name: 'Raqmiyat',                     url: 'https://www.raqmiyat.com/careers' },
  { name: 'Sapient (Publicis)',           url: 'https://www.publicissapient.com/careers' },
  { name: 'TenTwenty',                    url: 'https://tentwenty.me/careers' },
  { name: 'UDrive',                       url: 'https://udrive.ae/careers' },
  { name: 'ZainTech',                     url: 'https://www.zaintech.com/careers/' },
  { name: 'Al Reyami Group',             url: 'https://www.alreyami.com/careers' },
  { name: 'Newage Software',             url: 'https://www.newagesoft.com/careers' },
  { name: 'Aspire',                       url: 'https://aspirezone.qa/careers' },
];

// ─── Keyword matching ─────────────────────────────────────────────────────────

const KW_RE = new RegExp(
  config.keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i'
);

// ─── Generic job listing extractor ───────────────────────────────────────────
// Tries common career page patterns across different company sites

async function extractJobs(
  page: import('playwright').Page,
  company: CompanyPage,
): Promise<Array<{ title: string; url: string }>> {
  return page.evaluate((kwPattern: string) => {
    const re = new RegExp(kwPattern, 'i');
    const found: Array<{ title: string; url: string }> = [];
    const seen = new Set<string>();

    // Most career pages use anchor tags for job listings
    document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
      const title = a.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      const href = a.href;

      if (!title || title.length < 5 || title.length > 120) return;
      if (!href || href === window.location.href) return;
      if (!re.test(title)) return;
      if (seen.has(href)) return;

      seen.add(href);
      found.push({ title, url: href });
    });

    return found;
  }, KW_RE.source);
}

// ─── Main scraper ─────────────────────────────────────────────────────────────

export async function scrapeCompanyPages(): Promise<Job[]> {
  const tag = `[${new Date().toISOString()}] [CompanyScraper]`;
  const browser = await createBrowser();
  const allJobs: Job[] = [];

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    for (const company of UAE_TECH_COMPANIES) {
      try {
        console.log(`${tag} Checking ${company.name}...`);
        await page.goto(company.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await randomDelay(1500, 2500);

        const listings = await extractJobs(page, company);

        if (listings.length === 0) {
          console.log(`${tag} ${company.name} — no keyword matches`);
        } else {
          console.log(`${tag} ${company.name} — ${listings.length} match(es)`);
        }

        for (const l of listings) {
          allJobs.push({
            id: generateFingerprint(company.name, l.title, 'UAE'),
            title: l.title,
            company: company.name,
            location: 'UAE',
            jobType: 'full-time',
            url: l.url,
            portal: 'CompanyPage',
            rawJD: `${l.title} at ${company.name} in UAE.`,
            foundAt: new Date(),
          });
        }
      } catch (err) {
        console.warn(`${tag} ${company.name} — skipped: ${(err as Error).message.slice(0, 80)}`);
      }

      await randomDelay(1000, 2000);
    }

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(`${tag} Done — ${allJobs.length} job(s) found across ${UAE_TECH_COMPANIES.length} companies`);
  return allJobs;
}

// ─── Self-test ────────────────────────────────────────────────────────────────

if (require.main === module) {
  const { initDb } = require('../dedup') as { initDb: () => void };
  initDb();

  console.log(`\n=== CompanyScraper self-test (${UAE_TECH_COMPANIES.length} companies) ===\n`);

  scrapeCompanyPages().then(jobs => {
    console.log(`\n=== ${jobs.length} job(s) found ===`);
    jobs.slice(0, 10).forEach((j, i) =>
      console.log(`  ${i + 1}. ${j.title} @ ${j.company}\n     ${j.url}`)
    );
    process.exit(0);
  }).catch(err => {
    console.error('Self-test failed:', err);
    process.exit(1);
  });
}
