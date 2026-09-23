# 11 — 房間畫面

[回主 SDD](../../SDD.md) · 協定：[04](04-protocol.md) · 行為：[09](09-human-chat-ui.md)、[10](10-members-and-mention.md) · 驗收：[06](06-verification.md)

## 目的

打開就看得出這是人與 agent 一起說話的房間，並且知道下一步怎麼做。

本章取代 09、10 的畫面契約：結構、層級、色票、元件外觀與本章列出的說明文字以本章為準。兩章保留的行為與協定，在本章沒有改寫的部分仍有效；舊驗收不刪除，畫面斷言改看本章。這是既有能力的畫面切片，不新增 API 或 agent 能力。

依據為 `/tmp/kith-ui-prototype/NOTES.md`、`prototype.css` 與六張原型圖：`desktop-unselected.png`、`desktop-room.png`、`desktop-mention.png`、`desktop-invite.png`（1280×800），以及 `mobile-list.png`、`mobile-room.png`（390×844）。色值取自 CSS，配置與可見文案取自圖；原型 class 名不構成實作契約。圖中人名、房名、訊息本文及時間是示例資料，不寫死為產品內容。

**交付狀態：** 畫面對應本章，實作在 `frontend/`。對應 M1／M2 的房間與成員畫面、M4／M5 的既有限制呈現（FR-01/02/03/06/07/09，INV-11/13/17）。前端測試覆蓋 UI-11-02 的窄列表提示、UI-11-03、UI-11-04／05、UI-11-07、UI-11-12；其餘 UI-11 列仍是契約，沒有逐條獨立測試就不算已執行。本章不改既有 milestone 的驗證狀態，也不是功能完成證據。

## 非目標

New agent、token、metrics、移出成員、attention 設定、附件、公開註冊、已讀／未讀、成員在線名冊、第三欄、管理台、語音、私訊、訊息編輯／刪除、Markdown、富文本 mention chip、`@everyone`、人類成員推播。不改 ambient，不把 Codex 寫成雲端服務，不承諾每次 mention 都有回覆，不增加「排隊中」「稍後補跑」或沒有事件依據的系統訊息。

不複製 EdgeChat 或其他產品的程式、class 名、schema。只採用左列表、時間線與底部輸入的資訊架構。使用既有前端，不加 UI 框架、遠端字型或圖片。

## 畫面

### 平面、色票與層級

桌面用深色 rail 承載選房與身分，右側用暖白紙面承載對話。頂欄、成員區、輸入列與表單都是實心平面，邊界用實線；沒有毛玻璃或 `backdrop-filter`。時間線佔主要空間，成員區與狀態行不搶成另一個面板。

| 用途 | 原型實際色值 |
| --- | --- |
| rail 底／hover／選中底 | `#171b22`／`#232936`／`#2d3545` |
| rail 主字／次字／分隔 | `#eceef2`／`#a3abba`／`rgba(255, 255, 255, 0.1)` |
| 選中房間左條與字首塊／字首塊字色 | `#66c6b6`／`#0c2b27` |
| 紙面／卡片 | `#fbfaf8`／`#ffffff` |
| 主字／次字／提示字 | `#14181f`／`#4b5462`／`#6b7383` |
| 邊界／較淡分隔線 | `#e4e0d9`／`#efece6` |
| 人的動作、主按鈕、焦點／淺底／按鈕字 | `#0f5f57`／`#e4f0ed`／`#ffffff` |
| agent／淺底／邊框及訊息左條 | `#543bc4`／`#efecfd`／`#d7cffa` |
| 限制句與 operator-only 字／badge 淺底／badge 邊框 | `#8a4412`／`#fcf2e7`／`#e9cfae` |
| 自己的 live 連線字與點／pill 底 | `#1a6b3c`／`#e5f3ea` |
| 人類頭像底／字 | `#e7e3db`／`#4b5462` |
| 停用 Send 底／字 | `#d9d5cd`／`#7c8492` |
| rail 焦點 | `#9fd8cf` |

人的動作用 teal、agent 用紫、限制句用暖棕，三個色族不互換。agent 同時有文字 badge `agent`；訊息另用圓形頭像與左側色條，辨識不得只靠顏色。

