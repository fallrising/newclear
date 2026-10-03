# P0 驗收紀錄

日期：2026-10-04（Asia/Singapore）。上游 pin：`8ba09cf662bcc1b9d4ccebc0a7a1fba85cc47dc5`。

## 已執行

| 項目 | 結果與證據範圍 |
| --- | --- |
| 版本鎖 | `python3 lab.py check` 通過；僅驗證 lock 格式與來源約束 |
| 工具測試 | `python3 -m unittest discover -s tests -v`，8 tests 通過；使用臨時真實 Git fixture，測 pin、dirty/untracked、lock checksum、覆寫／symlink／Compose drift、環境覆寫、blocked up、資料保留參數 |
| 真實 checkout | 固定上游 clone 上 `render` 通過；未修改上游 tracked files |
| 缺依賴行為 | 真實 `doctor` exit 2：Docker CLI/engine/Compose 不存在、Google Web client ID 未配置、283 個 client assets 缺少／不符；沒有啟動 build 或遊戲 |

測試不聲稱 Docker schema 已由 Compose 驗證，也不聲稱遊戲功能可用。此環境另無 Podman 與 Rust toolchain；未安裝 daemon、未借用其他帳號設定，未下載大型資產。

## 主機接手後待驗（全部 pending）

| Gate | 方法 | 成功判準 |
| --- | --- | --- |
| 環境 | 資產 fetch、OAuth origin、doctor | checksum 全過，engine/Compose 可用，Web client ID 合法；ready-to-build |
| 建置 | up；記 image IDs、架構、版本、耗時／磁碟 | 兩個 image 本地 build 成功；初始化成功，server healthy，client HTTP 可達 |
| 世界 | 兩個不同 Google 帳號／瀏覽器 profile | WebGPU 場景載入，A/B 相互可見，移動與位置更新 |
| 戰鬥 | A/B 對可攻擊目標執行正常戰鬥 | 兩端 HP／死亡／掉落一致，server 無異常；不把只看到動畫當成功 |
| 交易 | 記錄 A/B 物品、數量／金額；雙方確認一次交易 | 前後數量守恆，取消交易不丟失／複製物品 |
| 持久化 | 記錄角色／物品；down → up 後重新登入 | 角色、背包與交易結果符合上游持久化規則，未意外新建空世界 |
| 復原 | stop 後備份；另一 workspace/port 還原 | 不修改原世界；備份角色與物品可讀、可登入，證明備份可用 |

填入每項時間、實際命令、脫敏結果及失敗重現步驟。任何 gate 未過，仍是 P0 未完成；不得把 `up` exit 0 或單元測試結果替代 gameplay 驗收。
