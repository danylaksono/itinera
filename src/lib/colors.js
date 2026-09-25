/* Palettes and theme-aware colour helpers. All colours come from CSS variables or these arrays. */
import { interpolateRgb } from 'd3';

export const MODES = [
  { k: 'walk', label: 'Walk and run', L: '#2B7A66', D: '#5FC4A6' },
  { k: 'cycle', label: 'Cycling', L: '#6E962A', D: '#A9D26A' },
  { k: 'road', label: 'Road', L: '#B07C12', D: '#E8B64A' },
  { k: 'transit', label: 'Rail and transit', L: '#1D4E89', D: '#78A9E4' },
  { k: 'flight', label: 'Flying', L: '#6A4A98', D: '#B99AEA' },
  { k: 'other', label: 'Other', L: '#7A868C', D: '#8C999F' }
];
export const MODE_IDX = Object.fromEntries(MODES.map((m, i) => [m.k, i]));
// historic map inks: madder, Prussian blue, viridian, ochre, violet, sepia, ...
export const INKS_L = ['#B3322B', '#1D4E89', '#2B7A66', '#B07C12', '#6A4A98', '#7A5230', '#3E7C8C', '#9C3D6E'];
export const INKS_D = ['#F2806F', '#78A9E4', '#5FC4A6', '#E8B64A', '#B99AEA', '#D2A77E', '#79C3D3', '#E48DB8'];
export const HOUR_STOPS = [[0, '#27306A'], [4, '#3B3F8C'], [6.5, '#C9772C'], [9, '#D9A43A'], [13, '#B9B23C'], [17, '#D07A2E'], [19.5, '#B23F37'], [22, '#5A2E6A'], [24, '#27306A']];
export const HOUR_STOPS_D = [[0, '#6F7FE0'], [4, '#8D86E8'], [6.5, '#F0A55A'], [9, '#F2C66A'], [13, '#D7D46A'], [17, '#F0A05A'], [19.5, '#EF7A6B'], [22, '#B77CD6'], [24, '#6F7FE0']];

export const isDark = () => document.documentElement.dataset.dark === '1';
export const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const inkOf = src => (isDark() ? INKS_D : INKS_L)[(src?.colorIdx ?? 0) % INKS_L.length];
export const modeColor = k => MODES[MODE_IDX[k] ?? 5][isDark() ? 'D' : 'L'];
export const hourStops = () => isDark() ? HOUR_STOPS_D : HOUR_STOPS;
export function hourColor(h) {
  const st = hourStops();
  for (let i = 1; i < st.length; i++) if (h <= st[i][0]) { const [a, ca] = st[i - 1], [b, cb] = st[i]; return interpolateRgb(ca, cb)((h - a) / (b - a)); }
  return st[0][1];
}
export const inkRamp = () => interpolateRgb(cssv('--rule-2'), cssv('--ink'));
// combined mode draws everything in the page ink
export const trackColor = (st, s) => st.mode === 'combined' ? cssv('--ink') : inkOf(s);
