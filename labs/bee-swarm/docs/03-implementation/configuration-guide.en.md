# 🔧 Bee Swarm Configuration Guide

## 📋 Document Information
- **Target Audience**: Technical Personnel, System Administrators
- **Prerequisites**: Basic Docker, GitHub, Environment Variables concepts
- **Completion Time**: 30-60 minutes
- **Last Updated**: January 2025

## 🎯 Configuration Overview

This guide provides complete configuration instructions for the Bee Swarm system, covering environment variables, AI role configuration, GitHub integration, monitoring setup, and security configuration. All configurations are based on Bee Swarm's core constraint design.

## 📋 Environment Variable Configuration

### System Basic Configuration
```bash
# .env Basic Configuration
# ===== System Basic Settings =====
ENVIRONMENT=production          # development, staging, production
LOG_LEVEL=info                 # debug, info, warning, error
DEBUG=false                    # Whether to enable debug mode
TIMEZONE=Asia/Shanghai         # System timezone

# ===== Application Basic Information =====
APP_NAME=bee-swarm
APP_VERSION=2.0.0
API_PREFIX=/api/v1
```

### GitHub Integration Configuration (Core)
```bash
# ===== GitHub Basic Configuration =====
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx  # GitHub Personal Access Token
GITHUB_OWNER=your-organization         # GitHub organization or username
GITHUB_REPO=your-repository           # Default repository name

# ===== GitHub API Configuration =====
GITHUB_API_URL=https://api.github.com
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_APP_ID=123456                  # If using GitHub App (optional)

# ===== GitHub Actions Configuration =====
ENABLE_GITHUB_ACTIONS=true
ACTIONS_WORKFLOW_PATH=.github/workflows
GITHUB_API_RATE_LIMIT=4500            # Reserve margin to avoid exceeding limits
```

### AI Tools Configuration (Compliance with Constraints)
```bash
# ===== Claude Configuration (Product Manager Only) =====
CLAUDE_API_KEY=sk-ant-xxxxxxxxxxxxx
CLAUDE_MODEL=claude-3-sonnet-20240229
CLAUDE_MAX_TOKENS=4000
CLAUDE_TEMPERATURE=0.3

# ===== Gemini Configuration (Other Roles) =====
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-1.5-flash-latest   # Use free quota
GEMINI_MAX_TOKENS=2000
GEMINI_TEMPERATURE=0.2

# ===== Tool Usage Limits =====
AI_TOOL_RATE_LIMIT=true               # Enable rate limiting
TOOL_USAGE_TRACKING=true              # Track usage
COST_OPTIMIZATION=true                # Cost optimization mode
```

## 🤖 AI Role Configuration

### Product Manager Configuration (Claude Code)
```yaml
# roles/product_manager/config.yml
role_config:
  name: "Product Manager"
  description: "Responsible for product strategy and requirements management"
  
  # AI Tool Settings (Compliance with Constraints)
  ai_settings:
    provider: "claude"
    model: "claude-3-sonnet-20240229"
    temperature: 0.3
    max_tokens: 4000
    system_prompt: |
      You are an experienced product manager, focused on:
      - Requirements analysis and feature planning
      - User story writing and epic breakdown
      - Priority management and resource coordination
      - Communication bridge with technical teams
      
      Please always consider technical constraints and resource limitations, providing practical product decisions.
  
  # Core Capability Definition
  capabilities:
    - requirement_analysis      # Requirements analysis
    - epic_breakdown           # Epic breakdown
    - priority_management      # Priority management
    - stakeholder_communication # Stakeholder communication
    - roadmap_planning         # Roadmap planning
  
  # Available Tools (GitHub-Centric)
  tools:
    - github_issues           # GitHub Issues management
    - github_projects         # Project boards
    - github_wiki            # Documentation writing
    - analytics_dashboard     # Analytics dashboard
  
  # Workflow Configuration
  workflow:
    response_time: 30         # Response time (minutes)
    review_frequency: daily   # Review frequency
    escalation_threshold: high # Escalation threshold
    
  # Cost Control
  cost_limits:
    monthly_api_calls: 10000  # Monthly API call limit
    token_budget: 1000000     # Monthly token budget
```

