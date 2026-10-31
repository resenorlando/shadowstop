// QA / backup stills: screenshot any page of the running app with CDN libraries served from node_modules.
//   node snap.js <url> <out.png> [width] [height] [waitMs]      (READY=CARDS_READY waits for that window flag)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { routeCdn, launchOpts } = require('./cdn');
(async () => {
  const [url, out, w = 1920, h = 1080, waitMs = 2500] = process.argv.slice(2);
  const browser = await chromium.launch(launchOpts());
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  await routeCdn(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(+waitMs);
  if (process.env.READY) await page.waitForFunction((k) => window[k], process.env.READY, { timeout: 120000 });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await page.screenshot({ path: out });
  await browser.close();
  console.log('wrote', out);
})();
