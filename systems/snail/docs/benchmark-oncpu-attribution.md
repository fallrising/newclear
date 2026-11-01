# 固定四 shards 的 on-CPU 成本歸因

本規程先於產品負載提交並固定。[client 位置診斷](benchmark-client-placement-results-20261010.md)未支持四對穩定改善；原效能驗收保持開放。本輪只回答多 worker 額外執行的 CPU 成本落在哪些葉端符號，不定位 off-CPU 等待，也不證明吞吐瓶頸。不修改 runtime、spin budget、workers 預設或 ≥1.5 scaling 目標。

## 固定條件與次序

沿用已記錄的 server 與 client A：各為獨立 6-vCPU EPYC 7443P VM、約25.4GiB RAM、Linux6.12.43+deb13、直接 Ethernet。server affinity 0–3，client 不限制 affinity；mio、四 shards、c50 SET、P32、四 client threads、1M 隨機 keys。每項重新啟動 server，以 seed0 做10M SET 暖機，再做10M SET 量測。量測期間不並行 build、其他本任務 load 或 profiler。

| 次序 | workers/shards | 量測 seed |
|---|---|---|
| 1 | 1/4 | 101 |
| 2 | 4/4 | 101 |
| 3 | 4/4 | 102 |
| 4 | 1/4 | 102 |

固定四 shards 可減少單 shard 快路徑混淆；1w/4shards 不是原1w/1shard產品驗收基準。這四項及較小 request 數的 smoke 分開保存，不與以前的矩陣或 client-placement cohort 混合。

固定 binary SHA256：`560e697b7557eec5bc9372f7949362feaf8b9a8ac1a1b0ab5c2d62ca54763ecd`，ELF build-ID `f061075930e3d101f0721244275f10d604ce6a6e`。server/profiler image：`rust@sha256:af306cfa71d987911a781c37b59d7d67d934f49684058f96cf72079c3626bfe0`；client image：`redis@sha256:4fa24486b8bcca8eec45ee0eb166edc674795e53a2b53d1a9ef263eecebaac85`。perf6.1.187 binary SHA256：`09c2952fdd0a982d797978c35e590bb00bdc02dbfee9ec13fe50fadafb25c22f`；完整額外 tool-tree 檔案 hashes 與 symlink 路徑／target／解析結果保存在私有 preflight/method。runtime links 必須指向 pinned tree 中已驗證的檔案；不只核對主執行檔。

## 採樣、視窗與 observer

先核對 pinned tools、軟體事件權限、實際 FIFO control/ack、user/kernel 符號入口及輸出格式，再審查 controller 與獨立 smoke，才允許正式負載。合成探針只檢查工具能力，不當產品樣本。保留所有失敗；不自動替換 profiler、binary、事件或失敗觀察。

使用 `cpu-clock`、99Hz `--strict-freq`、period/timestamp、`CLOCK_MONOTONIC`、`--call-graph dwarf,8192`，針對同一 server PID 及其 threads，保持 inheritance。不只錄 user 或 kernel；`--no-bpf-event` 僅關閉無關 BPF 事件合成。`-N --buildid-all` 保留 build-ID 而不寫入主機 build-ID cache。server 與 profiler 使用相同 `/tools/rudis` 路徑及相同 runtime libraries，以解析 DSOs。既有 binary 有 symtab/eh_frame，沒有 debug_info；最佳化與 inline 會把成本歸入可見 caller，不能推論精確源碼行或完整呼叫鏈。

