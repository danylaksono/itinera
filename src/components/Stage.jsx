import { useEffect, useRef, useState } from 'react';
import { useStore, getState, setState, subscribe, showing } from '../store.js';
import { fmtKm, fmtDur } from '../lib/util.js';
import { selectPlace } from '../actions.js';
import { createMarey, LABEL_W } from '../marey/marey.jsx';
import { MODES, cssv, inkOf, modeColor, hourStops } from '../lib/colors.js';
import { visibleSources } from '../lib/analytics.js';
import { createMap, fitAll, fitHome, onMapMove, setView } from '../map/mapView.jsx';
import { createCube } from '../cube/cube.jsx';
import { getClock, onClock } from '../playback.js';
import Seg from './Seg.jsx';

const LAYERS = [
  ['trails', 'Trips'], ['heat', 'Density of records'], ['places', 'Places, sized by time spent'],
  ['flows', 'Flows between places'], ['ellipse', 'Activity space (std. ellipse)'], ['streets', 'Street map (online)']
];

export default function Stage() {
  const view = useStore(s => s.view), second = useStore(s => s.second), colorBy = useStore(s => s.colorBy), toast = useStore(s => s.toast);
  const setColor = v => setState({ colorBy: v });
  return (
    <section className="stage" aria-label="Map">
      <div className="stage-tools">
        <Seg id="viewSeg" label="View" value={view} onChange={setView} options={[['map', 'Map'], ['split', 'Split'], ['cube', 'Space-time cube'], ['marey', 'Place timetable']]} />
        <Seg id="colorSeg" label="Colour trips by" value={colorBy} onChange={setColor} options={[['device', 'Device'], ['mode', 'Travel mode'], ['hour', 'Time of day']]} />
        <Layers />
        <span className="sp"></span>
        <button className="btn" id="fitHome" title="Zoom to the area where you spend most time" onClick={() => fitHome(true)}>Home area</button>
        <button className="btn" id="fitAll" title="Zoom to all data" onClick={() => fitAll(true)}>All data</button>
      </div>
      <div className={`stage-body ${view} s-${second}`} id="stageBody">
        <MapHost />
        <CubeHost />
        <MareyHost />
      </div>
      <Legend />
      <div className="toast" id="toast" hidden={!toast}>{toast?.msg}</div>
    </section>
  );
}

function Layers() {
  const layers = useStore(s => s.layers);
  const [open, setOpen] = useState(false);
  const pop = useRef(null), btn = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!pop.current.contains(e.target) && e.target !== btn.current) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);
  const set = (k, on) => setState({ layers: { ...getState().layers, [k]: on } });
  return (
    <div className="layers">
      <button className="btn" id="layersBtn" ref={btn} aria-expanded={open} onClick={() => setOpen(o => !o)}>Layers</button>
      <div className="layers-pop" id="layersPop" ref={pop} hidden={!open}>
        {LAYERS.map(([k, l]) => <label key={k} className="chk"><input type="checkbox" data-l={k} checked={layers[k]} onChange={e => set(k, e.target.checked)} /> {l}</label>)}
        <div className="note">Street tiles come from an online server. Keep this off to stay fully offline. The built-in outline map shows coastlines only at country scale.</div>
      </div>
    </div>
  );
}

function MapHost() {
  const ref = useRef(null);
  useEffect(() => createMap(ref.current), []);
  return <div id="map" ref={ref}></div>;
}

/* The cube is made the first time it is shown, then follows the store, the map view and the clock. */
function CubeHost() {
  const ref = useRef(null), lbl = useRef(null);
  const [cap, setCap] = useState(null);
  useEffect(() => {
    let cube = null, prev = getState();
    const show = () => {
      if (!showing(getState(), 'cube')) { cube?.show(false); return; }
      if (!cube) cube = createCube(ref.current, lbl.current, setCap);
      if (!cube) return;
      cube.show(true);
      cube.setClock(getClock());
    };
    if (showing(prev, 'cube')) show();
    const unsub = subscribe(() => {
      const st = getState(), p = prev; prev = st;
      if (st.view !== p.view || st.second !== p.second) { requestAnimationFrame(show); return; }
      if (cube && (st.res !== p.res || st.ctx !== p.ctx || st.colorBy !== p.colorBy || st.dark !== p.dark || st.labels !== p.labels || st.sources !== p.sources)) cube.schedule();
    });
    const unmove = onMapMove(() => cube?.schedule());
    const unclock = onClock(t => cube?.setClock(t));
    return () => { unsub(); unmove(); unclock(); cube?.destroy(); };
  }, []);
  return (
    <div id="cube" ref={ref}>
      <div className="cube-cap" id="cubeCap">
        {cap?.error ? <><b>Space-time cube</b><br />{cap.error}</>
          : cap && <><b>Space-time cube.</b> Time goes up, from {cap.from} at the floor to {cap.to} at the top. The floor is the {cap.split ? 'map view on the left' : 'last map view'}. Columns are stays, lines are trips ({cap.nTrips.toLocaleString('en-GB')} shown). Drag to turn, scroll to zoom, double-click to reset.</>}
      </div>
      <div ref={lbl} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}></div>
    </div>
  );
}

/* The place timetable is made the first time it is shown, then follows the store and the clock.
   Row labels and the caption are React; the chart itself is src/marey/marey.jsx. */
