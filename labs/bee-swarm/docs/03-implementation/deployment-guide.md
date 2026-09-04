# 🚀 Bee Swarm 部署指南

## 📋 文檔信息
- **目標讀者**：DevOps 工程師、系統管理員、開發者
- **前置知識**：Docker、Linux 基礎、GitHub Actions
- **部署時間**：30-60分鐘
- **最後更新**：2025年7月

## 🎯 部署概述

Bee Swarm 採用簡化的 GitHub-Centric 架構，專門針對普通 VPS 環境優化，遵循項目的核心約束條件，提供穩定可靠的部署方案。

### 部署特點
- ✅ **約束友好**：完全符合 VPS + Cloudflare Tunnel 約束
- ✅ **簡化優先**：避免複雜的微服務和 Kubernetes
- ✅ **成本可控**：月度成本 < $50（基礎設施）+ $30（AI工具）
- ✅ **自動化程度高**：基於 GitHub Actions 的 CI/CD

## 🔧 系統要求

### 硬件要求

#### 最小配置（測試環境）
```yaml
hardware_minimum:
  cpu: "1 vCore"
  memory: "2GB RAM"
  storage: "20GB SSD"
  network: "1Mbps 穩定連接"
  cost: "~$10-15/month"
```

#### 推薦配置（生產環境）
```yaml
hardware_recommended:
  cpu: "2 vCore"
  memory: "4GB RAM"
  storage: "40GB SSD"
  network: "10Mbps 穩定連接"
  cost: "~$20-30/month"
  
performance_targets:
  concurrent_users: "10-50"
  response_time: "< 3 seconds"
  uptime: "> 95%"
  api_calls_daily: "1000-5000"
```

#### 高負載配置（擴展環境）
```yaml
hardware_scaled:
  cpu: "4 vCore"
  memory: "8GB RAM"
  storage: "80GB SSD"
  network: "100Mbps"
  cost: "~$40-50/month"
```

### 軟件要求
```yaml
required_software:
  os: "Ubuntu 20.04+ / CentOS 8+ / Debian 11+"
  docker: "20.10+"
  docker_compose: "2.0+"
  git: "2.25+"
  
optional_tools:
  nginx: "1.18+ (if not using container)"
  certbot: "latest (for SSL)"
  fail2ban: "0.11+ (security)"
```

## 🛠️ 部署步驟

### 第一階段：環境準備

#### 1. 系統初始化
```bash
#!/bin/bash
# scripts/setup_vps.sh

# 更新系統
sudo apt update && sudo apt upgrade -y

# 安裝必需軟件
sudo apt install -y \
    curl \
    wget \
    git \
    htop \
    unzip \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

# 安裝 Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 安裝 Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 將當前用戶加入 docker 組
sudo usermod -aG docker $USER

# 啟用 Docker 服務
sudo systemctl enable docker
sudo systemctl start docker

echo "✅ VPS 環境準備完成，請重新登錄以應用 Docker 權限"
```

#### 2. 防火牆配置
```bash
# 配置 UFW 防火牆（符合安全最佳實踐）
sudo ufw --force enable
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 允許 SSH（請根據實際端口調整）
sudo ufw allow 22/tcp

# 允許 HTTP/HTTPS（如果需要直接訪問）
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 如果使用 Cloudflare Tunnel，只允許 Cloudflare IP
# sudo ufw allow from 103.21.244.0/22
# sudo ufw allow from 103.22.200.0/22
# sudo ufw allow from 103.31.4.0/22
# 更多 Cloudflare IP 範圍請查看官方文檔

sudo ufw status verbose
```

### 第二階段：項目部署

#### 1. 克隆和配置
```bash
# 克隆項目
git clone https://github.com/your-org/bee_swarm.git
cd bee_swarm

# 創建必要目錄
mkdir -p {data,logs,backups,secrets}

# 設置權限
chmod 755 data logs backups
chmod 700 secrets

# 複製配置模板
cp .env.template .env
```

#### 2. 環境配置
```bash
# 編輯環境變量
nano .env

# 基本配置檢查清單：
# ✅ GITHUB_TOKEN - GitHub Personal Access Token
# ✅ GITHUB_OWNER - GitHub 用戶名/組織
# ✅ GITHUB_REPO - 倉庫名稱
# ✅ CLAUDE_API_KEY - Claude API 密鑰（產品經理使用）
# ✅ GEMINI_API_KEY - Gemini API 密鑰（其他角色使用）
# ✅ VPS_HOST - VPS IP 地址
# ✅ CLOUDFLARE_TUNNEL_TOKEN - Cloudflare Tunnel 令牌（可選）
```

