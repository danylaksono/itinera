/* ================================================================
   Part E: space-time cube (three.js)
   Floor = current map view, height = selected time range.
   ================================================================ */
const Cube = (() => {
  let ok = null, renderer, scene, camera, controls, root, el, cap, lblBox;
  let built = false, timer = null, rafPending = false, clockT = null;
  let geo = null; // { toX, toZ, toY, X, Z, H, a, b, stays:[...], inst }
  let clockGrp = null, heads = [];
  const labels = [];
  const ray = typeof THREE !== 'undefined' ? new THREE.Raycaster() : null;

  function init() {
    if (ok !== null) return ok;
    el = $('#cube'); cap = $('#cubeCap');
    if (typeof THREE === 'undefined' || !THREE.OrbitControls) { ok = false; cap.innerHTML = '<b>Space-time cube</b><br>The 3D library did not load, so this view is not available.'; return ok; }
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    } catch (e) { ok = false; cap.innerHTML = '<b>Space-time cube</b><br>This browser cannot show 3D graphics (WebGL is off).'; return ok; }
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    lblBox = document.createElement('div');
    lblBox.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    el.appendChild(lblBox);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);
    camera.position.set(118, 112, 150);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.target.set(0, 32, 0);
    controls.maxPolarAngle = Math.PI * 0.98;
    controls.minDistance = 30; controls.maxDistance = 900;
    controls.addEventListener('change', render);
    new ResizeObserver(() => { if (S.view !== 'map') { resize(); render(); } }).observe(el);
    renderer.domElement.addEventListener('pointermove', onHover);
    renderer.domElement.addEventListener('pointerleave', hideTip);
    renderer.domElement.addEventListener('dblclick', () => { camera.position.set(118, 112, 150); if (geo) fitCamera(); else controls.update(); render(); });
    ok = true;
    return ok;
  }
  function resize() {
    if (!ok) return;
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
    controls.update();
  }
  function disposeTree(o) {
    o.traverse(c => { c.geometry?.dispose?.(); if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose()); });
  }
  const col = c => new THREE.Color(d3.color(c).formatHex());

  function extent() {
    const b = S.view === 'split' && mapReady ? map.getBounds() : viewBounds();
    if (b && b.getEast() - b.getWest() < 300) return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const pl = S.ctx.places; if (!pl.length) return [-10, 35, 10, 45];
    const bb = boundsOf(pl.map(p => [p.lon, p.lat]));
    return [bb[0][0], bb[0][1], bb[1][0], bb[1][1]];
  }
  const mx = lon => (lon + 180) / 360;
  const my = lat => { const s = Math.sin(clamp(lat, -85, 85) * RAD); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };

  function build() {
    if (!init() || !S.ctx || !S.res) return;
    resize();
    if (root) { scene.remove(root); disposeTree(root); }
    labels.length = 0; lblBox.innerHTML = '';
    root = new THREE.Group(); scene.add(root);
    const [w, s, e, n] = extent();
    const x0 = mx(w), x1 = mx(e), y0 = my(n), y1 = my(s);
    const k = 100 / Math.max(x1 - x0, y1 - y0);
    const X = (x1 - x0) * k, Z = (y1 - y0) * k, H = 72;
    const [a, b] = playRange();
    const toX = lon => (mx(lon) - x0) * k - X / 2, toZ = lat => (my(lat) - y0) * k - Z / 2;
    const toY = t => (t - a) / Math.max(1, b - a) * H;
    const inside = (lat, lon) => lon >= w && lon <= e && lat >= s && lat <= n;
    geo = { toX, toZ, toY, X, Z, H, a, b };
    const ink = cssv('--ink'), ink3 = cssv('--ink-3'), rule = cssv('--rule');

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
        const clipPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), X / 2), new THREE.Plane(new THREE.Vector3(-1, 0, 0), X / 2), new THREE.Plane(new THREE.Vector3(0, 0, 1), Z / 2), new THREE.Plane(new THREE.Vector3(0, 0, -1), Z / 2)];
        ls.material.clippingPlanes = clipPlanes; renderer.localClippingEnabled = true;
        root.add(ls);
      }
    }
    // ---- trips (filtered) as lines with vertex colour + ground shadow
    const colorOf = t => S.colorBy === 'mode' ? modeColor(t.mode) : S.colorBy === 'hour' ? hourColor(t.hod) : trackColor(srcById(t.src) || activeSources()[0]);
    const P = [], C = [], SH = [];
    let segs = 0, nTrips = 0;
    const trips = S.res.T.filter(t => t.t1 >= a && t.t0 <= b);
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
    renderer.localClippingEnabled = true;
    if (P.length) {
      const g1 = new THREE.BufferGeometry();
      g1.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g1.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      root.add(new THREE.LineSegments(g1, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, clippingPlanes: clip })));
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(SH, 3));
      root.add(new THREE.LineSegments(g2, new THREE.LineBasicMaterial({ color: col(ink), transparent: true, opacity: 0.16, clippingPlanes: clip })));
    }
    // ---- stays as vertical cylinders (instanced)
    let stays = S.res.V.filter(v => v.t1 >= a && v.t0 <= b && inside(v.lat, v.lon));
    if (stays.length > 8000) stays = stays.slice().sort((p, q) => q.dur - p.dur).slice(0, 8000);
    geo.stays = stays;
    if (stays.length) {
      const r = clamp(Math.min(X, Z) / 160, 0.25, 0.9);
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.82 });
      const inst = new THREE.InstancedMesh(cyl, mat, stays.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
      const home = S.ctx.home;
      stays.forEach((v, i) => {
        const ya = toY(Math.max(v.t0, a)), yb = toY(Math.min(v.t1, b));
        const hh = Math.max(0.12, yb - ya);
        const rr = v.place === home ? r * 1.25 : r;
        ps.set(toX(v.lon), ya + hh / 2, toZ(v.lat)); sc.set(rr, hh, rr);
        m4.compose(ps, q, sc); inst.setMatrixAt(i, m4);
        const c = S.colorBy === 'device' ? col(trackColor(srcById(v.src) || activeSources()[0])) : col(v.place === home ? ink : cssv('--ink-2'));
        inst.setColorAt(i, c);
      });
      inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      root.add(inst); geo.inst = inst;
    } else geo.inst = null;
    // ---- place labels on the floor (top places inside the view)
    const inView = S.res.places.map(o => S.ctx.places[o.i]).filter(p => inside(p.lat, p.lon)).slice(0, 6);
    for (const p of inView) addLabel(new THREE.Vector3(toX(p.lon), 0, toZ(p.lat)), p.label, 'place');
    // ---- time ticks on the back-left edge
    const off = offNear(a);
    const sc = d3.scaleUtc().domain([a + off * MIN, b + off * MIN]).range([0, H]);
    const ticks = sc.ticks(6), fmt = sc.tickFormat(6);
    const tp = [];
    for (const tk of ticks) {
      const y = sc(tk);
      tp.push(-X / 2, y, -Z / 2, -X / 2 - 2, y, -Z / 2, -X / 2, y, -Z / 2, X / 2, y, -Z / 2);
      addLabel(new THREE.Vector3(-X / 2 - 2.5, y, -Z / 2), fmt(tk), 'time');
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
    heads = visibleSources().map(src => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color: col(trackColor(src)) }));
      m.visible = false; m.userData.src = src; root.add(m);
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: col(trackColor(src)), transparent: true, opacity: 0.5 }));
      stem.visible = false; root.add(stem); m.userData.stem = stem;
      return m;
    });
    // ---- caption
    const d0 = Math.floor((a + off * MIN) / DAY), d1 = Math.floor((b + offNear(b) * MIN) / DAY);
    cap.innerHTML = `<b>Space-time cube.</b> Time goes up, from ${fmtDay(d0)} at the floor to ${fmtDay(d1)} at the top. The floor is the ${S.view === 'split' ? 'map view on the left' : 'last map view'}. Columns are stays, lines are trips (${nTrips.toLocaleString('en-GB')} shown). Drag to turn, scroll to zoom, double-click to reset.`;
    fitCamera();
    built = true;
    placeClock();
    render();
  }
  function addLabel(v, text, kind) {
    const d = document.createElement('div');
    d.className = 'cube-lbl';
    d.textContent = text;
    if (kind === 'place') { d.style.transform = 'translate(6px,-50%)'; d.style.color = cssv('--ink'); d.style.fontWeight = '600'; d.style.textShadow = `0 0 3px ${cssv('--panel-2')}, 0 0 3px ${cssv('--panel-2')}`; }
    lblBox.appendChild(d);
    labels.push({ v, d });
  }
  function placeLabels() {
    const w = el.clientWidth, h = el.clientHeight;
    const p = new THREE.Vector3();
    for (const l of labels) {
      p.copy(l.v).project(camera);
      const vis = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      l.d.style.display = vis ? '' : 'none';
      if (vis) { l.d.style.left = ((p.x + 1) / 2 * w).toFixed(1) + 'px'; l.d.style.top = ((1 - p.y) / 2 * h).toFixed(1) + 'px'; }
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
      const st = m.userData.stem; st.visible = inBox;
      if (inBox) { const pa = st.geometry.attributes.position; pa.setXYZ(0, x, 0, z); pa.setXYZ(1, x, y, z); pa.needsUpdate = true; st.geometry.computeBoundingSphere(); }
    }
  }
  function render() {
    if (!ok || S.view === 'map') return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      renderer.render(scene, camera);
      placeLabels();
    });
  }
  function onHover(ev) {
    if (!geo?.inst || !ray) return;
    const r = renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(v, camera);
    const hit = ray.intersectObject(geo.inst, false)[0];
    if (!hit) { hideTip(); return; }
    const s = geo.stays[hit.instanceId]; if (!s) return;
    const p = S.ctx.places[s.place];
    const a = fmtLocal(s.t0, s.off), b = fmtLocal(s.t1, s.off);
    showTip(ev, `<b>${esc(p?.label || 'Stay')}</b><br>${a.date}, ${a.time}<br>to ${b.date === a.date ? '' : b.date + ', '}${b.time} (${fmtDur(s.dur)})`);
  }
  return {
    init, build,
    schedule() { if (S.view === 'map') return; clearTimeout(timer); timer = setTimeout(build, 220); },
    setClock(t) { clockT = t; if (!built || S.view === 'map') return; placeClock(); render(); },
    show(on) { if (!on) { hideTip(); return; } if (!init()) return; resize(); build(); },
    rebuild() { if (built && S.view !== 'map') build(); else built = false; }
  };
})();
