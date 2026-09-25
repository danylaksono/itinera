/* Built-in reference data, with no network: country outlines (Natural Earth via world-atlas)
   and towns over 15,000 people (GeoNames via all-the-cities, made at build time in vite.config.js).
   Both are separate chunks, loaded when the first data arrives. */
import { feature, mesh } from 'topojson-client';
import { bbox, booleanPointInPolygon } from '@turf/turf';
import { hav } from './util.js';

export let WORLD = null;
let GAZ = null, GZ = null;

export async function loadGeo() {
  if (WORLD && GAZ) return;
  const [{ default: topo }, { default: gaz }] = await Promise.all([import('world-atlas/countries-50m.json'), import('virtual:gazetteer')]);
  const countries = feature(topo, topo.objects.countries).features;
  for (const f of countries) f.bbox = bbox(f);
  WORLD = { countries, land: feature(topo, topo.objects.land), borders: mesh(topo, topo.objects.countries, (a, b) => a !== b) };
  GAZ = gaz;
}

const _ccache = new Map();
export function countryAt(lat, lon) {
  if (!WORLD) return null;
  const key = lat.toFixed(2) + ',' + lon.toFixed(2);
  if (_ccache.has(key)) return _ccache.get(key);
  let best = null;
  const pt = [lon, lat];
  for (const f of WORLD.countries) {
    const b = f.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (booleanPointInPolygon(pt, f)) { best = f.properties.name; break; }
  }
  if (!best) { // coast: nearest vertex within ~30 km
    let bd = 30000;
    for (const f of WORLD.countries) {
      const b = f.bbox;
      if (lon < b[0] - .4 || lon > b[2] + .4 || lat < b[1] - .4 || lat > b[3] + .4) continue;
      const geom = f.geometry;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      for (const poly of polys) for (const c of poly[0]) { const d = hav(lat, lon, c[1], c[0]); if (d < bd) { bd = d; best = f.properties.name; } }
    }
  }
  _ccache.set(key, best);
  return best;
}

/* nearest town within maxD metres */
export function nearTown(lat, lon, maxD = 30000) {
  if (!GAZ) return null;
  if (!GZ) {
    GZ = { names: GAZ.n.split('|'), grid: new Map() };
    for (let i = 0; i < GZ.names.length; i++) {
      const k = Math.floor(GAZ.c[2 * i] / 100) + ':' + Math.floor(GAZ.c[2 * i + 1] / 100);
      if (!GZ.grid.has(k)) GZ.grid.set(k, []); GZ.grid.get(k).push(i);
    }
  }
  let best = null, bd = maxD;
  const gy = Math.floor(lat), gx = Math.floor(lon);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of GZ.grid.get((gy + dy) + ':' + (gx + dx)) || []) {
    const d = hav(lat, lon, GAZ.c[2 * i] / 100, GAZ.c[2 * i + 1] / 100);
    if (d < bd) { bd = d; best = GZ.names[i]; }
  }
  return best;
}
