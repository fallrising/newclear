# Pi Agent × 基礎平臺 Demo

## Pi 是什麼（30 秒版）

**Pi** 是一個極簡的終端 AI coding agent（`@mariozechner/pi-coding-agent`）。

- 核心很小：預設幾乎只有 `read` / `write` / `edit` / `bash`
- 不做「萬能產品」：沒有內建 plan mode、sub-agent、MCP
- 靠 **Skills / Extensions / Prompt Templates** 讓你把工作流塞進去
- 哲學：**改 harness 去適配你的流程，而不是你適配產品**

官網：https://pi.dev/

Pi **自己不帶模型**；腦（LLM）靠你接的 API。本專案用 **9router** 當 VPS 上的統一 LLM 網關。

---

## LLM Gateway = 9router

本平臺預設接入官方映像 [`decolua/9router`](https://github.com/decolua/9router)（MIT），**不把 9router 源碼 vendor 進倉庫**。

| 項目 | 說明 |
|------|------|
| 端點 | `http://127.0.0.1:20128/v1`（OpenAI-compatible） |
| Dashboard | `http://127.0.0.1:20128/dashboard` |
| 上游 | 在 Dashboard 接 OpenRouter / Anthropic / OpenAI / OpenCode Free / … |
| 客戶端範本 | `platform/clients/`（Pi、OpenCode） |
| 預設綁定 | `127.0.0.1`（公網 VPS 較安全；勿裸露 20128） |

「OpenCode」別搞混：

| 名稱 | 角色 |
|------|------|
| **OpenCode CLI** | 客戶端；把 provider 指到 9router `/v1` |
| **OpenCode Free** | 9router **內部**的免費上游（透傳 opencode.ai） |

合規提醒：訂閱 / 免費通道請自行遵守各家服務條款；本專案不協助規避 ToS。

---

## 你的想像對不對？

> 把 Pi 當成能適應我的 VPS、生成簡易基礎建設的「萬能藥」？

**方向對，但不是萬能藥。**

| 你以為的 | 實際比較接近 |
|---------|-------------|
| Pi = 自動運維平臺 | Pi = 會寫檔、會跑命令的「聰明運維助手」 |
| 說一句就長出完整基建 | 你要先寫好 Skill（食譜），它才穩定 |
| 取代 Terraform/K8s | 它**調用** docker-compose / 腳本 / IaC，不取代它們 |
| 一勞永逸 | 生成後仍要 review、監控、升級、備份 |

更準確的比喻：

> Pi 不是藥，是**會照著你食譜下廚的廚師**。  
> 食譜（Skill）寫得好，VPS 上就能快速長出 Nginx + Prometheus + Grafana + 日誌 + CI + LLM 網關。  
> 食譜沒寫、或機器環境亂，它就會亂炒。

---

## 這個 Demo 在模擬什麼

場景：你寫了很多業務系統後，發現 VPS 上缺「基礎平臺」：

- Nginx 路由
- Prometheus + Grafana 監控
- Loki + Promtail 日誌
- **9router LLM 網關**（接各家 API，供 Pi / OpenCode 使用）
- SkyWalking（APM，可選）
- 簡易 Docker CI/CD 流水線骨架

本 demo 提供：

1. **Pi Skill**：`.pi/skills/platform-bootstrap/SKILL.md`  
   → 真實 Pi 會讀這份說明來做事
2. **生成器**：`scripts/bootstrap-platform.sh`  
   → 模擬「Pi 執行 bash 後會產出什麼」
3. **產出物**：`platform/` 下一整套可 `docker compose up` 的骨架

你不需要先裝好 Pi API，也能跑完這套 demo，理解「Pi 到底幹嘛」。

---

## 快速體驗（不裝 Pi）

```bash
cd pi-platform-demo
./scripts/bootstrap-platform.sh
cd platform
docker compose config   # 驗證 compose 語法
# 若要真的拉起來（會佔資源）：
# docker compose up -d
# docker compose up -d nine_router   # LLM 網關
```

生成後目錄大致是：

```
platform/
  docker-compose.yml
  nginx/
  prometheus/
  grafana/
  loki/
  promtail/
  clients/             # Pi / OpenCode 接線範本
  skywalking/          # profile=apm 才啟用
  ci/                  # 簡易 CI 腳本骨架
  INVENTORY.md         # 這臺 VPS 上「裝了什麼」
```

自訂域名 / 開關模組：

```bash
DOMAIN=api.example.com ENABLE_APM=1 ENABLE_LLM_GATEWAY=1 NINE_ROUTER_BIND=127.0.0.1 ./scripts/bootstrap-platform.sh
```

關掉 LLM 網關：`ENABLE_LLM_GATEWAY=0`。

### 接上 Pi（示例）

1. 啟動 `nine_router`，在 dashboard 複製 gateway API key  
2. 把 `platform/clients/pi-models.json.example` 合併進 `~/.pi/agent/models.json`  
3. 把 `NINE_ROUTER_API_KEY` 換成真實 key，Pi 內 `/model` 選 `nine/...`

### 接上 OpenCode CLI（示例）

見 `platform/clients/opencode.jsonc.example`。可選社群 plugin：`opencode-9router-plugin` 做動態模型列表。

---

## 若你真的用 Pi 來做（同一套 Skill）

```bash
# 1. 安裝 Pi
npm install -g @mariozechner/pi-coding-agent

# 2. 進入本專案（Skill 已放在 .pi/skills/）
cd pi-platform-demo
pi

# 3. 對 Pi 說（自然語言即可）
# 「讀 platform-bootstrap skill，幫我在這臺 VPS 生成基礎平臺，
#   要 nginx、prometheus、grafana、loki、9router，域名用 apps.local」
```

Pi 會：讀 Skill → 探測磁碟/埠/Docker → 寫 compose 與設定 →（經你同意後）執行 `docker compose up`。

---

## 建議的真實用法（不要當萬能藥）

1. **Skill 當契約**：把「允許裝什麼、預設埠、不能亂刪資料」寫死在 Skill
2. **產出要進 Git**：`platform/` 當 IaC 倉庫，不要只留在對話裡
3. **分階段**：先監控+日誌+LLM 網關，再 APM，再 CI；別一次全上
4. **人審核**：compose、Nginx、防火牆規則一定要看過再 `up`
5. **Pi 負責變更，狀態靠系統**：Prometheus/Grafana/Loki/9router 自己持久化；Pi 不管長期運維狀態
6. **LLM key 不進 Git**：上游 key 只放 9router dashboard / volume；客戶端用環境變數

---

## 結論

你的想像很接近 Pi 的強項：**把重複的基建搭建，變成可複用的 Skill + 對話驅動執行**。

但它不是：

- 託管平臺
- 保證正確的 SRE 替代品
- 不需要你懂 Docker/監控的魔法箱

它是：**你的基礎平臺「生成與演進」助手**——食譜越完整，越像萬能藥；食譜越空，越像會幻覺的腳本生成器。
