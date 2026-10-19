# toolcall-smoke: ggml-org/Qwen3-1.7B-GGUF

- Endpoint: `http://localhost:8091/v1` (llama.cpp b9770-75ad0b23e)
- Date: 2026-10-19 · temperature 0 · max_tokens 1024 · extra `{"chat_template_kwargs":{"enable_thinking":false}}`
- Result: **54/60 (90%)** · verdict **READY**: Structured tool calls work on these cases. The plumbing is fine; task quality is a separate question.

| case | what it checks | status | time | detail |
|---|---|---|---|---|
| `single` | one tool, one call | **PASS** | 0.2s |  |
| `single` | one tool, one call | **PASS** | 0.2s |  |
| `single` | one tool, one call | **PASS** | 0.2s |  |
| `select` | picks the right tool out of 5 | **PASS** | 0.5s |  |
| `select` | picks the right tool out of 5 | **PASS** | 0.2s |  |
| `select` | picks the right tool out of 5 | **PASS** | 0.2s |  |
| `no-call` | answers directly when no tool fits | **PASS** | 0.1s |  |
| `no-call` | answers directly when no tool fits | **PASS** | 0.1s |  |
| `no-call` | answers directly when no tool fits | **PASS** | 0.1s |  |
| `integer` | integer argument | **PASS** | 0.3s |  |
| `integer` | integer argument | **PASS** | 0.2s |  |
| `integer` | integer argument | **PASS** | 0.2s |  |
| `enum` | enum argument | **PASS** | 0.3s |  |
| `enum` | enum argument | **PASS** | 0.2s |  |
| `enum` | enum argument | **PASS** | 0.2s |  |
| `boolean` | boolean argument | **PASS** | 0.2s |  |
| `boolean` | boolean argument | **PASS** | 0.2s |  |
| `boolean` | boolean argument | **PASS** | 0.2s |  |
| `nested` | nested object + array arguments | **PASS** | 0.5s |  |
| `nested` | nested object + array arguments | **PASS** | 0.6s |  |
| `nested` | nested object + array arguments | **PASS** | 0.6s |  |
| `array` | array of strings | **PASS** | 0.3s |  |
| `array` | array of strings | **PASS** | 0.3s |  |
| `array` | array of strings | **PASS** | 0.3s |  |
| `escaping` | quotes and newlines inside a string | **WRONG_VALUE** | 0.3s | wrote a literal backslash-n instead of a newline; got write_file({"path":"notes.txt","content":"He said \"hi\\n\" then he left."}) |
| `escaping` | quotes and newlines inside a string | **WRONG_VALUE** | 0.3s | wrote a literal backslash-n instead of a newline; got write_file({"path":"notes.txt","content":"He said \"hi\\n\" then he left."}) |
| `escaping` | quotes and newlines inside a string | **WRONG_VALUE** | 0.3s | wrote a literal backslash-n instead of a newline; got write_file({"path":"notes.txt","content":"He said \"hi\\n\" then he left."}) |
| `unicode` | non-ASCII arguments | **PASS** | 0.4s |  |
| `unicode` | non-ASCII arguments | **PASS** | 0.4s |  |
| `unicode` | non-ASCII arguments | **PASS** | 0.4s |  |
| `no-args` | tool with no parameters | **PASS** | 0.1s |  |
| `no-args` | tool with no parameters | **PASS** | 0.2s |  |
| `no-args` | tool with no parameters | **PASS** | 0.1s |  |
| `optional` | optional argument used when asked | **PASS** | 0.3s |  |
| `optional` | optional argument used when asked | **PASS** | 0.3s |  |
| `optional` | optional argument used when asked | **PASS** | 0.3s |  |
| `parallel` | two calls in one turn | **PASS** | 0.4s |  |
| `parallel` | two calls in one turn | **PASS** | 0.4s |  |
| `parallel` | two calls in one turn | **PASS** | 0.4s |  |
| `many-tools` | picks the right tool out of 16 | **PASS** | 1.2s |  |
| `many-tools` | picks the right tool out of 16 | **PASS** | 0.4s |  |
| `many-tools` | picks the right tool out of 16 | **PASS** | 0.5s |  |
| `after-result` | uses a tool result instead of calling again | **PASS** | 0.3s |  |
| `after-result` | uses a tool result instead of calling again | **PASS** | 0.1s |  |
| `after-result` | uses a tool result instead of calling again | **PASS** | 0.2s |  |
| `chain` | second step of a multi-step task | **PASS** | 0.7s |  |
| `chain` | second step of a multi-step task | **PASS** | 0.7s |  |
| `chain` | second step of a multi-step task | **PASS** | 0.6s |  |
| `required` | honours tool_choice: "required" | **PASS** | 0.7s |  |
| `required` | honours tool_choice: "required" | **PASS** | 0.7s |  |
| `required` | honours tool_choice: "required" | **PASS** | 0.7s |  |
| `forced` | honours tool_choice for a named function | **WRONG_TOOL** | 0.2s | expected get_time, got get_weather |
| `forced` | honours tool_choice for a named function | **WRONG_TOOL** | 0.2s | expected get_time, got get_weather |
| `forced` | honours tool_choice for a named function | **WRONG_TOOL** | 0.2s | expected get_time, got get_weather |
| `system` | follows a system prompt that mandates tools | **PASS** | 0.3s |  |
| `system` | follows a system prompt that mandates tools | **PASS** | 0.3s |  |
| `system` | follows a system prompt that mandates tools | **PASS** | 0.2s |  |
| `stream` | streaming: tool call assembled from deltas | **PASS** | 0.3s |  |
| `stream` | streaming: tool call assembled from deltas | **PASS** | 0.3s |  |
| `stream` | streaming: tool call assembled from deltas | **PASS** | 0.3s |  |

- tool_choice = a named function was not enforced: do not rely on it with this server + model; validate the tool name in your loop.
