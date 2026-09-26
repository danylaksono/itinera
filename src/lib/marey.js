/* Place timetable (a Marey chart): rows are places, stays are bars on their row, trips are lines
   from one row to another. Pure: takes the state, returns rows and segments for the renderer.
   Times are local (each record's own UTC offset), in ms. Layout 'days' stacks every day on one
   24-hour axis (x in hours, split at local midnight); 'calendar' keeps real time (x in local ms). */
import { MIN, HOUR, DAY, hav, bisect } from './util.js';
import { activeSources, srcById, homeAt, passes } from './analytics.js';

export const OTHER = 'other';

function workAt(t, ctx) {
  const w = ctx.works; if (!w?.length) return -1;
  ctx._workT0 ??= w.map(x => x.t0);
  const k = bisect(ctx._workT0, t + 1) - 1;
  return k >= 0 && t < w[k].t1 ? w[k].place : -1;
}
/* the source's own UTC offset at time t (the arrival end of a trip can be in another time zone) */
function offAt(s, t) {
  if (!s?.T.length) return 0;
  return s.OF[Math.min(s.T.length - 1, bisect(s.T, t))];
}
/* nearest place within 300 m, for trip ends with no stay attached (a watch run from home) */
function placeGrid(ctx) {
  if (ctx._mgrid) return ctx._mgrid;
  const C = 0.006, g = new Map();
  ctx.places.forEach((p, i) => { const k = Math.floor(p.lon / C) + ':' + Math.floor(p.lat / C); if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
  return ctx._mgrid = { C, g };
}
function snap(ctx, lat, lon) {
  const { C, g } = placeGrid(ctx), gx = Math.floor(lon / C), gy = Math.floor(lat / C);
  let best = -1, bd = 300;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const i of g.get((gx + dx) + ':' + (gy + dy)) || []) { const p = ctx.places[i]; const d = hav(p.lat, p.lon, lat, lon); if (d < bd) { bd = d; best = i; } }
  }
  return best;
}

/* The row key of place pi at time t: the home or work of that time, or the place itself. In months
   with no known home (a gap between role periods), a place that is home at some time counts as home;
   a visit to a former home while living elsewhere keeps its own row. The same for work. */
function keyOf(ctx, pi, t) {
  if (pi < 0) return OTHER;
  const h = homeAt(t, ctx);
  if (h === pi || (h < 0 && ctx.homeSet.has(pi))) return 'home';
  const w = workAt(t, ctx);
  if (w === pi || (w < 0 && ctx.workSet.has(pi) && !ctx.homeSet.has(pi))) return 'work';
  return pi;
}

/* Items the chart shows. 'days' ignores its own filter (hours), so the brushed context stays
   visible; the weekday filter still applies. 'calendar' uses every filter. */
export function mareyItems(st, layout) {
  const f = st.filter, V = [], T = [];
  const ok = (it, isTrip) => layout === 'days'
    ? passes(st, it, 'rhythm', isTrip) && (!f.dows || f.dows.has(it.dow))
    : passes(st, it, null, isTrip);
  for (const s of activeSources(st)) {
    if (st.hidden.has(s.id)) continue;
    for (const v of s.visits) if (ok(v, false)) V.push(v);
    for (const t of s.trips) if (ok(t, true)) T.push(t);
  }
  return { V, T };
}

/* rows: Home and Work first when known, then the places with most time, ordered by their median
   distance from the home of the time of each stay; the rest share one 'Other places' row. */
export function mareyRows(st, V, maxRows) {
  const ctx = st.ctx;
  const dur = new Map(), dists = new Map(), byPlace = new Map();
  const fallback = ctx.home >= 0 ? ctx.home : null;
  for (const v of V) {
    const k = keyOf(ctx, v.place, v.t0);
    dur.set(k, (dur.get(k) || 0) + v.dur);
    if (typeof k !== 'number' && k !== OTHER) { let m = byPlace.get(k); if (!m) byPlace.set(k, m = new Map()); m.set(v.place, (m.get(v.place) || 0) + v.dur); }
    if (k === OTHER) continue;
    let h = homeAt(v.t0, ctx); if (h < 0) h = fallback;
    const hp = h != null && h >= 0 ? ctx.places[h] : null;
    if (!dists.has(k)) dists.set(k, []);
    dists.get(k).push(hp ? hav(hp.lat, hp.lon, v.lat, v.lon) : NaN);
  }
  const keys = [...dur.keys()].filter(k => k !== OTHER);
  const roles = keys.filter(k => k === 'home' || k === 'work');
  const rest = keys.filter(k => typeof k === 'number').sort((a, b) => dur.get(b) - dur.get(a));
  const n = Math.max(1, maxRows - 1 - roles.length);
  const shown = [...roles, ...rest.slice(0, n)];
  const median = k => { const a = (dists.get(k) || []).filter(x => !isNaN(x)).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : Infinity; };
  const rows = shown.map(k => ({
    key: k, dur: dur.get(k),
    // a role row (Home, Work) selects its place with most time
    place: typeof k === 'number' ? k : [...byPlace.get(k)].sort((a, b) => b[1] - a[1])[0][0],
    dist: k === 'home' ? 0 : median(k),
    label: k === 'home' ? 'Home' : k === 'work' ? 'Work' : ctx.places[k].label
  }));
  rows.sort((a, b) => (a.key === 'home' ? -1 : b.key === 'home' ? 1 : 0) || a.dist - b.dist || b.dur - a.dur);
  const hasOther = rest.length > n || dur.has(OTHER);
  if (hasOther) rows.push({ key: OTHER, place: -1, dur: (dur.get(OTHER) || 0) + rest.slice(n).reduce((a, k) => a + dur.get(k), 0), dist: Infinity, label: 'Other places', count: rest.length - Math.min(rest.length, n) + (dur.has(OTHER) ? 1 : 0) });
  return rows;
}

