# 🔧 Bee Swarm 配置指南

## 📋 文檔信息
- **目標讀者**：技術人員、系統管理員
- **前置知識**：基本 Docker、GitHub、環境變量概念
- **完成時間**：30-60分鐘
- **最後更新**：2025年7月

## 🎯 配置概述

本指南提供 Bee Swarm 系統的完整配置說明，涵蓋環境變量、AI 角色配置、GitHub 集成、監控設置和安全配置等方面。所有配置都基於 Bee Swarm 的核心約束設計。

## 📋 環境變量配置

### 系統基礎配置
```bash
# .env 基礎配置
# ===== 系統基礎設置 =====
ENVIRONMENT=production          # development, staging, production
LOG_LEVEL=info                 # debug, info, warning, error
DEBUG=false                    # 是否啟用調試模式
TIMEZONE=Asia/Shanghai         # 系統時區

# ===== 應用基本信息 =====
APP_NAME=bee-swarm
APP_VERSION=2.0.0
API_PREFIX=/api/v1
```

### GitHub 集成配置（核心）
```bash
# ===== GitHub 基本配置 =====
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx  # GitHub Personal Access Token
GITHUB_OWNER=your-organization         # GitHub 組織或用戶名
GITHUB_REPO=your-repository           # 預設倉庫名

# ===== GitHub API 配置 =====
GITHUB_API_URL=https://api.github.com
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_APP_ID=123456                  # 如果使用 GitHub App（可選）

# ===== GitHub Actions 配置 =====
ENABLE_GITHUB_ACTIONS=true
ACTIONS_WORKFLOW_PATH=.github/workflows
GITHUB_API_RATE_LIMIT=4500            # 預留餘量，避免超限
```

### AI 工具配置（符合約束）
```bash
# ===== Claude 配置（僅產品經理使用）=====
CLAUDE_API_KEY=sk-ant-xxxxxxxxxxxxx
CLAUDE_MODEL=claude-3-sonnet-20240229
CLAUDE_MAX_TOKENS=4000
CLAUDE_TEMPERATURE=0.3

# ===== Gemini 配置（其他角色使用）=====
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-1.5-flash-latest   # 使用免費額度
GEMINI_MAX_TOKENS=2000
GEMINI_TEMPERATURE=0.2

# ===== 工具使用限制 =====
AI_TOOL_RATE_LIMIT=true               # 啟用速率限制
TOOL_USAGE_TRACKING=true              # 追蹤使用量
COST_OPTIMIZATION=true                # 成本優化模式
```

## 🤖 AI 角色配置

### 產品經理配置（Claude Code）
```yaml
# roles/product_manager/config.yml
role_config:
  name: "Product Manager"
  description: "負責產品策略和需求管理"
  
  # AI 工具設置（符合約束）
  ai_settings:
    provider: "claude"
    model: "claude-3-sonnet-20240229"
    temperature: 0.3
    max_tokens: 4000
    system_prompt: |
      你是一個經驗豐富的產品經理，專注於：
      - 需求分析和功能規劃
      - 用戶故事編寫和史詩分解
      - 優先級管理和資源協調
      - 與技術團隊的溝通橋樑
      
      請始終考慮技術約束和資源限制，提供實用的產品決策。
  
  # 核心能力定義
  capabilities:
    - requirement_analysis      # 需求分析
    - epic_breakdown           # 史詩分解
    - priority_management      # 優先級管理
    - stakeholder_communication # 利益相關者溝通
    - roadmap_planning         # 路線圖規劃
  
  # 可用工具（GitHub-Centric）
  tools:
    - github_issues           # GitHub Issues 管理
    - github_projects         # 項目看板
    - github_wiki            # 文檔編寫
    - analytics_dashboard     # 分析儀表板
  
  # 工作流程配置
  workflow:
    response_time: 30         # 響應時間（分鐘）
    review_frequency: daily   # 審查頻率
    escalation_threshold: high # 升級閾值
    
  # 成本控制
  cost_limits:
    monthly_api_calls: 10000  # 月度 API 調用限制
    token_budget: 1000000     # 月度 token 預算
```

