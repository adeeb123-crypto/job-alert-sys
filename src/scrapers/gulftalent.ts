import { Job } from '../types';

/**
 * GulfTalent is protected by Akamai's bot manager and uses pure AngularJS client-side rendering.
 * All Playwright requests receive "Access Denied" from Akamai regardless of URL.
 * The plain HTML shell contains only empty ng-bind templates — no server-rendered job data.
 *
 * This scraper returns [] so the pipeline runs without errors.
 * Future mitigation: a residential proxy service (e.g. Bright Data) can bypass Akamai.
 */
export async function scrapeGulfTalent(): Promise<Job[]> {
  console.log(
    `[${new Date().toISOString()}] [GulfTalent] Skipped — Akamai bot protection blocks headless browsers`
  );
  return [];
}