系統字型順序為 `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif`，不下載字型。基本內文 15px、次級字 13px、標籤與提示 11px、房名／表單標題 17px、Rooms／未選房標題 22px。一般元件圓角 8px、成員卡與提及清單 12px、表單 16px；pill 與 Send 為膠囊形。

限制句、提示與狀態字對比至少 4.5:1，大字至少 3:1。可操作項具有可見焦點（2px 外框），不能被頂欄或輸入列遮住。沿用 10 的最小 24×24 CSS px 操作目標；觸控以 44×44 CSS px 為目標，窄螢幕房間列至少 52px 高。空間不足時減少同時露出的項目，不縮小操作目標。

### 桌面與窄螢幕

斷點以 CSS viewport 寬度計：**≥768px 是桌面，<768px 是窄螢幕**。

- 桌面左欄固定 **280px**，全高深色 rail。上方是 Kith、Rooms、Refresh，operator 的 New room 在房間列表前；列表可獨立垂直捲動。下方固定自己的 `@handle`、operator／member 身分及 Log out。右欄佔餘寬，進房後左欄仍可選另一間，右欄沒有返回。
- 房間列以房名為主，選中有較亮底、左側 teal 條及 `aria-current="true"`。字首塊是裝飾，從無障礙樹隱藏；房間按鈕的無障礙名稱**恰好等於房間名**，不拼人數、選中狀態或字首。
- 窄螢幕未選房時只有全頁深色列表，Rooms 下顯示 `Tap a room to read it and write into it.`；身分與 Log out 在底部。進房後改為全頁暖白聊天，列表不並排，也不留第三欄。頂列返回按鈕可見 Rooms 與返回符號，無障礙名稱恰好 `Back to rooms`；返回後回到列表。
- 重新整理後清除選房：窄螢幕回列表，桌面回左列表加右側未選房畫面。網址不帶 room id。
- 沒有房間時仍顯示 `No rooms.`；非 operator 再顯示 `An operator has to invite you.`。`New room`（包含右欄第二入口）與 `Invite` 只在既有 `GET /api/me` 的 `is_operator === 1` 時出現。

### 尚未選房的右欄

桌面右欄以最大 30rem 的文字區置於紙面中央；標題與導言置中，分隔線以下三步與動作靠左。這是「未選房」，不是「房內沒有訊息」。保留標題 `Select a room.`，依序顯示以下英文，不能改寫：

| 位置 | 可見文字 |
| --- | --- |
| 導言 | `A room is one conversation. People and agents are members of it the same way.` |
| 下一步 | `Pick one on the left to read it and to write into it.` |
| 三步標題 | `What happens in a room`（視覺大寫） |
| 1 | `Everyone in the room is listed under the room name. People and agents, with what each agent can and cannot answer.` |
| 2 | `Type @ to mention a room member. A mention is talking to one member. It is not a promise that they reply.` |
| 3 | `Invite by handle. The account has to exist already. A person you invite sees the room after they refresh.` |

步驟數字用小圓標記，正文維持文字節點。operator 可在三步下方再有一個 `New room`，呼叫與 rail 相同的既有開房動作，不新增 API。非 operator 沒有這個入口。窄螢幕未選房只顯示列表，不把這整段插在列表前。

### 進房後的順序

1. 房名靠左，其右為自己的連線 pill 與 `your connection`；operator 的 Invite 靠最右。窄螢幕在房名前保留返回，非 operator 不顯示 Invite。
2. 成員區常駐在頂列下方，白底、固定一列，不換行；沒有可展開人數控制。
3. 時間線在紙面上垂直捲動。邀請成功等既有 notice 位於成員區下、時間線上，不算回覆狀態。
4. 共用狀態一行在時間線底部、輸入列上方。沒有有效狀態時不渲染文字、不預留高度。
5. 白底輸入列釘在聊天區最底，包含 safe-area；提及清單在輸入區上方。

頂欄內的 pill 文字節點恰好是 `live`、`connecting` 或 `offline`，旁邊另有可見的 `your connection`。pill 內的 **6px 圓點只屬於自己的連線**，顏色跟隨該連線狀態的文字色，不能單獨表達狀態。原型只給 live 的配色；connecting／offline 保留既有狀態語意並由文字明示，不借用 agent 或限制句當成能力判定。離線另保留 `Offline. Reconnecting…`。

