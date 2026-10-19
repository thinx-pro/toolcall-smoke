import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASES } from '../src/cases.js';
import { grade, detectLeak, validate, stripThinking } from '../src/grade.js';

const byId = (id) => CASES.find((c) => c.id === id);
const resp = (toolCalls = [], content = '', finishReason = toolCalls.length ? 'tool_calls' : 'stop') => ({ toolCalls, content, finishReason });
const tc = (name, args, id = 'call_1') => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });

test('case ids are unique and every case has tools + messages', () => {
  const ids = CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(CASES.length, 20);
  for (const c of CASES) {
    assert.ok(c.tools.length > 0, c.id);
    assert.ok(c.messages.length > 0, c.id);
    assert.ok(c.expect.none || c.expect.calls.length > 0, c.id);
  }
});

test('PASS on a correct structured call', () => {
  assert.equal(grade(byId('single'), resp([tc('get_weather', { city: 'Paris' })])).status, 'PASS');
});

test('LEAK when the call is written into content', () => {
  const g = grade(byId('single'), resp([], '<tool_call>{"name":"get_weather","arguments":{"city":"Paris"}}</tool_call>'));
  assert.equal(g.status, 'LEAK');
  assert.match(g.detail, /tool_call/);
});

test('LEAK for bare JSON naming the tool, and for name(...) syntax', () => {
  assert.equal(grade(byId('single'), resp([], '```json\n{"name": "get_weather", "parameters": {"city": "Paris"}}\n```')).status, 'LEAK');
  assert.equal(grade(byId('single'), resp([], 'get_weather(city="Paris")')).status, 'LEAK');
  assert.equal(grade(byId('single'), resp([], '[TOOL_CALLS][{"name":"get_weather"}]')).status, 'LEAK');
});

test('thinking that mentions the tool is not a leak', () => {
  const g = grade(byId('single'), resp([], '<think>I should call get_weather(city) maybe</think>I cannot check the weather.'));
  assert.equal(g.status, 'NO_CALL');
  assert.equal(stripThinking('<think>x</think> hi'), 'hi');
});

test('BAD_JSON on unparseable arguments', () => {
  assert.equal(grade(byId('single'), resp([tc('get_weather', '{"city": "Paris"')])).status, 'BAD_JSON');
  // the streaming duplication bug produces this shape
  assert.equal(grade(byId('single'), resp([tc('get_weather', '{"city":"Paris"}{"city":"Paris"}')])).status, 'BAD_JSON');
});

test('BAD_ARGS when an integer comes back as a string', () => {
  const g = grade(byId('integer'), resp([tc('set_timer', { minutes: '15' })]));
  assert.equal(g.status, 'BAD_ARGS');
  assert.match(g.detail, /expected integer/);
});

test('BAD_ARGS on missing required and on enum violations', () => {
  assert.equal(grade(byId('integer'), resp([tc('set_timer', { label: 'x' })])).status, 'BAD_ARGS');
  assert.equal(grade(byId('enum'), resp([tc('get_weather', { city: 'Chicago', unit: 'F' })])).status, 'BAD_ARGS');
});

test('WRONG_VALUE when schema-valid but wrong', () => {
  assert.equal(grade(byId('boolean'), resp([tc('toggle_light', { room: 'bedroom', on: false })])).status, 'WRONG_VALUE');
});

test('WRONG_TOOL, EXTRA_CALL, NO_CALL', () => {
  assert.equal(grade(byId('select'), resp([tc('set_timer', { minutes: 1 })])).status, 'WRONG_TOOL');
  assert.equal(grade(byId('no-call'), resp([tc('get_weather', { city: 'Tokyo' })])).status, 'EXTRA_CALL');
  assert.equal(grade(byId('single'), resp([], 'I do not have access to live weather.')).status, 'NO_CALL');
  assert.equal(grade(byId('single'), resp([tc('delete_everything', {})])).status, 'WRONG_TOOL');
});

test('no-call and after-result check the answer text', () => {
  assert.equal(grade(byId('no-call'), resp([], 'Tokyo')).status, 'PASS');
  assert.equal(grade(byId('no-call'), resp([], 'Kyoto')).status, 'WRONG_VALUE');
  assert.equal(grade(byId('after-result'), resp([], 'It is 18°C with light rain in Paris.')).status, 'PASS');
  assert.equal(grade(byId('after-result'), resp([], '')).status, 'WRONG_VALUE');
});

