# 🚀 Bee Swarm Deployment Guide

## 📋 Document Information
- **Target Audience**: DevOps Engineers, System Administrators, Developers
- **Prerequisites**: Docker, Linux basics, GitHub Actions
- **Deployment Time**: 30-60 minutes
- **Last Updated**: January 2025

## 🎯 Deployment Overview

Bee Swarm adopts a simplified GitHub-Centric architecture, specifically optimized for regular VPS environments, adhering to the project's core constraints, providing stable and reliable deployment solutions.

### Deployment Features
- ✅ **Constraint-Friendly**: Fully compliant with VPS + Cloudflare Tunnel constraints
- ✅ **Simplicity First**: Avoids complex microservices and Kubernetes
- ✅ **Cost-Controlled**: Monthly cost < $50 (infrastructure) + $30 (AI tools)
- ✅ **High Automation**: GitHub Actions-based CI/CD

## 🔧 System Requirements

### Hardware Requirements

#### Minimum Configuration (Test Environment)
```yaml
hardware_minimum:
  cpu: "1 vCore"
  memory: "2GB RAM"
  storage: "20GB SSD"
  network: "1Mbps stable connection"
  cost: "~$10-15/month"
```

#### Recommended Configuration (Production Environment)
```yaml
hardware_recommended:
  cpu: "2 vCore"
  memory: "4GB RAM"
  storage: "40GB SSD"
  network: "10Mbps stable connection"
  cost: "~$20-30/month"
  
performance_targets:
  concurrent_users: "10-50"
  response_time: "< 3 seconds"
  uptime: "> 95%"
  api_calls_daily: "1000-5000"
```

#### High Load Configuration (Scaled Environment)
```yaml
hardware_scaled:
  cpu: "4 vCore"
  memory: "8GB RAM"
  storage: "80GB SSD"
  network: "100Mbps"
  cost: "~$40-50/month"
```

### Software Requirements
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

## 🛠️ Deployment Steps

### Phase 1: Environment Preparation

#### 1. System Initialization
```bash
#!/bin/bash
# scripts/setup_vps.sh

# Update system
sudo apt update && sudo apt upgrade -y

# Install required software
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

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add current user to docker group
sudo usermod -aG docker $USER

# Enable Docker service
sudo systemctl enable docker
sudo systemctl start docker

echo "✅ VPS environment preparation complete, please re-login to apply Docker permissions"
```

#### 2. Firewall Configuration
```bash
# Configure UFW firewall (security best practices)
sudo ufw --force enable
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (adjust according to actual port)
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS (if direct access needed)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# If using Cloudflare Tunnel, only allow Cloudflare IPs
# sudo ufw allow from 103.21.244.0/22
# sudo ufw allow from 103.22.200.0/22
# sudo ufw allow from 103.31.4.0/22
# For more Cloudflare IP ranges, please check official documentation

sudo ufw status verbose
```

### Phase 2: Project Deployment

#### 1. Clone and Configuration
```bash
# Clone project
git clone https://github.com/your-org/bee_swarm.git
cd bee_swarm

# Create necessary directories
mkdir -p {data,logs,backups,secrets}

# Set permissions
chmod 755 data logs backups
chmod 700 secrets

# Copy configuration template
cp .env.template .env
```

#### 2. Environment Configuration
```bash
# Edit environment variables
nano .env

# Basic configuration checklist:
# ✅ GITHUB_TOKEN - GitHub Personal Access Token
# ✅ GITHUB_OWNER - GitHub username/organization
# ✅ GITHUB_REPO - Repository name
# ✅ CLAUDE_API_KEY - Claude API key (Product Manager use)
# ✅ GEMINI_API_KEY - Gemini API key (Other roles use)
# ✅ VPS_HOST - VPS IP address
# ✅ CLOUDFLARE_TUNNEL_TOKEN - Cloudflare Tunnel token (optional)
```

#### 3. Configuration Validation
```bash
# Execute configuration validation
python3 scripts/validate_config.py

# Expected output:
# ✅ All configurations are valid!
# or
# ✅ Configuration is valid (with warnings)

# If there are errors, please fix configuration according to prompts
```

### Phase 3: Service Startup

