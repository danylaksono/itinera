import { useEffect, useRef, useState } from 'react';
import { max as d3max, sum as d3sum, range, pointer, scaleSequential } from 'd3';
import { useStore, getState, setState } from '../store.js';
import { MIN, HOUR, DAY, DOWS, clamp, fmtKm, fmtDur, fmtDay, fmtDayShort, fmtLocal } from '../lib/util.js';
import { MODES, MODE_IDX, cssv, inkRamp, modeColor } from '../lib/colors.js';
import { activeSources, offNear, rangeToDays, srcById } from '../lib/analytics.js';
import { renamePlace, selectPlace, setFilter } from '../actions.js';
import { onClock } from '../playback.js';
import { showTip, hideTip } from '../tip.jsx';
import { useWidth } from '../hooks.js';
import Seg from './Seg.jsx';

export default function Side() {
  return (
    <aside className="side">
      <Filters />
      <Rhythm />
      <Modes />
      <Places />
    </aside>
  );
}

/* ---------- filter chips ---------- */
function rangeLabel(set, names) {
  const a = [...set].sort((x, y) => x - y);
  const runs = []; let s = a[0], p = a[0];
  for (let i = 1; i <= a.length; i++) { if (a[i] === p + 1) { p = a[i]; continue; } runs.push(s === p ? names(s) : `${names(s)}–${names(p)}`); s = p = a[i]; }
  return runs.join(', ');
}
function Filters() {
  const f = useStore(s => s.filter);
  useStore(s => s.labels);
  const st = getState();
  const chips = [];
  const days = rangeToDays(st);
  if (days) chips.push(['time', days[0] === days[1] ? fmtDay(days[0]) : `${fmtDayShort(days[0])} – ${fmtDay(days[1])}`]);
  if (f.dows) chips.push(['dows', rangeLabel(f.dows, i => DOWS[i])]);
  if (f.hours) chips.push(['hours', rangeLabel(f.hours, h => String(h).padStart(2, '0') + 'h')]);
  if (f.modes) chips.push(['modes', [...f.modes].map(k => MODES[MODE_IDX[k]].label).join(', ')]);
  if (f.place != null) chips.push(['place', `Trips to or from ${st.ctx.places[f.place]?.label}`]);
  const clear = k => setFilter(k === 'time' ? { t0: null, t1: null } : { [k]: null }, 'chips');
  return (
    <div className="filters" id="filters" aria-live="polite">
      {chips.length ? <>
        {chips.map(([k, l]) => <span className="chip" key={k}>{l}<button data-k={k} aria-label="Remove filter" onClick={() => clear(k)}>×</button></span>)}
        {chips.length > 1 && <button className="btn small" id="clearAll" onClick={() => setFilter(null, 'chips')}>Clear all</button>}
      </> : <span className="none">Showing all data. Brush the timeline, select calendar days, rhythm cells, modes or places to filter.</span>}
    </div>
  );
}

