# Quickstart — OpenMMO Lab

## 前提與狀態

需要 Python 3.10+、Git、Bash、curl、sha256sum、本機 Docker engine + Compose v2、可用的 Docker build 網路，以及支援上游 WebGPU client 的瀏覽器。主機須能長時間編譯 Rust/WASM 並生成地形；資源下限尚未量測。小範圍地形預估約 1 GB，另需資產、image、build cache 和 state 空間；不要把它當作總磁碟需求。

以下 `check`、測試、固定 checkout 的 `render` 與缺依賴 `doctor` 路徑已驗證。**其餘下載資產、Docker build/up、Google 登入、雙人驗收與備份命令為 skipped：本次環境沒有 Docker／使用者 OAuth 設定。** 完整紀錄見 [acceptance.md](acceptance.md)。

所有命令由 `newclear/labs/openmmo-lab` 開始，同一 shell 逐批執行。兩個外部目錄必須是新的專用目錄，不可放進 newclear。先修改路徑，避免覆蓋已有 checkout。

## 1. 檢查與取得固定版本

```sh
python3 lab.py check
python3 -m unittest discover -s tests -v
OPENMMO_SOURCE="$HOME/src/openmmo-upstream"
OPENMMO_RUNTIME="$HOME/openmmo-runtime/p0"
```

```sh
git clone https://github.com/Julian-adv/OpenMMO.git "$OPENMMO_SOURCE"
git -C "$OPENMMO_SOURCE" checkout --detach 8ba09cf662bcc1b9d4ccebc0a7a1fba85cc47dc5
git -C "$OPENMMO_SOURCE" status --short
python3 lab.py render --source "$OPENMMO_SOURCE" --workspace "$OPENMMO_RUNTIME"
```

`render` 只寫外部 workspace 的 `compose.json`、`lab-state.json`、`.env`，不啟動服務。重跑保留 `.env`；不同 pin／路徑／已修改 Compose 檔會拒絕覆寫。更換埠可在首次 render 加 `--port`。

## 2. 資產與 Google 登入（skipped）

先閱讀固定版本的資產下載腳本與 `assets.lock`，確認下載來源／條款。腳本會取得鎖定的 Hugging Face dataset；下載和 checksum 檢查可能耗時。

```sh
less "$OPENMMO_SOURCE/tools/fetch-assets.sh"
less "$OPENMMO_SOURCE/assets.lock"
(cd "$OPENMMO_SOURCE" && bash tools/fetch-assets.sh client/public/)
```

在自己的 Google Cloud 專案建立 **Web application OAuth client**，將實際使用的本機 origin 設定為 Authorized JavaScript origin，例如 `http://localhost:18080`。所有瀏覽器使用相同 origin；本機連線由 loopback port 接收。若 OAuth 要求測試使用者，加入兩個測試帳號。把 client ID 填到外部 workspace `.env` 的 `GOOGLE_CLIENT_ID`；client 和 server 共用此值。此流程不需要 client secret；不要把帳號 token、`.env` 或 state 提交到 Git。

`ADMIN_EMAILS` 預設空白。P0 用普通玩家測試，不必開管理員。遠端主機後續可經 SSH local port forward 在本機瀏覽器使用，但本輪沒有配置遠端主機或公開入口。

## 3. 檢查與啟動（skipped）

```sh
python3 lab.py doctor --workspace "$OPENMMO_RUNTIME"
python3 lab.py up --workspace "$OPENMMO_RUNTIME"
python3 lab.py status --workspace "$OPENMMO_RUNTIME"
```

`doctor` 缺 Docker engine、Compose、Web client ID 或資產 checksum 不符時回傳 exit 2；不會建置。`up` 通過檢查後從固定 checkout 建置 server/client，再啟動小世界。初次地形生成仍可能長時間做全域 erosion；沒有超時即假裝成功的機制。`started` 僅表示 Compose 啟動命令成功，**不表示 gameplay 已驗收**。開啟 `http://localhost:18080`，確認瀏覽器 WebGPU、登入與場景載入。

查看初始化與 server 問題（skipped）：

```sh
docker compose --project-directory "$OPENMMO_RUNTIME" --env-file "$OPENMMO_RUNTIME/.env" -f "$OPENMMO_RUNTIME/compose.json" logs --tail 100 terrain-init server client
curl -fsS http://localhost:18080/api/announcements
```

手動 Compose 命令應在沒有 `COMPOSE_*` 覆寫的 shell 執行；`lab.py` 自動排除這些環境變數並明確指定 project name。不要手改生成的 Compose 或共用其他環境的 project name。

## 4. 驗收與停機（skipped）

在兩個獨立瀏覽器 profile，以不同帳號進入同一小世界。依 [acceptance.md](acceptance.md) 完成移動可見、戰鬥、交易與重啟持久化。記錄角色測試別名、物品／金額前後值、上游 SHA、瀏覽器版本和時間；遮蔽帳號與 token。

```sh
python3 lab.py down --workspace "$OPENMMO_RUNTIME"
python3 lab.py up --workspace "$OPENMMO_RUNTIME"
python3 lab.py status --workspace "$OPENMMO_RUNTIME"
```

`down` 不帶 `-v`，保留 state、NPC 及 terrain volumes；只有手動明確刪除才會清空。workspace 的絕對路徑決定 project/volume 名稱：移動 workspace 等於另一個世界，勿以為資料遺失。

## 5. 備份與復原（skipped）

備份須在 server 停止寫入時進行，放到 Git 外的私人目錄。先停服務（保留 container），再複製 state、NPC 與 terrain（含世界編輯）；時間戳只是例子，目標目錄必須全新。

```sh
OPENMMO_BACKUP="$HOME/openmmo-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 -p "$OPENMMO_BACKUP"
docker compose --project-directory "$OPENMMO_RUNTIME" --env-file "$OPENMMO_RUNTIME/.env" -f "$OPENMMO_RUNTIME/compose.json" stop
```

```sh
docker compose --project-directory "$OPENMMO_RUNTIME" --env-file "$OPENMMO_RUNTIME/.env" -f "$OPENMMO_RUNTIME/compose.json" cp server:/state "$OPENMMO_BACKUP/state"
docker compose --project-directory "$OPENMMO_RUNTIME" --env-file "$OPENMMO_RUNTIME/.env" -f "$OPENMMO_RUNTIME/compose.json" cp server:/npcs "$OPENMMO_BACKUP/npcs"
docker compose --project-directory "$OPENMMO_RUNTIME" --env-file "$OPENMMO_RUNTIME/.env" -f "$OPENMMO_RUNTIME/compose.json" cp server:/terrain "$OPENMMO_BACKUP/terrain"
```

另保存 pin、Compose 設定、image IDs 和私人 `.env`；備份可能含帳號與伺服器 token，應按私人備份規則保管。`cp` 完成不是復原成功：在**不同 workspace／埠**建同版本世界、停止服務後複製資料進該世界 volumes，再啟動驗證角色／物品。先備份再覆寫；不直接用原世界做復原演練。本輪未實作自動 restore，必須通過獨立復原驗收後才能宣稱備份可用。

## 後續改碼

基準 checkout 保持乾淨；自己的 fork／feature branch 使用另一個獨立 checkout。上游日後更新時同時審查程式 commit、asset revision、Dockerfile 與授權，再修改 lock 並重新驗收。不要把完整遊戲搬進 monorepo。具體 feature 使用上游測試與 CONTRIBUTING 流程，本 P0 controller 故意拒絕 dirty baseline。
