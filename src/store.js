/* The app state. One plain object, replaced (never mutated) on each change, so React components
   can select fields with useStore(). The large data (sources, ctx, res) lives here too, but is
   built outside React, by the actions (actions.js). This module stays small: the landing page uses it. */
import { useSyncExternalStore } from 'react';

export const NO_FILTER = Object.freeze({ t0: null, t1: null, hours: null, dows: null, modes: null, place: null });

let state = {
  screen: 'landing',          // 'landing' | 'app'
  sources: [], merged: null, mode: 'separate', hidden: new Set(),
  colorBy: 'device', view: 'map', modeMetric: 'dist',
  layers: { trails: true, heat: true, places: true, flows: false, ellipse: false, streets: false },
  filter: NO_FILTER,
  ctx: null, res: null,
  from: 'all',                // which view caused the latest compute (the timeline keeps its brush)
  openPlace: null, hlPlace: null,
  labels: 0,                  // bumped when a place is renamed (labels live on ctx.places)
  playing: false, session: false, speed: 46, skip: true, follow: false,
  busy: null,                 // { step, sub } while the overlay shows
  toast: null,                // { msg, id }
  landErr: '',
  dark: false,
  pairs: []                   // device co-location, see renderTogether
};

const subs = new Set();
export const getState = () => state;
export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const f of subs) f();
}
export function subscribe(f) { subs.add(f); return () => subs.delete(f); }
export const useStore = sel => useSyncExternalStore(subscribe, () => sel(state));

let toastId = 0, toastTimer = null;
export function toast(msg, ms = 4000) {
  const id = ++toastId;
  setState({ toast: { msg, id } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (state.toast?.id === id) setState({ toast: null }); }, ms);
}
