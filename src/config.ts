import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { Config, Secrets } from './types';

dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `  → Copy .env.example to .env and fill in your credentials.`
    );
  }
  return val;
}

function loadConfigFile(): Config {
  const configPath = path.resolve(process.cwd(), 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `config.json not found at: ${configPath}\n` +
      `  → Make sure you are running from the project root directory.`
    );
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<Config>;

  if (!Array.isArray(raw.keywords) || raw.keywords.length === 0) {
    throw new Error('config.json: "keywords" must be a non-empty array of strings.');
  }
  if (typeof raw.poll_interval_minutes !== 'number' || raw.poll_interval_minutes < 1) {
    throw new Error('config.json: "poll_interval_minutes" must be a positive number.');
  }
  if (!raw.seniority || typeof raw.seniority.min_years !== 'number' || typeof raw.seniority.max_years !== 'number') {
    throw new Error('config.json: "seniority" must have numeric "min_years" and "max_years".');
  }
  if (!raw.ai || typeof raw.ai.max_calls_per_day !== 'number' || typeof raw.ai.max_tokens !== 'number') {
    throw new Error('config.json: "ai" must have numeric "max_calls_per_day" and "max_tokens".');
  }
  if (!raw.notifications?.telegram?.chat_id) {
    throw new Error('config.json: "notifications.telegram.chat_id" is required.');
  }
  if (!raw.notifications?.email?.smtp_host || !raw.notifications?.email?.from || !raw.notifications?.email?.to) {
    throw new Error('config.json: "notifications.email" must have "smtp_host", "from", and "to".');
  }

  return raw as Config;
}

function loadSecrets(): Secrets {
  return {
    telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    claudeApiKey: requireEnv('CLAUDE_API_KEY'),
    smtpUser: requireEnv('SMTP_USER'),
    smtpPass: requireEnv('SMTP_PASS'),
    // Optional — web search feature is silently disabled when absent
    braveSearchApiKey: process.env['BRAVE_SEARCH_API_KEY'] ?? null,
  };
}

export const config: Config = loadConfigFile();
export const secrets: Secrets = loadSecrets();
