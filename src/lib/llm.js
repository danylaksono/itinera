/* The only file in the app that sends anything to a third party, and only when the user has
   opted in and supplied their own key (BYOK). It sends the question text and today's date -
   never location data - to the chosen provider, and asks for an answer in the fixed shape from
   lib/llmQuery.js. All providers are normalised to the same result: { ok: true, data } or
   { ok: false, reason, message }. The key is stored only in this browser's localStorage. */
import { schemaForPrompt, buildPrompt, validateFilterShape } from './llmQuery.js';

/* Each url must also be allowed in the CSP (vite.config.js connect-src). The OpenAI-format
   providers share one code path. structured 'schema' asks for strict JSON Schema output; 'tool'
   forces a function call, which is more widely supported across the many models OpenRouter fronts. */
const CONFIG = {
  anthropic: { label: 'Anthropic (Claude)', model: 'claude-haiku-4-5' },
  openai: { label: 'OpenAI', model: 'gpt-4o-mini', url: 'https://api.openai.com/v1/chat/completions', structured: 'schema' },
  openrouter: { label: 'OpenRouter', model: 'anthropic/claude-haiku-4.5', url: 'https://openrouter.ai/api/v1/chat/completions', structured: 'tool' }
};
export const PROVIDERS = Object.entries(CONFIG).map(([k, c]) => [k, c.label]);
export const DEFAULT_MODEL = Object.fromEntries(Object.entries(CONFIG).map(([k, c]) => [k, c.model]));

const KEY_PREFIX = 'itinera-llm-key-';
export function loadApiKey(provider) { try { return localStorage.getItem(KEY_PREFIX + provider) || ''; } catch (e) { return ''; } }
export function saveApiKey(provider, key) { try { if (key) localStorage.setItem(KEY_PREFIX + provider, key); else localStorage.removeItem(KEY_PREFIX + provider); } catch (e) { } }

function fail(reason, message) { const e = new Error(message); e.reason = reason; return e; }

export async function askLLM(provider, apiKey, model, question, todayISO) {
  if (!apiKey) return { ok: false, reason: 'auth', message: 'No API key is set.' };
  try {
    const parsed = provider === 'anthropic'
      ? await askAnthropic(apiKey, model, question, todayISO)
      : await askOpenAIFormat(CONFIG[provider], apiKey, model, question, todayISO);
    const v = validateFilterShape(parsed);
    return v.ok ? { ok: true, data: v.data } : { ok: false, reason: 'parse', message: v.error };
  } catch (e) {
    if (e.reason) return { ok: false, reason: e.reason, message: e.message };
    return {
      ok: false, reason: 'network',
      message: provider === 'anthropic'
        ? 'Could not reach the API. Check your connection and key.'
        : `${CONFIG[provider].label} didn't respond – it may have blocked this request from a browser. Try another provider, or check your key.`
    };
  }
}

async function askAnthropic(apiKey, model, question, todayISO) {
  const { system, user } = buildPrompt(question, todayISO);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // required for a direct browser call: the Messages API is otherwise locked to server use
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model, max_tokens: 512, system,
      messages: [{ role: 'user', content: user }],
      tools: [{ name: 'set_filter', description: 'Set the structured filter for the question.', input_schema: schemaForPrompt() }],
      tool_choice: { type: 'tool', name: 'set_filter' }
    })
  });
  if (res.status === 401 || res.status === 403) throw fail('auth', 'The API key was rejected.');
  if (res.status === 429) throw fail('rate_limit', 'Rate limited by Anthropic. Try again shortly.');
  if (!res.ok) throw fail('network', `Anthropic returned an error (${res.status}).`);
  const body = await res.json();
  const use = body.content?.find(c => c.type === 'tool_use');
  if (!use) throw fail('parse', 'Anthropic did not return a structured answer.');
  return use.input;
}

async function askOpenAIFormat(cfg, apiKey, model, question, todayISO) {
  const { system, user } = buildPrompt(question, todayISO);
  const schema = schemaForPrompt();
  const structure = cfg.structured === 'tool'
    ? {
      tools: [{ type: 'function', function: { name: 'set_filter', description: 'Set the structured filter for the question.', parameters: schema } }],
      tool_choice: { type: 'function', function: { name: 'set_filter' } }
    }
    : { response_format: { type: 'json_schema', json_schema: { name: 'filter', strict: true, schema } } };
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...structure })
  });
  if (res.status === 401 || res.status === 403) throw fail('auth', 'The API key was rejected.');
  if (res.status === 429) throw fail('rate_limit', `Rate limited by ${cfg.label}. Try again shortly.`);
  if (!res.ok) throw fail('network', `${cfg.label} returned an error (${res.status}).`);
  const msg = (await res.json()).choices?.[0]?.message;
  // a model that ignores the forced tool may still answer with JSON in the content
  const text = msg?.tool_calls?.[0]?.function?.arguments ?? msg?.content;
  if (!text) throw fail('parse', `${cfg.label} did not return a structured answer.`);
  try { return JSON.parse(text); } catch (e) { throw fail('parse', `${cfg.label}'s answer was not valid JSON.`); }
}
