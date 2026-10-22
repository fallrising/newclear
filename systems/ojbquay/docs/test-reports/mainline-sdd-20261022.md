# Ojbquay 主線 SDD：搜尋與驗證報告（2026-10-22）

狀態：文件提案；產品資格 **FAIL / usable_tag: none**。T-0368 維持 in_progress，owner 驗收另計。
本報告為 [SDD](../../SDD.md) 的證據，不把新規範當成已批准，也不把參考 build 當成修復完成。

## GitHub 搜尋覆蓋

GitHub repo list offset 0/page_size 100 回傳 62 repos；offset 100 回傳 0。未封存 10 個，與交接清單相同。
逐 repo 搜尋，不依全域 top-N 判定。connector 初次多詞 conjunctive query 不足作負面證據；
單詞查詢另遇 429、newclear top-100 與 desk 舊索引，因此改用完整 tree／固定 SHA 內容掃描補齊。

| Repo | 分支／完整來源 SHA | 實際搜尋範圍 | 結果 |
| --- | --- | --- | --- |
| fallrising | master / `dd978ebf67ff6f7342f9136a896e922c4c458789` | 全 tree、1 份文字 | profile 的 Ojbquay 導航，非 SDD |
| knowledge-base | main / `702b868ebf6daf6c00a33bc9abf7f6b71a11ab62` | 完整 387-entry tree、312 份文字／結構文件 | event-delivery/reengineering 背景、能力索引，非 Ojbquay SDD |
| Zircon-Godot | master / `14ad6768ee6dcdffd55ffda89b76f7f1b9bc9c1e` | 無索引；完整 2,416-entry tree、171 份文檔全文 | 六關鍵詞 0 hit |
| journal | main / `9893f8b5aa93b2c0e376df43be990131bb975f61` | 全 1,144 tracked entries、所有非 binary／非 lock 內容 | 歷史工作／資格紀錄，非 SDD |
| magpie | main / `e297a8ab27461ed32b03ce8be0f9bf957a2e754d` | 無索引；完整 5,277-entry tree、29 份文檔全文 | 六關鍵詞 0 hit |
| kernel | main / `a1d62186a95d6693a897a9d87ffebb30e56f24c6` | 全 3,560 tracked entries、所有非 binary／非 lock 內容 | 交接／盤點／舊維護腳本引用，非 SDD |
| newclear | main / `0aac18413a3b39043706f17b8e5f801f41573d70` | 全 7,383 tracked entries、所有非 binary／非 lock 內容；SDD/產品候選路徑 233 個 | Ojbquay 衍生規格；refs/DDMQ 是外部 didi 專案；Fleet/Kith 命中屬其他產品 |
| personal-journal | main / `e60c92b8a2217b283323cb96ad8b75df26461b3c` | 完整 17-entry tree、8 份文字 | 無相關命中 |
| doc_analysis_study | main / `5c2dc8de04a16f7fe35d51c19d8a1c185f9319af` | 完整 1,562-entry tree、1,162 份文字／JSON/YAML/CSV | DD-057 是外部 DDMQ；另一 SDD 是 ledger study，不是本產品 |
| desk | main / `81f11dc2a6cbf5f4912a564cde7728d8f6c41867` | 全 1,252 tracked entries、所有非 binary／非 lock 內容 | 任務／盤點／復原計畫，無原始 SDD |

文字查詢包含 `ojbquay`、`ddmq`、`ProduceDelay`、`retryIntervals`、`__ojbk.delay.inbox`；
文檔 corpus 另查 `SDD`，本機 repos 另列 SDD 路徑並檢查跨產品命中。
REST recursive trees 均未截斷；本機 git tree 無 top-N。tracked entries 與 REST tree（包含 directory）
分開描述，不混稱同一種計數。未下載大型 repo assets，未新增 clone。

**結論：沒有找到原始 normative Ojbquay SDD。** 所找到的是產品摘要、ADR、milestone specs、
引用或外部案例。不能推論原件從未存在、從未上傳或不在未查的歷史／其他分支／已刪除物件／外部附件。
八個 repo 的原始私人掃描保存在 owner 指定 T-0368 備份，本公開 PR 只放範圍與結論。
[覆蓋摘要](../../../../docs/project-success/evidence/ojbquay-sdd-20261022/active-repository-coverage.json)、
[兩個未索引 repo 完整證據](../../../../docs/project-success/evidence/ojbquay-sdd-20261022/unindexed-search/report.md)。

