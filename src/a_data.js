'use strict';
/* ================================================================
   Itinera — client-side timeline explorer
   Part A: utilities, parsers, source building
   ================================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const MIN = 6e4, HOUR = 36e5, DAY = 864e5;
const RAD = Math.PI / 180, EARTH = 6371008.8;

function hav(la1, lo1, la2, lo2) {
  const dLa = (la2 - la1) * RAD, dLo = (lo2 - lo1) * RAD;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(dLo / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
// first index i with arr[i] >= x
function bisect(arr, x, lo = 0, hi = arr.length) {
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms = 0) => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtKm(m) {
  const k = m / 1000;
  if (k >= 10000) return (k / 1000).toFixed(k >= 100000 ? 0 : 1) + 'k';
  if (k >= 100) return Math.round(k).toLocaleString('en-GB');
  if (k >= 10) return k.toFixed(0);
  return k.toFixed(1);
}
function fmtDur(ms) {
  const h = ms / HOUR;
  if (h >= 48) return Math.round(h / 24) + ' d';
  if (h >= 1) return (h >= 10 ? Math.round(h) : h.toFixed(1)) + ' h';
  return Math.max(1, Math.round(ms / MIN)) + ' min';
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function fmtDay(day) { const d = new Date(day * DAY); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function fmtDayShort(day) { const d = new Date(day * DAY); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
function fmtLocal(t, off) {
  const d = new Date(t + off * MIN);
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return { date: `${DOWS[(Math.floor((t + off * MIN) / DAY) + 3) % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, time: `${hh}:${mm}` };
}
function monthOfDay(day) { const d = new Date(day * DAY); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
function monthLabel(m) { return `${MONTHS[m % 12]} ${Math.floor(m / 12)}`; }

// browser offset cache (minutes east of UTC), per UTC day
const _offCache = new Map();
function browserOff(t) {
  const k = Math.floor(t / DAY);
  let v = _offCache.get(k);
  if (v === undefined) { v = -new Date(t).getTimezoneOffset(); _offCache.set(k, v); }
  return v;
}

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
function modeGroup(s) {
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
function newRaw(name, kind) {
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
      const nm = deviceNames?.get(tag) || (tag ? `Records ·${tag.slice(-4)}` : 'Records');
      r = newRaw(nm.replace(' ·', ' device '), 'records'); r.files.push(fname); by.set(tag, r);
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
function detectAndParse(fname, content, ctx) {
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

/* ---------- building a finished source ---------- */
function thinPath(path, minD = 25, maxN = 400) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let last = path[0];
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i];
    if (hav(last[1], last[2], p[1], p[2]) >= minD) { out.push(p); last = p; }
  }
  out.push(path[path.length - 1]);
  if (out.length > maxN) {
    const s = out.length / maxN, o2 = [];
    for (let i = 0; i < maxN - 1; i++) o2.push(out[Math.floor(i * s)]);
    o2.push(out[out.length - 1]);
    return o2;
  }
  return out;
}
function pathLen(path) { let d = 0; for (let i = 1; i < path.length; i++) d += hav(path[i - 1][1], path[i - 1][2], path[i][1], path[i][2]); return d; }
function greatCircle(t0, t1, la0, lo0, la1, lo1, n = 48) {
  const f1 = la0 * RAD, l1 = lo0 * RAD, f2 = la1 * RAD, l2 = lo1 * RAD;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-6) return [[t0, la0, lo0], [t1, la1, lo1]];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
    const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
    const z = A * Math.sin(f1) + B * Math.sin(f2);
    out.push([t0 + (t1 - t0) * f, Math.atan2(z, Math.hypot(x, y)) / RAD, Math.atan2(y, x) / RAD]);
  }
  // keep longitudes continuous across the antimeridian
  for (let i = 1; i < out.length; i++) { while (out[i][2] - out[i - 1][2] > 180) out[i][2] -= 360; while (out[i][2] - out[i - 1][2] < -180) out[i][2] += 360; }
  return out;
}

