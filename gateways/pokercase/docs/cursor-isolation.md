# Cursor 執行隔離（T-0377）

Owner 已決定保留 Cursor provider，授權以外部隔離取代不可靠的主機直接執行。此規格只涵蓋主機檔案／程序邊界；真實 Cursor 登入與完整帳號旅程仍待驗證。

## 原因與設計

原 session 在 `ask + sandbox` 下仍能讀寫 workspace 外測試檔並執行 shell。因此這些參數只表示 CLI 模式，不能作為隔離證明。

啟用時只允許本機 Docker 執行，不再直接 spawn Cursor。operator 提供固定 image ID／digest、專用 `thinrouter-cursor-` named volume 與既有 plugin opt-in；缺少任一條件回 503，不回退主機。Cursor 命令在 image 內解析。使用非 root UID 1000、read-only rootfs、drop all capabilities、no-new-privileges、private PID namespace、init、CPU／memory／PID 限制及有界 tmpfs workspace。只掛專用 profile volume，不掛主機 HOME、gateway 資料或 Docker socket。

每次請求有獨立容器名；正常結束、失敗、取消時清理該容器。Docker／CLI 錯誤只回固定診斷，不回傳任意 stderr。控制 Docker 的 runtime 路徑是 operator 設定，不能由 API request 決定。

容器仍需網路連 Cursor：此切片使用 Docker bridge，**不保證阻擋 host services、LAN、任意外網或帳號 plugins**。專用 profile 內的 Cursor 憑證與資料仍可被同容器 agent 存取。provider 維持預設關閉；這不是可供不可信多人使用的隔離服務，不以容器測試宣稱全體外部能力已受限。

Docker 是此 opt-in provider 的執行前提（本機已安裝），不新增 Rust runtime dependency。其他 provider 不依賴 Docker。網路限制、獨立帳號及 client tools/images 是後續範圍，不在本次偷偷開啟。

## 驗收

| AC | Given / When / Then | 驗證 |
| --- | --- | --- |
| CI-1 | Given 未 opt-in 或缺 image/profile，When 請求 cursor，Then 503 且不 spawn host Cursor。 | 整合測試與啟動紀錄 |
| CI-2 | Given 啟用且有效設定，When 呼叫，Then 只經固定 Docker 邊界，無 host bind、privileged、host PID/network 或主機 env 傳入。 | launcher 參數測試及實際容器 canary |
| CI-3 | Given 惡意／失誤的 image 或 profile 輸入，When 配置，Then 拒絕非固定 digest／非專用 volume 名，不拼 shell。 | 單元與整合測試 |
| CI-4 | Given 串流、成功、失敗與取消，When 結束，Then 保留既有協定轉換、usage，回收容器；任意 stderr 不進錯誤／日誌。 | 假 runtime 整合測試 |
| CI-5 | Given 真實 Docker 與無憑證假 CLI，When 讀 host canary／寫 rootfs／讀 host env/socket，Then 均不可得；workspace 可寫且結束後容器消失。 | 手動離線 canary；不能冒稱真帳號 PASS |

## 來源

- https://cursor.com/docs/cli/reference/permissions — print mode 有 shell／write 能力；模式旗標不是 OS 邊界。
- https://docs.docker.com/engine/network/drivers/bridge/ — bridge 允許出網及同網路互通，不能當外連 allowlist。

原始真 CLI 探測只保留既有證據，不重新呼叫付費模型或讀取真實憑證。此里程碑不宣稱整體 SUCCESS 主線完成。

## Operator setup

Build a trusted image from a reviewed official Cursor Agent executable bundle, not from a home directory. `containers/Cursor.Dockerfile` expects only that version's installed files as `cursor-agent/` in the build context. Pin `BASE_IMAGE` to your approved digest when building. No account data belongs in the image.

```sh
# In a fresh build context containing only cursor-agent/ and Cursor.Dockerfile:
docker build -f Cursor.Dockerfile -t thinrouter-cursor:local .
docker image inspect thinrouter-cursor:local --format '{{.Id}}'
```

Use the resulting `sha256:...` image ID as `--cursor-image`. Provision a dedicated named volume beginning `thinrouter-cursor-`, and log in using the same image and a volume mounted at `/home/cursor`, as UID 1000. Do not import or mount your host home, gateway data, Docker socket or existing unrelated volumes. Login and refresh stay inside that profile. A fresh Docker named volume inherits the image's `/home/cursor` ownership. No login is performed by thinrouter itself.

```sh
docker run --rm -it --user 1000:1000 \
  --mount type=volume,src=thinrouter-cursor-profile,dst=/home/cursor \
  --entrypoint cursor-agent sha256:YOUR_REVIEWED_IMAGE_ID login
thinrouter serve --cursor-accept-account-plugins \
  --cursor-image sha256:YOUR_REVIEWED_IMAGE_ID \
  --cursor-profile-volume thinrouter-cursor-profile
```

`--cursor-bin` now names the executable **inside** the image; `--cursor-runtime-bin` selects the trusted operator's Docker executable (normally `docker`). Images are never automatically pulled by inference. The default local Docker socket is used; no privileged container or host network is requested.

Docker's operator-configured proxy variables may still enter the container. The runner does not forward the gateway's application environment, but does not claim Docker configuration is secret-free. Hard-killing the gateway or losing the daemon can prevent cleanup; reconcile only containers with the generated `thinrouter-cursor-` names before restarting. Normal completion, errors and client cancellation perform bounded cleanup.

The recipe and live Cursor authentication are not established by a fake CLI canary. Verify the chosen bundle/image/account separately before enabling a real route; account plugins and arbitrary network access remain explicit limitations.

Cleanup is bounded: daemon creation that finishes after the final reconciliation attempt can still leave a container. Operators must reconcile such leftovers; neither this change nor its helper test proves unconditional cleanup.
