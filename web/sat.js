// Real aerial imagery (Esri World Imagery) cropped to a local-metre box around a lat/lon origin.
// Local metres use the same convention as the backend:
//   x = (lon - lon0) * cos(lat0) * 111320,  y = (lat - lat0) * 110540
export const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics';

const tileCache = new Map();
function loadTile(z, x, y, timeout = 8000) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => { img.src = ''; resolve(null); }, timeout);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = ESRI_URL.replace('{z}', z).replace('{y}', y).replace('{x}', x);
  });
  tileCache.set(key, p);
  p.then((v) => { if (!v) tileCache.delete(key); });
  return p;
}

// global pixel coordinates in Web Mercator at zoom z
function lonToPx(lon, z) { return ((lon + 180) / 360) * 256 * 2 ** z; }
function latToPx(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z;
}

/**
 * Returns a canvas covering local metres x in [-half, half], y in [-half, half] (north up),
 * or null if no tile loaded.
 */
export async function satelliteCanvas(lat0, lon0, half, zoom = 19, outPx = 1024) {
  const cosl = Math.cos((lat0 * Math.PI) / 180);
  const lonW = lon0 - half / (cosl * 111320), lonE = lon0 + half / (cosl * 111320);
  const latN = lat0 + half / 110540, latS = lat0 - half / 110540;
  const px0 = lonToPx(lonW, zoom), px1 = lonToPx(lonE, zoom);
  const py0 = latToPx(latN, zoom), py1 = latToPx(latS, zoom);
  const tx0 = Math.floor(px0 / 256), tx1 = Math.floor(px1 / 256);
  const ty0 = Math.floor(py0 / 256), ty1 = Math.floor(py1 / 256);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64) return null;
  const jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) jobs.push(loadTile(zoom, tx, ty).then((img) => ({ tx, ty, img })));
  const tiles = await Promise.all(jobs);
  if (!tiles.some((t) => t.img)) return null;
  const st = document.createElement('canvas');
  st.width = (tx1 - tx0 + 1) * 256; st.height = (ty1 - ty0 + 1) * 256;
  const sg = st.getContext('2d');
  sg.fillStyle = '#555'; sg.fillRect(0, 0, st.width, st.height);
  for (const t of tiles) if (t.img) sg.drawImage(t.img, (t.tx - tx0) * 256, (t.ty - ty0) * 256);
  const out = document.createElement('canvas');
  out.width = out.height = outPx;
  const og = out.getContext('2d');
  og.imageSmoothingQuality = 'high';
  og.drawImage(st, px0 - tx0 * 256, py0 - ty0 * 256, px1 - px0, py1 - py0, 0, 0, outPx, outPx);
  try { og.getImageData(0, 0, 1, 1); } catch { return null; } // tainted (no CORS): fall back
  return out;
}
