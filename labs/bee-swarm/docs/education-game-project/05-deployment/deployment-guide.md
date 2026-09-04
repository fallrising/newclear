# 部署指南

## 概述

本文档由 DevOps Engineer AI 角色生成，详细说明教育游戏项目的部署流程和配置。

## 部署架构

### 生产环境架构
```
Internet → CDN → Load Balancer → Application Servers → Database
    ↓         ↓         ↓              ↓              ↓
Cloudflare  Nginx    Docker       Node.js/React   PostgreSQL
```

### 容器化部署
```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REACT_APP_API_URL=https://api.education-game.com

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@postgres:5432/education_game
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}

  postgres:
    image: postgres:14
    environment:
      - POSTGRES_DB=education_game
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:6-alpine
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl

volumes:
  postgres_data:
  redis_data:
```

## 部署步骤

### 1. 环境准备
```bash
# 安装 Docker 和 Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 克隆项目
git clone https://github.com/your-org/education-game.git
cd education-game

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，设置生产环境变量
```

### 2. 构建和部署
```bash
# 构建镜像
docker-compose -f docker-compose.prod.yml build

# 启动服务
docker-compose -f docker-compose.prod.yml up -d

# 检查服务状态
docker-compose -f docker-compose.prod.yml ps
```

### 3. 数据库迁移
```bash
# 运行数据库迁移
docker-compose -f docker-compose.prod.yml exec backend npm run migrate

# 初始化基础数据
docker-compose -f docker-compose.prod.yml exec backend npm run seed
```

## 监控配置

### Prometheus 配置
```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'education-game'
    static_configs:
      - targets: ['backend:8000']
    metrics_path: '/metrics'
```

### Grafana 仪表板
- 应用性能监控
- 数据库性能监控
- 系统资源监控
- 错误率监控

## 备份策略

### 数据库备份
```bash
# 自动备份脚本
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker-compose exec postgres pg_dump -U user education_game > backup_$DATE.sql
```

### 文件备份
```bash
# 备份上传文件
rsync -av /app/uploads/ /backup/uploads/
```

## 安全配置

### SSL/TLS 配置
```nginx
# nginx.conf
server {
    listen 443 ssl;
    server_name education-game.com;
    
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    
    location / {
        proxy_pass http://frontend:3000;
    }
    
    location /api {
        proxy_pass http://backend:8000;
    }
}
```

### 防火墙配置
```bash
# UFW 配置
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
```

## 故障恢复

### 服务重启
```bash
# 重启特定服务
docker-compose -f docker-compose.prod.yml restart backend

# 重启所有服务
docker-compose -f docker-compose.prod.yml restart
```

### 数据恢复
```bash
# 恢复数据库
docker-compose exec postgres psql -U user education_game < backup_20231201_120000.sql
```

## 性能优化

### 缓存配置
```typescript
// Redis 缓存配置
const redisConfig = {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  maxRetriesPerRequest: 3
};
```

### 负载均衡
```nginx
# Nginx 负载均衡
upstream backend {
    server backend1:8000;
    server backend2:8000;
    server backend3:8000;
}
```

## 下一步

1. 配置监控告警
2. 设置自动备份
3. 配置 CDN
4. 性能测试和优化

---

*本文档由 DevOps Engineer AI 生成。* 