# P05：以一份盤點觀測作為 Signal Hub 首個來源

2026-11-22 文件提案；沒有送出事件、註冊來源或啟動實例。產品進度以 [STATUS](STATUS.md) 為準，原 [SUCCESS AC-04][hub-success] 與 [M6 個人使用條件][m6] 保持 pending。本頁只把一個有用來源及其旅程固定下來，不另建平台或第二個 adapter。

## 選擇與來源證據

選擇 **既有 CF inventory producer 的一次完成觀測摘要**：同一份 `cloudlab.inventory.v1` 報告可供 Cloud Lab 看板及 Hub 各自消費。不是輪詢 Cloud Lab D1、不是在看板上傳時發明新事件，也不把每次轉換當成新觀測。用途是由時間線查「最近一次盤點哪些區段可讀、哪些 unknown、有哪些 drift 數量」，不宣稱資源健康或完整帳號盤點。

公開來源固定於 newclear `6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3`。從原規劃 `2aa21f10b53ecaeb079279b6531bbb47a103e937` 到此，Signal Hub／Prism／Wotar 相關來源不變；Cloud Lab 只新增 P04 對帳，相關 runtime 不變。私人來源 P-CF 的 pin／path／hash／差異留私人 P05 交接證據，公開不附私人 repo 路徑或報告。

| 來源／原 AC | 已有事實與證據層級 | 採用／不採用理由 |
| --- | --- | --- |
| [Hub SUCCESS][hub-success]、[README][hub-readme]、[STATUS][status]；AC-01～03／SDD01、02 | M1–M5 已有 token ingest、不可變身分、查詢／看板、重啟持久、備份／隔離還原的歷史功能證據；AC-04 真來源實例仍待驗 | 沿用原引擎及 M6 單來源旅程，不建新 API／queue／schema |
| [Cloud Lab SUCCESS][cloud-success]、[README][cloud-readme]、[ML 證據][ml]；IR／MC／ML | inventory→D1→看板已交付；ML 只有當時的部分可讀快照，Pages／Tunnels403仍 unknown | 選其原報告作另一個 consumer 的輸入；不重做 collector、不動 desired、不刷新觀測時間 |
| [CA 主機 agent 設計][ca]；CA-03 | 多VPS telemetry 尚未實作，現有 runner 不可複製身分擴機 | 不以未存在的 telemetry 來源阻擋本次單來源提案 |
| P-CF 私人 producer／事件工具；原來源 AC-01／02 | 固定報告→離線 aggregate CloudEvent、已保存檔→同機 loopback 單次 sender 已存在；另有真 Hub 程序的合成 ingest／restart／snapshot／isolated restore 證據 | 重用已存在工具；合成機制證據不等於真來源、持久部署或實例備份。本次不改工具或重跑旅程 |
| [Prism SUCCESS][prism-success]、[README][prism-readme]；AC-03／04／05 | 規則／eval 函式庫有歷史證據，daemon eval 接線與完整觀測仍有缺口 | 不等待 Prism；Hub 保存事件不替 Prism 評估外部告警 |
| [Wotar SUCCESS][wotar-success]、[README][wotar-readme]；AC-01～05 | MQTT endpoint E2EE／keyring／replay 與持久 inbox/outbox 是另一個已完成但休眠的範圍 | 不採作此 HTTP 來源的傳輸前置；Hub token／SQLite／tailnet 不等於 MQTT E2EE，不恢復 Wotar 開發 |

既有 [source integration][sources] 是通用來源範例，未固定此 inventory 的身分、allowlist 及實例旅程；因此需要本頁的小型比較與來源提案，無需另寫完整 ingest／restore 規格。若實際用途或來源授權不成立，停下重選已存在且有用的 release／inspection 來源；選 Alertmanager 時須先核對其固定身分與動態 annotations 的409相容性。不能用三個合成來源冒充一個真來源。

## 身分、時間、隱私與單一權威