function detectStays(T, LA, LO, D = 150, TMIN = 15 * MIN) {
  const out = [], n = T.length;
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && hav(LA[i], LO[i], LA[j], LO[j]) <= D && T[j] - T[j - 1] < 6 * HOUR) j++;
    if (T[j - 1] - T[i] >= TMIN) {
      let sa = 0, so = 0;
      for (let k = i; k < j; k++) { sa += LA[k]; so += LO[k]; }
      out.push({ t0: T[i], t1: T[j - 1], lat: sa / (j - i), lon: so / (j - i), pid: null, name: null, type: null, derived: true });
      i = j;
    } else i++;
  }
  // join neighbouring stays at the same spot
  const m = [];
  for (const v of out) {
    const p = m[m.length - 1];
    if (p && v.t0 - p.t1 < 45 * MIN && v.t0 >= p.t1 && hav(p.lat, p.lon, v.lat, v.lon) < D) { p.t1 = v.t1; continue; }
    m.push(v);
  }
  return m;
}
function resolveVisits(vs) {
  vs.sort((a, b) => a.t0 - b.t0);
  const out = [];
  for (let v of vs) {
    const p = out[out.length - 1];
    if (p && v.t0 < p.t1) {
      if (hav(p.lat, p.lon, v.lat, v.lon) < 200) {
        if (v.t1 > p.t1) p.t1 = v.t1;
        p.name ||= v.name; p.pid ||= v.pid; p.type ||= v.type; p.derived = p.derived && v.derived;
        continue;
      }
      if (v.t1 <= p.t1) continue;
      v = { ...v, t0: p.t1 };
      if (v.t1 - v.t0 < 5 * MIN) continue;
    }
    out.push(v);
  }
  return out;
}
function resolveTrips(ts) {
  ts.sort((a, b) => a.t0 - b.t0);
  const out = [];
  for (const t of ts) {
    const p = out[out.length - 1];
    if (p && t.t0 < p.t1) {
      const ov = Math.min(p.t1, t.t1) - t.t0, sh = Math.min(p.t1 - p.t0, t.t1 - t.t0) || 1;
      if (ov / sh > 0.5) { if (p.mode === 'other' && t.mode !== 'other') { p.mode = t.mode; p.rawMode = t.rawMode; } continue; }
    }
    out.push(t);
  }
  return out;
}
function inferMode(path, dist, dur) {
  const v = dist / Math.max(1, dur / 1000);
  if (dist > 150000 && v > 45) return 'flight';
  const sp = [];
  for (let i = 1; i < path.length; i++) {
    const dt = (path[i][0] - path[i - 1][0]) / 1000;
    if (dt > 5 && dt < 900) sp.push(hav(path[i - 1][1], path[i - 1][2], path[i][1], path[i][2]) / dt);
  }
  sp.sort((a, b) => a - b);
  const p85 = sp.length ? sp[Math.floor(sp.length * 0.85)] : v;
  if (p85 < 2.6 && v < 2.2) return 'walk';
  if (p85 < 7.5 && v < 6) return 'cycle';
  if (dist > 150000 && v > 45) return 'flight';
  return 'road';
}
function localFields(o, t, off) {
  const L = t + off * MIN;
  o.day = Math.floor(L / DAY);
  o.hod = (((L % DAY) + DAY) % DAY) / HOUR;
  o.h = Math.floor(o.hod);
  o.dow = (o.day + 3) % 7;
  o.mon = monthOfDay(o.day);
  o.wk = Math.floor((o.day + 3) / 7);
}

