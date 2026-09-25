/* Playwright helpers. The built site (dist/) is served over http, so the page's
   Content-Security-Policy applies as on a real host. */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
export function serve(dir = path.join(ROOT, 'dist')) {
  const srv = http.createServer((q, r) => {
    let p = path.join(dir, decodeURIComponent(q.url.split('?')[0]));
    if (p.endsWith(path.sep)) p += 'index.html';
    fs.readFile(p, (e, d) => {
      if (e) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(d);
    });
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() })));
}

// Software WebGL so MapLibre and three.js run headless. Set CHROME to use a specific browser binary.
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  // fail Google Fonts at once: on some networks the request hangs and blocks page load
  '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND'];
export const launch = () => chromium.launch({ args: ARGS, executablePath: process.env.CHROME || undefined });

/* collect page errors and console errors, except the harmless Google Fonts failure */
export function attachLogs(pg, logs) {
  const fonts = url => /fonts\.(googleapis|gstatic)\.com/.test(url || '');
  pg.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !fonts(m.location().url) && !fonts(m.text())) logs.push(`${m.type()}: ${m.text()}`); });
  pg.on('pageerror', e => logs.push(`PAGEERROR: ${e}`));
}
/* page.waitForFunction builds its check with eval, which the page's policy blocks; evaluate is not affected */
export async function waitFor(pg, expr, timeout = 180000) {
  for (let t = 0; t < timeout; t += 250) {
    if (await pg.evaluate(expr)) return;
    await pg.waitForTimeout(250);
  }
  throw new Error('Timed out waiting for ' + expr);
}
export const loaded = '!!document.querySelector("#app") && document.querySelector("#busy").hidden && window.__itinera.mapReady()';
export async function loadSample(pg, url) {
  await pg.goto(url);
  await pg.waitForTimeout(1000);
  await pg.click('#sampleBtn');
  await waitFor(pg, loaded);
  await pg.evaluate("new Promise(r => { const m = window.__itinera.map; m.once('idle', r); m.triggerRepaint(); setTimeout(r, 30000); })");
  await pg.waitForTimeout(1000);
}