| 欄位／邊界 | 本來源的明確選擇 |
| --- | --- |
| source／type | 實際 sender 沿用既有 converter 固定 source；只允許 `inspection.inventory.observed`。公開例子使用 `urn:example:inventory` 代稱，不是新正式 URI、不要求修改現有輸出。精確私有映射及 token scope 留正式接入紀錄 |
| source token | 每來源獨立檔案引用；producer 不能查詢，owner／readonly 不能 ingest。Hub `source_prefix` 是字面前綴授權，不是 exact equality；須核對命名碰撞與未授權後綴，不宣稱固定 sender 會把 token 自動縮成 exact scope |
| event id | caller 對每次完成觀測分配一次小寫 UUIDv4，連同原報告保存；相同觀測的轉換／重送沿用同 ID，同內容／時間的不同觀測仍是新 ID。重複轉換不是新觀測，內容 hash 不代替觀測身分 |
| provenance | 私人帳本保存原報告 SHA256、observation UUID、producer／converter／sender 的固定版本、精確輸出 bytes SHA256、Hub seq／receipt 與設定版本。`data.source_revision` 只取原報告聲明的 producer hash，不是 provider 簽章或完整報告／轉換器 hash；不新增 wire 欄位 |
| observed／received | `time = data.observed_at`，保留原 `started_at`；Hub 自行記 `received_at`，事件不得填 hub metadata。晚到照原時間入庫；原事件超前 received 超過5分鐘按 Hub 既有 clock_skew 警告，不借用 CA 的30秒拒絕規則 |
| freshness | 手動來源不設虛構 expected_interval。Hub 的來源 freshness 是認證來源的接收狀態；合法 duplicate 可刷新來源最後收到時間，卻不刷新原觀測、不新增事件，不代表新盤點或健康；never／unknown 與錯誤不能變成正常 |
| privacy allowlist | envelope 只用 specversion／id／source／type／time／datacontenttype／固定 summary；data 只用 schema_version／started_at／observed_at／source_revision／固定六段 kind、state、安全 error、present_count、missing_count、四種 drift_counts。unreadable 的三個計數欄位是 null，不是0 |
| 排除資料 | 不傳 resource names／use／domains／帳號／URL／token／provider raw body／原始錯誤文字；沒有 subject、originurl 或原報告附件。Hub 可擴充欄位不代表此來源可以多傳。aggregate 數量仍可能敏感，只留私人實例 |
| writer | P-CF 保留 desired／collector／原報告權威，Cloud Lab 保留 D1 快照，Hub SQLite 只擁有本層事件及其投影。任何 consumer 都不取得 host／catalog／workload writer、告警決策或外部 Done |

報告上限沿用 200 resources／24576 UTF-8 bytes；輸出 data ≤16384 canonical bytes，sender 的事件檔 ≤24576 bytes。轉換器只輸出合法窄欄位；Hub 仍自行驗證其契約，不把 producer 自述當 provider 認證。參見 [SDD01][ingest]、[來源接入][sources]、P-CF 與 [Cloud Lab 對帳][audit]。

## 最小旅程：供後續正式接入選定，不是本次執行紀錄

以一份完成的觀測 **E** 為共同對象。實際 source、instance、service user、報告、DB／備份位置與 credential refs 由 owner 在私人操作範圍中選定；不從本頁推導主機操作批准。

| 步驟／原 AC | 後續需保留的可觀察證據 | 停止／失敗處理 |
| --- | --- | --- |
| 0. 選定來源／實例；M6-2／3 | 報告用途、敏感度、版本與觀測時間；非root、既有 loopback／tailnet-only 入口、明確持久 DB 與備份位置、三角色分離；來源設定仍經 PR | 真報告外送、token／設定、安裝或網路變更未批准即停止；不順手改 OneFleet、Cloud Lab 或 provider scope |
| 1. 保存再 ingest；SUCCESS AC-01、SDD01 AC-01～04 | 原報告＋一次 UUID＋converter 原始輸出保存後，由既有 sender 對明確同機 loopback endpoint 發一次 POST；202回正 seq，保存 receipt；API查詢／時間線顯示 source、id、type、time、received_at、完整摘要 | 不直接 pipe collector 到網路；不能把 converter exit0或 sender stdout 保存失敗當作完成。若遠端 tailnet 傳送才可用，現 sender 不支援，另定傳輸方案，不放寬它 |
| 2. 同文重送及角色；SDD01 AC-01～03 | 再送同一 bytes 得200、duplicate:true、同 seq；角色／跨source403；同source+id不同canonical內容409且原事件不變 | timeout／無回執表示可能已提交；保留 bytes、hash、ID，先核對，再由 operator 有界重送；不新造ID掩蓋409 |
| 3. 同實例重啟；SUCCESS AC-01／04 | 經具名批准重啟同一持久資料實例，**先查詢 E 再重送**；E內容、原seq均在，再送仍200同seq | 重送前查不到 E 就是持久化缺口；不能先重送補寫再宣稱重啟保留；不是斷電耐久證明 |
| 4. 該實例備份；SUCCESS AC-03／04、SDD02 AC-14 | 明確啟用原 backup-dir 或選定備份方式；一致 snapshot＋manifest完整、size/hash核對；確認備份包含 E，記產生時間與資料損失容忍度 | 未帶備份設定不假設自動備份；不複製正在運作的 DB 單檔冒充一致備份，不默認可丟24小時資料 |
| 5. 新位置隔離還原；同上 | 原檔保留，校驗 snapshot／schema後僅還原到全新 DB；啟動前隔離網路出口、替換角色憑證與所有外送目標，最小方案無訂閱；查詢備份內的 E／原seq，再原文重送仍200同seq | 不覆寫原DB／既有目的地；錯hash／缺manifest停止。新副本不可用真通知目標啟動；未配置訂閱只驗事件恢復，不宣稱 queue 恢復 |

