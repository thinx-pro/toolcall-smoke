// Render real CLI output to assets/<name>.html for a headless-Chrome screenshot.
// Usage: node scripts/screenshot.js <name> -- <toolcall-smoke args...>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [name, sep, ...args] = process.argv.slice(2);
if (!name || sep !== '--') {
  console.error('usage: node scripts/screenshot.js <name> -- <args...>');
  process.exit(2);
}
const bin = fileURLToPath(new URL('../bin/toolcall-smoke.js', import.meta.url));
let out;
try {
  out = execFileSync(process.execPath, [bin, ...args], { env: { ...process.env, FORCE_COLOR: '1' }, encoding: 'utf8' });
} catch (e) {
  out = e.stdout; // non-zero exit is expected for failing configs
}
const COLORS = { 31: '#ff6b6b', 32: '#5af78e', 33: '#f3f99d', 34: '#57c7ff', 35: '#ff6ac1', 36: '#9aedfe' };
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let html = '';
let open = 0;
for (const part of out.split(/(\x1b\[[0-9;]*m)/)) {
  const m = part.match(/^\x1b\[([0-9;]*)m$/);
  if (!m) { html += escHtml(part); continue; }
  const code = Number(m[1]);
  if (code === 0) { html += '</span>'.repeat(open); open = 0; continue; }
  const style = code === 1 ? 'font-weight:700' : code === 2 ? 'opacity:.55' : code === 7 ? 'filter:invert(1)' : COLORS[code] ? `color:${COLORS[code]}` : '';
  html += `<span style="${style}">`;
  open++;
}
html += '</span>'.repeat(open);
const shown = args.map((a) => (/[{}" ]/.test(a) ? `'${a}'` : a));
const cmd = `$ npx github:thinx-pro/toolcall-smoke ${shown.join(' ')}`;
const page = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;}
.win{margin:24px;border-radius:10px;background:#161b22;box-shadow:0 8px 30px rgba(0,0,0,.5);overflow:hidden;width:max-content}
.bar{height:30px;background:#21262d;display:flex;align-items:center;padding-left:12px;gap:8px}
.bar i{width:12px;height:12px;border-radius:50%;display:inline-block}
pre{margin:0;padding:16px 20px 20px;color:#e6edf3;font:13px/1.5 "SF Mono",Menlo,Consolas,monospace;white-space:pre}
.cmd{color:#8b949e}
</style><div class="win"><div class="bar"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i></div><pre><span class="cmd">${escHtml(cmd)}</span>
${html}</pre></div>`;
const file = fileURLToPath(new URL(`../assets/${name}.html`, import.meta.url));
writeFileSync(file, page);
console.log(file);
