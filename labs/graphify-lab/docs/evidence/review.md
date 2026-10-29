# 獨立審查

**Disposition: ACCEPT** — runtime `011fa8cac6137735b576e14b5695ea26544e91db`，tree `f7b44ee7f09fa237e391522e77e455fabf90e6d7`。

審查者是未參與本次實作的獨立 agent；主導彙整此紀錄。這不是 GitHub 原生 reviewer approval，也不授權 merge／release／deploy。

## 範圍與核對

- `cache.py`、CLI／scenario runner、fixtures、tests、lock 與 CI 的 correctness、provenance、失效、並行、原子發布及數據解讀。
- 獨立執行 29 個 cache／CLI／scenario boundary tests，全部通過（12.980 秒）。
- 最終 [full-run.json](full-run.json) SHA256：`ce63d3880f0bad18dd890ff0c76911307eb276292c264891ab74e0bf92addefc`；7／7 passed。
- 14 份 input SHA256 同時符合 runtime commit blobs 與工作樹；六份已安裝 Graphify 核心檔與 pinned source 實際內容一致。
- 直接核對 reference HEAD、兩個 consumer 的相同 source／graph inode、graph SHA256、3,925 nodes／8,915 edges、cache.py:512 的定義。
- 全部空間量測、1／2／5／10 consumer 算式及時間統計重算一致；報告沒有私人絕對路徑。

## 發現與修正

**P2，已修復：** ancestor ignore/config 改變後，原 wrapper 可能重用舊 index。
真 Graphify 重現為 source 內 alpha／beta，父目錄新增 `.graphifyignore` 後舊圖仍有 beta，而空 cache 重建只剩 alpha。

修正把 ancestor ignore/config、Git HEAD、tracked membership、info/global excludes 納入 index identity，建圖前後及 warm 回傳前皆重驗。
越界的 JS/TS resolver 設定明確拒絕。新增真 Graphify regression 涵蓋這些變化；最終 full 也通過。

另完成 Python `-I` 與 ambient `GRAPHIFY_*` 清理，防止未記錄的模組 shadow／設定干擾。
未觀察到攻擊，未將此預防性隔離修正稱為已證實的上游漏洞。

## 接受範圍

目前沒有剩餘 must-fix。Graphify 保留原生 parser／MCP，cache wrapper 只做編排與驗證。
MCP 時間是相同 query 的 warm round trip；CLI 與 rg 工作量不同。
空間 90% 左右的數字是十個 consumer 皆各自保存 source＋index 的推算，單一 consumer 相對 source-only 會多約 11.60 MB。
所有語言完整性、LLM 端到端品質／token 節省、production 部署及 HTML 互動／CDN 離線行為不在這次接受宣告內。