#### 1. Build and Start Services
```bash
# Build Docker images
docker-compose build --no-cache

# Start services (background mode)
docker-compose up -d

# Check service status
docker-compose ps

# Expected output:
# NAME              IMAGE          COMMAND                  SERVICE    CREATED         STATUS                   PORTS
# bee_swarm-backend-1    bee_swarm_backend    "npm start"             backend    2 minutes ago   Up 2 minutes (healthy)   0.0.0.0:8000->8000/tcp
# bee_swarm-redis-1      redis:7-alpine       "docker-entrypoint.s…"   redis      2 minutes ago   Up 2 minutes             6379/tcp
# bee_swarm-nginx-1      nginx:alpine         "/docker-entrypoint.…"   nginx      2 minutes ago   Up 2 minutes             0.0.0.0:80->80/tcp
```

#### 2. Health Check
```bash
# Check application health status
curl -f http://localhost:8000/health

# Expected response:
# {"status":"ok","timestamp":"2025-01-XX","version":"2.0.0"}

# Check GitHub API connection
curl -f http://localhost:8000/api/github/status

# Check AI tools connection
curl -f http://localhost:8000/api/ai/status
```

## 🌐 Network Configuration

### Cloudflare Tunnel Setup (Recommended)

#### 1. Install Cloudflared
```bash
# Download cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Login to Cloudflare
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create bee-swarm

# Configure tunnel
cat > /home/$USER/.cloudflared/config.yml << EOF
tunnel: bee-swarm
credentials-file: /home/$USER/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: your-domain.example.com
    service: http://localhost:80
  - service: http_status:404
EOF

# Configure DNS
cloudflared tunnel route dns bee-swarm your-domain.example.com

# Start tunnel
cloudflared tunnel run bee-swarm
```

#### 2. Systemd Service Configuration
```bash
# Create systemd service
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

# Enable and start service
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

### Traditional Reverse Proxy (Alternative)

#### Nginx Configuration
```nginx
# /etc/nginx/sites-available/bee-swarm
server {
    listen 80;
    server_name your-domain.example.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.example.com;
    
    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/your-domain.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
    
    # Proxy to backend
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
    
    # Static files (if any)
    location /static/ {
        alias /app/static/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        proxy_pass http://localhost:8000/health;
    }
}
```

## 🔄 CI/CD Automation

### GitHub Actions Deployment Workflow
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
            
            # Backup current version
            docker-compose down
            git stash
            
            # Pull latest code
            git pull origin main
            
            # Check configuration
            python3 scripts/validate_config.py
            
            # Rebuild and deploy
            docker-compose build --no-cache
            docker-compose up -d
            
            # Health check
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

### Automated Monitoring and Alerting
```yaml
# .github/workflows/monitoring.yml
name: Production Monitoring

on:
  schedule:
    - cron: '*/15 * * * *'  # Check every 15 minutes
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    
    steps:
      - name: Health Check
        run: |
          # Check service health status
          response=$(curl -s -o /dev/null -w "%{http_code}" https://your-domain.example.com/health)
          
          if [ $response -ne 200 ]; then
            echo "❌ Health check failed: HTTP $response"
            exit 1
          fi
          
          echo "✅ Health check passed"
          
      - name: Performance Check
        run: |
          # Check response time
          response_time=$(curl -o /dev/null -s -w '%{time_total}' https://your-domain.example.com/health)
          
          # If response time exceeds 5 seconds, issue warning
          if (( $(echo "$response_time > 5" | bc -l) )); then
            echo "⚠️ Slow response time: ${response_time}s"
          else
            echo "✅ Response time OK: ${response_time}s"
          fi
          
      - name: Resource Usage Check
        run: |
          # Check VPS resource usage via SSH
          ssh ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} << 'EOF'
            # Check disk usage
            DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
            if [ $DISK_USAGE -gt 85 ]; then
              echo "⚠️ High disk usage: $DISK_USAGE%"
            fi
            
            # Check memory usage
            MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100.0}')
            if [ $MEMORY_USAGE -gt 90 ]; then
              echo "⚠️ High memory usage: $MEMORY_USAGE%"
            fi
            
            # Check Docker container status
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

## 📊 Monitoring and Maintenance

### System Monitoring Script
```bash
#!/bin/bash
# scripts/system_monitor.sh

echo "🔍 Bee Swarm System Monitor"
echo "=========================="

# Check Docker services
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

### Backup Strategy
```bash
#!/bin/bash
# scripts/backup.sh

BACKUP_DIR="/opt/backups/bee_swarm"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="bee_swarm_backup_$DATE.tar.gz"

echo "🗄️ Starting Bee Swarm backup..."

# Create backup directory
mkdir -p $BACKUP_DIR

# Stop services (optional, depends on data consistency requirements)
# docker-compose stop

