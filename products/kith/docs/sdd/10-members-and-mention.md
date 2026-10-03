# 10 — 成員與提及

[回主 SDD](../../SDD.md) · 協定：[04](04-protocol.md) · 前一章畫面：[09](09-human-chat-ui.md) · 驗收：[06](06-verification.md)

> **Superseded（v2 W7，2026-09-26）：** 本章的畫面契約已由 v2 [06 UX](../v2/06-ux.md) 與 [07 視覺](../v2/07-visual-design.md) 取代，執行中的前端是 `products/kith/web/`，舊 `frontend/` 已刪除。本章保留的行為規則（IME、@ 補全鍵盤、邀請錯誤、回覆狀態過期、成員讀取失敗）由 v2 [06](../v2/06-ux.md) §9 承接並以 v2 E2E 驗收；本章其餘內容只供歷史對照。

畫面契約改由 [11 — 房間畫面](11-room-screen.md) 取代；本章留下的行為以 11 沒有改寫的部分為準。以下舊畫面敘述與驗收保留供對照，畫面斷言改看 11。

本章是 09 之後的畫面切片。進房的人直接看見本房成員、知道 agent 的回應限制，並能用 `@` 對指定成員說話、看見可信的回應狀態。

本章不把「叫醒 agent」做成整頁主角。人類與 agent 都是成員。`@` 是對某一個成員說話，不保證有回覆。

視覺沿用 09：Apple HIG token（`#f2f2f7`、`#007aff`、系統字、毛玻璃頂欄與輸入列）、Material 3 的 `:focus-visible` 與對比、Polaris 的表單聲調（一張表一個主要按鈕，錯誤在欄位下、`role="alert"`）。不加 UI 框架、遠端字型或圖片。不複製 EdgeChat 或其他產品的程式、class 名或 schema。多人聊天只借資訊架構：身分靠近標題、紀錄在中、正在輸入或回覆的狀態貼在紀錄底部、輸入列在最底、提及是輸入的一部分。不新增第三欄，也不把成員格做成另一套按鈕。

時間線仍是畫面的主體。成員區是標題下固定一列、不換行；人變多只增加橫向捲動，不增加高度。

新增的限制句、提示與狀態文字對比至少 4.5:1（大字至少 3:1）。可操作項有可見焦點，且焦點不被頂欄或輸入列蓋住。成員格與提及選項的可點區域至少 24×24 CSS px；觸控時以 44×44 CSS px 為目標。不足時減少同時露出的格數，不得把目標再縮小。

## 非目標

New agent、簽發或列出 token、模型或 attention 設定、即時在線名冊、語音、Telegram、管理後台、公開註冊、已讀／未讀、私訊、附件、Markdown、把提及做成富文本 chip、移出成員、伺服器代產 slug、人類成員名單推播、`@everyone`、把 Codex 做成雲端服務。不改 ambient。不承諾每次 mention 都有回覆。不顯示「排隊中」「冷卻中」或沒有後端依據的失敗原因。不顯示 `quota_class`。

09 鎖住的字維持：Handle、Password、Sign in、Send、placeholder `Message`、pill 文字節點 `live`／`connecting`／`offline`、房間按鈕的無障礙名稱等於房間名。

## 畫面

斷點仍是 768px。桌面左欄 280px 常駐 Rooms，右欄是聊天，沒有返回。窄螢幕先列表、進房後整頁聊天並有返回。重新整理後回到列表。這些都維持 09。

本章移除 09 的「人數（可展開成員 chips）」。標題列不再有可點的人數，也不再並列兩套成員 UI。

右欄由上到下：

1. 房名、連線 pill、operator 的 Invite。窄螢幕在這一列留返回。
2. 成員區。桌面與窄螢幕都常駐。
3. 時間線。
4. 狀態一行，貼在時間線底部、輸入列上方。打字狀態與回覆狀態共用這一處，不在成員區底下再放一行。沒有有效狀態時不渲染文字、不預留高度。
5. 輸入列，釘在底部，含 safe-area，高度規則維持 09（`scrollHeight`，上限 `40dvh`）。

`live` 只表示自己的聊天連線。它不表示其他成員在線，成員資格也不表示在線。人類成員不另加在線狀態。

### 成員

每次進房都重新 `GET /api/rooms/:id/members`。讀取中顯示 `Loading members…`，此時不提供 `@` 候選。只採用目前這間房最新一次讀取的結果。