重啟／備份前後以同一來源版本及 E 配對；只對 snapshot 已含事件要求保留原 seq。snapshot 後事件的遺失須由原保存報告／事件逐一對帳，不能保證舊 seq 或宣稱回退消除了未知外部效果。具體工具入口沿用 [runtime][runtime]、[M6 設計][m6-design]、[M5 設計][m5]及[非root Docker 包][docker]，不建立另一套命令或部署框架。

傳送結果處理：202保存 receipt；200必須 duplicate:true 且核對原seq；傳輸中斷／429／503由 operator 保留同文後決定有界重試，既有 sender 本身不自動重試；400／401／403／409／413與不合法 receipt 停止調查。10秒 I/O timeout 不是整個程序硬時限，正式操作需有外層期限與回收方案。Hub 對訂閱的 at-least-once 與 ingest 永久身分去重分開；本提案不新增訂閱或 exactly-once承諾。

## 合成輸入、期望與負例設計

下列都是文件範例，沒有執行 producer、sender 或 Hub。輸入是一份符合既有窄報告欄位的合成觀測；ID由 caller 額外保存為 `11111111-1111-4111-8111-111111111111`。名稱只用 example.invalid。

<!-- P05 synthetic-input -->
```json
{
  "schema_version": "cloudlab.inventory.v1",
  "source": {
    "id": "cf-inventory",
    "revision": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "started_at": "2026-11-22T10:00:00Z",
  "observed_at": "2026-11-22T10:00:05Z",
  "sections": [
    {
      "kind": "zones",
      "state": "readable",
      "error": null,
      "resources": []
    },
    {
      "kind": "workers",
      "state": "readable",
      "error": null,
      "resources": [
        {
          "name": "worker.example.invalid",
          "use": "synthetic",
          "present": true,
          "status": null,
          "drift": [
            "unexpected"
          ]
        },
        {
          "name": "absent.example.invalid",
          "use": "synthetic",
          "present": false,
          "status": null,
          "drift": [
            "missing"
          ]
        }
      ]
    },
    {
      "kind": "worker_domains",
      "state": "readable",
      "error": null,
      "resources": []
    },
    {
      "kind": "pages",
      "state": "unreadable",
      "error": "HTTP_403",
      "resources": []
    },
    {
      "kind": "tunnels",
      "state": "unreadable",
      "error": "HTTP_403",
      "resources": []
    },
    {
      "kind": "access_apps",
      "state": "readable",
      "error": null,
      "resources": []
    }
  ]
}
```

預期投影如下：source 只為公開範例代稱，實際 converter 的固定 source bytes 不能改寫成這個值；其餘顯示欄位對應既有 projection。真 sender 必須使用原 converter 的 canonical compact JSON＋LF，不能傳下方排版文字或以公開代稱覆寫真報告。這個範例只是可審閱的期望，不是已通過的產品 fixture。

<!-- P05 synthetic-expected -->
```json
{
  "specversion": "1.0",
  "id": "11111111-1111-4111-8111-111111111111",
  "source": "urn:example:inventory",
  "type": "inspection.inventory.observed",
  "time": "2026-11-22T10:00:05Z",
  "datacontenttype": "application/json",
  "summary": "Cloudflare inventory observation",
  "data": {
    "schema_version": "cloudflare.inventory-summary.v1",
    "started_at": "2026-11-22T10:00:00Z",
    "observed_at": "2026-11-22T10:00:05Z",
    "source_revision": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "sections": [
      {
        "kind": "zones",
        "state": "readable",
        "error": null,
        "present_count": 0,
        "missing_count": 0,
        "drift_counts": {
          "unexpected": 0,
          "missing": 0,
          "inactive": 0,
          "invalid_status": 0
        }
      },
      {
        "kind": "workers",
        "state": "readable",
        "error": null,
        "present_count": 1,
        "missing_count": 1,
        "drift_counts": {
          "unexpected": 1,
          "missing": 1,
          "inactive": 0,
          "invalid_status": 0
        }
      },
      {
        "kind": "worker_domains",
        "state": "readable",
        "error": null,
        "present_count": 0,
        "missing_count": 0,
        "drift_counts": {
          "unexpected": 0,
          "missing": 0,
          "inactive": 0,
          "invalid_status": 0
        }
      },
      {
        "kind": "pages",
        "state": "unreadable",
        "error": "HTTP_403",
        "present_count": null,
        "missing_count": null,
        "drift_counts": null
      },
      {
        "kind": "tunnels",
        "state": "unreadable",
        "error": "HTTP_403",
        "present_count": null,
        "missing_count": null,
        "drift_counts": null
      },
      {
        "kind": "access_apps",
        "state": "readable",
        "error": null,
        "present_count": 0,
        "missing_count": 0,
        "drift_counts": {
          "unexpected": 0,
          "missing": 0,
          "inactive": 0,
          "invalid_status": 0
        }
      }
    ]
  }
}
```

