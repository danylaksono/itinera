/* ================================================================
   Part B: analytics context, filtering, aggregates
   ================================================================ */
const MODES = [
  { k: 'walk', label: 'Walk and run', L: '#2B7A66', D: '#5FC4A6' },
  { k: 'cycle', label: 'Cycling', L: '#6E962A', D: '#A9D26A' },
  { k: 'road', label: 'Road', L: '#B07C12', D: '#E8B64A' },
  { k: 'transit', label: 'Rail and transit', L: '#1D4E89', D: '#78A9E4' },
  { k: 'flight', label: 'Flying', L: '#6A4A98', D: '#B99AEA' },
  { k: 'other', label: 'Other', L: '#7A868C', D: '#8C999F' }
];
const MODE_IDX = Object.fromEntries(MODES.map((m, i) => [m.k, i]));
const INKS_L = ['#B3322B', '#1D4E89', '#2B7A66', '#B07C12', '#6A4A98', '#7A5230', '#3E7C8C', '#9C3D6E'];
const INKS_D = ['#F2806F', '#78A9E4', '#5FC4A6', '#E8B64A', '#B99AEA', '#D2A77E', '#79C3D3', '#E48DB8'];
const HOUR_STOPS = [[0, '#27306A'], [4, '#3B3F8C'], [6.5, '#C9772C'], [9, '#D9A43A'], [13, '#B9B23C'], [17, '#D07A2E'], [19.5, '#B23F37'], [22, '#5A2E6A'], [24, '#27306A']];
const HOUR_STOPS_D = [[0, '#6F7FE0'], [4, '#8D86E8'], [6.5, '#F0A55A'], [9, '#F2C66A'], [13, '#D7D46A'], [17, '#F0A05A'], [19.5, '#EF7A6B'], [22, '#B77CD6'], [24, '#6F7FE0']];

const S = {
  sources: [], merged: null, mode: 'separate', colorBy: 'device', view: 'map', modeMetric: 'dist',
  hidden: new Set(),
  filter: { t0: null, t1: null, hours: null, dows: null, modes: null, place: null },
  layers: { trails: true, heat: true, places: true, flows: false, ellipse: false, streets: false },
  ctx: null, res: null, selPlace: null, openPlace: null,
  play: { on: false, session: false, clock: null, speed: 46, skip: true, follow: false }
};
let nextSrcId = 0;
const isDark = () => document.documentElement.dataset.dark === '1';
const inkOf = src => (isDark() ? INKS_D : INKS_L)[src.colorIdx % INKS_L.length];
const modeColor = k => MODES[MODE_IDX[k] ?? 5][isDark() ? 'D' : 'L'];
function hourColor(h) {
  const st = isDark() ? HOUR_STOPS_D : HOUR_STOPS;
  for (let i = 1; i < st.length; i++) if (h <= st[i][0]) { const [a, ca] = st[i - 1], [b, cb] = st[i]; return d3.interpolateRgb(ca, cb)((h - a) / (b - a)); }
  return st[0][1];
}
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function activeSources() { return S.mode === 'combined' ? (S.merged ? [S.merged] : []) : S.sources; }
function visibleSources() { return activeSources().filter(s => !S.hidden.has(s.id)); }
function srcById(id) { return S.mode === 'combined' ? S.merged : S.sources.find(s => s.id === id); }

