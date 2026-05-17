import cron from 'node-cron';
import { config, secrets } from './config';
import { initDb } from './dedup';
import { runCycle, runWebSearchCycle, runDailyMaintenance } from './scheduler';

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main(): Promise<void> {
  log('=== UAE Job Alert System starting ===');
  log(`Keywords         : ${config.keywords.join(', ')}`);
  log(`Poll interval    : every ${config.poll_interval_minutes} minute(s)`);
  log(`AI daily cap     : ${config.ai.max_calls_per_day} calls/day, max ${config.ai.max_tokens} tokens/call`);
  log(`Seniority range  : ${config.seniority.min_years}–${config.seniority.max_years} years`);
  log(`Telegram chatId  : ${config.notifications.telegram.chat_id}`);
  log(`Telegram token   : ${secrets.telegramBotToken !== 'placeholder' ? 'configured' : 'PLACEHOLDER'}`);
  log(`Claude API key   : ${secrets.claudeApiKey !== 'placeholder' ? 'configured' : 'PLACEHOLDER'}`);
  log(`SMTP             : ${secrets.smtpUser !== 'placeholder' ? secrets.smtpUser : 'PLACEHOLDER'}`);

  initDb();
  log('Database initialised');

  // Run immediately on startup so we don't wait for the first cron tick
  log('Running initial portal poll...');
  await runCycle();

  // ── Portal scrape: every N minutes (from config) ──────────────────────────
  const portalExpr = `*/${config.poll_interval_minutes} * * * *`;
  cron.schedule(portalExpr, async () => {
    try {
      await runCycle();
    } catch (err) {
      log(`[ERROR] Portal cycle crashed: ${(err as Error).message}`);
    }
  });
  log(`Portal scraper scheduled: ${portalExpr}`);

  // ── Daily maintenance: 03:00 local time ──────────────────────────────────
  cron.schedule('0 3 * * *', () => {
    runDailyMaintenance();
  });
  log('Daily maintenance scheduled: 03:00');

  log('=== System running — press Ctrl+C to stop ===');
}

main().catch(err => {
  console.error(`[${new Date().toISOString()}] Fatal startup error:`, err);
  process.exit(1);
});
