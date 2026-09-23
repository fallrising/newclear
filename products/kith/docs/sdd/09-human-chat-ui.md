# 09 — 人跟人聊天 UI

[回主 SDD](../../SDD.md) · 協定：[04](04-protocol.md) · 驗收：[06](06-verification.md)

本章是 P0 畫面契約：兩個已存在的人類能開房、邀請、互打。Agent、MCP、@ 補全、附件都不在本章。

視覺沿用既有 Apple HIG token（`#f2f2f7`、`#007aff`、系統字、毛玻璃頂欄與輸入列）。另只借兩條：Material 3 的 `:focus-visible` 與對比色；Polaris 的表單聲調（登入、開房、邀請各一個主要按鈕，錯誤放在欄位下、`role="alert"`）。不新增 UI 框架、遠端字型或圖片。不複製 EdgeChat 的程式、class 名或 schema。EdgeChat 只提供「桌面左列表 + 右聊天 + 底部輸入列；手機先列表再進房」的資訊架構。

## 非目標

語音、Telegram、管理後台、公開註冊、已讀／未讀、私信、編輯或刪除訊息、移出成員、Markdown、`innerHTML`。

## 畫面

斷點 768px。

- **登入**維持置中分組表單。文案鎖住：Handle、Password、Sign in。
- **桌面：** 左欄 280px 常駐「Rooms」。右欄是選中的房間；尚未選時顯示 “Select a room.”。左欄在聊天時仍可點另一間。右欄沒有返回。
- **手機：** 未選房時只顯示列表；選房後整頁聊天，返回回到列表。
- 重新整理後回到列表（網址不帶 room id）。本章接受這一點。
- 房間按鈕的無障礙名稱等於房間名（Lobby 就是 “Lobby”）。人數與選取狀態不得拼進這個名稱。選取用 `aria-current="true"`。
- 空列表維持 “No rooms.”。非 operator 再加 “An operator has to invite you.”
- `New room` 與 `Invite` 只在 `GET /api/me` 的 `is_operator === 1` 時出現。非 operator 收到 403 仍顯示 “operator required”。

### 開房

表單層：Name 必填，Slug 可留空。留空時前端依名稱產生 slug 再呼叫既有 `POST /api/rooms`（operator、CSRF、`{ name, slug }` 都必填；建立者成為 `role=owner`）。

產生規則：trim、小寫、空白變 `-`、只留 `a-z0-9-`、重複連字符合併、去掉頭尾 `-`、最長 48。結果是空的就用 `room-` 加 8 位 hex。409 `handle_taken` 時把送出的 slug 填回欄位並顯示 “slug taken”，不在背景重試。成功後關掉表單、重新載入列表、並選中新房。

伺服器代產 slug 不是本章的缺口。

### 邀請

表單層：Handle。成功後關掉，並在房內留下 “They will see this room after they refresh.” 被邀請的人要自己重新整理才會在列表看到新房。本章不做成員推播。

`POST /api/rooms/:id/members` 必須接受 `handle`。見 [04](04-protocol.md)。在這條落地之前，邀請按鈕不得假送。P0 這張表單只邀請 `kind=human`。

### 房間內

- 標題、連線 pill、人數（可展開成員 chips）、operator 的 Invite。
- pill 的文字節點維持恰好 `live`、`connecting` 或 `offline`。離線另顯示 “Offline. Reconnecting…”。
- 時間線沿用現有分組、agent 列、seq（粗指標隱藏）。正文 `pre-wrap`，不解析 Markdown。
- 輸入列釘在右欄（手機則是聊天頁）底部，含 safe-area。`textarea` 從一行長高，上限 `40dvh`，用 `scrollHeight` 計算，不單靠 `field-sizing`。
- Enter 送出，Shift+Enter 換行。`isComposing` 或 `keyCode === 229` 時不送。空白不送。
- placeholder 維持 `Message`。送出按鈕的無障礙名稱維持 `Send`。空白或非 `live` 時停用。離線時保留已打的字。
- 說明 “Enter to send · Shift+Enter for a new line” 放在輸入列上緣；觸控裝置隱藏。

## 驗收

- **Given** operator session，**when** 開房且 slug 留空、名稱 “Design”，**then** `POST /api/rooms` body 的 slug 是 `design`，建立者是 owner，列表出現該房並被選中。
- **Given** 第二個人類已存在且不在房內，**when** operator 用他的 handle 邀請，**then** `POST /api/rooms/:id/members` body 只有 `{ "handle" }`，回應含該 `member_id`；他重新整理後 `GET /api/rooms` 看得到這間房。
- **Given** 桌面寬度 ≥ 768，**when** 點一間房，**then** 列表與時間線同時在。**Given** 窄於 768，**when** 點一間房，**then** 只剩聊天頁，返回後回到列表。
- **Given** 中文 IME 組字中按 Enter，**then** 不送出。
- 前端既有鎖字測試仍過：Handle、Password、Sign in、Send、placeholder `Message`、文字節點 `live`、房間按鈕名稱 Lobby。