/* ---------- countries ---------- */
let WORLD = null;
function initWorld() {
  if (WORLD || typeof WORLD_TOPO === 'undefined') return;
  const countries = topojson.feature(WORLD_TOPO, WORLD_TOPO.objects.countries).features;
  for (const f of countries) f.bbox = turf.bbox(f);
  WORLD = {
    countries,
    land: topojson.feature(WORLD_TOPO, WORLD_TOPO.objects.land),
    borders: topojson.mesh(WORLD_TOPO, WORLD_TOPO.objects.countries, (a, b) => a !== b)
  };
}
const _ccache = new Map();
function countryAt(lat, lon) {
  if (!WORLD) return null;
  const key = lat.toFixed(2) + ',' + lon.toFixed(2);
  if (_ccache.has(key)) return _ccache.get(key);
  let best = null;
  const pt = [lon, lat];
  for (const f of WORLD.countries) {
    const b = f.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (turf.booleanPointInPolygon(pt, f)) { best = f.properties.name; break; }
  }
  if (!best) { // coast: nearest bbox centre within ~30 km
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

/* ---------- nearest town: GeoNames places over 15,000 people, built into the page (no network) ---------- */
let GZ = null;
function nearTown(lat, lon, maxD = 30000) {
  if (!GZ) {
    if (typeof GAZ === 'undefined') return null;
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

/* ---------- context: places, roles, per-day indices ---------- */
function loadNames() { try { return JSON.parse(localStorage.getItem('itinera-names') || '{}'); } catch (e) { return {}; } }
function saveName(key, name) { try { const n = loadNames(); if (name) n[key] = name; else delete n[key]; localStorage.setItem('itinera-names', JSON.stringify(n)); } catch (e) { } }
const placeKey = p => p.lat.toFixed(3) + ',' + p.lon.toFixed(3);

/* Home can change over time (moving house or country). Each local month, the candidate home is the
   place with most night hours (00-06), with visits that Google labels HOME weighted 1.5x. A run of up
   to 2 months elsewhere between the same home is travel; up to 3 months without evidence between the
   same home is filled. Longer gaps stay unknown, so a home is never carried across a data gap. */
function homePeriods(nightMon, nightVisits, offOf) {
  const ms = [...nightMon.keys()]; if (!ms.length) return [];
  const m0 = Math.min(...ms), n = Math.max(...ms) - m0 + 1;
  const cand = new Int32Array(n).fill(-1);
  for (const [m, mm] of nightMon) { let best = -1, bh = 24 * HOUR; for (const [pi, h] of mm) if (h > bh) { bh = h; best = pi; } cand[m - m0] = best; }
  const runs = () => { const r = []; for (let i = 0; i < n; i++) { const l = r[r.length - 1]; if (l && l.p === cand[i]) l.b = i; else r.push({ p: cand[i], a: i, b: i }); } return r; };
  for (let pass = 0; pass < 2; pass++) {
    const r = runs();
    for (let k = 1; k + 1 < r.length; k++) {
      const x = r[k], around = r[k - 1].p;
      if (around >= 0 && around === r[k + 1].p && x.b - x.a < (x.p < 0 ? 3 : 2)) cand.fill(around, x.a, x.b + 1);
    }
  }
  const monStart = (m, pi) => Date.UTC(Math.floor(m / 12), m % 12, 1) - offOf(pi) * MIN;
  const out = runs().filter(x => x.p >= 0).map(x => ({ place: x.p, t0: monStart(m0 + x.a, x.p), t1: monStart(m0 + x.b + 1, x.p), mon0: m0 + x.a, mon1: m0 + x.b }));
  // a move inside a month: the new home starts with its first night there
  for (let k = 1; k < out.length; k++) {
    const a = out[k - 1], b = out[k];
    if (a.mon1 + 1 !== b.mon0) continue;
    const first = nightVisits.find(([t, pi]) => pi === b.place && t >= monStart(a.mon1, a.place) && t < b.t1);
    if (first) a.t1 = b.t0 = first[0];
  }
  return out;
}
function homeAt(t, ctx = S.ctx) {
  const k = bisect(ctx.homeT0, t + 1) - 1;
  return k >= 0 && t < ctx.homes[k].t1 ? ctx.homes[k].place : -1;
}

function buildContext() {
  const srcs = activeSources();
  const ctx = { places: [], home: -1, work: -1 };
  const allV = [], allT = [];
  for (const s of srcs) { allV.push(...s.visits); allT.push(...s.trips); }
  ctx.allV = allV; ctx.allT = allT;

  // ---- cluster visits into places
  const CELL = 0.0025, grid = new Map(), byPid = new Map();
  const order = allV.slice().sort((a, b) => b.dur - a.dur);
  const places = ctx.places;
  const gk = (a, b) => a + ':' + b;
  const nightMon = new Map(), nightVisits = [];
  for (const v of order) {
    let pi = -1;
    if (v.pid && byPid.has(v.pid)) pi = byPid.get(v.pid);
    if (pi < 0) {
      const gx = Math.floor(v.lon / CELL), gy = Math.floor(v.lat / CELL);
      let bd = 160;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(gk(gx + dx, gy + dy)); if (!arr) continue;
        for (const k of arr) { const p = places[k]; const d = hav(p.lat, p.lon, v.lat, v.lon); if (d < bd) { bd = d; pi = k; } }
      }
    }
    if (pi < 0) {
      pi = places.length;
      places.push({ i: pi, lat: v.lat, lon: v.lon, off: v.off, dur: 0, n: 0, names: new Map(), types: new Map(), pids: new Set(), first: Infinity, last: -Infinity, night: 0, workish: 0, homeTyped: 0 });
      const k = gk(Math.floor(v.lon / CELL), Math.floor(v.lat / CELL));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(pi);
    }
    const p = places[pi];
    v.place = pi; p.dur += v.dur; p.n++;
    if (v.pid) { p.pids.add(v.pid); byPid.set(v.pid, pi); }
    if (v.name) p.names.set(v.name, (p.names.get(v.name) || 0) + v.dur);
    if (v.type) p.types.set(v.type, (p.types.get(v.type) || 0) + v.dur);
    if (/HOME/i.test(v.type || '')) p.homeTyped += v.dur;
    p.first = Math.min(p.first, v.t0); p.last = Math.max(p.last, v.t1);
    // night (00-06 local) and weekday office hours (09-17) overlap
    let t = v.t0, slept = false;
    const L = v.off * MIN, homeW = /HOME/i.test(v.type || '') ? 1.5 : 1;
    while (t < v.t1) {
      const lt = t + L, dayStart = Math.floor(lt / DAY) * DAY - L;
      const dow = (Math.floor(lt / DAY) + 3) % 7;
      const n0 = dayStart, n1 = dayStart + 6 * HOUR, w0 = dayStart + 9 * HOUR, w1 = dayStart + 17 * HOUR;
      const nh = Math.max(0, Math.min(v.t1, n1) - Math.max(v.t0, n0));
      if (nh > 0) {
        p.night += nh; slept = true;
        const m = monthOfDay(Math.floor(lt / DAY));
        let mm = nightMon.get(m); if (!mm) nightMon.set(m, mm = new Map());
        mm.set(pi, (mm.get(pi) || 0) + nh * homeW);
      }
      if (dow < 5) p.workish += Math.max(0, Math.min(v.t1, w1) - Math.max(v.t0, w0));
      t = dayStart + DAY;
    }
    if (slept) nightVisits.push([v.t0, pi]);
  }
  nightVisits.sort((a, b) => a[0] - b[0]);
  // ---- names and roles
  const saved = loadNames();
  const topType = p => [...p.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const homes = homePeriods(nightMon, nightVisits, pi => places[pi].off);
  for (const h of homes) h.labelled = places[h.place].homeTyped >= DAY; // Google labels it home, at least for a day in total
  ctx.homes = homes; ctx.homeT0 = homes.map(h => h.t0);
  ctx.homeSet = new Set(homes.map(h => h.place));
  const home = homes.length ? homes[homes.length - 1].place : -1; // the latest home
  let workT = -1;
  places.forEach((p, i) => {
    if (/WORK/i.test(topType(p)) && !ctx.homeSet.has(i) && (workT < 0 || p.dur > places[workT].dur)) workT = i;
  });
  let work = workT;
  if (work < 0) {
    let best = -1, bw = 40 * HOUR;
    places.forEach((p, i) => { if (!ctx.homeSet.has(i) && p.workish > bw) { bw = p.workish; best = i; } });
    work = best;
  }
  ctx.home = home; ctx.work = work;
  const yr = t => new Date(t).getUTCFullYear();
  places.forEach((p, i) => {
    p.key = placeKey(p);
    p.name = [...p.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    p.role = ctx.homeSet.has(i) ? 'Home' : i === work ? 'Work' : null;
    p.roleSpan = '';
    if (ctx.homeSet.has(i) && ctx.homeSet.size > 1) {
      const ys = new Set();
      for (const h of homes) if (h.place === i) for (let y = yr(h.t0); y <= yr(h.t1 - 1); y++) ys.add(y);
      const a = [...ys].sort(), runs = [];
      for (const y of a) { const r = runs[runs.length - 1]; if (r && y === r[1] + 1) r[1] = y; else runs.push([y, y]); }
      p.roleSpan = runs.map(([x, y]) => x === y ? String(x) : `${x}–${y}`).join(', ');
    }
    p.inferredRole = ctx.homeSet.has(i) ? !homes.some(h => h.place === i && h.labelled) : (i === work && workT < 0);
    p.country = countryAt(p.lat, p.lon);
    p.town = nearTown(p.lat, p.lon);
    p.custom = saved[p.key] || null;
  });
  // rank for default labels
  const rank = places.map((p, i) => i).sort((a, b) => places[b].dur - places[a].dur);
  rank.forEach((pi, r) => { places[pi].rank = r + 1; });
  places.forEach(p => { p.label = defaultLabel(p); });

  // ---- trips: from / to places
  for (const s of srcs) {
    const vs = s.visits, starts = vs.map(v => v.t0);
    for (const t of s.trips) {
      let k = bisect(starts, t.t0 + 1) - 1; // last visit starting before trip
      if (k >= 0 && Math.abs(vs[k].t1 - t.t0) < 3 * HOUR) t.from = vs[k].place; else t.from = -1;
      k = bisect(starts, t.t1 - 5 * MIN);
      if (k < vs.length && Math.abs(vs[k].t0 - t.t1) < 3 * HOUR) t.to = vs[k].place; else t.to = -1;
    }
  }
  // ---- time span
  let t0 = Infinity, t1 = -Infinity;
  for (const s of srcs) { if (isFinite(s.t0)) t0 = Math.min(t0, s.t0); if (isFinite(s.t1)) t1 = Math.max(t1, s.t1); }
  ctx.t0 = t0; ctx.t1 = t1;
  const offRef = srcs[0]?.OF?.[0] ?? 0;
  ctx.day0 = Math.floor((t0 + offRef * MIN) / DAY) - 1;
  ctx.day1 = Math.floor((t1 + offRef * MIN) / DAY) + 1;
  ctx.nDays = ctx.day1 - ctx.day0 + 1;
  ctx.homeByDay = Int32Array.from({ length: ctx.nDays }, (_, d) => homeAt((ctx.day0 + d) * DAY + 12 * HOUR - offRef * MIN, ctx));
  ctx.mon0 = monthOfDay(ctx.day0); ctx.mon1 = monthOfDay(ctx.day1);
  ctx.wk0 = Math.floor((ctx.day0 + 3) / 7); ctx.wk1 = Math.floor((ctx.day1 + 3) / 7);
  // first-visit month per place (for "new places")
  for (const p of places) p.firstMon = monthOfDay(Math.floor((p.first + offRef * MIN) / DAY));
  // ---- coverage per source per day
  ctx.cover = new Map();
  for (const s of srcs) {
    const arr = new Uint32Array(ctx.nDays);
    for (let i = 0; i < s.T.length; i++) { const d = Math.floor((s.T[i] + s.OF[i] * MIN) / DAY) - ctx.day0; if (d >= 0 && d < ctx.nDays) arr[d]++; }
    ctx.cover.set(s.id, arr);
  }
  // ---- intervals with movement (for skipping stays in playback)
  const iv = allT.map(t => [t.t0, t.t1]).sort((a, b) => a[0] - b[0]);
  const mv = [];
  for (const x of iv) { const p = mv[mv.length - 1]; if (p && x[0] <= p[1] + 10 * MIN) p[1] = Math.max(p[1], x[1]); else mv.push([x[0], x[1]]); }
  ctx.moving = mv; ctx.movingStarts = mv.map(x => x[0]);
  S.ctx = ctx;
  if (S.filter.place != null && S.filter.place >= places.length) S.filter.place = null;
}

function defaultLabel(p) {
  if (p.custom || p.name) return p.custom || p.name;
  if (p.role) return p.roleSpan ? `${p.role}${p.town ? ', ' + p.town : ''} (${p.roleSpan})` : p.role;
  return `Place ${p.rank}${p.town || p.country ? ', ' + (p.town || p.country) : ''}`;
}

/* ---------- filtering ---------- */
function passes(it, except, isTrip) {
  const f = S.filter;
  if (S.hidden.has(it.src)) return false;
  if (except !== 'time' && f.t0 != null && (it.t1 < f.t0 || it.t0 > f.t1)) return false;
  if (except !== 'rhythm') {
    if (f.hours && !f.hours.has(it.h)) return false;
    if (f.dows && !f.dows.has(it.dow)) return false;
  }
  if (isTrip && except !== 'modes' && f.modes && !f.modes.has(it.mode)) return false;
  if (except !== 'place' && f.place != null) {
    if (isTrip) { if (it.from !== f.place && it.to !== f.place) return false; }
    else if (it.place !== f.place) return false;
  }
  return true;
}
function clipDur(v) {
  const f = S.filter;
  if (f.t0 == null) return v.dur;
  return Math.max(0, Math.min(v.t1, f.t1) - Math.max(v.t0, f.t0));
}
function rog(visits, durFn) {
  let W = 0, sx = 0, sy = 0;
  for (const v of visits) { const w = durFn(v); if (!w) continue; W += w; sx += w * v.lon; sy += w * v.lat; }
  if (!W) return 0;
  const cx = sx / W, cy = sy / W;
  let s2 = 0;
  for (const v of visits) { const w = durFn(v); if (!w) continue; const d = hav(cy, cx, v.lat, v.lon); s2 += w * d * d; }
  return Math.sqrt(s2 / W);
}

function compute() {
  const ctx = S.ctx; if (!ctx) return null;
  const srcs = activeSources();
  const res = {};
  const nM = ctx.mon1 - ctx.mon0 + 1, nW = ctx.wk1 - ctx.wk0 + 1, nD = ctx.nDays;

  // ---------- all filters
  const V = [], Tr = [];
  for (const s of srcs) {
    for (const v of s.visits) if (passes(v, null, false)) V.push(v);
    for (const t of s.trips) if (passes(t, null, true)) Tr.push(t);
  }
  res.V = V; res.T = Tr;
  // ---------- KPIs
  const k = {};
  k.dist = Tr.reduce((a, t) => a + t.dist, 0);
  const days = new Set(); V.forEach(v => days.add(v.day)); Tr.forEach(t => days.add(t.day));
  k.days = days.size;
  const pl = new Set(V.map(v => v.place)); k.places = pl.size;
  const cs = new Set(); pl.forEach(i => { const c = ctx.places[i]?.country; if (c) cs.add(c); }); k.countries = cs.size; k.countryList = [...cs];
  k.rog = rog(V, clipDur);
  // share of stay time at the home of that time; months with no known home are left out
  let tot = 0, hm = 0;
  for (const v of V) { const h = homeAt(v.t0); if (h < 0) continue; const d = clipDur(v); tot += d; if (v.place === h) hm += d; }
  k.home = tot ? hm / tot : null;
  res.kpi = k;

  // ---------- except time: monthly/daily/weekly series
  const Vx = [], Tx = [];
  for (const s of srcs) {
    for (const v of s.visits) if (passes(v, 'time', false)) Vx.push(v);
    for (const t of s.trips) if (passes(t, 'time', true)) Tx.push(t);
  }
  const mDist = new Float64Array(nM), mDays = new Map(), mNew = new Float64Array(nM), mCountry = new Map(), mRogV = new Map(), mHome = new Float64Array(nM), mTot = new Float64Array(nM);
  for (const t of Tx) { const m = t.mon - ctx.mon0; if (m >= 0 && m < nM) mDist[m] += t.dist; const key = t.mon; if (!mDays.has(key)) mDays.set(key, new Set()); mDays.get(key).add(t.day); }
  const seenPlace = new Set();
  for (const v of Vx) {
    const m = v.mon - ctx.mon0; if (m < 0 || m >= nM) continue;
    if (!mDays.has(v.mon)) mDays.set(v.mon, new Set()); mDays.get(v.mon).add(v.day);
    const p = ctx.places[v.place];
    if (p && p.firstMon === v.mon && !seenPlace.has(v.place)) { seenPlace.add(v.place); mNew[m]++; }
    if (p?.country) { if (!mCountry.has(v.mon)) mCountry.set(v.mon, new Set()); mCountry.get(v.mon).add(p.country); }
    if (!mRogV.has(v.mon)) mRogV.set(v.mon, []); mRogV.get(v.mon).push(v);
    const h = homeAt(v.t0); if (h >= 0) { mTot[m] += v.dur; if (v.place === h) mHome[m] += v.dur; }
  }
  const mon = i => ctx.mon0 + i;
  res.monthly = {
    dist: Array.from(mDist),
    days: Array.from({ length: nM }, (_, i) => mDays.get(mon(i))?.size || 0),
    places: Array.from(mNew),
    countries: Array.from({ length: nM }, (_, i) => mCountry.get(mon(i))?.size || 0),
    rog: Array.from({ length: nM }, (_, i) => rog(mRogV.get(mon(i)) || [], v => v.dur)),
    home: Array.from({ length: nM }, (_, i) => mTot[i] ? mHome[i] / mTot[i] : 0)
  };
  // daily distance per source + distance from home
  res.daily = new Map();
  for (const s of srcs) res.daily.set(s.id, new Float64Array(nD));
  const far = new Float64Array(nD);
  for (const t of Tx) {
    const d = t.day - ctx.day0; if (d < 0 || d >= nD) continue;
    res.daily.get(t.src)[d] += t.dist;
    const home = ctx.places[ctx.homeByDay[d]];
    if (home) far[d] = Math.max(far[d], hav(home.lat, home.lon, t.lat1, t.lon1), hav(home.lat, home.lon, t.lat0, t.lon0));
  }
  for (const v of Vx) {
    const d0 = v.day - ctx.day0, d1 = Math.min(nD - 1, d0 + Math.floor(v.dur / DAY) + 1);
    for (let d = Math.max(0, d0); d <= d1; d++) { const home = ctx.places[ctx.homeByDay[d]]; if (home) far[d] = Math.max(far[d], hav(home.lat, home.lon, v.lat, v.lon)); }
  }
  res.far = ctx.homes.length ? far : null;
  // per place weekly dwell (except time)
  const plW = new Map();
  for (const v of Vx) {
    let a = plW.get(v.place); if (!a) { a = new Float32Array(nW); plW.set(v.place, a); }
    const w = v.wk - ctx.wk0; if (w >= 0 && w < nW) a[w] += v.dur / HOUR;
  }
  res.placeWeeks = plW;

  // ---------- except rhythm: 7x24 moving minutes, averaged over the days of each weekday that have records
  const R = new Float64Array(7 * 24);
  {
    const f = S.filter;
    const a = f.t0 ?? ctx.t0, b = f.t1 ?? ctx.t1;
    const dr = rangeToDays();
    for (const s of srcs) {
      if (S.hidden.has(s.id)) continue;
      const cov = ctx.cover.get(s.id), nDow = new Float64Array(7), Rs = new Float64Array(7 * 24);
      for (let d = 0; d < cov.length; d++) { const day = ctx.day0 + d; if (cov[d] && (!dr || (day >= dr[0] && day <= dr[1]))) nDow[(day + 3) % 7]++; }
      for (const t of s.trips) {
        if (!passes(t, 'rhythm', true)) continue;
        let x = Math.max(t.t0, a); const end = Math.min(t.t1, b);
        const L = t.off * MIN;
        let guard = 0;
        while (x < end && guard++ < 400) {
          const lt = x + L, hs = Math.floor(lt / HOUR) * HOUR - L, he = hs + HOUR;
          const dur = Math.min(end, he) - x;
          const h = Math.floor((((lt % DAY) + DAY) % DAY) / HOUR), dw = (Math.floor(lt / DAY) + 3) % 7;
          Rs[dw * 24 + h] += dur / MIN;
          x = he;
        }
      }
      for (let i = 0; i < R.length; i++) R[i] += Rs[i] / Math.max(1, nDow[Math.floor(i / 24)]);
    }
    if (S.mode === 'separate') { const n = Math.max(1, visibleSources().length); for (let i = 0; i < R.length; i++) R[i] /= n; }
  }
  res.rhythm = R;

  // ---------- except modes
  const md = MODES.map(m => ({ k: m.k, dist: 0, dur: 0, n: 0 }));
  for (const s of srcs) for (const t of s.trips) { if (!passes(t, 'modes', true)) continue; const m = md[MODE_IDX[t.mode] ?? 5]; m.dist += t.dist; m.dur += t.dur; m.n++; }
  res.modes = md;

  // ---------- places (all filters)
  const pd = new Map();
  for (const v of V) {
    let o = pd.get(v.place);
    if (!o) { o = { i: v.place, dur: 0, n: 0, arr: new Float32Array(24), srcs: new Set(), first: Infinity, last: -Infinity }; pd.set(v.place, o); }
    o.dur += clipDur(v); o.n++; o.arr[v.h]++; o.srcs.add(v.src); o.first = Math.min(o.first, v.t0); o.last = Math.max(o.last, v.t1);
  }
  // keep the selected place in the list even when filters remove it
  res.places = [...pd.values()].sort((a, b) => b.dur - a.dur);
  // ---------- flows
  const fl = new Map();
  for (const t of Tr) {
    if (t.from < 0 || t.to < 0 || t.from === t.to) continue;
    const a = Math.min(t.from, t.to), b = Math.max(t.from, t.to), key = a + '-' + b;
    fl.set(key, (fl.get(key) || 0) + 1);
  }
  res.flows = [...fl.entries()].map(([k, n]) => { const [a, b] = k.split('-').map(Number); return { a, b, n }; }).sort((x, y) => y.n - x.n).slice(0, 300);
  // ---------- activity-space ellipses
  res.ellipses = [];
  if (typeof turf !== 'undefined') {
    const bySrc = new Map();
    for (const v of V) { if (!bySrc.has(v.src)) bySrc.set(v.src, new Map()); const m = bySrc.get(v.src); m.set(v.place, (m.get(v.place) || 0) + clipDur(v)); }
    for (const [sid, m] of bySrc) {
      if (m.size < 3) continue;
      const pts = [...m.entries()].map(([pi, w]) => turf.point([ctx.places[pi].lon, ctx.places[pi].lat], { w: w / HOUR }));
      try { const e = turf.standardDeviationalEllipse(turf.featureCollection(pts), { weight: 'w', steps: 72 }); e.properties = { src: sid }; res.ellipses.push(e); } catch (e) { }
    }
  }
  S.res = res;
  return res;
}

/* ---------- device co-location ---------- */
function posAt(s, t, maxGap = 45 * MIN) {
  // inside a known stay: the stay location
  if (!s._vt0) s._vt0 = Float64Array.from(s.visits.map(v => v.t0));
  const k = bisect(s._vt0, t + 1) - 1;
  if (k >= 0 && t <= s.visits[k].t1) return [s.visits[k].lat, s.visits[k].lon];
  const T = s.T, n = T.length; if (!n) return null;
  const i = bisect(T, t);
  if (i === 0) return T[0] - t < maxGap ? [s.LA[0], s.LO[0]] : null;
  if (i >= n) return t - T[n - 1] < maxGap ? [s.LA[n - 1], s.LO[n - 1]] : null;
  const a = i - 1, dt = T[i] - T[a];
  if (dt > 3 * HOUR) { // a gap in the records: do not guess
    if (t - T[a] < maxGap) return [s.LA[a], s.LO[a]];
    if (T[i] - t < maxGap) return [s.LA[i], s.LO[i]];
    return null;
  }
  const f = dt ? (t - T[a]) / dt : 0;
  return [s.LA[a] + (s.LA[i] - s.LA[a]) * f, s.LO[a] + (s.LO[i] - s.LO[a]) * f];
}
function togetherness(a, b) {
  const t0 = Math.max(a.t0, b.t0), t1 = Math.min(a.t1, b.t1);
  if (!(t1 > t0)) return null;
  const step = Math.max(10 * MIN, (t1 - t0) / 20000);
  let both = 0, near = 0;
  for (let t = t0; t < t1; t += step) {
    const p = posAt(a, t, 20 * MIN), q = posAt(b, t, 20 * MIN);
    if (!p || !q) continue;
    both++; if (hav(p[0], p[1], q[0], q[1]) < 300) near++;
  }
  return both > 12 ? { pct: near / both, hours: both * step / HOUR } : null;
}
