/* Place timetable (Marey chart). Imperative, like the cube: a base canvas for stays and trips, an
   overlay canvas for playback, and an SVG for the axis and the hours brush. Row labels and the caption
   are React (MareyHost in Stage.jsx), fed through setMeta, so file text is escaped.
   createMarey(plot, setMeta) returns { schedule, setClock, show, destroy }. Data: src/lib/marey.js. */
import * as d3 from 'd3';
import { MIN, HOUR, DAY, clamp, fmtKm, fmtDur, fmtLocal } from '../lib/util.js';
import { MODES, MODE_IDX, cssv, modeColor, hourColor, trackColor } from '../lib/colors.js';
import { srcById, playRange, offNear, visibleSources } from '../lib/analytics.js';
import { mareyData } from '../lib/marey.js';
import { getState, showing } from '../store.js';
import { setFilter } from '../actions.js';
import { showTip, hideTip } from '../tip.jsx';

export const LABEL_W = 168;
const TOP = 10, BOTTOM = 26, RIGHT = 14, ROW_MIN = 22, ROW_MAX = 46;

export function createMarey(plot, setMeta) {
  const base = document.createElement('canvas'), over = document.createElement('canvas');
  const svg = d3.create('svg').attr('class', 'marey-svg');
  plot.append(base, over, svg.node());
  let W = 0, H = 0, dpr = 1, data = null, x = null, rowY = null, rowH = 0, layout = 'days';
  let timer = null, dead = false, clockT = null, silent = false, brush = null, gBrush = null, lastSet;
  const visible = () => showing(getState(), 'marey');

  const ro = new ResizeObserver(() => { if (visible()) schedule(); });
  ro.observe(plot);
  plot.addEventListener('pointermove', onHover);
  plot.addEventListener('pointerleave', hideTip);

  function size() {
    W = plot.clientWidth; H = plot.clientHeight; dpr = Math.min(2, devicePixelRatio || 1);
    for (const c of [base, over]) { c.width = Math.max(1, W * dpr); c.height = Math.max(1, H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
    svg.attr('width', W).attr('height', H);
  }
  // colours follow 'Colour trips by'; stays are neutral when colouring by mode. Cached per build (cssv is slow).
  let colors = new Map();
  const colorOf = (st, sg) => {
    const it = sg.item, key = st.colorBy === 'mode' ? (sg.kind === 't' ? it.mode : '') : st.colorBy === 'hour' ? Math.round(it.hod * 4) : sg.src;
    let c = colors.get(key);
    if (c === undefined) {
      c = st.colorBy === 'mode' ? (sg.kind === 't' ? modeColor(it.mode) : cssv('--ink-2')) : st.colorBy === 'hour' ? hourColor(key / 4) : trackColor(st, srcById(st, sg.src));
      colors.set(key, c);
    }
    return c;
  };
  // y of a segment at fraction f of its item: a straight line between rows, or an arch for a round trip
  const yAt = (sg, f) => {
    const y0 = rowY(sg.r0);
    if (sg.kind === 's') return y0;
    if (!sg.loop) return y0 + (rowY(sg.r1) - y0) * f;
    const up = sg.r0 === data.rows.length - 1 && data.rows.length > 1 ? -1 : 1; // arches point away from home
    return y0 + up * rowH * 0.62 * Math.sin(Math.PI * f);
  };
  const xOf = v => x(v);
  // screen points of a segment, from fraction a to b of the segment (for partial drawing in playback)
  function pts(sg, a = 0, b = 1) {
    const n = sg.loop ? 10 : 1, out = [];
    for (let i = 0; i <= n; i++) {
      const u = a + (b - a) * i / n;
      out.push([xOf(sg.x0 + (sg.x1 - sg.x0) * u), yAt(sg, sg.f0 + (sg.f1 - sg.f0) * u)]);
    }
    return out;
  }

  function build() {
    if (dead || !visible()) return;
    const st = getState(); if (!st.ctx || !st.res) return;
    size(); if (!W || !H) return;
    layout = st.mareyLayout;
    const plotH = H - TOP - BOTTOM;
    const maxRows = Math.max(3, Math.floor(plotH / ROW_MIN));
    data = mareyData(st, layout, maxRows);
    colors = new Map();
    const n = Math.max(1, data.rows.length);
    rowH = clamp(plotH / n, ROW_MIN, ROW_MAX);
    const y0 = TOP + rowH / 2;
    rowY = r => y0 + r * rowH;
    if (layout === 'days') x = d3.scaleLinear().domain([0, 24]).range([LABEL_W, W - RIGHT]);
    else {
      const [a, b] = playRange(st);
      x = d3.scaleUtc().domain([a + offNear(st, a) * MIN, b + offNear(st, b) * MIN]).range([LABEL_W, W - RIGHT]);
    }
    draw(st);
    drawAxis(st);
    setClock(clockT);
    const rangeDays = layout === 'calendar' ? (x.domain()[1] - x.domain()[0]) / DAY : 0;
    setMeta({
      rows: data.rows.map((r, i) => ({ ...r, y: rowY(i), h: rowH })),
      layout, days: data.days, nT: data.nT, nV: data.nV, rangeDays,
      hasLoops: data.segs.some(s => s.loop), hasOpen: data.segs.some(s => s.open0 || s.open1)
    });
  }

  function draw(st) {
    const g = base.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // row rules
    g.strokeStyle = cssv('--rule-2'); g.lineWidth = 1; g.globalAlpha = 1;
    g.beginPath();
    data.rows.forEach((r, i) => { const y = Math.round(rowY(i)) + 0.5; g.moveTo(LABEL_W, y); g.lineTo(W - RIGHT, y); });
    g.stroke();
    /* Many stacked days: each one faint, so routines add up to dense bundles and an unusual day
       stays visible as a single faint line. Each segment is its own stroke: one path per colour
       would be composited once, and overlapping days would not add up. */
    const alpha = layout === 'days' ? clamp(1.6 / Math.sqrt(Math.max(1, data.days)), 0.05, 0.85) : 0.85;
    const stayW = clamp(rowH * 0.26, 3, 8);
    g.lineCap = 'butt';
    let col = null, dash = null;
    for (const kind of ['s', 't']) { // stays first, trips on top
      g.globalAlpha = kind === 's' ? alpha * 0.8 : alpha;
      g.lineWidth = kind === 's' ? stayW : 1.3;
      for (const sg of data.segs) {
        if (sg.kind !== kind) continue;
        const c = colorOf(st, sg), d = kind === 't' && (sg.open0 || sg.open1);
        if (c !== col) g.strokeStyle = col = c;
        if (d !== dash) g.setLineDash((dash = d) ? [3, 3] : []);
        const p = pts(sg);
        if (kind === 's' && p[1][0] - p[0][0] < 1) p[1][0] = p[0][0] + 1;
        g.beginPath(); g.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]);
        g.stroke();
      }
    }
    g.setLineDash([]); g.globalAlpha = 1;
  }

  function drawAxis(st) {
    svg.selectAll('*').remove();
    const ax = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - BOTTOM + 4})`);
    if (layout === 'days') {
      ax.call(d3.axisBottom(x).tickValues(d3.range(0, 25, W - LABEL_W > 520 ? 3 : 6)).tickFormat(h => String(h).padStart(2, '0') + ':00').tickSizeOuter(0));
      brush = d3.brushX().extent([[LABEL_W, TOP - 4], [W - RIGHT, H - BOTTOM + 2]])
        .on('brush', ev => { if (!silent && ev.sourceEvent) brushed(ev.selection, false); })
        .on('end', ev => { if (!silent && ev.sourceEvent) brushed(ev.selection, true); });
      gBrush = svg.append('g').attr('class', 'brush').call(brush);
      syncBrush(st);
    } else {
      brush = gBrush = null;
      ax.call(d3.axisBottom(x).ticks(Math.max(2, Math.floor((W - LABEL_W) / 110))).tickSizeOuter(0));
    }
  }
  const hoursOf = sel => { const h0 = clamp(Math.floor(x.invert(sel[0])), 0, 23), h1 = clamp(Math.ceil(x.invert(sel[1])) - 1, h0, 23); return [h0, h1]; };
  function brushed(sel, end) {
    if (!sel) { lastSet = null; setFilter({ hours: null }, 'marey'); return; }
    const [h0, h1] = hoursOf(sel);
    if (end) { silent = true; gBrush.call(brush.move, [x(h0), x(h1 + 1)]); silent = false; }
    const f = getState().filter.hours;
    const all = h0 === 0 && h1 === 23;
    if (all ? f === null : f && f.size === h1 - h0 + 1 && f.has(h0) && f.has(h1)) return;
    lastSet = all ? null : new Set(d3.range(h0, h1 + 1));
    setFilter({ hours: lastSet }, 'marey');
  }
  // an hours filter set elsewhere (the rhythm grid) shows as the brush
  function syncBrush(st) {
    if (!gBrush) return;
    const f = st.filter.hours;
    silent = true;
    if (!f) gBrush.call(brush.move, null);
    else { const hs = [...f]; gBrush.call(brush.move, [x(Math.min(...hs)), x(Math.max(...hs) + 1)]); }
    silent = false;
  }

  /* playback: the current day drawn in full up to now, and a line at the current time */
  function setClock(t) {
    clockT = t;
    if (!data || !visible()) return;
    const g = over.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (t == null) return;
    const st = getState(), L = t + offNear(st, t) * MIN, day = Math.floor(L / DAY);
    const now = layout === 'days' ? (L - day * DAY) / HOUR : L;
    const segs = layout === 'days'
      ? data.segs.slice(d3.bisector(s => s.day).left(data.segs, day), d3.bisector(s => s.day).right(data.segs, day))
      : data.segs.filter(s => s.x0 <= L && s.x1 >= L - DAY);
    g.lineCap = 'round';
    for (const sg of segs) {
      if (sg.x0 > now) continue;
      const b = sg.x1 > sg.x0 ? Math.min(1, (now - sg.x0) / (sg.x1 - sg.x0)) : 1;
      const p = pts(sg, 0, b);
      g.strokeStyle = colorOf(st, sg); g.globalAlpha = 1;
      g.lineWidth = sg.kind === 's' ? clamp(rowH * 0.3, 3.5, 9) : 2.4;
      g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); g.stroke();
    }
    const xn = x(now);
    if (xn >= LABEL_W && xn <= W - RIGHT) {
      g.strokeStyle = cssv('--ink'); g.lineWidth = 1.2; g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(xn, TOP - 4); g.lineTo(xn, H - BOTTOM + 2); g.stroke();
    }
    g.globalAlpha = 1;
  }

  /* tooltip: the nearest stay or trip within 6 px */
  function onHover(ev) {
    if (!data || ev.buttons) { hideTip(); return; }
    const r = plot.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    if (px < LABEL_W || py > H - BOTTOM + 2) { hideTip(); return; }
    let best = null, bd = 36;
    for (const sg of data.segs) {
      const xa = xOf(sg.x0), xb = xOf(sg.x1);
      if (px < Math.min(xa, xb) - 6 || px > Math.max(xa, xb) + 6) continue;
      const p = pts(sg);
      for (let i = 1; i < p.length; i++) {
        const d = segDist2(px, py, p[i - 1], p[i]) - (sg.kind === 't' ? 4 : 0); // trips win over the stays under them
        if (d < bd) { bd = d; best = sg; }
      }
    }
    if (!best) { hideTip(); return; }
    const st = getState(), it = best.item, ctx = st.ctx, s = srcById(st, it.src);
    const a = fmtLocal(it.t0, it.off), bOff = s ? s.OF[Math.min(s.T.length - 1, d3.bisectLeft(s.T, it.t1))] : it.off, b = fmtLocal(it.t1, bOff);
    const when = <>{a.date}, {a.time} to {b.date === a.date ? '' : b.date + ', '}{b.time}</>;
    const dev = st.mode === 'separate' && visibleSources(st).length > 1 && s ? <><br /><span className="m">{s.name}</span></> : null;
    if (best.kind === 's') {
      showTip(ev, <><b>{ctx.places[it.place]?.label || 'Stay'}</b><br />{when} ({fmtDur(it.dur)}){dev}</>);
    } else {
      const lbl = i => i >= 0 ? ctx.places[i]?.label : null;
      const from = lbl(best.p0), to = lbl(best.p1);
      const route = from && to ? (from === to ? `Round trip from ${from}` : `${from} to ${to}`) : from ? `From ${from}` : to ? `To ${to}` : 'Trip';
      showTip(ev, <><b>{route}</b><br />{when}<br />{MODES[MODE_IDX[it.mode] ?? 5].label}{it.inferred ? ' (inferred)' : ''}, {fmtKm(it.dist)} km, {fmtDur(it.dur)}{dev}</>);
    }
  }

  function schedule() { if (dead || !visible()) return; clearTimeout(timer); timer = setTimeout(build, 60); }
  return {
    schedule,
    /* A change from the brush itself needs no rebuild ('days' ignores the hours filter), and a rebuild
       mid-drag would cut the drag off. An hours filter from elsewhere only moves the brush. */
    update(st, p) {
      if (!visible()) return;
      if (st.filter.hours !== p.filter.hours && st.filter.hours !== lastSet) syncBrush(st);
      const other = st.ctx !== p.ctx || st.colorBy !== p.colorBy || st.dark !== p.dark || st.labels !== p.labels
        || st.sources !== p.sources || st.hidden !== p.hidden || st.mareyLayout !== p.mareyLayout;
      if (!other && (st.res === p.res || (st.from === 'marey' && layout === 'days'))) return;
      schedule();
    },
    setClock,
    show(on) { if (!on) { hideTip(); return; } build(); },
    destroy() { dead = true; clearTimeout(timer); ro.disconnect(); plot.removeEventListener('pointermove', onHover); plot.removeEventListener('pointerleave', hideTip); base.remove(); over.remove(); svg.remove(); }
  };
}
function segDist2(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const u = L ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / L, 0, 1) : 0;
  const qx = a[0] + u * dx - px, qy = a[1] + u * dy - py;
  return qx * qx + qy * qy;
}
