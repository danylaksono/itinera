/* Analytics context (places, roles, per-day indices), linked filtering and aggregates.
   Every function takes the app state `st` explicitly: { sources, merged, mode, hidden, filter, ctx }. */
import { standardDeviationalEllipse, point, featureCollection } from '@turf/turf';
import { MIN, HOUR, DAY, hav, bisect, monthOfDay, browserOff } from './util.js';
import { MODES, MODE_IDX } from './colors.js';
import { countryAt, nearTown } from './geo.js';

export const activeSources = st => st.mode === 'combined' ? (st.merged ? [st.merged] : []) : st.sources;
export const visibleSources = st => activeSources(st).filter(s => !st.hidden.has(s.id));
export const srcById = (st, id) => st.mode === 'combined' ? st.merged : st.sources.find(s => s.id === id);

/* UTC offset of the first active source near time t: the page's reference for "local" days */
export function offNear(st, t) {
  const s = activeSources(st)[0]; if (!s || !s.T.length) return browserOff(t);
  return s.OF[Math.min(s.T.length - 1, bisect(s.T, t))];
}
export const dayToUtc = (st, day) => day * DAY - offNear(st, day * DAY) * MIN;
export function rangeToDays(st) {
  const f = st.filter;
  if (f.t0 == null) return null;
  return [Math.floor((f.t0 + offNear(st, f.t0) * MIN) / DAY), Math.floor((f.t1 - 1 + offNear(st, f.t1) * MIN) / DAY)];
}
export const playRange = st => [st.filter.t0 ?? st.ctx.t0, st.filter.t1 ?? st.ctx.t1];

/* ---------- place names kept in the browser ---------- */
export function loadNames() { try { return JSON.parse(localStorage.getItem('itinera-names') || '{}'); } catch (e) { return {}; } }
export function saveName(key, name) { try { const n = loadNames(); if (name) n[key] = name; else delete n[key]; localStorage.setItem('itinera-names', JSON.stringify(n)); } catch (e) { } }
const placeKey = p => p.lat.toFixed(3) + ',' + p.lon.toFixed(3);

/* Home and work can change over time (moving house, country or job). Each local month, the candidate
   is the place with most evidence: night hours (00-06) for home, weekday 09-17 hours for work, with
   visits that Google labels HOME or WORK weighted 1.5x. A run of up to 2 months elsewhere between the
   same place is travel; up to 3 months without evidence between the same place is filled. Longer gaps
   stay unknown, so a role is never carried across a data gap. */
function rolePeriods(byMon, firstVisits, offOf, minH) {
  const ms = [...byMon.keys()]; if (!ms.length) return [];
  const m0 = Math.min(...ms), n = Math.max(...ms) - m0 + 1;
  const cand = new Int32Array(n).fill(-1);
  for (const [m, mm] of byMon) { let best = -1, bh = minH; for (const [pi, h] of mm) if (h > bh) { bh = h; best = pi; } cand[m - m0] = best; }
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
  // a move inside a month: the new place starts with its first visit that counts as evidence
  for (let k = 1; k < out.length; k++) {
    const a = out[k - 1], b = out[k];
    if (a.mon1 + 1 !== b.mon0) continue;
    const first = firstVisits.find(([t, pi]) => pi === b.place && t >= monStart(a.mon1, a.place) && t < b.t1);
    if (first) a.t1 = b.t0 = first[0];
  }
  return out;
}
export function homeAt(t, ctx) {
  const k = bisect(ctx.homeT0, t + 1) - 1;
  return k >= 0 && t < ctx.homes[k].t1 ? ctx.homes[k].place : -1;
}