### Backend Developer Configuration (Gemini CLI)
```yaml
# roles/backend_developer/config.yml
role_config:
  name: "Backend Developer"
  description: "Responsible for server-side development and architecture design"
  
  # AI Tool Settings (Free Quota)
  ai_settings:
    provider: "gemini"
    model: "gemini-1.5-flash-latest"
    temperature: 0.2
    max_tokens: 2000
    system_prompt: |
      You are a senior backend development engineer, specializing in:
      - RESTful API design and implementation
      - Database design and optimization
      - Microservices architecture (within constraint scope)
      - Performance optimization and security practices
      
      Please provide technical solutions under normal VPS resource constraints.
  
  # Technical Stack (Compliance with Constraints)
  technical_stack:
    languages: [python, javascript, go]
    frameworks: [fastapi, express, gin]
    databases: [sqlite, postgresql, redis]  # Lightweight priority
    tools: [docker, nginx, sqlite]
  
  # Coding Standards
  code_standards:
    style_guide: "pep8 / airbnb"
    test_coverage: 80
    documentation: required
    security_scan: enabled
    
  # Cost Control (Free Quota)
  cost_limits:
    monthly_api_calls: 50000   # Gemini free quota
    batch_processing: true     # Batch processing optimization
    caching_enabled: true      # Enable caching
```

### Frontend Developer Configuration (Gemini CLI)
```yaml
# roles/frontend_developer/config.yml
role_config:
  name: "Frontend Developer"
  description: "Responsible for user interface and frontend functionality development"
  
  # AI Tool Settings
  ai_settings:
    provider: "gemini"
    model: "gemini-1.5-flash-latest"
    temperature: 0.2
    max_tokens: 2000
    
  # Technical Stack (Lightweight)
  technical_stack:
    frameworks: [react, vue, vanilla-js]
    styling: [tailwindcss, css-modules]
    build_tools: [vite, webpack]
    testing: [jest, cypress]
    
  # UI/UX Standards
  ui_standards:
    responsive_design: required
    accessibility: wcag_aa
    performance_budget: "< 3s load time"
    bundle_size: "< 1MB"
    
  # Deployment Configuration (Compliance with Constraints)
  deployment:
    static_hosting: cloudflare_pages
    cdn_optimization: true
    compression: gzip
```

### DevOps Engineer Configuration (Gemini CLI)
```yaml
# roles/devops_engineer/config.yml
role_config:
  name: "DevOps Engineer"
  description: "Responsible for deployment, monitoring, and operations automation"
  
  # AI Tool Settings
  ai_settings:
    provider: "gemini"
    model: "gemini-1.5-flash-latest"
    temperature: 0.1  # More conservative settings
    max_tokens: 2000
    
  # Infrastructure Configuration (Compliance with Constraints)
  infrastructure:
    platform: "Regular VPS"
    containerization: docker
    orchestration: docker-compose  # Not k8s
    networking: cloudflare_tunnel
    monitoring: github_actions
    
  # Deployment Strategy
  deployment_strategy:
    type: "rolling_update"
    zero_downtime: false  # VPS limitations
    backup_strategy: git_based
    rollback_time: "< 5 minutes"
    
  # Monitoring Configuration (Simplified)
  monitoring:
    metrics: basic_system_metrics
    logging: file_based
    alerting: github_notifications
    uptime_target: 95  # Realistic target
```

## 📊 Monitoring Configuration (Lightweight)

