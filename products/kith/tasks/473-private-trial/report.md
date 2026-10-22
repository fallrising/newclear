# 閱讀快記私人試用準備報告

Issue [#473](https://github.com/fallrising/newclear/issues/473)，PR [#474](https://github.com/fallrising/newclear/pull/474)。新提議／owner授權的後續里程碑，非原規格階段3。此初稿為 IN_PROGRESS，尚不可視為交付完成。

## Summary

範圍為 PT-01～05：完整web＋固定commit內容release、離線preflight、Linux排程範本、本地CF/Git流程與正式接線手冊。重用階段2 builder/exporter；D1/Git權威與撤銷、CAS、journal、遠端確認維持。正式環境未驗證。

## Verification

所有build/test經共同launcher，Node24.18.0。實際命令與exit在專用task evidence目錄；最終驗證尚在進行，待補結果。原階段2的314 backend/Node及55 E2E pass/1預期skip為歷史，不冒充本次重跑。

## Documentation

[範圍與AC](../../docs/plans/reading-private-trial.md)、[私人操作手冊](../../reading/PRIVATE-TRIAL.md)、[設定／排程範本](../../reading/ops/trial.example.json)，同步SUCCESS、README、任務板與worker任務。

## Risks and Follow-ups

正式內容repo/commit/registry、HTTPS origin、Cloudflare bindings、operator憑證安排與Linux執行/backup路徑需owner私下提供。未部署、未套正式migration、未設定secrets、未啟用timer。真手機、正式撤銷、備份回復由owner執行。聊天室AC-04仍pending；沒有usable tag。最終獨立審查與CI尚未完成。