#### 3. 配置驗證
```bash
# 執行配置驗證
python3 scripts/validate_config.py

# 預期輸出：
# ✅ All configurations are valid!
# 或者
# ✅ Configuration is valid (with warnings)

# 如果有錯誤，請根據提示修正配置
```

### 第三階段：服務啟動

#### 1. 建構和啟動服務
```bash
# 建構 Docker 鏡像
docker-compose build --no-cache

# 啟動服務（後台模式）
docker-compose up -d

# 檢查服務狀態
docker-compose ps

# 預期輸出：
# NAME              IMAGE          COMMAND                  SERVICE    CREATED         STATUS                   PORTS
# bee_swarm-backend-1    bee_swarm_backend    "npm start"             backend    2 minutes ago   Up 2 minutes (healthy)   0.0.0.0:8000->8000/tcp
# bee_swarm-redis-1      redis:7-alpine       "docker-entrypoint.s…"   redis      2 minutes ago   Up 2 minutes             6379/tcp
# bee_swarm-nginx-1      nginx:alpine         "/docker-entrypoint.…"   nginx      2 minutes ago   Up 2 minutes             0.0.0.0:80->80/tcp
```

#### 2. 健康檢查
```bash
# 檢查應用健康狀態
curl -f http://localhost:8000/health

# 預期響應：
# {"status":"ok","timestamp":"2025-01-XX","version":"2.0.0"}

# 檢查 GitHub API 連接
curl -f http://localhost:8000/api/github/status

# 檢查 AI 工具連接
curl -f http://localhost:8000/api/ai/status
```

## 🌐 網絡配置

### Cloudflare Tunnel 設置（推薦）

#### 1. 安裝 Cloudflared
```bash
# 下載 cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# 登錄 Cloudflare
cloudflared tunnel login

# 創建 tunnel
cloudflared tunnel create bee-swarm

# 配置 tunnel
cat > /home/$USER/.cloudflared/config.yml << EOF
tunnel: bee-swarm
credentials-file: /home/$USER/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-domain.example.com
    service: http://localhost:80
  - service: http_status:404
EOF

# 配置 DNS
cloudflared tunnel route dns bee-swarm your-domain.example.com

# 啟動 tunnel
cloudflared tunnel run bee-swarm
```

#### 2. Systemd 服務配置
```bash
# 創建 systemd 服務
sudo tee /etc/systemd/system/cloudflared.service > /dev/null << EOF
[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
Type=simple
User=$USER
ExecStart=/usr/local/bin/cloudflared tunnel run bee-swarm
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

# 啟用和啟動服務
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

### 傳統反向代理（備選方案）

#### Nginx 配置
```nginx
# /etc/nginx/sites-available/bee-swarm
server {
    listen 80;
    server_name your-domain.example.com;
    
    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.example.com;
    
    # SSL 配置
    ssl_certificate /etc/letsencrypt/live/your-domain.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # 安全頭部
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
    
    # 代理到後端
    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # 靜態文件（如果有）
    location /static/ {
        alias /app/static/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # 健康檢查端點
    location /health {
        access_log off;
        proxy_pass http://localhost:8000/health;
    }
}
```

## 🔄 CI/CD 自動化

### GitHub Actions 部署工作流
```yaml
# .github/workflows/deploy.yml
name: Deploy to VPS

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        
      - name: Setup SSH
        uses: webfactory/ssh-agent@v0.7.0
        with:
          ssh-private-key: ${{ secrets.VPS_SSH_KEY }}
          
      - name: Deploy to VPS
        run: |
          ssh -o StrictHostKeyChecking=no ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} << 'EOF'
            cd /opt/bee_swarm
            
            # 備份當前版本
            docker-compose down
            git stash
            
            # 拉取最新代碼
            git pull origin main
            
            # 檢查配置
            python3 scripts/validate_config.py
            
            # 重新建構和部署
            docker-compose build --no-cache
            docker-compose up -d
            
            # 健康檢查
            sleep 30
            curl -f http://localhost:8000/health || exit 1
            
            echo "✅ Deployment successful"
          EOF
          
      - name: Notify Deployment Status
        if: always()
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

