/* Turns one parsed LLM answer (see lib/llm.js) into a filter patch the app already understands
   (the shape of store.js NO_FILTER). Pure: no React, no store, no network - everything needed
   comes in as a parameter, per the src/lib/ convention. The vocabularies below (intents,
   weekdays, modes) are closed sets, so the LLM classifies into them rather than inventing
   values, which keeps the result auditable. */
import { MIN, HOUR, DAY, DOWS, fmtDay, fmtDayShort, fmtDur, fmtKm } from './util.js';
import { dayToUtc, passes } from './analytics.js';
import { MODES, MODE_IDX } from './colors.js';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']; // index already matches the app's dow (Mon=0)

/* local, deterministic lookup: the LLM only ever picks a key here, never invents hours itself */
export const INTENTS = {
  breakfast: { from: 6, to: 10, label: '06:00–10:00 (breakfast, inferred)' },
  lunch: { from: 11, to: 15, label: '11:00–15:00 (lunch, inferred)' },
  dinner: { from: 17, to: 21, label: '17:00–21:00 (dinner, inferred)' },
  morning: { from: 5, to: 12, label: '05:00–12:00 (morning)' },
  afternoon: { from: 12, to: 17, label: '12:00–17:00 (afternoon)' },
  evening: { from: 17, to: 21, label: '17:00–21:00 (evening)' },
  night: { from: 21, to: 5, label: '21:00–05:00 (night, wraps midnight)' },
  commute: { ranges: [[7, 9], [16, 19]], label: '07:00–09:00 and 16:00–19:00 (commute, inferred)' },
  weekend: { weekend: true, label: 'Saturday and Sunday' }
};

function hourSet(from, to) {
  const s = new Set();
  if (from <= to) for (let h = from; h < to; h++) s.add(h);
  else { for (let h = from; h < 24; h++) s.add(h); for (let h = 0; h < to; h++) s.add(h); } // wraps midnight
  return s;
}

/* the JSON Schema sent to both providers (see lib/llm.js) describing exactly what they may return */
export function schemaForPrompt() {
  return {
    type: 'object',
    properties: {
      date_from: { type: ['string', 'null'], description: "Local calendar date, ISO YYYY-MM-DD, inclusive. Resolve relative dates ('last Tuesday', '3 years ago') using today's date." },
      date_to: { type: ['string', 'null'], description: 'ISO YYYY-MM-DD, inclusive. Leave null for a single day.' },
      weekdays: { type: ['array', 'null'], items: { type: 'string', enum: WEEKDAYS }, description: 'Only when the question names weekdays, or "weekday"/"weekend" generically.' },
      intent: { type: ['string', 'null'], enum: [...Object.keys(INTENTS), null], description: 'A named time-of-day or routine the question refers to, e.g. "lunch". Never set this together with hour_from/hour_to.' },
      hour_from: { type: ['integer', 'null'], minimum: 0, maximum: 23, description: 'Only when the question gives an explicit clock time.' },
      hour_to: { type: ['integer', 'null'], minimum: 0, maximum: 23 },
      modes: { type: ['array', 'null'], items: { type: 'string', enum: Object.keys(MODE_IDX) } },
      place_query: { type: ['string', 'null'], description: "The place the question names, quoted from the question, e.g. 'the market', 'home', 'work'. Never invent a place that isn't in the question." },
      unsupported: { type: ['string', 'null'], description: 'Set this, and leave every other field null, when the question asks for something this schema cannot express (for example who the user was with, what they did, or the weather).' }
    },
    required: ['date_from', 'date_to', 'weekdays', 'intent', 'hour_from', 'hour_to', 'modes', 'place_query', 'unsupported'],
    additionalProperties: false
  };
}

const SYSTEM = 'You turn one question about the user\'s own location history into a structured filter. '
  + 'You are never shown any of the user\'s actual location data - your only job is to translate the '
  + 'question\'s language into the fields of the schema. Never invent a date, hour or place beyond what '
  + 'the question says or what today\'s date lets you compute. If the question asks for something the '
  + 'schema cannot express, set "unsupported" to a short phrase naming what could not be expressed and '
  + 'leave every other field null.';

export function buildPrompt(question, todayISO) {
  return { system: SYSTEM, user: `Today is ${todayISO}. Question: ${question}` };
}