/* raw -> finished source. merge=true dedupes records from several devices. */
function finalize(raw, id, { merge = false } = {}) {
  const P = raw.P;
  const tt = P.t.slice(), la = P.lat.slice(), lo = P.lon.slice(), ac = P.acc.slice(), of = P.off.slice();
  const push = (t, a, b, off) => { if (!isFinite(a) || !isFinite(b)) return; tt.push(t); la.push(a); lo.push(b); ac.push(-1); of.push(off ?? null); };
  for (const v of raw.visits) { push(v.t0, v.lat, v.lon, v.off); push(v.t1, v.lat, v.lon, v.off); }
  for (const t of raw.trips) {
    push(t.t0, t.lat0, t.lon0, t.off); push(t.t1, t.lat1, t.lon1, t.off);
    if (t.mode !== 'flight') for (const p of t.path) push(p[0], p[1], p[2], t.off);
  }
  const N = tt.length;
  const idx = new Uint32Array(N);
  for (let i = 0; i < N; i++) idx[i] = i;
  idx.sort((a, b) => tt[a] - tt[b]);
  const gap = merge ? 20000 : 999;
  const T = [], LA = [], LO = [], OF = [], AC = [];
  let lastKnownOff = null;
  for (let k = 0; k < N; k++) {
    const i = idx[k], t = tt[i];
    const n = T.length;
    if (n && t - T[n - 1] < gap) {
      if (ac[i] >= 0 && (AC[n - 1] < 0 || ac[i] < AC[n - 1])) { LA[n - 1] = la[i]; LO[n - 1] = lo[i]; AC[n - 1] = ac[i]; }
      continue;
    }
    let off = of[i];
    if (off == null) off = lastKnownOff != null ? lastKnownOff : browserOff(t); else lastKnownOff = off;
    T.push(t); LA.push(la[i]); LO.push(lo[i]); OF.push(off); AC.push(ac[i]);
  }
  const src = {
    id, name: raw.name, kind: raw.kind, files: raw.files, raw,
    T: Float64Array.from(T), LA: Float64Array.from(LA), LO: Float64Array.from(LO), OF: Int16Array.from(OF),
    visits: [], trips: []
  };
  const offAt = t => { const n = src.T.length; if (!n) return browserOff(t); const i = Math.min(n - 1, bisect(src.T, t)); return src.OF[i]; };
  const slice = (t0, t1) => { const a = bisect(src.T, t0), b = bisect(src.T, t1 + 1); const out = []; for (let i = a; i < b; i++) out.push([src.T[i], src.LA[i], src.LO[i]]); return out; };

  // ---- visits
  let visits = raw.visits.map(v => ({ ...v }));
  src.derivedVisits = !visits.length;
  if (!visits.length) visits = detectStays(src.T, src.LA, src.LO);
  visits = resolveVisits(visits).filter(v => v.t1 - v.t0 >= 3 * MIN);

  // ---- trips
  let trips = raw.trips.map(t => ({ ...t, path: t.path }));
  src.derivedTrips = !trips.length;
  if (!trips.length) {
    // moving segments = records outside any visit, split at long gaps
    const n = src.T.length, vs = visits;
    let vi = 0, seg = [];
    const flush = () => {
      if (seg.length >= 2) {
        const a = seg[0], b = seg[seg.length - 1];
        // attach to neighbouring visits
        const before = vs.filter(v => v.t1 <= a[0] && a[0] - v.t1 < 25 * MIN).pop();
        const after = vs.find(v => v.t0 >= b[0] && v.t0 - b[0] < 25 * MIN);
        const path = [...(before ? [[before.t1, before.lat, before.lon]] : []), ...seg, ...(after ? [[after.t0, after.lat, after.lon]] : [])];
        const p0 = path[0], p1 = path[path.length - 1];
        if (pathLen(path) > 120) trips.push({ t0: p0[0], t1: p1[0], lat0: p0[1], lon0: p0[2], lat1: p1[1], lon1: p1[2], dist: null, mode: null, rawMode: '', path, off: null, inferred: true, own: true });
      }
      seg = [];
    };
    for (let i = 0; i < n; i++) {
      const t = src.T[i];
      while (vi < vs.length && vs[vi].t1 < t) vi++;
      const inVisit = vi < vs.length && t >= vs[vi].t0 && t <= vs[vi].t1;
      if (inVisit) { flush(); continue; }
      if (seg.length && t - seg[seg.length - 1][0] > 20 * MIN) flush();
      seg.push([t, src.LA[i], src.LO[i]]);
    }
    flush();
    // visit-to-visit jumps with no records between them
    trips.sort((a, b) => a.t0 - b.t0);
    const starts = trips.map(t => t.t0);
    for (let k = 0; k + 1 < vs.length; k++) {
      const a = vs[k], b = vs[k + 1];
      const dd = hav(a.lat, a.lon, b.lat, b.lon);
      if (dd < 150) continue;
      const j = bisect(starts, a.t1 - 25 * MIN);
      if (j < trips.length && trips[j].t0 <= b.t0) continue;
      const dur = b.t0 - a.t1;
      if (dur > 8 * HOUR && dd / Math.max(1, dur / 1000) < 45) continue; // long gap, not a flight: unknown route
      trips.push({ t0: a.t1, t1: b.t0, lat0: a.lat, lon0: a.lon, lat1: b.lat, lon1: b.lon, dist: null, mode: null, rawMode: '', path: [], off: null, inferred: true });
    }
  }
  trips = resolveTrips(trips);
  for (const t of trips) {
    let path;
    if (t.own) path = t.path;
    else {
      const inner = slice(t.t0, t.t1);
      const start = [t.t0, t.lat0, t.lon0], end = [t.t1, t.lat1, t.lon1];
      path = [start, ...inner.filter(p => p[0] > t.t0 && p[0] < t.t1), end];
    }
    const straight = hav(t.lat0, t.lon0, t.lat1, t.lon1);
    let dist = t.dist != null && t.dist > 0 ? +t.dist : Math.max(straight, pathLen(path));
    const dur = Math.max(1000, t.t1 - t.t0);
    if (!t.mode && t.own && raw.modeHint) { t.mode = raw.modeHint; t.rawMode = raw.modeHintRaw; t.inferred = false; }
    if (!t.mode) { t.mode = inferMode(path, dist, dur); t.inferred = true; }
    if (t.mode === 'flight' || (straight > 150000 && straight / (dur / 1000) > 45)) {
      t.mode = 'flight';
      path = greatCircle(t.t0, t.t1, t.lat0, t.lon0, t.lat1, t.lon1);
      dist = Math.max(dist, straight);
    }
    t.path = thinPath(path);
    t.dist = dist; t.dur = dur;
  }
  trips = trips.filter(t => t.dist > 30 || t.mode === 'flight');
  // Hours-long "trips" that average under 1 km/h are gaps in the record (phone off or offline), not travel.
  const n0 = trips.length;
  trips = trips.filter(t => t.mode === 'flight' || !(t.dur > 2 * HOUR && t.dist / (t.dur / HOUR) < 1000));
  src.gapTrips = n0 - trips.length;

  for (const v of visits) {
    v.src = id; v.dur = v.t1 - v.t0; v.off = v.off ?? offAt(v.t0);
    localFields(v, v.t0, v.off); v.place = -1;
  }
  for (const t of trips) {
    t.src = id; t.off = t.off ?? offAt(t.t0);
    localFields(t, t.t0, t.off); t.from = -1; t.to = -1;
  }
  src.visits = visits; src.trips = trips;
  src.t0 = Math.min(src.T[0] ?? Infinity, visits[0]?.t0 ?? Infinity, trips[0]?.t0 ?? Infinity);
  src.t1 = Math.max(src.T[src.T.length - 1] ?? -Infinity, visits[visits.length - 1]?.t1 ?? -Infinity, trips[trips.length - 1]?.t1 ?? -Infinity);
  return src;
}