### GitHub Actions Monitoring
```yaml
# .github/workflows/monitoring.yml
name: System Monitoring
on:
  schedule:
    - cron: '0 */6 * * *'  # Check every 6 hours
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: System Health Check
        run: |
          # Check service status
          curl -f ${{ secrets.APP_URL }}/health || exit 1
          
      - name: Resource Usage Check
        run: |
          # Check resource usage (via API)
          USAGE=$(curl -s ${{ secrets.APP_URL }}/api/metrics)
          echo "Current usage: $USAGE"
          
      - name: GitHub API Quota Check
        run: |
          # Check GitHub API quota
          QUOTA=$(curl -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
                  https://api.github.com/rate_limit)
          echo "API quota: $QUOTA"
```

### Basic Alert Configuration
```yaml
# config/alerts.yml (Simplified Version)
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

## 🔒 Security Configuration

### GitHub Secrets Management
```bash
# Required GitHub Secrets
CLAUDE_API_KEY              # Claude API key
GEMINI_API_KEY              # Gemini API key
VPS_SSH_KEY                 # VPS SSH private key
VPS_HOST                    # VPS host address
VPS_USER                    # VPS username
CLOUDFLARE_TUNNEL_TOKEN     # Cloudflare Tunnel token
WEBHOOK_SECRET              # Webhook signature key
```

### Container Security Configuration
```dockerfile
# Security-hardened Dockerfile example
FROM node:18-alpine

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY --chown=nextjs:nodejs . .

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["npm", "start"]
```

### Network Security Configuration
```yaml
# docker-compose.yml Network Configuration
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
    internal: true  # Internal network isolation
  external:
    driver: bridge
```

## 🐳 Docker Configuration (Lightweight)

### Optimized Docker Compose
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
          memory: 512M      # VPS resource limitations
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

## ⚙️ Advanced Configuration

### Cache Strategy Configuration
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
        'TIMEOUT': 300,  # 5-minute default expiration
        'MAX_ENTRIES': 10000,  # Maximum number of entries
    },
    'github_api': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': 'redis://redis:6379/2',
        'TIMEOUT': 3600,  # GitHub API cache for 1 hour
        'MAX_ENTRIES': 5000,
    },
    'ai_responses': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': 'redis://redis:6379/3',
        'TIMEOUT': 86400,  # AI response cache for 24 hours
        'MAX_ENTRIES': 1000,
    }
}
```

### Task Queue Configuration (Lightweight)
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
    
    # Task routing (simplified version)
    'task_routes': {
        'ai.tasks.*': {'queue': 'ai_tasks'},
        'github.tasks.*': {'queue': 'github_tasks'},
        'monitoring.tasks.*': {'queue': 'monitoring'},
    },
    
    # Resource limitations
    'worker_max_tasks_per_child': 1000,
    'worker_max_memory_per_child': 200000,  # 200MB
    'task_time_limit': 300,  # 5-minute timeout
    'task_soft_time_limit': 240,  # 4-minute soft timeout
}
```

## 🔧 Configuration Validation and Best Practices

### Configuration Validation Script
```python
#!/usr/bin/env python3
# scripts/validate_config.py

import os
import sys
from typing import List, Dict, Any