export function localTodayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* strict: rejects unknown fields, wrong types or contradictions rather than guessing a partial filter */
export function validateFilterShape(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'The answer was not an object.' };
  const keys = ['date_from', 'date_to', 'weekdays', 'intent', 'hour_from', 'hour_to', 'modes', 'place_query', 'unsupported'];
  for (const k of Object.keys(obj)) if (!keys.includes(k)) return { ok: false, error: `The answer had an unexpected field, "${k}".` };
  const str = v => v == null || typeof v === 'string';
  const hour = v => v == null || (Number.isInteger(v) && v >= 0 && v <= 23);
  if (!str(obj.date_from) || !str(obj.date_to) || !str(obj.place_query) || !str(obj.unsupported)) return { ok: false, error: 'A text field was not a string.' };
  if (obj.date_from && !/^\d{4}-\d{2}-\d{2}$/.test(obj.date_from)) return { ok: false, error: 'date_from was not an ISO date.' };
  if (obj.date_to && !/^\d{4}-\d{2}-\d{2}$/.test(obj.date_to)) return { ok: false, error: 'date_to was not an ISO date.' };
  if (obj.weekdays != null && (!Array.isArray(obj.weekdays) || !obj.weekdays.every(d => WEEKDAYS.includes(d)))) return { ok: false, error: 'weekdays had an unknown day.' };
  if (obj.intent != null && !(obj.intent in INTENTS)) return { ok: false, error: 'intent was not one this app knows.' };
  if (!hour(obj.hour_from) || !hour(obj.hour_to)) return { ok: false, error: 'hour_from/hour_to must be 0-23.' };
  if (obj.intent && (obj.hour_from != null || obj.hour_to != null)) return { ok: false, error: 'The answer set both an intent and an explicit hour range.' };
  if (obj.modes != null && (!Array.isArray(obj.modes) || !obj.modes.every(m => m in MODE_IDX))) return { ok: false, error: 'modes had a travel mode this app does not track.' };
  return { ok: true, data: obj };
}

export function intentToHours(intent) {
  const def = INTENTS[intent];
  if (!def || def.weekend) return null; // weekend sets dows, not hours
  if (def.ranges) { const s = new Set(); for (const [a, b] of def.ranges) for (const h of hourSet(a, b)) s.add(h); return s; }
  return hourSet(def.from, def.to);
}

export function resolveWeekdays(list) {
  if (!list?.length) return null;
  const s = new Set(list.map(d => WEEKDAYS.indexOf(d)).filter(i => i >= 0));
  return s.size ? s : null;
}

function dayFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY);
}

/* fuzzy-matches a place phrase against ctx.places; returns null below a confidence threshold
   rather than guessing - the phrase is always the user's own words, quoted back by the LLM,
   never invented, so this only ever narrows down which of the user's own places it names. */
export function matchPlace(ctx, query) {
  const q = query?.trim().toLowerCase();
  if (!q) return null;
  let best = -1, bestScore = 0;
  for (const p of ctx.places) {
    for (const raw of [p.label, p.name, p.role, p.town]) {
      if (!raw) continue;
      const c = raw.toLowerCase();
      let score;
      if (c === q) score = 1;
      else if (c.includes(q) || q.includes(c)) score = 0.8;
      else {
        const qt = q.split(/\s+/), ct = new Set(c.split(/\s+/));
        score = qt.filter(t => ct.has(t)).length / Math.max(qt.length, ct.size);
      }
      if (score > bestScore) { bestScore = score; best = p.i; }
    }
  }
  return bestScore >= 0.5 ? { index: best, score: bestScore } : null;
}

function hasCoverage(ctx, d0, d1) {
  const a = Math.max(d0, ctx.day0) - ctx.day0, b = Math.min(d1, ctx.day1) - ctx.day0;
  for (const arr of ctx.cover.values()) for (let d = a; d <= b; d++) if (arr[d]) return true;
  return false;
}

/* the one function the UI calls: a validated LLM answer -> { patch, chips, warnings }.
   patch is ready for actions.js setFilter(); chips are a preview, shown before the user applies it. */
