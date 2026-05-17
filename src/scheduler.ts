import { runAllScrapers } from './scrapers';
import { searchWebJobs } from './scrapers/websearch';
import { filterJobs } from './filter';
import { config } from './config';
import {
  initDb,
  isDuplicate,
  markSeen,
  purgeOld,
  purgeOldWebLeads,
} from './dedup';
import { tailorResume } from './resumeTailor';
import { notifyJob, notifyWebLead } from './notifier';

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── Portal scrape cycle (runs every poll_interval_minutes) ───────────────────

export async function runCycle(): Promise<void> {
  log('── Portal poll cycle started ───────────────────────');

  const allJobs = await runAllScrapers();
  log(`Scraped ${allJobs.length} unique jobs across all portals`);

  const filtered = filterJobs(allJobs, config);
  log(`After filtering: ${filtered.length} job(s) match your criteria`);

  // Newest first — LinkedIn has real posting timestamps; Indeed/Bayt use scrape time
  filtered.sort((a, b) => b.foundAt.getTime() - a.foundAt.getTime());

  let newCount = 0;
  for (const job of filtered) {
    if (isDuplicate(job.id)) {
      log(`[Dedup] Already seen: "${job.title}" @ ${job.company} — skipping`);
      continue;
    }

    markSeen(job.id, job.portal);
    newCount++;
    log(`[NEW] ${job.portal} | ${job.title} @ ${job.company} (${job.location})`);

    // Tailor resume then notify — errors are caught per-job so one failure
    // doesn't block the rest of the batch
    try {
      const result = await tailorResume(job);
      if (result) {
        log(`[AI] Tailored resume — ${result.inputTokens} in / ${result.outputTokens} out / $${result.estimatedCostUsd.toFixed(4)}`);
      } else {
        log('[AI] Tailoring skipped (daily cap reached or API key not set)');
      }
      await notifyJob(job, result);
    } catch (err) {
      log(`[ERROR] Failed to tailor/notify for "${job.title}": ${(err as Error).message}`);
    }
  }

  log(`── Portal cycle done — ${newCount} new job(s) processed ──`);
}

// ─── Web search cycle (runs every 30 min) ────────────────────────────────────

export async function runWebSearchCycle(): Promise<void> {
  log('── Web search cycle started ────────────────────────');

  try {
    const leads = await searchWebJobs();
    log(`Web search found ${leads.length} new lead(s)`);

    for (const lead of leads) {
      try {
        await notifyWebLead(lead);
      } catch (err) {
        log(`[ERROR] Failed to notify web lead "${lead.title}": ${(err as Error).message}`);
      }
    }
  } catch (err) {
    log(`[ERROR] Web search cycle failed: ${(err as Error).message}`);
  }

  log('── Web search cycle done ───────────────────────────');
}

// ─── Daily maintenance ────────────────────────────────────────────────────────

export function runDailyMaintenance(): void {
  log('[Maintenance] Purging old seen-jobs and web leads...');
  purgeOld();
  purgeOldWebLeads();
  log('[Maintenance] Purge complete');
}

// ─── Inline test: single portal cycle ────────────────────────────────────────

if (require.main === module) {
  initDb();
  runCycle().catch(err => {
    console.error(`[${new Date().toISOString()}] Fatal error in cycle:`, err);
    process.exit(1);
  });
}
