/* ================================================================
   Part D: linked charts and panels
   ================================================================ */
const svgNS = 'http://www.w3.org/2000/svg';
function inkRamp() { return d3.interpolateRgb(cssv('--rule-2'), cssv('--ink')); }

/* ---------- filter helpers ---------- */
function offForDay(day) { return offNear(day * DAY); }
function dayToUtc(day) { return day * DAY - offForDay(day) * MIN; }
function setTimeRange(t0, t1, from) {
  const c = S.ctx;
  if (t0 == null || (t0 <= c.t0 && t1 >= c.t1)) { S.filter.t0 = S.filter.t1 = null; }
  else { S.filter.t0 = t0; S.filter.t1 = t1; }
  refresh(from);
}
function rangeToDays() {
  const f = S.filter, c = S.ctx;
  if (f.t0 == null) return null;
  return [Math.floor((f.t0 + offNear(f.t0) * MIN) / DAY), Math.floor((f.t1 - 1 + offNear(f.t1) * MIN) / DAY)];
}

/* ---------- KPIs ---------- */
const KPI_DEF = [
  { k: 'dist', label: 'Distance travelled', unit: 'km', val: k => k.dist / 1000, fmt: v => fmtKm(v * 1000), series: 'dist', sl: 'Distance each month' },
  { k: 'days', label: 'Days with data', unit: '', val: k => k.days, fmt: v => Math.round(v).toLocaleString('en-GB'), series: 'days', sl: 'Days with data each month' },
  { k: 'places', label: 'Places visited', unit: '', val: k => k.places, fmt: v => Math.round(v).toLocaleString('en-GB'), series: 'places', sl: 'New places each month' },
  { k: 'countries', label: 'Countries', unit: '', val: k => k.countries, fmt: v => Math.round(v), series: 'countries', sl: 'Countries each month' },
  { k: 'rog', label: 'Radius of gyration', unit: 'km', val: k => k.rog / 1000, fmt: v => v >= 100 ? Math.round(v).toLocaleString('en-GB') : v.toFixed(1), series: 'rog', sl: 'Typical spread of your places, each month' },
  { k: 'home', label: 'Time at home', unit: '%', val: k => k.home == null ? NaN : k.home * 100, fmt: v => isNaN(v) ? '–' : Math.round(v), series: 'home', sl: 'Share of time at home each month. Home can change over time: each month it is the place with most nights, and Google home labels count extra. Months with no clear home are left out.' }
];
const kpiShown = {};
function renderKPIs() {
  const el = $('#kpis'), res = S.res, ctx = S.ctx;
  if (!el.children.length) {
    el.innerHTML = KPI_DEF.map(d => `<div class="kpi" data-k="${d.k}" title="${d.sl}"><div class="v"><span class="n">0</span><small>${d.unit}</small></div><div class="l">${d.label}</div><svg preserveAspectRatio="none"></svg></div>`).join('');
  }
  const days = rangeToDays();
  const multi = visibleSources().length > 1 ? ' Where devices overlap in time, only the device that covers the most days is counted.' : '';
  const m0 = days ? monthOfDay(days[0]) : null, m1 = days ? monthOfDay(days[1]) : null;
  for (const d of KPI_DEF) {
    const box = el.querySelector(`[data-k="${d.k}"]`);
    const target = d.val(res.kpi);
    const nEl = box.querySelector('.n');
    const from = kpiShown[d.k] ?? 0;
    if (isNaN(target)) { nEl.textContent = '–'; kpiShown[d.k] = 0; }
    else if (typeof anime !== 'undefined' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const o = { v: isNaN(from) ? 0 : from };
      anime.remove(nEl);
      anime({ targets: o, v: target, duration: 650, easing: 'easeOutCubic', update: () => { nEl.textContent = d.fmt(o.v); }, complete: () => { nEl.textContent = d.fmt(target); } });
      clearTimeout(nEl._to); nEl._to = setTimeout(() => { nEl.textContent = d.fmt(target); }, 900);
      nEl._o = o;
    } else nEl.textContent = d.fmt(target);
    kpiShown[d.k] = target;
    box.title = d.sl + multi;
    if (d.k === 'countries') box.title = res.kpi.countryList.sort().join(', ') || d.sl;
    if (d.k === 'home') box.querySelector('.l').textContent = ctx.homes.some(h => !h.labelled) ? 'Time at home (inferred)' : 'Time at home';
    // sparkline
    const svg = box.querySelector('svg'), w = svg.clientWidth || 160, h = 22;
    const s = res.monthly[d.series];
    const max = d3.max(s) || 1;
    const x = i => s.length < 2 ? w / 2 : i / (s.length - 1) * w;
    const y = v => h - 2 - (v / max) * (h - 5);
    let band = '';
    if (m0 != null) {
      const a = clamp(m0 - ctx.mon0, 0, s.length - 1), b = clamp(m1 - ctx.mon0, 0, s.length - 1);
      const xa = s.length < 2 ? 0 : x(a) - w / (s.length - 1) / 2, xb = s.length < 2 ? w : x(b) + w / (s.length - 1) / 2;
      band = `<rect x="${Math.max(0, xa)}" y="0" width="${Math.max(2, Math.min(w, xb) - Math.max(0, xa))}" height="${h}" fill="${cssv('--sel')}"/>`;
    }
    const line = s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const area = line + `L${x(s.length - 1)},${h}L${x(0)},${h}Z`;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = `${band}<path d="${area}" fill="${cssv('--ink')}" opacity=".08"/><path d="${line}" fill="none" stroke="${cssv('--ink-2')}" stroke-width="1.2"/>`;
  }
}