| 案例 | 預期結果／應保留的證據 |
| --- | --- |
| 合成輸入完整、含 drift／403 | 轉換有效；workers present1／missing1、unexpected1／missing1；Pages／Tunnels unreadable／HTTP_403、計數null；原時間／revision保持。exit0只指轉換成功，不表示盤點無錯 |
| 同E重送；同秒同內容的新觀測 | 前者200同seq；後者新UUID，202新事件。更換UUID只可用於真正新觀測，不能掩蓋衝突 |
| 同source+id但改摘要／time／revision | 合法不同 canonical 內容→409，原事件保留；token／role檢查仍先成立 |
| 只改原報告 name／use，aggregate相同 | 本投影刻意不含該欄位，同ID摘要可仍相同；不能靠事件hash偵測原報告竄改，需私人原報告hash |
| unreadable 填0、未知欄位、重複key、錯UUID、超限／錯型別 | 原 converter／sender 在本機拒絕；不讀token／不發HTTP（依各自驗證階段），不把非法報告補成合法事件 |
| producer token 查詢；readonly／owner ingest；foreign source／type | Hub角色／scope拒絕；來源token只寫允許前綴／type。不以字面前綴冒稱精確source身份 |
| timeout發生於Hub commit之後；200缺duplicate或receipt損壞 | 結果仍不確定，原bytes／ID保留；可核對查詢或同文重送解決，不宣稱未寫入，不重寫事件 |
| 重送舊觀測、來源長時間自然無事件 | 原time不變；來源最後收到可更新而觀測仍舊。未設interval不造silent／heartbeat；無事件不是全正常 |
| 格式合法但未來超過5分鐘／晚到 | Hub既有接受＋clock_skew或正常晚到語義；來源資料可信性另判，不用received_at替換time |
| 重啟前後、snapshot含E與fresh restore | 先查E內容／seq，再重送；新憑證、出口隔離，原DB／快照不變；僅合成機制證據不提升真實AC-04 |
| 備份缺manifest／改壞hash／目的DB已存在 | 拒絕還原、不覆寫原檔；保留失敗與新目的地選擇，不能清理後自動重試 |

## 交付與後續入口

P05-01～04 只驗收這份來源提案。原 M6 的一個有用來源、非root持久實例、真資料備份仍各待具名正式入口；不把私人合成恢復測試升格成已完成 M6。無需 Prism daemon eval、三來源七天、手機、第二主機通知或新的驗收表單。歷史未驗擴展仍未驗，原 SDD／AC 不變。

若正式選定來源，先在既有 [STATUS](STATUS.md)／任務與私人接入紀錄固定具名實例、原報告、保存位置、最小權限、停機／回退及原 M6 驗證；本頁不批准該操作。後續只有現有工具不能滿足這個具名旅程時才提出小型 adapter 差異，不先開泛用平台。

回退僅撤回新增提案及導航，不改原來源／ID／資料／規格／身份，不刪既有事件、報告、備份或資源。任務進度與本次檢查見 [STATUS](STATUS.md)、[計畫](../.team/PLAN.md)、[任務板](tasks/BOARD.md)。

[hub-success]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/signal-hub/SUCCESS.md
[hub-readme]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/signal-hub/README.md
[status]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/signal-hub/docs/STATUS.md
[m6]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/signal-hub/docs/sdd/06-security-operations-acceptance.md
[ingest]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/signal-hub/docs/sdd/01-event-model-and-ingest.md
[sources]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/signal-hub/docs/source-integration.md
[runtime]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/signal-hub/docs/runtime.md
[m6-design]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/signal-hub/docs/m6-design.md
[m5]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/signal-hub/docs/m5-design.md
[docker]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/signal-hub/deployment/docker/README.md
[cloud-success]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/cloud-lab/SUCCESS.md
[cloud-readme]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/cloud-lab/README.md
[ml]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/cloud-lab/docs/evidence/inventory-live.md
[ca]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/cloud-lab/docs/host-agent-design.md
[audit]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/cloud-lab/docs/portfolio-capability-audit.md
[prism-success]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/prism/SUCCESS.md
[prism-readme]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/platform/prism/README.md
[wotar-success]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/systems/wotar/SUCCESS.md
[wotar-readme]: https://github.com/fallrising/newclear/blob/6c9cbd0ba596cd5f1ddd6c5466b99ce294dea1d3/systems/wotar/README.md
