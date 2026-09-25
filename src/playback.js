/* Playback engine. The clock changes every frame, so it lives outside React state:
   views subscribe with onClock() (map, cube, timeline, calendar, rhythm) or useClock() (the clock text). */
import { useSyncExternalStore } from 'react';
import { MIN, HOUR, DAY, bisect } from './lib/util.js';
import { playRange } from './lib/analytics.js';
import { getState, setState } from './store.js';

export const speedRate = v => 5 * MIN * Math.pow((60 * DAY) / (5 * MIN), v / 100); // data ms per second
export function fmtRate(r) {
  if (r >= 1.5 * DAY) return `${Math.round(r / DAY)} days per second`;
  if (r >= 0.95 * DAY) return `1 day per second`;
  if (r >= 1.5 * HOUR) return `${Math.round(r / HOUR)} hours per second`;
  if (r >= 0.95 * HOUR) return `1 hour per second`;
  return `${Math.round(r / MIN)} min per second`;
}

let clockT = null;
const subs = new Set();
export const getClock = () => clockT;
export function onClock(f) { subs.add(f); return () => subs.delete(f); }
function emit(force) { for (const f of subs) f(clockT, force); }
export const useClock = () => useSyncExternalStore(onClock, getClock);

let rafId = null, lastTs = 0;
export function togglePlay(force) {
  const st = getState();
  if (!st.ctx) return;
  const on = force ?? !st.playing;
  if (on) {
    const [a, b] = playRange(st);
    if (!st.session || clockT == null || clockT >= b || clockT < a) clockT = a;
    setState({ playing: true, session: true });
    lastTs = performance.now();
    cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick);
  } else {
    cancelAnimationFrame(rafId);
    setState({ playing: false });
  }
}
export function stopPlay() {
  cancelAnimationFrame(rafId);
  setState({ playing: false, session: false });
  clockT = null;
  emit(true);
}
/* jump to a time (tests and screenshots) */
export function seek(t) { setState({ session: true }); clockT = t; emit(true); }

function tick(ts) {
  const st = getState();
  const dt = Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;
  const rate = speedRate(st.speed);
  const [a, b] = playRange(st);
  let c = clockT + rate * dt;
  if (st.skip) {
    const ms = st.ctx.movingStarts, mv = st.ctx.moving;
    const k = bisect(ms, c + 1) - 1;
    const inside = k >= 0 && c <= mv[k][1];
    if (!inside && k + 1 < ms.length) {
      const nxt = ms[k + 1];
      if (nxt - c > rate * 0.35) c = Math.max(c, nxt - rate * 0.3);
    }
  }
  if (c >= b) { clockT = b; emit(true); togglePlay(false); return; }
  clockT = c;
  emit(false);
  rafId = requestAnimationFrame(tick);
}
