# Retro Economy — 霧岸鎮

> 主線與剩餘驗收：[SUCCESS.md](SUCCESS.md)。RE-1 單人路線已驗證；本次 RE-2 加入掛單、購買、取消，驗證結果見交付報告。RE-3 真人試玩尚未完成。

原創俯視小鎮冒險：選鐵匠或藥師，走到資源點採集，回鎮製作補給，再走塔路。地圖與素材使用自製 SVG 幾何圖形，沒有外部素材、CDN 或第三方執行期依賴。

## 本機啟動

從 repo 根目錄執行（Python 3.11 以上）：

```sh
python3 labs/retro-economy/server.py --host 127.0.0.1 --port 8080 --db labs/retro-economy/var/retro-economy.sqlite3
```

開啟 `http://127.0.0.1:8080`。省略 `--db` 時也使用元件內的 `var/retro-economy.sqlite3`。停止伺服器後用相同資料庫重新啟動，再用同一瀏覽器開啟即可續玩；角色、背包、掛單、塔路進度與一次性獎勵都會保留。瀏覽器 localStorage 保存角色 token 與未確認的動作；不要清除儲存資料或按「重設此瀏覽器角色」，否則會失去原角色的存取 token。

服務預設只監聽本機。token 是本機示範的角色綁定，不是正式登入或 production authentication；沒有公開部署或多人容量承諾。

## 第一趟路線

- 鐵匠：向西走三步到礫坡，採集兩次，向東三步回鎮，製作一個修補組。
- 藥師：向南走四步到潮林，採集三次，向北四步回鎮，製作一份行路藥。
- 每個新角色另有一份異職補給，只發一次。備好兩種成品後，從鎮向東走四步：路障消耗修補組，遭遇消耗行路藥，首次登頂得到八金幣。
- 使用方向鍵／WASD 或畫面按鈕。無藥遭遇會送回鎮，已用的修補組不退；回鎮重置本輪塔路進度。首次獎勵不會重領。第二輪需要異職供應：鐵匠向藥師買行路藥，藥師向鐵匠買修補組。

採集、製作、移動與交易每次都由伺服器驗證並原子保存。網路回覆遺失時，客戶端保留同一動作 ID 重試，不會重複採集或扣物。

## 交易與第二趟路線

用兩個瀏覽器或隔離的瀏覽器 profile 開啟相同伺服器，各選一種職業。一般同瀏覽器分頁共用 localStorage，會連到同一角色；不要用重設來切換仍需保留的角色。

1. 採集與製作多一份自己的成品。在市場選物品、數量和整筆總價，按掛單；四種物品皆可交易，數量與價格各 1–99。
2. 另一角色從市場按購買，整筆物品和貨幣一次轉移。自己的 open 掛單可取消；sold／cancelled 保留顯示。市場每 1.5 秒同步。
3. 掛單不預扣或保留物品。賣家之後用掉庫存，購買會拒絕，掛單仍開放；補貨後買家可再試。取消不會增加背包。交易沒有地點限制。
4. 各自買到異職補給、帶上自己的成品，回鎮後再走塔路；每輪消耗兩種成品，第二輪不再發首次獎勵。

網路中斷時保留待確認動作並按重試；不要靠重新掛單猜測是否成交。重載會重送原 ID，同一掛單或成交不會重複生效。使用原 RE-1 資料庫即可升級，啟動時新增掛單表，不重發角色補給。

## 驗證與規格

從 repo 根目錄執行：

```sh
python3 -m unittest discover -s labs/retro-economy/tests -p 'test_*.py' -v
node --test --test-isolation=none labs/retro-economy/tests/test_ui.mjs
node labs/retro-economy/tests/browser_smoke.mjs
```

前端單元測試和瀏覽器驗收使用 Node 24；瀏覽器驗收另需可正常啟用 sandbox 的 Chrome／Chromium（預設 `google-chrome`，可用 `CHROME` 指定執行檔）。它會啟動測試伺服器與瀏覽器，使用暫存資料庫。設定 `AGENT_BUILD_DIR` 與 `AGENT_EVIDENCE_DIR` 到測試輸出目錄，或於 CI 使用 `RUNNER_TEMP`。代理工作必須透過 workspace launcher 執行，詳見上層 AGENTS.md。遊戲執行本身不需要 Node 或測試瀏覽器安裝包。

[規則表](docs/rules.md)、[SDD](docs/SDD.md)、[API／重試契約](docs/re1-contract.md)、[RE-1 驗證報告](tasks/454-re1-solo/report.md)、[RE-2 交易契約](docs/re2-contract.md) 與[RE-2 交付報告](tasks/475-re2-trading/report.md)。CI 保存實際瀏覽器截圖及狀態核對結果。數值尚未由真人試玩驗證；RE-3 的 2–3 真人場次仍待完成。

[OpenMMO Lab](../openmmo-lab/README.md) 與 [Zircon-Godot](../zircon-godot/README.md) 僅是上游研究，不是執行依賴。投入與文檔檔位未分級；本次不改作品集決策。