**成員卡禁止在線點、綠點、未讀數或其他 presence 裝飾。** 連線 pill 的圓點不能複用成成員狀態；成員資格與 `you` 都不表示成員在線。

### 成員卡與限制句

每次進房重新 `GET /api/rooms/:id/members`，只採用目前房間最新一次讀取的結果。成員區有可見小標 `Members`（可用視覺大寫），橫向名單為 `role="list"`、無障礙名稱 `Members`、`tabindex="0"`；可見小標可從無障礙樹隱藏以免重複朗讀。聚焦後可用方向鍵橫向捲動，端點卡片與焦點不被遮住。

卡片是靜態資訊，不是另一套按鈕。採兩行配置，第一行是 `@handle`、`human` 或文字 badge `agent`，以及必要的 `operator-only`、`you`；第二行只放限制句，沒有句子時不補能力宣告。`you` 只標既有 `GET /api/me` 對應的自己，成員卡與提及選項一致。顯示名若存在仍保留於無障礙名稱；不為它增加第三行。

人類卡是紙面底與中性邊框；agent 卡是淡紫底與紫框。卡片無障礙名稱包含顯示名或 handle、`@handle`、kind、適用的 badge、`you` 與完整限制句。限制句是卡片第二行可見的暖棕文字節點，不藏進只有 hover 才顯示的提示。文字過長可單行省略，但無障礙名稱保留全文。

非 operator 觀看 `quota_class=operator_personal` 的 agent 時，成員卡與提及候選都顯示 `operator-only`；operator 不顯示此 badge。badge 獨立於限制句，即使有 fixed 句也保留。每個 agent 最多一句限制，**依 10 的順序**：

| 優先順序 | 條件 | 第二行 |
| --- | --- | --- |
| 1 | `reply_limit.code = "fixed"` | `Fixed reply only: ` 接原樣 `fixed_text`。例如 `Fixed reply only: hello from grok` |
| 2 | 非 fixed，觀看者非 operator，且成員是 `operator_personal` | 不加 sidecar 句；第一行已有 `operator-only` |
| 3 | 不符前兩項，`reply_limit.code = "sidecar_off"` | `Not enabled · Requires the operator’s computer` |
| 4 | 其餘（含 null 或缺漏） | 沒有限制句，成員仍存在 |

fixed 只表示「若真的產生回覆，其內容是這段字」，不表示此次 mention 會喚醒。sidecar 句不得暗示已排隊、開電腦後補跑。前端只能用 API 的限制與身分欄位，不得由 handle、功能旗標或部署現況推斷；也不得把 `quota_class` 當可見管理欄位。

390px 放不下四張卡是正常狀態。名單一列、不換行、不因人數增加高度，使用橫向捲動；`operator-only` 留在同列卡片第一行，必須捲得見。不能為了全露出而增高、折疊或搬去第三欄，也不要求不捲就露出四句全文。

讀取中顯示 `Loading members…`，不提供提及候選。同房讀取失敗保留上一筆成功名單，顯示 `Could not load members.`（`role="alert"`）與只重試 GET 的 `Retry`，失敗期間不開提及清單。第一次失敗不畫成空房；切房立即丟棄上一房名單與候選，遲到的回應不得覆蓋新房。

### 時間線與輸入

每則訊息以頭像、名字與時間、本文形成閱讀順序。人類頭像是圓角方塊，自己用 teal 底；agent 是紫色圓形頭像，名字旁有 `agent` badge，訊息本文左側有紫色直條。頭像用字首與形狀，不用圖片。正文維持 `pre-wrap` 與長字換行，不解析 Markdown 或 HTML。現有 seq、分組與純文字 mention 呈現規則不變；圖中的示例對話不是系統說明，不自動插入真實房間。

輸入框 placeholder 恰好是 `Message`，按鈕可見字與無障礙名稱恰好是 `Send`。textarea 由一行隨 `scrollHeight` 長高，上限 `40dvh`，不單靠 `field-sizing`；時間線承擔剩餘高度的捲動。空白或非 live 時停用 Send，離線保留草稿。

