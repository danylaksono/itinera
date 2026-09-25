/* ================================================================
   Part G: app wiring
   ================================================================ */
let _rq = null;
function refresh(from = 'all') {
  if (_rq) { if (_rq !== from) _rq = 'all'; return; }
  _rq = from;
  requestAnimationFrame(() => { const f = _rq; _rq = null; doRefresh(f); });
}
function doRefresh(from) {
  if (!S.ctx) return;
  compute();
  renderKPIs();
  if (from === 'timeline') dimCalendar();
  else if (from === 'calendar') { syncBrush(); dimCalendar(); }
  else { renderTimeline(); renderCalendar(); }
  renderRhythm(); renderModes(); renderPlaces(); renderFilters();
  updateMap(); updateClock();
  if (S.play.clock != null) { drawPlayhead(); markCurrent(S.play.clock); }
  Cube.schedule();
}

/* ---------- busy overlay ---------- */
function busyStep(step, sub = '') { $('#busyStep').textContent = step; $('#busySub').textContent = sub; }
async function busy(step, fn) {
  const el = $('#busy'); const was = !el.hidden;
  el.hidden = false; busyStep(step);
  await sleep(40);
  try { return await fn(); } finally { if (!was) el.hidden = true; }
}
function showError(msg) {
  if (!$('#landing').hidden) { $('#landErr').textContent = msg; }
  else toast(msg, 9000);
}

/* ---------- building ---------- */
async function rebuildAll() {
  await busy('Updating the analysis', async () => {
    const wasPlaying = S.play.on;
    if (S.play.session) stopPlay();
    if (S.mode === 'combined') {
      const vis = S.sources.filter(s => !S.hidden.has(s.id));
      busyStep('Combining devices', `${vis.length} sources, removing duplicate records`);
      await sleep(20);
      S.merged = finalize(combinedRaw(vis), 1000, { merge: true });
      S.merged.name = 'All devices'; S.merged.colorIdx = 0;
    } else S.merged = null;
    busyStep('Finding places and routines');
    await sleep(20);
    buildContext();
    setMapData();
    renderSources(); renderTogether();
    doRefresh('all');
    Cube.rebuild();
    if (wasPlaying) togglePlay(true);
  });
}
async function ingest(raws) {
  const first = !S.sources.length;
  for (const r of raws) {
    busyStep(`Building ${r.name}`, `${(r.P.t.length + r.visits.length + r.trips.length).toLocaleString('en-GB')} records, stays and trips`);
    await sleep(15);
    const s = finalize(r, nextSrcId++);
    if (!s.T.length && !s.visits.length) continue;
    const used = new Set(S.sources.map(o => o.colorIdx));
    let k = 0; while (used.has(k) && k < INKS_L.length) k++;
    s.colorIdx = k % INKS_L.length;
    S.sources.push(s);
  }
  if (!S.sources.length) { showError('The files have no usable location records.'); return; }
  $('#landing').hidden = true; $('#app').hidden = false;
  if (heroAnim) heroAnim.forEach(a => a.pause());
  if (!map) initMap();
  await rebuildAll();
  if (!first) fitAll(true);
}
async function handleFiles(files) {
  if (!files || !files.length) return;
  $('#landErr').textContent = '';
  $('#busy').hidden = false; busyStep('Reading files');
  try {
    const { raws, errors, skipped } = await loadFiles(files, busyStep);
    if (!raws.length) {
      showError(errors.length ? errors.join(' ') : `No location data was found${skipped ? ` in ${files.length} file${files.length === 1 ? '' : 's'}` : ''}. Load Timeline.json, location-history.json, Records.json, Semantic Location History files, GPX tracks or a Takeout .zip.`);
      return;
    }
    await ingest(raws);
    if (errors.length) toast(`Some files were skipped. ${errors.slice(0, 3).join(' ')}`, 9000);
  } catch (e) {
    console.error(e);
    showError(`The files could not be read. ${e.message || ''}`);
  } finally { $('#busy').hidden = true; }
}

/* ---------- export ---------- */
async function exportSelection() {
  if (!S.res) return;
  const ctx = S.ctx, res = S.res;
  const feats = [];
  for (const o of res.places) {
    const p = ctx.places[o.i];
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [+p.lon.toFixed(6), +p.lat.toFixed(6)] }, properties: { kind: 'place', name: p.label, role: p.role, country: p.country, hours: +(o.dur / HOUR).toFixed(2), visits: o.n, first: new Date(o.first).toISOString(), last: new Date(o.last).toISOString() } });
  }
  for (const t of res.T) {
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.path.map(p => [+p[2].toFixed(6), +p[1].toFixed(6)]) }, properties: { kind: 'trip', device: srcById(t.src)?.name, mode: t.mode, mode_inferred: !!t.inferred, start: new Date(t.t0).toISOString(), end: new Date(t.t1).toISOString(), utc_offset_min: t.off, km: +(t.dist / 1000).toFixed(3), from: ctx.places[t.from]?.label ?? null, to: ctx.places[t.to]?.label ?? null } });
  }
  const data = JSON.stringify({ type: 'FeatureCollection', features: feats });
  const filename = 'itinera-selection.geojson';
  try {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast('The browser did not allow the download.'); }
}

