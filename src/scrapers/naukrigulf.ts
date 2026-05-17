import { Job } from '../types';

/**
 * NaukriGulf is protected by PerimeterX bot detection.
 * When a headless browser loads naukrigulf.com, PerimeterX injects a JS challenge
 * that detects the automation environment and silently blocks all page JS from running.
 * The plain HTML shell loads but no job data is ever rendered.
 * No public RSS feed or JSON API is available.
 *
 * This scraper returns [] so the pipeline runs without errors.
 * Future mitigation: a residential proxy service (e.g. Bright Data) can bypass PerimeterX.
 */
export async function scrapeNaukriGulf(): Promise<Job[]> {
  console.log(
    `[${new Date().toISOString()}] [NaukriGulf] Skipped — PerimeterX bot protection blocks headless browsers`
  );
  return [];
}