輸入列上緣放 `Enter to send · Shift+Enter for a new line`，後面或次行放 `Type @ to mention a room member.`。觸控裝置只顯示後一句；不能僅因 viewport 窄就假設是觸控。提及清單關閉時 Enter 送出、Shift+Enter 換行；`isComposing` 或 `keyCode === 229` 時 Enter 不送出。

### 提及清單

依 10 的觸發規則：游標前的 `@` 在字串開頭或其前為空白才開清單。空前綴列出成功讀取的全體本房 handle；有前綴只比對 handle 的不分大小寫前綴，不比對顯示名，不找房外帳號，不提供邀請動作。排序與現有 `filterMentionHandles` 一致：以 handle 的 `localeCompare` 排序，查詢字串改變時目前候選重設為第 0 項。例如圖中依序為 `@codex`、`@grok`、`@guest`、`@owner`。沒有符合或不再符合觸發條件時關閉。

清單為白底、有邊框的 listbox，位於輸入列上方；每項包含與成員卡一致的 `@handle`、kind、badge、`you` 與**同一句完整限制**。桌面限制句靠右，窄螢幕可單行省略，全文仍在選項無障礙名稱中。目前候選有 teal 淺底、實心外框與 `↩` 記號，不只靠底色；選取狀態也由 ARIA 表達。

textarea 為 combobox，以 `aria-expanded`、`aria-controls`、`aria-activedescendant` 指出開關、清單與目前候選，焦點始終留在輸入欄。上／下移動候選；無修飾鍵 Enter 或點按用 `@handle` 加空白替換「本次 @ 到游標」的前綴，保留其餘本文，關閉清單而不送出。Shift+Enter 關閉並換行；Escape 或點外面關閉，不改本文與焦點。IME 組字 Enter 不選取、不換行、不送出。切房或 offline 時關閉，丟棄上一房候選。

### 邀請表單

operator 的 Invite 開啟一張白色表單，標題為 `Invite to {room name}`，一個主要按鈕 Invite 與次要 Cancel。桌面寬度上限 27rem、置中，背景以 `rgba(20, 24, 31, 0.42)` 遮罩壓暗，沒有模糊；窄螢幕適配可用寬度，不橫向溢出。使用具名稱的 modal dialog，焦點進入 Handle、留在表單內，關閉後回到 Invite。

按以下順序顯示原型文案，不新增解釋句：

| 位置 | 可見文字 |
| --- | --- |
| 標題下導言 | `Accounts are created ahead of time. You add one to this room by its handle.` |
| 欄位標籤 | `Handle` |
| 欄位下說明 | `Enter the handle of an existing person or agent.` |
| 說明區標題 | `After you invite`（視覺大寫） |
| 說明區第一句 | `A person has to refresh before this room appears in their list.` |
| 說明區第二句 | `An agent shows up in Members as soon as the list reloads.` |

「After you invite」是靜態說明，不能當事件或通知。Handle 仍帶 `autocapitalize="none"`、`autocorrect="off"`、`spellcheck="false"`、`autocomplete="off"`。送出 body 恰好 `{ "handle" }`，不送 member_id 或 role，不建立帳號。

沿用 10 的成功與錯誤行為：POST 成功關表單並重新 GET 成員，只有 GET 成功且含該 member_id 才畫新人。邀請人類的房內 notice 恰好 `They will see this room after they refresh.`；邀請 agent 不用這句，名單出現他即為成功。再次打開邀請表單不清掉先前 notice，因此可重現圖中表單後方仍有此句的狀態。對方自行重新整理房間列表，沒有新推播。

POST 成功但 GET 失敗時顯示 `Invitation succeeded. Couldn't refresh members.`（`role="alert"`），重試只打 GET，不再 POST、不先畫新人；同房上一筆成功名單保留。已是成員則關表單、重讀，不新增第二次成功文案。不存在／停用 → `No such handle.`；滿員 → `This room is full.`；403 → `operator required`。這些錯誤留在 Handle 下且為 `role="alert"`，保留表單與已輸入值，焦點回 Handle。

### 回覆狀態

10 的 hosted status 生命週期不變。只有真正開始 hosted generation 才送 `is replying`，同一路徑在完成、失敗或丟棄的收尾送 `reply ended`。sidecar／personal 路徑不送這兩種 body。送出 `@` 本身不畫回覆中，也不建立「agent 無法回應」的假系統訊息。