每一格看得到顯示名（沒有就用 handle）、`@handle`，以及 `human` 或 `agent`。agent 的可見 badge 文字恰好是 `agent`，沿用既有淡藍底。人類不加這個 badge。不可只靠顏色區分。

無障礙名稱包含顯示名或 handle、`@handle`、`human` 或 `agent`，以及下面那句限制（若有）。限制句在格子裡以文字節點呈現，不放進只有 hover 才出現的提示。`fixed_text` 超過格子寬度時，可見文字單行省略，全文留在無障礙名稱裡。

成員區是 `role="list"` 的橫向捲動容器，無障礙名稱 `Members`，`tabindex="0"`。聚焦後可用方向鍵捲動，並有 `:focus-visible` 外框。捲到端點時，端點的格子不得被頂欄或輸入列蓋住。不靠顏色漸層暗示後面還有人。靜態格子不做成按鈕外觀。不承諾 32 個人名同時塞進畫面。

非 operator 觀看 `operator_personal` 成員時，成員格與 `@` 候選都必須顯示既有 badge `operator-only`。這個 badge 獨立於限制句；即使同時有 fixed 句也不得省略。

一個 agent 最多一句限制。順序：

1. 伺服器給 `reply_limit.code = "fixed"`：顯示 `Fixed reply only: ` 接 `fixed_text`。現行程式的固定句是 `hello from grok` 時，整句就是 `Fixed reply only: hello from grok`。`fixed` 只表示若真的產生回覆，內容就是這段文字，不表示這次 mention 會被喚醒。
2. 否則，觀看者不是 operator 且該成員是 `operator_personal`：不再加 sidecar 句（badge 已顯示）。
3. 否則，伺服器給 `reply_limit.code = "sidecar_off"`：顯示 `Not enabled · Requires the operator’s computer`。不得暗示訊息已排隊、電腦開了會補跑。
4. 否則不顯示限制句。這包含會走模型的 hosted agent。畫面不保證他們會回。

前端不得用 handle 拼字、功能旗標或部署現況自己推斷限制。`reply_limit` 缺漏時當作沒有限制句，並不得把該成員畫成「不存在」。

### 提及

`Type @ to mention a room member.` 固定在輸入列上緣、與 09 的 Enter 說明同一區。非觸控時 Enter 說明在前，這句在後或次行。觸控裝置只顯示這句。不得放到成員區、時間線或第三處。

`@` 出現在字串開頭，或前面是空白時，打開清單。`@` 後面還沒有字元時，列出這次讀取成功的全體本房 handle。有字元時只留 handle 前綴相符者，不分大小寫，不比對顯示名。清單開啟後若前綴不再相符，立刻關閉。沒有符合時不開清單，也不提供「順便邀請這個人」。

每一項的內容與成員格一致：顯示名（沒有就用 handle）、`@handle`、`human` 或 `agent`、badge 與限制句。比對仍只用 handle。

清單是 listbox，出現在輸入列上方。`textarea` 是 combobox：焦點始終留在輸入欄，不移進清單。用 `aria-expanded`、`aria-controls`、`aria-activedescendant` 指出開關與目前候選。目前候選除了底色，還要有邊框或記號。候選可點按，結果與 Enter 相同。點清單以外關閉清單，已打的字與焦點不變。

鍵盤：上／下只改選取。未按修飾鍵的 Enter 以 `@handle` 加一個空白，替換從這次 `@` 到游標的那段前綴，保留其餘本文，然後關閉，不送出。不得把 `@handle` 接在未完成的查詢後面。Shift+Enter 關閉清單並換行，不送出。Escape 關閉且不改本文。`isComposing` 或 `keyCode === 229` 時，Enter 不選取、不換行、也不送出。清單關著時，Enter／Shift+Enter 維持 09。

切房或連線掉成 `offline` 時關掉清單，並丟掉上一房的候選。

### 邀請

Invite 仍只有 operator 看得到，仍是一張表、一個主要按鈕。Handle 欄位帶 `autocapitalize="none"`、`autocorrect="off"`、`spellcheck="false"`、`autocomplete="off"`。欄位下的說明是 `Enter the handle of an existing person or agent.`

這張表送出的 body 恰好是 `{ "handle" }`。04 仍允許 `member_id` 或 `handle` 二擇一，以及選填 `role`；本章的表單不送 `member_id`、也不送 `role`，伺服器沿用預設 `member`。

