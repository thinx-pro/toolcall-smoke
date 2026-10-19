// The test cases. Each one is a single chat/completions request plus an expectation.
// Expectations are deliberately strict about structure and lenient about wording.

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required },
  },
});

export const TOOLS = {
  get_weather: fn('get_weather', 'Get the current weather for a city.', {
    city: { type: 'string', description: 'City name, e.g. "Paris"' },
    unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Temperature unit' },
  }, ['city']),
  search_web: fn('search_web', 'Search the web and return the top results.', {
    query: { type: 'string' },
    limit: { type: 'integer', description: 'Maximum number of results (default 10)' },
  }, ['query']),
  send_email: fn('send_email', 'Send an email.', {
    to: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
  }, ['to', 'subject', 'body']),
  set_timer: fn('set_timer', 'Start a countdown timer.', {
    minutes: { type: 'integer', description: 'Duration in whole minutes' },
    label: { type: 'string' },
  }, ['minutes']),
  toggle_light: fn('toggle_light', 'Turn a light on or off.', {
    room: { type: 'string' },
    on: { type: 'boolean', description: 'true = on, false = off' },
  }, ['room', 'on']),
  create_event: fn('create_event', 'Create a calendar event.', {
    title: { type: 'string' },
    start: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM, 24h' },
      },
      required: ['date', 'time'],
    },
    attendees: { type: 'array', items: { type: 'string' }, description: 'Email addresses' },
  }, ['title', 'start']),
  add_tags: fn('add_tags', 'Add tags to an item.', {
    item_id: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  }, ['item_id', 'tags']),
  write_file: fn('write_file', 'Write text to a file, replacing its contents.', {
    path: { type: 'string' },
    content: { type: 'string' },
  }, ['path', 'content']),
  get_time: fn('get_time', 'Get the current local time. Takes no arguments.'),
  lookup_order: fn('lookup_order', 'Look up an order by id.', {
    order_id: { type: 'string' },
  }, ['order_id']),
  refund_order: fn('refund_order', 'Refund an order.', {
    order_id: { type: 'string' },
    amount: { type: 'number', description: 'Amount in dollars' },
  }, ['order_id', 'amount']),
  // Distractors for the "many tools" case.
  list_files: fn('list_files', 'List files in a directory.', { dir: { type: 'string' } }, ['dir']),
  read_file: fn('read_file', 'Read a text file.', { path: { type: 'string' } }, ['path']),
  translate: fn('translate', 'Translate text.', { text: { type: 'string' }, target: { type: 'string' } }, ['text', 'target']),
  calculator: fn('calculator', 'Evaluate an arithmetic expression.', { expression: { type: 'string' } }, ['expression']),
  cancel_order: fn('cancel_order', 'Cancel an order that has not shipped.', { order_id: { type: 'string' } }, ['order_id']),
  track_package: fn('track_package', 'Track a shipment.', { tracking_number: { type: 'string' } }, ['tracking_number']),
};

