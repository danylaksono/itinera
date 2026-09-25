/* ================================================================
   Part F: sample data — a made-up year in Lisbon.
   Emits three real-format files and runs them through the parsers:
   Android Timeline.json (phone), Records.json (work phone), runs.gpx (watch)
   ================================================================ */
function makeSample() {
  let seed = 20250106;
  const R = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rnd = (a, b) => a + (b - a) * R();
  const chance = p => R() < p;

  const P = {
    home: [38.7178, -9.1633, 'HOME'], work: [38.7680, -9.0957, 'WORK'],
    cafe: [38.7155, -9.1590, 'Café Estrela'], gym: [38.7230, -9.1560, 'Rato climbing gym'], lunch: [38.7640, -9.0935, 'Cantina do Parque'],
    market: [38.7070, -9.1458, 'Mercado da Ribeira'], park: [38.7137, -9.1597, 'Jardim da Estrela'], friend: [38.7520, -9.1440, "Rita's flat"],
    bar: [38.7125, -9.1450, 'Bairro Alto'], cinema: [38.7236, -9.1618, 'Amoreiras cinema'], beach: [38.6979, -9.4215, 'Praia da Conceição'],
    sintra: [38.7979, -9.3906, 'Sintra'], oriente: [38.7677, -9.0990, 'Gare do Oriente'], apolonia: [38.7137, -9.1225, 'Santa Apolónia'],
    lis: [38.7742, -9.1342, 'Lisbon Airport'], cascaisSt: [38.7006, -9.4185, 'Cascais station'],
    campanha: [41.1488, -8.5856, 'Porto Campanhã'], portoHotel: [41.1456, -8.6110, 'Hotel Bolhão'], ribeira: [41.1407, -8.6130, 'Ribeira'], serralves: [41.1597, -8.6598, 'Serralves'], matosinhos: [41.1823, -8.6897, 'Matosinhos beach'],
    bcn: [41.2974, 2.0833, 'Barcelona Airport'], bcnHotel: [41.3870, 2.1700, 'Hotel Eixample'], sagrada: [41.4036, 2.1744, 'Sagrada Família'], barceloneta: [41.3784, 2.1925, 'Barceloneta'], guell: [41.4145, 2.1527, 'Park Güell'], gothic: [41.3833, 2.1760, 'Barri Gòtic'],
    coimbraB: [40.2230, -8.4430, 'Coimbra-B'], parents: [40.2033, -8.4103, "Parents' house"], uni: [40.2076, -8.4262, 'University of Coimbra']
  };
  const zoneOf = k => /^(bcn|sagrada|barceloneta|guell|gothic)/.test(k) || k === 'bcnHotel' ? 'CET' : 'WET';
  const lastSun = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0)); return Date.UTC(y, m, d.getUTCDate() - d.getUTCDay(), 1); };
  const dst = t => { const y = new Date(t).getUTCFullYear(); return t >= lastSun(y, 2) && t < lastSun(y, 9); };
  const offOf = (zone, t) => (zone === 'CET' ? 60 : 0) + (dst(t) ? 60 : 0);
  const dayOf = (y, m, d) => Date.UTC(y, m - 1, d) / DAY;
  const L = (day, h, zone = 'WET') => { const g = day * DAY + h * HOUR; return g - offOf(zone, g) * MIN; };

  const SPEED = { walk: 1.35, run: 2.9, cycle: 4.3, road: 8.5, taxi: 9, metro: 7.5, train: 30, suburban: 13, flight: 210 };
  const TYPE = { walk: 'WALKING', run: 'RUNNING', cycle: 'CYCLING', road: 'IN_PASSENGER_VEHICLE', taxi: 'IN_TAXI', metro: 'IN_SUBWAY', train: 'IN_TRAIN', suburban: 'IN_TRAIN', flight: 'FLYING', bus: 'IN_BUS' };
  const stays = [], moves = [], left = [];
  let cur = 'home', since = L(dayOf(2025, 1, 6), 0);

  function route(pa, pb, t0, mode) {
    const d = hav(pa[0], pa[1], pb[0], pb[1]);
    const sp = SPEED[mode] * rnd(0.85, 1.12);
    const detour = mode === 'flight' ? 1.02 : mode === 'train' ? 1.15 : 1.3;
    const wait = mode === 'metro' ? rnd(4, 9) * MIN : mode === 'train' || mode === 'suburban' ? rnd(2, 6) * MIN : mode === 'flight' ? 25 * MIN : 0;
    const dur = Math.max(3 * MIN, d * detour / sp * 1000 + wait);
    if (mode === 'flight') return [[t0, pa[0], pa[1]], [t0 + dur, pb[0], pb[1]]];
    const step = mode === 'run' ? 8e3 : d > 60000 ? 120e3 : 40e3;
    const n = Math.max(2, Math.ceil(dur / step));
    const bend = rnd(-0.18, 0.18), mla = (pa[0] + pb[0]) / 2, mlo = (pa[1] + pb[1]) / 2;
    const cla = mla - (pb[1] - pa[1]) * bend, clo = mlo + (pb[0] - pa[0]) * bend;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, e = u * u * (3 - 2 * u) * 0.25 + u * 0.75;
      let la = (1 - e) ** 2 * pa[0] + 2 * (1 - e) * e * cla + e * e * pb[0];
      let lo = (1 - e) ** 2 * pa[1] + 2 * (1 - e) * e * clo + e * e * pb[1];
      if (i && i < n) { la += rnd(-1, 1) * 0.00007; lo += rnd(-1, 1) * 0.00009; }
      out.push([t0 + dur * u, la, lo]);
    }
    return out;
  }
  function loop(t0) { // a running loop from home
    const wp = [P.home, [38.7137, -9.1597], [38.7118, -9.1702], [38.7196 + rnd(-.003, .003), -9.1835 + rnd(-.004, .002)], [38.7302, -9.1760 + rnd(-.003, .003)], [38.7255, -9.1648], P.home];
    const pts = []; let t = t0;
    for (let i = 1; i < wp.length; i++) { const seg = route(wp[i - 1], wp[i], t, 'run'); if (pts.length) seg.shift(); pts.push(...seg); t = seg[seg.length - 1][0]; }
    return pts;
  }
  function go(to, t0, mode) {
    if (t0 < since + 4 * MIN) t0 = since + rnd(4, 9) * MIN;
    stays.push({ t0: since, t1: t0, p: cur });
    const pts = route(P[cur], P[to], t0, mode);
    const t1 = pts[pts.length - 1][0];
    moves.push({ t0, t1, mode, type: TYPE[mode], from: cur, to, pts });
    cur = to; since = t1;
    return t1;
  }
  function run(t0) {
    if (cur !== 'home') return;
    if (t0 < since + 4 * MIN) t0 = since + 5 * MIN;
    stays.push({ t0: since, t1: t0, p: cur });
    const pts = loop(t0);
    moves.push({ t0, t1: pts[pts.length - 1][0], mode: 'run', type: 'RUNNING', from: 'home', to: 'home', pts, run: true });
    since = pts[pts.length - 1][0];
  }
  const stay = (h) => since + h * HOUR;
  const cityMode = () => chance(0.7) ? 'metro' : 'road';

  const d0 = dayOf(2025, 1, 6), d1 = dayOf(2026, 2, 27);
  const inRange = (d, a, b) => d >= a && d <= b;
  const PORTO = [dayOf(2025, 4, 17), dayOf(2025, 4, 21)], BCN = [dayOf(2025, 9, 10), dayOf(2025, 9, 15)], COIM = [dayOf(2025, 12, 23), dayOf(2025, 12, 27)];
  const runsFrom = dayOf(2025, 3, 1);

  for (let day = d0; day <= d1; day++) {
    const dow = (day + 3) % 7, mon = new Date(day * DAY).getUTCMonth() + 1, summer = mon >= 5 && mon <= 9;
    // ---------- trips away
    if (inRange(day, ...PORTO)) {
      const k = day - PORTO[0];
      if (k === 0) { go('apolonia', L(day, 8.4), 'metro'); go('campanha', L(day, 9.65), 'train'); go('portoHotel', stay(0.3), 'taxi'); go('ribeira', L(day, 16), 'walk'); go('portoHotel', L(day, 21.5), 'walk'); }
      else if (k < 4) {
        go(k === 2 ? 'serralves' : k === 3 ? 'matosinhos' : 'ribeira', L(day, rnd(9.5, 10.5)), k === 1 ? 'walk' : 'metro');
        go(k === 1 ? 'serralves' : 'ribeira', L(day, 14.2), k === 1 ? 'road' : 'metro');
        go('portoHotel', L(day, rnd(20.5, 22.5)), 'walk');
      } else { go('campanha', L(day, 15.2), 'taxi'); go('apolonia', stay(0.4), 'train'); go('home', stay(0.2), 'metro'); }
      continue;
    }
    if (inRange(day, ...BCN)) {
      const k = day - BCN[0];
      if (k === 0) { go('lis', L(day, 7.9), 'taxi'); go('bcn', L(day, 9.7), 'flight'); go('bcnHotel', stay(0.5), 'metro'); go('gothic', L(day, 17.5, 'CET'), 'walk'); go('bcnHotel', L(day, 23, 'CET'), 'walk'); }
      else if (k < 5) {
        const a = ['sagrada', 'guell', 'barceloneta', 'gothic'][k - 1], b = ['barceloneta', 'gothic', 'sagrada', 'guell'][k - 1];
        go(a, L(day, rnd(9.6, 10.8), 'CET'), k % 2 ? 'metro' : 'walk');
        go(b, L(day, rnd(14, 15.5), 'CET'), 'metro');
        go('bcnHotel', L(day, rnd(21, 23.5), 'CET'), chance(.5) ? 'walk' : 'metro');
      } else { go('bcn', L(day, 15.3, 'CET'), 'metro'); go('lis', L(day, 18.2, 'CET'), 'flight'); go('home', stay(0.4), 'taxi'); }
      continue;
    }
    if (inRange(day, ...COIM)) {
      const k = day - COIM[0];
      if (k === 0) { go('oriente', L(day, 9.2), 'metro'); go('coimbraB', L(day, 10.1), 'train'); go('parents', stay(0.2), 'taxi'); }
      else if (k < 4) { if (k !== 2 && chance(.8)) { go('uni', L(day, rnd(10.5, 15)), 'walk'); go('parents', stay(rnd(1.5, 3)), 'walk'); } }
      else { go('coimbraB', L(day, 16.5), 'taxi'); go('oriente', stay(0.25), 'train'); go('home', stay(0.2), 'metro'); }
      continue;
    }
    // ---------- ordinary days
    if (dow < 5) {
      let dep = L(day, rnd(7.55, 8.3));
      if ((dow === 0 || dow === 2) && chance(.4)) { go('cafe', dep - 40 * MIN, 'walk'); dep = stay(rnd(0.35, 0.6)); }
      const cyc = summer ? 0.45 : 0.18;
      const m = chance(cyc) ? 'cycle' : chance(0.12) ? 'road' : 'metro';
      go('work', dep, m);
      if (chance(.45)) {
        const t = L(day, rnd(12.4, 13.1)); const leave = chance(.5);
        go('lunch', t, 'walk'); const back = go('work', stay(rnd(0.7, 1.1)), 'walk');
        if (leave) left.push([t - MIN, back + MIN]);
      }
      go(m === 'cycle' ? 'home' : 'home', L(day, rnd(17.4, 18.8)), m);
      if ((dow === 1 || dow === 3) && chance(.72)) { go('gym', stay(rnd(0.4, 0.9)), chance(.5) ? 'walk' : 'cycle'); go('home', stay(rnd(1.1, 1.6)), 'walk'); }
      else if (dow === 4 && chance(.5)) { go('bar', stay(rnd(0.8, 1.6)), 'metro'); go('home', stay(rnd(2.5, 4.5)), 'taxi'); }
      else if (chance(.08)) { go('friend', stay(rnd(0.5, 1.2)), 'metro'); go('home', stay(rnd(2, 3.5)), 'metro'); }
      if (dow === 2 && day >= runsFrom && cur === 'home' && chance(.7)) run(Math.max(since + 20 * MIN, L(day, rnd(19.2, 19.8))));
    } else if (dow === 5) {
      if (day >= runsFrom && chance(.8)) run(L(day, rnd(8.6, 9.6)));
      if (chance(.6)) { go('market', L(day, rnd(11, 12.3)), cityMode()); if (chance(.5)) { go('park', stay(rnd(1, 1.8)), 'walk'); go('home', stay(rnd(0.8, 1.6)), 'walk'); } else go('home', stay(rnd(1.2, 2)), 'metro'); }
      if (chance(.25)) { go('cinema', L(day, rnd(19, 20.5)), 'walk'); go('home', stay(2.4), 'walk'); }
      else if (chance(.3)) { go('bar', L(day, rnd(21, 22)), 'metro'); go('home', stay(rnd(2.5, 4)), 'taxi'); }
    } else {
      if (summer && chance(.5)) { go('cascaisSt', L(day, rnd(10.3, 11.5)), 'suburban'); go('beach', stay(0.1), 'walk'); go('cascaisSt', L(day, rnd(17, 18.5)), 'walk'); go('home', stay(0.1), 'suburban'); }
      else if (chance(.12)) { go('sintra', L(day, rnd(10, 11)), 'road'); go('home', L(day, rnd(17, 18.5)), 'road'); }
      else if (chance(.5)) { go('park', L(day, rnd(15, 16.5)), 'walk'); go('home', stay(rnd(1, 2)), 'walk'); }
      if (chance(.2)) { go('friend', L(day, rnd(19, 20)), 'metro'); go('home', stay(rnd(2.5, 3.5)), 'metro'); }
    }
  }
  stays.push({ t0: since, t1: L(d1, 23.9), p: cur });

  // ---------- helpers for output
  const iso = (t, off) => {
    const d = new Date(t + off * MIN).toISOString().slice(0, 23);
    const s = off < 0 ? '-' : '+', a = Math.abs(off);
    return `${d}${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  };
  const ll = p => `${p[0].toFixed(7)}°, ${p[1].toFixed(7)}°`;
  const jit = () => rnd(-1, 1) * 0.00012;

  // ---------- 1) Android on-device Timeline.json (main phone)
  const gap0 = dayOf(2025, 11, 3) * DAY, gap1 = dayOf(2025, 11, 12) * DAY;
  const segs = [];
  const ev = [...stays.map(s => ({ ...s, k: 's' })), ...moves.map(m => ({ ...m, k: 'm' }))].sort((a, b) => a.t0 - b.t0);
  for (const e of ev) {
    if (e.t1 <= e.t0) continue;
    if (e.t1 > gap0 && e.t0 < gap1) continue;
    const z = zoneOf(e.k === 's' ? e.p : e.from), off = offOf(z, e.t0), off1 = offOf(zoneOf(e.k === 's' ? e.p : e.to), e.t1);
    const base = { startTime: iso(e.t0, off), endTime: iso(e.t1, off1), startTimeTimezoneUtcOffsetMinutes: off, endTimeTimezoneUtcOffsetMinutes: off1 };
    if (e.k === 's') {
      const p = P[e.p];
      segs.push({ ...base, visit: { hierarchyLevel: 0, probability: 0.9, topCandidate: { placeId: 'ChIJ_' + e.p, semanticType: p[2] === 'HOME' ? 'HOME' : p[2] === 'WORK' ? 'WORK' : 'UNKNOWN', probability: 0.8, placeLocation: { latLng: ll(p) } } } });
    } else {
      if (e.run) continue; // the phone stays at home during runs
      const pa = P[e.from], pb = P[e.to];
      const dist = e.pts.reduce((a, p, i) => i ? a + hav(e.pts[i - 1][1], e.pts[i - 1][2], p[1], p[2]) : 0, 0);
      segs.push({ ...base, activity: { start: { latLng: ll(pa) }, end: { latLng: ll(pb) }, distanceMeters: Math.round(dist), probability: 0.9, topCandidate: { type: e.type, probability: 0.8 } } });
      if (e.mode !== 'flight') {
        const tp = [];
        const every = e.mode === 'train' ? 3 : 2;
        e.pts.forEach((p, i) => { if (i % every === 0 || i === e.pts.length - 1) tp.push({ point: `${(p[1] + jit()).toFixed(7)}°, ${(p[2] + jit()).toFixed(7)}°`, time: iso(p[0], off) }); });
        segs.push({ startTime: base.startTime, endTime: base.endTime, timelinePath: tp });
      }
    }
  }
  const android = {
    semanticSegments: segs, rawSignals: [],
    userLocationProfile: { frequentPlaces: [{ placeId: 'ChIJ_home', placeLocation: ll(P.home), label: 'HOME' }, { placeId: 'ChIJ_work', placeLocation: ll(P.work), label: 'WORK' }] }
  };

  // ---------- truth position lookup
  const TT = [], LA = [], LO = [];
  for (const e of ev) {
    if (e.k === 's') { const p = P[e.p]; TT.push(e.t0, e.t1); LA.push(p[0], p[0]); LO.push(p[1], p[1]); }
    else if (!e.run) for (const p of e.pts) { TT.push(p[0]); LA.push(p[1]); LO.push(p[2]); }
  }
  const ord = TT.map((_, i) => i).sort((a, b) => TT[a] - TT[b]);
  const T2 = ord.map(i => TT[i]), A2 = ord.map(i => LA[i]), O2 = ord.map(i => LO[i]);
  const truthAt = t => { const i = clamp(bisect(T2, t), 1, T2.length - 1), a = i - 1, f = T2[i] > T2[a] ? clamp((t - T2[a]) / (T2[i] - T2[a]), 0, 1) : 0; return [A2[a] + (A2[i] - A2[a]) * f, O2[a] + (O2[i] - O2[a]) * f]; };

  // ---------- 2) Records.json from a work phone (weekdays 07-20h until end of July 2025)
  const locs = [], stop = dayOf(2025, 8, 1);
  let li = 0;
  for (let day = d0; day < stop; day++) {
    const dow = (day + 3) % 7; if (dow > 4) continue;
    if (inRange(day, ...PORTO)) continue;
    let t = L(day, 7 + rnd(0, 0.3)); const end = L(day, 20);
    while (t < end) {
      while (li < left.length && left[li][1] < t) li++;
      const behind = li < left.length && t >= left[li][0] && t <= left[li][1];
      const p = behind ? [P.work[0], P.work[1]] : truthAt(t);
      const acc = Math.round(rnd(8, 45));
      const n = acc / 111000 * 0.6;
      locs.push({ latitudeE7: Math.round((p[0] + rnd(-n, n)) * 1e7), longitudeE7: Math.round((p[1] + rnd(-n, n) * 1.3) * 1e7), accuracy: acc, source: 'WIFI', deviceTag: 71849203, timestamp: new Date(t).toISOString() });
      t += rnd(2, 4.5) * MIN;
    }
  }
  const records = { locations: locs };
  const settings = { deviceSettings: [{ deviceTag: 71849203, devicePrettyName: 'Work phone' }] };

  // ---------- 3) runs.gpx from a watch
  let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Itinera sample" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Running watch</name></metadata>\n';
  for (const m of moves) {
    if (!m.run || m.t0 < runsFrom * DAY) continue;
    gpx += '<trk><name>Run</name><type>running</type><trkseg>';
    for (const p of m.pts) gpx += `<trkpt lat="${(p[1] + rnd(-1, 1) * 0.00003).toFixed(6)}" lon="${(p[2] + rnd(-1, 1) * 0.00004).toFixed(6)}"><time>${new Date(p[0]).toISOString().slice(0, 19)}Z</time></trkpt>`;
    gpx += '</trkseg></trk>\n';
  }
  gpx += '</gpx>';

  // ---------- parse through the real readers
  const ctx = { deviceNames: new Map(), semantic: null };
  const raws = [];
  detectAndParse('Settings.json', settings, ctx);
  const a = detectAndParse('Timeline.json', android, ctx);
  // Google gives names for places in older exports; the sample adds them so the demo reads well
  for (const r of a) { r.name = 'Pixel phone'; for (const v of r.visits) { const k = v.pid?.slice(5); if (k && P[k] && !/^(HOME|WORK)$/.test(P[k][2])) v.name = P[k][2]; } }
  raws.push(...a);
  raws.push(...detectAndParse('Records.json', records, ctx));
  raws.push(...detectAndParse('runs.gpx', gpx, ctx));
  return raws;
}
