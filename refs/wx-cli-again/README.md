---
name: wx-cli-again
upstream: jackwener/wx-cli-again
upstream_url: https://github.com/jackwener/wx-cli-again
category: systems-media
tags: [wechat, cli, rust, sqlcipher, local-first, ai-agent, data-export]
language: Rust
license: Apache-2.0
upstream_commit: 077a54cbfe679bda963cd038d8440422907fc797
upstream_version: 0.6.3
preservation: archived-fork
catalogued: 2026-09-19
---

# wx-cli-again

> 微信本地資料 CLI：查詢、解密與匯出。此條目是第三方 preservation reference，不是 `fallrising` 自有作品。

**Upstream:** <https://github.com/jackwener/wx-cli-again>  
**Preservation target:** <https://github.com/fallrising/wx-cli-again>  
**Pinned upstream commit:** `077a54cbfe679bda963cd038d8440422907fc797`

## 保存原因

此 upstream 可能在未來消失，因此與一般可重新取得的 reference 不同：完整 source 與 Git history 應保存為獨立 GitHub fork，並將 fork archive/read-only；`newclear` 只保存索引與 provenance，不把第三方原始碼混入 monorepo。

## 重點

- Rust 2021 CLI，package 名稱 `wx-cli`、binary 為 `wx`。
- 功能涵蓋本機微信資料查詢、解密、搜尋、統計與匯出。
- 上游 README/AGENTS.md 內仍有 `botiverse/wx-cli` 的來源或 push 說明；本 preservation 記錄以使用者指定的 `jackwener/wx-cli-again` 為來源。
- 上游授權為 Apache-2.0；不得因 `newclear` 根目錄為 MIT 而改標第三方程式碼授權。

## 上游開發規範

若日後解除封存並修改保存 fork，先重新閱讀 upstream `AGENTS.md`。目前固定版本要求修改 Rust 後執行 `cargo check`；跨平台程式碼需執行對應 target check；版本變更需同步 `Cargo.lock`。

## 恢復

優先從 preservation fork 取得；若 fork 尚未建立，才從 upstream 固定 SHA 取得：

```bash
git clone https://github.com/jackwener/wx-cli-again.git wx-cli-again
cd wx-cli-again
git checkout --detach 077a54cbfe679bda963cd038d8440422907fc797
```

## 安全邊界

不要將微信聊天內容、資料庫、解密金鑰、憑證或其他個人資料提交到公開 repository。
