export interface Job {
  id: string;           // SHA256 fingerprint of company+title+location
  title: string;
  company: string;
  location: string;
  jobType: string;
  url: string;
  portal: string;
  rawJD: string;
  foundAt: Date;
}

export interface ParsedJD {
  jobTitle: string;
  companyName: string;
  location: string;
  jobType: string;
  requiredSkills: string[];
  yearsOfExperience: string; // e.g. "3-5 years" or "Not specified"
  rawText: string;
}

export interface Config {
  keywords: string[];
  seniority: {
    min_years: number;
    max_years: number;
  };
  job_types: string[];
  location: string;
  poll_interval_minutes: number;
  ai: {
    max_calls_per_day: number; // hard daily cap on Claude API calls
    max_tokens: number;        // max output tokens per call
  };
  notifications: {
    telegram: {
      chat_id: string;
    };
    email: {
      smtp_host: string;
      smtp_port: number;
      from: string;
      to: string;
    };
  };
  resume_path: string;
}

export interface Secrets {
  telegramBotToken: string;
  claudeApiKey: string;
  smtpUser: string;
  smtpPass: string;
  serperApiKey: string | null;
}

// A job lead found via Google search on company websites — simpler than Job,
// no resume tailoring, just a Telegram notification with a link to apply
export interface WebJobLead {
  url: string;
  title: string;
  company: string;
  snippet: string;
  jdText?: string;   // best-effort JD text fetched from the actual page
  foundAt: Date;
}

// Returned by resumeTailor — includes the tailored markdown plus token usage for cost logging
export interface TailoringResult {
  tailoredMarkdown: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}