function MareyHost() {
  const plot = useRef(null);
  const [meta, setMeta] = useState(null);
  const layout = useStore(s => s.mareyLayout), hl = useStore(s => s.hlPlace), sel = useStore(s => s.filter.place);
  useEffect(() => {
    let m = null, prev = getState();
    const show = () => {
      if (!showing(getState(), 'marey')) { m?.show(false); return; }
      if (!m) m = createMarey(plot.current, setMeta);
      m.show(true);
      m.setClock(getClock());
    };
    if (showing(prev, 'marey')) show();
    const unsub = subscribe(() => {
      const st = getState(), p = prev; prev = st;
      if (st.view !== p.view || st.second !== p.second) { requestAnimationFrame(show); return; }
      if (m && st !== p) m.update(st, p);
    });
    const unclock = onClock(t => m?.setClock(t));
    return () => { unsub(); unclock(); m?.destroy(); };
  }, []);
  const st = getState();
  const homeInferred = st.ctx?.homes.some(h => !h.labelled);
  const hover = i => { if (getState().hlPlace !== i) setState({ hlPlace: i }); };
  return (
    <div id="marey">
      <div className="marey-cap" id="mareyCap">
        <p>{meta && <><b>Place timetable.</b> {meta.layout === 'days'
          ? <>{meta.days.toLocaleString('en-GB')} days stacked on one 24-hour axis, so routines show as dense bundles.</>
          : <>The selected period in real time.{meta.rangeDays > 21 ? ' Select a shorter period on the timeline to read single days.' : ''}</>}
          {' '}Rows are places, ordered by distance from home. Bars are stays, lines are trips{meta.hasLoops ? ', arches leave and return to the same row' : ''}{meta.hasOpen ? ', dashed lines end away from a known place' : ''}.
          {meta.layout === 'days' ? ' Drag across the hours to select them.' : ''}</>}</p>
        <Seg id="mareySeg" label="Timetable layout" value={layout} onChange={v => setState({ mareyLayout: v })} options={[['days', 'Stack days'], ['calendar', 'Along the calendar']]} />
      </div>
      <div className="marey-plot" ref={plot}>
        <div className="marey-rows" style={{ width: LABEL_W - 10 }}>
          {meta?.rows.map(r => {
            const clickable = r.place >= 0;
            const p = clickable ? st.ctx?.places[r.place] : null;
            const note = r.key === 'home' ? (homeInferred ? 'inferred' : '') : r.key === 'work' ? (p?.inferredRole ? 'inferred' : '') : r.key === 'other' ? (r.count ? `${r.count.toLocaleString('en-GB')} places` : '') : isFinite(r.dist) ? `${fmtKm(r.dist)} km` : '';
            return (
              <div key={r.key} className={'mrow' + (clickable ? '' : ' plain') + (clickable && sel === r.place ? ' sel' : '') + (clickable && hl === r.place ? ' hl' : '')}
                style={{ top: r.y - Math.min(r.h, 30) / 2, height: Math.min(r.h, 30) }} data-k={r.key}
                {...(clickable ? {
                  tabIndex: 0, role: 'button', 'aria-pressed': sel === r.place,
                  title: `${r.label}: ${fmtDur(r.dur)} in the selection. Select to see only trips to and from this place.`,
                  onMouseEnter: () => hover(r.place), onMouseLeave: () => hover(null),
                  onClick: () => selectPlace(r.place, true),
                  onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPlace(r.place, true); } }
                } : { title: 'Places without a row of their own, and trip ends away from a known place' })}>
                <span className="ml">{r.label}</span>{note && <span className="mn">{note}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const colorBy = useStore(s => s.colorBy), mode = useStore(s => s.mode), res = useStore(s => s.res), layers = useStore(s => s.layers);
  useStore(s => s.sources); useStore(s => s.hidden); useStore(s => s.dark);
  const st = getState();
  const items = [];
  if (colorBy === 'device') {
    if (mode === 'combined') items.push(<span key="all"><i style={{ background: cssv('--ink') }}></i>All devices, combined</span>);
    else for (const s of visibleSources(st)) items.push(<span key={s.id}><i style={{ background: inkOf(s) }}></i>{s.name}</span>);
  } else if (colorBy === 'mode') {
    const used = new Set(res?.modes.filter(m => m.n).map(m => m.k));
    for (const m of MODES) if (used.has(m.k)) items.push(<span key={m.k}><i style={{ background: modeColor(m.k) }}></i>{m.label}</span>);
  } else {
    const grad = hourStops().map(([h, c]) => `${c} ${h / 24 * 100}%`).join(',');
    items.push(<span key="st">Start time</span>, <span key="ramp">0h <i className="ramp" style={{ background: `linear-gradient(90deg,${grad})` }}></i> 24h</span>);
  }
  if (layers.trails && colorBy !== 'mode') items.push(<span key="fl"><i style={{ background: `repeating-linear-gradient(90deg,${cssv('--ink-2')} 0 4px,transparent 4px 7px)` }}></i>Flight</span>);
  if (layers.trails && res?.T.some(t => t.mode !== 'flight' && t.path.length <= 2)) items.push(<span key="jump"><i style={{ height: 2, background: `repeating-linear-gradient(90deg,${cssv('--ink-2')} 0 1.5px,transparent 1.5px 5px)` }}></i>No route recorded</span>);
  if (layers.places) items.push(<span key="pl"><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill={cssv('--panel-2')} stroke={cssv('--ink')} strokeWidth="1" /></svg>Place (size = time)</span>);
  return <div className="legend" id="legend">{items}</div>;
}
