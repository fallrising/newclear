# Edge Ops — STATUS

本檔是本專案唯一的進度權威。日期：2026-09-27。

## 目前狀態

**SDD v0.1 draft / documentation-only。尚未實作、尚未部署、尚未完成 owner acceptance。**

本次範圍：建立 `platform/edge-ops` 設計專案，研究 CF-Server-Monitor 與官方 provisioning/agent 模式，拆分前端／後端／Agent，定義 optional 初始化與安全驗收。未授權也未執行真實主機變更。

| 項目 | 狀態 | 證據／限制 |
| --- | --- | --- |
| Repository 規範與相鄰邊界 | 已讀取 | 固定 base `0497fc2ade6c1dd085623f700a368c4402ee22b1`，詳見 SOURCES |
| Upstream 與官方文件研究 | 已整理 | SOURCES 的 S01–S20；上游只讀 README 指定段落，非 source audit |
| Frontend／Backend／Agent SDD | draft | docs/sdd/01–03；沒有 runtime 程式碼 |
| Image／bootstrap 與業界說明 | draft | docs/sdd/04；不是可执行 user-data 或安裝器 |
| 安全／契約／驗收／容量 | draft | docs/sdd/05–07；schema 和測試尚待 M0 |
| 獨立 review／owner acceptance | pending | 不能用本次自查代替独立安全審查 |
| M0–M6 implementation | not started | 沒有 Node/Go dependency installation 或 build |
| Target-host／Cloudflare live tests | not run | 本次非部署授權，沒有使用 production credential |

## 下一個最小切片

owner 接受設計且明確要求實作後，開始 M0：把 API、metrics envelope、JobManifest、strict JSON policy 與狀態機落成契約；做 TS/Go 簽章 vectors、D1 CAS/0-row transaction fixtures，再允許三條工作線平行。

M0 不包含遠端主機、Cloudflare deploy、Terraform apply 或有副作用 scripts。第一個有 executable code 的 PR 才接 root path-scoped CI，並記錄確切 toolchain／lockfile。

## 續作規則

先核對實際 main、相關 PR 與此檔；不要僅憑固定入口 prompt 認定仍在 M0。每次完成更新固定 commit、實測／未測、pending review、下一步。PR merge、設計接受、功能驗收與 deployment 分開記錄。