/* ---------- weekly rhythm: drag across cells to select hours and days ---------- */
function Rhythm() {
  const res = useStore(s => s.res), f = useStore(s => s.filter);
  useStore(s => s.dark);
  const svgRef = useRef(null), cur = useRef(null), geom = useRef(null);
  const [wrap, width] = useWidth();
  const [drag, setDrag] = useState(null);
  const W = Math.max(240, width), lw = 26, th = 14;
  const cw = (W - lw) / 24, ch = Math.min(18, Math.max(12, cw * 1.05));
  const H = th + 7 * ch + 2;
  geom.current = { lw, th, cw, ch };
  // current hour cell during playback
  useEffect(() => {
    let key = null;
    const mark = c => {
      const k = c == null ? null : Math.floor((c + offNear(getState(), c) * MIN) / HOUR);
      if (k === key) return; key = k;
      const r = cur.current; if (!r) return;
      if (c == null) { r.style.display = 'none'; return; }
      const L = c + offNear(getState(), c) * MIN, h = Math.floor((((L % DAY) + DAY) % DAY) / HOUR), dw = (Math.floor(L / DAY) + 3) % 7;
      const g = geom.current;
      r.style.display = ''; r.setAttribute('x', g.lw + h * g.cw); r.setAttribute('y', g.th + dw * g.ch);
    };
    return onClock(mark);
  }, []);
  if (!res) return null;
  const max = d3max(res.rhythm) || 1;
  const col = scaleSequential(inkRamp()).domain([0, max]);
  const inSel = (dw, h) => (!f.hours || f.hours.has(h)) && (!f.dows || f.dows.has(dw));
  const toCell = ev => { const [mx, my] = pointer(ev, svgRef.current); return { h: clamp(Math.floor((mx - lw) / cw), 0, 23), dw: clamp(Math.floor((my - th) / ch), 0, 6), out: mx < lw || my < th }; };
  const norm = ({ a, b }) => [Math.min(a.h, b.h), Math.max(a.h, b.h), Math.min(a.dw, b.dw), Math.max(a.dw, b.dw)];
  const down = ev => { const c = toCell(ev); if (c.out) return; svgRef.current.setPointerCapture(ev.pointerId); hideTip(); setDrag({ a: c, b: c }); };
  const move = ev => { if (drag) setDrag({ a: drag.a, b: toCell(ev) }); };
  const up = () => {
    if (!drag) return;
    const [h0, h1, d0, d1] = norm(drag); setDrag(null);
    const single = h0 === h1 && d0 === d1;
    if (single && f.hours?.size === 1 && f.hours.has(h0) && f.dows?.size === 1 && f.dows.has(d0)) setFilter({ hours: null, dows: null }, 'rhythm');
    else setFilter({ hours: h0 === 0 && h1 === 23 ? null : new Set(range(h0, h1 + 1)), dows: d0 === 0 && d1 === 6 ? null : new Set(range(d0, d1 + 1)) }, 'rhythm');
  };
  const pickDay = i => setFilter({ dows: f.dows && f.dows.has(i) && f.dows.size === 1 ? null : new Set([i]) }, 'rhythm');
  const cells = [];
  for (let dw = 0; dw < 7; dw++) for (let h = 0; h < 24; h++) {
    const v = res.rhythm[dw * 24 + h];
    cells.push(<rect key={dw * 24 + h} className="cell" x={lw + h * cw + 0.5} y={th + dw * ch + 0.5} width={cw - 1} height={ch - 1} rx="1.5" fill={col(v)} opacity={inSel(dw, h) ? 1 : 0.22}
      onMouseMove={ev => { if (!drag) showTip(ev, <><b>{DOWS[dw]}, {String(h).padStart(2, '0')}:00–{String(h + 1).padStart(2, '0')}:00</b><br />{v.toFixed(1)} min on the move, on average, on {DOWS[dw]} days with records</>); }}
      onMouseLeave={hideTip} />);
  }
  const sel = drag && norm(drag);
  return (
    <section className="panel">
      <div className="panel-head"><h2>Weekly rhythm</h2><span className="hint" id="rhythmUnit">darkest = {Math.round(max)} min</span></div>
      <p className="hint">Average minutes on the move in each hour, on days with records. Drag across cells to select hours and days.</p>
      <div id="rhythm" ref={wrap}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
          {[0, 6, 12, 18, 23].map(h => <text key={h} x={lw + h * cw + cw / 2} y="10" textAnchor="middle" fontSize="10.5" fill={cssv('--ink-3')}>{h}h</text>)}
          {DOWS.map((d, i) => <text key={d} x={lw - 5} y={th + i * ch + ch * 0.72} textAnchor="end" fontSize="10.5" fill={cssv('--ink-2')} style={{ cursor: 'pointer' }} onClick={() => pickDay(i)}>{d.slice(0, 2)}</text>)}
          <g>{cells}</g>
          <rect ref={cur} fill="none" stroke={cssv('--ink')} strokeWidth="1.6" width={cw} height={ch} style={{ display: 'none' }} />
          {sel && <rect fill="none" stroke={cssv('--sel-line')} strokeDasharray="3 2" x={lw + sel[0] * cw} y={th + sel[2] * ch} width={(sel[1] - sel[0] + 1) * cw} height={(sel[3] - sel[2] + 1) * ch} />}
        </svg>
      </div>
    </section>
  );
}