handle 解析未停用的 human 或 agent（NOCASE）。停用、不存在 → 404 `not_found`，欄位下顯示 `No such handle.`。滿員 → 409 `room_full`，顯示 `This room is full.`。非 operator → 403，維持 `operator required`。這三種都不關表單、保留已打的 handle，焦點回到 Handle。帶 `role=owner` 且對象是 agent 的請求仍走既有拒絕（agent 不能當 owner）；本章的表單不開這條路徑。

handle 已在房內而伺服器回已是成員：關掉表單並重新 GET。GET 裡看得到該成員即可，不顯示第二次成功文案，也不顯示成邀請失敗。

邀請 POST 成功後關掉表單，並立刻 GET 成員。只有這次 GET 含該 `member_id`，才把新人畫進成員區。邀請的是人類時，成功文案維持 “They will see this room after they refresh.”。邀請的是 agent 時不使用這句；成員區出現他就是成功。本章仍不做成員推播。

POST 已成功但這次 GET 失敗：顯示 `Invitation succeeded. Couldn't refresh members.`，`role="alert"`，並提供只重試 GET 的動作。不得再送一次 POST，也不得在 GET 成功前把新人畫上去。同房若已有上一筆成功名單，錯誤期間仍留著那份名單，不改畫成空房。

### 回應狀態

沿用現有 WebSocket `type=status`。不新增頻道，不 INSERT D1，不佔 seq。`is replying` 與 `reply ended` 只由 hosted generation 路徑送出。sidecar／personal 路徑不送這兩個 body，畫面也不得為了它們顯示回覆中。

hosted 只有在真正開始一次 generation 時，才廣播 body 恰好為 `is replying`。該次完成、失敗或丟棄時，在同一條路徑的收尾廣播 body 恰好為 `reply ended`。使用者送出 `@` 本身不產生這一行。非 operator 對 `operator_personal` 的 mention 仍可落盤，但該次不得因此啟動 generation，也不得由前端自己畫出回覆中。觀看者仍顯示房間裡實際收到的有效回覆狀態。

`{handle}` 來自這次成功的成員 GET：用 status 的 `member_id` 找到 handle。對照不到就不顯示這一行，不得改印 id、`someone`，也不得從 body 猜名字。同時最多一行。較新的 `is replying` 取代畫面上的前一行；前一個人的 `reply ended` 或他的訊息事件只清他自己的那一行，若另一個人仍有效則補上。

畫面：

- body 是 `is replying`：狀態行顯示 `{handle} is replying`。這一行不用 4 秒打字計時清掉。
- body 是 `reply ended`、或時間線收到該成員的訊息事件：清掉該成員這一行。`reply ended` 且沒有同時落盤的訊息時，`aria-live` 再報一次 `{handle} reply ended`。訊息已經出現在時間線時，不再另報這句。
- 切房或斷線：清掉全部回覆指示，不宣稱成功或失敗。
- 自最後一次 `is replying` 起超過 300 秒仍沒有該成員的 `reply ended` 或訊息事件：清掉這一行。過期只表示狀態不再可信，不表示 generation 完成或失敗，也不改報 `reply ended`。300 秒是既有 generation timeout 的上界，不是新的產品承諾。
- 其他 status body 維持今天的打字顯示與 4 秒清除，不得畫成 `{handle} is replying`。

狀態行的容器在有文字時帶 `role="status"`（`aria-live="polite"`），不搶焦點。

### 成員讀取失敗

切房時立刻丟棄上一房名單。同房的 GET 失敗時，若本房已有上一筆成功結果就留著，並顯示 `Could not load members.`，`role="alert"`，加上只重試這個 GET 的 `Retry`。不得把失敗畫成空房間，不得沿用上一房名單，此狀態下 `@` 不開清單。第一次進房就失敗時，同樣顯示這句與 `Retry`，不顯示「沒有成員」。離線時輸入文字仍保留，Send 停用，規則同 09。

## 協定

### handle 邀請 agent

`POST /api/rooms/:id/members` 的 `handle` 改為解析未停用的 human 或 agent。`member_id` 路徑維持現狀。停用帳號仍 404。見 [04](04-protocol.md)。這條取代 M1-MEM-02 裡「agent 的 handle → 404」；落地時改那個測試。