### 後端開發者配置（Gemini CLI）
```yaml
# roles/backend_developer/config.yml
role_config:
  name: "Backend Developer"
  description: "負責服務端開發和架構設計"
  
  # AI 工具設置（免費額度）
  ai_settings:
    provider: "gemini"
    model: "gemini-1.5-flash-latest"
    temperature: 0.2
    max_tokens: 2000
    system_prompt: |
      你是一個資深的後端開發工程師，專精於：
      - RESTful API 設計和實現
      - 資料庫設計和優化
      - 微服務架構（在約束範圍內）
      - 性能優化和安全實踐
      
      請在普通 VPS 的資源約束下提供技術方案。
  
  # 技術棧（符合約束）
  technical_stack:
    languages: [python, javascript, go]
    frameworks: [fastapi, express, gin]
    databases: [sqlite, postgresql, redis]  # 輕量級優先
    tools: [docker, nginx, sqlite]
  
  # 編碼標準
  code_standards:
    style_guide: "pep8 / airbnb"
    test_coverage: 80
    documentation: required
    security_scan: enabled
    
  # 成本控制（免費額度）
  cost_limits:
    monthly_api_calls: 50000   # Gemini 免費額度
    batch_processing: true     # 批量處理優化
    caching_enabled: true      # 啟用緩存
```

### 前端開發者配置（Gemini CLI）
```yaml
# roles/frontend_developer/config.yml
role_config:
  name: "Frontend Developer"
  description: "負責用戶界面和前端功能開發"
  
  # AI 工具設置
  ai_settings:
    provider: "gemini"
    model: "gemini-1.5-flash-latest"
    temperature: 0.2
    max_tokens: 2000
    
  # 技術棧（輕量化）
  technical_stack:
    frameworks: [react, vue, vanilla-js]
    styling: [tailwindcss, css-modules]
    build_tools: [vite, webpack]
    testing: [jest, cypress]
    
  # UI/UX 標準
  ui_standards:
    responsive_design: required
    accessibility: wcag_aa
    performance_budget: "< 3s load time"
    bundle_size: "< 1MB"
    
  # 部署配置（符合約束）
  deployment:
    static_hosting: cloudflare_pages
    cdn_optimization: true
    compression: gzip
```

### DevOps 工程師配置（Gemini CLI）
```yaml
# roles/devops_engineer/config.yml
role_config:
  name: "DevOps Engineer"
  description: "負責部署、監控和運維自動化"
  
  # AI 工具設置
  ai_settings:
    provider: "gemini"
    model: "gemini-1.5-flash-latest"
    temperature: 0.1  # 更保守的設置
    max_tokens: 2000
    
  # 基礎設施配置（符合約束）
  infrastructure:
    platform: "普通 VPS"
    containerization: docker
    orchestration: docker-compose  # 非 k8s
    networking: cloudflare_tunnel
    monitoring: github_actions
    
  # 部署策略
  deployment_strategy:
    type: "rolling_update"
    zero_downtime: false  # VPS 限制
    backup_strategy: git_based
    rollback_time: "< 5 minutes"
    
  # 監控配置（簡化）
  monitoring:
    metrics: basic_system_metrics
    logging: file_based
    alerting: github_notifications
    uptime_target: 95  # 現實目標
```

## 📊 監控配置（輕量化）

