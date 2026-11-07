# API v1 與 office-report

## 呼叫方式

```sh
export OFFICE_URL=https://office.example
export OFFICE_TOKEN_FILE=/approved/local/grok.token
./bin/office-report grok thinking "規劃一般工作" --task general
./bin/office-report grok coding "進行程式開發" content --task code
./bin/office-report grok needs-you "等待人工確認"
./bin/office-report grok done "本次工作結束"
# 不讀取 token、不做網路請求；只顯示固定公開投影
./bin/office-report grok coding "進行程式開發" --task code --dry-run
# 相容短格式，agent 與狀態必須由本機環境明確綁定
export OFFICE_AGENT=grok OFFICE_STATUS=thinking
./bin/office-report "整理一般資料" content
```

Node >=22；POSIX wrapper 可用 `node bin/office-report.mjs` 取代。Token 檔須為目前使用者擁有、0600、非 symlink；最多 129 bytes。也支援 OFFICE_TOKEN 環境變數，但檔案較容易限制意外曝露。不要把秘密、帳號、金額、主機名、私訊、未公開計畫放入摘要，即使 CLI 丟棄它，shell history／宿主仍可能保存 argv。

`--task`：general/code/research/content/visual/review/ops。協作以逗號分隔，最多三位。摘要限制為 Unicode code points，不是 UTF-8 bytes 或 grapheme clusters。任何自由摘要都只在本機用於參數相容性，**不傳輸、不保存、不回顯**。例：coding＋code 的公開摘要固定為「程式開發：撰寫程式」。

## POST /report

Bearer token 只能代表 body 中的 agentId。HTTP Content-Type 必須為 application/json；body 最多 1024 bytes。拒絕帶 Origin 的瀏覽器上報；前端不持有任何寫入憑證。

```json
{
  "agentId": "grok",
  "status": "coding",
  "taskType": "code",
  "collaborators": ["content"],
  "eventId": "7348852e-268b-4f97-8cbe-b6d8f67e1d06",
  "expectedRevision": 0
}
```

只有以上六個欄位；summary/prompt/log/url/account 等全部拒絕。協定值以 `src/core.mjs` 的嚴格 validator 為執行權威。eventId 為小寫 UUIDv4；expectedRevision 為非負安全整數。CLI 先讀 /state 中自己的 revision，然後同一 body 有界重試，409 直接停止；不默默覆蓋另一 session。

成功：`{"ok":true,"duplicate":false,"revision":1}`。同一事件重送：duplicate=true、回傳原先接受的 revision（不保證等於此刻最新 revision）。

| HTTP | 意義 |
| --- | --- |
| 400 / 413 / 415 / 422 | JSON 錯誤／超過 byte 上限／非 JSON／schema、名冊或 enum 不符 |
| 401 / 403 | token 無效／demo 或瀏覽器禁止寫入 |
| 404 / 405 | 未知固定路由／method 不符；405 有 Allow |
| 409 | event_conflict 或 revision_conflict；不得強制重放 |
| 429 | 每 agent 固定分鐘已接受 12 筆更新；遵守 Retry-After |
| 500 / 503 | 內部錯誤／部署配置未齊；不回傳秘密或底層例外 |

## GET /state

公開唯讀，不需要 token；沒有 cookies 或 wildcard credentialed CORS。只回經審閱的名冊欄位及公開狀態。範例中的狀態不是任何真實工作紀錄。

```json
{
  "schemaVersion": 1,
  "mode": "live",
  "simulated": false,
  "serverTime": "2026-10-31T00:00:00.000Z",
  "bots": [{
    "id": "grok", "name": "Grok Bot", "role": "總調度",
    "color": "#00D1FF", "seat": "director",
    "status": "coding", "reportedStatus": "coding",
    "alert": false, "stale": false, "taskType": "code",
    "summary": "程式開發：撰寫程式", "collaborators": [],
    "revision": 1, "lastSeen": "2026-10-31T00:00:00.000Z"
  }]
}
```

live 不代表「有真實 Agent 接入」；它只表示接受上報的模式。沒有回報時 lastSeen=null、revision=0、stale=true、status=idle。demo 明示 mode=demo、simulated=true；不能讀 live storage，也不能 POST。

public response 一律 no-store，包含 nosniff／referrer policy。前端必須以 textContent/fillText 渲染，不將 JSON 內容當 HTML。30 分鐘後 status 投影為 idle，但 reportedStatus 和 alert 保留，避免靜默抹掉錯誤。

## Agent hook

```sh
# 上報失敗不能冒充成功，也不改寫主要工作命令的 exit status。
./bin/office-report grok coding "進行程式開發" --task code || printf '%s\n' 'office report unavailable' >&2
if your-approved-command; then
  ./bin/office-report grok done "本次工作結束" --task code || printf '%s\n' 'office report unavailable' >&2
else
  result=$?
  ./bin/office-report grok error "工作需要排查" --task code || printf '%s\n' 'office report unavailable' >&2
  exit "$result"
fi
```

`your-approved-command` 是需替換的原本工作命令，不是本專案提供的可執行工具。上報程式不啟動模型、不讀取對話、不掃描其他 agent 視窗。宿主 hooks 是否可用、每個視窗是否需要獨立批准，必須在該宿主實測。