### 自動化監控和告警
```yaml
# .github/workflows/monitoring.yml
name: Production Monitoring

on:
  schedule:
    - cron: '*/15 * * * *'  # 每15分鐘檢查
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    
    steps:
      - name: Health Check
        run: |
          # 檢查服務健康狀態
          response=$(curl -s -o /dev/null -w "%{http_code}" https://your-domain.example.com/health)
          
          if [ $response -ne 200 ]; then
            echo "❌ Health check failed: HTTP $response"
            exit 1
          fi
          
          echo "✅ Health check passed"
          
      - name: Performance Check
        run: |
          # 檢查響應時間
          response_time=$(curl -o /dev/null -s -w '%{time_total}' https://your-domain.example.com/health)
          
          # 如果響應時間超過5秒，發出警告
          if (( $(echo "$response_time > 5" | bc -l) )); then
            echo "⚠️ Slow response time: ${response_time}s"
          else
            echo "✅ Response time OK: ${response_time}s"
          fi
          
      - name: Resource Usage Check
        run: |
          # 通過 SSH 檢查 VPS 資源使用
          ssh ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} << 'EOF'
            # 檢查磁盤使用
            DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
            if [ $DISK_USAGE -gt 85 ]; then
              echo "⚠️ High disk usage: $DISK_USAGE%"
            fi
            
            # 檢查內存使用
            MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100.0}')
            if [ $MEMORY_USAGE -gt 90 ]; then
              echo "⚠️ High memory usage: $MEMORY_USAGE%"
            fi
            
            # 檢查 Docker 容器狀態
            docker-compose ps
          EOF
          
      - name: Create Issue on Failure
        if: failure()
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 Production Alert: System Health Check Failed',
              body: `
                ## Alert Details
                
                - **Time**: ${new Date().toISOString()}
                - **Workflow**: ${{ github.workflow }}
                - **Run ID**: ${{ github.run_id }}
                
                ## Recommended Actions
                
                1. Check VPS resource usage
                2. Review application logs
                3. Verify all services are running
                4. Check external dependencies (GitHub API, AI services)
                
                ## Monitoring Links
                
                - [GitHub Actions](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})
                - [Application Health](https://your-domain.example.com/health)
              `,
              labels: ['alert', 'production', 'urgent']
            })
```

## 📊 監控和維護

### 系統監控腳本
```bash
#!/bin/bash
# scripts/system_monitor.sh

echo "🔍 Bee Swarm System Monitor"
echo "=========================="

# 檢查 Docker 服務
echo "📦 Docker Services:"
docker-compose ps

echo ""
echo "💾 System Resources:"
echo "CPU Usage: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | awk -F'%' '{print $1}')%"
echo "Memory Usage: $(free | grep Mem | awk '{printf "%.1f%%", $3/$2 * 100.0}')"
echo "Disk Usage: $(df -h / | awk 'NR==2 {print $5}')"

echo ""
echo "🌐 Network Connectivity:"
curl -s -o /dev/null -w "GitHub API: %{http_code} (%{time_total}s)\n" https://api.github.com/
curl -s -o /dev/null -w "Local Health: %{http_code} (%{time_total}s)\n" http://localhost:8000/health

echo ""
echo "📈 Application Metrics:"
if curl -s http://localhost:8000/api/metrics > /dev/null; then
    curl -s http://localhost:8000/api/metrics | jq '.'
else
    echo "❌ Metrics endpoint unavailable"
fi

echo ""
echo "📝 Recent Logs (last 10 lines):"
docker-compose logs --tail=10
```

### 備份策略
```bash
#!/bin/bash
# scripts/backup.sh

BACKUP_DIR="/opt/backups/bee_swarm"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="bee_swarm_backup_$DATE.tar.gz"

echo "🗄️ Starting Bee Swarm backup..."

# 創建備份目錄
mkdir -p $BACKUP_DIR

# 停止服務（可選，取決於數據一致性要求）
# docker-compose stop

# 創建備份
tar -czf $BACKUP_DIR/$BACKUP_FILE \
    --exclude='node_modules' \
    --exclude='logs/*.log' \
    --exclude='.git' \
    /opt/bee_swarm

# 重啟服務（如果之前停止了）
# docker-compose start

# 清理舊備份（保留最近7天）
find $BACKUP_DIR -name "bee_swarm_backup_*.tar.gz" -mtime +7 -delete

echo "✅ Backup completed: $BACKUP_DIR/$BACKUP_FILE"

# 可選：上傳到雲存儲
# rclone copy $BACKUP_DIR/$BACKUP_FILE remote:backups/
```

## 🔧 故障排除

### 常見問題和解決方案

#### 1. 容器啟動失敗
```bash
# 診斷步驟
echo "🔍 Diagnosing container startup issues..."

# 檢查 Docker 狀態
sudo systemctl status docker

# 檢查磁盤空間
df -h

# 檢查容器日誌
docker-compose logs

# 檢查配置文件
python3 scripts/validate_config.py

# 嘗試重新建構
docker-compose down
docker system prune -f
docker-compose build --no-cache
docker-compose up -d
```

#### 2. GitHub API 連接問題
```bash
# 檢查 GitHub Token
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user

# 檢查 API 限制
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit

# 檢查網絡連接
ping github.com
nslookup api.github.com
```

#### 3. AI 工具連接問題
```bash
# 測試 Claude API
curl -X POST https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CLAUDE_API_KEY" \
  -d '{"model":"claude-3-sonnet-20240229","messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'

# 測試 Gemini API
curl -X POST "https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

#### 4. 性能問題
```bash
# 檢查資源使用
htop
iotop
nethogs

# 檢查 Docker 統計
docker stats

# 分析日誌
tail -f logs/application.log | grep ERROR
tail -f logs/application.log | grep SLOW

# 檢查數據庫性能（如果使用 PostgreSQL）
# docker-compose exec postgres psql -U postgres -c "SELECT * FROM pg_stat_activity;"
```

### 故障恢復程序

#### 快速恢復步驟
```bash
#!/bin/bash
# scripts/emergency_recovery.sh

echo "🚨 Starting emergency recovery procedure..."

# 1. 停止所有服務
docker-compose down

# 2. 檢查系統資源
echo "📊 System Resources:"
df -h
free -h

# 3. 清理 Docker 資源
docker system prune -f
docker volume prune -f

# 4. 從備份恢復（如果需要）
if [ -n "$1" ]; then
    echo "📦 Restoring from backup: $1"
    tar -xzf $1 -C /tmp/
    cp -r /tmp/opt/bee_swarm/* ./
fi

# 5. 重新部署
echo "🚀 Redeploying services..."
docker-compose build --no-cache
docker-compose up -d

# 6. 健康檢查
sleep 30
curl -f http://localhost:8000/health

echo "✅ Emergency recovery completed"
```

## 🔐 安全強化

### SSL/TLS 配置
```bash
# 使用 Let's Encrypt 獲取免費 SSL 證書
sudo apt install certbot python3-certbot-nginx

# 獲取證書
sudo certbot --nginx -d your-domain.example.com

# 設置自動續期
sudo crontab -e
# 添加以下行：
# 0 12 * * * /usr/bin/certbot renew --quiet
```

### 入侵檢測
```bash
# 安裝 fail2ban
sudo apt install fail2ban

# 配置 fail2ban
sudo tee /etc/fail2ban/jail.local > /dev/null << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log

[nginx-http-auth]
enabled = true
filter = nginx-http-auth
logpath = /var/log/nginx/error.log

[nginx-noscript]
enabled = true
port = http,https
filter = nginx-noscript
logpath = /var/log/nginx/access.log
EOF

sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

---

## 📋 部署檢查清單

### 部署前準備
- [ ] VPS 符合最低硬件要求
- [ ] 已安裝 Docker 和 Docker Compose
- [ ] 已配置防火牆和安全設置
- [ ] 已獲取所有必需的 API 密鑰
- [ ] 已設置 GitHub Secrets
- [ ] 已配置域名和 DNS（如果使用）

### 部署執行
- [ ] 成功克隆代碼倉庫
- [ ] 環境變量配置完成且通過驗證
- [ ] Docker 容器成功啟動
- [ ] 健康檢查通過
- [ ] 網絡配置正確（Cloudflare Tunnel 或反向代理）
- [ ] SSL 證書配置（如果使用 HTTPS）

### 部署後驗證
- [ ] 應用可以通過公網訪問
- [ ] GitHub API 連接正常
- [ ] AI 工具連接正常
- [ ] 監控和告警配置完成
- [ ] 備份策略實施
- [ ] 文檔和運維手冊更新

### 持續維護
- [ ] 定期執行健康檢查
- [ ] 監控系統資源使用
- [ ] 定期備份重要數據
- [ ] 更新和安全補丁管理
- [ ] 性能優化和調整

---

*本部署指南確保 Bee Swarm 系統能夠在約束條件下穩定運行，提供可靠的生產環境支持。* 