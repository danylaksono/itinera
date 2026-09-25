/* Theme: the viewer can set data-theme="light|dark" on <html>; otherwise the page follows
   prefers-color-scheme. applyTheme() writes data-dark="1|0", which isDark() reads. */
import { useEffect } from 'react';
import { getState, setState } from './store.js';

function detectDark() {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}
export function applyTheme() {
  const d = detectDark();
  document.documentElement.dataset.dark = d ? '1' : '0';
  if (getState().dark !== d) setState({ dark: d });
}
export function useThemeWatch() {
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', applyTheme);
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener?.('change', applyTheme); mo.disconnect(); };
  }, []);
}
