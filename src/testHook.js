/* Hooks for the browser tests (tests/*.mjs), installed with the workspace. They read state only;
   nothing is sent anywhere. */
import { getState } from './store.js';
import { setFilter, setMode, setTimeRange, settle, toggleHidden } from './actions.js';
import { seek, togglePlay } from './playback.js';
import { getMap, mapReady, viewBounds } from './map/mapView.jsx';

window.__itinera = {
  get store() { return getState(); },
  get map() { return getMap(); },
  mapReady, settle, setFilter, setTimeRange, setMode, toggleHidden, seek, togglePlay,
  viewBounds: () => viewBounds()?.toArray().flat() ?? null
};
