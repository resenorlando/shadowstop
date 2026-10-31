// Records the auto-playing film (web/story_v1.html) to a 1920x1080 / 30 fps MP4.
//
//   python -m uvicorn shadowstop.server:app --port 8000      (in another terminal)
//   cd showcase-tools && npm install && node record.js
//
// Output: showcase-tools/out/shadowstop_demo.mp4 plus key-frame PNGs for QA.
// Options (env): URL, SECS (default 62), OUT (output dir, default "out"), HEADED=1 to watch it, SOFTWARE_GL=1 without a GPU.
// If the network blocks the CDNs, the CDN scripts are served from node_modules
// (same versions). Map tiles still need internet access.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.URL || 'http://localhost:8000/story_v1.html?autoplay=1';
const SECS = Number(process.env.SECS || 62);
const OUT = path.resolve(__dirname, process.env.OUT || 'out');

const nm = (p) => path.join(__dirname, 'node_modules', p);
const LOCAL = {
  'gsap/3.12.5/gsap.min.js': nm('gsap/dist/gsap.min.js'),
  'leaflet/1.9.4/leaflet.min.js': nm('leaflet/dist/leaflet.js'),
  'leaflet/1.9.4/leaflet.min.css': nm('leaflet/dist/leaflet.css'),
  'maplibre-gl@4.7.1/dist/maplibre-gl.js': nm('maplibre-gl/dist/maplibre-gl.js'),
  'maplibre-gl@4.7.1/dist/maplibre-gl.css': nm('maplibre-gl/dist/maplibre-gl.css'),
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({
    proxy,
    headless: !process.env.HEADED,
    // SOFTWARE_GL=1 only on machines without a GPU (cloud containers): it is much slower.
    args: ['--hide-scrollbars', '--ignore-gpu-blocklist', ...(process.env.SOFTWARE_GL ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
  });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: !!proxy,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  });
  // Serve CDN libraries from node_modules when available (identical versions).
  await ctx.route(/cdnjs\.cloudflare\.com|unpkg\.com/, async (route) => {
    const u = route.request().url();
    const key = Object.keys(LOCAL).find((k) => u.includes(k));
    if (key && fs.existsSync(LOCAL[key])) {
      return route.fulfill({ path: LOCAL[key], contentType: key.endsWith('.css') ? 'text/css' : 'application/javascript' });
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  const t0 = Date.now();
  await page.goto(URL_, { waitUntil: 'load' });
  const lead = (Date.now() - t0) / 1000;
  const shots = [3, 8, 14, 20, 26, 32, 38, 44, 50, 56, SECS - 2];
  for (const s of shots) {
    const due = (lead + s) * 1000 - (Date.now() - t0);
    if (due > 0) await page.waitForTimeout(due);
    await page.screenshot({ path: path.join(OUT, `shot_${String(s).padStart(2, '0')}.png`), timeout: 4000, animations: 'allow' })
      .catch((e) => console.log(`screenshot at ${s}s skipped: ${e.message.split('\n')[0]}`));
  }
  const vid = await page.video().path();
  await ctx.close();
  await browser.close();
  const mp4 = path.join(OUT, 'shadowstop_demo.mp4');
  execSync(`ffmpeg -y -loglevel error -ss ${lead.toFixed(2)} -i "${vid}" -t ${SECS} -r 30 -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart "${mp4}"`);
  fs.unlinkSync(vid);
  console.log(`wrote ${mp4} (trimmed ${lead.toFixed(2)} s of page load)`);
})();
