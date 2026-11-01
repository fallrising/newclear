# AC-05 retry 計時修訂決策 — owner 已同意

原版 [SDD PR472](https://github.com/fallrising/newclear/pull/472) 已獲 owner 同意，
2026-10-22 合併 `874517a896b3be1695b8febb2a852f7e6c5f9307`。
**owner 於 2026-10-22 明確同意本 PR 的 AC-05 量測修訂。** 這是獨立的新同意，不是把先前
同意解讀成允許更換量測。原到達間隔 FAIL 保留；新定義尚無合格實跑，AC-05 仍未通過。產品未交付；`usable_tag: none`；owner 驗收另計。

## 原文、原因與限制

[已批准原文](https://github.com/fallrising/newclear/blob/874517a896b3be1695b8febb2a852f7e6c5f9307/systems/ojbquay/SDD.md)：

> 相鄰到達間隔依序滿足 `150 ≤ Δ1 < 180 ms`、`300 ≤ Δ2 < 360 ms`、`600 ≤ Δ3 < 720 ms`

> 不插入暖機交付，不減去 HTTP、Kafka、PG 或排程成本

現有 handler 原文是 `clock.instant().plusMillis(delay.getAsLong())`，在 `http.deliver`
返回後才執行。固定時鐘舊單元測試區分不了起點；本次新增 advancing-clock 回歸：HTTP
完成時間前進 86 ms，第一個 durable due 是起始後 236 ms，與現有實作一致。這項回歸
保護現有起點，**沒有把 response-end 認定為原到達間隔的量測點**。

歷史完整候選 `[703,350,639] ms` 中，endpoint 在首次到達後 86 ms 才送出 response，
client result 在約 138 ms 才返回。保留 response 後等待 150 ms 與 no-early gate 時，
該樣本即使後續成本為零，也不可能讓第一次到達間隔小於 180 ms。這是該樣本的下界，
不是宣稱所有機器／樣本都不可能通過。該次另外有晚入庫，不能只怪 endpoint。

本次完整精度雙觀測在相同原 fixture 得到：原到達間隔 `[199,311,607] ms`，
response-completion→下一次到達 `[173,310,606] ms`。**原測試仍 exit1／1 FAIL／0 skip**；
後者只符合提案的數字，尚未是有效 AC 通過。資料來自一次新的 observation-only run，
沒有在不變來源重跑直到變綠，沒有暖機或替換原 endpoint。

## 提案精確差異

| 項目 | 已批准原版 | 本 PR 提案 | 影響 |
| --- | --- | --- | --- |
| 量測開始 | 前一次 endpoint 完整 request body 到達 `A_i` | 同次 `http.deliver` 返回 503 結果 `R_i` | 明確排除前次 HTTP request/response 的完成成本；非等價重述 |
| 量測結束 | 下一次完整 body 到達 `A_(i+1)` | 相同 | 保留實際 HTTP 交付終點 |
| 第一段 | 首次到達→第一次 retry 到達 | 首次失敗結果→第一次 retry 到達 | 第一次 retry 仍納入；首次 HTTP response 成本不再列入時序門檻 |
| 三段門檻 | `[150,180)`、`[300,360)`、`[600,720)` ms | 相同 | 數字未放寬，但量測本身變更，可能讓舊指標失敗樣本符合新值 |
| runtime deadline | HTTP 完成後 `clock.instant()+delay` | 相同 | 不移動起算點，不提早 durable dispatch |
| fixture／暖機 | 原真 HTTP/Kafka/PG 四次 503、無暖機 | 相同 | 不替換 endpoint、不扣 Kafka/PG/scheduler/send 成本、不平均 |
| 舊結果 | 原 FAIL | 永久保留原 FAIL 與其來源 | 新契約不能回溯將舊驗收改成 PASS |

建議把 retry 等待契約對齊「已觀察到失敗後等待，再完成下一次交付」，並繼續記錄
到達間隔作原版指標。這是產品／驗收取捨，需要 owner 同意；只因新數字較小不能授權採用。
本次沒有提案 attempt-start deadline、暖機、跳過第一段、較大門檻或更換 endpoint。

若維持原版，就拒絕本 PR；原 AC-05 繼續 FAIL，不能建立 usable tag，後續需在原契約
下找出可成立的產品／環境方案。若批准本 PR，只授權此明列量測修訂；仍須補新的 AC_05
assertions、同來源完整建置、其他 AC、必要 CI／審查與啟動核心證據，不能當作產品已通過。

## 實際證據與未完成事項

[evidence](../../../../docs/project-success/evidence/ojbquay-timing-decision-20261022/) 保留
完整 log/XML、strict test source、Java source SHA256 manifest 及機器可讀摘要。
候選基底 `cda7571e8d45c9c9f036d8b65e41ad26362f7492`，含先前未提交 scheduler/SDK 修復；
本次只增加 `AC_05` 名稱、完成時刻觀測和 advancing-clock regression。未變動 retry handler。

實跑命令（在 repo root；設定既有 JDK25 與 task Docker config，沒有新 dependency）：

```sh
systems/ojbquay/gradlew -p systems/ojbquay :modules:gateway-consume:test \
  --tests '*PushRetryE2eTest.AC_05_*' --no-parallel
```

| 執行 | 實際結果 | 解釋 |
| --- | --- | --- |
| 原候選＋固定 AC 名稱 | FAIL `[191,311,610]` | 首命令在 due 前 63 ms 入庫；這次非晚入庫主因 |
| 真 pending target metadata 實驗 | 24 scheduler PASS；strict FAIL `[196,309,609]` | 沒證明改善，且 metadata 可自動建 topic；完整撤回新增實驗，原候選 SHA 保留 |
| 最小靜態 503 endpoint 診斷 | FAIL `[180,311,608]`；初次編譯警告失敗亦保留 | 未獲准的 fixture control，沒有替代原 AC；診斷 source 已移出可執行 suite |
| 原 fixture＋雙觀測 | 原 FAIL `[199,311,607]`；提案 diagnostic `[173,310,606]` | 原 assertions 未改；這次是量測差異實測，不是產品驗收 |
| Advancing-clock handler regression | 6 tests PASS | 固定既有 response-completion anchor，不證明 strict end-to-end |
| 歷史完整候選 | 132 tests：131 PASS／1 strict FAIL／0 skip，`[703,350,639]` | 換成提案量測首段仍約 566 ms（epoch-ms 診斷，非完整精度），依然不合格 |

沒有此新診斷來源的完整 build／真十一服務／跨語言／browser／remote CI 可用資格。
AC-09 的 runtime/inflight/offset-readback 修復正在獨立工作樹驗證；本文件不宣告其通過。
後續產品未開始，沒有部署、真實資料、付費或模型服務、runtime dependency、權限或 tag 變更。

## 確認規則

現行 [desk operating-method §6](https://github.com/fallrising/desk/blob/main/docs/operating-method.md)：
「修改運作方法、`AGENTS.md` 或 SDD 的 PR 仍等你同意後才合併」。Owner 當次也明定
量測／起算點／暖機不得默改，契約修訂須先列原文、理由、差異與影響再確認。
因此此 PR 只待一項決定：**是否同意以上 AC-05 量測修訂**。原版 PR472 的同意不涵蓋它。

文件提案的 unchanged-main 參考驗證：`./gradlew build --no-daemon --no-parallel --continue` exit0，44tasks=25executed/19FROM-CACHE；還原XML為119tests/0fail/0skip，**不是119項本次重新執行**。41份project-success契約與15個validator tests通過。這不證明修復候選或新量測的完整資格。
