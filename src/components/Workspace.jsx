import { useEffect, useRef } from 'react';
import anime from 'animejs/lib/anime.es.js';
import { max as d3max } from 'd3';
import { useStore, getState } from '../store.js';
import { MIN, DAY, clamp, fmtKm, fmtDay, monthLabel, monthOfDay } from '../lib/util.js';
import { cssv, inkOf } from '../lib/colors.js';
import { rangeToDays, visibleSources } from '../lib/analytics.js';
import { exportSelection, joinSources, recolour, removeSource, renameSource, setMode, toggleHidden } from '../actions.js';
import { useWidth, reducedMotion } from '../hooks.js';
import { Wordmark } from './Landing.jsx';
import Seg from './Seg.jsx';
import Stage from './Stage.jsx';
import Side from './Side.jsx';
import Time from './Time.jsx';
import '../testHook.js';

export default function Workspace({ onPick }) {
  return (
    <div id="app">
      <TopBar onPick={onPick} />
      <Kpis />
      <main className="work">
        <Stage />
        <Side />
      </main>
      <Time />
    </div>
  );
}

/* ---------- top bar: devices ---------- */
function TopBar({ onPick }) {
  const sources = useStore(s => s.sources), hidden = useStore(s => s.hidden), mode = useStore(s => s.mode);
  useStore(s => s.dark);
  return (
    <header className="bar">
      <Wordmark size={20} title="Itinera" />
      <div className="sources" id="sources" aria-label="Loaded sources">
        {sources.map(s => <SourceChip key={s.id} s={s} sources={sources} off={hidden.has(s.id)} />)}
      </div>
      <div className="bar-actions">
        <Together />
        <Seg id="combineSeg" label="How to show devices" value={mode} onChange={setMode} style={{ display: sources.length > 1 ? undefined : 'none' }}
          options={[['separate', 'Separate', 'Each device in its own colour'], ['combined', 'Combined', 'Merge all devices into one history']]} />
        <button className="btn" id="addBtn" onClick={onPick}>Add files</button>
        <button className="btn" id="exportBtn" title="Save the selected places and trips as GeoJSON" onClick={exportSelection}>Export</button>
      </div>
    </header>
  );
}
function SourceChip({ s, sources, off }) {
  const o0 = s.OF[0] ?? 0;
  const d0 = Math.floor((s.t0 + o0 * MIN) / DAY), d1 = Math.floor((s.t1 + o0 * MIN) / DAY);
  const others = sources.filter(o => o !== s);
  const n = v => v.toLocaleString('en-GB');
  const meta = `${fmtDay(d0)} to ${fmtDay(d1)}, ${n(s.T.length)} records, ${n(s.visits.length)} stays, ${n(s.trips.length)} trips${s.derivedVisits ? '. Stays and trips were found from the raw records.' : ''}${s.gapTrips ? `. ${n(s.gapTrips)} segments of over 2 h at under 1 km/h are treated as gaps, not trips.` : ''}`;
  const commit = e => { const v = e.currentTarget.textContent.trim(); if (v && v !== s.name) renameSource(s, v); else e.currentTarget.textContent = s.name; };
  return (
    <div className={'src' + (off ? ' off' : '')} data-id={s.id} title={s.files.slice(0, 6).join(', ') + (s.files.length > 6 ? '…' : '')}>
      <button className="sw" style={{ background: inkOf(s) }} title="Change colour" aria-label={`Change colour of ${s.name}`} onClick={() => recolour(s)} />
      <span className="nm" key={s.name} contentEditable suppressContentEditableWarning spellCheck={false}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} onBlur={commit}>{s.name}</span>
      <span className="meta" title={meta}>{monthLabel(monthOfDay(d0))}–{monthLabel(monthOfDay(d1))}</span>
      <button className="btn small vis" title={`${off ? 'Show' : 'Hide'} this device`} onClick={() => toggleHidden(s.id)}>{off ? 'Show' : 'Hide'}</button>
      {others.length > 0 && (
        <select title="Join this source with another one (for example, two files from the same phone)" aria-label="Join with" value=""
          onChange={e => { const o = sources.find(x => x.id === +e.target.value); if (o) joinSources(s, o); }}>
          <option value="">Join</option>
          {others.map(o => <option key={o.id} value={o.id}>Join with {o.name}</option>)}
        </select>
      )}
      <button className="x" title="Remove" aria-label={`Remove ${s.name}`} onClick={() => removeSource(s)}>×</button>
    </div>
  );
}
/* how often two devices were within 300 m of each other */
function Together() {
  const pairs = useStore(s => s.pairs), sources = useStore(s => s.sources), mode = useStore(s => s.mode), hidden = useStore(s => s.hidden);
  const vis = sources.filter(s => !hidden.has(s.id));
  let text = '', title = '';
  if (mode === 'separate' && vis.length >= 2) {
    const nm = id => sources.find(s => s.id === id)?.name;
    if (!pairs.length) text = 'Devices never overlap in time';
    else {
      const [a, b, r] = pairs[0];
      text = `${nm(a)} and ${nm(b)} together ${Math.round(r.pct * 100)}% of the time`;
      title = 'When both devices have records, how often are they less than 300 m apart?\n' + pairs.map(([a, b, r]) => `${nm(a)} + ${nm(b)}: within 300 m for ${Math.round(r.pct * 100)}% of ${Math.round(r.hours).toLocaleString('en-GB')} h when both have records`).join('\n');
    }
  }
  return <span className="together" id="together" title={title}>{text}</span>;
}