只有有時限的本次 profiler 容器使用 host PID namespace、SYS_ADMIN/SYSLOG/SYS_PTRACE，以及 seccomp/AppArmor unconfined；server 設定沿用，主機 policy/sysctl 未修改。Docker 的 [AppArmor 說明](https://docs.docker.com/engine/security/apparmor/)列出 ptrace 限制；實際能力仍以保存的探針結果為準。

recorder 初始 disabled，FIFO enable/disable 必須有實際 ack 及穩定 recorder identity。此 perf 版本回傳 `ack\n\0`，保留原始 bytes並嚴格解析。用同一 server monotonic clock 保存控制前後時間及 server PID/starttime/cgroup、全部 thread identity、CPU ticks。CPU 快照包圍 enabled 區間，邊緣控制與快照開銷明列；client 容器啟動、benchmark、回收均可能位於此視窗，不能稱精確 workload-only。

recorder attach 不附帶 workload 子程序；disable 後，以同一 owned FIFO 送出 `stop`，保存相同格式的實際 ack、送出／回覆時間及真正 exit code。送出前核對 recorder PID/starttime/cgroup、容器 label、directory 與期限；正常 stop ack 後可以立即退出，不要求它繼續存活。等待 ack／退出均有期限，整個 profiler 命令另受540秒 timeout及3秒 kill-after限制。實際 exit 必須為0，不把 signal exit 換算成成功。首次100k smoke 使用 signal停止含 sleep 子程序的 recorder，回傳143而拒絕；該資料獨立保存，不納入正式 cohort。正常 FIFO stop 的合成探針已驗證，修正須另經審查及新的產品 smoke，才可執行正式量測。

server CPU/request = process user+system ticks差 / CLK_TCK /10M。各 thread 自身 ticks 分開；暖機完成至 enable，以及 enable 至 disable，均核對完整 thread 集合與每個 starttime。PID 重用、thread 集合變動、負 ticks、錯誤時鐘或未確認 recorder 狀態均拒絕觀察。client 保留原 v2 live keeper、完整 cgroup與部分 Redis PID/thread、唯一 exit marker／CSV／final collection guards；不冒稱逐請求零錯誤。

profiler 的新鮮 live-container cgroup CPU 記錄到 recorder 停止，包含啟動、keeper及錄製成本；之後 script/report 的整理另存。這個計數不是完整 observer 影響測量，沒有與無 profiler 的配對控制。profiled QPS/p99 僅為診斷背景，不能據此接受或拒絕產品吞吐；99Hz及8KiB stack 仍會擾動執行。

## 葉端分類及品質判準

保留 perf.data、record stderr/exit、header、evlist attrs、build-ID、實際 script（comm/pid/tid/time/period/event/ip/sym/dso＋callchain）、完整 raw dump/lost summary、控制時間與 process/thread/maps。核對所有既有 worker threads及 inheritance、user/kernel attr、實際採樣 PID/TID和 sample 時間；符號與 lost 數必須從完整原始資料計算，不能以沒有 warning 代替。

實際 script 的每個 sample header 後接 frames，第一個 frame 為 leaf。完整解析 copied `PERFILE2` data section 的每筆 record，核對邊界與 `report --stats`／script sample counts，依 `PERF_RECORD_LOST`、`PERF_RECORD_LOST_SAMPLES` 的欄位求和並明列零值；sample record 的 user/kernel mode 與 frame DSOs 分開保留。這個 lost 值限於保存的 loss records，沒有獨立驗證 recorder 未寫出的最後遺失量，不能聲稱完全無資料遺失；格式未知或統計不一致即拒絕歸因。

葉端符號依以下順序 first-match，只歸入一個 family。符號名稱為 perf demangle 後的可見名稱；kernel/user 保留 DSO標記，通用剩餘 family 不當具體優化目標。

| family | 葉端名稱 regex |
|---|---|
| batch-routing | `(?:rudis::.*(?:router\|LocalReply)\|ShardClient\|flush_batches\|send_to)` |
| reactor | `(?:rudis::.*reactor\|epoll\|eventpoll\|do_epoll\|poll_schedule)` |
| allocation | `(?:malloc\|calloc\|realloc\|(?:^\|::)free(?:$\|::)\|(?:alloc\|dealloc)::\|__rust_alloc\|__rust_dealloc)` |
| network | `(?:tcp_\|inet_\|sock_\|skb_\|netif_\|ip_(?:rcv\|output\|queue)\|sys_(?:read\|write\|send\|recv)\|__x64_sys_(?:read\|write\|send\|recv))` |
| key-storage | `(?:rudis::.*(?:store\|shard)\|hashbrown::\|ahash::\|hash_key)` |

`[unknown]`、未解析位址／DSO歸 unknown，仍留在分母；其餘為 other-user／other-kernel。保留 count與period weights。exclusive family share = family 的 sample periods 總和 / 所有 sample periods；估計 family CPU/request = 此 share × 同視窗 server CPU/request。inclusive callchain 僅作上下文，不加總成互斥百分比；period-weight estimate也不是精確逐請求成本。

每項 leaf symbol coverage（sample count）≥95%、lost / (observed samples＋lost)<1% 才有可用歸因；未知／缺失 lost counter、foreign identity、無 sample/callchain、非正 period、無效 CSV、copy hash不符、收集或清除失敗均 fail closed。正式判準：同一**具體 named family**在兩對中4w的估計 CPU/request均高於1w，且在每個4w觀察占 on-CPU sample count 與 periods**各至少15%**。保留原 count 判準，period-weight share 另加同等門檻；兩種口徑均公開。這是診斷 usability／選擇入口的規則，沒有取代產品效能目標。

若品質或兩對規則未滿足，保留已取得資料並以 inconclusive 停下，不改 spin/default、不重選 seed 或靜默重做失敗觀察。兩對沒有穩健信賴區間；滿足規則只支持調查該成本 family，不證明它是吞吐瓶頸。

## 保存、停止與清除

先核對 stopped containers、精確 namespace、port、peer firewall rule 和遠端 profile directory；有既存同名資源就拒絕。每個 mutation 先保存 attempted及到期 lease，profiler 整個命令與子程序都有有限期限，所有信號／收集失敗獨立清除本次 server/client/profiler containers與單一 peer rule，核對 absence/port；不操作其他服務。

每項 checkpoint綁定 controller/protocol/tool/binary/image及所有檔案 SHA256。profile directory exclusive建立，raw/copy失敗時仍保留遠端證據，精確 label清除容器而不刪資料。無自動續跑；接手先核對已完成 checkpoint及SHA，任何新方法須先另記規程與審查。本輪停止點是這兩對或明確無法取得品質後的證據審查、文件交付及可接手紀錄。

執行結果：[smoke品質未通過與停止記錄](benchmark-oncpu-results-20261010.md)。正式四項未啟動，原效能驗收保持開放。