/* ---------- timeline ---------- */
const TL = { x: null, brush: null, gBrush: null, silent: false, playhead: null, H: 0 };
function renderTimeline() {
  const el = $('#timeline'), ctx = S.ctx, res = S.res;
  const srcs = activeSources();
  const W = Math.max(200, el.clientWidth - 22);
  const bandA = 58, bandB = 16, rowH = 5, gap = 12;
  const covH = srcs.length * (rowH + 2);
  const H = 14 + bandA + gap + bandB + gap + covH + 22;
  TL.H = H;
  const x = d3.scaleUtc().domain([ctx.day0 * DAY, (ctx.day1 + 1) * DAY]).range([0, W]);
  TL.x = x;
  const svg = d3.select(el).selectAll('svg').data([0]).join('svg').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
  svg.selectAll('*').remove();
  const g = svg.append('g');
  const days = d3.range(ctx.nDays);
  // --- band A: stacked daily distance
  const keys = srcs.map(s => s.id);
  const rows = days.map(d => { const o = { d }; for (const s of srcs) o[s.id] = (res.daily.get(s.id)?.[d] || 0) / 1000; return o; });
  const stack = d3.stack().keys(keys)(rows);
  const maxY = d3.max(stack.length ? stack[stack.length - 1] : [[0, 0]], d => d[1]) || 1;
  const y = d3.scaleSqrt().domain([0, maxY]).range([14 + bandA, 16]);
  const area = d3.area().curve(d3.curveStepAfter).x(d => x((ctx.day0 + d.data.d) * DAY)).y0(d => y(d[0])).y1(d => y(d[1]));
  g.append('g').selectAll('path').data(stack).join('path')
    .attr('d', area).attr('fill', dd => S.mode === 'combined' ? cssv('--ink-2') : inkOf(srcById(+dd.key))).attr('opacity', 0.85);
  g.append('text').attr('x', 0).attr('y', 10).attr('font-size', 11).attr('fill', cssv('--ink-3')).text(`Distance per day, up to ${fmtKm(maxY * 1000)} km`);
  // --- band B: distance-from-home strip
  const yB = 14 + bandA + gap;
  if (res.far) {
    const maxF = d3.max(res.far) || 1;
    const cs = d3.scaleSequentialLog(inkRamp()).domain([0.5, Math.max(1, maxF / 1000)]).clamp(true);
    const bw = Math.max(0.6, W / ctx.nDays + 0.3);
    g.append('g').selectAll('rect').data(days.filter(d => res.far[d] > 0)).join('rect')
      .attr('x', d => x((ctx.day0 + d) * DAY)).attr('y', yB).attr('width', bw).attr('height', bandB)
      .attr('fill', d => cs(Math.max(0.5, res.far[d] / 1000)));
    g.append('text').attr('x', 0).attr('y', yB - 3).attr('font-size', 11).attr('fill', cssv('--ink-3')).text(`Farthest from home each day (darker is farther, up to ${fmtKm(maxF)} km)`);
  }
  // --- coverage rows
  const yC = yB + bandB + gap;
  g.append('text').attr('x', 0).attr('y', yC - 3).attr('font-size', 11).attr('fill', cssv('--ink-3')).text('Records from each device');
  srcs.forEach((s, k) => {
    const arr = ctx.cover.get(s.id); if (!arr) return;
    const segs = []; let st = -1;
    for (let d = 0; d <= arr.length; d++) {
      const on = d < arr.length && arr[d] > 0;
      if (on && st < 0) st = d; if (!on && st >= 0) { segs.push([st, d]); st = -1; }
    }
    g.append('g').selectAll('rect').data(segs).join('rect')
      .attr('x', d => x((ctx.day0 + d[0]) * DAY)).attr('width', d => Math.max(1, x((ctx.day0 + d[1]) * DAY) - x((ctx.day0 + d[0]) * DAY)))
      .attr('y', yC + k * (rowH + 2)).attr('height', rowH).attr('rx', 1)
      .attr('fill', S.mode === 'combined' ? cssv('--ink-2') : inkOf(s)).attr('opacity', S.hidden.has(s.id) ? 0.25 : 0.9);
  });
  // --- axis
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - 20})`).call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(W / 90))).tickSizeOuter(0));
  // --- playhead
  TL.playhead = g.append('line').attr('y1', 12).attr('y2', H - 20).attr('stroke', cssv('--ink')).attr('stroke-width', 1.5).style('display', 'none');
  const hover = g.append('line').attr('y1', 12).attr('y2', H - 20).attr('stroke', cssv('--ink-3')).attr('stroke-dasharray', '2 2').style('display', 'none').attr('pointer-events', 'none');
  // --- brush
  TL.brush = d3.brushX().extent([[0, 12], [W, H - 20]])
    .on('brush', ev => { if (TL.silent || !ev.sourceEvent) return; brushed(ev, false); })
    .on('end', ev => { if (TL.silent || !ev.sourceEvent) return; brushed(ev, true); });
  TL.gBrush = g.append('g').attr('class', 'brush').call(TL.brush);
  TL.gBrush.select('.overlay')
    .on('mousemove.tip', ev => {
      const [mx] = d3.pointer(ev); const day = Math.floor(x.invert(mx).getTime() / DAY); const d = day - ctx.day0;
      if (d < 0 || d >= ctx.nDays) return;
      hover.style('display', null).attr('x1', mx).attr('x2', mx);
      let h = `<b>${fmtDay(day)}</b>`;
      for (const s of srcs) { const v = res.daily.get(s.id)?.[d] || 0; h += `<br>${srcs.length > 1 ? esc(s.name) + ': ' : ''}${fmtKm(v)} km, ${(ctx.cover.get(s.id)?.[d] || 0).toLocaleString('en-GB')} records`; }
      if (res.far) h += `<br><span class="m">${fmtKm(res.far[d])} km from home at most</span>`;
      showTip(ev, h);
    })
    .on('mouseleave.tip', () => { hover.style('display', 'none'); hideTip(); });
  syncBrush();
  drawPlayhead();
}
function brushed(ev, end) {
  const x = TL.x;
  if (!ev.selection) { setTimeRange(null, null, 'timeline'); return; }
  let [a, b] = ev.selection.map(v => x.invert(v).getTime() / DAY);
  let d0 = Math.floor(a), d1 = Math.max(d0, Math.ceil(b) - 1);
  if (end) { TL.silent = true; TL.gBrush.call(TL.brush.move, [x(d0 * DAY), x((d1 + 1) * DAY)]); TL.silent = false; }
  setTimeRange(dayToUtc(d0), dayToUtc(d1 + 1) - 1, 'timeline');
}
function syncBrush() {
  if (!TL.gBrush) return;
  const days = rangeToDays();
  TL.silent = true;
  TL.gBrush.call(TL.brush.move, days ? [TL.x(days[0] * DAY), TL.x((days[1] + 1) * DAY)] : null);
  TL.silent = false;
}
function drawPlayhead() {
  if (!TL.playhead) return;
  const c = S.play.clock;
  if (c == null) { TL.playhead.style('display', 'none'); return; }
  const xx = TL.x(c + offNear(c) * MIN);
  TL.playhead.style('display', null).attr('x1', xx).attr('x2', xx);
}

/* ---------- calendar ---------- */
const CAL = { cells: null, cs: 10, cur: null };
function renderCalendar() {
  const el = $('#calendar'), ctx = S.ctx, res = S.res;
  const W = Math.max(260, el.clientWidth - 24);
  const cs = clamp(Math.floor((W - 26) / 54), 6, 13);
  CAL.cs = cs;
  const tot = new Float64Array(ctx.nDays);
  for (const [, arr] of res.daily) for (let i = 0; i < arr.length; i++) tot[i] += arr[i];
  const has = new Uint8Array(ctx.nDays);
  for (const [, arr] of ctx.cover) for (let i = 0; i < arr.length; i++) if (arr[i]) has[i] = 1;
  const y0 = new Date(ctx.day0 * DAY).getUTCFullYear(), y1 = new Date(ctx.day1 * DAY).getUTCFullYear();
  const years = d3.range(y0, y1 + 1);
  const blockH = 7 * cs + 22;
  const H = years.length * blockH + 4;
  const svg = d3.select(el).selectAll('svg').data([0]).join('svg').attr('width', 26 + 54 * cs).attr('height', H);
  svg.selectAll('*').remove();
  const nz = [...tot].filter(v => v > 0).sort((a, b) => a - b);
  const hi = nz.length ? nz[Math.floor(nz.length * 0.96)] : 1;
  const q = d3.scaleSequentialQuantile(inkRamp()).domain(nz.map(v => v / 1000));
  const col = v => nz.length ? q(v) : cssv('--ink');
  const cells = [];
  years.forEach((yr, yi) => {
    const jan1 = Date.UTC(yr, 0, 1) / DAY, dec31 = Date.UTC(yr, 11, 31) / DAY;
    const off = (jan1 + 3) % 7; // monday-based weekday of Jan 1
    const gy = svg.append('g').attr('transform', `translate(26,${yi * blockH + 16})`);
    svg.append('text').attr('class', 'cal-year').attr('x', 0).attr('y', yi * blockH + 11).text(yr);
    ['M', '', 'W', '', 'F', '', 'S'].forEach((l, i) => l && svg.append('text').attr('x', 18).attr('y', yi * blockH + 16 + i * cs + cs * 0.8).attr('text-anchor', 'end').attr('font-size', 9.5).attr('fill', cssv('--ink-3')).text(l));
    for (let m = 0; m < 12; m++) {
      const d = Date.UTC(yr, m, 1) / DAY, wk = Math.floor((d - jan1 + off) / 7);
      gy.append('text').attr('x', wk * cs).attr('y', 7 * cs + 11).attr('font-size', 9.5).attr('fill', cssv('--ink-3')).text(MONTHS[m][0]);
    }
    for (let day = Math.max(jan1, ctx.day0); day <= Math.min(dec31, ctx.day1); day++) {
      const i = day - ctx.day0;
      cells.push({ day, i, x: 26 + Math.floor((day - jan1 + off) / 7) * cs, y: yi * blockH + 16 + ((day + 3) % 7) * cs });
    }
  });
  const g = svg.append('g');
  CAL.cells = g.selectAll('rect').data(cells).join('rect')
    .attr('x', d => d.x + 0.5).attr('y', d => d.y + 0.5).attr('width', cs - 1.5).attr('height', cs - 1.5).attr('rx', 1.5)
    .attr('fill', d => has[d.i] ? (tot[d.i] > 0 ? col(tot[d.i] / 1000) : cssv('--rule-2')) : 'none')
    .attr('stroke', d => has[d.i] ? 'none' : cssv('--rule')).attr('stroke-width', 0.7)
    .style('cursor', 'pointer')
    .on('mousemove', (ev, d) => showTip(ev, `<b>${DOWS[(d.day + 3) % 7]} ${fmtDay(d.day)}</b><br>${has[d.i] ? fmtKm(tot[d.i]) + ' km travelled' : 'No records'}${res.far && has[d.i] ? `<br><span class="m">${fmtKm(res.far[d.i])} km from home at most</span>` : ''}`))
    .on('mouseleave', hideTip)
    .on('click', (ev, d) => {
      const cur = rangeToDays();
      if (ev.shiftKey && cur) { const a = Math.min(cur[0], d.day), b = Math.max(cur[1], d.day); setTimeRange(dayToUtc(a), dayToUtc(b + 1) - 1, 'calendar'); }
      else if (cur && cur[0] === d.day && cur[1] === d.day) setTimeRange(null, null, 'calendar');
      else setTimeRange(dayToUtc(d.day), dayToUtc(d.day + 1) - 1, 'calendar');
    });
  CAL.cur = g.append('rect').attr('fill', 'none').attr('stroke', cssv('--ink')).attr('stroke-width', 1.6).attr('width', cs).attr('height', cs).style('display', 'none').attr('pointer-events', 'none');
  dimCalendar();
  if (!renderCalendar._scrolled) { el.scrollTop = el.scrollHeight; renderCalendar._scrolled = true; }
}
function dimCalendar() {
  if (!CAL.cells) return;
  const r = rangeToDays();
  CAL.cells.attr('opacity', d => !r || (d.day >= r[0] && d.day <= r[1]) ? 1 : 0.25);
}

/* ---------- weekly rhythm ---------- */
const RH = { drag: null, cells: null, cur: null };
function renderRhythm() {
  const el = $('#rhythm'), res = S.res;
  const W = Math.max(240, el.clientWidth), lw = 26, th = 14;
  const cw = (W - lw) / 24, ch = Math.min(18, Math.max(12, cw * 1.05));
  const H = th + 7 * ch + 2;
  const svg = d3.select(el).selectAll('svg').data([0]).join('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
  svg.selectAll('*').remove();
  const max = d3.max(res.rhythm) || 1;
  const col = d3.scaleSequential(inkRamp()).domain([0, max]);
  $('#rhythmUnit').textContent = `darkest = ${Math.round(max)} min`;
  [0, 6, 12, 18, 23].forEach(h => svg.append('text').attr('x', lw + h * cw + cw / 2).attr('y', 10).attr('text-anchor', 'middle').attr('font-size', 10.5).attr('fill', cssv('--ink-3')).text(h + 'h'));
  DOWS.forEach((d, i) => svg.append('text').attr('x', lw - 5).attr('y', th + i * ch + ch * 0.72).attr('text-anchor', 'end').attr('font-size', 10.5)
    .attr('fill', cssv('--ink-2')).style('cursor', 'pointer').text(d.slice(0, 2))
    .on('click', () => { const s = new Set(S.filter.dows || []); if (S.filter.dows && s.has(i) && s.size === 1) S.filter.dows = null; else S.filter.dows = new Set([i]); refresh('rhythm'); }));
  const data = [];
  for (let dw = 0; dw < 7; dw++) for (let h = 0; h < 24; h++) data.push({ dw, h, v: res.rhythm[dw * 24 + h] });
  const f = S.filter;
  const inSel = d => (!f.hours || f.hours.has(d.h)) && (!f.dows || f.dows.has(d.dw));
  RH.cells = svg.append('g').selectAll('rect').data(data).join('rect').attr('class', 'cell')
    .attr('x', d => lw + d.h * cw + 0.5).attr('y', d => th + d.dw * ch + 0.5).attr('width', cw - 1).attr('height', ch - 1).attr('rx', 1.5)
    .attr('fill', d => col(d.v)).attr('opacity', d => inSel(d) ? 1 : 0.22)
    .on('mousemove', (ev, d) => { if (!RH.drag) showTip(ev, `<b>${DOWS[d.dw]}, ${String(d.h).padStart(2, '0')}:00–${String(d.h + 1).padStart(2, '0')}:00</b><br>${d.v.toFixed(1)} min on the move, on average, on ${DOWS[d.dw]} days with records`); })
    .on('mouseleave', hideTip);
  RH.cur = svg.append('rect').attr('fill', 'none').attr('stroke', cssv('--ink')).attr('stroke-width', 1.6).attr('width', cw).attr('height', ch).style('display', 'none');
  const selRect = svg.append('rect').attr('fill', 'none').attr('stroke', cssv('--sel-line')).attr('stroke-dasharray', '3 2').style('display', 'none');
  const toCell = ev => { const [mx, my] = d3.pointer(ev, svg.node()); return { h: clamp(Math.floor((mx - lw) / cw), 0, 23), dw: clamp(Math.floor((my - th) / ch), 0, 6), out: mx < lw || my < th }; };
  svg.on('pointerdown', ev => {
    const c = toCell(ev); if (c.out) return;
    RH.drag = { a: c, b: c }; svg.node().setPointerCapture(ev.pointerId); hideTip(); upd();
  }).on('pointermove', ev => { if (!RH.drag) return; RH.drag.b = toCell(ev); upd(); })
    .on('pointerup', ev => {
      if (!RH.drag) return;
      const { a, b } = RH.drag; RH.drag = null; selRect.style('display', 'none');
      const h0 = Math.min(a.h, b.h), h1 = Math.max(a.h, b.h), d0 = Math.min(a.dw, b.dw), d1 = Math.max(a.dw, b.dw);
      const single = h0 === h1 && d0 === d1;
      if (single && f.hours?.size === 1 && f.hours.has(h0) && f.dows?.size === 1 && f.dows.has(d0)) { f.hours = f.dows = null; }
      else {
        f.hours = h0 === 0 && h1 === 23 ? null : new Set(d3.range(h0, h1 + 1));
        f.dows = d0 === 0 && d1 === 6 ? null : new Set(d3.range(d0, d1 + 1));
      }
      refresh('rhythm');
    });
  function upd() {
    const { a, b } = RH.drag;
    const h0 = Math.min(a.h, b.h), h1 = Math.max(a.h, b.h), d0 = Math.min(a.dw, b.dw), d1 = Math.max(a.dw, b.dw);
    selRect.style('display', null).attr('x', lw + h0 * cw).attr('y', th + d0 * ch).attr('width', (h1 - h0 + 1) * cw).attr('height', (d1 - d0 + 1) * ch);
  }
}
let _curKey = null;
function markCurrent(c) {
  const key = c == null ? null : (() => { const off = offNear(c), L = c + off * MIN; return Math.floor(L / HOUR); })();
  if (key === _curKey) return; _curKey = key;
  if (c == null) { RH.cur?.style('display', 'none'); CAL.cur?.style('display', 'none'); return; }
  const L = c + offNear(c) * MIN, day = Math.floor(L / DAY), h = Math.floor((((L % DAY) + DAY) % DAY) / HOUR), dw = (day + 3) % 7;
  if (RH.cells) { const n = RH.cells.filter(d => d.dw === dw && d.h === h).node(); if (n) RH.cur.style('display', null).attr('x', +n.getAttribute('x') - 0.5).attr('y', +n.getAttribute('y') - 0.5); }
  if (CAL.cells) { const n = CAL.cells.filter(d => d.day === day).node(); if (n) CAL.cur.style('display', null).attr('x', +n.getAttribute('x') - 0.5).attr('y', +n.getAttribute('y') - 0.5).attr('width', CAL.cs).attr('height', CAL.cs); }
}

/* ---------- modes ---------- */
function renderModes() {
  const el = $('#modes'), res = S.res, f = S.filter;
  const key = S.modeMetric;
  const rows = res.modes.filter(m => m.n);
  const max = d3.max(rows, m => m[key]) || 1;
  const tot = d3.sum(rows, m => m[key]) || 1;
  el.innerHTML = rows.map(m => {
    const on = !f.modes || f.modes.has(m.k);
    const w = m[key] / max * 100;
    const num = key === 'dist' ? `${fmtKm(m.dist)} km` : fmtDur(m.dur);
    return `<div class="mode-row${on ? '' : ' off'}" data-k="${m.k}" role="button" tabindex="0" title="${m.n} trips, ${Math.round(m[key] / tot * 100)}% of the total">
      <span class="nm"><i style="background:${modeColor(m.k)}"></i>${MODES[MODE_IDX[m.k]].label}</span>
      <span class="bar-bg"><span class="ghost" style="width:${w}%"></span><span class="fill" style="width:${w}%;background:${modeColor(m.k)}"></span></span>
      <span class="num">${num}</span></div>`;
  }).join('') + `<div class="mode-foot">${res.T.length.toLocaleString('en-GB')} trips in the selection${activeSources().some(s => s.derivedTrips) ? '. Modes for records without labels are estimated from speed.' : ''}</div>`;
  $$('.mode-row', el).forEach(r => {
    const act = () => {
      const k = r.dataset.k;
      if (!f.modes) f.modes = new Set([k]);
      else if (f.modes.has(k)) { f.modes.delete(k); if (!f.modes.size) f.modes = null; }
      else f.modes.add(k);
      refresh('modes');
    };
    r.onclick = act; r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } };
  });
}

/* ---------- places ---------- */
let placeLimit = 12;
function renderPlaces() {
  const el = $('#places'), res = S.res, ctx = S.ctx;
  let list = res.places.slice(0, placeLimit);
  const sel = S.filter.place;
  $('#placeCount').textContent = `${res.places.length.toLocaleString('en-GB')} in selection`;
  const days = rangeToDays();
  const nW = ctx.wk1 - ctx.wk0 + 1;
  const w0 = days ? Math.floor((days[0] + 3) / 7) - ctx.wk0 : null, w1 = days ? Math.floor((days[1] + 3) / 7) - ctx.wk0 : null;
  const spark = pi => {
    const a = res.placeWeeks.get(pi); if (!a) return '';
    const W = 90, H = 20, max = d3.max(a) || 1;
    const bw = W / nW;
    let s = '';
    if (w0 != null) s += `<rect x="${w0 * bw}" y="0" width="${Math.max(2, (w1 - w0 + 1) * bw)}" height="${H}" fill="${cssv('--sel')}"/>`;
    let d = '';
    for (let i = 0; i < nW; i++) { const v = a[i]; if (v <= 0) continue; const h = Math.max(1, v / max * (H - 3)); d += `M${(i * bw + bw / 2).toFixed(1)},${H}v${-h.toFixed(1)}`; }
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${s}<path d="${d}" stroke="${cssv('--ink-2')}" stroke-width="${Math.max(0.8, Math.min(2, bw * 0.8))}"/></svg>`;
  };
  const row = (o, r) => {
    const p = ctx.places[o.i];
    const open = S.openPlace === o.i;
    let more = '';
    if (open) {
      const W = 150, H = 44, mx = d3.max(o.arr) || 1, bw = W / 24;
      const bars = [...o.arr].map((v, h) => `<rect x="${h * bw + .5}" y="${H - 12 - v / mx * (H - 16)}" width="${bw - 1}" height="${v / mx * (H - 16)}" fill="${cssv('--ink-2')}"/>`).join('');
      const tl = [0, 6, 12, 18].map(h => `<text x="${h * bw}" y="${H - 1}" font-size="9.5" fill="${cssv('--ink-3')}">${h}h</text>`).join('');
      const srcNames = [...o.srcs].map(id => srcById(id)?.name).filter(Boolean);
      const off = offNear(o.first);
      more = `<div class="place-more">
        <label class="nm-edit">Name <input type="text" value="${esc(p.custom || p.name || '')}" placeholder="${esc(p.role || 'Give this place a name')}" data-key="${p.key}"></label>
        <dl><dt>Visits</dt><dd>${o.n}</dd><dt>Typical stay</dt><dd>${fmtDur(o.dur / o.n)}</dd><dt>First</dt><dd>${fmtLocal(o.first, off).date.slice(4)}</dd><dt>Last</dt><dd>${fmtLocal(o.last, off).date.slice(4)}</dd>${p.country ? `<dt>Where</dt><dd>${p.town ? 'Near ' + esc(p.town) + ', ' : ''}${esc(p.country)}</dd>` : ''}${S.mode === 'separate' && srcNames.length ? `<dt>Seen by</dt><dd>${esc(srcNames.join(', '))}</dd>` : ''}</dl>
        <div>Arrival hour<svg viewBox="0 0 ${W} ${H}">${bars}${tl}</svg></div></div>`;
    }
    return `<div class="place${sel === o.i ? ' sel' : ''}" data-i="${o.i}" tabindex="0" role="button" aria-expanded="${open}">
      <div class="place-top"><span class="rk">${r + 1}</span><span class="pn">${esc(p.label)}${p.role && !p.label.startsWith(p.role) ? `<span class="role">${p.role}${p.inferredRole ? '?' : ''}</span>` : p.role && p.inferredRole ? '<span class="role">inferred</span>' : ''}</span>${spark(o.i)}<span class="hrs">${fmtDur(o.dur)}</span></div>${more}</div>`;
  };
  el.innerHTML = list.map(row).join('') + (res.places.length > placeLimit ? `<button class="btn small" id="morePlaces" style="margin-top:8px">Show ${Math.min(30, res.places.length - placeLimit)} more</button>` : '');
  $$('.place', el).forEach(r => {
    const i = +r.dataset.i;
    r.onmouseenter = () => highlightPlace(i, 'list');
    r.onmouseleave = () => highlightPlace(null, 'list');
    r.onclick = e => { if (e.target.closest('.place-more')) return; selectPlace(i, true); };
    r.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('input')) { e.preventDefault(); selectPlace(i, true); } };
  });
  const inp = el.querySelector('.nm-edit input');
  if (inp) {
    const commit = () => {
      const p = ctx.places.find(q => q.key === inp.dataset.key); if (!p) return;
      const v = inp.value.trim();
      saveName(p.key, v); p.custom = v || null;
      p.label = defaultLabel(p);
      renderPlaces(); renderFilters(); if (S.view !== 'map') Cube.schedule();
    };
    inp.onkeydown = e => { if (e.key === 'Enter') commit(); e.stopPropagation(); };
    inp.onblur = commit;
  }
  const mb = $('#morePlaces'); if (mb) mb.onclick = () => { placeLimit += 30; renderPlaces(); };
}
function selectPlace(i, fly) {
  if (S.filter.place === i) { S.filter.place = null; S.openPlace = null; }
  else {
    S.filter.place = i; S.openPlace = i;
    const p = S.ctx.places[i];
    if (fly && mapReady) map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 13), duration: 800 });
  }
  refresh('places');
}