/* ---------- KPIs with monthly sparklines ---------- */
const KPI_DEF = [
  { k: 'dist', label: 'Distance travelled', unit: 'km', val: k => k.dist / 1000, fmt: v => fmtKm(v * 1000), series: 'dist', sl: 'Distance each month' },
  { k: 'days', label: 'Days with data', unit: '', val: k => k.days, fmt: v => Math.round(v).toLocaleString('en-GB'), series: 'days', sl: 'Days with data each month' },
  { k: 'places', label: 'Places visited', unit: '', val: k => k.places, fmt: v => Math.round(v).toLocaleString('en-GB'), series: 'places', sl: 'New places each month' },
  { k: 'countries', label: 'Countries', unit: '', val: k => k.countries, fmt: v => Math.round(v), series: 'countries', sl: 'Countries each month' },
  { k: 'rog', label: 'Radius of gyration', unit: 'km', val: k => k.rog / 1000, fmt: v => v >= 100 ? Math.round(v).toLocaleString('en-GB') : v.toFixed(1), series: 'rog', sl: 'Typical spread of your places, each month' },
  { k: 'home', label: 'Time at home', unit: '%', val: k => k.home == null ? NaN : k.home * 100, fmt: v => isNaN(v) ? '–' : Math.round(v), series: 'home', sl: 'Share of time at home each month. Home can change over time: each month it is the place with most nights, and Google home labels count extra. Months with no clear home are left out.' }
];
function Kpis() {
  const res = useStore(s => s.res), ctx = useStore(s => s.ctx);
  useStore(s => s.hidden); useStore(s => s.dark);
  const st = getState();
  if (!res) return <section className="kpis" id="kpis" aria-label="Summary" />;
  const days = rangeToDays(st);
  const m0 = days ? monthOfDay(days[0]) - ctx.mon0 : null, m1 = days ? monthOfDay(days[1]) - ctx.mon0 : null;
  const multi = visibleSources(st).length > 1 ? ' Where devices overlap in time, only the device that covers the most days is counted.' : '';
  return (
    <section className="kpis" id="kpis" aria-label="Summary">
      {KPI_DEF.map(d => {
        let title = d.sl + multi, label = d.label;
        if (d.k === 'countries') title = [...res.kpi.countryList].sort().join(', ') || d.sl;
        if (d.k === 'home' && ctx.homes.some(h => !h.labelled)) label = 'Time at home (inferred)';
        return <Kpi key={d.k} d={d} target={d.val(res.kpi)} title={title} label={label} series={res.monthly[d.series]} m0={m0} m1={m1} />;
      })}
    </section>
  );
}
function Kpi({ d, target, title, label, series, m0, m1 }) {
  const nRef = useRef(null), shown = useRef(0);
  const [svgRef, sw] = useWidth();
  const w = sw || 160;
  // count up from the last value
  useEffect(() => {
    const el = nRef.current, from = shown.current;
    shown.current = isNaN(target) ? 0 : target;
    if (isNaN(target)) { el.textContent = '–'; return; }
    if (reducedMotion()) { el.textContent = d.fmt(target); return; }
    const o = { v: isNaN(from) ? 0 : from };
    const a = anime({ targets: o, v: target, duration: 650, easing: 'easeOutCubic', update: () => { el.textContent = d.fmt(o.v); }, complete: () => { el.textContent = d.fmt(target); } });
    const to = setTimeout(() => { el.textContent = d.fmt(target); }, 900); // background tabs do not animate
    return () => { a.pause(); clearTimeout(to); el.textContent = d.fmt(target); };
  }, [target, d]);
  const h = 22, s = series, max = d3max(s) || 1;
  const x = i => s.length < 2 ? w / 2 : i / (s.length - 1) * w;
  const y = v => h - 2 - (v / max) * (h - 5);
  let band = null;
  if (m0 != null) {
    const a = clamp(m0, 0, s.length - 1), b = clamp(m1, 0, s.length - 1);
    const xa = s.length < 2 ? 0 : x(a) - w / (s.length - 1) / 2, xb = s.length < 2 ? w : x(b) + w / (s.length - 1) / 2;
    band = <rect x={Math.max(0, xa)} y="0" width={Math.max(2, Math.min(w, xb) - Math.max(0, xa))} height={h} fill={cssv('--sel')} />;
  }
  const line = s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = line + `L${x(s.length - 1)},${h}L${x(0)},${h}Z`;
  return (
    <div className="kpi" data-k={d.k} title={title}>
      <div className="v"><span className="n" ref={nRef}>0</span><small>{d.unit}</small></div>
      <div className="l">{label}</div>
      <svg ref={svgRef} preserveAspectRatio="none" viewBox={`0 0 ${w} ${h}`}>{band}<path d={area} fill={cssv('--ink')} opacity=".08" /><path d={line} fill="none" stroke={cssv('--ink-2')} strokeWidth="1.2" /></svg>
    </div>
  );
}
