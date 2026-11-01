# FE Review — phark — REVIEW

## 目前輪次與權限

第 2 輪已完成原 M1–M3 的實作與限定 runtime／native 驗證，詳見 [報告](tasks/round2/report.md)／[證據索引](tasks/round2/result.json)。獨立審查、必要 CI 與發布仍由 parent 完成。第 3 輪完整 e2e／對比／健康清單未宣稱完成。

文檔檔位 C（dormant）不變；只使用 issue #155 的已批准 FE review 例外，不恢復產品投入、增加功能、升級依賴或修改後端。主線 AC04 pending、usable none 維持不變。

## 已決定與已驗證

- D1：owner 於 2026-10-23 選定既有 API 合成資料方案，見 [決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)。fixture 已使用匿名 CSRF→註冊（不自動登入）→登入→CSRF 重新取得與實際 IDs/cursors，不直接寫 DB。
- Session／CSRF／quota／opaque cursor 與原 auth/mutation/paging 邏輯不變。兩帳號、小量貼文／圖片／回覆／social／通知／檢舉皆為合成資料。
- 三尺寸的欄高、長文字與 Radix hidden Select containing block 已由實測修正。手機頁面390/390，刻意 deck872/358保留，Tab 可移動到各欄並橫捲至514px。
- 四路由12個共用 capture keys 已通過：final-001九個綠鍵值＋final-002三個通知修正。九個補充 route guards、12步 keyboard journey、三欄 controlled paging 另有來源證據。
- 初始 loading/error、composer error 與 unnamed composer region 補上必要語意，未改業務流程。

## 保留的限制與發現

- 對比並未完整通過：Home 的來源特定掃描保留95個 color-contrast incomplete；補充 scans 每尺寸 notifications22、search23、profile28。不將 incomplete 當作 pass。
- Search 每尺寸保留一個 moderate landmark-unique；沒有 critical／serious violation，不等於全部 axe 零問題。
- final003 的1個 request failure 當時只記數，仍是歷史未分類事件。final004 加入精確紀錄後因 POST logout ERR_ABORTED 而 FAIL；沒有放過所有 POST abort。final005 只驗登出，證明同一 Request 收到204，後續 GET session200/account null、UI signed out，才分類 completed-logout-204-browser-abort。原事件／FAIL 不改寫，整體不稱 network error count 零。
- 兩個 controlled500 console 事件在 final004 有 exact origin/path/status 對應；其他未知 console/request 仍會使 runner 失敗。
- Dark theme 沒有實作，本輪僅 light。正式資料、部署、durability、owner completion 均不在本輪。

## 執行與歷史入口

[RUNNER](RUNNER.md) 說明目前腳本；[DESIGN](DESIGN.md) 保留當時提案。[#141](https://github.com/fallrising/newclear/pull/141)、[#144](https://github.com/fallrising/newclear/pull/144)、[#552](https://github.com/fallrising/newclear/pull/552) 為前期歷史；本次候選為 [#593](https://github.com/fallrising/newclear/pull/593)，此處不預先宣稱已合併。