沿用、不重做的 archived `fallrising/ojbquay` 追溯：main `2fe3c9d6042027050a598353d2cac55866aaccde`，
3 分支、28 reachable commits，另追 rewrite 前 16 commits 至 root
[`a0bbc8076a8a1f3ca7bae9b66245642839167851`](https://github.com/fallrising/ojbquay/tree/a0bbc8076a8a1f3ca7bae9b66245642839167851)，
PR #1/#2、討論、tags/releases 均已查。ADR 的「provided PRD / normative SDD」是引用，原始檔未見。
此範圍沿用前次已保存報告，不假稱本次重跑全歷史。

## 新文件與舊契約的關係

SDD 保留 SUCCESS AC-01～05，AC-06～11 整理 product-spec 與 M2～M6 的既有用途，
未加入額外產品擴展。詳細原文／差異／影響表在 SDD。沒有改測試、runtime、CI、lockfile、
retry 起算點、首次交付、暖機或閾值。

原 M4 把 150 ms `<20%` 記為未達；main 的 `PushRetryE2eTest` 實際只檢查
140–1150、290–1300、590–1600 ms。#445 候選已收緊為 >=150/<180、>=300/<360、>=600/<720。
新 SDD 沿用 strict gate，舊 main 綠燈只支持功能，不支持 AC-05。
AC-09 亦保留原本「所有 runtime 確認 pause、inflight drain/abandon、offset verify」；現碼的
EMPTY/DEAD group gate 沒有因此被當成等價證明，尚缺 runtime confirmation 與 broker readback。
handler 在 HTTP 結果返回後設定 deadline；把起點移到 attempt-start 或把到達量測改為 response-end
都不在本提案。日後若需要改，必須另有原文、理由、數值差異與影響的 owner 決定。

## 本次實跑與既有失敗

本次參考來源是未改 runtime 的 main `0aac18413a3b39043706f17b8e5f801f41573d70`，不是 repair candidate。
JDK 25.0.4.1+1，Node 24.18.0，原 lockfiles、共用 caches，合成 fixture，磁碟開跑前 94 GiB available。

| 實際命令（元件目錄） | 結果 | 證據／界限 |
| --- | --- | --- |
| `./gradlew build --no-daemon --no-parallel --continue` | PASS：119 tests，0 fail，0 skip | [個別 test 名稱與結果](../../../../docs/project-success/evidence/ojbquay-sdd-20261022/reference-build/test-results.json)；含真 Kafka/PG Testcontainers，strict oracle 尚不在 main |
| `cd sdk/go && go test ./...` | FAIL：generated descriptor import panic | [log](../../../../docs/project-success/evidence/ojbquay-sdd-20261022/reference-build/go-test.log)；修復候選的 generated files 已在另一工作樹，未在本 PR 套用 |
| `pnpm install --frozen-lockfile; pnpm test; pnpm build`（console-web） | PASS：5 tests／4 files，build PASS | [test](../../../../docs/project-success/evidence/ojbquay-sdd-20261022/reference-build/frontend-test.log)、[build](../../../../docs/project-success/evidence/ojbquay-sdd-20261022/reference-build/frontend-build.log)；保留 bundle-size warning |
| `make validate-deploy` | 初次 FAIL：未選指定 Docker config，Compose plugin 不可見；使用交接 config 後 PASS | [初次](../../../../docs/project-success/evidence/ojbquay-sdd-20261022/reference-build/validate-deploy.log)、[重跑](../../../../docs/project-success/evidence/ojbquay-sdd-20261022/reference-build/validate-deploy-configured.log)；模型驗證，不是部署 |
| 真十一服務 Compose／Chromium／Java↔Go 重跑 | NOT RUN 本文件切片 | 既有 candidate 較早來源有 PASS，但不冒充此 main 或最終修復來源完整證據 |

#445 保留的失敗：132 tests 中 131 PASS、1 strict retry FAIL、0 skipped，intervals `[703,350,639]` ms；
其後只有兩行 fired_at 恢復，20 scheduler focused PASS，最終來源仍無完整 build 通過。
[原始失敗摘錄與 artifact digest](../../../../docs/project-success/evidence/ojbquay-sdd-20261022/prior-strict-failure.json)。
194、189、190、204、568 等較快失敗不能取代 703；早先 206–253 ms 也仍是失敗。
舊 Kafka CI runs 39631545801／39633710753 attempt1 的 broker 已退出，退出根因仍未知；
本次 ordered-worker PASS 只代表未重現，不宣稱診斷修補已根治。

## AC 證據矩陣

此表是提案前參考執行與差距，不是產品驗收 PASS 表。CI run 在 PR 建立後另補；目前是本機手動結果。

| AC | 行為 | 判定 | 實際 reference tests／仍缺 |
| --- | --- | --- | --- |
| AC-01 | 資源與配置收斂 | PARTIAL | TopicApiIntegrationTest、TopicConfigPublicationIntegrationTest、KafkaConfigBusIntegrationTest、PushWorkerOrchestratorTest PASS；全程序五秒 reconciliation 未量測 |
| AC-02 | gRPC ACK 與 sink body | PARTIAL | ProducerGatewayE2eTest／PushPipelineTest PASS；同來源真 Compose sink hash 未重跑 |
| AC-03 | Java／Go pull/ACK/NACK | FAIL | PullGrpcE2eTest、PullShareWorkerTest PASS；main Go import panic；最終修復來源 interop 待驗 |
| AC-04 | delay／retry／DLQ | PARTIAL | JdbcDelayRepositoryTest、SchedulerE2eTest、DelayGatewayTest、PushRecordHandlerTest、KafkaRetryPublisherTest、PushRetryE2eTest、DLQ tests PASS；未模擬 ACK 後 PG crash |
| AC-05 | strict 首次與後續 retry | FAIL | 前一候選 [703,350,639]；main 寬容差 test PASS 不能接受；未重跑 strict |
| AC-06 | producer 拒絕邊界 | PASS（參考來源） | ProducerEngineTest、ProducerGrpcServiceTest、TokenAuthTest、ProducerGatewayE2eTest 全 PASS |
| AC-07 | LKG／控制面中斷 | PARTIAL | ConfigStoreTest、KafkaConfigBusIntegrationTest PASS；live control-plane outage 未跑 |
| AC-08 | pipeline／ordered push | PARTIAL | PushPipelineTest、JdkPushHttpClientTest、OrderedPushRecordHandlerTest、BoundedStripedExecutorTest、KafkaOrderedPushWorkerTest PASS；未完成 batch 不 commit／所有 bounds 缺直接 probe；歷史 broker exit 根因仍缺 |
| AC-09 | reset quiet gate | PARTIAL | TopicApiIntegrationTest reset case PASS，其 GroupOperations 是 mock；真 broker active/empty／runtime pause／inflight／alter-readback 未驗證；現碼 quiet-only 與原契約有缺口 |
| AC-10 | console 核心操作 | PARTIAL | 5 frontend tests/build、console API tests PASS；完整真 browser／雙 viewport flow 未跑 |
| AC-11 | 同版本啟動／核心流程 | PARTIAL | build／deploy model PASS；本次未完成真十一服務與 Go interop |

需要補的 case 在 [任務板](../tasks/BOARD.md) 明列；待 SDD 同意後再按固定 ID 建立 executable tests，
不宣稱現有 test 名稱已帶 AC ID。未跑的預期不能冒充「鎖定前已實跑」，正式鎖定仍需補上。

## 審查、授權與收尾

需要 owner 確認的是此具體新 SDD 的主線／固定 AC；沒有請 owner 提供不存在的原件，也沒有請求放寬 retry。
最新 desk §0 N3 及 §6 明定新增／修改 SDD 等 owner 同意；文件、檢查與 PR 先完成，批准前不合併 SDD
或以新 AC 繼續改 runtime。一般 commit/push/PR/CI 已獲持續授權；不逐步詢問。

獨立審查與最終 CI 狀態見本次 evidence README。不部署、不新增 dependency、不擴權、不呼叫真實模型、
不使用真實資料、不建立或移動 tag。journal 未擴張寫入，後續四個產品尚未開始。

工具計數：跨 session／provider requests unknown/null；本次 worker T-451 記錄 210 GitHub GET，0 API retry，
不把 GET、exec 或 worker launch 當模型請求。外層、nested 與 execution/wait totals 未完整計時者維持 unknown/null。
