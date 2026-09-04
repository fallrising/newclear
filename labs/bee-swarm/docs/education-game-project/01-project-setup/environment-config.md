# 环境配置指南

## 概述

本文档详细说明如何配置 Bee Swarm 系统来开发教育游戏项目，包括环境变量配置、AI 工具设置和系统启动。

## 系统要求

### 硬件要求
- **CPU**: 4 核心以上
- **内存**: 8GB RAM 以上
- **存储**: 50GB 可用空间
- **网络**: 稳定的互联网连接

### 软件要求
- **操作系统**: Ubuntu 20.04+ / CentOS 8+ / macOS 10.15+
- **Docker**: 20.10+
- **Docker Compose**: 2.0+
- **Git**: 2.25+

## 环境变量配置

### 1. 基础配置

创建 `.env` 文件：

```bash
# =============================================================================
# GitHub 配置
# =============================================================================

# GitHub 仓库信息
GITHUB_REPOSITORY=your-org/education-game
GITHUB_OWNER=your-org

# =============================================================================
# AI 角色 GitHub 配置
# =============================================================================

# 产品经理 GitHub 账号
GITHUB_USERNAME_PM_01=pm_ai_001
GITHUB_TOKEN_PM_01=ghp_xxxxxxxxxxxxxxxxxxxx

# 后端开发 GitHub 账号
GITHUB_USERNAME_BACKEND_01=backend_ai_001
GITHUB_TOKEN_BACKEND_01=ghp_xxxxxxxxxxxxxxxxxxxx

# 前端开发 GitHub 账号
GITHUB_USERNAME_FRONTEND_01=frontend_ai_001
GITHUB_TOKEN_FRONTEND_01=ghp_xxxxxxxxxxxxxxxxxxxx

# DevOps工程师 GitHub 账号
GITHUB_USERNAME_DEVOPS_01=devops_ai_001
GITHUB_TOKEN_DEVOPS_01=ghp_xxxxxxxxxxxxxxxxxxxx

# =============================================================================
# AI 工具 API 密鑰
# =============================================================================

# Anthropic API 密鑰 (用于 Claude)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx

# Google Gemini API 密鑰
GEMINI_API_KEY=xxxxxxxxxxxxxxxxxxxx

# Rovo Dev CLI 配置 (AI coding agent)
ROVO_DEV_EMAIL=your-email@example.com
ROVO_DEV_TOKEN=rovo_xxxxxxxxxxxxxxxxxxxx

# =============================================================================
# 容器配置
# =============================================================================

# VNC 密码配置
VNC_PASSWORD_PM_01=vnc123
VNC_PASSWORD_BACKEND_01=vnc123
VNC_PASSWORD_FRONTEND_01=vnc123
VNC_PASSWORD_DEVOPS_01=vnc123

# TTYD 终端密码配置
TTYD_PASSWORD_PM_01=MyTerminalPassword123
TTYD_PASSWORD_BACKEND_01=MyTerminalPassword123
TTYD_PASSWORD_FRONTEND_01=MyTerminalPassword123
TTYD_PASSWORD_DEVOPS_01=MyTerminalPassword123

# =============================================================================
# 基本配置
# =============================================================================

# 应用环境
NODE_ENV=production
DEBUG=false

# 时区设置
TZ=UTC

# 语言设置
LANG=en_US.UTF-8

# =============================================================================
# GitHub Actions 配置
# =============================================================================

# 任务扫描间隔 (秒)
TASK_SCAN_INTERVAL=30

# 最大并发任务数
MAX_CONCURRENT_TASKS=10

# 任务超时时间 (秒)
TASK_TIMEOUT=3600
```

### 2. AI 工具配置

#### Anthropic Claude
- **用途**: 代码生成、需求分析、文档编写
- **配置**: 设置 `ANTHROPIC_API_KEY` 环境变量
- **使用角色**: 所有 AI 角色

#### Google Gemini
- **用途**: 代码审查、架构设计、问题解决
- **配置**: 设置 `GEMINI_API_KEY` 环境变量
- **使用角色**: 所有 AI 角色
- **优先级**: 优先使用

#### Rovo Dev CLI
- **用途**: AI coding agent，代码生成、项目脚手架、开发工具
- **配置**: 设置 `ROVO_DEV_EMAIL` 和 `ROVO_DEV_TOKEN`
- **使用角色**: 所有 AI 角色都可以使用
- **优先级**: 优先使用 Gemini CLI，然后可以与其他工具互换
- **初始化**: 需要手动初始化配置

### 3. Rovo Dev CLI 初始化配置

