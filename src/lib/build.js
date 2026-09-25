/* Raw source -> finished source: records, stays, trips with local fields. */
import { MIN, HOUR, RAD, hav, bisect, browserOff, localFields } from './util.js';
import { newRaw } from './parse.js';

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

/* raw -> finished source. merge=true dedupes records from several devices. */
export function finalize(raw, id, { merge = false } = {}) {
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
export function combinedRaw(sources) {
  const r = newRaw('All devices', 'combined');
  for (const s of sources) {
    for (let i = 0; i < s.T.length; i++) { r.P.t.push(s.T[i]); r.P.lat.push(s.LA[i]); r.P.lon.push(s.LO[i]); r.P.acc.push(-1); r.P.off.push(s.OF[i]); }
    for (const v of s.visits) r.visits.push({ t0: v.t0, t1: v.t1, lat: v.lat, lon: v.lon, pid: v.pid, name: v.name, type: v.type, off: v.off, derived: v.derived });
    for (const t of s.trips) r.trips.push({ t0: t.t0, t1: t.t1, lat0: t.lat0, lon0: t.lon0, lat1: t.lat1, lon1: t.lon1, dist: t.dist, mode: t.mode, rawMode: t.rawMode, path: t.mode === 'flight' ? [] : t.path, off: t.off, inferred: t.inferred });
    r.files.push(...s.files);
  }
  return r;
}
export function joinRaws(a, b) {
  const r = newRaw(a.name, a.kind === b.kind ? a.kind : 'mixed');
  for (const x of [a, b]) {
    for (const k of ['t', 'lat', 'lon', 'acc', 'off']) for (const v of x.P[k]) r.P[k].push(v);
    r.visits.push(...x.visits); r.trips.push(...x.trips); r.files.push(...x.files);
  }
  return r;
}