/* build the raw for a combined source from finished sources */
function combinedRaw(sources) {
  const r = newRaw('All devices', 'combined');
  for (const s of sources) {
    for (let i = 0; i < s.T.length; i++) { r.P.t.push(s.T[i]); r.P.lat.push(s.LA[i]); r.P.lon.push(s.LO[i]); r.P.acc.push(-1); r.P.off.push(s.OF[i]); }
    for (const v of s.visits) r.visits.push({ t0: v.t0, t1: v.t1, lat: v.lat, lon: v.lon, pid: v.pid, name: v.name, type: v.type, off: v.off, derived: v.derived });
    for (const t of s.trips) r.trips.push({ t0: t.t0, t1: t.t1, lat0: t.lat0, lon0: t.lon0, lat1: t.lat1, lon1: t.lon1, dist: t.dist, mode: t.mode, rawMode: t.rawMode, path: t.mode === 'flight' ? [] : t.path, off: t.off, inferred: t.inferred });
    r.files.push(...s.files);
  }
  return r;
}
function joinRaws(a, b) {
  const r = newRaw(a.name, a.kind === b.kind ? a.kind : 'mixed');
  for (const x of [a, b]) {
    for (const k of ['t', 'lat', 'lon', 'acc', 'off']) for (const v of x.P[k]) r.P[k].push(v);
    r.visits.push(...x.visits); r.trips.push(...x.trips); r.files.push(...x.files);
  }
  return r;
}

/* ---------- reading files, zips and folders ---------- */
async function readEntries(dt) {
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
async function loadFiles(fileList, onStep) {
  const ctx = { deviceNames: new Map(), semantic: null };
  const raws = [], errors = [];
  let files = [...fileList];
  // expand zips
  const expanded = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      if (typeof JSZip === 'undefined') { errors.push(`${f.name}: zip support did not load. Unzip the archive and drop the folder.`); continue; }
      onStep(`Opening ${f.name}`, fmtSize(f.size));
      await sleep(20);
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
      const got = detectAndParse(f.name, text, ctx);
      raws.push(...got);
    } catch (e) {
      errors.push(e.message && e.message.includes(f.name) ? e.message : `${f.name}: ${e.message || 'the browser could not read this file.'}`);
    }
  }
  return { raws: raws.filter(r => r.P.t.length || r.visits.length || r.trips.length), errors, skipped: expanded.length - jsonish.length };
}
function fmtSize(b) { if (!b) return ''; if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'; if (b > 1e6) return (b / 1e6).toFixed(0) + ' MB'; return Math.max(1, Math.round(b / 1e3)) + ' kB'; }
