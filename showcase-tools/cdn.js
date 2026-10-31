// Serve the pinned CDN libraries from node_modules (identical versions) so recording works offline / on slow Wi-Fi.
const fs = require('fs');
const path = require('path');
const nm = (p) => path.join(__dirname, 'node_modules', p);
const LOCAL = {
  'gsap/3.12.5/gsap.min.js': nm('gsap/dist/gsap.min.js'),
  'leaflet/1.9.4/leaflet.min.js': nm('leaflet/dist/leaflet.js'),
  'leaflet/1.9.4/leaflet.min.css': nm('leaflet/dist/leaflet.css'),
  'maplibre-gl@4.7.1/dist/maplibre-gl.js': nm('maplibre-gl/dist/maplibre-gl.js'),
  'maplibre-gl@4.7.1/dist/maplibre-gl.css': nm('maplibre-gl/dist/maplibre-gl.css'),
  'three@0.160.0/build/three.module.js': nm('three/build/three.module.js'),
  'three@0.160.0/examples/jsm/': nm('three/examples/jsm/'),
};
async function routeCdn(ctx) {
  await ctx.route(/cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net/, async (route) => {
    const u = route.request().url().split('?')[0];
    for (const [k, file] of Object.entries(LOCAL)) {
      const i = u.indexOf(k);
      if (i < 0) continue;
      const f = k.endsWith('/') ? path.join(file, u.slice(i + k.length)) : file;
      if (fs.existsSync(f)) {
        const ct = f.endsWith('.css') ? 'text/css' : 'application/javascript';
        return route.fulfill({ path: f, contentType: ct, headers: { 'access-control-allow-origin': '*' } });
      }
    }
    return route.continue();
  });
}
// SOFTWARE_GL=1 on machines without a GPU (cloud containers).
const launchArgs = () => ['--hide-scrollbars', '--ignore-gpu-blocklist',
  ...(process.env.SOFTWARE_GL ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])];
// CHROME_PATH=/path/to/chromium to use a preinstalled browser instead of Playwright's download.
const launchOpts = (extra = {}) => ({ args: launchArgs(), ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), ...extra });
module.exports = { routeCdn, launchArgs, launchOpts, LOCAL };
