import * as https from 'https';
import { Job } from '../types';
import { generateFingerprint } from '../dedup';
import { config, secrets } from '../config';

interface JoobleJob {
  title?: string;
  company?: string;
  location?: string;
  link?: string;
  snippet?: string;
  updated?: string;
}

interface JoobleResponse {
  totalCount: number;
  jobs: JoobleJob[];
}

function postJson(apiKey: string, body: object): Promise<JoobleResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options: https.RequestOptions = {
      hostname: 'jooble.org',
      path: `/api/${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 15000,
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Jooble API returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data) as JoobleResponse);
        } catch {
          reject(new Error(`Jooble response is not valid JSON: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Jooble request timed out after 15s'));
    });
    req.write(payload);
    req.end();
  });
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

export async function scrapeJooble(): Promise<Job[]> {
  const tag = `[${new Date().toISOString()}] [Jooble]`;
  const seenLinks = new Set<string>();
  const allJobs: Job[] = [];

  for (const keyword of config.keywords) {
    try {
      console.log(`${tag} Fetching "${keyword}"...`);

      const response = await postJson(secrets.joobleApiKey, {
        keywords: keyword,
        location: 'United Arab Emirates',
        datecreated: 'day',
      });

      const jobs = response.jobs ?? [];
      console.log(`${tag} "${keyword}" → ${jobs.length} result(s)`);

      for (const j of jobs) {
        const link = j.link?.trim();
        if (!link || seenLinks.has(link)) continue;
        seenLinks.add(link);

        const title = j.title?.trim() ?? '';
        const company = j.company?.trim() || 'Unknown';
        const location = j.location?.trim() || 'UAE';

        if (!title) continue;

        allJobs.push({
          id: generateFingerprint(company, title, location),
          title,
          company,
          location,
          jobType: 'full-time',
          url: link,
          portal: 'Jooble',
          rawJD: `${title} at ${company} in ${location}. ${(j.snippet ?? '').trim()}`.trim(),
          foundAt: new Date(),
        });
      }
    } catch (err) {
      console.error(`${tag} "${keyword}" failed: ${(err as Error).message}`);
    }

    await randomDelay(500, 1500);
  }

  console.log(`${tag} Total: ${allJobs.length} unique job(s) across all keywords`);
  return allJobs;
}

// Self-test
if (require.main === module) {
  scrapeJooble().then(jobs => {
    console.log(`\n=== Jooble self-test: ${jobs.length} jobs ===`);
    jobs.slice(0, 5).forEach((j, i) =>
      console.log(`  ${i + 1}. ${j.title} @ ${j.company} | ${j.location} | ${j.url.slice(0, 70)}`)
    );
    if (jobs.length === 0) console.log('  (0 results — check API key and logs above)');
    process.exit(0);
  }).catch(err => {
    console.error('Jooble self-test error:', err);
    process.exit(1);
  });
}