/* ---------- ways of travel ---------- */
function Modes() {
  const res = useStore(s => s.res), f = useStore(s => s.filter), key = useStore(s => s.modeMetric);
  useStore(s => s.dark);
  if (!res) return null;
  const rows = res.modes.filter(m => m.n);
  const max = d3max(rows, m => m[key]) || 1;
  const tot = d3sum(rows, m => m[key]) || 1;
  const toggle = k => {
    const cur = getState().filter.modes;
    let modes;
    if (!cur) modes = new Set([k]);
    else { modes = new Set(cur); if (modes.has(k)) modes.delete(k); else modes.add(k); if (!modes.size) modes = null; }
    setFilter({ modes }, 'modes');
  };
  return (
    <section className="panel">
      <div className="panel-head"><h2>Ways of travel</h2><Seg id="modeMetric" value={key} onChange={v => setState({ modeMetric: v })} options={[['dist', 'Distance'], ['dur', 'Time']]} /></div>
      <p className="hint">Select a row to show only that mode.</p>
      <div id="modes">
        {rows.map(m => {
          const on = !f.modes || f.modes.has(m.k), w = m[key] / max * 100;
          return (
            <div key={m.k} className={'mode-row' + (on ? '' : ' off')} data-k={m.k} role="button" tabIndex="0" title={`${m.n} trips, ${Math.round(m[key] / tot * 100)}% of the total`}
              onClick={() => toggle(m.k)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(m.k); } }}>
              <span className="nm"><i style={{ background: modeColor(m.k) }}></i>{MODES[MODE_IDX[m.k]].label}</span>
              <span className="bar-bg"><span className="ghost" style={{ width: w + '%' }}></span><span className="fill" style={{ width: w + '%', background: modeColor(m.k) }}></span></span>
              <span className="num">{key === 'dist' ? `${fmtKm(m.dist)} km` : fmtDur(m.dur)}</span>
            </div>
          );
        })}
        <div className="mode-foot">{res.T.length.toLocaleString('en-GB')} trips in the selection{activeSources(getState()).some(s => s.derivedTrips) ? '. Modes for records without labels are estimated from speed.' : ''}</div>
      </div>
    </section>
  );
}

