# Claude 订阅如何接到 thinrouter

默认使用真正的 Claude Code **交互式 TUI**，在私有 PTY 中提交输入；保留显式
`--claude-mode print` 兼容模式。选择 TUI 后不会自动切回 `-p`，也不会把完整 transcript
冒充增量串流。这是 [T-0426 批准的 A 方案](tasks/T-0426-claude-tui.md)。

## 原理

```text
client (chat / messages / responses)
    → thinrouter 渲染 user 输入 → 私有 PTY → 官方 Claude Code 交互式进程
    → 官方请求的 SSE 响应副本 → 私有 response tap → 原有协议转换与用量观察
    → client
```

- TUI 参数保留精确 model、空内建工具、严格 MCP 配置、独立工作目录和指定 session；不传
  `-p` 或 stream-json 输出参数。CLI 自己持有登录状态并发出请求，thinrouter 不读出凭证。
- 与 magpie 的交互式方案一样，使用 `BUN_OPTIONS` 加载自己的 response tap，观察 Bun
  `FetchSession` 的主 Messages 响应。请求、认证标头、TLS 和 Claude Code system prompt
  不被改写。tap 读取响应副本；这是依赖官方 CLI 内部接口的兼容层，版本变化可能使其失效。
- tap 未载入、响应被截断或缺少原始终止证据时明确失败；不会靠 transcript 补出成功。
  客户端在完整回答前收到增量内容，输入／输出／cache 用量仍来自原始事件。重复 message ID
  只转发一次。TUI 屏幕、提示和 profile 路径不会作为错误诊断回传。
- 调用方的 system 指令仍放在 user 消息的 `<external_system_instructions>`，历史与当前轮
  分开渲染。这保留官方 system prompt，但不构成帐号安全或订阅条款合规的保证。
- 进程移除 API token/base override、嵌套入口标记和继承的 loader 配置，仅安装本轮私有 tap；
  保留官方 CLI 正常使用指定 profile 的能力。`<data_dir>/claude-work` 是稳定独立工作目录。
  未完成的 trust、登录或 onboarding 必须由使用者在官方 CLI 手动处理；gateway 不自动确认。
- 使用 bracketed paste 并等待确认后提交，拒绝终端控制字元；命令样式开头转为普通消息。
  TUI 将 inline base64 图片写入本轮 0600 私有文件后交给 CLI。远端图片 URL 在 TUI 中明确
  不支持，也不由 helper 下载；需要旧 URL 图片行为时由操作者显式选择 print。
- 回答结束后保留可复用进程和输入通道。断线／失败／关闭依原有生命周期取消，TUI helper
  负责终止所属 PTY 进程组并移除本轮私有文件；同时最多 `--claude-max-runs`（预设 2）个 run。
  TUI 启动等待有界；tap 缺失会回报固定错误。未发出客户端回答前仍沿用 route 的 fallback。

这次离线实现不能证明真实 CLI 兼容、帐号不会受限、cache 必然命中或节省固定倍数额度。
此前六次真实 admission 的 native reuse 验收仍未通过；本次没有增加真实请求。

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
  一致、后面只多了使用者讯息，就只提交新讯息到同一进程（不加 `Human:` 标签）；实际 cache 命中与订阅额度由服务端决定。
- 闲置同样受 `--claude-idle-secs` 限制；名额不够时最早闲置或等待的 run 先被结束。
- 新进程的第一则讯息里，历史每 20 则一个区块，最后一个完整区块加 `cache_control`
  （`ephemeral`、1h）；没有完整区块时标在呼叫方的 instructions 上。之后同一段对话即使开新进程，
  print 模式保留这些 cache 标记；TUI 的最终缓存策略由官方 CLI 决定，不保证命中。
- gateway 关闭时（Ctrl-C 或 SIGTERM）先对所有存活的 Claude Code 送 SIGTERM，TUI 最多等 7 秒（print 为 6 秒）。

## 存下的 session（重启后也能续接）

- Claude Code 会把 session 存在 `<CLAUDE_CONFIG_DIR 或 ~/.claude>/projects/<工作目录路径，非英数字换成 ->/<session_id>.jsonl`
  （thinrouter 不再传 `--no-session-persistence`），session_id 取自它的 `system`/`init` 行。
- 闲置中的 run 被结束（闲置逾时、名额被让出、gateway 关闭）时，它的 session 登记到资料库的
  `claude_shelf`：只存 session_id、设定签章的 hash 与每则已知讯息的 hash，不存对话内容。
- 新请求若续不上闲置进程，就查 shelf：设定相同、历史是已知讯息的前缀、后面只多了使用者讯息，
  就以所选 transport 的 `claude ... --resume <session_id>` 开新进程、只提交新讯息；实际 cache 使用仍须实测。
  session 档不在，或 Claude Code 载入失败（例如 `No conversation found`），自动改开新进程整段重送。
- shelf 最多 64 笔、保留 6 小时，过期或被挤出时连 session 档一起删除；其他结束的 run（等工具结果
  逾时、出错）不保留 session。gateway 启动时会删除工作目录专属 project 资料夹里 shelf 没引用的
  session 档（例如当机遗留），每 10 分钟清一次过期项目。
- `tool_choice: required` 或指定工具时，在 `<external_system_instructions>` 里用文字说明
  （Claude Code 没有对应参数）。

## 设定

```bash
claude            # 先用 Claude Code 登录一次（Pro/Max 订阅）
thinrouter import-local          # 侦测到 claude 就建立 local-claude 连线与 rt-claude route
# 或在 admin 汇入 provider=claude、access_token 留空
thinrouter serve --claude-bin /path/to/claude   # 默认 --claude-mode tui
# 只有操作者明确选择才使用旧 print transport：
thinrouter serve --claude-mode print --claude-bin /path/to/claude
```

`THINROUTER_CLAUDE_MODE=tui|print` 也可选择 transport。TUI 需要 Unix PTY 和兼容的 Bun FetchSession；不支持的平台明确拒绝 TUI，print 仍可显式选择。

模型名直接交给 `claude --model`（`sonnet`、`opus` 或完整模型 ID）。

## 目前限制

- 只有「对话完全一致、只多了使用者讯息」才续用闲置进程；客户端改写或截短历史、换了
  system/工具/模型，都会开新进程重送整段对话；缓存和计费效果须实际验证。
- 闲置进程被结束后，靠存下的 session 续接（见下节）；但对话被改写时一样整段重送。
- thinking 区块不回传；`temperature`、`max_tokens` 等取样参数不传给 Claude Code。
- 旧版存过的 Claude token 会在开启资料库时清掉（不再使用）。
