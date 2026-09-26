/* Reads and parses files off the main thread, so the page stays responsive while a large export
   loads. It runs loadFiles() (unzip, read, detect the format, parse) and posts the raw sources back;
   the rest of the analysis stays in the page (actions.js, readFiles()). Nothing leaves the browser:
   the worker is a file of this site, and the page's policy applies to it. */
import { loadFiles } from './lib/parse.js';

self.onmessage = async ({ data }) => {
  try {
    const out = await loadFiles(data.files, (step, sub) => self.postMessage({ type: 'step', step, sub }));
    self.postMessage({ type: 'done', ...out });
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message || String(e) });
  }
};
