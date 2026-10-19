// Best-effort guess of which runtime is behind an OpenAI-compatible URL.
// Only used to tailor the fix-it hints; never affects grading.

async function probe(url, ms = 1500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return null;
  }
}

export function normaliseBaseUrl(input) {
  let u = String(input || '').trim();
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  const url = new URL(u);
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/v1';
  return url.toString().replace(/\/+$/, '');
}

export async function detectServer(baseUrl) {
  const url = new URL(baseUrl);
  const origin = url.origin;
  const ollama = await probe(`${origin}/api/version`);
  if (ollama && typeof ollama === 'object' && ollama.version) return { name: 'ollama', version: ollama.version };
  const props = await probe(`${origin}/props`);
  if (props && typeof props === 'object' && ('default_generation_settings' in props || 'chat_template' in props)) {
    return { name: 'llama.cpp', version: props.build_info || '' };
  }
  const vllm = await probe(`${origin}/version`);
  if (vllm && typeof vllm === 'object' && vllm.version) return { name: 'vllm', version: vllm.version };
  if (url.port === '1234') return { name: 'lmstudio', version: '' };
  if (url.port === '11434') return { name: 'ollama', version: '' };
  return { name: 'unknown', version: '' };
}
