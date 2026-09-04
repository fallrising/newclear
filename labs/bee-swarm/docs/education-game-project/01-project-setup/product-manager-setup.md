# 产品经理角色容器配置

## 概述

本文档详细说明如何配置和运转 Product Manager AI 角色容器，包括环境配置、工作流程、工具使用等。

## 容器配置

### 基础配置
```yaml
# docker-compose.yml 中的产品经理容器配置
pm-01:
  build: 
    context: ./roles/product_manager
    dockerfile: Dockerfile
  environment:
    - ROLE_NAME=product_manager_01
    - ROLE_ID=pm-01
    - GITHUB_USERNAME=${GITHUB_USERNAME_PM_01}
    - GITHUB_TOKEN=${GITHUB_TOKEN_PM_01}
    - VNC_PASSWORD=${VNC_PASSWORD_PM_01}
    - TTYD_PASSWORD=${TTYD_PASSWORD_PM_01}
    - GITHUB_REPOSITORY=${GITHUB_REPOSITORY}
    - GITHUB_OWNER=${GITHUB_OWNER}
    - AI_TOOLS=gemini-cli,claude-code,rovo-dev
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    - GEMINI_API_KEY=${GEMINI_API_KEY}
    - ROVO_DEV_EMAIL=${ROVO_DEV_EMAIL}
    - ROVO_DEV_TOKEN=${ROVO_DEV_TOKEN}
  ports:
    - "6080:6080"  # noVNC
    - "7680:7681"  # ttyd
  volumes:
    - pm_01_data:/app/data
    - pm_01_logs:/app/logs
    - pm_01_config:/app/config
    - shared_workspace:/workspace
    - firefox_profile_pm_01:/home/firefox-profile
  restart: unless-stopped
  deploy:
    resources:
      limits:
        memory: 1G
        cpus: '0.5'
      reservations:
        memory: 512M
        cpus: '0.25'
```

### 环境变量配置
```bash
# .env 文件中的产品经理配置
# 产品经理 GitHub 账号
GITHUB_USERNAME_PM_01=pm_ai_001
GITHUB_TOKEN_PM_01=ghp_xxxxxxxxxxxxxxxxxxxx

# VNC 密码配置
VNC_PASSWORD_PM_01=vnc123

# TTYD 终端密码配置
TTYD_PASSWORD_PM_01=MyTerminalPassword123

# AI 工具配置
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
GEMINI_API_KEY=xxxxxxxxxxxxxxxxxxxx
ROVO_DEV_EMAIL=pm@education-game.com
ROVO_DEV_TOKEN=rovo_xxxxxxxxxxxxxxxxxxxx
```

## 容器启动流程

### 1. 环境准备
```bash
# 检查 Docker 环境
docker --version
docker-compose --version

# 检查网络连接
ping -c 1 8.8.8.8

# 检查端口占用
netstat -tulpn | grep :6080
netstat -tulpn | grep :7680
```

### 2. 启动容器
```bash
# 构建产品经理容器
docker-compose build pm-01

# 启动容器
docker-compose up -d pm-01

# 检查容器状态
docker-compose ps pm-01

# 查看容器日志
docker-compose logs -f pm-01
```

### 3. 验证容器运行
```bash
# 检查容器内部状态
docker-compose exec pm-01 ps aux

# 检查网络连接
docker-compose exec pm-01 ping -c 1 google.com

# 检查 AI 工具配置
docker-compose exec pm-01 env | grep -E "(ANTHROPIC|GEMINI|ROVO)"
```

## 工作环境配置

### VNC 桌面环境
```bash
# 访问 VNC 桌面
# 浏览器访问: http://localhost:6080
# 密码: vnc123

# VNC 桌面配置
- 分辨率: 1920x1080
- 颜色深度: 24位
- 桌面环境: XFCE4
- 浏览器: Firefox
- 终端: xfce4-terminal
```

### 终端环境
```bash
# 访问 Web 终端
# 浏览器访问: http://localhost:7680
# 密码: MyTerminalPassword123

# 终端配置
- Shell: bash
- 用户: firefox
- 工作目录: /workspace
- 权限: sudo 权限
```

## AI 工具配置

### 1. Gemini CLI 配置
```bash
# 进入容器
docker-compose exec pm-01 bash

# 配置 Gemini CLI
export GEMINI_API_KEY="xxxxxxxxxxxxxxxxxxxx"

# 测试 Gemini CLI
gemini --help
gemini "Hello, I'm a Product Manager AI. Please help me analyze requirements."
```

### 2. Claude Code 配置
```bash
# 配置 Claude API
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxxxxxxxxx"

# 测试 Claude API
curl -X POST https://api.anthropic.com/v1/messages \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet-20240229",
    "max_tokens": 1000,
    "messages": [{"role": "user", "content": "Hello, I need help with product analysis."}]
  }'
```

### 3. Rovo Dev CLI 配置
```bash
# 安装 Rovo Dev CLI
npm install -g @rovo/cli

# 初始化配置
rovo init

# 输入配置信息
# Email: pm@education-game.com
# Token: rovo_xxxxxxxxxxxxxxxxxxxx

# 验证配置
rovo auth test

# 测试功能
rovo --help
```

