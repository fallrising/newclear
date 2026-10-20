# 跨節點傳輸：設計需求與 Yobiru 0.5 參照

- 狀態：**設計文件**。M1／M2 都只在單機執行，本頁不新增 runtime、AC 或里程碑；跨節點仍屬 [SDD §13](../SDD.md#13-分階段開發與停止點) 的 M3 以後，啟動前須有新的明確工作範圍。
- 決定（owner，2026-10-20）：**只借概念，不採用 Yobiru**。不部署、不把它當 transport adapter，也不接它的 Codex bridge。實際使用 Yobiru 的缺口因此保留，日後若要做需另立工作。
- 參照基準：[chekusu/yobiru@fe39463](https://github.com/chekusu/yobiru/tree/fe39463fbbd8ee51f475820bc7c774febf57aa22)（Yobiru 0.5.3，tailmsg wire protocol v1），查核日 **2026-10-20**；只讀程式與文件，沒有安裝或執行。前一次查核是 [422f40e](https://github.com/chekusu/yobiru/tree/422f40e9497dd0a842c83e6a89a6528568706fdd)（0.3.0，2026-10-11），見 [SDD §1.1](../SDD.md#11-從-yobiru-借鑑什麼)。

證據標記：**【查證】** 讀過固定 commit 的程式碼；**【二手】** 只有上游文件自述；**【推論】** 本設計的判斷。下表連結 `Y:` 代表 `https://github.com/chekusu/yobiru/blob/fe39463fbbd8ee51f475820bc7c774febf57aa22/`。

## 1. 為什麼要寫這頁

[SDD §6.1](../SDD.md#61-messageenvelope) 只寫了跨節點的要求：mutual authentication 加 receiver／worker allowlist，tailnet 只保護 transport。M1 的 inbox／outbox 與 M2 的原生 route 都在單一主機上。Yobiru 是少數實際跑在多台機器上的同類設計，0.3.0 → 0.5.3 又補了請求回執、存取策略與身分恢復，可作為我們訂跨節點需求時的對照。

這頁回答三件事：哪些概念我們已有、哪些要寫進未來的跨節點契約、哪些刻意不採用。

## 2. 0.3.0 之後改變了的事實

| 0.3.0 時的說法 | 0.5.3 的實際行為 | 證據 |
| --- | --- | --- |
| 白名單 `allow` 決定誰能寄 | 新安裝預設 `access_policy: tailnet`：通過 `tailscale whois` 且 Tailscale ACL 放行的節點都能寄；`allowlist` 改為選用；`deny` 一律優先。舊設定有 `allow` 而未宣告模式時沿用白名單，升級不自動擴權 | 【查證】Y:tailmsg.py L18–22、L166–178、L217–246 |
| 不做完成狀態、不做重投 | 0.5 起有可選的請求生命周期：收件持久化後自動 `received`，agent 報 `running`，再報 `completed`／`failed`／`rejected`／`blocked`；逾期記 `timed_out`（結果未知）。回應存進持久 outbox，以固定 ID 重試；跟踪請求沒存最終回應不能 `ack`。**普通訊息仍不重投** | 【查證】Y:tailmsg.py L543–669、L783–812；Y:SPEC.md §10 |
| Grok Bot 整合待驗證 | 上游自述一台手動部署的 Grok Bot 跨機完成跟踪請求；原生外掛安裝與重建恢復仍未驗證 | 【二手】Y:docs/VERIFICATION.md |

沒變的：同一資料目錄共用一個 `inbox/`；`agent` 欄位只決定叫醒誰，不是權限；普通 `batch` 只存不排程【查證】Y:tailmsg.py L281–286、Y:SPEC.md §5.6、§5.9。

## 3. 概念對照

| 概念 | Yobiru 0.5.3 做法 | Workforce 現況 | 處置 |
| --- | --- | --- | --- |
| 穩定 ID 去重 | 同 ID 同內容回 200；同 ID 不同內容或不同對端回 409【查證】Y:tailmsg.py L947–951 | §6.2 以 `(authenticated_sender, message_id, recipient)` 去重，digest 不同拒絕 | 已涵蓋 |
| 送達不等於處理 | 202 只代表已存；`received` 回執不複製正文【查證】SPEC §2、§10 | §6.2 receipt states 分 `stored` 到 `externally_accepted` | 已涵蓋 |
| 逾時即未知 | `timed_out` 不是失敗、取消或可安全重做；晚到的最終回應標 `late`【查證】Y:tailmsg.py L754；SPEC §10 | §7.3、WF-INV-04 | 已涵蓋 |
| 送出結果不明 | POST 中斷時回報「投遞未知」，要求先查同一 ID 再決定，不換新 ID【查證】Y:tailmsg.py L1556–1562 | §7.3 三類重試 | 已涵蓋 |
| 協議回應的持久 outbox | 回執與結果用固定回應 ID 持久重試；送出前重查對端身分與存取策略，身分變了就不送【查證】Y:tailmsg.py L783–806 | §6.2 只寫訊息 outbox，沒寫 receipt 本身的投遞 | **新增 XN-01** |
| 能力協商 | `GET /info` 宣告 `request-lifecycle-v1`；對端不支援時拒絕發送，不悄悄退成普通訊息【查證】SPEC §9–10 | 無 | **新增 XN-02** |
| 先有結果才能 ack | 跟踪請求沒有持久的最終回應或 `timed_out` 就拒絕 `ack`【查證】SPEC §10 | 收件 ack 與工作結果未綁定 | **新增 XN-03** |
| 通知與請求分流 | 通知不要求回覆；協議回應一律 `wake: none`，不進普通 inbox，避免回信迴圈【查證】SPEC §10 | §6.1「receipt 不能引發另一封自動回信」 | **新增 XN-04**（細化） |
| 身分與位址分開 | 每次發送從最新狀態解析主機名；舊回覆、附件授權、待送回應不因同名就轉給新節點【查證】SPEC §1；Y:tailmsg.py L791–795 | 無跨節點位址模型 | **新增 XN-05** |
| 拒絕優先、升級不擴權 | `deny` 在任何模式都優先；無效策略按拒絕處理【查證】Y:tailmsg.py L238–245 | M1 只有可信本機 caller | **新增 XN-06** |
| 入口與業務 session 分流 | 固定 dispatcher 只做收件與協議；業務工作交給同事項的 session，配 `resource_key` 與單一 `lifecycle_owner`。上游明說這只是給 host agent 的指示，沒有實作鎖【二手】Y:docs/DISPATCHER_SESSIONS.md | §2、§7 已有 controller、單一 writer、lease；SessionBinding 一個 turn | 已涵蓋（我們由 controller 強制，不靠 agent 自律） |
| 附件授權 | 發件端掛限時 token，只准收件主機拉；先存 `.part`，大小與 SHA-256 相符才改名【查證】SPEC §4、§5 | §6.1 attachment 由可信 store 拉取並驗 ACL／size／hash／expiry | 已涵蓋 |
| 收件端身分過期 | receiver 在啟動時固定本機節點名，改名或重新登入後過期，要重啟才恢復【查證】Y:tailmsg.py L1488–1505；觀察紀錄【二手】Y:docs/RESTART_RECOVERY.md | 無 | **新增 XN-07** |

## 4. 新增需求（未來跨節點契約）

以下是設計需求，不是 AC，也不代表會實作。編號只供引用；真正啟動跨節點工作時，再依 [verification](verification.md) 的格式轉成可測案例。

- **XN-01 協議回應也要持久投遞。** `stored`、`work_accepted` 等 receipt 與結果要像業務訊息一樣進 outbox，以固定 ID 有界重試；每次重送前重查對端認證，身分不符就停送並留下待對帳狀態。理由：只寫「收件端持久保存」不夠，回執在路上丟了，發件方就只剩逾時。
- **XN-02 能力協商失敗就拒絕。** 節點先宣告支援的協議能力；對端缺所需能力時拒絕送出，不退化成無回執的訊息。要降級必須是發件方顯式選擇並記錄。
- **XN-03 ack 綁定結果。** 對可引發工作的訊息，收件端在持久保存對應的終態 receipt（含明確的 `outcome_unknown`）之前，不得把它標成已處理。
- **XN-04 協議回應不喚醒、不回覆。** receipt／結果不進 worker 的工作 inbox、不觸發喚醒、不能被回覆或 ack 成新工作。這是對 §6.1 既有規則的具體化。
- **XN-05 身分與位址分離。** 認證身分是投遞與授權的鍵；主機名只用來找現在的位址。已綁定舊身分的回覆、附件授權與待送回應不得因同名而轉給新節點；換節點須經可信流程重新綁定。
- **XN-06 拒絕優先、升級不擴權。** 跨節點存取規則中 deny 優先；設定無效時全拒；軟體升級不得自動放寬既有規則。開放範圍由 operator 顯式決定。
- **XN-07 本機身分要能檢測過期。** 收件服務不能只在啟動時讀一次自己的身分；身分改變時要能察覺，並以明確錯誤停止接收，而不是用舊名繼續接受或拒絕。

## 5. 刻意不採用

| Yobiru 的做法 | 不採用的理由 |
| --- | --- |
| 處理者自報 `completed` 就是請求的最終狀態 | 違反 WF-INV-07：外部 Done 只由工作權威決定。自報結果在本設計只能是 `result_produced` |
| `agent`／`from_agent` 自報名稱作路由，同主機共用 inbox | 違反 §6.1：sender 必須由已認證 binding 推導；同主機 worker 之間沒有讀取隔離【查證】Y:tailmsg.py L281–286 |
| Codex bridge 開 `allow_replies` 後自動跑模型並回覆 | 會在 grant／admission 之外多一條執行路徑；它操作固定 Codex thread，也與 M2 不用 latest／resume、自管 SessionBinding 衝突【查證】Y:codex_bridge.py L297 |
| 以 Tailscale 主機身分為唯一認證 | 主機身分只到節點；本設計需要 node 加 worker 兩層，且不把 transport 綁死在單一 overlay |
| 預設 `tailnet` 模式，靠 ACL 收斂寄件者 | 對多 worker 太寬；本設計預設只收已登記的節點與 worker |

## 6. 故障矩陣

Yobiru 欄是參照行為，Workforce 欄是對未來跨節點層的要求。

| 故障 | Yobiru 0.5.3 的行為 | Workforce 要求 |
| --- | --- | --- |
| 重複投遞 | 同 ID 同內容 200；內容或對端不同 409【查證】 | 沿用 §6.2 去重；重複的 receipt 也要冪等（XN-01） |
| 遲到訊息 | 普通訊息不保證順序；跟踪請求逾期後的最終回應更新結果並標 `late`【查證】 | 遲到結果只能附加為觀測，不覆蓋較新 candidate 或已決狀態（§6.2 第 5 點） |
| receiver 掛掉 | 發件端得到投遞未知，要求查同 ID；普通訊息不自動重投；跟踪請求發件前已存 ID 與期限，可稍後刷新【查證】 | 發件 outbox 以同 ID 有界重送；可能已送達的情況先對帳，不換 ID（§7.3） |
| 主機休眠 | 喚醒 adapter 最多試 3 次後放棄，訊息留在 pending；回應 outbox 指數退避、上限 60 秒，待 receiver 恢復後重送【查證】Y:tailmsg.py L1413–1464、L783–806 | 喚醒只是加速提示；controller 恢復後以 inbox／outbox 對帳補回（§7.1），不靠喚醒成功 |
| inbox 損毀 | 列出 inbox 時，解析失敗的 JSON 被靜默略過；跟踪請求只能補回「遺失」的 inbox 檔，不修復內容損壞【查證】Y:tailmsg.py L1717–1725、L763–779 | 損毀不得靜默消失：要列為待對帳項並阻擋依賴它的工作；以資料庫為單一權威，檔案只是投影 |
| 收件身分改變 | receiver 用啟動時的名字，直到重啟；同名新節點不繼承舊授權【查證＋二手】 | XN-05、XN-07 |

## 7. 安全邊界與明確不做的事

- 訊息與附件是資料，不是授權。可執行工作仍要 WorkCommand admission（WF-INV-02、WF-INV-11）。
- 傳輸層的節點認證不能替代 worker 身分；同一節點上不同 worker 若需要不同權限，要靠 OS 使用者、資料目錄與資源端 ACL 分開。
- 公開文件不寫主機名、tailnet 名稱、IP、帳號或 inventory；例子一律用 `<writer-host>` 這類佔位符。
- 本頁不做：選定 transport 實作、部署任何常駐服務、Tailscale 或帳號操作、修改 Kith 的喚醒規則、新增 AC 或里程碑。

## 8. 待決事項

| 事項 | 為什麼要等 |
| --- | --- |
| 跨節點 transport 自建，或另選現成方案 | 取決於 M3 是否真的需要跨機；單機能完成第一場景就不必做 |
| node 與 worker 的 mutual authentication 機制 | 要先決定 controller 是單點還是多點，以及 worker 是否跨 OS 使用者 |
| 每個 worker 是否獨立 OS 使用者與資料目錄 | 影響隔離強度與部署成本 |
| 節點數、訊息與附件上限、回應重試上限 | §6.1 的上限是設計值，跨節點後要依實測重定 |
| 是否日後實際試用 Yobiru 補「實際使用」缺口 | owner 2026-10-20 選擇不採用；要做時另立工作 |

## 9. 來源

- Yobiru 0.5.3 固定 commit：[README](https://github.com/chekusu/yobiru/blob/fe39463fbbd8ee51f475820bc7c774febf57aa22/README.md)、[SPEC](https://github.com/chekusu/yobiru/blob/fe39463fbbd8ee51f475820bc7c774febf57aa22/SPEC.md)、[tailmsg.py](https://github.com/chekusu/yobiru/blob/fe39463fbbd8ee51f475820bc7c774febf57aa22/tailmsg.py)、[codex_bridge.py](https://github.com/chekusu/yobiru/blob/fe39463fbbd8ee51f475820bc7c774febf57aa22/codex_bridge.py)、[DISPATCHER_SESSIONS](https://github.com/chekusu/yobiru/blob/fe39463fbbd8ee51f475820bc7c774febf57aa22/docs/DISPATCHER_SESSIONS.md)、[RESTART_RECOVERY](https://github.com/chekusu/yobiru/blob/fe39463fbbd8ee51f475820bc7c774febf57aa22/docs/RESTART_RECOVERY.md)、[VERIFICATION](https://github.com/chekusu/yobiru/blob/fe39463fbbd8ee51f475820bc7c774febf57aa22/docs/VERIFICATION.md)；查核日 2026-10-20，MIT 授權。
- 0.3.0 查核基準：[422f40e](https://github.com/chekusu/yobiru/tree/422f40e9497dd0a842c83e6a89a6528568706fdd)。
- 本設計：[SDD](../SDD.md) §1.1、§6、§7、§12。
