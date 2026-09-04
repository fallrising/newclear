# VNC Lab - noVNC Base

一個基於 Docker 的 VNC 實驗室環境，提供 Web 瀏覽器訪問的遠程桌面功能。

## 功能特點

- **Web 瀏覽器訪問**：通過 noVNC 在瀏覽器中直接訪問 VNC 桌面
- **動態配置**：支持環境變量和命令行參數配置
- **Cloudflare Tunnel 兼容**：完美支持 Cloudflare Tunnel Zero Trust
- **子域名支持**：自動適配任何子域名，無需額外配置
- **容器化部署**：基於 Docker，易於部署和管理
- **密碼認證**：支持VNC密碼輸入界面和URL參數傳遞

## 項目結構

```
novnc_base/
├── Dockerfile                    # 主要容器構建文件
├── README.md                     # 項目文檔
├── index.html                    # 自定義noVNC界面（支持密碼認證）
├── run.sh                        # 容器啟動腳本
├── build.sh                      # 鏡像構建腳本
├── clean.sh                      # 清理腳本
├── export.sh                     # 鏡像導出腳本
├── import.sh                     # 鏡像導入腳本
├── push.sh                       # 鏡像推送腳本
├── docker-compose.cloudflare.yml # Cloudflare Tunnel 部署配置
└── CLOUDFLARE-TUNNEL-GUIDE.md    # Cloudflare Tunnel 部署指南
```

### 核心文件說明

#### 主要文件
- **`Dockerfile`**: 定義容器環境，包含 noVNC、x11vnc、Firefox 等組件
- **`index.html`**: 自定義noVNC界面，支持密碼輸入和URL參數認證
- **`run.sh`**: 智能啟動腳本，支持動態配置和 Cloudflare Tunnel 模式
- **`build.sh`**: 標準化構建腳本，確保一致的鏡像構建

#### 部署文件
- **`docker-compose.cloudflare.yml`**: Cloudflare Tunnel 專用部署配置
- **`CLOUDFLARE-TUNNEL-GUIDE.md`**: 詳細的 Cloudflare Tunnel 設置指南

## 快速開始

### 基本使用

```bash
# 構建鏡像
./build.sh

# 啟動容器（localhost 模式）
./run.sh

# 啟動容器（Cloudflare Tunnel 模式）
./run.sh -H 0.0.0.0 -d
```

### VNC 密碼認證

容器支持多種密碼認證方式：

```bash
# 1. 通過瀏覽器界面輸入密碼
# 訪問 http://localhost:6080 並在彈窗中輸入密碼

# 2. 通過URL參數傳遞密碼
# 訪問 http://localhost:6080?password=your_password

# 3. 設置環境變量（如果支持）
VNC_PASSWORD=your_password ./run.sh
```

### 動態配置

支持多種配置方式：

```bash
# 命令行參數
./run.sh -H 0.0.0.0 -p 8080 -d

# 環境變量
VNC_HOST=0.0.0.0 VNC_PORT=8080 ./run.sh -d

# 環境文件
./run.sh -e .env -d
```

### Cloudflare Tunnel 部署

```bash
# 構建並啟動（支持 Cloudflare Tunnel）
./build.sh
./run.sh -H 0.0.0.0 -d

# 查看部署指南
cat CLOUDFLARE-TUNNEL-GUIDE.md
```

## 配置選項

### 環境變量

| 變量名 | 默認值 | 說明 |
|--------|--------|------|
| `VNC_HOST` | `0.0.0.0` | VNC 服務綁定地址 |
| `VNC_PORT` | `6080` | VNC Web 端口 |
| `VNC_BACKEND_HOST` | `localhost` | VNC 後端主機 |
| `VNC_BACKEND_PORT` | `5900` | VNC 後端端口 |
| `CLOUDFLARE_TUNNEL` | `0` | Cloudflare Tunnel 模式標識 |

### 命令行選項

```bash
./run.sh [選項]

選項:
  -H, --host HOST        VNC 主機地址 (默認: 0.0.0.0)
  -p, --port PORT        VNC 端口 (默認: 6080)
  -d, --detach           後台運行
  -v, --volume PATH      掛載卷
  -e, --env-file FILE    環境變量文件
  -m, --memory SIZE      內存限制
  -c, --cpus COUNT       CPU 限制
  -h, --help             顯示幫助
```

## 安全考慮

### HTTP vs HTTPS

1. **本地開發**: 使用 HTTP，適合開發和測試
2. **Cloudflare Tunnel**: 
   - 用戶 ↔ Cloudflare: HTTPS (由 Cloudflare 處理)
   - Cloudflare ↔ 容器: HTTP (內部通信)
   - 整體安全性由 Cloudflare Zero Trust 保障

### 安全最佳實踐

1. **網絡隔離**: 容器僅在內部網絡運行
2. **Cloudflare 保護**: 利用 Cloudflare 的 DDoS 防護和 WAF
3. **訪問控制**: 通過 Cloudflare Zero Trust 控制訪問
4. **密碼認證**: 使用VNC密碼保護桌面訪問
5. **定期更新**: 保持容器鏡像和依賴更新

## 故障排除

### 常見問題

1. **端口衝突**: 檢查端口是否被佔用
2. **密碼認證失敗**: 確保使用正確的VNC密碼
3. **Cloudflare 連接**: 檢查Tunnel配置和路由設置

### 日誌查看

```bash
# 查看容器日誌
docker logs vnc-base

# 查看特定服務日誌
docker exec vnc-base cat /var/log/novnc.log
docker exec vnc-base cat /var/log/x11vnc.log
```

## 開發指南

### 添加新功能

1. 修改 `Dockerfile` 添加依賴
2. 更新 `run.sh` 添加配置選項
3. 更新文檔

### 測試流程

```bash
# 1. 構建測試
./build.sh

# 2. 本地測試
./run.sh -d

# 3. 測試密碼認證
# 訪問 http://localhost:6080 並輸入密碼

# 4. 測試URL參數
# 訪問 http://localhost:6080?password=test_password
```

## 許可證

MIT License

## 貢獻

歡迎提交 Issue 和 Pull Request！ 