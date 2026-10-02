/* Hooks for the browser tests (tests/*.mjs), installed with the workspace. They read state only;
   nothing is sent anywhere. */
import { getState } from './store.js';
import { setFilter, setMode, setTimeRange, settle, toggleHidden } from './actions.js';
import { seek, togglePlay } from './playback.js';
import { getMap, mapReady, viewBounds } from './map/mapView.jsx';
import { mareyData } from './lib/marey.js';
import { intentToHours, resolveWeekdays, matchPlace, toFilterPatch, validateFilterShape } from './lib/llmQuery.js';
import { loadApiKey, saveApiKey } from './lib/llm.js';

window.__itinera = {
  get store() { return getState(); },
  get map() { return getMap(); },
  mareyData: (layout = 'days', rows = 17) => mareyData(getState(), layout, rows),
  mapReady, settle, setFilter, setTimeRange, setMode, toggleHidden, seek, togglePlay,
  viewBounds: () => viewBounds()?.toArray().flat() ?? null,
  // "Ask" feature: pure functions testable with hand-built input, no key or network needed
  ask: { intentToHours, resolveWeekdays, matchPlace, validateFilterShape, toFilterPatch: p => toFilterPatch(getState(), p), loadApiKey, saveApiKey }
};
