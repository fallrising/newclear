# P0 驗收紀錄

## 2026-10-23 主線恢復（UTC 2026-10-22）

Owner 已啟用完整 P0。Lab 基線 `b7f2a4311d1135977ba273efba8e77702b908036`，
上游仍是 `8ba09cf662bcc1b9d4ccebc0a7a1fba85cc47dc5`，資產 revision 仍是
`0b1797ef92f58caa73697aaa1f3bd4d88eda1d08`；沒有換 pin 或修改上游。
本輪是本機隔離測試；未使用 VPS、未停止其他服務、未提交／push／合併／部署。

| 層次 | 本次結果與證據範圍 |
| --- | --- |
| AC-01 pin/render | `check`、真實 clean checkout 的 `render`、pin/asset-lock hash 核對通過。lock SHA-256 `83908ca0f1383e4b35ae239de555645bbc553133f33d7ce4dc4124e8372c3201`。真 Compose `config --no-interpolate --quiet` schema 檢查通過，未驗 OAuth interpolation。 |
| 工具回歸 | 原 8 tests 通過；OAuth malformed 值先得到 8 個 RED subtest failures；修正後 10 tests 通過，獨立 reviewer 重跑 10 tests 通過並 ACCEPT。mock 只用於工具行為，沒有當成 Google/Docker runtime 證據。 |
| Docker | Engine `29.8.1`、Compose `5.5.1`、`linux/amd64`；本機有 16 logical CPUs、約 61 GiB RAM。初次 sandbox socket permission denied 保留；授權後真 daemon 可達，起始沒有 running containers。 |
| 資產 bytes | 固定 revision API 回應 SHA 相符、public/ungated；沒有 dataset card，README URL 404。`bash tools/fetch-assets.sh client/public/` exit 0，283/283 files checksum 通過，225.2 秒，locked public payload 合計 492,425,923 bytes。來源授權證據缺口另列下節。 |
| Server build | 固定 Dockerfile 真 build exit 0，121.0 秒。image ID `sha256:f40acc6d5217917a4609e3104726237ce70b3e061081464987a9d7aa7b9e66d5`，inspect size 217,251,888 bytes。 |
| Terrain | 真 server image 的 baker，`--network none`，region -2..1，exit 0，234.2 秒。16 regions、4,096 height tiles、4,096 manifests；read-only volume inspection 通過。volume bytes 229,845,390；worldgen marker SHA-256 `6ec268ee5b44b6fb2ad5d86be0a127f0a0fcde988b35e051a8bf8963dcf0dcc9`。 |
| Terrain reentry | 原 volume 再跑 baker exit 0，0.7 秒；明確輸出 skipping bake。其後 read-only 核對 worldgen SHA 不變。這只證明地形重入，不是角色保存／隔離復原。 |
| Client build | 固定 Dockerfile 真 build exit 0，314.5 秒；WASM 最佳化、Vite build、hash/compress assets 完成。image ID `sha256:c2edb80cff5334a7fdf353c60c9290e47f2a14e413b39f8b46d0804639eef948`，inspect size 2,137,803,025 bytes。未驗 HTTP 或瀏覽器場景。 |
| Doctor | 資產完成後真 doctor exit 2，`asset_problems: 0`；唯一 doctor 缺項為未配置 `GOOGLE_CLIENT_ID`。doctor 不驗證素材授權或 Google client 真實存在。 |
| Compose up／server health／client HTTP | 未跑：缺真 Google Web OAuth client。沒有填入假的 client ID 來讓 up 通過。單獨 Dockerfile build 和 baker 不等同完整 Compose 啟動。 |
| AC-03／AC-04 | 未跑：缺兩個真人 Google/WebGPU 會話與其角色、背包、交易前後值。未以空世界、mock 或單人測試替代。 |
| 文件／diff gate | OpenMMO contract、最後 13 個 Markdown local-link 檢查與 `git diff --check` 通過。全 repo `check_project_success.py` 初次 41 contracts 通過，中途因同 working tree 的 Zircon AC 格式失敗；偵測該檔隨並行工作改變後再跑，最終 41 contracts PASS。中途失敗原樣保留；本次未修改 Zircon。 |

### 資產來源與未解缺口

已閱讀 pinned `LICENSE`、`doc/ASSETS.md`、下載腳本、asset lock 與相關 `doc/assets/` 記錄。
上游軟體為 PolyForm Noncommercial；資產各自條款仍保留，本輪只作個人非商業測試，沒有散佈或改授權。
局部來源有明確紀錄（例如 animals 的 CC BY 4.0、Mixamo 使用／散佈限制、ElevenLabs free-tier 聲效），
但 `music.md` 的 Suno 曲目未列生成 tier/date，`environment.md` 的 tree 未列特定授權證據；
`characters.md` 記有 Tripo 降級後權利未明與生成付款證據保留要求。
這是尚缺可核對資料，不是判定侵權，也不由 checksum 或公開 dataset 推導全部合法。
AC-02 的合法資產門檻維持 pending；下一步取得這些指定素材的適用條款／生成記錄，保留 attribution。