前端以本房成功 GET 的 member_id → handle 對照顯示 `{handle} is replying`，對不到就不顯示，不印 id、someone 或猜名字。狀態行在有文字時為 `role="status"`、`aria-live="polite"`，不搶焦點。打字與回覆狀態共用這一處，同時最多一行。

- 較新的 `is replying` 取代目前顯示；保留各成員有效狀態，某人的 `reply ended` 或訊息事件只清他自己的狀態，另一人仍有效則補上。
- `reply ended` 且沒有同時落盤的訊息時，以 aria-live 再報 `{handle} reply ended`；訊息已進時間線就不重報。status 不插入時間線。
- 回覆指示不用 4 秒 typing 計時清掉；自最後一次 `is replying` 超過 300 秒沒有結束或該人的訊息事件，清掉且不宣稱成功、失敗或改報 reply ended。其他 status 維持既有打字呈現與 4 秒清除。
- 切房、斷線清掉全部回覆指示。非 operator 對 operator_personal 的 mention 仍可落盤，但該次不啟動 generation、前端不自畫回覆中；同房另一次真實有效的 hosted 狀態仍顯示。

### 鎖字與既有表單

登入維持置中表單，標籤與主按鈕為 `Handle`、`Password`、`Sign in`。本章的色票取代舊畫面配色，不新增登入能力。開房仍是 09 的 Name、可留空 Slug、前端產生 slug、既有 POST 成功後重讀並選中新房；409 不背景重試。Log out、Refresh、Cancel 的既有動作不變。

以下鎖字逐字保留，CSS 視覺大寫不能改 DOM 文字或無障礙名稱：`Handle`、`Password`、`Sign in`、`Send`、placeholder `Message`、`live`／`connecting`／`offline`、`agent`、`operator-only`、`Members`、`Fixed reply only: hello from grok`（對應該 fixed_text）、`Not enabled · Requires the operator’s computer`、`{handle} is replying`、`{handle} reply ended`、`Type @ to mention a room member.`、`Enter to send · Shift+Enter for a new line`、`Select a room.`、`They will see this room after they refresh.`、`Enter the handle of an existing person or agent.`、`Back to rooms`、`Rooms`、`New room`、`Invite`、`Log out`。房間按鈕名稱等於房間名。09／10 的既有載入、空列表與錯誤文案仍有效；本章新增說明字只限上述原型的空狀態、邀請導言與說明區、窄螢幕列表提示、`your connection`、`you`。

## 協定

本章**沒有新 endpoint、HTTP body、狀態碼、WS 事件或能力**。[04](04-protocol.md) 與 [10](10-members-and-mention.md) 的協定保持有效：

- `GET /api/me` 提供身分、operator 判定與 `you`；`GET /api/rooms`、既有 `POST /api/rooms` 的 `{ "name", "slug" }` 支援選房及兩個同動作入口。網址不帶 room id 不影響 HTTP path。
- `GET /api/rooms/:id/members` 的 `reply_limit` 仍是 null、`{ "code": "fixed", "fixed_text": "..." }` 或 `{ "code": "sidecar_off" }`，人類為 null。fixed_text 最長 120 個 Unicode scalar，超過由伺服器回 null，不改成另一種形狀。前端只輸出文字節點，不推斷能力。
- 邀請表單只送 `{ "handle" }`；04 允許 member_id 或 handle 二擇一及選填 role 的 HTTP 契約沒有改。handle 仍解析未停用的 human／agent（NOCASE），其錯誤碼與權限不變。
- hosted 使用既有 WS `type=status`，body 仍是 `is replying`／`reply ended`，不寫 D1、不佔 seq；只有已落盤訊息事件進入時間線。畫面不新增 presence、邀請或 sidecar 回覆事件。INV-13 仍由 API／執行端閘門與既有測試保證，badge 不是閘門。
- 回應與文件不帶 API key、token、prompt、sidecar 路徑或任何秘密；Codex 仍在 operator 電腦上執行（INV-11）。

## 驗收

以下是可實作的前端 acceptance contract，**尚未執行**。以受控 GET／POST、WS fixture、fake clock 與可設定的 viewport／觸控條件驗證，不以真 LLM、真帳號或 sleep 證明。固定四名成員 owner、guest、grok、codex 只是 fixture；另用不同 handle 驗證不硬編碼。伺服器落盤／不 dispatch／status 無 D1 等協定證據仍由 06 的既有 integration IDs 負責，前端測試檢查請求與收到的事件如何呈現。

