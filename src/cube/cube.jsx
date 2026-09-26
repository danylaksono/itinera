/* Space-time cube (three.js). Floor = current map view (web mercator, longest side 100 units),
   height = selected time range (72 units). Renders on demand only.
   createCube(el, lblBox, setCaption) returns { build, schedule, setClock, show, destroy }. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { color as d3color, scaleUtc } from 'd3';
import { MIN, DAY, RAD, clamp, fmtDay, fmtDur, fmtLocal } from '../lib/util.js';
import { cssv, modeColor, hourColor, trackColor } from '../lib/colors.js';
import { WORLD } from '../lib/geo.js';
import { activeSources, visibleSources, srcById, playRange, offNear, headAt } from '../lib/analytics.js';
import { getState, showing } from '../store.js';
import { getMap, mapReady, viewBounds, boundsOf } from '../map/mapView.jsx';
import { showTip, hideTip } from '../tip.jsx';

export function createCube(el, lblBox, setCaption) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false }); }
  catch (e) { setCaption({ error: 'This browser cannot show 3D graphics (WebGL is off).' }); return null; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  el.insertBefore(renderer.domElement, lblBox); // labels stay above the canvas
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);
  camera.position.set(118, 112, 150);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.target.set(0, 32, 0);
  controls.maxPolarAngle = Math.PI * 0.98;
  controls.minDistance = 30; controls.maxDistance = 900;
  controls.addEventListener('change', render);
  const ray = new THREE.Raycaster();
  let root = null, built = false, timer = null, rafPending = false, clockT = null, dead = false;
  let geo = null; // { toX, toZ, toY, X, Z, H, a, b, stays, inst }
  let clockGrp = null, heads = [];
  const labels = [];
  const visible = () => showing(getState(), 'cube');

  const ro = new ResizeObserver(() => { if (visible()) { resize(); render(); } });
  ro.observe(el);
  const onDbl = () => { camera.position.set(118, 112, 150); if (geo) fitCamera(); else controls.update(); render(); };
  renderer.domElement.addEventListener('pointermove', onHover);
  renderer.domElement.addEventListener('pointerleave', hideTip);
  renderer.domElement.addEventListener('dblclick', onDbl);

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (built) fitCamera();
  }
  function fitCamera() {
    if (!geo) return;
    const target = new THREE.Vector3(0, geo.H / 2, 0);
    const offset = camera.position.clone().sub(controls.target);
    if (offset.lengthSq() < 1) offset.set(118, 80, 150);
    const radius = Math.sqrt((geo.X / 2) ** 2 + (geo.H / 2) ** 2 + (geo.Z / 2) ** 2);
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * Math.max(camera.aspect, 0.01));
    const distance = radius / Math.sin(Math.min(vHalf, hHalf)) * 1.08;
    controls.target.copy(target);
    camera.position.copy(target).add(offset.normalize().multiplyScalar(distance));
    // The sphere is loose for a flat box: project the 8 corners and move closer until they fill
    // about 85% of the view (room for the time labels on the left).
    const dir = offset.clone().normalize(), p = new THREE.Vector3();
    let d = distance;
    for (let it = 0; it < 4; it++) {
      camera.position.copy(target).addScaledVector(dir, d);
      camera.lookAt(target); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      let m = 0;
      for (const x of [-1, 1]) for (const y of [0, 1]) for (const z of [-1, 1]) {
        p.set(x * geo.X / 2, y * geo.H, z * geo.Z / 2).project(camera);
        m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
      }
      if (!(m > 0)) break;
      d = clamp(d * m / 0.85, controls.minDistance, controls.maxDistance);
    }
    camera.position.copy(target).addScaledVector(dir, d);
    controls.update();
  }
  function disposeTree(o) {
    o.traverse(c => { c.geometry?.dispose?.(); if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose()); });
  }
  const col = c => new THREE.Color(d3color(c).formatHex());

  function extent(st) {
    const b = st.view === 'split' && mapReady() ? getMap().getBounds() : viewBounds();
    if (b && b.getEast() - b.getWest() < 300) return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const pl = st.ctx.places; if (!pl.length) return [-10, 35, 10, 45];
    const bb = boundsOf(pl.map(p => [p.lon, p.lat]));
    return [bb[0][0], bb[0][1], bb[1][0], bb[1][1]];
  }
  const mx = lon => (lon + 180) / 360;
  const my = lat => { const s = Math.sin(clamp(lat, -85, 85) * RAD); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };

  function build() {
    const st = getState();
    if (dead || !st.ctx || !st.res) return;
    resize();
    if (root) { scene.remove(root); disposeTree(root); }
    labels.length = 0; lblBox.replaceChildren();
    root = new THREE.Group(); scene.add(root);
    const [w, s, e, n] = extent(st);
    const x0 = mx(w), x1 = mx(e), y0 = my(n), y1 = my(s);
    const k = 100 / Math.max(x1 - x0, y1 - y0);
    const X = (x1 - x0) * k, Z = (y1 - y0) * k, H = 72;
    const [a, b] = playRange(st);
    const toX = lon => (mx(lon) - x0) * k - X / 2, toZ = lat => (my(lat) - y0) * k - Z / 2;
    const toY = t => (t - a) / Math.max(1, b - a) * H;
    const inside = (lat, lon) => lon >= w && lon <= e && lat >= s && lat <= n;
    geo = { toX, toZ, toY, X, Z, H, a, b };
    const ink = cssv('--ink'), rule = cssv('--rule');
    renderer.localClippingEnabled = true;

    // ---- frame: floor, edges, land outline
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(X, Z), new THREE.MeshBasicMaterial({ color: col(cssv('--land')), side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.05; root.add(floor);
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(X, H, Z)), new THREE.LineBasicMaterial({ color: col(rule) }));
    box.position.y = H / 2; root.add(box);
    if (WORLD) {
      const pos = [];
      const addLine = co => { for (let i = 1; i < co.length; i++) { const p = co[i - 1], q = co[i]; if (!inside(p[1], p[0]) && !inside(q[1], q[0])) continue; pos.push(toX(p[0]), 0.02, toZ(p[1]), toX(q[0]), 0.02, toZ(q[1])); } };
      const g = WORLD.land.features ? WORLD.land.features : [WORLD.land];
      for (const f of g) { const gm = f.geometry; const polys = gm.type === 'Polygon' ? [gm.coordinates] : gm.coordinates; for (const p of polys) for (const r of p) addLine(r); }
      for (const l of WORLD.borders.coordinates) addLine(l);
      if (pos.length) {
        const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const ls = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: col(cssv('--border-map')) }));
        ls.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), X / 2), new THREE.Plane(new THREE.Vector3(-1, 0, 0), X / 2), new THREE.Plane(new THREE.Vector3(0, 0, 1), Z / 2), new THREE.Plane(new THREE.Vector3(0, 0, -1), Z / 2)];
        root.add(ls);
      }
    }
    // ---- trips (filtered) as lines with vertex colour + ground shadow
    const fallback = activeSources(st)[0];
    const colorOf = t => st.colorBy === 'mode' ? modeColor(t.mode) : st.colorBy === 'hour' ? hourColor(t.hod) : trackColor(st, srcById(st, t.src) || fallback);
    // many months of trips hide the stays: draw them fainter as the time span grows
    const tripAlpha = clamp(0.9 * Math.sqrt(45 * DAY / Math.max(DAY, b - a)), 0.28, 0.9);
    const P = [], C = [], SH = [];
    let segs = 0, nTrips = 0;
    const trips = st.res.T.filter(t => t.t1 >= a && t.t0 <= b);
    const MAXSEG = 350000;
    for (const t of trips) {
      const path = t.path; if (path.length < 2) continue;
      let any = false;
      const c = col(colorOf(t));
      for (let i = 1; i < path.length; i++) {
        const p = path[i - 1], q = path[i];
        if (!inside(p[1], p[2]) && !inside(q[1], q[2])) continue;
        if (q[0] < a || p[0] > b) continue;
        any = true;
        P.push(toX(p[2]), toY(p[0]), toZ(p[1]), toX(q[2]), toY(q[0]), toZ(q[1]));
        C.push(c.r, c.g, c.b, c.r, c.g, c.b);
        SH.push(toX(p[2]), 0.04, toZ(p[1]), toX(q[2]), 0.04, toZ(q[1]));
        if (++segs > MAXSEG) break;
      }
      if (any) nTrips++;
      if (segs > MAXSEG) break;
    }
    const clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), X / 2 + 0.01), new THREE.Plane(new THREE.Vector3(-1, 0, 0), X / 2 + 0.01), new THREE.Plane(new THREE.Vector3(0, 0, 1), Z / 2 + 0.01), new THREE.Plane(new THREE.Vector3(0, 0, -1), Z / 2 + 0.01), new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.01), new THREE.Plane(new THREE.Vector3(0, -1, 0), H + 0.01)];
    if (P.length) {
      const g1 = new THREE.BufferGeometry();
      g1.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g1.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      root.add(new THREE.LineSegments(g1, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: tripAlpha, depthWrite: false, clippingPlanes: clip })));
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(SH, 3));
      root.add(new THREE.LineSegments(g2, new THREE.LineBasicMaterial({ color: col(ink), transparent: true, opacity: 0.16, clippingPlanes: clip })));
    }
    // ---- stays as vertical cylinders (instanced)
    let stays = st.res.V.filter(v => v.t1 >= a && v.t0 <= b && inside(v.lat, v.lon));
    if (stays.length > 8000) stays = stays.slice().sort((p, q) => q.dur - p.dur).slice(0, 8000);
    geo.stays = stays;
    if (stays.length) {
      const r = clamp(Math.min(X, Z) / 110, 0.35, 1.3);
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 });
      const inst = new THREE.InstancedMesh(cyl, mat, stays.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
      const homes = st.ctx.homeSet;
      stays.forEach((v, i) => {
        const ya = toY(Math.max(v.t0, a)), yb = toY(Math.min(v.t1, b));
        const hh = Math.max(0.12, yb - ya);
        const rr = homes.has(v.place) ? r * 1.25 : r;
        ps.set(toX(v.lon), ya + hh / 2, toZ(v.lat)); sc.set(rr, hh, rr);
        m4.compose(ps, q, sc); inst.setMatrixAt(i, m4);
        const c = st.colorBy === 'device' ? col(trackColor(st, srcById(st, v.src) || fallback)) : col(homes.has(v.place) ? ink : cssv('--ink-2'));
        inst.setColorAt(i, c);
      });
      inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      root.add(inst); geo.inst = inst;
    } else geo.inst = null;
    // ---- place labels on the floor (top places inside the view)
    const inView = st.res.places.map(o => st.ctx.places[o.i]).filter(p => inside(p.lat, p.lon)).slice(0, 10); // overlapping ones are hidden in placeLabels
    for (const p of inView) addLabel(new THREE.Vector3(toX(p.lon), 0, toZ(p.lat)), p.label, 'place');
    // ---- time ticks on the back-left edge
    const off = offNear(st, a);
    const sc = scaleUtc().domain([a + off * MIN, b + off * MIN]).range([0, H]);
    const ticks = sc.ticks(6), fmt = sc.tickFormat(6);
    const tp = [];
    for (const tk of ticks) {
      const y = sc(tk);
      tp.push(-X / 2, y, -Z / 2, X / 2, y, -Z / 2, -X / 2, y, -Z / 2, -X / 2, y, Z / 2);
      addLabel(new THREE.Vector3(0, y, 0), fmt(tk), 'time');
    }
    if (tp.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col(rule), transparent: true, opacity: 0.6 })));
    }
    // ---- clock plane and heads
    clockGrp = new THREE.Group(); clockGrp.visible = false;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(X, Z), new THREE.MeshBasicMaterial({ color: col(ink), transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    pl.rotation.x = -Math.PI / 2; clockGrp.add(pl);
    const pe = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(X, Z)), new THREE.LineBasicMaterial({ color: col(ink), transparent: true, opacity: 0.55 }));
    pe.rotation.x = -Math.PI / 2; clockGrp.add(pe);
    root.add(clockGrp);
    heads = visibleSources(st).map(src => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color: col(trackColor(st, src)) }));
      m.visible = false; m.userData.src = src; root.add(m);
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: col(trackColor(st, src)), transparent: true, opacity: 0.5 }));
      stem.visible = false; root.add(stem); m.userData.stem = stem;
      return m;
    });
    const d0 = Math.floor((a + off * MIN) / DAY), d1 = Math.floor((b + offNear(st, b) * MIN) / DAY);
    setCaption({ from: fmtDay(d0), to: fmtDay(d1), split: st.view === 'split', nTrips, faint: tripAlpha < 0.85 });
    fitCamera();
    built = true;
    placeClock();
    render();
  }
  function addLabel(v, text, kind) {
    const d = document.createElement('div');
    d.className = 'cube-lbl' + (kind === 'place' ? ' is-place' : '');
    d.textContent = text;
    lblBox.appendChild(d);
    labels.push({ v, d, kind, w: 0 });
  }
  /* Time labels go on the vertical edge that is leftmost on screen (outside the data, whatever the
     turn). Labels are placed in order (time first, then places by rank); a label that would overlap
     one already placed is hidden. */
  function placeLabels() {
    const w = el.clientWidth, h = el.clientHeight;
    const p = new THREE.Vector3(), taken = [];
    let edge = null;
    if (geo) {
      let best = Infinity;
      for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        p.set(cx * geo.X / 2, geo.H / 2, cz * geo.Z / 2).project(camera);
        if (p.x < best) { best = p.x; edge = [cx * (geo.X / 2 + 1.5), cz * (geo.Z / 2 + 1.5)]; }
      }
    }
    for (const l of [...labels.filter(l => l.kind === 'time'), ...labels.filter(l => l.kind !== 'time')]) {
      if (l.kind === 'time' && edge) p.set(edge[0], l.v.y, edge[1]); else p.copy(l.v);
      p.project(camera);
      let vis = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      const x = (p.x + 1) / 2 * w, y = (1 - p.y) / 2 * h;
      if (vis) {
        l.w ||= l.d.offsetWidth || 60;
        const r = l.kind === 'time' ? [x - l.w, y - 8, x, y + 8] : [x + 6, y - 8, x + 6 + l.w, y + 8];
        if (taken.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) vis = false;
        else taken.push(r);
      }
      l.d.style.display = vis ? '' : 'none';
      if (vis) { l.d.style.left = x.toFixed(1) + 'px'; l.d.style.top = y.toFixed(1) + 'px'; }
    }
  }
  function placeClock() {
    if (!built || !geo) return;
    const c = clockT;
    if (c == null || c < geo.a || c > geo.b) { clockGrp.visible = false; heads.forEach(m => { m.visible = false; m.userData.stem.visible = false; }); return; }
    const y = geo.toY(c);
    clockGrp.visible = true; clockGrp.position.y = y;
    for (const m of heads) {
      const hd = headAt(m.userData.src, c);
      if (!hd) { m.visible = false; m.userData.stem.visible = false; continue; }
      const x = geo.toX(hd.lon), z = geo.toZ(hd.lat);
      const inBox = Math.abs(x) <= geo.X / 2 && Math.abs(z) <= geo.Z / 2;
      m.visible = inBox; m.position.set(x, y, z);
      m.material.opacity = hd.stale ? 0.4 : 1; m.material.transparent = hd.stale;
      const stm = m.userData.stem; stm.visible = inBox;
      if (inBox) { const pa = stm.geometry.attributes.position; pa.setXYZ(0, x, 0, z); pa.setXYZ(1, x, y, z); pa.needsUpdate = true; stm.geometry.computeBoundingSphere(); }
    }
  }
  function render() {
    if (dead || !visible() || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (dead) return;
      renderer.render(scene, camera);
      placeLabels();
    });
  }
  function onHover(ev) {
    if (!geo?.inst) return;
    const r = renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(v, camera);
    const hit = ray.intersectObject(geo.inst, false)[0];
    if (!hit) { hideTip(); return; }
    const s = geo.stays[hit.instanceId]; if (!s) return;
    const p = getState().ctx.places[s.place];
    const a = fmtLocal(s.t0, s.off), b = fmtLocal(s.t1, s.off);
    showTip(ev, <><b>{p?.label || 'Stay'}</b><br />{a.date}, {a.time}<br />to {b.date === a.date ? '' : b.date + ', '}{b.time} ({fmtDur(s.dur)})</>);
  }
  return {
    build,
    schedule() { if (!visible()) return; clearTimeout(timer); timer = setTimeout(build, 220); },
    setClock(t) { clockT = t; if (!built || !visible()) return; placeClock(); render(); },
    show(on) { if (!on) { hideTip(); return; } resize(); build(); },
    destroy() {
      dead = true; clearTimeout(timer); ro.disconnect(); controls.dispose();
      if (root) disposeTree(root);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); lblBox.replaceChildren();
    }
  };
}
