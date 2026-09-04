# Changelog

## 1.0.1 — 2026-07-29

- 將 repository/project slug 定為 `flowshot`；應用顯示名稱維持
  `Markdown Annotator`。
- 修正 node DAG 與節點前置條件不一致，確保執行者會讀取直接使用的
  dependency contract。
- 明確區分 annotation/comment row version、document revision 與 app-state
  compare-and-set token；create、desired-set 與 tag merge 不使用虛構 row
  version。
- 將 N00 的文件 ownership 改為可機械驗證的實際 path。

## 1.0.0 — 2026-07-29

- 將討論稿收斂為可執行技術規格。
- 採新 repository + node-level selective migration。
- 決定 canonical rendered text + source-map hint 的 anchor 模型。
- 將 annotation 長期狀態收斂為 `document/attached/orphaned`；`shifted/recovered` 改為 audit event。
- 文件消失改為 `status=missing`，使用者資料全面 soft delete/tombstone。
- Polymorphic tag binding 改為具外鍵的兩張 binding table。
- Tag 使用 Unicode NFKC + case fold；`pin` 為 system tag。
- 加入 document model version、snapshot coherence、revision transaction。
- 加入 conservative rename、PathGuard、symlink 拒絕、stable read。
- 加入安全 local link/image policy、無網路與嚴格 CSP。
- 建立 18 個 node specs、machine-readable DAG、LLM 執行協議與模板。