/* ---------- filter chips ---------- */
function rangeLabel(set, names) {
  const a = [...set].sort((x, y) => x - y);
  const runs = []; let s = a[0], p = a[0];
  for (let i = 1; i <= a.length; i++) { if (a[i] === p + 1) { p = a[i]; continue; } runs.push(s === p ? names(s) : `${names(s)}–${names(p)}`); s = p = a[i]; }
  return runs.join(', ');
}
function renderFilters() {
  const el = $('#filters'), f = S.filter, chips = [];
  const days = rangeToDays();
  if (days) chips.push(['time', days[0] === days[1] ? fmtDay(days[0]) : `${fmtDayShort(days[0])} – ${fmtDay(days[1])}`]);
  if (f.dows) chips.push(['dows', rangeLabel(f.dows, i => DOWS[i])]);
  if (f.hours) chips.push(['hours', rangeLabel(f.hours, h => String(h).padStart(2, '0') + 'h')]);
  if (f.modes) chips.push(['modes', [...f.modes].map(k => MODES[MODE_IDX[k]].label).join(', ')]);
  if (f.place != null) chips.push(['place', `Trips to or from ${S.ctx.places[f.place]?.label}`]);
  el.innerHTML = chips.length ? chips.map(([k, l]) => `<span class="chip">${esc(l)}<button data-k="${k}" aria-label="Remove filter">×</button></span>`).join('') + (chips.length > 1 ? '<button class="btn small" id="clearAll">Clear all</button>' : '')
    : '<span class="none">Showing all data. Brush the timeline, select calendar days, rhythm cells, modes or places to filter.</span>';
  $$('.chip button', el).forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === 'time') { f.t0 = f.t1 = null; } else if (k === 'place') { f.place = null; S.openPlace = null; } else f[k] = null;
    refresh('chips');
  });
  const ca = $('#clearAll'); if (ca) ca.onclick = () => { Object.assign(f, { t0: null, t1: null, hours: null, dows: null, modes: null, place: null }); S.openPlace = null; refresh('chips'); };
}

