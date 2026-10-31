// Records the auto-playing film to a 1920x1080 / 30 fps MP4.
//
//   python -m uvicorn shadowstop.server:app --port 8000      (in another terminal)
//   cd showcase-tools && npm install && node record.js
//
// Output: showcase-tools/out/shadowstop_demo.mp4 plus key-frame PNGs (qa_*.png) for QA.
// Default: the v2 film (web/story_v2.html, real 3D hero scene), rendered frame by frame on a virtual
// clock, so the result is smooth even on a slow laptop or with software WebGL (it just takes longer).
// Options (env):
//   URL          page to record (default story_v2; the old film is http://localhost:8000/story_v1.html?autoplay=1)
//   SECS         length in seconds (default 56)
//   OUT          output dir (default "out")
//   REALTIME=1   old behaviour: screen-record in real time (needs a fast GPU; required for story_v1)
//   HEADED=1     watch it;  SOFTWARE_GL=1 without a GPU;  CHROME_PATH=... use a preinstalled Chromium
// CDN scripts are served from node_modules (same versions). Satellite map tiles need internet: without
// them the film automatically flies into the 3D reconstruction instead of the satellite map.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { routeCdn, launchOpts } = require('./cdn');

const REALTIME = !!process.env.REALTIME;
const URL_ = process.env.URL || (REALTIME ? 'http://localhost:8000/story_v2.html?autoplay=1&rec=1' : 'http://localhost:8000/story_v2.html?rec=1');
const SECS = Number(process.env.SECS || 56);
const FPS = 30;
const OUT = path.resolve(__dirname, process.env.OUT || 'out');
const QA_AT = [2, 8, 10.5, 15, 18, 21, 25, 28, 30, 33, 36, 40, 44, 46, 50, 54];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch(launchOpts({ proxy, headless: !process.env.HEADED }));
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: !!proxy, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    ...(REALTIME ? { recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } } } : {}),
  });
  await routeCdn(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  const mp4 = path.join(OUT, 'shadowstop_demo.mp4');

  if (REALTIME) {
    const t0 = Date.now();
    await page.goto(URL_, { waitUntil: 'load' });
    const lead = (Date.now() - t0) / 1000;
    for (const s of QA_AT) {
      const due = (lead + s) * 1000 - (Date.now() - t0);
      if (due > 0) await page.waitForTimeout(due);
      await page.screenshot({ path: path.join(OUT, `qa_${String(s).padStart(4, '0')}.png`), timeout: 4000 }).catch(() => {});
    }
    await page.waitForTimeout(Math.max(0, (lead + SECS) * 1000 - (Date.now() - t0)));
    const vid = await page.video().path();
    await ctx.close(); await browser.close();
    execSync(`ffmpeg -y -loglevel error -ss ${lead.toFixed(2)} -i "${vid}" -t ${SECS} -r ${FPS} -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart "${mp4}"`);
    fs.unlinkSync(vid);
    console.log(`wrote ${mp4}`);
    return;
  }

  // Deterministic: a virtual clock for the page's own animation (GSAP, MapLibre, three.js all read
  // performance.now/Date.now and schedule with requestAnimationFrame). We advance it 1/30 s per frame.
  // (Playwright's page.clock also freezes the rAF its screenshots rely on, so it can't be used here.)
  await ctx.addInitScript(() => {
    const pNow = performance.now.bind(performance), dNow = Date.now;
    const p0 = pNow(), d0 = dNow();
    let vt = 0, id = 0, q = new Map(), live = true;
    performance.now = () => (live ? pNow() : p0 + vt);
    Date.now = () => (live ? dNow() : d0 + vt);
    const rRAF = window.requestAnimationFrame.bind(window), rCAF = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { if (live) return rRAF(cb); q.set(++id, cb); return id; };
    window.cancelAnimationFrame = (i) => (live ? rCAF(i) : q.delete(i));
    window.__vclock = {
      freeze() { vt = pNow() - p0; live = false; },
      step(ms) { vt += ms; const cbs = [...q.values()]; q = new Map(); const t = p0 + vt; for (const cb of cbs) { try { cb(t); } catch (e) { console.error(e); } } },
    };
  });
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.STORY_READY && window.H3D, null, { timeout: 90000, polling: 200 });
  await page.waitForTimeout(3000); // fonts, photo and (if online) the first satellite tiles
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.evaluate(() => { window.__vclock.freeze(); window.storyStart(); }); // don't await the film's promise
  const frames = path.join(OUT, 'frames');
  fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames);
  const n = Math.round(SECS * FPS);
  const qa = new Set(QA_AT.map((s) => Math.round(s * FPS)));
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    await page.evaluate((ms) => window.__vclock.step(ms), 1000 / FPS);
    if (f % 15 === 0) await page.waitForTimeout(40); // let network-driven work (tiles, images) land
    const file = path.join(frames, `f_${String(f).padStart(5, '0')}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    if (qa.has(f)) fs.copyFileSync(file, path.join(OUT, `qa_${String((f / FPS).toFixed(1)).padStart(4, '0')}s.jpg`));
    if (f % 150 === 0) console.log(`frame ${f}/${n}  (${((Date.now() - t0) / 1000).toFixed(0)} s elapsed)`);
  }
  await ctx.close(); await browser.close();
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i "${path.join(frames, 'f_%05d.jpg')}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart "${mp4}"`);
  if (!process.env.KEEP_FRAMES) fs.rmSync(frames, { recursive: true, force: true });
  console.log(`wrote ${mp4}`);
})();