本次另補查第一方來源：[Poly Haven](https://polyhaven.com/license) 聲明其 assets 為 CC0；
[Freepik cloud 原圖](https://www.freepik.com/free-photo/white-cloud_3816314.htm) 列作者 lifeforstock、免費授權及需署名，
因此不再把 cloud 的「未知是否免費」當作缺項；仍保留上游署名與縮圖修改記錄。
[Suno 免費方案說明](https://help.suno.com/en/articles/9601601) 允許個人非商業用途，
所以本 P0 不要求購買商業授權；尚缺的是固定遊戲曲目與提供者適用權利的對應資料，不能由通用 FAQ 推定。
tree 的 Sketchfab 原始頁本次 HTTP 403、API 亦未取得，未驗即保留 pending。

### 本次實際命令與證據

`$OPENMMO_SOURCE`、`$OPENMMO_RUNTIME`、`$TERRAIN_VOLUME` 是 repo 外專用來源、runtime 及其 terrain volume 的去識別代號。
原始日誌保存在共用 workspace `openmmo` project 各 task 的 `preserve/evidence/`；私人 handoff 留在 repo 外。
下列為實際執行命令的核心 argv；建置／測試使用共用 launcher，capture wrapper 記錄 stdout/stderr、退出碼及耗時。

```sh
python3 lab.py check
python3 -m unittest discover -s tests -v
git clone --no-checkout https://github.com/Julian-adv/OpenMMO.git "$OPENMMO_SOURCE"
git -C "$OPENMMO_SOURCE" checkout --detach 8ba09cf662bcc1b9d4ccebc0a7a1fba85cc47dc5
python3 lab.py render --source "$OPENMMO_SOURCE" --workspace "$OPENMMO_RUNTIME"
python3 lab.py doctor --workspace "$OPENMMO_RUNTIME"
```

以下 build/fetch 在固定 source cwd 執行，terrain run 在 lab cwd 執行：

```sh
bash tools/fetch-assets.sh client/public/
docker build --target server -f docker/server.Dockerfile -t local/openmmo-lab-server:8ba09cf662bc .
docker build -f docker/client.Dockerfile -t local/openmmo-lab-client:8ba09cf662bc .
docker run --rm --name openmmo-terrain-20261023 --network none \
  --mount "type=volume,source=$TERRAIN_VOLUME,target=/terrain" \
  -e TERRAIN_REGION_MIN=-2 -e TERRAIN_REGION_MAX=1 \
  --entrypoint /usr/local/bin/terrain-bake.sh local/openmmo-lab-server:8ba09cf662bc
```

| 共用 workspace task | 證據 |
| --- | --- |
| `oauth-red-20261023` / `oauth-red-quotes-20261023` | `tests.log`，6／8 項 RED failures，保留歷史失敗 |
| `oauth-green-20261023` | `tests.log`，10 tests PASS |
| `review-20261023` / `review-dotenv-20261023` | reviewer 重跑及 dotenv probe；[獨立審查](../.team/reports/T-002.md) |
| `server-build-20261023` | `server-build.log`，真 server build |
| `assets-20261023` | `asset-fetch.log`，283 checksum pass |
| `terrain-20261023` / `terrain-inspect-20261023` / `terrain-reentry-20261023` | `terrain.log` / `terrain-inspect.log` / `terrain-reentry.log` |
| `client-build-20261023` | `client-build.log`，真 client build PASS |
| `doctor-initial-20261023` / `doctor-assets-20261023` | `doctor.log`，前者下載中尚缺 273 assets，後者只缺 OAuth；兩者 exit 2 |
| `compose-schema-20261023` | `compose-schema.log`，真 Compose schema PASS；未展開 OAuth 值 |
| `final-receipt-20261023` | image/volume 身分與 marker 重驗；private `preserve/artifacts/runtime-handoff.json` 記錄來源、runtime、volume 與接手方式 |
| `final-docs-20261023` / `final-scoped-contract-20261023` / `final-contracts-20261023` | local links PASS、OpenMMO contract PASS、全 repo contract FAILED（Zircon AC 格式） |
| `handoff-links-20261023` / `final-contracts-recheck-20261023` | 最後 13 個 Markdown links PASS；Zircon 檔案改變後全 repo 重跑 41 contracts PASS |

脫敏 [receipt](evidence/2026-10-23.json) 保存 image IDs、資產／terrain 統計及日誌 SHA-256。
本次 OpenMMO 容器已全部退出（0 active）；來源、runtime、images、terrain volume 與證據保留。
沒有世界／帳號 state 可供 AC-04 驗收；不得把 terrain marker 不變寫成角色／背包持久化通過。

下一個最小步驟：owner 指定既有私有 `.env` 路徑，或在本次 runtime `.env` 填入真 Web client ID；
authorized origins 需包含主世界 `http://localhost:18080` 與復原世界 `http://localhost:18081`。
不需要 client secret、密碼或 token。之後重跑 doctor/up，收集 server health、client HTTP 與兩個真人登入的 WebGPU 證據。
資產來源缺口按上節逐項補證；接著依原 gameplay／持久化／復原 gates 驗收，不更換世界或縮小 AC。

## 歷史：2026-10-04

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

## 發布接續

前述未提交／未合併為首次驗證階段的歷史狀態。Owner 隨後明確授權提交、發起 PR 並合併。發布使用最新 main 的隔離 worktree，只包含 OpenMMO 變更與去識別證據；AC-02/03/04 仍 pending，不建立 usable tag。來源、runtime、terrain volume 與私人 handoff 均在 repo 外的持久磁碟保留，重啟不需要重下載或重建地形。
