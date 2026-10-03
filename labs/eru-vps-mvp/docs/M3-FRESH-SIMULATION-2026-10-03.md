# ERU-015：本機 simulation journal 與 receipt coordinator

日期：2026-10-03。基線 `532e587`。本文件描述 [fresh executor 設計](M3-FRESH-EXECUTOR-DESIGN-2026-10-03.md) 的第一個可執行本機切片，41 項 focused integration、獨立審查與完整 487 項 suite 均通過。正式 ERU-015 仍進行中，固定剩餘 12 項；simulation 不構成 V01–V04／V08 或正式 generation acceptance。

## 本機契約

新增的 record store 與 coordinator 使用專用 simulation directory、synthetic authorization/fence bindings 及固定 fake adapter，驗證十二個既有 stage 的排序、intent／receipt chain 和回覆遺失後的恢復。它們沒有 provider、SSH、subprocess/network 或 production CLI 入口，也不修改部署 locks、inventory、cluster generation 或真實 accepted-runs。

既有 review envelope 保持 `executable=false`／`execution_implemented=false`。新的 simulation operation/schema 與實機驗收分離；最後只能得到 simulation-complete，不會把 fake evidence 寫成 accepted-run。Synthetic authorization/fence digest 是測試綁定，不表示取得當次實機授權或完成外部 fence。

## API 與重啟

`scripts/fresh_simulation_store.py` 提供 `RecordStore(root)`、`write_once(name, value)`、`read(name)`、`names()` 與 `record_digest(value)`。既有 root／records 必須是目前執行者所有、沒有 group/other permissions；只有 root 最後一層可由 constructor 建立，parent 必須存在。

`scripts/fresh_simulation.py` 的 `Simulation(root, review_envelope, bindings, adapter=...)` 使用既有 planner 的完整 envelope；`synthetic_bindings(envelope)` 明確建立 synthetic facts。`execute(current_bindings)` 最多執行一個 fake stage，`reconcile(current_bindings)` 只讀 fake adapter 的觀測 ledger並保存本機 evidence。僅接受固定 `SimulationAdapter`，不註冊任意 remote adapter。

fake adapter 的 observations 是記憶體內 synthetic evidence；程序重啟後，新 adapter 沒有現場證據，未完成 intent 仍為 uncertain。不能把重啟後查無資料推論為「未執行」再呼叫 action。此 API 以單一 simulation directory 為邊界，不提供跨 directory／controller 的 generation 互斥，也不取代外部 fence。

## 儲存與執行順序

1. 在明確指定的隔離目錄保存 immutable execution record；每次操作重新核對 root identity、record schema、review/binding digest 與完整 predecessor chain。
2. 首次 stage 執行先持久發布唯一 intent，再呼叫 fake adapter。相同 intent 的另一個 writer 必須失敗；不能以相同 bytes 為由再次 dispatch。
3. 只有 exact action／stage／binding 的成功 receipt 能推進。adapter exception、回覆遺失或不明结果保留 intent，不猜測 action 沒發生。
4. 重新執行遇到不確定 intent 不重播；reconcile 只觀測，符合原 action provenance 與 exact postcondition 才可保存對應證據。
5. 全部模擬完成後仍不 commit 真實 generation，不解除 production mutation barrier，也不滿足三次實機 fresh campaign。

Record store 只接受 bounded flat JSON object records，拒絕 duplicate keys、NaN／Infinity、超限內容、symlink／hardlink／路徑穿越及根目錄 identity 漂移。新檔先 fsync，再以不可覆寫方式發布，fsync directory 完成後才回傳；既有檔案的 bytes 不變。這個 simulation store 要求 parent 已存在，且 root path 沒有 symlink；它尚未接入既有 production private-root symlink 契約。

## 驗證入口

從本 component 目錄執行：

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests python3 -m unittest -v \
  test_fresh_simulation_store test_fresh_simulation test_fresh_simulation_review
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

最終 focused integration：41 tests，1.647 秒，OK；完整 suite：487 tests，68.977 秒，OK。獨立審查另重跑 41 tests（1.386 秒）通過，包含 5 個獨立 adversarial cases；原 CI validation block、compileall、所有新檔的 whitespace diff checks 均通過。測試使用 temporary fixtures，沒有存取真實 private 資料。測試先重現 lost response／缺少實作的 RED，再驗證持久 intent、no-replay、chain drift、唯讀 recovery 與 publication race；不以 mock 呼叫次數取代真實 temporary-file store 的跨模組驗證。

## 尚缺的 production 能力

- 全域 pending-generation barrier 與所有現有 mutation 入口的整合、跨 controller 外部 fencing。
- 四台實際 console receipts／host facts、scope 與 incarnation 檢查、外部 evidence 的真實讀回驗證。
- Fresh renderer、OS/runtime/bootstrap adapters、全新 etcd token／空控制面檢查。
- V01–V04、完整 residue／plugin accounting probes 與 exact generation commit／acceptance seal。
- 三次有獨立 generation／token lineage 的實機 fresh campaign、RTO 與 upgrade／rollback E2E。

本機 simulation 不縮小 [SDD](SDD.md) 或 [TASKS](TASKS.md) 的驗收；未知結果不自動清除 journal、解除鎖或重做操作。
