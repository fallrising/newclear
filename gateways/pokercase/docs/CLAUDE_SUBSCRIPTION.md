# Claude 订阅如何接到 thinrouter

> [!WARNING]
> 用订阅额度做自动化调用仍受 Anthropic 使用条款约束。thinrouter 只降低「请求不像 Claude Code」
> 的风险：请求一律由本机真正的 Claude Code CLI 发出，thinrouter 不持有、也不发送任何 Claude token。
> 不要在承受不起风险的帐号上启用；不要替换 Claude Code 自己的 system prompt。

## 原理

`claude` provider 不再直接调用 `api.anthropic.com`。每个请求由本机已登录的 `claude` 二进制回答
（做法参考 [yetone/magpie 的 Claude subscription bridge](https://github.com/yetone/magpie/blob/main/docs/subsystems/claude-subscription-bridge.md)）：

```
client (chat / messages / responses)
        │  thinrouter 统一转成 chat 格式，再渲染成一条 user 消息
        ▼
claude -p --output-format stream-json --input-format stream-json
          --include-partial-messages --verbose --model <model>
          --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence
        │  Claude Code 用自己的登录、system prompt、billing 区块与客户端身份请求 Anthropic
        ▼
stream-json 的 stream_event（Anthropic Messages 事件）
        │  thinrouter 去掉 thinking 区块，转回客户端协议
        ▼
client
```

- **呼叫方的 system prompt 不会取代 Claude Code 的**：它放在第一条 user 消息的
  `<external_system_instructions>` 里。替换 system prompt 正是让订阅流量不像 Claude Code、
  导致封号风险的做法。
- 多轮对话：已回答的部分包在 `<conversation_history>`，要回答的这一轮在 `<current_turn>`；
  消息标为 `Human:` / `Assistant:`。图片以 Anthropic image 区块（base64 或 URL）放在原位置。
- 进程环境：移除 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、
  `CLAUDE_CODE_OAUTH_TOKEN`、`CLAUDECODE` 等，设 `DISABLE_AUTOUPDATER=1`、
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`、`DISABLE_AUTO_COMPACT=1`、
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`、`ENABLE_CLAUDEAI_MCP_SERVERS=0`；
  工作目录是空的 `<data_dir>/claude-work`，不读专案或使用者设定。
- 结束：stdin 送出一条消息后关闭；回答完或客户端断线时先送 SIGTERM（让 Claude Code 清掉
  `~/.claude/.oauth_refresh.lock`），5 秒后才强制结束。同时最多 `--claude-max-runs`（预设 2）个进程。
- 失败：额度用尽 → 429；未登录 → 401；其它 → 502。在第一个回答事件之前的失败可 fallback 到
  route 的下一个 target。

## 客户端工具

- 请求带 `tools` 时，run 多一个 MCP server：`thinrouter claude-mcp-helper --tools-file …`
  （每个 run 一个暂存目录，结束后删除）。模型看到的工具名是 `mcp__thinrouter__<name>`；
  名字含 `[A-Za-z0-9_-]` 以外字元或太长时截断并加 hash，每次相同。
- 参数加 `--mcp-config <run>/mcp.json --allowedTools <这些工具>`；Claude Code 自己的工具仍是
  `--tools ""`，不用 `--dangerously-skip-permissions`。
- 模型呼叫工具时，`tool_use` 已在串流里：thinrouter 把名字换回客户端的名字转给客户端
  （chat 的 `tool_calls`、Anthropic 的 `tool_use`、Responses 的 `function_call`），这次回应
  结束，但 **run 不结束**：它登记为「等这些 tool id 的结果」。
- helper 的 `tools/call` 打 gateway 的 `POST /_thinrouter/claude-mcp`，带该 run 的随机
  token（`x-thinrouter-run-token` 标头；token 只写在 run 目录的 0600 `callback.json`，
  不在命令列或 URL 上；带转发标头的请求一律拒绝），一直等到结果到来。
- 下一个请求若正好以这些 tool id 的结果结尾，结果交给那个 run 的 MCP 呼叫，同一个
  Claude Code 进程接着回答，对话不再重送。对不上（别的 id、结果后还有新的使用者文字、run
  已结束）就开新 run，整段对话以文字告诉它：
  `[tool call mcp__thinrouter__<name> id=… args=…]`、`[tool result id=…]`。
- 等结果最多 `--claude-idle-secs`（预设 600 秒）；名额（`--claude-max-runs`）不够时，最早开始
  等待的 run 先被结束。

## 跨轮保留进程

- 回答以 `end_turn` 结束后，run 不结束而是闲置，记住它已有的对话（正规化后的讯息与刚才的回答）
  以及 model、system、工具清单。下一个请求若是同一组 model/system/工具、前面的讯息与它记住的完全
  一致、后面只多了使用者讯息，就只把新讯息写进那个进程的 stdin（不加 `Human:` 标签），
  Anthropic 从 cache 读其余部分。
- 闲置同样受 `--claude-idle-secs` 限制；名额不够时最早闲置或等待的 run 先被结束。
- 新进程的第一则讯息里，历史每 20 则一个区块，最后一个完整区块加 `cache_control`
  （`ephemeral`、1h）；没有完整区块时标在呼叫方的 instructions 上。之后同一段对话即使开新进程，
  也能读到之前写入的 cache。
- gateway 关闭时先对所有存活的 Claude Code 送 SIGTERM，最多等 6 秒。
- `tool_choice: required` 或指定工具时，在 `<external_system_instructions>` 里用文字说明
  （Claude Code 没有对应参数）。

## 设定

```bash
claude            # 先用 Claude Code 登录一次（Pro/Max 订阅）
thinrouter import-local          # 侦测到 claude 就建立 local-claude 连线与 rt-claude route
# 或在 admin 汇入 provider=claude、access_token 留空
thinrouter serve --claude-bin /path/to/claude   # 不在 PATH 时
```

模型名直接交给 `claude --model`（`sonnet`、`opus` 或完整模型 ID）。

## 目前限制

- 只有「对话完全一致、只多了使用者讯息」才续用闲置进程；客户端改写或截短历史、换了
  system/工具/模型，都会开新进程重送整段对话（由 history 分块的 cache 标记减少重写）。
- thinrouter 重启后没有可续用的进程（不保存 session；magpie 的 `--resume` 搁置区未实作）。
- thinking 区块不回传；`temperature`、`max_tokens` 等取样参数不传给 Claude Code。
- 旧版存过的 Claude token 会在开启资料库时清掉（不再使用）。