/* ---------- places, ranked by time ---------- */
function Places() {
  const res = useStore(s => s.res), ctx = useStore(s => s.ctx), sel = useStore(s => s.filter.place), open = useStore(s => s.openPlace), hl = useStore(s => s.hlPlace);
  useStore(s => s.labels); useStore(s => s.dark);
  const [limit, setLimit] = useState(12);
  if (!res) return null;
  const st = getState();
  const days = rangeToDays(st);
  const nW = ctx.wk1 - ctx.wk0 + 1;
  const w0 = days ? Math.floor((days[0] + 3) / 7) - ctx.wk0 : null, w1 = days ? Math.floor((days[1] + 3) / 7) - ctx.wk0 : null;
  const spark = pi => {
    const a = res.placeWeeks.get(pi); if (!a) return null;
    const W = 90, H = 20, max = d3max(a) || 1, bw = W / nW;
    let d = '';
    for (let i = 0; i < nW; i++) { const v = a[i]; if (v <= 0) continue; const h = Math.max(1, v / max * (H - 3)); d += `M${(i * bw + bw / 2).toFixed(1)},${H}v${-h.toFixed(1)}`; }
    return <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {w0 != null && <rect x={w0 * bw} y="0" width={Math.max(2, (w1 - w0 + 1) * bw)} height={H} fill={cssv('--sel')} />}
      <path d={d} stroke={cssv('--ink-2')} strokeWidth={Math.max(0.8, Math.min(2, bw * 0.8))} />
    </svg>;
  };
  const hover = i => { if (getState().hlPlace !== i) setState({ hlPlace: i }); };
  return (
    <section className="panel">
      <div className="panel-head"><h2>Places</h2><span className="hint" id="placeCount">{res.places.length.toLocaleString('en-GB')} in selection</span></div>
      <p className="hint">Ranked by time spent. The sparkline shows each week. Select a place to see only trips to and from it.</p>
      <div id="places">
        {res.places.slice(0, limit).map((o, r) => {
          const p = ctx.places[o.i];
          const isOpen = open === o.i;
          return (
            <div key={o.i} className={'place' + (sel === o.i ? ' sel' : '') + (hl === o.i ? ' hl' : '')} data-i={o.i} tabIndex="0" role="button" aria-expanded={isOpen}
              onMouseEnter={() => hover(o.i)} onMouseLeave={() => hover(null)}
              onClick={e => { if (!e.target.closest('.place-more')) selectPlace(o.i, true); }}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('input')) { e.preventDefault(); selectPlace(o.i, true); } }}>
              <div className="place-top">
                <span className="rk">{r + 1}</span>
                <span className="pn">{p.label}{p.role && !p.label.startsWith(p.role) ? <span className="role">{p.role}{p.inferredRole ? '?' : ''}</span> : p.role && p.inferredRole ? <span className="role">inferred</span> : null}</span>
                {spark(o.i)}
                <span className="hrs">{fmtDur(o.dur)}</span>
              </div>
              {isOpen && <PlaceMore o={o} p={p} />}
            </div>
          );
        })}
        {res.places.length > limit && <button className="btn small" id="morePlaces" style={{ marginTop: 8 }} onClick={() => setLimit(l => l + 30)}>Show {Math.min(30, res.places.length - limit)} more</button>}
      </div>
    </section>
  );
}
function PlaceMore({ o, p }) {
  const st = getState();
  const W = 150, H = 44, mx = d3max(o.arr) || 1, bw = W / 24;
  const srcNames = [...o.srcs].map(id => srcById(st, id)?.name).filter(Boolean);
  const off = offNear(st, o.first);
  const commit = e => renamePlace(p.key, e.currentTarget.value);
  return (
    <div className="place-more">
      <label className="nm-edit">Name <input type="text" key={p.label} defaultValue={p.custom || p.name || ''} placeholder={p.role || 'Give this place a name'}
        onKeyDown={e => { if (e.key === 'Enter') commit(e); e.stopPropagation(); }} onBlur={commit} /></label>
      <dl>
        <dt>Visits</dt><dd>{o.n}</dd>
        <dt>Typical stay</dt><dd>{fmtDur(o.dur / o.n)}</dd>
        <dt>First</dt><dd>{fmtLocal(o.first, off).date.slice(4)}</dd>
        <dt>Last</dt><dd>{fmtLocal(o.last, off).date.slice(4)}</dd>
        {p.country && <><dt>Where</dt><dd>{p.town ? 'Near ' + p.town + ', ' : ''}{p.country}</dd></>}
        {st.mode === 'separate' && srcNames.length > 0 && <><dt>Seen by</dt><dd>{srcNames.join(', ')}</dd></>}
      </dl>
      <div>Arrival hour<svg viewBox={`0 0 ${W} ${H}`}>
        {[...o.arr].map((v, h) => <rect key={h} x={h * bw + .5} y={H - 12 - v / mx * (H - 16)} width={bw - 1} height={v / mx * (H - 16)} fill={cssv('--ink-2')} />)}
        {[0, 6, 12, 18].map(h => <text key={h} x={h * bw} y={H - 1} fontSize="9.5" fill={cssv('--ink-3')}>{h}h</text>)}
      </svg></div>
    </div>
  );
}