- **UI-11-01 — 桌面結構。給定** 1280×800 與邊界 768px 的已登入 operator，**當** 未選房或切換兩房，**則** 左欄寬 280px，選房、身分、Log out 常駐；選中有左條、底色與 aria-current；右欄依序是靠左房名／自己的連線／Invite、成員、時間線、有效狀態、輸入列。沒有返回或第三欄；名為 Lobby 的房間按鈕無障礙名稱恰好 Lobby。
- **UI-11-02 — 窄螢幕導覽。給定** 390×844 與邊界 767px 的 guest，**當** 看列表、進房、返回、再進房並重新整理，**則** 列表只顯示列表且有 `Tap a room to read it and write into it.`，房間列至少 52px；進房只顯示聊天及名稱 `Back to rooms` 的返回；返回與重新整理都回列表，網址無 room id；沒有 New room 或 Invite。
- **UI-11-03 — 未選房說明。給定** 桌面未選房，**當** 渲染右欄，**則** `Select a room.`、上表的兩句導言、三步標題及三個步驟全文依序可見且逐字相符。operator 若有右欄 New room，兩個入口開啟同一表單且都只走既有開房請求；guest 無此入口。窄螢幕不渲染這個右欄。
- **UI-11-04 — 成員與自己。給定** 成員 GET 成功且 me 分別是 owner、guest，**當** 進房，**則** 可見 Members、兩行配置的卡片、第一行 @handle／human 或 agent，只有與 me 相符的一張有 you，提及選項相同。agent 有紫底卡與文字 agent；沒有可展開人數、成員在線點、綠點或未讀。無障礙名含身分、badge 與完整限制。
- **UI-11-05 — 限制優先順序。給定** fixed、sidecar_off、null／缺漏與 operator_personal 的組合，**當** 用 operator 和 guest 各自看卡片及提及選項，**則** fixed_text 為 hello from grok 時逐字顯示 `Fixed reply only: hello from grok`；guest 看 personal 有 operator-only，若非 fixed 不加 sidecar 句；若同時 fixed，badge 與 fixed 句並存；operator 看 sidecar_off 有 `Not enabled · Requires the operator’s computer` 且無 operator-only。null／缺漏無限制句但仍有成員。改 handle 不改判定，不因送出 mention 宣告會回覆。
- **UI-11-06 — 橫向捲動。給定** 390px、四名成員含 guest 觀看的 operator_personal 及長限制句，**當** 用觸控或聚焦 Members 後方向鍵捲到尾端，**則** operator-only 在同一列捲得見；名單可再以 32 人 fixture 驗證高度不增加、不換行。長句可省略但無障礙名全文不變，端點卡片與焦點不被遮住；不要求四句全文同時露出。
- **UI-11-07 — 自己的連線。給定** 同一名單，**當** 依序注入 live、connecting、offline，**則** pill 的文字節點逐一恰好符合，旁邊一直有 `your connection`；pill 內僅有自己的 6px 點，顏色隨該狀態文字色，卡片不因此新增點或能力句。offline 顯示既有重連句、保留草稿並停用 Send。
- **UI-11-08 — 訊息辨識。給定** 人類與 agent 的已落盤訊息 fixture，**當** 渲染時間線，**則** 人類圓角方塊、agent 圓形頭像／左色條／agent badge 可辨，名字與時間靠近本文；換行保留、長字可換行、HTML 只作文字。未收到訊息事件前不插入原型對話或假的 agent 說明，status 不成為訊息。
- **UI-11-09 — 提及篩選。給定** 本房四人且房外另有人，**當** 輸入 `Thanks — @`，**則** 只列 codex、grok、guest、owner，依 filterMentionHandles 排序，第 0 項為目前候選；改前綴重設選取，只比 handle 不比顯示名。每項 kind、badge、you、限制句與卡片一致。非觸發位置、無匹配時不開清單，也不出現邀請入口。
- **UI-11-10 — 提及操作。給定** 清單已開且游標後仍有本文，**當** 用上／下、Enter、點按、Shift+Enter、Escape、點外面與 IME Enter 各自操作，**則** 分別符合本章替換／換行／關閉規則；選取不送出、不破壞游標後文字，IME 不選不換不送，焦點留在 textarea。combobox 的 ARIA 對應目前選項，選項有實心外框與 ↩；offline 或切房關閉並丟棄舊房候選。
- **UI-11-11 — 輸入列。給定** 觸控與非觸控、空白與非空白草稿、live 與非 live 的組合，**當** 輸入或按鍵，**則** placeholder 為 Message、按鈕為 Send；只有 live 且非空白可送。非觸控先顯示 Enter 說明再顯示 Type @ 提示，觸控只顯示後一句；兩句逐字符合鎖字。清單關閉時 Enter 送出、Shift+Enter 換行、兩種 IME 判定都不送；多行增高至最多 40dvh，safe-area 與底部輸入不被時間線蓋住。
- **UI-11-12 — 邀請說明。給定** operator 在 Lobby，已有一次人類邀請成功 notice，**當** 再開 Invite，**則** 看得到 Invite to Lobby、一張表、一個主要 Invite、Handle 及其既有說明；帳號預先建立導言、After you invite 與兩句說明逐字符合上表。背景仍留 `They will see this room after they refresh.`。焦點進 Handle、關閉返回 Invite；guest 沒有此入口；不產生通知或新事件。
- **UI-11-13 — 邀請生命週期。給定** operator 邀請既有 human 或 agent，**當** fixture 分別回成功、already_member、404、409 room_full、403，以及 POST 成功後 GET 失敗，**則** 只送 `{ "handle" }`，GET 含 member_id 前不畫新人；人類成功句不變，agent 不顯示該句，已是成員不重複成功句。錯誤文案、焦點與保留值符合本章；GET 失敗只重試 GET 並保留同房舊名單，不重送 POST。
- **UI-11-14 — 可信回覆狀態。給定** fixed grok、guest 看 personal codex 與成功成員 GET，**當** 送出 mention，隨後分別注入可對照／不可對照的 hosted is replying，**則** 送出本身無回覆指示；只有可對照的狀態顯示 `{handle} is replying`，在時間線下、輸入列上共用一行，role=status、aria-live=polite。personal mention 的訊息仍可呈現；沒有由該次 mention 偽造狀態，同房其他真實 hosted 狀態仍顯示。
- **UI-11-15 — 狀態清除。給定** fake clock 與兩個 agent 的有效狀態，**當** 較新狀態、前一人的結束或訊息、目前人的結束或訊息、超過 300 秒、斷線、切房各自發生，**則** 只清對應成員並顯示仍有效者；無落盤訊息的 reply ended 只由 aria-live 報 `{handle} reply ended`，已有訊息不重報。4 秒清 typing 不清 replying；過期與斷線不報結束。全部無效時狀態區零預留高度。
- **UI-11-16 — 成員讀取失敗。給定** 首次讀取、同房已有成功結果與切房三種情境，**當** GET pending、失敗、Retry、或舊房回應遲到，**則** pending 顯示 Loading members… 且無候選；失敗顯示 Could not load members. 與 Retry，同房保留舊結果、首次不畫成空房；重試只打 GET。切房丟棄舊名單，舊回應不能覆蓋新房，失敗期間無提及候選。
- **UI-11-17 — 色票與鎖字。給定** 六張圖對應 fixture 與登入畫面，**當** 檢查 computed style、文字與無障礙樹，**則** rail／紙面／動作／agent／限制句符合本章色表，系統字型、無圖片／遠端字型／新 UI 框架、無毛玻璃；操作焦點可見、文字對比符合規則。登入與本章鎖字逐字不變；除本章列出的說明字外，不另增句子。
- **UI-11-18 — 既有房間動作。給定** operator、guest 與空房間列表，**當** 登入後開房、刷新列表或登出，**則** New room／Invite 依 me 權限顯示，空列表保留既有兩句；operator 以 Design 且 Slug 留空建立時送既有 `{ "name", "slug" }`、slug=design，成功重讀且選中新房，409 保留 slug 並顯示 slug taken，不背景重試；Refresh／Log out 走既有動作。桌面重新整理也回未選房，網址無 room id。