/* ---------- theme ---------- */
function detectDark() {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}
function applyTheme() {
  const d = detectDark() ? '1' : '0';
  if (document.documentElement.dataset.dark === d) return false;
  document.documentElement.dataset.dark = d;
  return true;
}
function onThemeChange() {
  if (!applyTheme()) return;
  drawHero(false);
  if (!S.ctx) return;
  restyleMap(); renderSources(); doRefresh('all'); Cube.rebuild();
}

/* ---------- landing hero ---------- */
let heroAnim = null;
function drawHero(animate = true) {
  const svg = $('#heroSvg'); if (!svg) return;
  let seed = 7;
  const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const inks = isDark() ? INKS_D : INKS_L;
  const W = 400, H = 408;
  // a few shared places, and three devices wandering between them
  const nodes = [[92, 290], [150, 212], [238, 236], [300, 128], [196, 96], [330, 300], [70, 150], [262, 350]];
  const path = seq => {
    let d = `M${nodes[seq[0]][0]},${nodes[seq[0]][1]}`;
    for (let i = 1; i < seq.length; i++) {
      const a = nodes[seq[i - 1]], b = nodes[seq[i]];
      const mx = (a[0] + b[0]) / 2 + (R() - 0.5) * 70, my = (a[1] + b[1]) / 2 + (R() - 0.5) * 70;
      d += ` Q${mx.toFixed(1)},${my.toFixed(1)} ${b[0]},${b[1]}`;
    }
    return d;
  };
  const traces = [
    { c: inks[0], d: path([0, 1, 2, 3, 4, 1, 0, 7, 2, 5]), w: 2.2 },
    { c: inks[1], d: path([0, 1, 2, 5, 7, 2, 1, 6, 4, 3]), w: 1.8 },
    { c: inks[2], d: path([1, 6, 0, 1, 2, 3]), w: 1.6, dash: true }
  ];
  let g = '';
  for (let x = 20; x < W; x += 40) g += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
  for (let y = 24; y < H; y += 40) g += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
  svg.innerHTML = `<rect width="${W}" height="${H}" fill="${cssv('--land')}"/>
    <g stroke="${cssv('--border-map')}" stroke-width=".6" opacity=".45">${g}</g>
    <path d="M0,${H - 60} C90,${H - 90} 170,${H - 40} 250,${H - 70} S360,${H - 50} ${W},${H - 80} L${W},${H} L0,${H}Z" fill="${cssv('--water')}"/>
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">${traces.map((t, i) => `<path class="tr" data-i="${i}" d="${t.d}" stroke="${t.c}" stroke-width="${t.w}" opacity=".9"/>`).join('')}</g>
    <g>${nodes.map(([x, y], i) => `<circle class="nd" cx="${x}" cy="${y}" r="${[9, 12, 8, 6, 5, 5, 4, 4][i]}" fill="${cssv('--panel-2')}" stroke="${cssv('--ink')}" stroke-width="${i === 1 ? 2.2 : 1}"/>`).join('')}</g>
    <circle id="heroComet" r="5.5" fill="${inks[0]}" stroke="${cssv('--paper')}" stroke-width="2" opacity="0"/>`;
  if (heroAnim) heroAnim.forEach(a => a.pause());
  heroAnim = null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof anime === 'undefined' || reduce || !animate) {
    $$('.tr', svg).forEach((p, i) => { if (traces[i].dash) p.setAttribute('stroke-dasharray', '5 4'); });
    return;
  }
  const trs = $$('.tr', svg);
  const draw = anime({ targets: trs, strokeDashoffset: [anime.setDashoffset, 0], easing: 'easeInOutSine', duration: 3200, delay: anime.stagger(500),
    complete: () => { trs.forEach((p, i) => { if (traces[i].dash) p.setAttribute('stroke-dasharray', '5 4'); }); } });
  const pops = anime({ targets: $$('.nd', svg), scale: [0, 1], opacity: [0, 1], easing: 'easeOutBack', duration: 500, delay: anime.stagger(140, { start: 300 }) });
  const mp = anime.path(trs[0]);
  const comet = anime({ targets: '#heroComet', translateX: mp('x'), translateY: mp('y'), opacity: [{ value: 1, duration: 300 }], easing: 'linear', duration: 9000, delay: 3400, loop: true });
  heroAnim = [draw, pops, comet];
  $$('.nd', svg).forEach(n => { n.style.transformBox = 'fill-box'; n.style.transformOrigin = 'center'; });
}