## 工作流程配置

### 1. GitHub 集成
```bash
# 配置 Git
git config --global user.name "Product Manager AI"
git config --global user.email "pm@education-game.com"

# 配置 GitHub Token
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"

# 测试 GitHub API
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/user
```

### 2. 项目工作空间
```bash
# 创建工作目录
mkdir -p /workspace/education-game
cd /workspace/education-game

# 克隆项目仓库
git clone https://github.com/your-org/education-game.git .

# 设置工作环境
echo "export PROJECT_ROOT=/workspace/education-game" >> ~/.bashrc
echo "export GITHUB_REPO=your-org/education-game" >> ~/.bashrc
source ~/.bashrc
```

### 3. 工具脚本配置
```bash
# 创建工具脚本目录
mkdir -p /workspace/tools

# 创建需求分析脚本
cat > /workspace/tools/analyze_requirements.sh << 'EOF'
#!/bin/bash
# 需求分析脚本
echo "开始需求分析..."
gemini "分析以下需求: $1"
echo "需求分析完成"
EOF

chmod +x /workspace/tools/analyze_requirements.sh

# 创建任务分解脚本
cat > /workspace/tools/breakdown_tasks.sh << 'EOF'
#!/bin/bash
# 任务分解脚本
echo "开始任务分解..."
claude "将以下需求分解为具体任务: $1"
echo "任务分解完成"
EOF

chmod +x /workspace/tools/breakdown_tasks.sh
```

## 日常工作流程

### 1. 需求分析流程
```bash
# 启动工作环境
cd /workspace/education-game

# 读取 GitHub Issues
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$GITHUB_REPO/issues

# 分析需求
./tools/analyze_requirements.sh "用户需要教育游戏功能"

# 生成需求文档
gemini "生成需求分析文档" > requirements.md

# 提交到 GitHub
git add requirements.md
git commit -m "Add requirements analysis"
git push origin main
```

### 2. 任务分解流程
```bash
# 分解任务
./tools/breakdown_tasks.sh "实现用户注册功能"

# 创建 GitHub Issues
curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/$GITHUB_REPO/issues \
  -d '{
    "title": "Implement user registration",
    "body": "Create user registration API and UI",
    "labels": ["backend", "frontend", "high-priority"]
  }'
```

### 3. 进度监控流程
```bash
# 获取项目进度
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$GITHUB_REPO/projects

# 更新任务状态
curl -X PATCH \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/$GITHUB_REPO/issues/123 \
  -d '{"state": "closed"}'
```

## 监控和日志

### 1. 容器监控
```bash
# 监控容器资源使用
docker stats pm-01

# 监控容器日志
docker-compose logs -f pm-01

# 检查容器健康状态
docker-compose exec pm-01 ps aux
```

### 2. 应用监控
```bash
# 监控 AI 工具使用
tail -f /workspace/logs/ai_tools.log

# 监控 GitHub API 调用
tail -f /workspace/logs/github_api.log

# 监控工作流程
tail -f /workspace/logs/workflow.log
```

### 3. 性能监控
```bash
# 监控内存使用
free -h

# 监控 CPU 使用
top

# 监控磁盘使用
df -h
```

## 故障排除

### 1. 容器启动问题
```bash
# 检查容器状态
docker-compose ps

# 查看详细日志
docker-compose logs pm-01

# 重启容器
docker-compose restart pm-01

# 重新构建容器
docker-compose build --no-cache pm-01
```

### 2. AI 工具问题
```bash
# 检查 API 密钥
echo $ANTHROPIC_API_KEY
echo $GEMINI_API_KEY
echo $ROVO_DEV_TOKEN

# 测试 API 连接
curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  https://api.anthropic.com/v1/messages

# 重新配置 Rovo Dev CLI
rovo init
```

### 3. GitHub 连接问题
```bash
# 检查 GitHub Token
echo $GITHUB_TOKEN

# 测试 GitHub API
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/user

# 检查网络连接
ping -c 1 api.github.com
```

## 备份和恢复

### 1. 数据备份
```bash
# 备份工作数据
tar -czf /backup/pm_workspace_$(date +%Y%m%d).tar.gz /workspace

# 备份配置文件
tar -czf /backup/pm_config_$(date +%Y%m%d).tar.gz /app/config

# 备份日志文件
tar -czf /backup/pm_logs_$(date +%Y%m%d).tar.gz /app/logs
```

### 2. 数据恢复
```bash
# 恢复工作数据
tar -xzf /backup/pm_workspace_20231201.tar.gz -C /

# 恢复配置文件
tar -xzf /backup/pm_config_20231201.tar.gz -C /

# 恢复日志文件
tar -xzf /backup/pm_logs_20231201.tar.gz -C /
```

## 下一步

1. **启动容器**: 按照配置启动产品经理容器
2. **验证环境**: 确认所有工具和配置正常工作
3. **开始工作**: 开始需求分析和项目管理
4. **监控运行**: 持续监控容器运行状态
5. **优化配置**: 根据实际使用情况优化配置

---

*本文档详细说明了产品经理角色容器的配置和运转流程。* 