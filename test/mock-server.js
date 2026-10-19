// A tiny fake OpenAI-compatible server. Behaviour is picked by the model name:
//   leak    – tool call written as <tool_call> text in content
//   error   – HTTP 500 "tools param requires --jinja flag"
//   weather – structured get_weather(city=Paris) for every request (streams in pieces when asked)
//   dup     – streaming bug: every chunk repeats the full arguments
import http from 'node:http';

const WEATHER_ARGS = '{"city": "Paris"}';

function completion(message, finish = 'stop') {
  return { id: 'x', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }] };
}

function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const ch of chunks) res.write(`data: ${JSON.stringify(ch)}\n\n`);
  res.end('data: [DONE]\n\n');
}

const delta = (d, finish = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

export function startMock() {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'weather' }, { id: 'leak' }] }));
      return;
    }
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (b.model === 'error') return json(500, { error: { code: 500, message: 'tools param requires --jinja flag' } });
      if (b.model === 'leak') {
        return json(200, completion({ role: 'assistant', content: '<tool_call>\n{"name": "get_weather", "arguments": {"city": "Paris"}}\n</tool_call>' }));
      }
      if (b.model === 'dup' && b.stream) {
        return sse(res, [
          delta({ role: 'assistant', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'get_weather', arguments: WEATHER_ARGS } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: WEATHER_ARGS } }] }, 'tool_calls'),
        ]);
      }
      if (b.stream) {
        const parts = ['{"ci', 'ty": "Pa', 'ris"}'];
        return sse(res, [
          delta({ role: 'assistant', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '' } }] }),
          ...parts.map((p) => delta({ tool_calls: [{ index: 0, function: { arguments: p } }] })),
          delta({}, 'tool_calls'),
        ]);
      }
      return json(200, completion({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: WEATHER_ARGS } }],
      }, 'tool_calls'));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ baseUrl: `http://127.0.0.1:${port}/v1`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