### GitHub Actions 監控
```yaml
# .github/workflows/monitoring.yml
name: System Monitoring
on:
  schedule:
    - cron: '0 */6 * * *'  # 每6小時檢查
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: System Health Check
        run: |
          # 檢查服務狀態
          curl -f ${{ secrets.APP_URL }}/health || exit 1
          
      - name: Resource Usage Check
        run: |
          # 檢查資源使用（通過 API）
          USAGE=$(curl -s ${{ secrets.APP_URL }}/api/metrics)
          echo "Current usage: $USAGE"
          
      - name: GitHub API Quota Check
        run: |
          # 檢查 GitHub API 配額
          QUOTA=$(curl -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
                  https://api.github.com/rate_limit)
          echo "API quota: $QUOTA"
```

### 基礎告警配置
```yaml
# config/alerts.yml（簡化版）
alerts:
  system_down:
    condition: "health_check_failed"
    notification: github_issue
    severity: critical
    
  high_resource_usage:
    condition: "cpu > 85% OR memory > 90%"
    notification: github_comment
    severity: warning
    
  api_quota_low:
    condition: "github_api_remaining < 1000"
    notification: github_issue
    severity: warning
    
  deployment_failed:
    condition: "deployment_status = failed"
    notification: github_issue
    severity: high
```

## 🔒 安全配置

### GitHub Secrets 管理
```bash
# 必需的 GitHub Secrets
CLAUDE_API_KEY              # Claude API 密鑰
GEMINI_API_KEY              # Gemini API 密鑰
VPS_SSH_KEY                 # VPS SSH 私鑰
VPS_HOST                    # VPS 主機地址
VPS_USER                    # VPS 用戶名
CLOUDFLARE_TUNNEL_TOKEN     # Cloudflare Tunnel 令牌
WEBHOOK_SECRET              # Webhook 簽名密鑰
```

### 容器安全配置
```dockerfile
# 安全強化的 Dockerfile 範例
FROM node:18-alpine

# 創建非 root 用戶
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# 設置工作目錄
WORKDIR /app

# 複製依賴檔案
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 複製應用代碼
COPY --chown=nextjs:nodejs . .

# 切換到非 root 用戶
USER nextjs

# 暴露端口
EXPOSE 3000

# 健康檢查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["npm", "start"]
```

### 網絡安全配置
```yaml
# docker-compose.yml 網絡配置
version: '3.8'
services:
  app:
    build: .
    networks:
      - internal
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    
  nginx:
    image: nginx:alpine
    networks:
      - internal
      - external
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    restart: unless-stopped

networks:
  internal:
    driver: bridge
    internal: true  # 內部網絡隔離
  external:
    driver: bridge
```

## 🐳 Docker 配置（輕量化）

### 優化的 Docker Compose
```yaml
# docker-compose.yml
version: '3.8'

services:
  backend:
    build: 
      context: .
      dockerfile: Dockerfile.backend
    environment:
      - ENVIRONMENT=${ENVIRONMENT}
      - DATABASE_URL=sqlite:///app/data/bee_swarm.db
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - redis
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 512M      # VPS 資源限制
          cpus: '0.5'
        reservations:
          memory: 256M
          cpus: '0.25'

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.25'

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./static:/usr/share/nginx/html
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  redis_data:
```

## ⚙️ 高級配置

### 緩存策略配置
```python
# config/cache.py
CACHE_CONFIG = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': 'redis://redis:6379/1',
        'OPTIONS': {
            'CLIENT_CLASS': 'django_redis.client.DefaultClient',
            'SERIALIZER': 'django_redis.serializers.json.JSONSerializer',
        },
        'KEY_PREFIX': 'bee_swarm',
        'TIMEOUT': 300,  # 5分鐘默認過期
        'MAX_ENTRIES': 10000,  # 最大條目數
    },
    'github_api': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': 'redis://redis:6379/2',
        'TIMEOUT': 3600,  # GitHub API 緩存1小時
        'MAX_ENTRIES': 5000,
    },
    'ai_responses': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': 'redis://redis:6379/3',
        'TIMEOUT': 86400,  # AI 響應緩存24小時
        'MAX_ENTRIES': 1000,
    }
}
```

