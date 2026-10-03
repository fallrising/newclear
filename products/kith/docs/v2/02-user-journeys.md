# 02 — 使用旅程

[回 v2 索引](README.md)

每個旅程（UJ-xx）寫成 Given / When / Then，並指向實作它的里程碑與 E2E。Phase 1 只寫主幹與成功條件；Phase 2 補分支、錯誤路徑與每一步的畫面文案。

## UJ-01 第一次設定實例

- **Given** operator 剛部署完、已用 `kithctl bootstrap` 建立自己的帳號。
- **When** operator 登入。
- **Then** 看到空狀態引導：建第一個房間、建第一個 agent、邀請第一個人。每一步都能直接點進對應畫面。
- 里程碑：W2（房間）、W4（agent）。E2E：`E2E-W2-01`。

## UJ-02 兩個人聊天

- **Given** operator 與 guest 都在 Lobby。
- **When** 兩人互發訊息，其中一人斷線再重連。
- **Then** 雙方看到同一順序、同一 seq；重連後自動補齊漏掉的訊息，沒有重複；斷線期間已打的字保留。
- 里程碑：W1。E2E：`E2E-W1-02`、`E2E-W1-03`。

## UJ-03 進入長房間

- **Given** 房間已有 ≥ 1,000 則訊息。
- **When** 使用者進房，然後往上捲。
- **Then** 立刻看到**最新**一頁；往上捲時載入更早的訊息，捲動位置不跳；最舊處顯示「對話的開頭」。
- 里程碑：W1（需 B-01）。E2E：`E2E-W1-04`。

## UJ-04 知道哪裡有新訊息

- **Given** 使用者在房間 A，房間 B 收到新訊息。
- **When** 使用者看左側列表。
- **Then** B 顯示未讀數與最後一則預覽；進入 B 後停在「新訊息」分隔線。
- 限制：未讀只在已開啟過 Kith 的同一瀏覽器有效（BR-37）。另一房的新訊息要靠 B-06 的使用者事件流才能即時；W2 前以輪詢或重新進入時刷新。
- 里程碑：W2。E2E：`E2E-W2-03`。

## UJ-05 叫 hosted agent 回答

- **Given** 房內有 hosted agent `@claude`，runtime 使用 Anthropic Messages 格式連線，`quota_class=api_key`。
- **When** guest 送出 `@claude 幫我總結上面的討論`。
- **Then** 時間線底部出現 `@claude` 的「正在回覆」佔位；若開啟串流，佔位內逐步出現文字；完成後換成正式訊息（有 seq）。失敗時佔位換成一行失敗提示（BR-45）。
- 里程碑：W3（佔位與狀態）、W4（多格式）、W5（串流）。E2E：`E2E-W4-03`、`E2E-W5-01`。

## UJ-06 非 operator 叫個人訂閱 agent

- **Given** `@codex` 是 runner、`quota_class=operator_personal`。
- **When** guest 送出 `@codex 修一下 bug`。
- **Then** 訊息落盤；補全清單與成員格事先顯示「只有 operator 能喚醒」；沒有任何回覆中狀態；runner 不啟動 CLI。
- 里程碑：W3（顯示）、W6（runner）。E2E：`E2E-W3-04`、`E2E-W6-02`。

## UJ-07 operator 接一個新的 LLM

- **Given** operator 有某家供應商的 API key。
- **When** operator 在控制台「連線」頁新增連線：選預設（OpenAI、Anthropic、Google Gemini、xAI、DeepSeek、OpenRouter、自訂…）、貼 key、按「測試連線」；然後新增 agent：選 runtime `hosted`、選連線、選模型、填 handle 與顯示名；最後把 agent 邀進房間。
- **Then** 測試連線回報成功與可用模型清單（若該格式支援列模型）；agent 出現在房間成員列；@ 它會回覆。key 在任何畫面與 API 回應中都不再出現，只剩末 4 碼。
- 里程碑：W4。E2E：`E2E-W4-01`、`E2E-W4-02`。

## UJ-08 operator 接一個本機 CLI agent

- **Given** operator 主機上裝了 Claude Code（或 Codex CLI、Gemini CLI）。
- **When** operator 在控制台新增 runner agent，拿到一次性 bot token 與設定檔片段；在主機上執行 `kith-runner --config runner.toml`。
- **Then** 控制台顯示 runner 已連線（最近一次事件流連線時間）；operator @ 它時，房間出現 `accepted → running` 狀態與摺疊的 trace，完成後有摘要訊息。
- 里程碑：W6。E2E：`E2E-W6-01`（以 fake CLI 執行）。

## UJ-09 撤銷一把外洩的 token

- **Given** 某 agent 有兩把 token。
- **When** operator 撤銷其中一把。
- **Then** 該 token 的 MCP／HTTP 呼叫立即 401；另一把不受影響；控制台列表顯示撤銷時間。
- 里程碑：W4。E2E：`E2E-W4-04`。

## UJ-10 在 thread 裡處理長任務

- **Given** runner agent 正在處理一個長任務。
- **When** 它把進度與 trace 寫在 thread 裡。
- **Then** 主時間線只有一則根訊息＋「N 則回覆」；點開右側 thread 面板看完整過程；trace 預設摺疊。
- 里程碑：W6。E2E：`E2E-W6-03`。

## UJ-11 手機上使用

- **Given** 寬度 < 768px。
- **When** 使用者開 Kith。
- **Then** 先看到房間列表；進房是整頁聊天，有返回；成員與 thread 從下方面板打開；輸入列貼底且避開鍵盤與 safe area；重新整理後停在同一房（URL 帶房間）。
- 里程碑：W1–W3 各自負責自己的畫面。E2E：每個里程碑至少一條 mobile viewport 案例。

## Phase 2 待細化

- [ ] 每個 UJ 的錯誤分支（網路斷、401、403、409、429、503）與畫面文案。
- [ ] 每個 UJ 的 E2E 腳本逐步描述（操作、等待條件、斷言、截圖點）。
- [x] UJ-01 空狀態引導的文案與版面 → [W2](milestones/W2.md) §5.5 `HomeEmpty`（agent 卡片在 W4 加入）。
