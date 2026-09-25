import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import { useStore, getState, setState } from '../store.js';
import { MIN, DAY, DOWS, MONTHS, clamp, fmtKm, fmtDay, fmtLocal } from '../lib/util.js';
import { cssv, inkOf, inkRamp } from '../lib/colors.js';
import { activeSources, dayToUtc, offNear, playRange, rangeToDays, srcById } from '../lib/analytics.js';
import { setTimeRange } from '../actions.js';
import { fmtRate, getClock, onClock, speedRate, stopPlay, togglePlay, useClock } from '../playback.js';
import { showTip, hideTip } from '../tip.jsx';
import { useWidth } from '../hooks.js';

export default function Time() {
  return (
    <footer className="time">
      <Player />
      <div className="time-body">
        <Timeline />
        <Calendar />
      </div>
    </footer>
  );
}

function Player() {
  const playing = useStore(s => s.playing), speed = useStore(s => s.speed), skip = useStore(s => s.skip), follow = useStore(s => s.follow);
  return (
    <div className="player">
      <button className="play" id="playBtn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => togglePlay()}>
        <svg viewBox="0 0 14 14"><path id="playIcon" d={playing ? 'M3 1.5h3v11H3zM8 1.5h3v11H8z' : 'M3 1.5v11l9-5.5z'} fill="currentColor" /></svg>
      </button>
      <button className="btn small" id="stopBtn" title="Stop and show all trips" onClick={stopPlay}>Reset</button>
      <Clock />
      <label className="speed">Speed <input type="range" id="speed" min="0" max="100" value={speed} onChange={e => setState({ speed: +e.target.value })} /><output id="speedOut">{fmtRate(speedRate(speed))}</output></label>
      <label className="chk"><input type="checkbox" id="skipStays" checked={skip} onChange={e => setState({ skip: e.target.checked })} /> Skip time at places</label>
      <label className="chk"><input type="checkbox" id="follow" checked={follow} onChange={e => setState({ follow: e.target.checked })} /> Follow on map</label>
    </div>
  );
}
function Clock() {
  const c = useClock();
  useStore(s => s.res);
  const st = getState();
  if (!st.ctx) return <div className="clock" id="clock">—</div>;
  if (c == null) {
    const [a, b] = playRange(st), off = offNear(st, a);
    return <div className="clock" id="clock">{fmtDay(Math.floor((a + off * MIN) / DAY))} <small>to {fmtDay(Math.floor((b + off * MIN) / DAY))}</small></div>;
  }
  const f = fmtLocal(c, offNear(st, c));
  return <div className="clock" id="clock">{f.date} <small>{f.time}</small></div>;
}