### 任務隊列配置（輕量化）
```python
# config/tasks.py
TASK_CONFIG = {
    'broker_url': 'redis://redis:6379/4',
    'result_backend': 'redis://redis:6379/5',
    'task_serializer': 'json',
    'accept_content': ['json'],
    'result_serializer': 'json',
    'timezone': 'Asia/Shanghai',
    'enable_utc': True,
    
    # 任務路由（簡化版）
    'task_routes': {
        'ai.tasks.*': {'queue': 'ai_tasks'},
        'github.tasks.*': {'queue': 'github_tasks'},
        'monitoring.tasks.*': {'queue': 'monitoring'},
    },
    
    # 資源限制
    'worker_max_tasks_per_child': 1000,
    'worker_max_memory_per_child': 200000,  # 200MB
    'task_time_limit': 300,  # 5分鐘超時
    'task_soft_time_limit': 240,  # 4分鐘軟超時
}
```

## 🔧 配置驗證和最佳實踐

### 配置驗證腳本
```python
#!/usr/bin/env python3
# scripts/validate_config.py

import os
import sys
from typing import List, Dict, Any

class ConfigValidator:
    """配置驗證器"""
    
    REQUIRED_VARS = [
        'GITHUB_TOKEN',
        'GITHUB_OWNER', 
        'GITHUB_REPO',
        'CLAUDE_API_KEY',
        'GEMINI_API_KEY'
    ]
    
    OPTIONAL_VARS = {
        'LOG_LEVEL': 'info',
        'ENVIRONMENT': 'production',
        'DEBUG': 'false'
    }
    
    def __init__(self):
        self.errors = []
        self.warnings = []
    
    def validate(self) -> bool:
        """執行完整配置驗證"""
        self._check_required_vars()
        self._check_github_config()
        self._check_ai_tools_config()
        self._check_resource_limits()
        self._check_security_settings()
        
        return len(self.errors) == 0
    
    def _check_required_vars(self):
        """檢查必需環境變量"""
        missing_vars = []
        for var in self.REQUIRED_VARS:
            if not os.getenv(var):
                missing_vars.append(var)
        
        if missing_vars:
            self.errors.append(f"Missing required environment variables: {missing_vars}")
    
    def _check_github_config(self):
        """驗證 GitHub 配置"""
        token = os.getenv('GITHUB_TOKEN')
        if token and not token.startswith('ghp_'):
            self.warnings.append("GitHub token format may be incorrect")
        
        # 檢查 API 限制設置
        rate_limit = os.getenv('GITHUB_API_RATE_LIMIT', '5000')
        if int(rate_limit) > 4500:
            self.warnings.append("GitHub API rate limit should be < 4500 for safety")
    
    def _check_ai_tools_config(self):
        """驗證 AI 工具配置"""
        claude_key = os.getenv('CLAUDE_API_KEY')
        if claude_key and not claude_key.startswith('sk-ant-'):
            self.errors.append("Invalid Claude API key format")
        
        gemini_key = os.getenv('GEMINI_API_KEY')
        if not gemini_key:
            self.errors.append("Gemini API key is required for most roles")
    
    def _check_resource_limits(self):
        """檢查資源限制設置"""
        # 檢查內存限制
        if os.getenv('DOCKER_MEMORY_LIMIT'):
            memory_limit = os.getenv('DOCKER_MEMORY_LIMIT')
            if 'G' in memory_limit and int(memory_limit.replace('G', '')) > 2:
                self.warnings.append("Memory limit > 2GB may exceed VPS capacity")
    
    def _check_security_settings(self):
        """檢查安全設置"""
        if os.getenv('DEBUG', 'false').lower() == 'true':
            env = os.getenv('ENVIRONMENT', 'development')
            if env == 'production':
                self.errors.append("DEBUG should not be enabled in production")
    
    def report(self):
        """生成驗證報告"""
        print("=== Bee Swarm Configuration Validation ===\n")
        
        if self.errors:
            print("❌ ERRORS:")
            for error in self.errors:
                print(f"  - {error}")
            print()
        
        if self.warnings:
            print("⚠️  WARNINGS:")
            for warning in self.warnings:
                print(f"  - {warning}")
            print()
        
        if not self.errors and not self.warnings:
            print("✅ All configurations are valid!")
        elif not self.errors:
            print("✅ Configuration is valid (with warnings)")
        else:
            print("❌ Configuration validation failed")
        
        return len(self.errors) == 0

if __name__ == "__main__":
    validator = ConfigValidator()
    is_valid = validator.validate()
    validator.report()
    
    sys.exit(0 if is_valid else 1)
```