### `reply_limit`

`GET /api/rooms/:id/members` 的每個成員多一個不含秘密的 `reply_limit`。人類是 `null`。agent 是 `{ "code": "fixed", "fixed_text": "..." }`、`{ "code": "sidecar_off" }` 或 `null`。

- `fixed`：若該 agent 實際產生回覆，內容就是 `fixed_text`，與畫面上的句子同一段文字。`fixed_text` 最長 120 個 Unicode scalar；更長時伺服器回 `null`，不回 `fixed`。此欄位不保證本次 mention 會被喚醒。
- `sidecar_off`：personal agent 的執行端未被這次部署標成可用。
- `null`：沒有可顯示的限制。旗標打開或模型路徑存在，都不夠讓前端自己標成可用。

回應不得包含 API key、token、prompt 或 sidecar 路徑。前端以文字節點輸出 `fixed_text`，不截成另一套文案，也不改放進 hover。

### status 生命週期

上節的 `is replying`／`reply ended` 由 hosted 路徑送出，並且 `reply ended` 落在該次 generation 的收尾。其他 status body 仍在 4 秒後從畫面移除。

## 驗收

- **Given** 本房有人類與 agent，**when** 在 ≥768px 或更窄的寬度進房，**then** 沒有可展開的人數控制；成員區常駐且只佔一列；agent badge 文字是 `agent`；`live` 與成員資格都不表示別人在線。名單讀取中看得到 `Loading members…`，且沒有 `@` 候選。
- **Given** 成員名單讀取成功，**when** 輸入 `@` 並用鍵盤或點按操作，**then** 空前綴列出全體本房 handle，有前綴則只留 handle 前綴；候選內容與成員格一致。Enter 替換該段前綴並插入 `@handle` 與空白，不送出。Shift+Enter 關閉清單並換行。Escape 不改本文。點外面關閉清單。中文 IME 組字中的 Enter 不選取、不換行、也不送出。清單關閉後，Enter／Shift+Enter 仍遵照 09。焦點留在輸入欄。
- **Given** operator 用 handle 邀請未停用且未入房的人類或 agent，**when** 邀請成功，**then** 表單 body 只有 `{ "handle" }`，回應含 `member_id`，並重新 GET 成員；GET 成功且含該人之後才顯示。人類仍看到 “They will see this room after they refresh.”。GET 失敗時看到 `Invitation succeeded. Couldn't refresh members.`，重試只打 GET。不存在或停用顯示 `No such handle.`。滿員顯示 `This room is full.`。已是成員則關掉表單並重讀，不顯示第二次成功文案。
- **Given** 房內 Grok 的 `reply_limit.code` 是 `fixed` 且 `fixed_text` 是 `hello from grok`，**when** 使用者送出 `@grok`，**then** 事前看得到 `Fixed reply only: hello from grok`；只有收到 hosted 的 `is replying` 且對得出 handle，才顯示 `grok is replying`；只有訊息事件落盤才進時間線。status 不進 D1、不佔 seq。送出 `@` 本身不顯示回覆中。
- **Given** 非 operator 看 `operator_personal` agent，**when** 打開 `@` 清單或送出 mention，**then** 看得到 `operator-only`，文字仍送出並落盤，該次不產生回覆中。operator 看到 `sidecar_off` 且沒有 fixed 句時，看得到 `Not enabled · Requires the operator’s computer`，沒有補跑的意思。房內若另有真實的 `is replying`，觀看者仍看得到。
- **Given** 成員 GET 失敗，或回覆狀態結束、過期、斷線或切房，**when** 這些情況發生，**then** 不把失敗畫成空房，不沿用上一房候選或名單，也不留下過期的 `{handle} is replying`。`reply ended` 且沒有落盤訊息時，會再報 `{handle} reply ended`。離線時已打的字還在，Send 停用。

前端既有鎖字測試仍過。新鎖的可見字是：`Type @ to mention a room member.`、`Loading members…`、`Members`、`agent`、`Fixed reply only: hello from grok`（當 `fixed_text` 是該句）、`Not enabled · Requires the operator’s computer`、`{handle} is replying`、`{handle} reply ended`、`Enter the handle of an existing person or agent.`、`No such handle.`、`This room is full.`、`Invitation succeeded. Couldn't refresh members.`、`Could not load members.`、`Retry`、既有 badge `operator-only`。
