# 模拟养成小孩学习考大学游戏项目

## 项目概述

本项目使用 Bee Swarm AI 团队协作系统开发一个模拟养成小孩学习考大学的 Web 游戏。通过 AI 角色的协作，实现从需求分析到部署上线的完整开发流程。

## 项目目标

- 开发一个教育类模拟养成游戏
- 展示 Bee Swarm 系统的实际应用
- 实践 AI 团队协作开发流程
- 建立完整的软件工程最佳实践

## 技术栈

### 前端
- React 18 + TypeScript
- Tailwind CSS
- Framer Motion (动画)
- React Query (状态管理)

### 后端
- Node.js + Express
- TypeScript
- PostgreSQL (数据库)
- Redis (缓存)

### DevOps
- Docker + Docker Compose
- GitHub Actions (CI/CD)
- Prometheus + Grafana (监控)
- Nginx (反向代理)

## 项目结构

```
docs/education-game-project/
├── README.md                    # 项目概述
├── 00-feasibility-analysis/    # 可行性分析
├── 01-project-setup/           # 项目初始化
├── 02-requirements/            # 需求分析
├── 03-architecture/            # 系统架构
├── 04-development/             # 开发流程
├── 05-deployment/              # 部署配置
├── 06-monitoring/              # 监控运维
├── 07-data-management/         # 数据管理
├── 08-best-practices/          # 最佳实践
└── 09-process-simulation/      # 流程仿真
```

## AI 工具策略

### 工具配置
- **主要工具**: Gemini CLI (优先使用)
- **辅助工具**: Claude Code, Rovo Dev CLI
- **工具互换**: 所有角色都可以使用多种工具
- **未来扩展**: 计划接入 OpenRouter 等更多 LLM API

### 配置要求
- **Gemini CLI**: 需要 GEMINI_API_KEY
- **Claude Code**: 需要 ANTHROPIC_API_KEY  
- **Rovo Dev CLI**: 需要邮箱和 token，需要手动初始化

## AI 角色分工

### Product Manager (产品经理)
- 需求分析和分解
- 项目管理和进度追踪
- 产品规划和路线图
- 团队协调和沟通

### Backend Developer (后端开发者)
- API 设计和实现
- 数据库设计和优化
- 业务逻辑开发
- 性能优化

### Frontend Developer (前端开发者)
- UI 界面开发
- 用户交互实现
- 响应式设计
- 前端性能优化

### DevOps Engineer (运维工程师)
- 自动化部署
- 环境管理
- 监控和日志
- 测试和质量保证

## 开发流程

1. **可行性分析** → 产品经理进行项目可行性分析
2. **流程仿真** → 使用 SimPy 模拟开发流程和角色协作
3. **项目初始化** → 环境配置和系统启动
4. **需求分析** → 产品经理分析用户需求
5. **架构设计** → 设计系统架构和技术方案
6. **开发实现** → 前后端并行开发
7. **测试部署** → 自动化测试和部署
8. **监控运维** → 系统监控和问题处理

## 预期成果

- 完整的 Web 游戏应用
- 可复用的开发流程文档
- AI 团队协作最佳实践
- 完整的监控和运维体系

---

*本项目使用 Bee Swarm 系统进行开发，所有协作过程都在 GitHub 平台上进行。* 