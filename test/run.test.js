import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CASES } from '../src/cases.js';
import { runCases, verdict, hints } from '../src/run.js';
import { chat } from '../src/client.js';
import { normaliseBaseUrl } from '../src/server.js';
import { startMock } from './mock-server.js';

const BIN = fileURLToPath(new URL('../bin/toolcall-smoke.js', import.meta.url));
const single = CASES.filter((c) => c.id === 'single');
const opts = (baseUrl, model) => ({ baseUrl, model, temperature: 0, maxTokens: 64, timeoutMs: 5000 });

function cli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, NO_COLOR: '1' } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

test('streaming deltas are assembled into one tool call', async () => {
  const m = await startMock();
  try {
    const r = await chat({ baseUrl: m.baseUrl, body: { model: 'weather', stream: true, messages: [] } });
    assert.equal(r.toolCalls.length, 1);
    assert.equal(r.toolCalls[0].function.arguments, '{"city": "Paris"}');
    assert.equal(r.finishReason, 'tool_calls');
  } finally { await m.close(); }
});

test('duplicated streaming arguments are caught as BAD_JSON', async () => {
  const m = await startMock();
  try {
    const stream = [{ ...single[0], stream: true }];
    const res = await runCases(stream, opts(m.baseUrl, 'dup'));
    assert.equal(res[0].status, 'BAD_JSON');
  } finally { await m.close(); }
});

test('leaking server → LEAKING verdict with a fix hint', async () => {
  const m = await startMock();
  try {
    const res = await runCases(CASES.slice(0, 4), opts(m.baseUrl, 'leak'));
    assert.ok(res.every((r) => r.status === 'LEAK' || r.status === 'NO_CALL' || r.status === 'WRONG_VALUE'));
    assert.equal(verdict(res).level, 'LEAKING');
    assert.ok(hints(res, 'llama.cpp')[0].includes('--jinja'));
    assert.ok(hints(res, 'ollama')[0].includes('ollama show'));
  } finally { await m.close(); }
});

test('erroring server stops after 3 identical errors → NO_TOOLS', async () => {
  const m = await startMock();
  try {
    const res = await runCases(CASES, opts(m.baseUrl, 'error'));
    assert.equal(res.length, 3);
    assert.match(res.stopped, /17 request/);
    assert.equal(verdict(res).level, 'NO_TOOLS');
    assert.ok(!hints(res, 'llama.cpp').some((h) => h.includes('tool_choice')));
  } finally { await m.close(); }
});

test('CLI: table output, exit codes, --json, --only, model auto-pick', async () => {
  const m = await startMock();
  try {
    const ok = await cli(['-u', m.baseUrl, '--only', 'single,parallel']);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /single\s+one tool, one call\s+PASS/);
    assert.match(ok.stdout, /parallel\s+two calls in one turn\s+PARTIAL\*/);
    assert.match(ok.stdout, /2\/2 passed/);
    assert.match(ok.stderr, /using "weather"/);

    const leak = await cli(['-u', m.baseUrl, '-m', 'leak', '--only', 'single', '--json']);
    assert.equal(leak.code, 1);
    const j = JSON.parse(leak.stdout);
    assert.equal(j.verdict, 'LEAKING');
    assert.equal(j.results[0].status, 'LEAK');

    const under = await cli(['-u', m.baseUrl, '-m', 'weather', '--only', 'single,integer', '--fail-under', '90']);
    assert.equal(under.code, 1);

    const bad = await cli(['--only', 'nope']);
    assert.equal(bad.code, 2);
    const help = await cli(['--help']);
    assert.match(help.stdout, /Usage/);
    const down = await cli(['-u', 'http://127.0.0.1:9', '-m', 'x']);
    assert.notEqual(down.code, 0);
  } finally { await m.close(); }
});

test('base URL normalisation', () => {
  assert.equal(normaliseBaseUrl('localhost:11434'), 'http://localhost:11434/v1');
  assert.equal(normaliseBaseUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080/v1');
  assert.equal(normaliseBaseUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1');
});
