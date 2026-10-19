# toolcall-smoke: ggml-org/Qwen3-1.7B-GGUF

- Endpoint: `http://localhost:8091/v1` (llama.cpp b9770-75ad0b23e)
- Date: 2026-10-19 · temperature 0 · max_tokens 2048
- Result: **18/20 (90%)** · verdict **READY**: Structured tool calls work on these cases. The plumbing is fine; task quality is a separate question.

| case | what it checks | status | time | detail |
|---|---|---|---|---|
| `single` | one tool, one call | **PASS** | 1.2s |  |
| `select` | picks the right tool out of 5 | **PASS** | 1.9s |  |
| `no-call` | answers directly when no tool fits | **PASS** | 1.3s |  |
| `integer` | integer argument | **PASS** | 2.3s |  |
| `enum` | enum argument | **PASS** | 1.8s |  |
| `boolean` | boolean argument | **PASS** | 2.1s |  |
| `nested` | nested object + array arguments | **PASS** | 3.2s |  |
| `array` | array of strings | **PASS** | 2.1s |  |
| `escaping` | quotes and newlines inside a string | **WRONG_VALUE** | 2.0s | content needs the "hi" quotes and a real newline; got write_file({"path":"notes.txt","content":"He said \"hi\" then he left."}) |
| `unicode` | non-ASCII arguments | **PASS** | 1.6s |  |
| `no-args` | tool with no parameters | **PASS** | 0.8s |  |
| `optional` | optional argument used when asked | **PASS** | 2.0s |  |
| `parallel` | two calls in one turn | **PASS** | 1.9s |  |
| `many-tools` | picks the right tool out of 16 | **PASS** | 2.1s |  |
| `after-result` | uses a tool result instead of calling again | **PASS** | 2.5s |  |
| `chain` | second step of a multi-step task | **PASS** | 2.0s |  |
| `required` | honours tool_choice: "required" | **PASS** | 3.6s |  |
| `forced` | honours tool_choice for a named function | **WRONG_TOOL** | 1.7s | expected get_time, got get_weather |
| `system` | follows a system prompt that mandates tools | **PASS** | 1.2s |  |
| `stream` | streaming: tool call assembled from deltas | **PASS** | 1.8s |  |

- tool_choice = a named function was not enforced: do not rely on it with this server + model; validate the tool name in your loop.