/* Segments. Stays: { kind: 's', item, r0, r1 = r0 }. Trips: { kind: 't', item, r0, r1, p0, p1, loop, open0, open1 }
   (p0, p1 = the end places, snapped when the trip has no stay there; open = no known place). Every segment covers the fraction f0..f1 of its item:
   the renderer places a trip's y at f with rowY(r0) + (rowY(r1) - rowY(r0)) * f, or an arch for a loop.
   'days' adds day (local day number) and x0, x1 in hours; 'calendar' gives x0, x1 in local ms. */
export function mareySegments(st, layout, rows, V, T) {
  const ctx = st.ctx, idx = new Map(rows.map((r, i) => [r.key, i]));
  let other = idx.has(OTHER) ? idx.get(OTHER) : -1;
  // trips can need the 'Other places' row even when every stay has its own row (mareyRows keeps a slot for it)
  const otherRow = () => { if (other < 0) { rows.push({ key: OTHER, place: -1, dur: 0, dist: Infinity, label: 'Other places', count: 0 }); other = rows.length - 1; } return other; };
  const rowOf = (pi, t) => { const k = keyOf(ctx, pi, t); return idx.has(k) ? idx.get(k) : otherRow(); };
  const out = [];
  const emit = (base, L0, L1) => {
    if (layout === 'calendar') { out.push({ ...base, f0: 0, f1: 1, x0: L0, x1: L1 }); return; }
    const span = L1 - L0;
    for (let d = Math.floor(L0 / DAY), dEnd = Math.floor(Math.max(L0, L1 - 1) / DAY); d <= dEnd; d++) {
      const a = Math.max(L0, d * DAY), b = Math.min(L1, (d + 1) * DAY);
      if (b < a) continue;
      out.push({ ...base, day: d, f0: span > 0 ? (a - L0) / span : 0, f1: span > 0 ? (b - L0) / span : 1, x0: (a - d * DAY) / HOUR, x1: (b - d * DAY) / HOUR });
    }
  };
  for (const v of V) {
    const r = rowOf(v.place, v.t0);
    const s = srcById(st, v.src);
    emit({ kind: 's', item: v, src: v.src, r0: r, r1: r }, v.t0 + v.off * MIN, v.t1 + offAt(s, v.t1) * MIN);
  }
  for (const t of T) {
    let p0 = t.from, p1 = t.to;
    if (p0 < 0) p0 = snap(ctx, t.lat0, t.lon0);
    if (p1 < 0) p1 = snap(ctx, t.lat1, t.lon1);
    const r0 = rowOf(p0, t.t0), r1 = rowOf(p1, t.t1);
    const s = srcById(st, t.src);
    emit({ kind: 't', item: t, src: t.src, r0, r1, p0, p1, loop: r0 === r1, open0: p0 < 0, open1: p1 < 0 }, t.t0 + t.off * MIN, t.t1 + offAt(s, t.t1) * MIN);
  }
  if (layout === 'days') out.sort((a, b) => a.day - b.day);
  return out;
}

/* Everything the renderer needs, in one call. The rows ignore the place filter, so selecting a row
   keeps every row in place; the segments use it (only trips to and from the selected place). */
export function mareyData(st, layout, maxRows) {
  const { V, T } = mareyItems(st, layout);
  const rowsV = st.filter.place == null ? V : mareyItems({ ...st, filter: { ...st.filter, place: null } }, layout).V;
  const rows = mareyRows(st, rowsV, maxRows);
  const segs = mareySegments(st, layout, rows, V, T);
  const days = layout === 'days' ? new Set(segs.map(s => s.day)).size : 0;
  return { rows, segs, days, nV: V.length, nT: T.length };
}
