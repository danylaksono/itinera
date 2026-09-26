/* Edge bundling for the map's optional bundled view (Layers › Bundle trips). Schematic by design:
   bundled lines leave the real streets, and the map says so.

   bundleTrips(st, trips) groups trips by place pair (either direction) and colour key, and bundles
   one edge per group with force-directed edge bundling (Holten and van Wijk 2009, "Force-directed
   edge bundling for graph visualization"). Each edge starts from the recorded path of its
   median-length trip, so bundles keep the rough shape of the real corridor. Round trips (the same
   place at both ends) and flights are not bundled. Pure: takes the state, returns GeoJSON features. */
import { RAD, EARTH } from './util.js';

const mercX = lon => lon * RAD * EARTH;
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * RAD / 2)) * EARTH;
const invX = x => x / EARTH / RAD;
const invY = y => (2 * Math.atan(Math.exp(y / EARTH)) - Math.PI / 2) / RAD;

/* n points spaced evenly along a polyline [[x, y], ...] */
function resample(pts, n) {
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = d[d.length - 1], out = new Float64Array(n * 2);
  let k = 1;
  for (let i = 0; i < n; i++) {
    const s = L * i / (n - 1);
    while (k < pts.length - 1 && d[k] < s) k++;
    const seg = d[k] - d[k - 1] || 1, f = Math.min(1, Math.max(0, (s - d[k - 1]) / seg));
    out[i * 2] = pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f;
    out[i * 2 + 1] = pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f;
  }
  return out;
}

/* Edge compatibility (angle, scale, position, visibility), from Holten and van Wijk. */
function compat(a0, a1, b0, b1) {
  const px = a1[0] - a0[0], py = a1[1] - a0[1], qx = b1[0] - b0[0], qy = b1[1] - b0[1];
  const lp = Math.hypot(px, py), lq = Math.hypot(qx, qy);
  if (lp < 1e-6 || lq < 1e-6) return [0, false];
  const dot = (px * qx + py * qy) / (lp * lq);
  const ca = Math.abs(dot);
  const lavg = (lp + lq) / 2;
  const cs = 2 / (lavg / Math.min(lp, lq) + Math.max(lp, lq) / lavg);
  const mpx = (a0[0] + a1[0]) / 2, mpy = (a0[1] + a1[1]) / 2, mqx = (b0[0] + b1[0]) / 2, mqy = (b0[1] + b1[1]) / 2;
  const cp = lavg / (lavg + Math.hypot(mpx - mqx, mpy - mqy));
  const vis = (s0, s1, t0, t1) => { // how much of t, projected on s's line, falls within s
    const sx = s1[0] - s0[0], sy = s1[1] - s0[1], L2 = sx * sx + sy * sy;
    const pr = t => { const u = ((t[0] - s0[0]) * sx + (t[1] - s0[1]) * sy) / L2; return [s0[0] + u * sx, s0[1] + u * sy]; };
    const i0 = pr(t0), i1 = pr(t1), im = [(i0[0] + i1[0]) / 2, (i0[1] + i1[1]) / 2];
    const li = Math.hypot(i1[0] - i0[0], i1[1] - i0[1]); if (li < 1e-9) return 0;
    return Math.max(0, 1 - 2 * Math.hypot((s0[0] + s1[0]) / 2 - im[0], (s0[1] + s1[1]) / 2 - im[1]) / li);
  };
  const cv = Math.min(vis(a0, a1, b0, b1), vis(b0, b1, a0, a1));
  return [ca * cs * cp * cv, dot < 0];
}

/* Force-directed edge bundling. edges: [{ pts: [[x, y], ...] (planar), w }]. Returns Float64Arrays
   of N points each (x, y interleaved). Each iteration moves every inner point towards the matching
   points of its compatible edges (a weighted mean direction, heavier edges pull more) by a step
   proportional to its own edge's length, then smooths it towards its neighbours. Scale-free, so
   short local trips and long ones bundle alike. Stops early when the time budget is used up. */
