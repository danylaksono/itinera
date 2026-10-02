import { useState } from 'react';
import { useStore, getState, setState } from '../store.js';
import { PROVIDERS, DEFAULT_MODEL, loadApiKey, saveApiKey } from '../lib/llm.js';
import { runAskQuery, setFilter, settle } from '../actions.js';
import { summarizeResult } from '../lib/llmQuery.js';

/* Ask about your data: types a question, an opt-in cloud LLM (the user's own key) translates it
   into a filter, shown as editable chips before it is applied to the same state.filter every
   other view already reads. See lib/llmQuery.js for what is and isn't sent to the LLM. */
export default function Ask() {
  const llm = useStore(s => s.llm);
  const providerLabel = PROVIDERS.find(p => p[0] === llm.provider)[1];
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyInput, setKeyInput] = useState(() => loadApiKey(llm.provider));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null); // { patch, chips, warnings } | null
  const [summary, setSummary] = useState(null); // { text, filter }: the line goes stale when the filter changes elsewhere
  const filter = useStore(s => s.filter);
  // real state, not read fresh on every render: saving a key must change this so the
  // component actually re-renders (setSettingsOpen(false) alone is a no-op when the gate is
  // shown because !hasKey rather than settingsOpen, so nothing else would trigger a re-render)
  const [hasKey, setHasKey] = useState(() => !!loadApiKey(llm.provider));

  function pickProvider(provider) {
    setState({ llm: { ...getState().llm, provider } });
    setKeyInput(loadApiKey(provider));
    setHasKey(!!loadApiKey(provider));
  }
  function saveSettings() {
    const key = keyInput.trim();
    saveApiKey(llm.provider, key);
    setHasKey(!!key);
    setSettingsOpen(false);
  }
  async function ask(e) {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setDraft(null); setSummary(null);
    const r = await runAskQuery(q.trim());
    setBusy(false);
    if (r) setDraft(r);
  }
  function removeChip(key) {
    setDraft(d => {
      const patch = { ...d.patch };
      if (key === 'time') { patch.t0 = null; patch.t1 = null; } else patch[key] = null;
      return { ...d, patch, chips: d.chips.filter(c => c.key !== key) };
    });
  }
  async function apply() {
    const { patch, chips } = draft;
    setFilter(patch, 'ask');
    setDraft(null); setQ('');
    await settle();
    const st = getState();
    if (st.res) setSummary({ text: summarizeResult(st, chips), filter: st.filter });
  }

  if (settingsOpen) return (
    <div className="ask ask-settings">
      <fieldset>
        <legend>Ask about your data</legend>
        <label className="chk">Provider
          <select id="askProviderSel" value={llm.provider} onChange={e => pickProvider(e.target.value)}>
            {PROVIDERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="chk">API key
          <input id="askKeyInput" type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder={`Your ${providerLabel} key`} autoComplete="off" />
        </label>
        <label className="chk">Model
          <input id="askModelInput" type="text" value={llm.model} onChange={e => setState({ llm: { ...getState().llm, model: e.target.value } })} placeholder={DEFAULT_MODEL[llm.provider]} />
        </label>
        <div className="note">
          Your question – never your location data – is sent to {providerLabel} to turn it into a filter,
          which then runs in this browser. This needs a key of your own, billed to your account, and stored only
          in this browser. A direct call from a browser sends that key in a request header your browser's network
          tools can show – treat it like any other client-side key, not a server-side secret.
        </div>
        <div className="ask-actions">
          <button className="btn small" id="askSaveBtn" type="button" onClick={saveSettings} disabled={!keyInput.trim()}>Save</button>
          {hasKey && <button className="btn small" type="button" onClick={() => setSettingsOpen(false)}>Cancel</button>}
        </div>
      </fieldset>
    </div>
  );

  if (!hasKey) return (
    <div className="ask">
      <button className="btn small" id="askSettingsBtn" onClick={() => setSettingsOpen(true)}>Ask about your data</button>
    </div>
  );

  return (
    <div className="ask">
      <form onSubmit={ask}>
        <input type="text" id="askInput" value={q} onChange={e => setQ(e.target.value)} disabled={busy}
          placeholder="Ask about your data, e.g. where did I go for lunch on 17 September 2023" />
        <button className="btn small" id="askSubmitBtn" type="submit" disabled={busy || !q.trim()}>{busy ? 'Asking…' : 'Ask'}</button>
        <button className="btn small" id="askSettingsBtn" type="button" title="Ask settings" aria-label="Ask settings" onClick={() => setSettingsOpen(true)}>⚙</button>
      </form>
      {summary && summary.filter === filter && <p className="ask-summary" id="askSummary" aria-live="polite">{summary.text}</p>}
      {draft && (
        <div className="ask-draft" id="askDraft" aria-live="polite">
          {draft.warnings.map((w, i) => <div className="note" key={i}>{w}</div>)}
          {draft.chips.map(c => (
            <span className={`chip${c.inferred ? ' inferred' : ''}`} key={c.key} title={c.note || ''}>
              {c.label}<button aria-label="Remove" onClick={() => removeChip(c.key)}>×</button>
            </span>
          ))}
          {draft.chips.length > 0 && <button className="btn small" id="askApplyBtn" onClick={apply}>Show this</button>}
          <button className="btn small" onClick={() => setDraft(null)}>Discard</button>
        </div>
      )}
    </div>
  );
}
