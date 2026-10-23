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

## 设定

```bash
claude            # 先用 Claude Code 登录一次（Pro/Max 订阅）
thinrouter import-local          # 侦测到 claude 就建立 local-claude 连线与 rt-claude route
# 或在 admin 汇入 provider=claude、access_token 留空
thinrouter serve --claude-bin /path/to/claude   # 不在 PATH 时
```

模型名直接交给 `claude --model`（`sonnet`、`opus` 或完整模型 ID）。

## 目前限制

- **客户端工具还没桥接**：带 `tools` 的请求回 501（可 fallback）。下一步照 magpie 用 MCP
  helper 把客户端工具提供给 Claude Code，并让同一段对话留在同一个进程以命中 prompt cache。
- 每个请求启动一个新进程、把整段对话重送，没有跨请求的 prompt cache；启动约需 1–2 秒。
- thinking 区块不回传；`temperature`、`max_tokens` 等取样参数不传给 Claude Code。
- 旧版存过的 Claude token 会在开启资料库时清掉（不再使用）。