/* ---------- controls ---------- */
function bindSeg(id, fn) {
  $$(`#${id} button`).forEach(b => b.onclick = () => {
    $$(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x === b));
    fn(b.dataset.v);
  });
}
function setSegValue(id, v) { $$(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x.dataset.v === v)); }

function initUI() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', onThemeChange);
  new MutationObserver(onThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  drawHero(true);

  const fi = $('#fileInput');
  const pick = () => { fi.value = ''; fi.click(); };
  $('#pickBtn').onclick = pick; $('#addBtn').onclick = pick;
  fi.onchange = () => handleFiles([...fi.files]);
  $('#sampleBtn').onclick = async () => {
    $('#busy').hidden = false; busyStep('Making a sample year', 'Two phones and a running watch');
    await sleep(40);
    try { await ingest(makeSample()); } catch (e) { console.error(e); showError('The sample could not be built. ' + (e.message || '')); }
    finally { $('#busy').hidden = true; }
  };
  const drop = $('#drop');
  let depth = 0;
  addEventListener('dragenter', e => { e.preventDefault(); depth++; drop.classList.add('over'); });
  addEventListener('dragleave', e => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('over'); });
  addEventListener('dragover', e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; drop.classList.remove('over');
    if (!e.dataTransfer) return;
    const files = await readEntries(e.dataTransfer);
    handleFiles(files);
  });

  bindSeg('combineSeg', v => {
    if (v === S.mode) return;
    S.mode = v;
    if (v === 'combined' && S.colorBy === 'device') { S.colorBy = 'mode'; setSegValue('colorSeg', 'mode'); }
    if (v === 'separate' && S.colorBy === 'mode' && S.sources.length > 1) { S.colorBy = 'device'; setSegValue('colorSeg', 'device'); }
    S.filter.place = null; S.openPlace = null;
    rebuildAll();
  });
  bindSeg('viewSeg', v => {
    viewBounds();
    S.view = v;
    const sb = $('#stageBody');
    sb.classList.toggle('split', v === 'split'); sb.classList.toggle('cube', v === 'cube');
    requestAnimationFrame(() => { if (map) { map.resize(); restoreView(); } Cube.show(v !== 'map'); });
  });
  bindSeg('colorSeg', v => { S.colorBy = v; if (S.ctx) { updateMap(); restyleMap(); Cube.schedule(); } });
  bindSeg('modeMetric', v => { S.modeMetric = v; if (S.res) renderModes(); });

  const lb = $('#layersBtn'), lp = $('#layersPop');
  lb.onclick = e => { e.stopPropagation(); lp.hidden = !lp.hidden; lb.setAttribute('aria-expanded', !lp.hidden); };
  document.addEventListener('click', e => { if (!lp.hidden && !lp.contains(e.target) && e.target !== lb) { lp.hidden = true; lb.setAttribute('aria-expanded', 'false'); } });
  $$('input[data-l]', lp).forEach(inp => {
    inp.checked = !!S.layers[inp.dataset.l];
    inp.onchange = () => {
      const l = inp.dataset.l; S.layers[l] = inp.checked;
      if (l === 'streets') { setStreets(inp.checked); return; }
      updateMap();
    };
  });
  $('#fitHome').onclick = () => fitHome(true);
  $('#fitAll').onclick = () => fitAll(true);

  $('#playBtn').onclick = () => togglePlay();
  $('#stopBtn').onclick = () => stopPlay();
  const sp = $('#speed'), so = $('#speedOut');
  const setSp = () => { S.play.speed = +sp.value; so.textContent = fmtRate(speedRate(S.play.speed)); };
  sp.oninput = setSp; setSp();
  $('#skipStays').onchange = e => { S.play.skip = e.target.checked; };
  $('#follow').onchange = e => { S.play.follow = e.target.checked; };
  $('#exportBtn').onclick = exportSelection;

  addEventListener('keydown', e => {
    if ($('#app').hidden) return;
    if (e.target.closest?.('input,select,textarea,[contenteditable="true"]')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'Escape') {
      if (S.play.session) stopPlay();
      else { Object.assign(S.filter, { t0: null, t1: null, hours: null, dows: null, modes: null, place: null }); S.openPlace = null; refresh('chips'); }
    }
  });
  let rt = null;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (!S.ctx) return; renderTimeline(); renderCalendar(); renderRhythm(); renderKPIs(); }, 150);
  });
}
function afterSourceStyle() {
  renderSources();
  restyleMap();
  doRefresh('all');
  renderTogether();
}

initUI();
