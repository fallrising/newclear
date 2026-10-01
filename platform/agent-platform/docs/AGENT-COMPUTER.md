# Agent Computer — Cocoon 可見桌面實驗

- Revision：AC-design-0.1，2026-10-02。
- Status：**Proposed / documentation only**。本次未建映像、未啟動 VM、未連接模型、未做實機驗收。
- Scope：`fallrising/newclear/platform/agent-platform` 的獨立 AC 實驗；[SDD §2.4](../SDD.md#24-agent-computer-實驗acproposed) 是範圍入口。
- Goal：做出 CocoonBox 參考畫面的功能效果，不以「成功開 VM」或 headless browser smoke 代替 Agent Computer。

## 1. 目標畫面與完成定義

Owner 提供的參考畫面包含 VM／連線管理、中央的 Linux 桌面與瀏覽器、右側外部 Claude Code 的對話與工具紀錄。畫面標示外部 client 透過 MCP 控制 box，並可見 `browser_snapshot`、`browser_click`、`screenshot` 等動作。這只是產品參考：不能從截圖證明其 VM 所在主機、底層串流協定、模型版本，或每個動作都是純視覺操作；也未確認 CocoonBox 原版 UI／專用 bridge 的公開來源。本文件不公開原始截圖或其中的個人環境資訊。

**完整展示目標：** operator 在一個工作台中選取真實 Cocoon sandbox，看到 1280×800 的可見桌面；外部 agent 接到同一個 sandbox，用自然語言完成瀏覽器任務與原生 GUI 任務；operator 能觀察每一步並取得控制權；離線、保存、休眠、恢復、分支與銷毀各有清楚結果。

| 區域 | 目標行為 | 不能冒充完成的替代物 |
| --- | --- | --- |
| 左側 Computer／Session | 顯示 computer ID、實際 VM 狀態、連線、控制者、期限；提供 Save now、Hibernate、Restore、Release | 只有靜態狀態卡或將聊天結束當成 VM 刪除 |
| 中央 Agent Computer | 同一個可見 Linux 桌面、Chromium、文字編輯器；預設觀看，接管後才能輸入 | headless 瀏覽器截圖輪播或另一個未被 agent 操作的桌面 |
| 右側 Agent | 外部 MCP client 的對話／工具活動與 computer ID 可對應；每步可回看 | 只顯示「完成」文字，沒有工具與結果證據 |
| 工作結果 | 搜尋、選定結果、播放／全螢幕；以及鍵鼠操作原生編輯器並保存檔案 | 只點播放鍵、只看影片標題、以 shell 寫檔冒充 GUI |

第一版可用 Web 工作台整合；外部 CLI 的訊息可經明確 adapter 投影，也可先用有同一 session 標識的相鄰 client 面板驗證。**最終截圖效果 gate 仍須交付整合工作台**，不能把兩個互不對應的視窗列為完整完成。原生 macOS 外殼、品牌像素復刻、音訊串流、GPU／4K 解碼效能、多租戶與手機 computer-use 不在本次範圍。

## 2. 既有基礎與真正缺口

盤點基準是 `newclear@bc869d6d03feb19b9a2b92d0e6f982afba8ff233`。下表的「已驗收」只引用原紀錄的範圍，不是本次重跑結果。

| 項目 | 已有證據／觀察 | AC 尚需完成 |
| --- | --- | --- |
| VM 執行與隔離 | [KVM-VALIDATION](KVM-VALIDATION.md)：Cocoon 0.6.7、sandboxd 0.1.12，固定單節點、none lane、4 vCPU／4 GiB；boot、relay、隔離、TTL、release | desktop image、顯示／輸入、同 session 身分與復原的獨立驗收 |
| Coding 工作台 | [SDD §15](../SDD.md#15-里程碑與交付)：M0–M2 passed；M3 部分完成，M4 未開始 | Agent Computer 視圖與控制契約；不改寫既有里程碑 |
| 真實 VM 與模型 | [HANDOFF](HANDOFF.md) 開頭的 2026-09-27 紀錄：真實 VM＋固定 FILE／TEXT fixture；[HTTPS provider](M3-HTTPS-PROVIDER.md) 的本機 TLS mock 成功 | 真實 MCP client／模型對自然語言與畫面的行為驗收；mock 通過不等於模型能力 |
| 模型通道 | [M3-GUEST-MODEL](M3-GUEST-MODEL.md) 限文字及 terminal／finish／think，未支援 multimodal | AC 先用 VM 外的 agent；日後接回現有 proxy 須另設影像與工具契約 |
| 瀏覽器上游 | pinned [browser 文件][browser] 有 headless Chromium、guest loopback CDP 9222、ProxyPort／DialPort | headed Chromium、桌面觀看及統一控制 bridge；不能直接當作桌面映像 |
| MCP 上游 | pinned [MCP 文件][mcp] 與 [工具註冊][tools] 有 VM／exec／檔案／checkpoint 等工具，沒有上述 browser／desktop 工具 | browser structured control 與 screenshot／keyboard／mouse 的受控封裝 |

9 月 24 日的 EACCES／舊 journal 停止點已由後來的 HANDOFF 與 HTTPS 文件更新；不把舊 `CONTINUATION-STATE.md` 的歷史狀態當成本次新阻塞。這也不授權清掉新的未知 allocation：新實驗仍須按既有對帳規則處理。

## 3. 擬議架構與責任

以下是 **本實驗的設計**，不是上游現成的 CocoonBox 安裝拓撲。

```text
Operator browser                         External agent on operator machine
  │ authenticated viewer / controls        │ MCP (pinned tool profile)
  └───────────────────┬────────────────────┘
                      ▼
       ComputerSession controller + tool bridge
       identity / input ownership / deadlines / journal
          │ viewer relay          │ CDP + desktop-tool relay
          └──────────────┬────────┘
                         ▼
          authorized sandbox SDK → sandboxd → vsock → silkd
                                                       │
                                  Cocoon MicroVM        ▼
                    ┌──────────────────────────────────────────┐
                    │ one virtual display + window manager     │
                    │ one headed Chromium (loopback CDP)       │
                    │ editor / screenshot / keyboard / mouse    │
                    │ loopback viewer service (VNC candidate)  │
                    └──────────────────────────────────────────┘
```

**Runtime** 負責 VM、資源、快照與回收；**ComputerSession controller** 擁有 sandbox handle、生命週期與持久身分；**tool bridge** 將 browser／desktop 動作限定到該 session；**viewer** 顯示相同 display；**外部 agent** 負責模型推理。SDK 上游服務與本平台保持獨立，不重寫 hypervisor，不把 host shell 當 fallback。

桌面映像候選是 Ubuntu＋虛擬 X11 display（例如 Xvfb）＋輕量 window manager＋headed Chromium＋文字編輯器。觀看通道候選是 VNC／noVNC，實作前固定版本與認證方式；本文件不是宣稱上游已內建這一組 desktop flavor。顯示不需要物理螢幕，但不據此承諾 GPU、影片流暢度或音訊。

部署候選是專用 Linux/KVM worker。若放在 hypervisor 管理的 Linux VM 內，必須針對該 nested-KVM 拓撲重新驗證 `/dev/kvm`、cgroup、vsock 與快照能力；舊的 bare-metal M0 不替新環境背書。不把桌面服務直接裝進虛擬化宿主機，也不為此變更主機權限。

## 4. 最小控制契約

### 4.1 身分與三條通道

每個 `ComputerSession` 保存固定 `computer_id`、sandbox binding／generation、image digest、`display_id`、Chromium instance／profile identity、policy revision、deadline。client 不得傳任意 host、port、路徑或另一個 sandbox ID 替換綁定。

1. **觀看**：短效、session-scoped viewer 憑證，只讀。畫面附 computer／display 身分、frame sequence、擷取時間；斷線顯示 stale，不把舊畫面當 live。
2. **瀏覽器工具**：由 bridge 經 `ProxyPort`／`DialPort` 連到該 guest 的 loopback CDP；browser snapshot／click 用結構化頁面資訊。上游 [browser 文件][browser] 說明 preview URL 的 Host 重寫與 CDP 不相容，不能把任意 preview URL 填成 CDP endpoint。
3. **桌面工具**：screenshot、pointer move／click、scroll、key、text input；固定 display，不接受任意 shell。這才驗證非 DOM 的視窗與原生程式操作。

瀏覽器控制、桌面 screenshot 與 viewer 必須對應同一個 Chromium／display。Chrome 未 ready、CDP 斷線或 handle 不明時返回明確錯誤，**不能開本機瀏覽器、另一個 headless instance 或新的 VM 頂替**。原生 GUI 驗收 profile 關閉 shell／檔案寫入與 CDP 改頁工具，避免繞過待測行為。

截圖回傳原始寬高、輸出寬高及 frame ID；縮放後的座標必須依明確轉換映射到實際 display。過期 frame、display resize、越界座標、stale page element ref 皆拒絕並要求重新觀測，不靠無界盲點擊修復。文字輸入與剪貼簿分開授權，預設不共享 operator 剪貼簿。

### 4.2 單一輸入者與人工接管

所有寫入入口共用 `control_epoch` 與輸入 ownership：`agent`、`operator` 或 `none`。結構化 browser click、桌面鍵鼠和 viewer 的遠端鍵鼠都是寫入；不能只在 UI 禁用按鈕，卻讓原始 CDP 或 VNC input 繞過檢查。

接管時先停止新 agent 動作，排空或確認當前 input 收尾，再增加 epoch、撤銷舊 token、移交控制。回覆未知的在途動作保持 `control_transition_unknown`，不得同時放行第二個 writer。人交還控制後，agent 先取新 snapshot／frame，舊 epoch 的佇列動作一律失效。

記錄 `operation_id`、動作摘要／參數 hash、epoch、before／after frame references 與 `completed / failed / unknown`。唯讀重取可重試；點擊、輸入、送出表單的 ACK 遺失不得自動重送。事件重播只更新畫面與歷史，不再執行工具。單靠 fencing 不會撤銷已送到應用程式的副作用。

### 4.3 外部 client 與模型邊界

第一個可驗收 client 以外部 Claude Code／MCP client 為方向，實作前固定其版本、工具 manifest 與允許權限。模型認證留在 operator 的受控環境，不複製到 guest；預設開發仍用 mock，不因本文件自動使用現有登入或付費額度。

外部 CLI 自己可能仍有本機 shell／檔案能力；**有 VM 不代表該 CLI 的所有行為都被隔離**。AC profile 必須限制本機工具，只授權指定的 bridge；不能停用的能力需明列並另經 owner 接受。原生 GUI 的視覺模型 adapter 與 Claude Code 的一般 browser MCP 能力分別驗收，不把名稱相同當成原生 computer-use protocol 已相容。

## 5. 生命週期：電腦不等於聊天 session

上游 [sandbox-mcp][mcp] 在 MCP client 斷線／server 退出時會釋放其 session 配置的 sandbox。**原樣使用這項退出政策，不符合保留桌面的產品目標。** AC controller 必須獨立持有 claim；MCP client 只拿可撤銷的連線授權。這是待實作差異，不是宣稱目前已支援永久桌面。

| 操作 | 擬議行為 | 驗收所需證據 |
| --- | --- | --- |
| Disconnect | 關閉該 client 工具 admission；保留同一 computer／VM 到既定 deadline；顯示仍占資源 | 重接得到原 binding 與文件，不重新 allocate／重送初始任務 |
| Save now / Checkpoint | 先阻止新輸入，確認安全邊界，再保存版本化快照並返回 checkpoint ID | 綁 source computer、image/runtime compatibility、時間與結果；未知結果先對帳 |
| Hibernate | 經 capability gate 保存 VM 狀態再停機；成功後才顯示 hibernated／歸還可證明釋放的資源 | VM 已停止、checkpoint 可定位；失敗仍保留 cleanup／state unknown |
| Restore | 從同一受支援狀態恢復；輪替控制憑證，重新建立 viewer／CDP，先觀測再允許輸入 | 文件／視窗恢復，舊連線與舊 epoch 不再可寫；不重播點擊 |
| Branch checkpoint | 新 computer ID 與獨立可寫磁碟；parent 保持原狀 | 原與分支寫同名檔案互不覆蓋，token／journal 身分不共用 |
| Release | 獨立確認的破壞性銷毀；撤銷 tools／viewer，再核對 VM、claim、runtime dir／cgroup／relay 清理 | 停止與資源消失證據完整；unknown 不標已釋放 |

Agent pause 只代表不再接收新動作，不等於 VM hibernate。Web 網頁的 timers／網路請求也不一定隨 agent pause 停止。

快照可包含 cookie、登入狀態、未保存文件與記憶體秘密。第一輪只用 synthetic fixture 與未登入瀏覽器；快照與影片證據存私有目錄，權限／保留／刪除策略需列入 profile。分支前重新綁定控制身分，不能把原 computer 的操作權複製給 child。

VM 回復只能回復 VM 內狀態，不能撤回外部網站已完成的交易、發文或表單。網站登入／網路連線過期後重新驗證，不承諾跨版本快照、既有 TCP session 或無限續租。初始設計採單 computer、有界 deadline（不超過既有兩小時實驗窗口），恢復／休眠不自動重設期限；實際支援的 TTL 由下一階段的 pinned runtime 驗證。

## 6. 網路、安全與版本閘

### 6.1 優先保留 none lane

pinned [egress 文件][egress] 提供 guest loopback proxy → vsock → host-side policy 的 none-lane 出站。沒有 NIC 不等於不能存取獲准的網站；瀏覽器必須明確配置代理並驗證實際流量，不假設它必然繼承 shell 的 proxy 環境。

同一文件指出 guarded `net=egress` lane 拒絕 hibernate／fork／checkpoint／promote（409），避免 restore 後重新鎖 NIC 前的暴露窗口。因此 AC 初選 **none lane＋受控 proxy**，不為了上網靜默切到 NIC lane；實作使用不同 revision 時必須重新核對此能力矩陣。

先把 deterministic fixture 放在 guest 內，用 guest loopback 服務。真實網站是另行 opt-in 的 allowlist：YouTube 相關頁面／媒體目的地由實際網路觀察收斂，未批准的目的地保持拒絕，不能用 `*` 或全面私網放行求通。CONNECT 是目的地 tunnel 授權，不等於能限制其內所有 HTTP 方法或業務副作用。

### 6.2 不擴大的邊界

CDP、VNC、desktop input、sandboxd 不公開到 Internet；入口經受認證的私網／loopback relay。Viewer 與控制面使用隔離 origin／明確訊息 allowlist，guest 頁面或任意 Markdown 不可在控制面 origin 執行。對話或工具文字不能改 node policy、端口 mapping 或 export 授權。

不掛 operator home、瀏覽器 profile、Docker socket、DB、其他 VM 的目錄或 provider master key。guest 的應用帳號與控制服務帳號分離，服務只得到固定 display／loopback 能力；不給通用 root API。Prompt injection、惡意頁面與模型誤判仍是風險，VM 隔離不能替代工具權限與外部副作用控制。

### 6.3 版本與能力登錄

| 層 | 此次可引用的基準 | 實作前必須固定／驗證 |
| --- | --- | --- |
| 現有 coding adapter | KVM 文件中的 Cocoon 0.6.7／sandboxd 0.1.12／OpenHands 1.49.2 | 保留原 lane 與驗收；不能原地升級活躍環境 |
| 新 browser／lifecycle 研究 | `cocoonstack/sandbox@90230c072781a387114bff4bf37f9907d285702b` | Cocoon、sandboxd、silkd、SDK 必須是相容的一組；tag／commit／binary SHA／協定 |
| Desktop image | 新方案，尚無已驗收 digest | OS、display／WM、Chromium、editor、viewer／input service、image digest |
| MCP / client | 外部 client＋受控 bridge，尚未實測 | client／bridge／browser adapter 版本、工具 schema hash、連線退出政策 |
| Checkpoint | 僅限待驗證的 AC profile | runtime／image／lane／host topology compatibility；不通過就禁用 |

文中 `browser:24.04` 只代表上游 flavor 名稱，不是不可變映像 pin。下一階段需解析並記錄 image digest；不使用 `latest` 或文件存在作為驗收。

## 7. 分階段交付與停止點

| 階段 | 交付與依賴 | 階段邊界 |
| --- | --- | --- |
| AC-0 文件 | 本文＋README＋SDD 邊界；功能目標、資料／控制／生命週期與驗收 | **本次僅至 Draft PR**，實機測試全部 Not run |
| AC-1 相容性設計與前置 | 釘版本、目標主機／資源、工具 manifest、CDP／viewer 身分與 mock 契約；讀現行 runtime 能力 | 另行授權；不借用舊版本的測試通過假定新 lane 可用 |
| AC-2 Guest 與 adapter | 構建 desktop image、同一 headed browser／display、viewer、desktop tools、受控 port relay | 另立實作切片；component／unit checks 不算完整 E2E |
| AC-3 工作台與接管 | 三區工作台、外部 client 接線、單 writer、connection/VM 狀態分離、工具與畫面紀錄 | 依 AC-2；mock 與 live 標籤明確，不用靜態 UI 宣告 parity |
| AC-4 生命週期與最終驗收 | checkpoint／hibernate／restore／branch／release、故障場景、安全負向案例、真實 client 展示 | 完成開發後，一輪明確授權的完整 E2E；失敗保留證據並修復，不隱藏失敗 |
| 後續平台整合 | 視結果設計 ComputerSession 與 task/run、artifact、排程及多模態 provider 的 adapter | 非本次授權，不將 AC 局部成功等同 M3／M4／M6 完成 |

遵循目前「先完成開發，最後做完整端到端驗收」的工作節奏。本次不執行 browser E2E、KVM smoke、實機長任務或模型呼叫；後續中間切片可做單元／契約／元件檢查，完整 E2E 需另行確認主機與外部帳號授權。每個階段輸出版本、diff、已跑／未跑檢查、限制與下一個具體入口。

## 8. 最終驗收表（目前全部 Not run）

| ID | 方法與可觀察通過條件 | 必留證據 |
| --- | --- | --- |
| AC-AT-01 真實 guest | 顯示實際 computer／VM 身分；在 guest 開頁面，operator 本機瀏覽器不被啟動／操作；失去 relay 不 fallback | binding、process／browser identity、negative case |
| AC-AT-02 同一桌面 | viewer、desktop screenshot、CDP 指向同一 display／Chromium；切頁／改視窗三方同步可觀察 | frame IDs、同頁 nonce、browser target ID、時間序列 |
| AC-AT-03 結構化網頁 | 真實 client 按自然語言在 guest fixture 搜尋、選指定元素、填表；stale ref 拒絕後重取 | 脫敏工具紀錄、fixture server 最終狀態；不是 shell curl 代跑 |
| AC-AT-04 原生 GUI | 以 screenshot＋鍵鼠開編輯器、輸入指定內容、使用保存對話框；關閉 shell／檔案寫入與 CDP 捷徑 | 畫面／input trace、產出檔 hash／內容，由獨立 verifier 讀回 |
| AC-AT-05 影片效果 | guest 瀏覽器搜尋／選定目標、開始播放、切全螢幕；兩次觀測證明目標播放時間推進，且不是只播放廣告 | URL／title、播放時間、fullscreen state、不同時點畫面；不承諾 4K |
| AC-AT-06 接管 | 預設 viewer input 被 server 拒絕；operator 接管時舊 epoch 的 agent browser／desktop 寫入均拒絕 | admission／epoch 紀錄、在途未知時停在 transition、交還後新 snapshot |
| AC-AT-07 斷線 | 關閉 MCP client 再連回仍是原 VM／未丟文件；到期則明確不可恢復，不默默新建 | 原 binding、期限、allocate 計數、重新授權紀錄 |
| AC-AT-08 保存與休眠 | 保存、休眠後 VM 確實停止；恢復視窗與未保存內容、重新接 CDP/viewer；舊 token 拒絕 | checkpoint ID、相容性、停止／恢復證據、舊憑證負向測試 |
| AC-AT-09 分支隔離 | 從保存點分支，parent／child 同名文件不同內容，跨 session 工具與 viewer token 被拒 | 兩組 binding／hash、parent 不變、token 隔離 |
| AC-AT-10 清理與故障 | release 後 VM／claim／資源／relay 清零；重複 release 不另作用；未知 allocation／ACK 不重複配置或輸入 | 獨立 stop proof、operation journal、unknown／超時場景 |
| AC-AT-11 網路與內容 | 未批准站點、metadata／私網被阻擋；惡意頁面不能更改 bridge target／policy；resize／越界座標被拒 | proxy denial、跨 session／stale revision 拒絕、無秘密公開輸出 |
| AC-AT-12 整合工作台 | 一個工作台具 computer 管理、live desktop、可對應的 agent 對話／工具紀錄；每個 disabled／unknown 有原因 | 實際全畫面錄影、狀態轉換、owner 逐項核對 |

AC-AT-05 先以可控制的 guest 影片 fixture 做穩定驗證；真實 YouTube 搜尋／播放是額外、明確允許的展示段。網站阻擋、廣告、登入或網路政策不滿足時記 blocked／not run，不能繞過，也不能宣稱 YouTube 展示已通過。**只有真實外部 client、可見桌面、非 DOM GUI、生命週期與整合工作台均有證據，才能稱為功能等價展示完成。** 文件審閱通過不代表這些 gate passed。

## 9. 證據與接手方式

每輪驗收至少記錄：source commit／image digest／runtime 與 MCP 版本、host topology（公開版本只用代稱）、model/client 的實際識別、工具 profile／policy digest、computer IDs、case IDs、輸入與預期、actual result、frame／log／artifact hashes、清理結果。明確分開 `fixture-only`、`real-client`、`real-model` 與 `external-web`；任一 skipped／unknown 不計為 passed。

原始錄影、頁面內容、對話與 checkpoint 預設私有。公開 evidence 只放已檢查的 synthetic 資料、摘要與 hash，不附 token、cookie、私人主機位置或帶帳號的畫面。缺少證據時不以模型自己的文字報告成功；保存檔案、播放狀態與 VM 清理各由獨立觀測核對。

接手入口是先讀 [SDD](../SDD.md)、本文、[KVM 主機文件](KVM-HOST.md) 與 [HANDOFF 最新段落](HANDOFF.md)，再核對新任務所授權的階段。AC-1 開始前須具體確認目標 worker、pinned runtime 組合、viewer／MCP 工具版本、期限與外部 client 使用範圍。這些是實作輸入，不阻止本次文件交付，也不授權自動開始下一階段。

## 10. 可追溯來源

本地現況以第 2 節所列 repository 文件為準；上游觀察固定於 `90230c072781a387114bff4bf37f9907d285702b`，不是「latest」保證。Xvfb／window manager／VNC／noVNC 是本方案的候選組裝，不聲稱是參考截圖的實際實作；具體套件版本與安全設定留到 AC-1 釘選。

[browser]: https://github.com/cocoonstack/sandbox/blob/90230c072781a387114bff4bf37f9907d285702b/docs/browser.md
[mcp]: https://github.com/cocoonstack/sandbox/blob/90230c072781a387114bff4bf37f9907d285702b/docs/mcp.md
[tools]: https://github.com/cocoonstack/sandbox/blob/90230c072781a387114bff4bf37f9907d285702b/mcp/tools.go
[egress]: https://github.com/cocoonstack/sandbox/blob/90230c072781a387114bff4bf37f9907d285702b/docs/egress.md
