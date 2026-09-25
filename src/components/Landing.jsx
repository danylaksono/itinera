import { useEffect, useMemo, useRef } from 'react';
import anime from 'animejs/lib/anime.es.js';
import { useStore, setState, loadActions } from '../store.js';
import { INKS_D, INKS_L, cssv } from '../lib/colors.js';
import { reducedMotion } from '../hooks.js';

export const Wordmark = ({ size = 22, ...p }) => (
  <div className="wordmark" {...p}><svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true"><path d="M3 17c3-1 4-9 8-9s3 7 8 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="3" cy="17" r="2.2" fill="currentColor" /><circle cx="19" cy="11" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>Itinera</div>
);

const exploreSample = async () => {
  setState({ busy: { step: 'Making a sample year', sub: 'Two phones and a running watch' }, landErr: '' });
  const a = await loadActions().catch(() => null);
  if (a) a.loadSample();
};

export default function Landing({ onPick, over }) {
  const landErr = useStore(s => s.landErr);
  return (
    <div id="landing">
      <div className="land-wrap">
        <div className="land-head">
          <Wordmark />
          <h1>Read your location history like a field survey.</h1>
          <p>Load your Google Maps Timeline export. Itinera finds your stays and trips, then links a map, a space-time cube, calendars and charts, so you can see where your time goes.</p>
          <p>You can load files from more than one phone. Show each device in its own ink, or combine them into one history.</p>
          <div className={'drop' + (over ? ' over' : '')} id="drop">
            <strong>Drop your timeline files or folder here</strong>
            <span className="hint">Timeline.json, location-history.json, Records.json, Semantic Location History, a Takeout .zip, or GPX tracks.</span>
            <div className="row">
              <button className="btn primary" id="pickBtn" onClick={onPick}>Choose files</button>
              <button className="btn" id="sampleBtn" onClick={exploreSample}>Explore sample data</button>
            </div>
            <small>The sample is a made-up year in Lisbon, from two phones and a running watch.</small>
            <div className="land-err" id="landErr" role="alert">{landErr}</div>
          </div>
        </div>
        <div className="hero-map" aria-hidden="true">
          <Hero />
          <div className="hero-cap">Every line is drawn in your browser. Nothing leaves this page.</div>
        </div>
        <div className="howto">
          <div><h3>Android phone</h3><p>Open <code>Settings › Location › Location services › Timeline</code> and select <code>Export Timeline data</code>. You get <code>Timeline.json</code>.</p></div>
          <div><h3>iPhone</h3><p>In Google Maps, open <code>Settings › Personal content</code> and select <code>Export Timeline data</code>. You get <code>location-history.json</code>.</p></div>
          <div><h3>Older Takeout export</h3><p>A Google Takeout archive from before 2024 has <code>Records.json</code> and monthly <code>Semantic Location History</code> files. Drop the .zip or the folder.</p></div>
        </div>
        <div className="privacy">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          <span>Your files stay on this device. The page reads them in the browser, and it has no permission to send data to any server. When you close the tab, the data is gone.</span>
        </div>
      </div>
    </div>
  );
}

/* a few shared places, and three devices wandering between them (seeded, so it is always the same) */
const W = 400, H = 408;
const NODES = [[92, 290], [150, 212], [238, 236], [300, 128], [196, 96], [330, 300], [70, 150], [262, 350]];
const RADII = [9, 12, 8, 6, 5, 5, 4, 4];
function heroTraces() {
  let seed = 7;
  const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const path = seq => {
    let d = `M${NODES[seq[0]][0]},${NODES[seq[0]][1]}`;
    for (let i = 1; i < seq.length; i++) {
      const a = NODES[seq[i - 1]], b = NODES[seq[i]];
      const mx = (a[0] + b[0]) / 2 + (R() - 0.5) * 70, my = (a[1] + b[1]) / 2 + (R() - 0.5) * 70;
      d += ` Q${mx.toFixed(1)},${my.toFixed(1)} ${b[0]},${b[1]}`;
    }
    return d;
  };
  return [
    { ink: 0, d: path([0, 1, 2, 3, 4, 1, 0, 7, 2, 5]), w: 2.2 },
    { ink: 1, d: path([0, 1, 2, 5, 7, 2, 1, 6, 4, 3]), w: 1.8 },
    { ink: 2, d: path([1, 6, 0, 1, 2, 3]), w: 1.6, dash: true }
  ];
}
function Hero() {
  const dark = useStore(s => s.dark);
  const traces = useMemo(heroTraces, []);
  const svgRef = useRef(null);
  const inks = dark ? INKS_D : INKS_L;
  const grid = [];
  for (let x = 20; x < W; x += 40) grid.push(<line key={'x' + x} x1={x} y1="0" x2={x} y2={H} />);
  for (let y = 24; y < H; y += 40) grid.push(<line key={'y' + y} x1="0" y1={y} x2={W} y2={y} />);

  // draw the traces in, then run a comet along the first one (a theme change only recolours)
  useEffect(() => {
    const svg = svgRef.current;
    const trs = [...svg.querySelectorAll('.tr')];
    const dashIt = () => trs.forEach((p, i) => { if (traces[i].dash) p.setAttribute('stroke-dasharray', '5 4'); });
    if (reducedMotion()) { dashIt(); return; }
    const nodes = [...svg.querySelectorAll('.nd')];
    nodes.forEach(n => { n.style.transformBox = 'fill-box'; n.style.transformOrigin = 'center'; });
    const draw = anime({ targets: trs, strokeDashoffset: [anime.setDashoffset, 0], easing: 'easeInOutSine', duration: 3200, delay: anime.stagger(500), complete: dashIt });
    const pops = anime({ targets: nodes, scale: [0, 1], opacity: [0, 1], easing: 'easeOutBack', duration: 500, delay: anime.stagger(140, { start: 300 }) });
    const mp = anime.path(trs[0]);
    const comet = anime({ targets: svg.querySelector('#heroComet'), translateX: mp('x'), translateY: mp('y'), opacity: [{ value: 1, duration: 300 }], easing: 'linear', duration: 9000, delay: 3400, loop: true });
    return () => { draw.pause(); pops.pause(); comet.pause(); };
  }, [traces]);

  return (
    <svg id="heroSvg" ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
      <rect width={W} height={H} fill={cssv('--land')} />
      <g stroke={cssv('--border-map')} strokeWidth=".6" opacity=".45">{grid}</g>
      <path d={`M0,${H - 60} C90,${H - 90} 170,${H - 40} 250,${H - 70} S360,${H - 50} ${W},${H - 80} L${W},${H} L0,${H}Z`} fill={cssv('--water')} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {traces.map((t, i) => <path key={i} className="tr" d={t.d} stroke={inks[t.ink]} strokeWidth={t.w} opacity=".9" />)}
      </g>
      <g>{NODES.map(([x, y], i) => <circle key={i} className="nd" cx={x} cy={y} r={RADII[i]} fill={cssv('--panel-2')} stroke={cssv('--ink')} strokeWidth={i === 1 ? 2.2 : 1} />)}</g>
      <circle id="heroComet" r="5.5" fill={inks[0]} stroke={cssv('--paper')} strokeWidth="2" opacity="0" />
    </svg>
  );
}