# Create backup
tar -czf $BACKUP_DIR/$BACKUP_FILE \
    --exclude='node_modules' \
    --exclude='logs/*.log' \
    --exclude='.git' \
    /opt/bee_swarm

# Restart services (if stopped earlier)
# docker-compose start

# Clean old backups (keep last 7 days)
find $BACKUP_DIR -name "bee_swarm_backup_*.tar.gz" -mtime +7 -delete

echo "✅ Backup completed: $BACKUP_DIR/$BACKUP_FILE"

# Optional: Upload to cloud storage
# rclone copy $BACKUP_DIR/$BACKUP_FILE remote:backups/
```

## 🔧 Troubleshooting

### Common Issues and Solutions

#### 1. Container Startup Failure
```bash
# Diagnostic steps
echo "🔍 Diagnosing container startup issues..."

# Check Docker status
sudo systemctl status docker

# Check disk space
df -h

# Check container logs
docker-compose logs

# Check configuration files
python3 scripts/validate_config.py

# Try rebuilding
docker-compose down
docker system prune -f
docker-compose build --no-cache
docker-compose up -d
```

#### 2. GitHub API Connection Issues
```bash
# Check GitHub Token
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user

# Check API limits
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit

# Check network connectivity
ping github.com
nslookup api.github.com
```

#### 3. AI Tools Connection Issues
```bash
# Test Claude API
curl -X POST https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CLAUDE_API_KEY" \
  -d '{"model":"claude-3-sonnet-20240229","messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'

# Test Gemini API
curl -X POST "https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

#### 4. Performance Issues
```bash
# Check resource usage
htop
iotop
nethogs

# Check Docker statistics
docker stats

# Analyze logs
tail -f logs/application.log | grep ERROR
tail -f logs/application.log | grep SLOW

# Check database performance (if using PostgreSQL)
# docker-compose exec postgres psql -U postgres -c "SELECT * FROM pg_stat_activity;"
```

### Disaster Recovery Procedures

#### Quick Recovery Steps
```bash
#!/bin/bash
# scripts/emergency_recovery.sh

echo "🚨 Starting emergency recovery procedure..."

# 1. Stop all services
docker-compose down

# 2. Check system resources
echo "📊 System Resources:"
df -h
free -h

# 3. Clean Docker resources
docker system prune -f
docker volume prune -f

# 4. Restore from backup (if needed)
if [ -n "$1" ]; then
    echo "📦 Restoring from backup: $1"
    tar -xzf $1 -C /tmp/
    cp -r /tmp/opt/bee_swarm/* ./
fi

# 5. Redeploy
echo "🚀 Redeploying services..."
docker-compose build --no-cache
docker-compose up -d

# 6. Health check
sleep 30
curl -f http://localhost:8000/health

echo "✅ Emergency recovery completed"
```

## 🔐 Security Hardening

### SSL/TLS Configuration
```bash
# Use Let's Encrypt for free SSL certificates
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.example.com

# Set up automatic renewal
sudo crontab -e
# Add the following line:
# 0 12 * * * /usr/bin/certbot renew --quiet
```

### Intrusion Detection
```bash
# Install fail2ban
sudo apt install fail2ban

# Configure fail2ban
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

## 📋 Deployment Checklist

### Pre-deployment Preparation
- [ ] VPS meets minimum hardware requirements
- [ ] Docker and Docker Compose installed
- [ ] Firewall and security settings configured
- [ ] All required API keys obtained
- [ ] GitHub Secrets configured
- [ ] Domain and DNS configured (if using)

### Deployment Execution
- [ ] Successfully cloned code repository
- [ ] Environment variables configured and validated
- [ ] Docker containers started successfully
- [ ] Health checks passed
- [ ] Network configuration correct (Cloudflare Tunnel or reverse proxy)
- [ ] SSL certificate configured (if using HTTPS)

### Post-deployment Verification
- [ ] Application accessible via public internet
- [ ] GitHub API connection normal
- [ ] AI tools connection normal
- [ ] Monitoring and alerting configured
- [ ] Backup strategy implemented
- [ ] Documentation and operations manual updated

### Ongoing Maintenance
- [ ] Regular health checks performed
- [ ] System resource usage monitored
- [ ] Important data regularly backed up
- [ ] Updates and security patches managed
- [ ] Performance optimization and tuning

---

*This deployment guide ensures that the Bee Swarm system can run stably under constraint conditions, providing reliable production environment support.* 