/* ---------- sources bar ---------- */
function renderSources() {
  const el = $('#sources');
  el.innerHTML = S.sources.map(s => {
    const off = s.OF[0] ?? 0;
    const d0 = Math.floor((s.t0 + off * MIN) / DAY), d1 = Math.floor((s.t1 + off * MIN) / DAY);
    const others = S.sources.filter(o => o !== s);
    return `<div class="src${S.hidden.has(s.id) ? ' off' : ''}" data-id="${s.id}" title="${esc(s.files.slice(0, 6).join(', '))}${s.files.length > 6 ? '…' : ''}">
      <button class="sw" style="background:${inkOf(s)}" title="Change colour" aria-label="Change colour of ${esc(s.name)}"></button>
      <span class="nm" contenteditable="true" spellcheck="false">${esc(s.name)}</span>
      <span class="meta" title="${fmtDay(d0)} to ${fmtDay(d1)}, ${s.T.length.toLocaleString('en-GB')} records, ${s.visits.length.toLocaleString('en-GB')} stays, ${s.trips.length.toLocaleString('en-GB')} trips${s.derivedVisits ? '. Stays and trips were found from the raw records.' : ''}${s.gapTrips ? `. ${s.gapTrips.toLocaleString('en-GB')} segments of over 2 h at under 1 km/h are treated as gaps, not trips.` : ''}">${monthLabel(monthOfDay(d0))}–${monthLabel(monthOfDay(d1))}</span>
      <button class="btn small vis" title="${S.hidden.has(s.id) ? 'Show' : 'Hide'} this device">${S.hidden.has(s.id) ? 'Show' : 'Hide'}</button>
      ${others.length ? `<select title="Join this source with another one (for example, two files from the same phone)" aria-label="Join with"><option value="">Join</option>${others.map(o => `<option value="${o.id}">Join with ${esc(o.name)}</option>`).join('')}</select>` : ''}
      <button class="x" title="Remove" aria-label="Remove ${esc(s.name)}">×</button></div>`;
  }).join('');
  $$('.src', el).forEach(c => {
    const s = S.sources.find(x => x.id === +c.dataset.id);
    c.querySelector('.sw').onclick = () => {
      const used = new Set(S.sources.map(o => o.colorIdx));
      let k = s.colorIdx; for (let n = 0; n < INKS_L.length; n++) { k = (k + 1) % INKS_L.length; if (!used.has(k)) break; }
      s.colorIdx = k; afterSourceStyle();
    };
    const nm = c.querySelector('.nm');
    nm.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); nm.blur(); } };
    nm.onblur = () => { const v = nm.textContent.trim(); if (v && v !== s.name) { s.name = v; renderLegend(); renderTogether(); } else nm.textContent = s.name; };
    c.querySelector('.vis').onclick = () => {
      if (S.hidden.has(s.id)) S.hidden.delete(s.id);
      else { if (S.sources.filter(o => !S.hidden.has(o.id)).length <= 1) { toast('At least one device must stay visible.'); return; } S.hidden.add(s.id); }
      if (S.mode === 'combined') rebuildAll(); else { markDuplicates(); renderSources(); renderTogether(); refresh('sources'); }
    };
    const sel = c.querySelector('select');
    if (sel) sel.onchange = async () => {
      const o = S.sources.find(x => x.id === +sel.value); if (!o) return;
      await busy(`Joining ${s.name} and ${o.name}`, async () => {
        const joined = finalize(joinRaws(s.raw, o.raw), s.id);
        joined.colorIdx = s.colorIdx;
        S.sources = S.sources.filter(x => x !== o).map(x => x === s ? joined : x);
        S.hidden.delete(o.id);
      });
      rebuildAll();
    };
    c.querySelector('.x').onclick = () => {
      S.sources = S.sources.filter(x => x !== s); S.hidden.delete(s.id);
      if (!S.sources.length) { location.reload(); return; }
      rebuildAll();
    };
  });
  $$('#combineSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.mode));
  $('#combineSeg').style.display = S.sources.length > 1 ? '' : 'none';
}
function renderTogether() {
  const el = $('#together');
  const vis = S.sources.filter(s => !S.hidden.has(s.id));
  if (S.mode !== 'separate' || vis.length < 2) { el.textContent = ''; el.title = ''; return; }
  const pairs = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) { const r = togetherness(vis[i], vis[j]); if (r) pairs.push([vis[i], vis[j], r]); }
  if (!pairs.length) { el.textContent = 'Devices never overlap in time'; el.title = ''; return; }
  pairs.sort((a, b) => b[2].hours - a[2].hours);
  const [a, b, r] = pairs[0];
  el.textContent = `${a.name} and ${b.name} together ${Math.round(r.pct * 100)}% of the time`;
  el.title = 'When both devices have records, how often are they less than 300 m apart?\n' + pairs.map(([a, b, r]) => `${a.name} + ${b.name}: within 300 m for ${Math.round(r.pct * 100)}% of ${Math.round(r.hours).toLocaleString('en-GB')} h when both have records`).join('\n');
}
