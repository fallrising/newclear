# 固定四 shards 的 on-CPU 歸因：smoke 未通過

本輪結論為 **inconclusive**：新版取樣收尾正常，但產品 smoke 的葉端符號覆蓋未達先行95%門檻，沒有啟動正式10M量測，也沒有選出可用成本 family。原 c50 SET／GET scaling1.137／1.184與四 worker CPU/request1.62–2.07倍的問題仍開放。這份文件交付失敗證據與接手入口，不代表產品效能驗收完成。

## 方法與執行範圍

[先行規程](benchmark-oncpu-attribution.md)首先提交於 `615d7fc3488047d7027d4c70a77d8552f3773256`；tool-tree links及暖機 thread identity 補充於 `da2cff7d8f9f7b35fee9a8924d82e03f45b440c8`。第一版 smoke 使用後者，protocol SHA256 `5c00a37dd07610e73d3b408d843129b9fd45060fc92cfc1c7296005fb3a4aae1`。收尾修正另先提交並 push／回讀 `64ae6b7a91d3fb121e2beed12a72972010cef429`，protocol SHA256 `25ed8011d789d93240d290426c68d01131951f1aa9d82d446b8232a963ff7564`，才執行新版 smoke。本次新增結果連結不改寫當時規程的 hash。

固定同一 binary/build-ID、server/client、四 shards、mio、server affinity0–3、c50 SET、P32、四 client threads、1M隨機keys。預定正式次序為1w101、4w101、4w102、1w102，各10M seed0暖機再10M量測。smoke 使用相同條件，但各 phase只有100k requests；每次均止於第一項1w101，後三項未執行。正式四項全部未執行，沒有與 client-placement 或原矩陣合併。

perf為固定6.1.187／cpu-clock99Hz strict／DWARF8192／CLOCK_MONOTONIC，user與kernel都取樣。完整 regular-file hashes及18個tool-tree symlinks已核對；runtime links不逃出 pinned tree。host／profiler能力預檢與合成探針獨立保存；最終正常停止探針有三次 exact FIFO ack、真正 recorder exit0、五項 extraction exit0及六項本次容器 absence。合成 Python 程序的未知DSO不當產品符號覆蓋率。

## 兩次 smoke，分開記錄

| smoke | 完整 records | samples（user／kernel） | 已解析 leaf | 覆蓋率 | 保存的 lost samples | recorder exit | 判定 |
|---|---:|---:|---:|---:|---:|---:|---|
| v1 | 233 | 21（8／13） | 21 | 100% | 0 | 143 | 收尾失敗，整項拒絕 |
| v2 | 235 | 22（4／18） | 20 | 90.9091% | 0 | 0 | 品質未達95%，inconclusive |

每次暖機與量測的 benchmark exit均為0，enable／disable均有 exact五-byte ack；七項header/script/build-ID/raw-lost/stats/evlist/report整理均exit0。兩次的 perf.data 複本 size/hash與遠端輸出一致；完整 binary data section與report統計／script PID/TID/ns/period一致，raw user/kernel mode與DSO分開核對。warmup至enable及enabled CPU視窗均保持完整thread集合/starttime，primary及dummy attrs／eventIDs覆蓋全部暖機後threads。

v1 signal停止帶 sleep workload 子程序的 recorder，真正回傳143；即使符號指標通過，仍拒絕。保留233個 raw files與所有 extraction，沒有將143換算成成功。唯一有界修正移除 perf workload 子程序，改為核對 owned recorder identity及期限後送FIFO stop，保留exact ack並等待真正exit0。修正通過獨立審查及既有38＋新增8項本地測試，另執行新 smoke；未更換binary/event/frequency/classifier或品質門檻。

v2保留236個 raw files，正常stop ack及exit0；但兩筆 USER leaf為 `[unknown]`，DSO是 `/usr/lib/x86_64-linux-gnu/libc.so.6`，perf script offset均為 `0x152519`。兩筆均留在count及period分母；不猜測函式、不用caller補成leaf。20/22=90.9091%低於95%，故已解析的 observation只是失敗診斷資料，沒有通過 checkpoint、accepted results或paired attribution。零保存的loss只來自完整解析的 `PERF_RECORD_LOST`／`LOST_SAMPLES`，沒有獨立terminal未寫出loss計數，不代表完全無遺失。

v2外層CPU視窗3.29935秒、process ticks差0.34秒，worker自身ticks差0.35秒；快照分別讀取且CLK_TCK=100，微小smoke有jiffy量化差異，不能把thread和process差當精確成本拆分。視窗還包含client容器啟動、收集與回收。profiler新鮮cgroup記錄至stop，包含startup／keeper／recording，排除後續script/report；這不是完整observer擾動測量。沒有無profiler配對控制，smoke QPS/p99與family占比均不作產品效能或瓶頸結論。

兩次各有六項本次server／warmup client／profiler／measure client／單一peer rule／port清除確認，全為true，遠端profile資料保留。獨立review與root離線核對所有469個raw file SHA、copied binary格式、thread/control/CPU、client keeper/cgroup/markers、exit及清除。所有失敗預檢與analysis helper失敗也保留，沒有重選seed或重取品質失敗樣本。

## 資料與限制

[兩列smoke CSV](benchmark-oncpu-smoke-20261010.csv)記錄各自的hash、counts、raw modes、品質、真正exit及外層CPU／profiler計數；兩列是不同收尾方法的instrument嘗試，不是配對效能cohort。v1 frozen controller SHA256 `55fef5ef8095beddc2ba4823f5137bfb3828fc072b4892aefb5c837435894df6`；v2為 `05012945c9345cb67f919e09f272b8bd90b9e51c6a40704a6d325e1212e8a6d3`。私有runner、tool manifest、raw perf.data、方法快照／failed logs及審查報告保存於可複製的handoff，不公開主機address或credentials。

runtime／tests／Cargo未改，兩份53檔source map與已保留mio45／實際io_uring45測試log SHA仍匹配；本輪沒有新Cargo invocation。GitHub文件CI與這些既有正確性證據分開記錄。原效能標準及default-workers替代驗收保持未完成。

## 接手入口

下一個有界入口只做**同一pinned image的libc DSO/build-ID與符號來源離線核對**：確認保存的兩個offset是否能由完全匹配的符號資料解析，先寫新規程並審查tool／method綁定。若有可驗證符號來源，再以新版規程及產品smoke確認≥95%；本輪不下載新symbol套件、不追加load、不執行正式四項、不改spin／runtime／workers預設。未知leaf仍未知；這兩筆不能證明libc是多worker額外成本或吞吐瓶頸。
