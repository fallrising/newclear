# Kith 階段 1：快記＋收件匣

Session: Kith-20261021-1837
Issue: https://github.com/fallrising/newclear/issues/456
Base: 9b31fa1776213b68e7d38b6db4f706e6dd7def15

## 範圍

依 docs/plans/cloudflare-reading-capture.md §7 與 reading-capture-tests.md 交付 RC-01～04：operator 私人快記、收件匣、本機草稿、冪等保存／衝突及預定 notes/export 路由的認證拒絕。提升階段 0 草稿為正式 migration，先在隔離 D1 驗證。只改 products/kith 與本次 .team 調度／證據，沿用既有依賴。

## 驗收與順序

先寫本地 CF E2E 並記錄 RED，再實作 API/Web，取得 GREEN。覆蓋原文 byte-preserving 保存、D1 commit 後回應遺失與同 key 重送、競爭／衝突、離線與 storage 失敗、operator/member/anonymous/expired/CSRF、大小與分頁界線；證明無 provider 呼叫且聊天室不變。

## 驗證

以共用 workspace launcher 執行既有 Node 24.18.0 的 npm lint/test、web build、對應 E2E／證據 validator，以及 Python success/capability validators、diff check。完整命令、exit、工具版本與不可變輸出寫入 report。最終 head 必須經不同模型家族唯讀審查與全綠 CI，再核對最新 main 才可合併。

## 授權與限制

Owner 已授權 commit/push/PR 與符合條件後 merge commit；禁止 deploy、付費 API、force push、修改 AGENTS/CLAUDE、關 issue、刪 branch/tag、縮減驗收。Reviewer 優先 Grok；OpenCode 僅可選 deepseek-v4.1-flash。階段 2 的閱讀、notes 實作與 Runner 不在本次範圍。
