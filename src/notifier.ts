import TelegramBot from 'node-telegram-bot-api';
import nodemailer from 'nodemailer';
import { Job, TailoringResult, WebJobLead } from './types';
import { config, secrets } from './config';
import { renderPdf } from './pdfRenderer';

// ─── Telegram ─────────────────────────────────────────────────────────────────

let _bot: TelegramBot | null = null;

function getBot(): TelegramBot | null {
  if (!secrets.telegramBotToken || secrets.telegramBotToken === 'placeholder') return null;
  if (!_bot) _bot = new TelegramBot(secrets.telegramBotToken);
  return _bot;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegram(html: string): Promise<void> {
  const bot = getBot();
  if (!bot) {
    console.warn('[Notifier] Telegram token is placeholder — skipping Telegram notification');
    return;
  }
  const chatId = config.notifications.telegram.chat_id;
  if (!chatId || chatId === 'TELEGRAM_CHAT_ID') {
    console.warn('[Notifier] Telegram chat_id not configured — skipping');
    return;
  }
  await bot.sendMessage(chatId, html, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  } as TelegramBot.SendMessageOptions);
}

// ─── Email ─────────────────────────────────────────────────────────────────────

async function sendEmail(subject: string, body: string, pdfAttachment?: { filename: string; content: Buffer }): Promise<void> {
  if (
    !secrets.smtpUser || secrets.smtpUser === 'placeholder' ||
    !secrets.smtpPass || secrets.smtpPass === 'placeholder'
  ) {
    console.warn('[Notifier] SMTP credentials are placeholders — skipping email');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.notifications.email.smtp_host,
    port: config.notifications.email.smtp_port,
    secure: false,
    auth: { user: secrets.smtpUser, pass: secrets.smtpPass },
  });

  await transporter.sendMail({
    from: config.notifications.email.from,
    to:   config.notifications.email.to,
    subject,
    text: body,
    attachments: pdfAttachment ? [pdfAttachment] : [],
  });

  console.log(`[Notifier] Email sent → ${config.notifications.email.to}`);
}

// ─── Message builders ──────────────────────────────────────────────────────────

function buildJobTelegramHtml(job: Job, result: TailoringResult | null): string {
  const lines = [
    `<b>New Job Match</b>`,
    `<b>${escapeHtml(job.title)}</b> @ <b>${escapeHtml(job.company)}</b>`,
    `${escapeHtml(job.location)}  |  ${escapeHtml(job.jobType)}  |  ${escapeHtml(job.portal)}`,
    `<a href="${job.url}">View Posting</a>`,
  ];

  if (result) {
    lines.push(`<i>Tailored resume attached below | AI cost: $${result.estimatedCostUsd.toFixed(4)}</i>`);
  } else {
    lines.push('', '<i>Resume tailoring skipped (daily cap reached or AI unavailable)</i>');
  }

  return lines.join('\n');
}

function buildJobEmailBody(job: Job, result: TailoringResult | null): string {
  const parts = [
    `Job:      ${job.title} @ ${job.company}`,
    `Location: ${job.location}`,
    `Type:     ${job.jobType}`,
    `Portal:   ${job.portal}`,
    `URL:      ${job.url}`,
    '',
  ];

  if (result) {
    parts.push('--- TAILORED RESUME ---', '', result.tailoredMarkdown);
    parts.push('', `--- Estimated cost: $${result.estimatedCostUsd.toFixed(4)} ---`);
  } else {
    parts.push('Resume tailoring was skipped (daily cap reached or AI unavailable).');
  }

  return parts.join('\n');
}

function buildWebLeadTelegramHtml(lead: WebJobLead): string {
  const lines = [
    `<b>Web Job Lead</b>`,
    `<b>${escapeHtml(lead.title)}</b> @ <b>${escapeHtml(lead.company)}</b>`,
    escapeHtml(lead.snippet),
    `<a href="${lead.url}">View Job</a>`,
  ];

  if (lead.jdText) {
    const preview = lead.jdText.slice(0, 300).replace(/\s+/g, ' ');
    lines.push('', '<b>JD Preview:</b>', escapeHtml(preview) + '...');
  }

  return lines.join('\n');
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function notifyJob(job: Job, result: TailoringResult | null): Promise<void> {
  const subject = `New job match: ${job.title} @ ${job.company}`;
  const safeCompany = job.company.replace(/[^a-zA-Z0-9]/g, '_');

  await Promise.allSettled([
    (async () => {
      await sendTelegram(buildJobTelegramHtml(job, result));
      console.log(`[Notifier] Telegram alert sent for "${job.title}"`);

      if (result) {
        const bot = getBot();
        const chatId = config.notifications.telegram.chat_id;
        if (bot && chatId && chatId !== 'TELEGRAM_CHAT_ID') {
          const mdBuffer = Buffer.from(result.tailoredMarkdown, 'utf-8');
          await bot.sendDocument(chatId, mdBuffer, {}, { filename: `resume_${safeCompany}.md`, contentType: 'text/markdown' });
          console.log(`[Notifier] Telegram resume document sent for "${job.title}"`);
        }
      }
    })(),
    (async () => {
      let pdfAttachment: { filename: string; content: Buffer } | undefined;
      if (result) {
        try {
          const pdfBuffer = await renderPdf(result.tailoredMarkdown);
          pdfAttachment = { filename: `resume_${safeCompany}.pdf`, content: pdfBuffer };
          console.log(`[Notifier] PDF rendered for "${job.title}"`);
        } catch (err) {
          console.error(`[Notifier] PDF render failed — sending email without attachment: ${(err as Error).message}`);
        }
      }
      await sendEmail(subject, buildJobEmailBody(job, result), pdfAttachment);
    })(),
  ]);
}

export async function notifyWebLead(lead: WebJobLead): Promise<void> {
  // Telegram-only: web leads are for quick browsing, not resume tailoring
  await sendTelegram(buildWebLeadTelegramHtml(lead));
  console.log(`[Notifier] Telegram web-lead sent for "${lead.title}"`);
}

// ─── Self-test ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    console.log('\n=== Notifier self-test ===\n');

    const tgReal = secrets.telegramBotToken !== 'placeholder';
    const smtpReal =
      secrets.smtpUser !== 'placeholder' && secrets.smtpPass !== 'placeholder';
    const chatReal = config.notifications.telegram.chat_id !== 'TELEGRAM_CHAT_ID';

    console.log(`Telegram token : ${tgReal ? 'configured' : 'placeholder'}`);
    console.log(`Telegram chatId: ${chatReal ? config.notifications.telegram.chat_id : 'placeholder'}`);
    console.log(`SMTP creds     : ${smtpReal ? 'configured' : 'placeholder'}`);

    if (tgReal && chatReal) {
      console.log('\nSending Telegram test ping...');
      await sendTelegram(
        '<b>Job Alert System</b>\nNotifier self-test — system is online.',
      );
      console.log('Telegram ping sent.');
    } else {
      console.log('\nTelegram not configured — skipping live ping.');
      console.log('  → Set TELEGRAM_BOT_TOKEN in .env and TELEGRAM_CHAT_ID in config.json to enable.');
    }

    if (smtpReal) {
      console.log('\nSending test email...');
      await sendEmail(
        'Job Alert System — notifier test',
        'This is a test email from the UAE Job Alert System notifier.',
      );
    } else {
      console.log('\nSMTP not configured — skipping live email.');
      console.log('  → Set SMTP_USER / SMTP_PASS in .env and update config.json to enable.');
    }

    console.log('\n=== Self-test complete ===');
  })().catch(err => {
    console.error('Notifier self-test error:', err);
    process.exit(1);
  });
}
