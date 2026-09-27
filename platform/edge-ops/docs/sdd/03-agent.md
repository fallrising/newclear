# 03 — Host Agent SDD

狀態：proposed；本 Agent 是確定性系統程式，不是能自主決定操作的 LLM agent。

## 1. 程序與權限

| 程序（規劃名稱） | 預設 | 權限與責任 |
| --- | --- | --- |
| `edge-ops-collector` | 安裝的唯一常駐能力 | 專用非 root user，採集／上報，不能執行 job 或修改系統設定 |
| `edge-ops-courier` | 不安裝／不啟用 | 獨立身分與 storage，向雲端 claim／回報，向本地 socket 遞交已簽 manifest |
| `edge-ops-execd` | 不安裝／不啟用 | root-owned policy／approval trust roots，按固定 profile 降權或執行受信任 privileged action |
| `edge-ops-approve` | 在可信 operator 環境按需執行 | 渲染完整 manifest、核對並簽署；approval 私鑰不部署到 Worker／受管主機 |

collector 不在 sudo／docker 群組，不 mount host Docker socket。systemd sandbox 初始方向：NoNewPrivileges、ProtectSystem、ProtectHome、有限 ReadWritePaths 與 capability bounding；具體 unit 需在 M1 真實 Linux VM 驗證，不照抄一份宣称所有 metrics 都正常。

journald 群組可能開放大量系統日誌，不能把它當作細粒度 ACL。P1a 優先以本地受限 log reader／exporter 僅匯出指定 unit／path；確需較廣權限時，安裝前清楚告知。不得為採集一個欄位把整個 collector 改成 root。

首批平台為 Linux/systemd amd64/arm64。API capability inventory 顯示每個 collector 能力；unsupported/null 不填 0。Alpine/OpenRC、OpenWrt、FreeBSD、macOS、Windows、NAS 各自新增 packaging／permission／recovery 驗收後才宣稱支援。

## 2. 採集語義

本地初始每 10 秒 sample、每 60 秒一個 bounded report；回傳一分鐘窗口的 count、average、max 與最後一筆值，不把平均值稱作即時值。視需要保留原始 sample 的後續模式必須重新做成本預算。

基線採集 CPU busy percent、load、memory available/total、swap、mount 空間、disk I/O 累計、NIC rx/tx 累計、uptime；程序／連線數視權限可選。GPU 與線路品質不是必裝依賴。

rate 使用單調時鐘和 counter delta；boot_id 變化、介面替換、counter reset/wrap 時重建基線，不畫負速率。API 的 uint64 counters 以十進位字串表示，避免 JavaScript 精度損失。observed_at／received_at 分開；report seq 與 boot_id 標記出缺口。

collector config 有版本與欄位 allowlist，遠端只能在主機本地上限內調低採樣率／調整已授權來源；不可透過 config 帶 shell、任意 file path、任意 probe URL、plugin 或 updater executable。probe targets 後續需明確 host-local allowlist 與頻率限制，不能形成掃描代理。

## 3. 斷線、spool 與壓力

spool 是磁碟上的 bounded queue，不是永不丟資料的承諾。設計初值：metrics 32 MiB、logs 64 MiB、results 16 MiB；實作按檔案系統 free-space 預算再限制。各 queue 独立，不讓 log 洪水擠掉 job result。results 無法 durable 保存時拒絕接受新 mutation job。

429 遵守 Retry-After；network/5xx exponential backoff + jitter；401/403 停止對應通道並標示憑證狀態，400 schema error 隔離失敗項，不形成 retry storm。先上報 heartbeat／pending result，再有限補報 metrics，logs 最低優先。超額丟棄有 count、range、reason；不能用靜默成功隱藏缺資料。

不以瀏覽器開著與否決定主機採集是否存在。雲端不能透過一個間隔參數把低配 VPS 的 CPU／網路耗盡；本地設最小間隔、最大 payload、速率、spool 與來源數。

## 4. 日誌

每個 source 有固定本地設定，識別 cursor／inode+offset、rotation、truncate；記錄時間與 receipt 時間分開。保留 multi-line policy、編碼失敗處理、單行 bytes 上限、chunk bytes/time 上限、redaction 版本。

按來源串流產生壓縮 NDJSON chunk，hash 後上傳；manifest ACK 後推進 acknowledged cursor。重試可重複，使用 chunk_id/digest/cursor range 去重。首次加入與 rotate 不自動回讀整顆磁碟歷史。上傳範圍及 masking 無法保證不漏秘密，operator 必須選擇允許上雲的 unit／應用。

## 5. 執行器

courier 只把固定 envelope／artifact 傳到 Unix socket；execd 驗證 peer credentials、固定 framing/size、簽章、期限、node/generation、local policy、artifact digest、參數 schema、deadline、所需權限，再 durable 記錄 accepted/started。socket ACL 不以「同 user 皆可信」代替輸入驗證。

typed built-ins 以 argv 呼叫，不拼接 shell。uploaded script 是 immutable artifact，只有 recipe 明確指定 interpreter、run-as、working directory、環境 allowlist 與資源上限才能執行。不得以參數置換繞過檔案路徑、命令或 profile 限制。下載／解包若引入 archive，必須拒絕 traversal、symlink escape；初版優先單一腳本文字 artifact。

先驗簽再取得短效 execution-start permit；permit 機制見 [05](05-contracts-and-security.md)。本地 journal 寫入 attempt/fence/manifest digest 後 fsync，才產生副作用。程序置於受管 process group／systemd scope，有 stdout/stderr byte cap、wall timeout、CPU/memory/process 限制與取消程序；root profile 不能據此宣稱能安全運行不可信 root code。

同一 attempt 重送回覆已知狀態，不重啟程序。斷電發生在 started 記錄與完成記錄之間時，狀態是 unknown/reconciling；檢查 postcondition，不能自動重跑有副作用脚本。lease fencing 可防新 claim，不能讓已執行的 shell 魔法般停止。kill／reboot 之後須有實際停止／新 boot/checkpoint 證據。

## 6. 升級、移除與復原

agent release 與 job approval 使用不同 signing key 用途。更新固定版本、digest／簽章、分批 canary、本機健康檢查與明確 rollback；不做任意遠端 URL 自更新。P0 先由 operator 手動安裝經驗證 package，不把 auto-update 偷渡成 root command 通道。

移除先 revoke 雲端 credential、停服務、依政策清理本地 keys／spool；保留必要雲端稽核。監控 Agent 不清理其他平台資源。disk image clone／snapshot restore 可能複製 identity 與 journal，必須另做 generation 變更、舊身分撤銷、未知任務 reconciliation，不重用失效 lease。

驗收詳見 AC-AG-*、AC-JOB-*、AC-BOOT-*。本次沒有編譯 binary、設定 systemd、啟動 listener 或接触真實主機。
