/* The app state. One plain object, replaced (never mutated) on each change, so React components
   can select fields with useStore(). The large data (sources, ctx, res) lives here too, but is
   built outside React, by the actions (actions.js). This module stays small: the landing page uses it. */
import { useSyncExternalStore } from 'react';

export const NO_FILTER = Object.freeze({ t0: null, t1: null, hours: null, dows: null, modes: null, place: null });

let state = {
  screen: 'landing',          // 'landing' | 'app'
  sources: [], merged: null, mode: 'separate', hidden: new Set(),
  colorBy: 'device', view: 'map', modeMetric: 'dist',
  second: 'cube',             // the view beside the map in split: 'cube' | 'marey' (the last one opened)
  cubeFloor: 'map',           // space-time cube floor: 'map' (the map view) | 'home' (km around the home of each time)
  mareyLayout: 'days',        // place timetable: 'days' (stacked on 24 h) | 'calendar'
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
/* is the secondary view v ('cube' or 'marey') on screen, alone or in split? */
export const showing = (st, v) => st.view === v || (st.view === 'split' && st.second === v);
export const useStore = sel => useSyncExternalStore(subscribe, () => sel(state));

/* The analysis code (actions.js and the libraries it needs) loads on demand. If that load fails
   (a new deploy replaced the chunks, the network dropped, or the dev server re-optimised),
   say so and clear the overlay, so the page never waits forever. */
export async function loadActions() {
  try { return await import('./actions.js'); }
  catch (e) {
    console.error(e);
    const msg = 'Itinera could not load its analysis code. Reload the page and try again.';
    setState(s => ({ busy: null, ...(s.screen === 'landing' ? { landErr: msg } : {}) }));
    if (state.screen !== 'landing') toast(msg, 9000);
    throw e;
  }
}

let toastId = 0, toastTimer = null;
export function toast(msg, ms = 4000) {
  const id = ++toastId;
  setState({ toast: { msg, id } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (state.toast?.id === id) setState({ toast: null }); }, ms);
}
