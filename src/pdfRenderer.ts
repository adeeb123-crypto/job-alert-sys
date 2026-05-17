import puppeteer from 'puppeteer';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const marked = require('marked') as (src: string) => string;

export async function renderPdf(markdown: string): Promise<Buffer> {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: auto; font-size: 13px; line-height: 1.5; color: #111; }
    h1 { font-size: 20px; margin-bottom: 2px; }
    h2 { font-size: 14px; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-top: 18px; text-transform: uppercase; letter-spacing: 0.05em; }
    h3 { font-size: 13px; margin-bottom: 2px; }
    ul { padding-left: 18px; margin: 4px 0; }
    li { margin-bottom: 2px; }
    p { margin: 4px 0; }
    a { color: #111; text-decoration: none; }
  </style>
</head>
<body>${marked(markdown)}</body>
</html>`;

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      printBackground: false,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
