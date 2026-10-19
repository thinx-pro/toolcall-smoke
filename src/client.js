// Minimal OpenAI-compatible client: one chat/completions request, streaming or not.
// Returns a normalised { content, reasoning, toolCalls, finishReason, raw, ms } or throws HttpError.

export class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${String(body).slice(0, 300)}`);
    this.status = status;
    this.body = String(body);
  }
}

export function joinUrl(base, path) {
  return base.replace(/\/+$/, '') + path;
}

function headers(apiKey) {
  const h = { 'content-type': 'application/json' };
  if (apiKey) h.authorization = `Bearer ${apiKey}`;
  return h;
}

export async function listModels({ baseUrl, apiKey, timeoutMs = 10000 }) {
  const res = await fetch(joinUrl(baseUrl, '/models'), {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  const data = await res.json();
  return (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
}

export async function chat({ baseUrl, apiKey, body, timeoutMs = 120000 }) {
  const t0 = Date.now();
  const res = await fetch(joinUrl(baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  const out = body.stream ? await readStream(res) : normalise(await res.json());
  out.ms = Date.now() - t0;
  return out;
}

function normalise(data) {
  const choice = (data.choices && data.choices[0]) || {};
  const msg = choice.message || {};
  return {
    content: typeof msg.content === 'string' ? msg.content : '',
    reasoning: msg.reasoning_content || msg.reasoning || '',
    toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    finishReason: choice.finish_reason || '',
    raw: data,
  };
}

// Assemble SSE deltas the way an agent loop has to: concatenate content, and
// concatenate tool_calls[i].function.arguments by index.
export async function readStream(res) {
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  let finishReason = '';
  const calls = [];
  const chunks = [];
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let data;
    try { data = JSON.parse(payload); } catch { return; }
    chunks.push(data);
    const choice = (data.choices && data.choices[0]) || {};
    const d = choice.delta || {};
    if (typeof d.content === 'string') content += d.content;
    if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content;
    if (typeof d.reasoning === 'string') reasoning += d.reasoning;
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const i = Number.isInteger(tc.index) ? tc.index : calls.length;
        const slot = calls[i] || (calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) slot.id = tc.id;
        if (tc.type) slot.type = tc.type;
        if (tc.function && tc.function.name) slot.function.name += tc.function.name;
        if (tc.function && typeof tc.function.arguments === 'string') slot.function.arguments += tc.function.arguments;
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };
  for await (const part of res.body) {
    buf += decoder.decode(part, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, nl).replace(/\r$/, ''));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf) handle(buf);
  return { content, reasoning, toolCalls: calls.filter(Boolean), finishReason, raw: { chunks: chunks.length } };
}
