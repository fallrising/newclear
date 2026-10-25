# Kith technical task board

## T-9900

Owner direct instruction：交付 AC-04 執行輸入填寫文件，發布至 owner 指定的遠端項目；本地編號，非 GitHub issue ID。文件範圍，不啟動依賴未齊的 runtime 開發。範本見[執行輸入表](../plans/ac04-owner-inputs.md)。

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-9900-INPUTS | 填寫規格、本地私有交回位置與文件檢查；文件 PR 已合併，owner 延後填寫 | AC-04（輸入準備，非驗收通過） | done | 2026-10-22T14:30:07Z | 2026-10-22T15:54:06Z | 2026-10-22T15:54:42Z |

PR [#489](https://github.com/fallrising/newclear/pull/489) merged at `2026-10-22T15:54:06Z` as `ed32973f9f9352847cb7a89bb7b8e47aeb9e0fc4`, reviewed head `f2106b9f9d90ea72aab6773605784280775dcfec`. [Final document verification and independent native review](https://github.com/fallrising/newclear/pull/489#issuecomment-6345103361): 41 project-success contracts, task/report and document checks passed; exact-head CI test/web/validate all SUCCESS. Owner explicitly requested this document merge and deferred filling the form. This closes the input-document task only; AC-04 runtime development, model inputs and true-boundary acceptance remain pending. No model calls, deployment or usable tag.

## T-0463

Owner direct instruction; issue [#463](https://github.com/fallrising/newclear/issues/463), PR [#464](https://github.com/fallrising/newclear/pull/464). No desk card. SDD security invariants and [phase2 contract](../plans/reading-capture-phase2.md) apply.

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0463-RC2 | Reading, human notes, immutable content CI and recoverable Git export; final review/CI/merge | AC-RC2 (RC-04–07) | done | 2026-10-22T03:53:29Z | 2026-10-22T04:28:27Z | 2026-10-22T04:28:54Z |

PR #464 merged at the recorded end time as `33cfc39c92753701fc3e33d8ae27c93f117f0d9e`. [Final verification](https://github.com/fallrising/newclear/pull/464#issuecomment-6332676149): 314 backend/Node checks passed; full browser regression 55 passed and one expected desktop-only skip (mobile counterpart passed); final-head CI and independent xAI Grok review passed. This board-only follow-up records completion under the root technical-task contract. No deployment or full Kith mainline acceptance is implied.

## T-0473

Owner direct instruction; issue [#473](https://github.com/fallrising/newclear/issues/473). 新里程碑：閱讀快記私人試用準備。

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0473-PT1 | 私人試用準備 PT-01 | AC-PT01 | done | 2026-10-22T10:02:57Z | 2026-10-22T12:21:37Z | 2026-10-22T12:22:18Z |
| T-0473-PT2 | 私人試用準備 PT-02 | AC-PT02 | done | 2026-10-22T10:02:57Z | 2026-10-22T12:21:37Z | 2026-10-22T12:22:18Z |
| T-0473-PT3 | 私人試用準備 PT-03 | AC-PT03 | done | 2026-10-22T10:02:57Z | 2026-10-22T12:21:37Z | 2026-10-22T12:22:18Z |
| T-0473-PT4 | 私人試用準備 PT-04 | AC-PT04 | done | 2026-10-22T10:02:57Z | 2026-10-22T12:21:37Z | 2026-10-22T12:22:18Z |
| T-0473-PT5 | 私人試用準備 PT-05 | AC-PT05 | done | 2026-10-22T10:02:57Z | 2026-10-22T12:21:37Z | 2026-10-22T12:22:18Z |

PR [#474](https://github.com/fallrising/newclear/pull/474) merged at `2026-10-22T12:21:37Z` as `5f60f06da82562fa42066df25bb7be40cc7d5e88`. [Final verification and independent review](https://github.com/fallrising/newclear/pull/474#issuecomment-6340602377): 330 backend/Node checks; exact-head full E2E 57 passed and one expected desktop-only skip (mobile counterpart passed); final-head CI and independent DeepSeek V4.1 Flash review passed, with latest main integrated. This board-only closeout records PT01–05 preparation completion. Formal private wiring, deployment, remote migration/secrets, service activation and real-device acceptance remain unperformed; Kith chat AC-04 remains pending and no usable tag is created.

## T-0629

Owner direct instruction；issue [#629](https://github.com/fallrising/newclear/issues/629)，無 desk 卡。承接者：ChatGPT 主導（`kith-activity-docs-20261025`）；其餘 agent 僅作來源查核與獨立文件審查。工作範圍與授權見[task](../../tasks/629-agent-activity-design/task.md)，證據見[report](../../tasks/629-agent-activity-design/report.md)。AV-0 文件已由 [PR #630](https://github.com/fallrising/newclear/pull/630) 於 `2026-10-25T09:10:46Z` 合併，merge commit 為 [`8429179be18bdcf2c7efd51b65b90a1beb5fc5f3`](https://github.com/fallrising/newclear/commit/8429179be18bdcf2c7efd51b65b90a1beb5fc5f3)。

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0629-DOC1 | 固定來源與重用／差異核對 | AC-AVDOC-01 | done | 2026-10-25T08:20:05Z | 2026-10-25T09:10:46Z | 2026-10-25T09:11:52Z |
| T-0629-DOC2 | 活動、提及、展示與程式驗收計畫 | AC-AVDOC-02 | done | 2026-10-25T08:20:05Z | 2026-10-25T09:10:46Z | 2026-10-25T09:11:52Z |
| T-0629-DOC3 | 文件導航、檢查、審查、PR 合併與收尾 | AC-AVDOC-03 | done | 2026-10-25T08:20:05Z | 2026-10-25T09:10:46Z | 2026-10-25T09:11:52Z |

最終受審 head `cce2f765ffcd52339b3c30ee8b342abb36a0abf5` 的 [Kith CI](https://github.com/fallrising/newclear/actions/runs/40179429636)（test／web）與 [Project success contracts](https://github.com/fallrising/newclear/actions/runs/40179429638)（validate）均成功；文件／來源／合併授權獨立審查 ACCEPT，167 個相對連結目標、8 檔白名單與 SUCCESS 檢查通過。合併後已回讀 PR 的 merged_at／merge SHA、main ref、commit tree 及計畫／報告／任務板，與受審內容一致。

本次只補記 AV-0 文件任務的實際完成狀態與合併時間。AV-1／2／3 仍 NOT_STARTED；聊天室 AC-04、mainline 與 usable tag 資格不變，未實作動畫、啟動 provider、部署或付費。
