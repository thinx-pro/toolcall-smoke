import { chat } from './client.js';
import { grade, STATUS } from './grade.js';

export function buildBody(testCase, opts) {
  const body = {
    model: opts.model,
    messages: testCase.messages,
    tools: testCase.tools,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    stream: !!testCase.stream,
  };
  if (testCase.tool_choice) body.tool_choice = testCase.tool_choice;
  return { ...body, ...(opts.extra || {}) };
}

export async function runCases(cases, opts, onResult = () => {}) {
  const results = [];
  for (const c of cases) {
    for (let r = 0; r < (opts.repeat || 1); r++) {
      let response = null;
      let error = null;
      const t0 = Date.now();
      try {
        response = await chat({ baseUrl: opts.baseUrl, apiKey: opts.apiKey, body: buildBody(c, opts), timeoutMs: opts.timeoutMs });
      } catch (e) {
        error = e.name === 'TimeoutError' ? { message: `timeout after ${Math.round(opts.timeoutMs / 1000)}s` } : e;
      }
      const g = grade(c, response, error);
      const result = {
        id: c.id,
        title: c.title,
        soft: !!c.soft,
        run: r + 1,
        ms: response ? response.ms : Date.now() - t0,
        ...g,
        response: opts.keepRaw && response ? { content: response.content, toolCalls: response.toolCalls, finishReason: response.finishReason } : undefined,
      };
      results.push(result);
      onResult(result);
      // Same server error three times in a row from the start: the rest will fail the same way.
      if (!opts.noFailFast && results.length === 3 && results.every((x) => x.status === STATUS.ERROR && x.detail === result.detail)) {
        results.stopped = `stopped after 3 identical errors; ${cases.length * (opts.repeat || 1) - 3} request(s) not sent`;
        return results;
      }
    }
  }
  return results;
}

export function counts(results) {
  const by = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
  for (const r of results) by[r.status]++;
  const ok = results.filter((r) => r.status === STATUS.PASS || (r.soft && r.status === STATUS.PARTIAL)).length;
  return { total: results.length, ok, by, rate: results.length ? ok / results.length : 0 };
}

export function verdict(results) {
  const c = counts(results);
  if (!c.total) return { level: 'EMPTY', line: 'No cases ran.' };
  if (c.by.ERROR === c.total) {
    return { level: 'NO_TOOLS', line: 'Every request failed. The server or model does not accept the tools parameter as configured.' };
  }
  if (c.by.ERROR >= c.total / 2) {
    return { level: 'UNRELIABLE', line: `${c.by.ERROR} of ${c.total} requests failed with a server error.` };
  }
  if (c.by.LEAK > 0) {
    return {
      level: 'LEAKING',
      line: `${c.by.LEAK} tool call(s) came back as plain text in message.content with tool_calls empty. An agent loop will treat them as a final answer and stop.`,
    };
  }
  if (c.rate >= 0.9) return { level: 'READY', line: 'Structured tool calls work on these cases. The plumbing is fine; task quality is a separate question.' };
  if (c.rate >= 0.7) return { level: 'USABLE', line: 'Mostly works. Check the failing cases against the tools your agent actually uses.' };
  return { level: 'UNRELIABLE', line: 'Too many failed calls for unattended agent use.' };
}

// Server-specific advice, keyed by what went wrong.
export function hints(results, server) {
  const c = counts(results);
  const out = [];
  const leakOrNoTools = c.by.LEAK > 0 || c.by.ERROR === c.total || (c.by.NO_CALL >= Math.ceil(c.total / 2));
  if (leakOrNoTools) {
    if (server === 'llama.cpp') {
      out.push('llama-server: run with --jinja (default in recent builds; make sure --no-jinja is not set). If the model\'s embedded template has no tool section, pass one with --chat-template-file.');
    } else if (server === 'ollama') {
      out.push('Ollama: `ollama show <model>` must list "tools" under Capabilities. If it does not, the Modelfile TEMPLATE has no tools block: pick a tag that supports tools or update the template.');
    } else if (server === 'vllm') {
      out.push('vLLM: start with --enable-auto-tool-choice --tool-call-parser <parser for this model family> (e.g. hermes, llama3_json, mistral).');
    } else if (server === 'lmstudio') {
      out.push('LM Studio: the model needs the tool-use badge; otherwise the prompt template does not render tools. Update LM Studio or the model\'s template.');
    } else {
      out.push('Check that the server parses tool calls for this model family (chat template / tool-call parser), and that it is not just passing raw text through.');
    }
  }
  if (c.by.BAD_JSON) out.push('Unparseable arguments: try temperature 0, a larger max_tokens, or a server option that constrains tool-call output with a grammar / structured outputs.');
  if (c.by.BAD_ARGS) out.push('Schema violations (e.g. "15" instead of 15): coerce types in your tool layer or enable grammar-constrained tool calls if the server supports it.');
  const streamFail = results.find((r) => r.id === 'stream' && [STATUS.BAD_JSON, STATUS.LEAK, STATUS.NO_CALL, STATUS.ERROR].includes(r.status));
  const singleOk = results.find((r) => r.id === 'single' && r.status === STATUS.PASS);
  if (streamFail && singleOk) out.push('Non-streaming calls work but streaming does not: your harness may need stream:false for tool turns, or a newer server.');
  if (results.some((r) => r.warnings.some((w) => w.includes('no id')))) out.push('Tool calls without an id: some agent SDKs cannot attach the tool result. Generate ids client-side.');
  const choiceFail = (id) => results.some((r) => r.id === id && ![STATUS.PASS, STATUS.ERROR].includes(r.status));
  const ignored = [choiceFail('required') && '"required"', choiceFail('forced') && 'a named function'].filter(Boolean);
  if (ignored.length) {
    out.push(`tool_choice = ${ignored.join(' and ')} was not enforced: do not rely on it with this server + model; validate the tool name in your loop.`);
  }
  if (results.some((r) => r.status === STATUS.NO_CALL || r.status === STATUS.WRONG_VALUE) && results.some((r) => /empty/.test(r.detail))) {
    out.push('Some replies were empty: reasoning models can spend the whole max_tokens budget thinking. Raise --max-tokens or disable thinking via --extra.');
  }
  return out;
}
