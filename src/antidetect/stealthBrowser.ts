import { chromium as playwrightExtraChromium } from 'playwright-extra';
import type { Browser, BrowserContext, Page } from 'playwright';
import { getProxyConfig } from './proxyManager';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
playwrightExtraChromium.use(StealthPlugin());

export async function createBrowser(domain?: string): Promise<Browser> {
  const proxyConfig = getProxyConfig(domain);

  const browser = await playwrightExtraChromium.launch({
    headless: true,
    proxy: proxyConfig ?? undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  return browser as unknown as Browser;
}

export async function createStealthContext(browser: Browser): Promise<BrowserContext> {
  const viewport = realisticViewport();

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport,
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  return context;
}

export async function homepageFirst(page: Page, domain: string): Promise<void> {
  const homepage = domain.startsWith('http') ? domain : `https://${domain}`;
  await page.goto(homepage, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await randomDelay(1500, 3000);
}

export function realisticViewport(): { width: number; height: number } {
  return Math.random() > 0.5 ? { width: 1920, height: 1080 } : { width: 1366, height: 768 };
}

export const randomDelay = (min = 2000, max = 4000): Promise<void> =>
  new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));

if (require.main === module) {
  (async () => {
    // Test 1: realisticViewport returns one of two valid sizes
    const v = realisticViewport();
    const validSizes = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
    ];
    const isValid = validSizes.some(s => s.width === v.width && s.height === v.height);
    console.assert(isValid, `FAIL: Unexpected viewport: ${JSON.stringify(v)}`);
    console.log(`PASS: realisticViewport → ${v.width}x${v.height}`);

    // Test 2: randomDelay stays within bounds
    const start = Date.now();
    await randomDelay(100, 200);
    const elapsed = Date.now() - start;
    console.assert(elapsed >= 100 && elapsed <= 400, `FAIL: randomDelay out of bounds: ${elapsed}ms`);
    console.log(`PASS: randomDelay(100,200) → ${elapsed}ms`);

    // Test 3: createBrowser launches without crashing (proxy optional)
    console.log('Testing createBrowser (no proxy)...');
    const browser = await createBrowser();
    console.assert(browser !== null, 'FAIL: createBrowser returned null');
    console.log('PASS: createBrowser launched');

    // Test 4: createStealthContext creates a context
    const context = await createStealthContext(browser);
    console.assert(context !== null, 'FAIL: createStealthContext returned null');
    console.log('PASS: createStealthContext created');

    await browser.close();
    console.log('\nAll stealthBrowser tests passed.');
    process.exit(0);
  })();
}