```bash
# 1. 安装 Rovo Dev CLI (如果尚未安装)
npm install -g @rovo/cli

# 2. 初始化配置
rovo init

# 3. 输入邮箱和 token
# Email: your-email@example.com
# Token: rovo_xxxxxxxxxxxxxxxxxxxx

# 4. 验证配置
rovo auth test

# 5. 测试连接
rovo --help
```

**注意**: Rovo Dev CLI 需要手动初始化一次，之后会在本地保存配置信息。

#### Google Gemini
- **用途**: 代码审查、架构设计、问题解决
- **配置**: 设置 `GEMINI_API_KEY` 环境变量
- **使用角色**: 所有 AI 角色

#### Rovo Dev CLI
- **用途**: AI coding agent，代码生成、项目脚手架、开发工具
- **配置**: 设置 `ROVO_DEV_EMAIL` 和 `ROVO_DEV_TOKEN`
- **使用角色**: 所有 AI 角色都可以使用
- **优先级**: 优先使用 Gemini CLI，然后可以与其他工具互换
- **初始化**: 需要手动初始化配置

## GitHub 配置

### 1. 创建 GitHub 仓库

```bash
# 创建新仓库
gh repo create your-org/education-game --public --description "Education Game Project using Bee Swarm"

# 克隆仓库
git clone https://github.com/your-org/education-game.git
cd education-game
```

### 2. 设置 GitHub Secrets

在 GitHub 仓库设置中添加以下 secrets：

- `GITHUB_TOKEN_PM_01`: 产品经理的 GitHub Token
- `GITHUB_TOKEN_BACKEND_01`: 后端开发者的 GitHub Token
- `GITHUB_TOKEN_FRONTEND_01`: 前端开发者的 GitHub Token
- `GITHUB_TOKEN_DEVOPS_01`: DevOps 工程师的 GitHub Token
- `ANTHROPIC_API_KEY`: Anthropic API 密钥
- `GEMINI_API_KEY`: Gemini API 密钥
- `ROVO_DEV_EMAIL`: Rovo Dev CLI 邮箱
- `ROVO_DEV_TOKEN`: Rovo Dev CLI Token (AI coding agent)

### 3. 创建 GitHub Projects

创建项目看板来管理任务：

```bash
# 使用 GitHub CLI 创建项目
gh project create "Education Game Development" --owner your-org --repository education-game
```

## 系统启动

### 1. 验证配置

```bash
# 验证环境变量配置
python3 scripts/validate_config.py

# 验证 Rovo Dev CLI 配置
rovo auth test

# 验证所有 AI 工具连接
echo "验证 Anthropic Claude API..."
curl -H "Authorization: Bearer $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/messages

echo "验证 Google Gemini API..."
curl -H "Authorization: Bearer $GEMINI_API_KEY" https://generativelanguage.googleapis.com/v1beta/models
```

### 2. 启动系统

```bash
# 启动生产环境
./scripts/switch_env.sh production

# 或启动测试环境
./scripts/switch_env.sh test
```

### 3. 检查状态

```bash
# 检查容器状态
docker-compose ps

# 检查系统健康状态
python3 scripts/check_system_health.py

# 查看日志
docker-compose logs -f
```

## 访问地址

启动后，可以通过以下地址访问各个 AI 角色的工作环境：

- **Product Manager**: http://localhost:6080
- **Backend Developer**: http://localhost:6081
- **Frontend Developer**: http://localhost:6082
- **DevOps Engineer**: http://localhost:6083

## 故障排除

### 常见问题

1. **配置验证失败**
   - 检查环境变量是否正确设置
   - 确认 API 密钥是否有效
   - 验证 GitHub Token 权限

2. **容器启动失败**
   - 检查 Docker 服务状态
   - 查看容器日志
   - 确认端口是否被占用

3. **网络连接问题**
   - 检查防火墙设置
   - 确认网络配置
   - 验证 DNS 解析

4. **Rovo Dev CLI 配置问题**
   - 检查邮箱和 token 是否正确
   - 重新运行 `rovo init` 初始化
   - 验证 `rovo auth test` 连接
   - 检查网络连接和代理设置

### 调试命令

```bash
# 查看详细日志
docker-compose logs --tail=100 -f

# 进入容器调试
docker-compose exec pm-01 bash

# 检查网络连接
docker network inspect bee_swarm_bee-swarm-network
```

## 下一步

环境配置完成后，可以开始：

1. [需求分析](../02-requirements/requirements-analysis.md)
2. [系统架构设计](../03-architecture/system-architecture.md)
3. [开发流程规划](../04-development/development-workflow.md) 