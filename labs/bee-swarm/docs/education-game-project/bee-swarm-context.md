# Bee Swarm 项目上下文与约束

## 🎯 项目概述

Bee Swarm 是一个基于 GitHub 的 AI 团队协作自动化工作流系统，采用 **GitHub-Centric** 架构，通过 GitHub 的现有功能实现 AI 角色之间的协调和通信。

## 📋 Context (上下文)

### 核心理念
- **简化优先**: 移除复杂的中央协调器，利用 GitHub 现有功能
- **透明性**: 所有协调过程在 GitHub 上可见，完整的版本控制历史
- **异步协作**: AI 角色轮流处理任务，通过 GitHub 状态同步

### 技术架构
```
GitHub Platform (协调中心)
├── Issues (任务管理)
├── Projects (看板)
├── Actions (触发器)
├── Comments (通信)
├── Pull Requests (代码审查)
└── Wiki/README (文档)

    ↓

AI Containers (角色容器)
├── Product Manager (产品经理) - Claude Code
├── Backend Developer (后端开发者) - Gemini CLI
├── Frontend Developer (前端开发者) - Gemini CLI
└── DevOps Engineer (运维工程师) - Gemini CLI
```

### 工作流程
1. **需求输入**: 用户在 GitHub Issues 中描述需求
2. **自动触发**: GitHub Actions 定时扫描新任务
3. **角色分配**: 根据 issue labels 分配给合适的 AI 角色
4. **任务处理**: AI 容器启动并处理任务
5. **状态更新**: 通过 GitHub API 更新任务状态

## 🔒 Constraints (约束)

### 技术约束
1. **AI 工具限制**
   - 产品经理使用 Claude Code (Claude Pro)
   - 其他角色使用 Gemini CLI (免费额度)
   - AI coding agent CLI 需要避免人工确认

2. **基础设施约束**
   - 使用普通 VPS，非大厂云服务
   - 通过 Cloudflare Tunnel 提供 webhook 端点
   - 每个项目需要独立配置

3. **GitHub 约束**
   - 依赖 GitHub API 限制
   - 使用 GitHub Actions 定时触发
   - 通过 webhook 实现事件驱动

### 架构约束
1. **无中央协调器**
   - 移除复杂的中央协调组件
   - 利用 GitHub 现有功能
   - 最小化外部依赖

2. **角色职责边界**
   - 明确的角色职责分工
   - 避免职责重叠
   - 通过 GitHub 状态同步

3. **异步协作模式**
   - AI 角色轮流处理任务
   - 避免即时通信的复杂性
   - 通过 GitHub 状态管理

## 📝 Requirements (需求)

### 功能需求

#### 1. 核心 AI 角色
- **Product Manager**: 需求分析、任务分配、项目协调
- **Backend Developer**: API 设计、数据库设计、业务逻辑
- **Frontend Developer**: UI 界面、用户交互、前端功能
- **DevOps Engineer**: 部署、监控、测试、运维

#### 2. 自动化工作流
- GitHub Actions 定时触发 (每30分钟)
- 事件驱动的任务处理
- 自动化的代码审查和部署
- 透明的协作过程

#### 3. 任务管理
- 基于 GitHub Issues 的任务分配
- 智能的任务分解和分配
- 实时的进度跟踪
- 完整的审计轨迹

### 非功能需求

#### 1. 性能要求
- 快速的任务响应时间
- 高效的资源利用
- 稳定的系统运行
- 可扩展的架构设计

#### 2. 安全要求
- 安全的 API 密钥管理
- 网络隔离和访问控制
- 完整的操作审计
- 数据保护和隐私

#### 3. 可用性要求
- 高可用性设计
- 故障恢复机制
- 监控和告警
- 用户友好的界面

### 部署需求

#### 1. 基础设施
- 普通 VPS 部署
- Docker 容器化
- Cloudflare Tunnel 配置
- GitHub Actions 集成

#### 2. 配置管理
- 环境变量配置
- GitHub Secrets 管理
- 角色配置文件
- 自动化部署脚本

#### 3. 监控运维
- 系统状态监控
- 日志收集和分析
- 性能指标跟踪
- 故障诊断和修复

## 🎯 设计原则

### 1. 简化优先
- 移除不必要的复杂性
- 利用现有成熟工具
- 最小化维护成本

### 2. 透明性
- 所有过程在 GitHub 上可见
- 完整的版本控制历史
- 清晰的审计轨迹

### 3. 可扩展性
- 支持添加新的 AI 角色
- 灵活的配置管理
- 模块化的架构设计

### 4. 可靠性
- 稳定的系统运行
- 完善的错误处理
- 自动化的故障恢复

## 📊 成功指标

### 技术指标
- 任务完成率 > 90%
- 系统可用性 > 99%
- 响应时间 < 30分钟
- 错误率 < 5%

### 业务指标
- 开发效率提升 > 50%
- 协作成本降低 > 30%
- 项目交付时间缩短 > 40%
- 代码质量提升 > 25%

### 运维指标
- 部署成功率 > 95%
- 故障恢复时间 < 1小时
- 配置错误率 < 2%
- 资源利用率 > 80%

---

*本文档定义了 Bee Swarm 项目的核心上下文、约束和需求，为系统设计和实现提供指导。* 