/* ---------- timeline: daily distance, distance from home, coverage, brush ---------- */
function Timeline() {
  const res = useStore(s => s.res);
  const dark = useStore(s => s.dark);
  const [ref, width] = useWidth();
  const T = useRef({ x: null, brush: null, gBrush: null, silent: false, playhead: null, drawn: null });

  useEffect(() => {
    const el = ref.el, st = getState();
    if (!el || !res || !width) return;
    const key = [st.ctx, width, dark, st.sources, st.hidden, st.mode];
    const same = T.current.drawn?.every((v, i) => v === key[i]);
    // a change from the brush itself must not redraw it, or the drag is cut off
    if (same && st.from === 'timeline') return;
    if (same && st.from === 'calendar') { syncBrush(T.current, st); return; }
    T.current.drawn = key;
    draw(el, T.current, st, width);
  }, [res, width, dark]);

  useEffect(() => onClock(c => drawPlayhead(T.current, c)), []);
  return <div id="timeline" ref={ref}></div>;
}
function draw(el, TL, st, width) {
  const ctx = st.ctx, res = st.res;
  const srcs = activeSources(st);
  const W = Math.max(200, width - 22);
  const bandA = 58, bandB = 16, rowH = 5, gap = 12;
  const covH = srcs.length * (rowH + 2);
  const H = 14 + bandA + gap + bandB + gap + covH + 22;
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
    .attr('d', area).attr('fill', dd => st.mode === 'combined' ? cssv('--ink-2') : inkOf(srcById(st, +dd.key))).attr('opacity', 0.85);
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
    const segs = []; let st0 = -1;
    for (let d = 0; d <= arr.length; d++) {
      const on = d < arr.length && arr[d] > 0;
      if (on && st0 < 0) st0 = d; if (!on && st0 >= 0) { segs.push([st0, d]); st0 = -1; }
    }
    g.append('g').selectAll('rect').data(segs).join('rect')
      .attr('x', d => x((ctx.day0 + d[0]) * DAY)).attr('width', d => Math.max(1, x((ctx.day0 + d[1]) * DAY) - x((ctx.day0 + d[0]) * DAY)))
      .attr('y', yC + k * (rowH + 2)).attr('height', rowH).attr('rx', 1)
      .attr('fill', st.mode === 'combined' ? cssv('--ink-2') : inkOf(s)).attr('opacity', st.hidden.has(s.id) ? 0.25 : 0.9);
  });
  // --- axis
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - 20})`).call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(W / 90))).tickSizeOuter(0));
  // --- playhead
  TL.playhead = g.append('line').attr('y1', 12).attr('y2', H - 20).attr('stroke', cssv('--ink')).attr('stroke-width', 1.5).style('display', 'none');
  const hover = g.append('line').attr('y1', 12).attr('y2', H - 20).attr('stroke', cssv('--ink-3')).attr('stroke-dasharray', '2 2').style('display', 'none').attr('pointer-events', 'none');
  // --- brush
  const brushed = (ev, end) => {
    if (!ev.selection) { setTimeRange(null, null, 'timeline'); return; }
    const [a, b] = ev.selection.map(v => x.invert(v).getTime() / DAY);
    const d0 = Math.floor(a), d1 = Math.max(d0, Math.ceil(b) - 1);
    if (end) { TL.silent = true; TL.gBrush.call(TL.brush.move, [x(d0 * DAY), x((d1 + 1) * DAY)]); TL.silent = false; }
    const s2 = getState();
    setTimeRange(dayToUtc(s2, d0), dayToUtc(s2, d1 + 1) - 1, 'timeline');
  };
  TL.brush = d3.brushX().extent([[0, 12], [W, H - 20]])
    .on('brush', ev => { if (TL.silent || !ev.sourceEvent) return; brushed(ev, false); })
    .on('end', ev => { if (TL.silent || !ev.sourceEvent) return; brushed(ev, true); });
  TL.gBrush = g.append('g').attr('class', 'brush').call(TL.brush);
  TL.gBrush.selectAll('.overlay') // selectAll: select() would copy the group's datum over the brush's {type}
    .on('mousemove.tip', ev => {
      const [mx] = d3.pointer(ev); const day = Math.floor(x.invert(mx).getTime() / DAY); const d = day - ctx.day0;
      if (d < 0 || d >= ctx.nDays) return;
      hover.style('display', null).attr('x1', mx).attr('x2', mx);
      const r = getState().res;
      showTip(ev, <>
        <b>{fmtDay(day)}</b>
        {srcs.map(s => <span key={s.id}><br />{srcs.length > 1 ? s.name + ': ' : ''}{fmtKm(r.daily.get(s.id)?.[d] || 0)} km, {(ctx.cover.get(s.id)?.[d] || 0).toLocaleString('en-GB')} records</span>)}
        {r.far && <><br /><span className="m">{fmtKm(r.far[d])} km from home at most</span></>}
      </>);
    })
    .on('mouseleave.tip', () => { hover.style('display', 'none'); hideTip(); });
  syncBrush(TL, st);
  drawPlayhead(TL, getClock());
}
function syncBrush(TL, st) {
  if (!TL.gBrush) return;
  const days = rangeToDays(st);
  TL.silent = true;
  TL.gBrush.call(TL.brush.move, days ? [TL.x(days[0] * DAY), TL.x((days[1] + 1) * DAY)] : null);
  TL.silent = false;
}
function drawPlayhead(TL, c) {
  if (!TL.playhead) return;
  if (c == null) { TL.playhead.style('display', 'none'); return; }
  const xx = TL.x(c + offNear(getState(), c) * MIN);
  TL.playhead.style('display', null).attr('x1', xx).attr('x2', xx);
}

/* ---------- calendar heatmap (quantile colours) ---------- */
function Calendar() {
  const res = useStore(s => s.res), ctx = useStore(s => s.ctx);
  useStore(s => s.filter); useStore(s => s.dark);
  const [ref, width] = useWidth();
  const cur = useRef(null), pos = useRef(new Map()), cellSize = useRef(10), scrolled = useRef(false);
  const W = Math.max(260, width - 24);
  const cs = clamp(Math.floor((W - 26) / 54), 6, 13);
  cellSize.current = cs;
  const { tot, has } = useMemo(() => {
    if (!res) return {};
    const tot = new Float64Array(ctx.nDays), has = new Uint8Array(ctx.nDays);
    for (const [, arr] of res.daily) for (let i = 0; i < arr.length; i++) tot[i] += arr[i];
    for (const [, arr] of ctx.cover) for (let i = 0; i < arr.length; i++) if (arr[i]) has[i] = 1;
    return { tot, has };
  }, [res, ctx]);
  useEffect(() => { if (!scrolled.current && res && ref.el) { ref.el.scrollTop = ref.el.scrollHeight; scrolled.current = true; } }, [res, ref]);
  // current day during playback
  useEffect(() => {
    let key = null;
    return onClock(c => {
      const day = c == null ? null : Math.floor((c + offNear(getState(), c) * MIN) / DAY);
      if (day === key) return; key = day;
      const r = cur.current; if (!r) return;
      const p = day == null ? null : pos.current.get(day);
      if (!p) { r.style.display = 'none'; return; }
      r.style.display = ''; r.setAttribute('x', p.x); r.setAttribute('y', p.y);
      r.setAttribute('width', cellSize.current); r.setAttribute('height', cellSize.current);
    });
  }, []);
  if (!res) return <div id="calendar" ref={ref}></div>;
  const st = getState();
  const y0 = new Date(ctx.day0 * DAY).getUTCFullYear(), y1 = new Date(ctx.day1 * DAY).getUTCFullYear();
  const years = d3.range(y0, y1 + 1);
  const blockH = 7 * cs + 22;
  const H = years.length * blockH + 4;
  const nz = [...tot].filter(v => v > 0).sort((a, b) => a - b);
  const q = d3.scaleSequentialQuantile(inkRamp()).domain(nz.map(v => v / 1000));
  const col = v => nz.length ? q(v) : cssv('--ink');
  const r = rangeToDays(st);
  const ink3 = cssv('--ink-3'), rule = cssv('--rule'), rule2 = cssv('--rule-2');
  const labels = [], cells = [];
  pos.current = new Map();
  years.forEach((yr, yi) => {
    const jan1 = Date.UTC(yr, 0, 1) / DAY, dec31 = Date.UTC(yr, 11, 31) / DAY;
    const off = (jan1 + 3) % 7; // monday-based weekday of Jan 1
    const top = yi * blockH + 16;
    labels.push(<text key={'y' + yr} className="cal-year" x="0" y={yi * blockH + 11}>{yr}</text>);
    ['M', '', 'W', '', 'F', '', 'S'].forEach((l, i) => l && labels.push(<text key={`d${yr}${i}`} x="18" y={top + i * cs + cs * 0.8} textAnchor="end" fontSize="9.5" fill={ink3}>{l}</text>));
    for (let m = 0; m < 12; m++) {
      const wk = Math.floor((Date.UTC(yr, m, 1) / DAY - jan1 + off) / 7);
      labels.push(<text key={`m${yr}${m}`} x={26 + wk * cs} y={top + 7 * cs + 11} fontSize="9.5" fill={ink3}>{MONTHS[m][0]}</text>);
    }
    for (let day = Math.max(jan1, ctx.day0); day <= Math.min(dec31, ctx.day1); day++) {
      const i = day - ctx.day0;
      const x = 26 + Math.floor((day - jan1 + off) / 7) * cs, y = top + ((day + 3) % 7) * cs;
      pos.current.set(day, { x, y });
      cells.push(<rect key={day} x={x + 0.5} y={y + 0.5} width={cs - 1.5} height={cs - 1.5} rx="1.5"
        fill={has[i] ? (tot[i] > 0 ? col(tot[i] / 1000) : rule2) : 'none'} stroke={has[i] ? 'none' : rule} strokeWidth="0.7"
        opacity={!r || (day >= r[0] && day <= r[1]) ? 1 : 0.25} style={{ cursor: 'pointer' }}
        onMouseMove={ev => showTip(ev, <><b>{DOWS[(day + 3) % 7]} {fmtDay(day)}</b><br />{has[i] ? fmtKm(tot[i]) + ' km travelled' : 'No records'}{res.far && has[i] ? <><br /><span className="m">{fmtKm(res.far[i])} km from home at most</span></> : null}</>)}
        onMouseLeave={hideTip}
        onClick={ev => {
          const s2 = getState(), c = rangeToDays(s2);
          if (ev.shiftKey && c) { const a = Math.min(c[0], day), b = Math.max(c[1], day); setTimeRange(dayToUtc(s2, a), dayToUtc(s2, b + 1) - 1, 'calendar'); }
          else if (c && c[0] === day && c[1] === day) setTimeRange(null, null, 'calendar');
          else setTimeRange(dayToUtc(s2, day), dayToUtc(s2, day + 1) - 1, 'calendar');
        }} />);
    }
  });
  return (
    <div id="calendar" ref={ref}>
      <svg width={26 + 54 * cs} height={H}>
        {labels}
        <g>{cells}</g>
        <rect ref={cur} fill="none" stroke={cssv('--ink')} strokeWidth="1.6" width={cs} height={cs} style={{ display: 'none' }} pointerEvents="none" />
      </svg>
    </div>
  );
}