export function toFilterPatch(st, parsed) {
  const ctx = st.ctx;
  const chips = [], warnings = [];
  const patch = { t0: null, t1: null, hours: null, dows: null, modes: null, place: null };

  if (parsed.unsupported) warnings.push(`Itinera can't answer "${parsed.unsupported}" yet – showing only what it could use from the question.`);

  if (parsed.date_from) {
    const d0 = dayFromISO(parsed.date_from), d1 = parsed.date_to ? dayFromISO(parsed.date_to) : d0;
    patch.t0 = dayToUtc(st, d0); patch.t1 = dayToUtc(st, d1 + 1);
    chips.push({ key: 'time', label: d0 === d1 ? fmtDay(d0) : `${fmtDayShort(d0)} – ${fmtDay(d1)}`, inferred: false });
    if (d1 < ctx.day0 || d0 > ctx.day1) warnings.push(`Your data runs from ${fmtDay(ctx.day0)} to ${fmtDay(ctx.day1)} – that's outside this range.`);
    else if (!hasCoverage(ctx, d0, d1)) warnings.push('No records for that period.');
  }

  const dows = resolveWeekdays(parsed.weekdays);
  if (dows) { patch.dows = dows; chips.push({ key: 'dows', label: [...dows].sort((a, b) => a - b).map(i => DOWS[i]).join(', '), inferred: false }); }

  if (parsed.intent) {
    const def = INTENTS[parsed.intent];
    if (def.weekend) {
      patch.dows = new Set([5, 6]);
      chips.push({ key: 'dows', label: 'Saturday, Sunday', inferred: true, note: 'Weekend, inferred from Monday-first weeks.' });
    } else {
      patch.hours = intentToHours(parsed.intent);
      chips.push({ key: 'hours', label: def.label, inferred: true, note: `"${parsed.intent}" isn't in your data – Itinera assumes ${def.label.replace(/\s*\(.*\)$/, '')}. Remove this chip and use the rhythm grid for your own hours.` });
    }
  } else if (parsed.hour_from != null) {
    const to = parsed.hour_to ?? (parsed.hour_from + 1) % 24;
    patch.hours = hourSet(parsed.hour_from, to);
    chips.push({ key: 'hours', label: `${String(parsed.hour_from).padStart(2, '0')}:00–${String(to).padStart(2, '0')}:00`, inferred: false });
  }

  if (parsed.modes?.length) { patch.modes = new Set(parsed.modes); chips.push({ key: 'modes', label: parsed.modes.map(m => MODES[MODE_IDX[m]].label).join(', '), inferred: false }); }

  if (parsed.place_query) {
    const m = matchPlace(ctx, parsed.place_query);
    if (m) { patch.place = m.index; chips.push({ key: 'place', label: `Trips to or from ${ctx.places[m.index].label}`, inferred: false }); }
    else warnings.push(`No place matched "${parsed.place_query}" – showing the time filter only.`);
  }

  return { patch, chips, warnings };
}


/* Stays that began before the hour window but were still going during it (an office day at lunch):
   the views match a stay by its start hour, so they show nothing for these, but they answer
   "where was I at lunch". Minutes are clipped to the date range and to the hours, in local time. */
function ongoingStays(st) {
  const f = st.filter, out = new Map();
  if (!f.hours) return [];
  for (const v of st.ctx.allV) {
    if (v.dup || f.hours.has(v.h) || !passes(st, v, 'rhythm', false)) continue;
    const a = Math.max(v.t0, f.t0 ?? -Infinity), b = Math.min(v.t1, f.t1 ?? Infinity), off = v.off * MIN;
    let mins = 0;
    for (let s = Math.floor((a + off) / HOUR) * HOUR, k = 0; s < b + off && k < 24 * 31; s += HOUR, k++) {
      if (f.dows && !f.dows.has((Math.floor(s / DAY) + 3) % 7)) continue;
      if (f.hours.has(Math.floor((s % DAY + DAY) % DAY / HOUR))) mins += Math.min(b + off, s + HOUR) - Math.max(a + off, s);
    }
    if (mins > 0) out.set(v.place, (out.get(v.place) || 0) + mins);
  }
  return [...out].sort((x, y) => y[1] - x[1]);
}

/* One plain-English line for the applied filter, built only from the already-computed aggregates
   (st.res) and the local data, so the model never sees the answer. Durations are clipped to the
   date range, not the hours, so "stays" means stays that began in the window. */
export function summarizeResult(st, chips) {
  const res = st.res, ctx = st.ctx;
  const head = chips.map(c => c.label).join(', ');
  const trips = res.T.filter(t => !t.dup);
  const n = (k, one, many = one + 's') => `${k.toLocaleString('en-GB')} ${k === 1 ? one : many}`;
  const names = (list, t) => list.slice(0, 3).map(x => `${ctx.places[x[0]].label} (${fmtDur(t(x))})`).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
  const parts = [];
  if (res.places.length) {
    const stays = res.places.reduce((a, p) => a + p.n, 0);
    parts.push(`${n(stays, 'stay')} started at ${n(res.places.length, 'place')} \u2013 ${names(res.places.map(p => [p.i, p.dur]), x => x[1])}.`);
  }
  if (trips.length) parts.push(`${n(trips.length, 'trip')}, ${fmtKm(res.kpi.dist)} km.`);
  const ongoing = ongoingStays(st);
  const earlier = ongoing.length === 1 ? 'a stay that began earlier' : 'stays that began earlier';
  if (ongoing.length && parts.length) parts.push(`Also at ${names(ongoing, x => x[1])}, in ${earlier}.`);
  if (ongoing.length && !parts.length) return `${head}: no stays or trips started in this window, but you were at ${names(ongoing, x => x[1])}, in ${earlier}.`;
  if (!parts.length) return `${head}: no stays or trips in this window.`;
  return `${head}: ${parts.join(' ')}`;
}
