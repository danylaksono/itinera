/* Shared constants, maths and formatting. Time values are UTC milliseconds. */
export const MIN = 6e4, HOUR = 36e5, DAY = 864e5;
export const RAD = Math.PI / 180, EARTH = 6371008.8;

export function hav(la1, lo1, la2, lo2) {
  const dLa = (la2 - la1) * RAD, dLo = (lo2 - lo1) * RAD;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(dLo / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
// first index i with arr[i] >= x
export function bisect(arr, x, lo = 0, hi = arr.length) {
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sleep = (ms = 0) => new Promise(r => setTimeout(r, ms));

export function fmtKm(m) {
  const k = m / 1000;
  if (k >= 10000) return (k / 1000).toFixed(k >= 100000 ? 0 : 1) + 'k';
  if (k >= 100) return Math.round(k).toLocaleString('en-GB');
  if (k >= 10) return k.toFixed(0);
  return k.toFixed(1);
}
export function fmtDur(ms) {
  const h = ms / HOUR;
  if (h >= 48) return Math.round(h / 24) + ' d';
  if (h >= 1) return (h >= 10 ? Math.round(h) : h.toFixed(1)) + ' h';
  return Math.max(1, Math.round(ms / MIN)) + ' min';
}
export const fmtN = n => Math.round(n).toLocaleString('en-GB');
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function fmtDay(day) { const d = new Date(day * DAY); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
export function fmtDayShort(day) { const d = new Date(day * DAY); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
export function fmtLocal(t, off) {
  const d = new Date(t + off * MIN);
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return { date: `${DOWS[(Math.floor((t + off * MIN) / DAY) + 3) % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, time: `${hh}:${mm}` };
}
export function monthOfDay(day) { const d = new Date(day * DAY); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
export function monthLabel(m) { return `${MONTHS[m % 12]} ${Math.floor(m / 12)}`; }
export function fmtSize(b) { if (!b) return ''; if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'; if (b > 1e6) return (b / 1e6).toFixed(0) + ' MB'; return Math.max(1, Math.round(b / 1e3)) + ' kB'; }

// browser offset cache (minutes east of UTC), per UTC day
const _offCache = new Map();
export function browserOff(t) {
  const k = Math.floor(t / DAY);
  let v = _offCache.get(k);
  if (v === undefined) { v = -new Date(t).getTimezoneOffset(); _offCache.set(k, v); }
  return v;
}

/* Local fields from the record's own UTC offset, never the browser time zone. */
export function localFields(o, t, off) {
  const L = t + off * MIN;
  o.day = Math.floor(L / DAY);
  o.hod = (((L % DAY) + DAY) % DAY) / HOUR;
  o.h = Math.floor(o.hod);
  o.dow = (o.day + 3) % 7;
  o.mon = monthOfDay(o.day);
  o.wk = Math.floor((o.day + 3) / 7);
}
