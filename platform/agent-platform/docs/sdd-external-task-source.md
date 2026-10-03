# 外部任務來源（External task source）

- **狀態**：Proposed（2026-09-28）。owner 合併本文件並排入里程碑前，不得依本文件實作。
- **上層文件**：[`SDD.md`](../SDD.md) §2（範圍與既有專案關係）、§7（Adapter 契約）、§9（狀態機）、§11（權限）、§15（里程碑）
- **建議排程**：M4 之後、與 M5 同期。M4 的結果封存與 explicit export 是回傳結果的前提。

## 1. 問題

平台今天只能從 Web UI 手動建立任務。但 owner 的工作是在一個私人的檔案式任務帳本裡規劃與追蹤的：
每個 task 已經寫好目標、可修改路徑、不可修改範圍、完成條件、驗證命令、預算與提交授權。
要讓 agent-platform 執行這些 task，目前只能人工把內容抄進 UI，再把結果抄回帳本。

本文件定義一個窄的入口：外部帳本送進一張 **task card**，平台產生一個 run，結束時回傳
candidate 與 evidence。平台不擁有帳本，也不決定 task 是否完成。

## 2. 範圍與非目標

**範圍**

- task card 格式與驗證。
- card → task／run 的對應，含 verification policy 與預算。
- 結果摘要（result envelope）的格式與產生時機。

**非目標**

- 平台主動讀取或輪詢帳本；由外部呼叫者送 card。
- 回寫帳本、更新帳本狀態、開 PR 或 merge。GitHub export 仍是 M4 的獨立授權動作。
- DAG、依賴判斷、排程（帳本端負責；SDD §2.3 已排除視覺化 DAG）。
- 自動重試未知結果（沿用 SDD §9 的 unknown 不重送）。

## 3. Task card

```json
{
  "card_version": 1,
  "source": {"ledger": "<opaque ledger id>", "task_id": "<string>", "revision": "<ledger commit sha>"},
  "repository": {"bundle_ref": "<existing private connector reference>", "base": "<commit sha>"},
  "outcome": "<一句可觀察結果>",
  "scope_paths": ["<允許修改的路徑前綴>"],
  "out_of_scope_paths": ["<禁止修改的路徑前綴>"],
  "verify": [{"argv": ["<cmd>", "<arg>"], "timeout_s": 600}],
  "budget": {"max_requests": 200, "deadline_s": 7200},
  "grant": {"export": "none"}
}
```

- **ETS-001**：card 以 canonical JSON 計算 digest；run 固定引用該 digest。同一 `(source.ledger, source.task_id, source.revision)`
  只會建立一個 task（及其第一個 run）；重送同一 card 回傳既有 task（冪等），內容不同則回 `conflict`。
- **ETS-002**：`repository.bundle_ref` 只能指向 M2 私有 connector 已登記的固定 repository bundle；card 不能帶任意 URL 或憑證。
- **ETS-003**：`verify` 轉成 profile 的 verification policy `commands`（既有 bounded argv 語意、數量與輸出上限）。
  不接受 shell 字串。
- **ETS-004**：`budget` 只能收緊平台設定的上限，不能放寬。`deadline_s` 上限沿用功能切片的 2 小時。
- **ETS-005**：`grant.export` 在本文件只允許 `none`。允許 export 的值要等 M4 的 export 授權模型接受後另行定義。
- **ETS-006**：card 的文字欄位是不受信任的資料，只當作 agent 的任務描述，不改變平台政策、工具審批或 egress。

## 4. 執行中的額外檢查

- **ETS-010**：run 結束時，平台比對 workspace diff 與 `scope_paths`／`out_of_scope_paths`。
  任何越界檔案都使 verification 失敗（`scope_violation`），即使 verify 命令通過。
- **ETS-011**：需要人回答的問題沿用既有 approval／pause 流程；平台不代為回答，也不把問題轉成帳本變更。

## 5. 結果回傳（result envelope）

```json
{
  "envelope_version": 1,
  "card_digest": "<sha256>",
  "task_id": "<uuid>", "run_id": "<uuid>",
  "outcome": "candidate_produced | verification_failed | scope_violation | cancelled | outcome_unknown | failed",
  "candidate": {"diff_sha256": "<hex>", "files": ["<path>"]},
  "evidence": [{"argv": ["..."], "exit_code": 0, "output_sha256": "<hex>"}],
  "usage": {"requests": 0, "amount_decimal": null},
  "ended_at": "<UTC ISO8601>"
}
```

- **ETS-020**：`candidate_produced` 只表示有通過驗證的候選變更，**不是**完成、驗收或 merge。
  呼叫者（帳本端）負責把它呈現給 owner 驗收。
- **ETS-021**：envelope 不含 prompt、模型回應、工具輸出原文、主機路徑或憑證；只含 digest、路徑與結束碼。
  原文留在平台的既有保存與權限模型裡。
- **ETS-022**：envelope 以 API 查詢取得（`GET /api/v1/tasks/{id}/result`）；平台不主動推送到外部。

## 6. API

- `POST /api/v1/task-cards`：operator 身分、同源保護與既有 CSRF 規則；原子建立 task 與第一個 queued run（同 `POST /api/v1/tasks` 語意），回傳 task id。
- `GET /api/v1/tasks/{id}/result`：run 結束前回 `pending`。

兩者都走既有的 operator 驗證；本文件不新增服務帳號。無人值守呼叫的憑證模型另行決定（§8）。

## 7. 驗收

- 冪等：同一 card 重送兩次只有一個 task；改一個欄位回 `conflict`。
- 越界：fixture 任務改動 `out_of_scope_paths` 內的檔案時結果為 `scope_violation`。
- 預算：card 的 `max_requests` 大於平台上限時被拒；小於時生效。
- envelope 掃描：公開 evidence 與 envelope 中沒有主機路徑、token 或模型原文。
- 真實 KVM：一張 FILE／TEXT card 走完 card → run → envelope，VM 與 claim 歸零（沿用既有 KVM 證據格式）。

## 8. 待決定

- OD-1：外部呼叫者的身分：沿用 operator session，還是新增只能呼叫這兩個 endpoint 的受限 token。
- OD-2：排程位置（M4 之後或併入 M5）。
- OD-3：帳本 task 的預算欄位是否直接對應 `max_requests`。
