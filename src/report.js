import { counts, verdict, hints } from './run.js';

const useColor = () => !process.env.NO_COLOR && (process.env.FORCE_COLOR || process.stdout.isTTY);
const paint = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'), yellow: paint('33'),
  blue: paint('34'), magenta: paint('35'), cyan: paint('36'), inverse: paint('7'),
};

const STATUS_COLOR = {
  PASS: c.green, PARTIAL: c.yellow, WRONG_VALUE: c.yellow, BAD_ARGS: c.yellow, NO_CALL: c.yellow,
  EXTRA_CALL: c.yellow, WRONG_TOOL: c.red, BAD_JSON: c.red, LEAK: c.magenta, ERROR: c.red,
};
const VERDICT_COLOR = { READY: c.green, USABLE: c.yellow, UNRELIABLE: c.red, LEAKING: c.magenta, NO_TOOLS: c.red, EMPTY: c.dim };

const pad = (s, n) => {
  const len = [...String(s)].length;
  return len >= n ? String(s) : String(s) + ' '.repeat(n - len);
};
const cut = (s, n) => ([...String(s)].length > n ? [...String(s)].slice(0, n - 1).join('') + '…' : String(s));

export function header({ baseUrl, model, server }) {
  const srv = server.name === 'unknown' ? 'unknown server' : `${server.name}${server.version ? ' ' + server.version : ''}`;
  return `${c.bold('toolcall-smoke')} ${c.dim('·')} ${c.cyan(model)} ${c.dim('@')} ${baseUrl} ${c.dim(`(${srv})`)}\n`;
}

export function line(r, repeat) {
  const colour = STATUS_COLOR[r.status] || ((s) => s);
  const id = repeat > 1 ? `${r.id}#${r.run}` : r.id;
  const status = r.soft && r.status === 'PARTIAL' ? 'PARTIAL*' : r.status;
  const ms = `${(r.ms / 1000).toFixed(1)}s`;
  const detail = r.detail ? c.dim(cut(r.detail, 78)) : '';
  const warn = r.warnings.length ? c.yellow(` ⚠ ${r.warnings.length}`) : '';
  return `  ${pad(id, repeat > 1 ? 15 : 13)}${pad(cut(r.title, 40), 41)} ${colour(pad(status, 11))} ${c.dim(pad(ms, 6))} ${detail}${warn}`;
}

export function summary(results, server) {
  const k = counts(results);
  const v = verdict(results);
  const pct = Math.round(k.rate * 100);
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] / 1000 : 0;
  const parts = ['LEAK', 'BAD_JSON', 'BAD_ARGS', 'WRONG_VALUE', 'WRONG_TOOL', 'NO_CALL', 'EXTRA_CALL', 'PARTIAL', 'ERROR']
    .filter((s) => k.by[s]).map((s) => `${s} ${k.by[s]}`);
  const out = [];
  out.push('');
  out.push(`  ${c.bold(`${k.ok}/${k.total} passed (${pct}%)`)}${parts.length ? c.dim('  ·  ' + parts.join('  ')) : ''}${c.dim(`  ·  median ${median.toFixed(1)}s`)}`);
  out.push(`  ${(VERDICT_COLOR[v.level] || ((s) => s))(c.bold(` ${v.level} `))} ${v.line}`);
  if (results.stopped) out.push(c.dim(`  (${results.stopped}; pass --no-fail-fast to send them anyway)`));
  const warnSet = [...new Set(results.flatMap((r) => r.warnings))];
  if (warnSet.length) {
    out.push('');
    out.push(`  ${c.yellow('warnings')}`);
    for (const w of warnSet.slice(0, 6)) out.push(`  ${c.dim('·')} ${w}`);
  }
  const h = hints(results, server.name);
  if (h.length) {
    out.push('');
    out.push(`  ${c.cyan('how to fix')}`);
    for (const x of h) out.push(`  ${c.dim('→')} ${x}`);
  }
  if (results.some((r) => r.soft && r.status === 'PARTIAL')) {
    out.push('');
    out.push(c.dim('  * PARTIAL on "parallel" counts as a pass: one call per turn still works in a sequential agent loop.'));
  }
  return out.join('\n') + '\n';
}

export function markdown(results, meta) {
  const k = counts(results);
  const v = verdict(results);
  const rows = results.map((r) => `| \`${r.id}\` | ${r.title} | **${r.status}** | ${(r.ms / 1000).toFixed(1)}s | ${String(r.detail || '').replace(/\|/g, '\\|')} |`);
  return [
    `# toolcall-smoke: ${meta.model}`,
    '',
    `- Endpoint: \`${meta.baseUrl}\` (${meta.server.name}${meta.server.version ? ' ' + meta.server.version : ''})`,
    `- Date: ${new Date().toISOString().slice(0, 10)} · temperature ${meta.temperature} · max_tokens ${meta.maxTokens}${meta.extra ? ' · extra `' + JSON.stringify(meta.extra) + '`' : ''}`,
    `- Result: **${k.ok}/${k.total} (${Math.round(k.rate * 100)}%)** · verdict **${v.level}**: ${v.line}`,
    '',
    '| case | what it checks | status | time | detail |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    ...hints(results, meta.server.name).map((h) => `- ${h}`),
    '',
  ].join('\n');
}
