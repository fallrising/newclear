# 模擬：你對 Pi 說什麼 → 它做什麼

這不是真實 LLM 對話記錄，是「用本 demo 的 Skill 時」典型對話流程。

---

**你：** 我這臺 VPS 上有好幾個業務系統，想先長出基礎平臺：Nginx、Prometheus、Grafana、日誌，之後再加 SkyWalking 和 Docker CI。

**Pi：**（讀 `platform-bootstrap` skill → 探測主機 → 跑生成器）

```text
probe: docker 29.x ok, disk 28G free, ports 80/3000/9090/20128 free
generated: platform/docker-compose.yml + nginx/prometheus/grafana/loki/promtail/ci + nine_router
clients: platform/clients/ (Pi + OpenCode templates)
inventory: see platform/INVENTORY.md
未執行 docker compose up —— 等你確認
```

**你：** 域名用 `apps.local`，先不要 APM。確認可以 up。

**Pi：**

```bash
DOMAIN=apps.local ENABLE_APM=0 ENABLE_LLM_GATEWAY=1 ./scripts/bootstrap-platform.sh
cd platform && docker compose up -d
```

**你：** 幫我把 9router 拉起來並產出 Pi 的 models.json。

**Pi：**

1. `docker compose up -d nine_router`
2. 提醒你開 `http://127.0.0.1:20128/dashboard` 接上游、複製 gateway key  
3. 依 `clients/pi-models.json.example` 寫入 / 合併 `~/.pi/agent/models.json`  
4. **不**把 API key 寫進 Git

**你：** 讓 OpenCode 也走這臺網關。

**Pi：** 指向 `clients/opencode.jsonc.example`，說明 OpenCode CLI（客戶端）≠ OpenCode Free（9router 上游）。

**你：** 我有個業務容器叫 `billing`，監聽 8080，掛到 `/billing/`，並納入監控。

**Pi：**（改 Nginx + Prometheus，不重建整個平臺）

1. 確認 `billing` 在 `platform_edge` 網路  
2. 寫 `nginx/conf.d/billing.conf`  
3. 在 `prometheus.yml` 加 scrape job  
4. `nginx -s reload` + Prometheus reload

---

重點：Pi 的價值不是「內建 Nginx/Prometheus/9router」，而是：

> 把你重複的基建決策收成 Skill，之後用對話驅動變更，且產出物留在 Git 裡。