test('parallel: both calls PASS, one call PARTIAL (soft)', () => {
  const c = byId('parallel');
  assert.equal(grade(c, resp([tc('get_weather', { city: 'Paris' }, 'a'), tc('get_weather', { city: 'Tokyo' }, 'b')])).status, 'PASS');
  assert.equal(grade(c, resp([tc('get_weather', { city: 'Tokyo' }, 'b'), tc('get_weather', { city: 'Paris' }, 'a')])).status, 'PASS');
  assert.equal(grade(c, resp([tc('get_weather', { city: 'Paris' })])).status, 'PARTIAL');
});

test('required accepts any tool; forced needs the named one', () => {
  assert.equal(grade(byId('required'), resp([tc('get_weather', { city: 'X' })])).status, 'PASS');
  assert.equal(grade(byId('forced'), resp([tc('get_weather', { city: 'Rome' })])).status, 'WRONG_TOOL');
});

test('nested, array, escaping and unicode checks', () => {
  assert.equal(grade(byId('nested'), resp([tc('create_event', {
    title: 'Design review', start: { date: '2026-11-03', time: '14:30' }, attendees: ['ana@example.com', 'li@example.com'],
  })])).status, 'PASS');
  assert.equal(grade(byId('nested'), resp([tc('create_event', {
    title: 'Design review', start: '2026-11-03 14:30', attendees: ['ana@example.com', 'li@example.com'],
  })])).status, 'BAD_ARGS');
  assert.equal(grade(byId('array'), resp([tc('add_tags', { item_id: 'A-42', tags: 'urgent,billing,q4' })])).status, 'BAD_ARGS');
  assert.equal(grade(byId('escaping'), resp([tc('write_file', { path: 'notes.txt', content: 'He said "hi"\nthen he left.' })])).status, 'PASS');
  const lit = grade(byId('escaping'), resp([tc('write_file', { path: 'notes.txt', content: 'He said "hi"\\n then he left.' })]));
  assert.equal(lit.status, 'WRONG_VALUE');
  assert.match(lit.detail, /^wrote a literal backslash-n/);
  assert.equal(grade(byId('unicode'), resp([tc('send_email', { to: 'wang@example.com', subject: '会议改期', body: '会议改到明天下午三点。' })])).status, 'PASS');
});

test('warnings: missing id, object arguments, empty arguments, finish_reason', () => {
  const g = grade(byId('no-args'), { toolCalls: [{ type: 'function', function: { name: 'get_time', arguments: '' } }], content: '', finishReason: 'stop' });
  assert.equal(g.status, 'PASS');
  assert.ok(g.warnings.some((w) => /no id/.test(w)));
  assert.ok(g.warnings.some((w) => /empty/.test(w)));
  assert.ok(g.warnings.some((w) => /finish_reason/.test(w)));
  const g2 = grade(byId('single'), resp([{ id: 'x', type: 'function', function: { name: 'get_weather', arguments: { city: 'Paris' } } }]));
  assert.equal(g2.status, 'PASS');
  assert.ok(g2.warnings.some((w) => /object/.test(w)));
});

test('double-encoded arguments are accepted with a warning', () => {
  const g = grade(byId('single'), resp([tc('get_weather', JSON.stringify(JSON.stringify({ city: 'Paris' })))]));
  assert.equal(g.status, 'PASS');
  assert.ok(g.warnings.some((w) => /double-encoded/.test(w)));
});

test('ERROR extracts the server message', () => {
  const g = grade(byId('single'), null, { status: 500, body: '{"error":{"code":500,"message":"tools param requires --jinja flag"}}' });
  assert.equal(g.status, 'ERROR');
  assert.equal(g.detail, '500: tools param requires --jinja flag');
});

test('validate and detectLeak edge cases', () => {
  assert.deepEqual(validate({ a: 1 }, { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] }), []);
  assert.equal(validate(1.5, { type: 'integer' }).length, 1);
  assert.equal(detectLeak('The weather in Paris is nice.', ['get_weather']), null);
  assert.equal(detectLeak('', ['get_weather']), null);
});
