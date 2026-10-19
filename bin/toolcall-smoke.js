#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { CASES } from '../src/cases.js';
import { listModels } from '../src/client.js';
import { runCases, counts, verdict } from '../src/run.js';
import { detectServer, normaliseBaseUrl } from '../src/server.js';
import { header, line, summary, markdown, c } from '../src/report.js';

const VERSION = '0.1.0';

const HELP = `toolcall-smoke ${VERSION}
Does this local model actually produce structured tool calls through this server?
20 small cases against any OpenAI-compatible endpoint (Ollama, llama.cpp, LM Studio, vLLM, MLX, ...).

Usage
  npx github:thinx-pro/toolcall-smoke [options]

Options
  -u, --base-url URL     OpenAI-compatible base URL (default: $OPENAI_BASE_URL or http://localhost:11434/v1)
                         A bare host:port gets /v1 appended.
  -m, --model NAME       Model id (default: first model listed by GET /models)
  -k, --api-key KEY      Bearer token (default: $OPENAI_API_KEY; local servers usually need none)
      --only a,b         Run only these case ids
      --skip a,b         Skip these case ids
      --repeat N         Run every case N times (default 1)
      --temperature T    Sampling temperature (default 0)
      --max-tokens N     max_tokens per request (default 1024)
      --extra JSON       Merge extra fields into every request body,
                         e.g. '{"chat_template_kwargs":{"enable_thinking":false}}'
      --timeout S        Per-request timeout in seconds (default 120)
      --fail-under PCT   Exit 1 if the pass rate is below PCT (default: exit 1 only on LEAKING / NO_TOOLS)
      --json             Print results as JSON (no table)
      --md FILE          Also write a Markdown report to FILE
      --raw              Include raw content / tool_calls in --json output
      --list             List the cases and exit
      --no-fail-fast     Keep going after 3 identical server errors at the start
  -h, --help             Show this help
  -v, --version          Show version

Statuses
  PASS         structured tool_calls with the right tool and values
  LEAK         the call came back as text in message.content, tool_calls empty
  BAD_JSON     tool_calls present but arguments do not parse
  BAD_ARGS     arguments parse but break the schema ("15" for an integer, missing required, bad enum)
  WRONG_VALUE  schema-valid but wrong values, or the expected answer is missing
  WRONG_TOOL   called a different tool
  NO_CALL      answered in text that does not look like a call
  EXTRA_CALL   called a tool when it should have answered
  PARTIAL      some but not all expected calls (parallel case)
  ERROR        HTTP error or timeout
`;

function parseArgs(argv) {
  const o = {
    baseUrl: process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1',
    model: '',
    apiKey: process.env.OPENAI_API_KEY || '',
    repeat: 1,
    temperature: 0,
    maxTokens: 1024,
    timeoutMs: 120000,
    extra: null,
    only: null,
    skip: null,
    json: false,
    md: '',
    raw: false,
    failUnder: null,
  };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, null];
    const val = () => (inline !== null ? inline : need(i++, flag));
    switch (flag) {
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      case '-u': case '--base-url': o.baseUrl = val(); break;
      case '-m': case '--model': o.model = val(); break;
      case '-k': case '--api-key': o.apiKey = val(); break;
      case '--only': o.only = val().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--skip': o.skip = val().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--repeat': o.repeat = Math.max(1, parseInt(val(), 10) || 1); break;
      case '--temperature': o.temperature = Number(val()); break;
      case '--max-tokens': o.maxTokens = parseInt(val(), 10); break;
      case '--timeout': o.timeoutMs = Number(val()) * 1000; break;
      case '--extra': o.extra = JSON.parse(val()); break;
      case '--fail-under': o.failUnder = Number(val()); break;
      case '--json': o.json = true; break;
      case '--md': o.md = val(); break;
      case '--raw': o.raw = true; break;
      case '--list': o.list = true; break;
      case '--no-fail-fast': o.noFailFast = true; break;
      default: throw new Error(`unknown option: ${a} (see --help)`);
    }
  }
  return o;
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`toolcall-smoke: ${e.message}`);
    process.exit(2);
  }
  if (o.help) { process.stdout.write(HELP); return; }
  if (o.version) { console.log(VERSION); return; }
  if (o.list) {
    for (const t of CASES) console.log(`${t.id.padEnd(13)} ${t.title}${t.stream ? ' [stream]' : ''}${t.soft ? ' [soft]' : ''}`);
    return;
  }

  let cases = CASES;
  if (o.only) {
    const unknown = o.only.filter((id) => !CASES.some((t) => t.id === id));
    if (unknown.length) { console.error(`toolcall-smoke: unknown case id(s): ${unknown.join(', ')} (see --list)`); process.exit(2); }
    cases = cases.filter((t) => o.only.includes(t.id));
  }
  if (o.skip) cases = cases.filter((t) => !o.skip.includes(t.id));

  o.baseUrl = normaliseBaseUrl(o.baseUrl);
  const server = await detectServer(o.baseUrl);
  if (!o.model) {
    try {
      const models = await listModels(o);
      if (!models.length) throw new Error('GET /models returned no models');
      o.model = models[0];
      if (models.length > 1 && !o.json) console.error(c.dim(`no --model given; using "${o.model}" (${models.length} available)`));
    } catch (e) {
      console.error(`toolcall-smoke: cannot reach ${o.baseUrl} (${e.cause?.code || e.message}). Is the server running? Pass --base-url and --model.`);
      process.exit(2);
    }
  }
  o.keepRaw = o.raw;

  if (!o.json) process.stdout.write(header({ ...o, server }));
  const results = await runCases(cases, o, (r) => { if (!o.json) console.log(line(r, o.repeat)); });

  const k = counts(results);
  const v = verdict(results);
  if (o.json) {
    console.log(JSON.stringify({
      tool: 'toolcall-smoke', version: VERSION, baseUrl: o.baseUrl, model: o.model, server,
      settings: { temperature: o.temperature, maxTokens: o.maxTokens, repeat: o.repeat, extra: o.extra },
      passed: k.ok, total: k.total, rate: k.rate, counts: k.by, verdict: v.level, results,
    }, null, 2));
  } else {
    process.stdout.write(summary(results, server));
  }
  if (o.md) {
    writeFileSync(o.md, markdown(results, { ...o, server }));
    if (!o.json) console.log(c.dim(`\n  markdown report → ${o.md}`));
  }

  const failed = o.failUnder !== null ? k.rate * 100 < o.failUnder : ['LEAKING', 'NO_TOOLS'].includes(v.level);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(`toolcall-smoke: ${e.stack || e.message}`);
  process.exit(2);
});
