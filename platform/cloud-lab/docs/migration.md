# 來源歸位、遷移與封存

本文件是計畫，不是搬遷命令。M0 沒有搬程式／資料、切入口、停止服務或封存元件。來源版本見[來源表](sources.md)，目前能力與證據見[知識樹](knowledge-tree.md)。

## 處置詞彙

- `move-candidate`：評估遷入後以新位置為唯一維護來源；尚未切換。
- `extract-candidate`：先證明共同語義，再抽取小型共用實作與相容介面。
- `adapter`：原實作／資料／生命週期不搬，只新增版本化邊界。
- `reference`：只連結研究或上游；不匯入實作或繼承驗收。
- `retire-candidate`：已證明能力被接替後，另做退役評估；M0 無已批准清單。

## 來源到目標

目標路徑均為規劃，尚不存在 runtime 程式。私有來源只列通用角色，不在公開文件列帳號、repo 路徑、主機、服務網址或其私人內容；精確 provenance 留在私人遷移工作紀錄。

| 來源 | 處置 | 規劃目標 | 保留邊界／阻擋 |
| --- | --- | --- | --- |
| [Edge Ops](../../edge-ops/README.md) | move-candidate；優先評估 | `modules/observability`、`adapters/host-probe`；受控操作另期 | 保留 signing vectors、M0/S0 證據及 monitor-only；沒有真 collector／live qualification，不能搬完就標可部署 |
| [Kith](../../../products/kith/README.md) | apps 歸位候選；先 adapter | `apps/kith` | room／membership／replay／provider／runner 邊界與資料獨立；先驗證 routing、assets、migration、DO class identity、工具入口與 CI；不自動給模型管理工具 |
| 私人雲筆記／提問應用 | move-candidate，待公開適用性審閱 | `apps/notes` | 通用程式、license、git history、fixtures、憑證引用審閱後才可公開；私人資料／部署設定不遷入 |
| 私人 CF inventory 工具 | extract-candidate | `modules/inventory` | 只抽 provider-neutral 結果及唯讀 API adapter；私人 desired／resource IDs／token 留原位置 |
| host／workload 管理器 | adapter | `adapters/host-authority`、`adapters/workload` | 沿用既有 host/workload 分工，不建立第二個 reconciler |
| [Fleet 公開契約](../../../specs/fleet/README.md) | reference／adapter | adapter 契約引用 | license 與現有 B-tier 邊界不變；不直接複製成第二套 runtime |
| [Agent Platform](../../agent-platform/README.md) | adapter | `adapters/agent-platform` | 原平台掌握 native run、sandbox、停止／清理；Cloud Lab 只持 reference／結果證據 |
| [Agent Workforce](../../agent-workforce/README.md) | adapter | `adapters/agent-coordination` | 不重做 worker/account/resource binding 或宣稱尚未完成的跨產品能力已可用 |
| [Signal Hub](../../signal-hub/README.md) | adapter；有證據後 extract-candidate | `adapters/events`、`modules/dashboard` | 事件原存儲與投遞權威維持；先採 read model，不搬 SQLite 成 D1 即宣稱等價 |
| [HAI Taskboard](../../../products/hai-taskboard/README.md) | adapter | `adapters/work-system` | 工作驗收與 Done 保留；執行成功不自動完成工單 |
| [Open Compute](../../../labs/open-compute/README.md) | reference | `docs/sources.md` | 自有硬體 runtime 實驗；不當成 CF 託管環境的測試證據 |
| [Cloudflare-Accel 索引](../../../refs/Cloudflare-Accel/README.md) | reference | `docs/sources.md` | 第三方 preservation 副本；不重新標為自有模組，不刪原副本 |
| 私人 DAG／CLI 調度工具及既有 bot | adapter 候選 | `adapters/runner`、`adapters/bot` | 先固定 submit/status/result 協定；不搬既有 sessions、credentials、workspace 或排程 |

## 重複能力怎麼判定

只比較具體行為：輸入／輸出、准入權限、狀態機、失敗與恢復、資料保留、現有 caller、license、實際維護成本。同名的 queue、auth 或 dashboard 不足以判定重複。

例如 Kith replay 是房間事件接續，command outbox 是工作投遞；它們不互相取代。Signal Hub 的事件投遞與 runner journal 也各自負責不同恢復邊界。

抽取共用程式之前至少有兩個實際 consumer，或一個已證明會重複維護的具體行為；先固定共同 contract，再比較差異。M0 不預建泛用 plugin framework。

## 每個遷移單位的 gate

| Gate | 必要產物 | 通過後才可做 |
| --- | --- | --- |
| G0 來源 | 原路徑、固定 SHA、license、功能及已知缺口、公開內容審閱 | 建立明確 scope 的候選副本 |
| G1 行為 | 原驗收保留；新路徑單元／整合／負面案例及差異清單 | 供隔離 preview 使用 |
| G2 資料與設定 | schema／DO identity／binding／路由／機密引用／備份映射；相容性與恢復計畫 | 在合成或隔離資料演練切換 |
| G3 切換 | caller 清單、唯一 writer、in-flight 排空或接管、停止舊 trigger、回退條件 | 在另行授權後切正式入口 |
| G4 觀測 | 明確時間窗與健康／正確性門檻；舊入口使用量；備份還原證據 | 判定新位置可承接維護 |
| G5 退役 | 行為覆蓋、無未交接 caller／job／data、successor 導航、歷史保留、owner 決定 | 封存舊維護入口；不自動刪資料 |

來源候選副本不啟用第二個 scheduler／controller。新舊可同時讀或 shadow validate；寫入時只有一個 authority。舊狀態與新狀態不能雙向無限制同步。

## 回退

切換前記錄程式、設定與資料版本，先證明備份可恢復。可相容的程式切換可回舊入口；schema／外部副作用不相容時，停止新提交、保留未完成命令及證據，依事前計畫對帳／前進修復或隔離還原。單純 checkout 舊 SHA 不等於資料回退。

使用者可以仍使用舊版直到 G3；舊文檔保留 fixed-version 歷史，入口新增 successor 與相容期限。封存狀態不等於驗收成功，也不批准刪除 source、state/WAL、credentials、sessions 或唯一成果。
