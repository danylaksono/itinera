import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/* Towns with at least 15,000 people (GeoNames, via all-the-cities), made at build time.
   n = names joined by '|', c = [lat*100, lon*100, ...]. The app imports it as 'virtual:gazetteer'. */
function gazetteer() {
  const id = 'virtual:gazetteer', resolved = '\0' + id;
  return {
    name: 'itinera-gazetteer',
    resolveId: s => s === id ? resolved : null,
    load(s) {
      if (s !== resolved) return null;
      const cities = require('all-the-cities').filter(c => c.population >= 15000);
      const gaz = {
        n: cities.map(c => c.name.replace(/\|/g, ' ')).join('|'),
        c: cities.flatMap(c => [Math.round(c.loc.coordinates[1] * 100), Math.round(c.loc.coordinates[0] * 100)])
      };
      return `export default ${JSON.stringify(gaz)};`;
    }
  };
}

/* The Content-Security-Policy that makes the privacy promise hold: scripts only from this site,
   no connections except the optional CARTO street tiles. Built pages only (the dev server needs
   inline scripts for hot reload). */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  'worker-src blob:',                                    // MapLibre starts its worker from a blob
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob: https://*.basemaps.cartocdn.com",
  'connect-src https://*.basemaps.cartocdn.com',         // street tiles, only when that layer is on
  "base-uri 'none'", "form-action 'none'"
].join('; ');
function csp() {
  return {
    name: 'itinera-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) throw new Error('index.html has an inline script, which the CSP blocks.');
        return html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
      }
    }
  };
}

export default defineConfig({
  base: './',                 // works under a GitHub Pages sub-path
  plugins: [react(), gazetteer(), csp()],
  build: { chunkSizeWarningLimit: 2500 }
});
