// Grading: turn one normalised response into a status + detail + warnings.

export const STATUS = {
  PASS: 'PASS',
  LEAK: 'LEAK', // tool call written as text in message.content, tool_calls empty
  BAD_JSON: 'BAD_JSON', // tool_calls present, arguments not parseable
  BAD_ARGS: 'BAD_ARGS', // parseable but violates the JSON schema (type, required, enum)
  WRONG_VALUE: 'WRONG_VALUE', // schema-valid but the values are wrong / answer missing
  WRONG_TOOL: 'WRONG_TOOL',
  NO_CALL: 'NO_CALL', // expected a call, got plain text that does not look like a call
  EXTRA_CALL: 'EXTRA_CALL', // called a tool when it should have answered
  PARTIAL: 'PARTIAL', // some but not all expected calls
  ERROR: 'ERROR', // HTTP / timeout / server error
};

const TYPE_OK = {
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
};

const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v));

// Small JSON Schema subset: type, enum, properties, required, items.
export function validate(value, schema, path = '') {
  const errs = [];
  if (!schema) return errs;
  const at = path || 'arguments';
  if (schema.type && TYPE_OK[schema.type] && !TYPE_OK[schema.type](value)) {
    errs.push(`${at}: expected ${schema.type}, got ${show(value)}`);
    return errs;
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: ${show(value)} not in [${schema.enum.join(', ')}]`);
  if (TYPE_OK.object(value)) {
    for (const k of schema.required || []) {
      if (!(k in value)) errs.push(`${path ? path + '.' : ''}${k}: missing (required)`);
    }
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in value) errs.push(...validate(value[k], sub, path ? `${path}.${k}` : k));
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => errs.push(...validate(v, schema.items, `${at}[${i}]`)));
  }
  return errs;
}

export function stripThinking(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '') // template opened <think> in the prompt
    .trim();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Does plain-text content look like a tool call that the server failed to parse?
export function detectLeak(content, toolNames) {
  const c = stripThinking(content);
  if (!c) return null;
  const names = toolNames.map(esc).join('|') || '\\w+';
  const patterns = [
    [/<tool_call>/i, '<tool_call> tag'],
    [/<\|tool_call/i, '<|tool_call|> token'],
    [/\[TOOL_CALLS\]/, '[TOOL_CALLS] marker'],
    [/<\|python_tag\|>/, '<|python_tag|> token'],
    [/<function[=\s>]/i, '<function=...> tag'],
    [/<\|?(start|call)\|?>/i, 'channel/call token'],
    [new RegExp(`functions\\.(${names})\\b`), 'functions.<name> text'],
    [new RegExp(`"(name|function|tool|tool_name)"\\s*:\\s*"(${names})"`), 'JSON object naming a tool'],
    [new RegExp(`\\b(${names})\\s*\\(\\s*[\\w"'{]`), 'name(...) call syntax'],
  ];
  for (const [rx, label] of patterns) {
    const m = c.match(rx);
    if (m) return { label, snippet: snippetAround(c, m.index) };
  }
  return null;
}

function snippetAround(text, i) {
  const s = text.slice(Math.max(0, i - 10), i + 70).replace(/\s+/g, ' ');
  return (i > 10 ? '…' : '') + s + (i + 70 < text.length ? '…' : '');
}

function parseArgs(raw, warnings) {
  if (raw && typeof raw === 'object') {
    warnings.push('arguments is an object, not a JSON string (OpenAI clients expect a string)');
    return { ok: true, value: raw };
  }
  if (raw === undefined || raw === null || raw === '') {
    warnings.push('arguments is empty (expected "{}")');
    return { ok: true, value: {} };
  }
  try {
    const v = JSON.parse(raw);
    if (typeof v === 'string') {
      // Double-encoded: "{\"city\":\"Paris\"}"
      try {
        const inner = JSON.parse(v);
        warnings.push('arguments is double-encoded JSON');
        return { ok: true, value: inner };
      } catch { /* fall through */ }
    }
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: `${e.message}; raw=${String(raw).slice(0, 80)}` };
  }
}

export function grade(testCase, response, error) {
  const warnings = [];
  const out = (status, detail = '') => ({ status, detail, warnings });
  if (error) {
    let body = error.body || error.message || String(error);
    try {
      const j = JSON.parse(body);
      const m = (j.error && (j.error.message || j.error)) || j.message || j.detail;
      if (m) body = `${error.status ? error.status + ': ' : ''}${typeof m === 'string' ? m : JSON.stringify(m)}`;
    } catch { /* not JSON */ }
    return out(STATUS.ERROR, String(body).replace(/\s+/g, ' ').slice(0, 160));
  }

  const toolNames = testCase.tools.map((t) => t.function.name);
  const schemaOf = Object.fromEntries(testCase.tools.map((t) => [t.function.name, t.function.parameters]));
  const content = response.content || '';
  const calls = [];
  for (const tc of response.toolCalls || []) {
    const f = tc.function || {};
    if (!tc.id) warnings.push('tool call has no id (agent loops need it to send the result back)');
    const parsed = parseArgs(f.arguments, warnings);
    if (!parsed.ok) return out(STATUS.BAD_JSON, `${f.name}: ${parsed.error}`);
    calls.push({ name: f.name || '', args: parsed.value });
  }
  if (calls.length && response.finishReason && response.finishReason !== 'tool_calls') {
    warnings.push(`finish_reason is "${response.finishReason}", not "tool_calls"`);
  }

  const exp = testCase.expect;
  if (exp.none) {
    if (calls.length) return out(STATUS.EXTRA_CALL, `called ${calls.map((c) => c.name).join(', ')} instead of answering`);
    const leak = detectLeak(content, toolNames);
    if (leak) return out(STATUS.LEAK, `${leak.label}: ${leak.snippet}`);
    const answer = stripThinking(content);
    if (exp.content && !exp.content.test(answer)) {
      return out(STATUS.WRONG_VALUE, answer ? `answer lacks ${exp.content}: ${answer.slice(0, 60)}` : 'empty answer');
    }
    return out(STATUS.PASS);
  }

  if (!calls.length) {
    const leak = detectLeak(content, toolNames);
    if (leak) return out(STATUS.LEAK, `${leak.label}: ${leak.snippet}`);
    const text = stripThinking(content).replace(/\s+/g, ' ');
    return out(STATUS.NO_CALL, text ? `replied with text: ${text.slice(0, 70)}` : 'empty reply');
  }

  for (const c of calls) {
    if (!toolNames.includes(c.name)) return out(STATUS.WRONG_TOOL, `called unknown tool "${c.name}"`);
  }

  const used = new Set();
  const results = exp.calls.map((e) => {
    const cands = calls
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => !used.has(i) && (e.name === '*' || c.name === e.name))
      .map(({ c, i }) => {
        const schemaErrs = validate(c.args, schemaOf[c.name]);
        let valueOk = schemaErrs.length === 0;
        if (valueOk) { try { valueOk = !!e.check(c.args); } catch { valueOk = false; } }
        return { c, i, schemaErrs, valueOk };
      })
      .sort((a, b) => (b.valueOk - a.valueOk) || (a.schemaErrs.length - b.schemaErrs.length));
    if (!cands.length) return { missing: true, e };
    used.add(cands[0].i);
    return { ...cands[0], e };
  });

  const found = results.filter((r) => !r.missing);
  if (!found.length) {
    return out(STATUS.WRONG_TOOL, `expected ${exp.calls.map((e) => e.name).join(' + ')}, got ${calls.map((c) => c.name).join(', ')}`);
  }
  const bad = found.find((r) => r.schemaErrs.length);
  if (bad) return out(STATUS.BAD_ARGS, `${bad.c.name}: ${bad.schemaErrs[0]}`);
  const wrong = found.find((r) => !r.valueOk);
  if (wrong) {
    const got = `${wrong.c.name}(${JSON.stringify(wrong.c.args).slice(0, 100)})`;
    const why = typeof wrong.e.why === 'function' ? wrong.e.why(wrong.c.args) : wrong.e.why;
    return out(STATUS.WRONG_VALUE, why ? `${why}; got ${got}` : got);
  }
  if (found.length < results.length) {
    return out(STATUS.PARTIAL, `${found.length}/${results.length} expected calls in this turn`);
  }
  return out(STATUS.PASS);
}
