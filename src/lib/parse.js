/* File readers: detect the export format and turn it into raw sources
   { name, kind, P: {t, lat, lon, acc, off}, visits, trips, files }. */
import { MIN, sleep, fmtSize } from './util.js';

/* ---------- field parsing ---------- */
function ptime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return { t: v < 1e11 ? v * 1000 : v, off: null };
  const s = String(v);
  if (/^\d+$/.test(s)) { const n = +s; return { t: n < 1e11 ? n * 1000 : n, off: null }; }
  const t = Date.parse(s);
  if (isNaN(t)) return null;
  const m = s.match(/([+-])(\d{2}):?(\d{2})$/);
  return { t, off: m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null };
}
function e7(v) { if (v > 900000000) v -= 4294967296; return v / 1e7; }
function pll(s) {
  if (s == null) return null;
  if (typeof s === 'object') {
    if (Array.isArray(s)) return s.length >= 2 ? [+s[0], +s[1]] : null;
    if ('latitudeE7' in s && s.latitudeE7 != null) return [e7(s.latitudeE7), e7(s.longitudeE7)];
    if ('latE7' in s && s.latE7 != null) return [e7(s.latE7), e7(s.lngE7)];
    if ('latLng' in s) return pll(s.latLng);
    if ('LatLng' in s) return pll(s.LatLng);
    if ('placeLocation' in s) return pll(s.placeLocation);
    if ('lat' in s) return [+s.lat, +(s.lng ?? s.lon)];
    return null;
  }
  const m = String(s).replace('geo:', '').match(/(-?\d+(?:\.\d+)?)\D+?(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const la = +m[1], lo = +m[2];
  if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return [la, lo];
}
export function modeGroup(s) {
  if (!s) return 'other';
  s = String(s).toUpperCase().replace(/[\s-]+/g, '_');
  if (/MOTORCYC/.test(s)) return 'road';
  if (/WALK|FOOT|RUN|HIK/.test(s)) return 'walk';
  if (/CYCL|BICYCLE|BIKING/.test(s)) return 'cycle';
  if (/FLY|PLANE|AIRPLANE|AIRCRAFT/.test(s)) return 'flight';
  if (/BUS|TRAIN|SUBWAY|TRAM|FERRY|CABLE|FUNICULAR|RAIL|METRO|BOAT|SAIL|GONDOLA/.test(s)) return 'transit';
  if (/VEHICLE|DRIV|CAR|TAXI/.test(s)) return 'road';
  return 'other';
}

/* ---------- raw source container ---------- */
export function newRaw(name, kind) {
  return { name, kind, P: { t: [], lat: [], lon: [], acc: [], off: [] }, visits: [], trips: [], files: [] };
}
function addPt(r, t, lat, lon, acc, off) {
  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return;
  const P = r.P; P.t.push(t); P.lat.push(lat); P.lon.push(lon); P.acc.push(acc ?? -1); P.off.push(off ?? null);
}

/* ---------- format parsers ---------- */
function parseRecords(o, fname, deviceNames) {
  const by = new Map();
  for (const l of o.locations || []) {
    const ll = pll(l); if (!ll) continue;
    const tt = ptime(l.timestamp ?? l.timestampMs); if (!tt) continue;
    const tag = l.deviceTag != null ? String(l.deviceTag) : '';
    let r = by.get(tag);
    if (!r) {
      const nm = deviceNames?.get(tag) || (tag ? `Records device ${tag.slice(-4)}` : 'Records');
      r = newRaw(nm, 'records'); r.files.push(fname); by.set(tag, r);
    }
    addPt(r, tt.t, ll[0], ll[1], l.accuracy, tt.off);
  }
  return [...by.values()];
}
function parseSemanticOld(o, r) {
  for (const it of o.timelineObjects || []) {
    if (it.placeVisit) {
      const v = it.placeVisit, loc = v.location || {};
      const ll = pll(loc) || pll({ latitudeE7: v.centerLatE7, longitudeE7: v.centerLngE7 });
      const d = v.duration || {};
      const a = ptime(d.startTimestamp ?? d.startTimestampMs), b = ptime(d.endTimestamp ?? d.endTimestampMs);
      if (!ll || !a || !b || b.t <= a.t) continue;
      r.visits.push({ t0: a.t, t1: b.t, lat: ll[0], lon: ll[1], pid: loc.placeId || null, name: loc.name || null, addr: loc.address || null, type: loc.semanticType || null, off: a.off });
    } else if (it.activitySegment) {
      const s = it.activitySegment, d = s.duration || {};
      const a = ptime(d.startTimestamp ?? d.startTimestampMs), b = ptime(d.endTimestamp ?? d.endTimestampMs);
      const s0 = pll(s.startLocation), s1 = pll(s.endLocation);
      if (!a || !b || !s0 || !s1 || b.t < a.t) continue;
      const path = [];
      const sp = s.simplifiedRawPath?.points;
      if (sp && sp.length) {
        for (const p of sp) { const tt = ptime(p.timestamp ?? p.timestampMs), ll = pll(p); if (tt && ll) path.push([tt.t, ll[0], ll[1]]); }
      } else if (s.waypointPath?.waypoints?.length) {
        const w = s.waypointPath.waypoints;
        w.forEach((p, i) => { const ll = pll(p); if (ll) path.push([a.t + (b.t - a.t) * (i + 1) / (w.length + 1), ll[0], ll[1]]); });
      }
      r.trips.push({ t0: a.t, t1: b.t, lat0: s0[0], lon0: s0[1], lat1: s1[0], lon1: s1[1], dist: s.distance ?? s.waypointPath?.distanceMeters ?? null, mode: modeGroup(s.activityType), rawMode: s.activityType || '', path, off: a.off });
    }
  }
}
function parseAndroid(o, r) {
  const labels = new Map();
  for (const f of o.userLocationProfile?.frequentPlaces || []) if (f.placeId && f.label) labels.set(f.placeId, f.label);
  for (const s of o.semanticSegments || []) {
    const a = ptime(s.startTime), b = ptime(s.endTime);
    if (!a || !b) continue;
    const off = s.startTimeTimezoneUtcOffsetMinutes ?? a.off;
    if (s.visit) {
      const c = s.visit.topCandidate || {};
      const ll = pll(c.placeLocation);
      if (ll && b.t > a.t) r.visits.push({ t0: a.t, t1: b.t, lat: ll[0], lon: ll[1], pid: c.placeId || null, name: null, type: labels.get(c.placeId) || c.semanticType || null, off });
    } else if (s.activity) {
      const ac = s.activity, s0 = pll(ac.start), s1 = pll(ac.end);
      if (s0 && s1) r.trips.push({ t0: a.t, t1: b.t, lat0: s0[0], lon0: s0[1], lat1: s1[0], lon1: s1[1], dist: ac.distanceMeters != null ? +ac.distanceMeters : null, mode: modeGroup(ac.topCandidate?.type), rawMode: ac.topCandidate?.type || '', path: [], off });
    }
    if (s.timelinePath) for (const p of s.timelinePath) {
      const ll = pll(p.point), tt = ptime(p.time);
      if (ll && tt) addPt(r, tt.t, ll[0], ll[1], -1, tt.off ?? off);
    }
  }
  for (const sig of o.rawSignals || []) {
    const p = sig.position; if (!p) continue;
    const ll = pll(p.LatLng ?? p.latLng), tt = ptime(p.timestamp);
    if (ll && tt) addPt(r, tt.t, ll[0], ll[1], p.accuracyMeters ?? -1, tt.off);
  }
}
function parseIOS(arr, r) {
  for (const s of arr) {
    const a = ptime(s.startTime), b = ptime(s.endTime);
    if (!a || !b) continue;
    const off = a.off;
    if (s.visit) {
      const c = s.visit.topCandidate || {};
      const ll = pll(c.placeLocation);
      if (ll && b.t > a.t) r.visits.push({ t0: a.t, t1: b.t, lat: ll[0], lon: ll[1], pid: c.placeID || c.placeId || null, name: null, type: c.semanticType || null, off });
    } else if (s.activity) {
      const ac = s.activity, s0 = pll(ac.start), s1 = pll(ac.end);
      if (s0 && s1) r.trips.push({ t0: a.t, t1: b.t, lat0: s0[0], lon0: s0[1], lat1: s1[0], lon1: s1[1], dist: ac.distanceMeters != null ? +ac.distanceMeters : null, mode: modeGroup(ac.topCandidate?.type), rawMode: ac.topCandidate?.type || '', path: [], off });
    }
    if (s.timelinePath) for (const p of s.timelinePath) {
      const ll = pll(p.point); const mins = +(p.durationMinutesOffsetFromStartTime || 0);
      if (ll) addPt(r, a.t + mins * MIN, ll[0], ll[1], -1, off);
    }
  }
}
function parseGPX(text, fname) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${fname} is not valid GPX.`);
  const name = doc.querySelector('metadata > name')?.textContent?.trim() || doc.querySelector('trk > name')?.textContent?.trim();
  const r = newRaw(name && name.length < 40 ? name : fname.replace(/\.gpx$/i, ''), 'gpx');
  const types = [...doc.getElementsByTagName('trk')].map(t => t.getElementsByTagName('type')[0]?.textContent?.trim()).filter(Boolean);
  if (types.length) { const g = modeGroup(types[0]); if (g !== 'other' && types.every(x => modeGroup(x) === g)) { r.modeHint = g; r.modeHintRaw = types[0]; } }
  for (const p of doc.getElementsByTagName('trkpt')) {
    const tEl = p.getElementsByTagName('time')[0]; if (!tEl) continue;
    const tt = ptime(tEl.textContent.trim()); if (!tt) continue;
    addPt(r, tt.t, +p.getAttribute('lat'), +p.getAttribute('lon'), -1, tt.off);
  }
  return r;
}
function parseGeoJSON(o, r) {
  for (const f of o.features || []) {
    const g = f.geometry, pr = f.properties || {};
    if (!g) continue;
    if (g.type === 'Point') {
      const tt = ptime(pr.time ?? pr.timestamp ?? pr.datetime ?? pr.date); if (!tt) continue;
      addPt(r, tt.t, g.coordinates[1], g.coordinates[0], pr.accuracy ?? -1, tt.off);
    } else if (g.type === 'LineString') {
      const times = pr.coordTimes || pr.times || pr.timestamps;
      if (!times) continue;
      g.coordinates.forEach((c, i) => { const tt = ptime(times[i]); if (tt) addPt(r, tt.t, c[1], c[0], -1, tt.off); });
    }
  }
}

/* Detect the format of one parsed file and return raw sources. */
export function detectAndParse(fname, content, ctx) {
  const low = fname.toLowerCase();
  if (typeof content === 'string') {
    const head = content.slice(0, 400).trimStart();
    if (head.startsWith('<')) {
      if (/<gpx/i.test(content.slice(0, 2000))) return [parseGPX(content, fname)];
      throw new Error(`${fname}: this XML file is not GPX.`);
    }
    try { content = JSON.parse(content); }
    catch (e) { throw new Error(`${fname}: the file is not valid JSON.`); }
  }
  const o = content;
  if (Array.isArray(o)) {
    if (o.length && o.some(x => x && x.startTime && (x.visit || x.activity || x.timelinePath))) {
      const r = newRaw(low.includes('location-history') ? 'iPhone timeline' : fname.replace(/\.json$/i, ''), 'ios');
      parseIOS(o, r); r.files.push(fname); return [r];
    }
    return [];
  }
  if (o && Array.isArray(o.semanticSegments)) {
    const r = newRaw(/timeline/i.test(fname) ? 'Android timeline' : fname.replace(/\.json$/i, ''), 'android');
    parseAndroid(o, r); r.files.push(fname); return [r];
  }
  if (o && Array.isArray(o.locations)) return parseRecords(o, fname, ctx.deviceNames);
  if (o && Array.isArray(o.timelineObjects)) {
    if (!ctx.semantic) { ctx.semantic = newRaw('Semantic history', 'semantic'); ctx.semantic._new = true; }
    parseSemanticOld(o, ctx.semantic); ctx.semantic.files.push(fname);
    if (ctx.semantic._new) { ctx.semantic._new = false; return [ctx.semantic]; }
    return [];
  }
  if (o && o.type === 'FeatureCollection') {
    const r = newRaw(fname.replace(/\.(geo)?json$/i, ''), 'geojson');
    parseGeoJSON(o, r); r.files.push(fname); return [r];
  }
  if (o && Array.isArray(o.deviceSettings)) {
    for (const d of o.deviceSettings) if (d.deviceTag != null) ctx.deviceNames.set(String(d.deviceTag), d.devicePrettyName || d.deviceName || `Device ${String(d.deviceTag).slice(-4)}`);
    return [];
  }
  return [];
}

/* ---------- reading files, zips and folders ---------- */
export async function readEntries(dt) {
  const files = [];
  const walk = async (entry, path) => {
    if (entry.isFile) {
      await new Promise(res => entry.file(f => { f._path = path + f.name; files.push(f); res(); }, () => res()));
    } else if (entry.isDirectory) {
      const rd = entry.createReader();
      let batch;
      do {
        batch = await new Promise(res => rd.readEntries(res, () => res([])));
        for (const e of batch) await walk(e, path + entry.name + '/');
      } while (batch.length);
    }
  };
  const items = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (items.length) { for (const e of items) await walk(e, ''); return files; }
  return [...dt.files];
}
const RELEVANT = /(records\.json|timeline\.json|location[-_ ]history|semantic location history|timeline|settings\.json|\.gpx$|\.geojson$)/i;
export async function loadFiles(fileList, onStep) {
  const ctx = { deviceNames: new Map(), semantic: null };
  const raws = [], errors = [];
  const files = [...fileList];
  // expand zips
  const expanded = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      onStep(`Opening ${f.name}`, fmtSize(f.size));
      await sleep(20);
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(f);
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir || !RELEVANT.test(path)) continue;
        if (!/\.(json|gpx|geojson)$/i.test(path)) continue;
        expanded.push({ name: path.split('/').pop(), _path: path, text: () => entry.async('string'), size: entry._data?.uncompressedSize || 0 });
      }
    } else expanded.push(f);
  }
  // Settings.json first so device names are known
  expanded.sort((a, b) => (/settings\.json$/i.test(b.name) ? 1 : 0) - (/settings\.json$/i.test(a.name) ? 1 : 0));
  const jsonish = expanded.filter(f => /\.(json|gpx|geojson)$/i.test(f.name));
  let i = 0;
  for (const f of jsonish) {
    i++;
    onStep(`Reading ${f.name}`, `File ${i} of ${jsonish.length}${f.size ? ', ' + fmtSize(f.size) : ''}`);
    await sleep(10);
    try {
      const text = await f.text();
      raws.push(...detectAndParse(f.name, text, ctx));
    } catch (e) {
      errors.push(e.message && e.message.includes(f.name) ? e.message : `${f.name}: ${e.message || 'the browser could not read this file.'}`);
    }
  }
  return { raws: raws.filter(r => r.P.t.length || r.visits.length || r.trips.length), errors, skipped: expanded.length - jsonish.length };
}
