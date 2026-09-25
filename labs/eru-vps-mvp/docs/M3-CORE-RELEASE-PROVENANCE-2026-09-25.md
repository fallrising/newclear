# ERU-013 本機 patch provenance 與版本轉移 guard

日期：2026-09-25。此紀錄只涵蓋本機程式及 fake operator 測試；沒有下載新 upstream source、產生新 core artifact、操作 VPS 或執行 E2E。

## 本輪交付

- validate_core_patch.py 可選擇 patches/ 內的 patch、明確 patch revision，以及 Go 版本與官方 archive SHA。Go 1.27.1 仍是預設值；換工具鏈必須提供精確 checksum。每個舊版相容聲明可指定一個受限 Go test package，並在兩次獨立 build 都通過後才可發布。
- 公開 validation manifest 使用 schema v1，記錄 release ID、project/tag/commit、target version、patch revision、允許的來源版本、architecture、patch SHA、toolchain version/SHA、artifact SHA，以及獨立重建結果。真實 artifact 和原始建置日誌仍留在私有 build 目錄。
- core_publish.py 只讀 private/builds 下兩個 result.json 與其 baseline log；檢查兩次 source／patch／toolchain／compatibility identity 相同且 artifact byte checksum 一致，再移除絕對路徑後輸出摘要。輸出先經 core_release.py 驗證，再以 atomic replace 發布到新 patches manifest；拒絕覆寫既有 manifest。
- core_release.py 拒絕未完成獨立重建、失敗測試、patch/source 路徑越界、架構不符、patch checksum 漂移，或未提供版本專屬成功測試的跨版本相容聲明。
- core_patch.py 接受明確 validation manifest，將其 hash 與 release 身分存入 hash-bound plan；執行前重新核對。執行成功後 core-revision.json 保存使用的 release provenance。
- 版本轉移分類為 baseline install、同 artifact reapply、同版本 patch revision 更新、跨版本 upgrade。降版拒絕一般 patch plan，只能走既有 source-run rollback。
- 將已追蹤的 v0.1.5 validation manifest 擴為 schema v1。原 patch、source commit、Go 1.27.1、artifact SHA、雙次建置相同等既有資料未改值；manifest 保留其建立時的 validation status；部署狀態仍由既有 run／handoff 紀錄分開表示，不混為單一欄位。

## 本機驗證

- test_core_release.py：10 tests，涵蓋 provenance、路徑／架構／checksum／reproducibility 拒絕條件、跨版本相容聲明、reapply／patch revision／upgrade／downgrade 分類。
- test_core_publish.py：4 tests，涵蓋雙 build identity／checksum、compatibility test、私有路徑清理、private input boundary 與不覆寫保護。
- test_core_update.py：15 tests，涵蓋 hash-bound manifest 變更拒絕、release revision 記錄與合成 v0.1.5 → v0.2.0 planner 轉移。
- 完整本機 suite：278 tests passed（2026-09-25）。
- validate_core_patch.py --help 可正常執行；本輪未重新建置 Go artifact，因為沒有準備另一個 upstream 版本的獨立 source／toolchain 輸入。

## 尚未完成

目前只有 v0.1.5 release manifest 和既有 artifact。合成 v0.2.0 planner 測試只驗證 state machine，不能當成真實跨版本 compatibility 證據。ERU-013 仍需下一個已選定 upstream commit 的隔離建置、baseline／patched tests、獨立重建，以及列出的每個來源版本相容性測試；再做 upgrade、rollback、interruption 的新 plan 與 VPS E2E。ERU-013 維持進行中，總剩餘數仍為 12。