export function fdeb(edges, { N = 16, cycles = 5, iters = 30, step = 0.02, smooth = 0.25, minCompat = 0.45, maxNb = 40, budgetMs = 1500 } = {}) {
  const E = edges.length;
  let X = edges.map(e => resample(e.pts, N));
  const end = i => [[X[i][0], X[i][1]], [X[i][N * 2 - 2], X[i][N * 2 - 1]]];
  const ends = X.map((_, i) => end(i));
  const len = ends.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  // compatible neighbours of each edge, strongest first
  const nb = [];
  for (let p = 0; p < E; p++) {
    const c = [];
    for (let q = 0; q < E; q++) {
      if (q === p) continue;
      const [v, rev] = compat(ends[p][0], ends[p][1], ends[q][0], ends[q][1]);
      if (v >= minCompat) c.push([q, v * Math.sqrt(edges[q].w), rev]);
    }
    c.sort((a, b) => b[1] - a[1]);
    nb.push(c.slice(0, maxNb));
  }
  const t0 = performance.now();
  let S = step, I = iters;
  for (let cyc = 0; cyc < cycles; cyc++) {
    for (let it = 0; it < I; it++) {
      const Y = X.map(a => a.slice());
      for (let p = 0; p < E; p++) {
        const xp = X[p], yp = Y[p], sp = S * len[p], nbp = nb[p];
        if (!nbp.length) continue;
        for (let i = 1; i < N - 1; i++) {
          const x = xp[i * 2], y = xp[i * 2 + 1];
          let fx = 0, fy = 0, W = 0;
          for (const [q, wq, rev] of nbp) {
            const j = rev ? N - 1 - i : i, dx = X[q][j * 2] - x, dy = X[q][j * 2 + 1] - y, d = Math.hypot(dx, dy);
            if (d < 1e-6) { W += wq; continue; }
            const m = wq / Math.max(d, sp); // a unit pull, but no further than the point itself
            fx += dx * m; fy += dy * m; W += wq;
          }
          let nx = x + (W ? sp * fx / W : 0), ny = y + (W ? sp * fy / W : 0);
          // smoothing: towards the middle of the neighbouring points
          nx += smooth * ((xp[i * 2 - 2] + xp[i * 2 + 2]) / 2 - nx);
          ny += smooth * ((xp[i * 2 - 1] + xp[i * 2 + 3]) / 2 - ny);
          yp[i * 2] = nx; yp[i * 2 + 1] = ny;
        }
      }
      X = Y;
      if (performance.now() - t0 > budgetMs) return X;
    }
    S /= 2; I = Math.max(4, Math.round(I * 2 / 3));
  }
  return X;
}

/* Trips -> bundled GeoJSON features. Properties: n (trips), src, mode, hod (for the map's colours),
   a, b (place indices, -1 when not at a known place), and bundled (1) or loop (1). Groups beyond
   maxEdges (the rarest pairs) keep their recorded path, with bundled = 0. */
export function bundleTrips(st, trips, { maxEdges = 700, ...opts } = {}) {
  const places = st.ctx.places;
  const endKey = (pi, lat, lon) => pi >= 0 ? 'p' + pi : 'g' + Math.round(lat / 0.002) + ':' + Math.round(lon / 0.002);
  const colKey = t => st.colorBy === 'mode' ? t.mode : st.colorBy === 'hour' ? Math.floor(t.hod / 3) : t.src;
  const groups = new Map(), loops = [];
  for (const t of trips) {
    if (t.mode === 'flight' || t.path.length < 2) continue;
    const ka = endKey(t.from, t.lat0, t.lon0), kb = endKey(t.to, t.lat1, t.lon1);
    if (ka === kb) { loops.push(t); continue; }
    const fwd = ka < kb, key = (fwd ? ka + '|' + kb : kb + '|' + ka) + '|' + colKey(t);
    let g = groups.get(key);
    if (!g) groups.set(key, g = { trips: [], fwd: [], a: fwd ? t.from : t.to, b: fwd ? t.to : t.from });
    g.trips.push(t); g.fwd.push(fwd);
  }
  const gs = [...groups.values()].sort((x, y) => y.trips.length - x.trips.length);
  const toXY = p => [mercX(p[2]), mercY(p[1])];
  const shape = g => { // the median-length trip's path, oriented from a to b, with the place ends
    const order = g.trips.map((t, i) => i).sort((i, j) => g.trips[i].dist - g.trips[j].dist);
    const k = order[order.length >> 1], t = g.trips[k];
    const pts = t.path.map(toXY); if (!g.fwd[k]) pts.reverse();
    if (g.a >= 0) pts[0] = [mercX(places[g.a].lon), mercY(places[g.a].lat)];
    if (g.b >= 0) pts[pts.length - 1] = [mercX(places[g.b].lon), mercY(places[g.b].lat)];
    return { pts, rep: t };
  };
  const top = gs.slice(0, maxEdges).map(g => ({ g, ...shape(g) }));
  const X = fdeb(top.map(e => ({ pts: e.pts, w: e.g.trips.length })), opts);
  const props = (t, n, extra) => ({ n, src: t.src, mode: t.mode, hod: t.hod, ...extra });
  const out = top.map((e, i) => {
    const co = []; for (let k = 0; k < X[i].length; k += 2) co.push([invX(X[i][k]), invY(X[i][k + 1])]);
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: co }, properties: props(e.rep, e.g.trips.length, { a: e.g.a, b: e.g.b, bundled: 1 }) };
  });
  for (const g of gs.slice(maxEdges)) {
    const { pts, rep } = shape(g);
    out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [invX(p[0]), invY(p[1])]) }, properties: props(rep, g.trips.length, { a: g.a, b: g.b, bundled: 0 }) });
  }
  for (const t of loops) out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.path.map(p => [p[2], p[1]]) }, properties: props(t, 1, { a: t.from, b: t.to, loop: 1 }) });
  return { features: out, nBundled: top.length, nPairs: gs.length, nLoops: loops.length };
}