class ConfigValidator:
    """Configuration validator"""
    
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
        """Execute complete configuration validation"""
        self._check_required_vars()
        self._check_github_config()
        self._check_ai_tools_config()
        self._check_resource_limits()
        self._check_security_settings()
        
        return len(self.errors) == 0
    
    def _check_required_vars(self):
        """Check required environment variables"""
        missing_vars = []
        for var in self.REQUIRED_VARS:
            if not os.getenv(var):
                missing_vars.append(var)
        
        if missing_vars:
            self.errors.append(f"Missing required environment variables: {missing_vars}")
    
    def _check_github_config(self):
        """Validate GitHub configuration"""
        token = os.getenv('GITHUB_TOKEN')
        if token and not token.startswith('ghp_'):
            self.warnings.append("GitHub token format may be incorrect")
        
        # Check API limit settings
        rate_limit = os.getenv('GITHUB_API_RATE_LIMIT', '5000')
        if int(rate_limit) > 4500:
            self.warnings.append("GitHub API rate limit should be < 4500 for safety")
    
    def _check_ai_tools_config(self):
        """Validate AI tools configuration"""
        claude_key = os.getenv('CLAUDE_API_KEY')
        if claude_key and not claude_key.startswith('sk-ant-'):
            self.errors.append("Invalid Claude API key format")
        
        gemini_key = os.getenv('GEMINI_API_KEY')
        if not gemini_key:
            self.errors.append("Gemini API key is required for most roles")
    
    def _check_resource_limits(self):
        """Check resource limit settings"""
        # Check memory limits
        if os.getenv('DOCKER_MEMORY_LIMIT'):
            memory_limit = os.getenv('DOCKER_MEMORY_LIMIT')
            if 'G' in memory_limit and int(memory_limit.replace('G', '')) > 2:
                self.warnings.append("Memory limit > 2GB may exceed VPS capacity")
    
    def _check_security_settings(self):
        """Check security settings"""
        if os.getenv('DEBUG', 'false').lower() == 'true':
            env = os.getenv('ENVIRONMENT', 'development')
            if env == 'production':
                self.errors.append("DEBUG should not be enabled in production")
    
    def report(self):
        """Generate validation report"""
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

### Configuration Template Generator
```bash
#!/bin/bash
# scripts/generate_config.sh

# Generate configuration template
generate_env_template() {
    cat > .env.template << 'EOF'
# Bee Swarm Configuration Template
# Copy this to .env and fill in your values

# ===== System Basic Settings =====
ENVIRONMENT=production
LOG_LEVEL=info
DEBUG=false
TIMEZONE=Asia/Shanghai

# ===== GitHub Configuration (Required) =====
GITHUB_TOKEN=ghp_your_token_here
GITHUB_OWNER=your_github_username
GITHUB_REPO=your_repository_name
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# ===== AI Tools Configuration (Required) =====
CLAUDE_API_KEY=sk-ant-your_claude_key_here
GEMINI_API_KEY=your_gemini_key_here

# ===== VPS Deployment Configuration =====
VPS_HOST=your_vps_ip
VPS_USER=your_vps_user
CLOUDFLARE_TUNNEL_TOKEN=your_cloudflare_tunnel_token

# ===== Optional Configuration =====
REDIS_URL=redis://redis:6379/0
DATABASE_URL=sqlite:///app/data/bee_swarm.db
EOF

    echo "✅ Generated .env.template"
}

# Generate Docker Compose override file
generate_compose_override() {
    cat > docker-compose.override.yml << 'EOF'
# Local development environment override configuration
version: '3.8'

services:
  backend:
    environment:
      - DEBUG=true
      - LOG_LEVEL=debug
    volumes:
      - .:/app  # Code hot reload
    ports:
      - "8000:8000"
      - "5678:5678"  # debugger port
    
  redis:
    ports:
      - "6379:6379"  # Local Redis access
EOF

    echo "✅ Generated docker-compose.override.yml for development"
}

# Main execution logic
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

## 📋 Configuration Checklist

### Pre-deployment Checklist
- [ ] All required environment variables are set
- [ ] GitHub Token has correct permissions (repo, workflow, issues)
- [ ] AI API keys are valid and have sufficient quota
- [ ] VPS resources meet minimum requirements (2C4G20GB)
- [ ] Docker and Docker Compose are installed
- [ ] Cloudflare Tunnel is configured (if needed)

### Security Checklist
- [ ] DEBUG mode disabled in production environment
- [ ] Sensitive information stored in GitHub Secrets
- [ ] Containers run as non-root users
- [ ] Networks properly isolated
- [ ] Important data regularly backed up

### Performance Checklist
- [ ] Resource limits configured
- [ ] Cache strategies configured
- [ ] Monitoring alerts enabled
- [ ] Log rotation configured

---

*This configuration guide ensures that the Bee Swarm system can run stably and efficiently under constraint conditions. Please adjust specific configuration values according to your actual environment.* 