### 配置模板生成器
```bash
#!/bin/bash
# scripts/generate_config.sh

# 生成配置模板
generate_env_template() {
    cat > .env.template << 'EOF'
# Bee Swarm Configuration Template
# Copy this to .env and fill in your values

# ===== 系統基礎設置 =====
ENVIRONMENT=production
LOG_LEVEL=info
DEBUG=false
TIMEZONE=Asia/Shanghai

# ===== GitHub 配置 (必填) =====
GITHUB_TOKEN=ghp_your_token_here
GITHUB_OWNER=your_github_username
GITHUB_REPO=your_repository_name
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# ===== AI 工具配置 (必填) =====
CLAUDE_API_KEY=sk-ant-your_claude_key_here
GEMINI_API_KEY=your_gemini_key_here

# ===== VPS 部署配置 =====
VPS_HOST=your_vps_ip
VPS_USER=your_vps_user
CLOUDFLARE_TUNNEL_TOKEN=your_cloudflare_tunnel_token

# ===== 可選配置 =====
REDIS_URL=redis://redis:6379/0
DATABASE_URL=sqlite:///app/data/bee_swarm.db
EOF

    echo "✅ Generated .env.template"
}

# 生成 Docker Compose 覆蓋文件
generate_compose_override() {
    cat > docker-compose.override.yml << 'EOF'
# 本地開發環境覆蓋配置
version: '3.8'

services:
  backend:
    environment:
      - DEBUG=true
      - LOG_LEVEL=debug
    volumes:
      - .:/app  # 代碼熱重載
    ports:
      - "8000:8000"
      - "5678:5678"  # debugger port
    
  redis:
    ports:
      - "6379:6379"  # 本地 Redis 訪問
EOF

    echo "✅ Generated docker-compose.override.yml for development"
}

# 主執行邏輯
main() {
    echo "🔧 Generating Bee Swarm configuration templates..."
    
    generate_env_template
    generate_compose_override
    
    echo ""
    echo "📋 Next steps:"
    echo "1. Copy .env.template to .env"
    echo "2. Fill in your actual values in .env"
    echo "3. Run: python3 scripts/validate_config.py"
    echo "4. If validation passes, run: docker-compose up -d"
}

main "$@"
```

---

## 📋 配置檢查清單

### 部署前檢查
- [ ] 所有必需環境變量已設置
- [ ] GitHub Token 權限正確 (repo, workflow, issues)
- [ ] AI API 密鑰有效且有足夠配額
- [ ] VPS 資源符合最低要求 (2C4G20GB)
- [ ] Docker 和 Docker Compose 已安裝
- [ ] Cloudflare Tunnel 已配置（如需要）

### 安全檢查
- [ ] 生產環境禁用 DEBUG 模式
- [ ] 敏感信息存儲在 GitHub Secrets 中
- [ ] 容器以非 root 用戶運行
- [ ] 網絡適當隔離
- [ ] 定期備份重要數據

### 性能檢查
- [ ] 資源限制已設置
- [ ] 緩存策略已配置
- [ ] 監控告警已啟用
- [ ] 日誌輪轉已配置

---

*本配置指南確保 Bee Swarm 系統能夠在約束條件下穩定高效運行。請根據實際環境調整具體配置值。* 