export function buildContext(st) {
  const srcs = activeSources(st);
  const ctx = { places: [], home: -1, work: -1 };
  const allV = [], allT = [];
  for (const s of srcs) { allV.push(...s.visits); allT.push(...s.trips); }
  ctx.allV = allV; ctx.allT = allT;

  // ---- cluster visits into places
  const CELL = 0.0025, grid = new Map(), byPid = new Map();
  const order = allV.slice().sort((a, b) => b.dur - a.dur);
  const places = ctx.places;
  const gk = (a, b) => a + ':' + b;
  const nightMon = new Map(), nightVisits = [], workMon = new Map(), workVisits = [];
  const addMon = (map, m, pi, h) => { let mm = map.get(m); if (!mm) map.set(m, mm = new Map()); mm.set(pi, (mm.get(pi) || 0) + h); };
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
      places.push({ i: pi, lat: v.lat, lon: v.lon, off: v.off, dur: 0, n: 0, names: new Map(), types: new Map(), pids: new Set(), first: Infinity, last: -Infinity, night: 0, workish: 0, homeTyped: 0, workTyped: 0 });
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
    if (/WORK/i.test(v.type || '')) p.workTyped += v.dur;
    p.first = Math.min(p.first, v.t0); p.last = Math.max(p.last, v.t1);
    // night (00-06 local) and weekday office hours (09-17) overlap
    let t = v.t0, slept = false, worked = false;
    const L = v.off * MIN, homeW = /HOME/i.test(v.type || '') ? 1.5 : 1, workW = /WORK/i.test(v.type || '') ? 1.5 : 1;
    while (t < v.t1) {
      const lt = t + L, dayStart = Math.floor(lt / DAY) * DAY - L;
      const dow = (Math.floor(lt / DAY) + 3) % 7;
      const n0 = dayStart, n1 = dayStart + 6 * HOUR, w0 = dayStart + 9 * HOUR, w1 = dayStart + 17 * HOUR;
      const nh = Math.max(0, Math.min(v.t1, n1) - Math.max(v.t0, n0));
      if (nh > 0) {
        p.night += nh; slept = true;
        addMon(nightMon, monthOfDay(Math.floor(lt / DAY)), pi, nh * homeW);
      }
      const wh = dow < 5 ? Math.max(0, Math.min(v.t1, w1) - Math.max(v.t0, w0)) : 0;
      if (wh > 0) {
        p.workish += wh; worked = true;
        addMon(workMon, monthOfDay(Math.floor(lt / DAY)), pi, wh * workW);
      }
      t = dayStart + DAY;
    }
    if (slept) nightVisits.push([v.t0, pi]);
    if (worked) workVisits.push([v.t0, pi]);
  }
  nightVisits.sort((a, b) => a[0] - b[0]); workVisits.sort((a, b) => a[0] - b[0]);
  // ---- names and roles
  const saved = loadNames();
  const homes = rolePeriods(nightMon, nightVisits, pi => places[pi].off, 24 * HOUR);
  for (const h of homes) h.labelled = places[h.place].homeTyped >= DAY; // Google labels it home, at least for a day in total
  ctx.homes = homes; ctx.homeT0 = homes.map(h => h.t0);
  ctx.homeSet = new Set(homes.map(h => h.place));
  // work: weekday office hours at a place that is never home, at least 20 h in the month
  for (const mm of workMon.values()) for (const pi of ctx.homeSet) mm.delete(pi);
  const works = rolePeriods(workMon, workVisits, pi => places[pi].off, 20 * HOUR).filter(w => {
    w.labelled = places[w.place].workTyped >= DAY;
    return w.labelled || w.mon1 > w.mon0; // office hours alone need at least two months
  });
  ctx.works = works; ctx.workSet = new Set(works.map(w => w.place));
  ctx.home = homes.length ? homes[homes.length - 1].place : -1; // the latest home
  ctx.work = works.length ? works[works.length - 1].place : -1;
  const yr = t => new Date(t).getUTCFullYear();
  const span = (periods, i) => {
    const ys = new Set();
    for (const h of periods) if (h.place === i) for (let y = yr(h.t0); y <= yr(h.t1 - 1); y++) ys.add(y);
    const runs = [];
    for (const y of [...ys].sort()) { const r = runs[runs.length - 1]; if (r && y === r[1] + 1) r[1] = y; else runs.push([y, y]); }
    return runs.map(([x, y]) => x === y ? String(x) : `${x}–${y}`).join(', ');
  };
  places.forEach((p, i) => {
    p.key = placeKey(p);
    p.name = [...p.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const periods = ctx.homeSet.has(i) ? homes : ctx.workSet.has(i) ? works : null;
    p.role = periods === homes ? 'Home' : periods === works ? 'Work' : null;
    p.roleSpan = periods && new Set(periods.map(h => h.place)).size > 1 ? span(periods, i) : '';
    p.inferredRole = !!periods && !periods.some(h => h.place === i && h.labelled);
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
  markDuplicates(st, ctx);
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
  return ctx;
}

export function defaultLabel(p) {
  if (p.custom || p.name) return p.custom || p.name;
  if (p.role) return p.roleSpan ? `${p.role}${p.town ? ', ' + p.town : ''} (${p.roleSpan})` : p.role;
  return `Place ${p.rank}${p.town || p.country ? ', ' + (p.town || p.country) : ''}`;
}

/* One person, several devices: a person is in one place at a time. Where visible devices overlap in
   time, person-level totals (KPIs, monthly series, modes, place times, flows) count the device that
   covers the most days; the others' overlapping stays and trips get dup = true. A device only moves when
   it is carried, so a trip is dropped only when a higher-ranked device was also moving (a phone left
   at home does not cancel a run recorded by a watch). Devices that cover different periods add up.
   Maps, the cube and the per-device timeline rows still show every device. */
export function markDuplicates(st, ctx) {
  const all = activeSources(st);
  for (const s of all) { for (const v of s.visits) v.dup = false; for (const t of s.trips) t.dup = false; }
  // the main device covers the most days; ties go to the one with more records
  const days = s => s._days ??= new Set(Array.from(s.T, (t, i) => Math.floor((t + s.OF[i] * MIN) / DAY))).size;
  const srcs = all.filter(s => !st.hidden.has(s.id)).sort((a, b) => days(b) - days(a) || b.T.length - a.T.length);
  // sorted, disjoint [t0, t1] intervals from higher-ranked devices: any record (stays and trips), and moving only
  let any = [], moving = [];
  const merge = (cover, add) => {
    const out = [];
    for (const x of [...cover, ...add].sort((a, b) => a[0] - b[0])) { const l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); }
    return out;
  };
  const covered = (cover, starts, a, b) => { let o = 0; for (let k = bisect(starts, b) - 1; k >= 0 && cover[k][1] > a; k--) o += Math.min(b, cover[k][1]) - Math.max(a, cover[k][0]); return o > 0.5 * (b - a); };
  for (const s of srcs) {
    const sa = any.map(c => c[0]), sm = moving.map(c => c[0]), addAny = [], addMove = [];
    for (const v of s.visits) { if (covered(any, sa, v.t0, v.t1)) v.dup = true; else addAny.push([v.t0, v.t1]); }
    for (const t of s.trips) { if (covered(moving, sm, t.t0, t.t1)) t.dup = true; else { addAny.push([t.t0, t.t1]); addMove.push([t.t0, t.t1]); } }
    any = merge(any, addAny); moving = merge(moving, addMove);
  }
  if (ctx) ctx.dupCount = all.reduce((a, s) => a + s.visits.filter(v => v.dup).length + s.trips.filter(t => t.dup).length, 0);
}

/* ---------- filtering: each view ignores its own filter (crossfilter style) ---------- */
export function passes(st, it, except, isTrip) {
  const f = st.filter;
  if (st.hidden.has(it.src)) return false;
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
function rog(visits, durFn) {
  let W = 0, sx = 0, sy = 0;
  for (const v of visits) { const w = durFn(v); if (!w) continue; W += w; sx += w * v.lon; sy += w * v.lat; }
  if (!W) return 0;
  const cx = sx / W, cy = sy / W;
  let s2 = 0;
  for (const v of visits) { const w = durFn(v); if (!w) continue; const d = hav(cy, cx, v.lat, v.lon); s2 += w * d * d; }
  return Math.sqrt(s2 / W);
}

export function compute(st) {
  const ctx = st.ctx; if (!ctx) return null;
  const srcs = activeSources(st), f = st.filter;
  const res = {};
  const nM = ctx.mon1 - ctx.mon0 + 1, nW = ctx.wk1 - ctx.wk0 + 1, nD = ctx.nDays;
  const clipDur = v => f.t0 == null ? v.dur : Math.max(0, Math.min(v.t1, f.t1) - Math.max(v.t0, f.t0));

  // ---------- all filters
  const V = [], Tr = [];
  for (const s of srcs) {
    for (const v of s.visits) if (passes(st, v, null, false)) V.push(v);
    for (const t of s.trips) if (passes(st, t, null, true)) Tr.push(t);
  }
  res.V = V; res.T = Tr;
  const V1 = V.filter(v => !v.dup), T1 = Tr.filter(t => !t.dup); // one person: see markDuplicates()
  // ---------- KPIs
  const k = {};
  k.dist = T1.reduce((a, t) => a + t.dist, 0);
  const days = new Set(); V.forEach(v => days.add(v.day)); Tr.forEach(t => days.add(t.day));
  k.days = days.size;
  const pl = new Set(V1.map(v => v.place)); k.places = pl.size;
  const cs = new Set(); pl.forEach(i => { const c = ctx.places[i]?.country; if (c) cs.add(c); }); k.countries = cs.size; k.countryList = [...cs];
  k.rog = rog(V1, clipDur);
  // share of stay time at the home of that time; months with no known home are left out
  let tot = 0, hm = 0;
  for (const v of V1) { const h = homeAt(v.t0, ctx); if (h < 0) continue; const d = clipDur(v); tot += d; if (v.place === h) hm += d; }
  k.home = tot ? hm / tot : null;
  res.kpi = k;

  // ---------- except time: monthly/daily/weekly series
  const Vx = [], Tx = [];
  for (const s of srcs) {
    for (const v of s.visits) if (!v.dup && passes(st, v, 'time', false)) Vx.push(v);
    for (const t of s.trips) if (!t.dup && passes(st, t, 'time', true)) Tx.push(t);
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
    const h = homeAt(v.t0, ctx); if (h >= 0) { mTot[m] += v.dur; if (v.place === h) mHome[m] += v.dur; }
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
    const a = f.t0 ?? ctx.t0, b = f.t1 ?? ctx.t1;
    const dr = rangeToDays(st);
    for (const s of srcs) {
      if (st.hidden.has(s.id)) continue;
      const cov = ctx.cover.get(s.id), nDow = new Float64Array(7), Rs = new Float64Array(7 * 24);
      for (let d = 0; d < cov.length; d++) { const day = ctx.day0 + d; if (cov[d] && (!dr || (day >= dr[0] && day <= dr[1]))) nDow[(day + 3) % 7]++; }
      for (const t of s.trips) {
        if (!passes(st, t, 'rhythm', true)) continue;
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
    if (st.mode === 'separate') { const n = Math.max(1, visibleSources(st).length); for (let i = 0; i < R.length; i++) R[i] /= n; }
  }
  res.rhythm = R;

  // ---------- except modes
  const md = MODES.map(m => ({ k: m.k, dist: 0, dur: 0, n: 0 }));
  for (const s of srcs) for (const t of s.trips) { if (t.dup || !passes(st, t, 'modes', true)) continue; const m = md[MODE_IDX[t.mode] ?? 5]; m.dist += t.dist; m.dur += t.dur; m.n++; }
  res.modes = md;

  // ---------- places (all filters)
  const pd = new Map();
  for (const v of V1) {
    let o = pd.get(v.place);
    if (!o) { o = { i: v.place, dur: 0, n: 0, arr: new Float32Array(24), srcs: new Set(), first: Infinity, last: -Infinity }; pd.set(v.place, o); }
    o.dur += clipDur(v); o.n++; o.arr[v.h]++; o.srcs.add(v.src); o.first = Math.min(o.first, v.t0); o.last = Math.max(o.last, v.t1);
  }
  res.places = [...pd.values()].sort((a, b) => b.dur - a.dur);
  // ---------- flows
  const fl = new Map();
  for (const t of T1) {
    if (t.from < 0 || t.to < 0 || t.from === t.to) continue;
    const a = Math.min(t.from, t.to), b = Math.max(t.from, t.to), key = a + '-' + b;
    fl.set(key, (fl.get(key) || 0) + 1);
  }
  res.flows = [...fl.entries()].map(([k, n]) => { const [a, b] = k.split('-').map(Number); return { a, b, n }; }).sort((x, y) => y.n - x.n).slice(0, 300);
  // ---------- activity-space ellipses
  res.ellipses = [];
  const bySrc = new Map();
  for (const v of V) { if (!bySrc.has(v.src)) bySrc.set(v.src, new Map()); const m = bySrc.get(v.src); m.set(v.place, (m.get(v.place) || 0) + clipDur(v)); }
  for (const [sid, m] of bySrc) {
    if (m.size < 3) continue;
    const pts = [...m.entries()].map(([pi, w]) => point([ctx.places[pi].lon, ctx.places[pi].lat], { w: w / HOUR }));
    try { const e = standardDeviationalEllipse(featureCollection(pts), { weight: 'w', steps: 72 }); e.properties = { src: sid }; res.ellipses.push(e); } catch (e) { }
  }
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
export function togetherness(a, b) {
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

/* interpolated position of a device at time t, for the playback heads */
export function headAt(s, t) {
  const T = s.T, n = T.length; if (!n) return null;
  const i = bisect(T, t);
  if (i === 0 || i >= n) return null;
  const a = i - 1, dt = T[i] - T[a];
  const f = dt ? (t - T[a]) / dt : 0;
  const stale = Math.min(t - T[a], T[i] - t) > 60 * MIN && hav(s.LA[a], s.LO[a], s.LA[i], s.LO[i]) > 200;
  return { lat: s.LA[a] + (s.LA[i] - s.LA[a]) * f, lon: s.LO[a] + (s.LO[i] - s.LO[a]) * f, stale, i };
}
