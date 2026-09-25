import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useStore, getState, setState } from '../store.js';
import { readEntries } from '../lib/parse.js';
import { useThemeWatch } from '../theme.js';
import { Tip } from '../tip.jsx';
import Landing from './Landing.jsx';

// the workspace (MapLibre, three.js, D3, Turf) and the analysis load on demand, so the landing page stays small
const Workspace = lazy(() => import('./Workspace.jsx'));
const actions = () => import('../actions.js');
const handleFiles = async files => {
  if (!files?.length) return;
  setState({ busy: { step: 'Reading files', sub: '' } }); // shows while the analysis code loads
  (await actions()).handleFiles(files);
};

export default function App() {
  const screen = useStore(s => s.screen);
  const busy = useStore(s => s.busy);
  const fileRef = useRef(null);
  const [over, setOver] = useState(false);
  useThemeWatch();

  // drop files or a folder anywhere on the page
  useEffect(() => {
    let depth = 0;
    const enter = e => { e.preventDefault(); depth++; setOver(true); };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setOver(false); };
    const overH = e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const drop = async e => {
      e.preventDefault(); depth = 0; setOver(false);
      if (!e.dataTransfer) return;
      handleFiles(await readEntries(e.dataTransfer));
    };
    addEventListener('dragenter', enter); addEventListener('dragleave', leave); addEventListener('dragover', overH); addEventListener('drop', drop);
    return () => { removeEventListener('dragenter', enter); removeEventListener('dragleave', leave); removeEventListener('dragover', overH); removeEventListener('drop', drop); };
  }, []);

  // Space plays or pauses, Escape stops playback or clears the filters
  useEffect(() => {
    const key = e => {
      if (getState().screen !== 'app') return;
      if (e.target.closest?.('input,select,textarea,[contenteditable="true"]')) return;
      if (e.code === 'Space') { e.preventDefault(); actions().then(a => a.togglePlay()); }
      else if (e.key === 'Escape') actions().then(a => { if (getState().session) a.stopPlay(); else a.setFilter(null, 'chips'); });
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  const pick = () => { const fi = fileRef.current; fi.value = ''; fi.click(); };
  return <>
    {screen === 'landing' ? <Landing onPick={pick} over={over} /> : <Suspense fallback={null}><Workspace onPick={pick} /></Suspense>}
    <div id="busy" hidden={!busy}><div className="box"><div className="step" id="busyStep">{busy?.step}</div><div className="sub" id="busySub">{busy?.sub}</div><div className="prog"><i></i></div></div></div>
    <Tip />
    <input type="file" id="fileInput" ref={fileRef} multiple hidden accept=".json,.gpx,.zip,.geojson,application/json" onChange={e => handleFiles([...e.target.files])} />
  </>;
}