const T = (...names) => names.map((n) => TOOLS[n]);
const str = (v) => (typeof v === 'string' ? v : '');
const sameId = (v, id) => String(v ?? '').replace(/^#/, '').trim() === id;

// call(name, check, why) – one expected tool call. check(args) returns true when the values are right;
// why is a string or a function of args explaining a failed check.
const call = (name, check = () => true, why = '') => ({ name, check, why });

export const CASES = [
  {
    id: 'single',
    title: 'one tool, one call',
    tools: T('get_weather'),
    messages: [{ role: 'user', content: "What's the weather in Paris right now?" }],
    expect: { calls: [call('get_weather', (a) => /paris/i.test(str(a.city)), 'city should be Paris')] },
  },
  {
    id: 'select',
    title: 'picks the right tool out of 5',
    tools: T('get_weather', 'search_web', 'send_email', 'set_timer', 'toggle_light'),
    messages: [{ role: 'user', content: 'Turn off the lights in the kitchen.' }],
    expect: { calls: [call('toggle_light', (a) => /kitchen/i.test(str(a.room)) && a.on === false, 'room=kitchen, on=false')] },
  },
  {
    id: 'no-call',
    title: 'answers directly when no tool fits',
    tools: T('get_weather', 'set_timer'),
    messages: [{ role: 'user', content: 'What is the capital of Japan? Answer in one word.' }],
    expect: { none: true, content: /tokyo/i },
  },
  {
    id: 'integer',
    title: 'integer argument',
    tools: T('set_timer'),
    messages: [{ role: 'user', content: 'Set a timer for 15 minutes.' }],
    expect: { calls: [call('set_timer', (a) => a.minutes === 15, 'minutes must be the integer 15, not "15"')] },
  },
  {
    id: 'enum',
    title: 'enum argument',
    tools: T('get_weather'),
    messages: [{ role: 'user', content: 'Weather in Chicago, in fahrenheit please.' }],
    expect: { calls: [call('get_weather', (a) => /chicago/i.test(str(a.city)) && a.unit === 'fahrenheit', 'unit=fahrenheit')] },
  },
  {
    id: 'boolean',
    title: 'boolean argument',
    tools: T('toggle_light'),
    messages: [{ role: 'user', content: 'Switch on the bedroom light.' }],
    expect: { calls: [call('toggle_light', (a) => /bedroom/i.test(str(a.room)) && a.on === true, 'on must be the boolean true')] },
  },
  {
    id: 'nested',
    title: 'nested object + array arguments',
    tools: T('create_event'),
    messages: [{
      role: 'user',
      content: 'Create an event called "Design review" on 2026-11-03 at 14:30 with ana@example.com and li@example.com.',
    }],
    expect: {
      calls: [call('create_event', (a) => /design review/i.test(str(a.title))
        && a.start && a.start.date === '2026-11-03' && str(a.start.time).startsWith('14:30')
        && Array.isArray(a.attendees) && a.attendees.length === 2, 'start.{date,time} object + 2 attendees')],
    },
  },
  {
    id: 'array',
    title: 'array of strings',
    tools: T('add_tags'),
    messages: [{ role: 'user', content: 'Tag item A-42 with "urgent", "billing" and "q4".' }],
    expect: {
      calls: [call('add_tags', (a) => sameId(a.item_id, 'A-42') && Array.isArray(a.tags)
        && ['urgent', 'billing', 'q4'].every((t) => a.tags.map((x) => str(x).toLowerCase()).includes(t)), 'tags must be an array of 3 strings')],
    },
  },
  {
    id: 'escaping',
    title: 'quotes and newlines inside a string',
    tools: T('write_file'),
    messages: [{
      role: 'user',
      content: 'Write a file named notes.txt whose content is two lines. Line 1: He said "hi" Line 2: then he left.',
    }],
    expect: {
      calls: [call('write_file', (a) => /notes\.txt$/.test(str(a.path)) && str(a.content).includes('"hi"')
        && /\n/.test(str(a.content)), (a) => (!/\n/.test(str(a.content)) && /\\n/.test(str(a.content))
        ? 'wrote a literal backslash-n instead of a newline'
        : 'content needs the "hi" quotes and a real newline'))],
    },
  },
  {
    id: 'unicode',
    title: 'non-ASCII arguments',
    tools: T('send_email'),
    messages: [{
      role: 'user',
      content: 'Email wang@example.com. Subject: 会议改期. Body: 会议改到明天下午三点。',
    }],
    expect: {
      calls: [call('send_email', (a) => /wang@example\.com/i.test(str(a.to)) && str(a.subject).includes('会议')
        && str(a.body).includes('三点'), 'Chinese text must survive intact')],
    },
  },
  {
    id: 'no-args',
    title: 'tool with no parameters',
    tools: T('get_time', 'get_weather'),
    messages: [{ role: 'user', content: 'What time is it right now? Check with the tool.' }],
    expect: { calls: [call('get_time', () => true)] },
  },
  {
    id: 'optional',
    title: 'optional argument used when asked',
    tools: T('search_web'),
    messages: [{ role: 'user', content: 'Search the web for "llama.cpp tool calling", top 3 results only.' }],
    expect: {
      calls: [call('search_web', (a) => /llama\.cpp/i.test(str(a.query)) && a.limit === 3, 'limit must be the integer 3')],
    },
  },
  {
    id: 'parallel',
    title: 'two calls in one turn',
    soft: true,
    tools: T('get_weather'),
    messages: [{ role: 'user', content: 'What is the weather in Paris and in Tokyo? Check both.' }],
    expect: {
      calls: [
        call('get_weather', (a) => /paris/i.test(str(a.city))),
        call('get_weather', (a) => /tokyo/i.test(str(a.city))),
      ],
    },
  },
  {
    id: 'many-tools',
    title: 'picks the right tool out of 16',
    tools: T('get_weather', 'search_web', 'send_email', 'set_timer', 'toggle_light', 'create_event', 'add_tags',
      'write_file', 'list_files', 'read_file', 'translate', 'calculator', 'lookup_order', 'cancel_order',
      'track_package', 'refund_order'),
    messages: [{ role: 'user', content: 'Refund order 8812 for 19.99 dollars.' }],
    expect: {
      calls: [call('refund_order', (a) => sameId(a.order_id, '8812') && Number(a.amount) === 19.99
        && typeof a.amount === 'number', 'order_id=8812, amount=19.99 as a number')],
    },
  },
  {
    id: 'after-result',
    title: 'uses a tool result instead of calling again',
    tools: T('get_weather'),
    messages: [
      { role: 'user', content: "What's the weather in Paris?" },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_w1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_w1', content: '{"city":"Paris","temp_c":18,"sky":"light rain"}' },
    ],
    expect: { none: true, content: /18/ },
  },
  {
    id: 'chain',
    title: 'second step of a multi-step task',
    tools: T('lookup_order', 'refund_order', 'cancel_order'),
    messages: [
      { role: 'user', content: 'Look up order 5521. If it arrived damaged, refund the full amount.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_o1', type: 'function', function: { name: 'lookup_order', arguments: '{"order_id":"5521"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_o1', content: '{"order_id":"5521","status":"delivered","condition":"damaged","total":42.5}' },
    ],
    expect: {
      calls: [call('refund_order', (a) => sameId(a.order_id, '5521') && Number(a.amount) === 42.5, 'order_id=5521, amount=42.5')],
    },
  },
  {
    id: 'required',
    title: 'honours tool_choice: "required"',
    tools: T('get_time', 'get_weather'),
    tool_choice: 'required',
    messages: [{ role: 'user', content: 'Hello there!' }],
    expect: { calls: [call('*')] },
  },
  {
    id: 'forced',
    title: 'honours tool_choice for a named function',
    tools: T('get_time', 'get_weather'),
    tool_choice: { type: 'function', function: { name: 'get_time' } },
    messages: [{ role: 'user', content: 'What is the weather in Rome?' }],
    expect: { calls: [call('get_time')] },
  },
  {
    id: 'system',
    title: 'follows a system prompt that mandates tools',
    tools: T('toggle_light', 'set_timer'),
    messages: [
      { role: 'system', content: 'You are a home assistant. Always use the tools to control devices; never just describe what you would do.' },
      { role: 'user', content: 'Lights off in the garage, please.' },
    ],
    expect: { calls: [call('toggle_light', (a) => /garage/i.test(str(a.room)) && a.on === false, 'room=garage, on=false')] },
  },
  {
    id: 'stream',
    title: 'streaming: tool call assembled from deltas',
    stream: true,
    tools: T('get_weather', 'set_timer'),
    messages: [{ role: 'user', content: 'Set a timer for 25 minutes labelled "tea".' }],
    expect: { calls: [call('set_timer', (a) => a.minutes === 25 && /tea/i.test(str(a.label)), 'minutes=25, label=tea')] },
  },
];
