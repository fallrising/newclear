# 使用指南

## 概述

本文档说明如何使用 Bee Swarm 系统和相关文档来开发模拟养成小孩学习考大学的游戏项目。

## 快速开始

### 1. 环境准备
```bash
# 克隆 bee_swarm 项目
git clone https://github.com/your-org/bee_swarm.git
cd bee_swarm

# 配置环境变量
cp env.example .env
# 编辑 .env 文件，配置以下内容：
# - GitHub 仓库信息
# - AI 角色 GitHub Token
# - Anthropic API Key
# - Google Gemini API Key
# - Rovo Dev CLI 邮箱和 Token (AI coding agent)
```

### 2. 启动 Bee Swarm 系统
```bash
# 验证配置
python3 scripts/validate_config.py

# 启动系统
./scripts/switch_env.sh production

# 检查状态
docker-compose ps
```

### 3. 创建项目仓库
```bash
# 创建 GitHub 仓库
gh repo create your-org/education-game --public

# 设置 GitHub Secrets
# 在仓库设置中添加所有必要的 secrets
```

## 开发流程

### 第一阶段：可行性分析
1. **阅读可行性分析文档**: `00-feasibility-analysis/execution-plan.md`
2. **启动产品经理容器**: 按照 `01-project-setup/product-manager-setup.md` 配置
3. **进行项目可行性评估**: 确认项目是否值得启动

### 第二阶段：流程仿真
1. **阅读仿真模型文档**: `09-process-simulation/simulation-overview.md`
2. **运行仿真脚本**: 执行 `09-process-simulation/simulation_script.py`
3. **分析仿真结果**: 查看 `09-process-simulation/simulation-analysis.md`

### 第三阶段：需求分析
1. **阅读需求分析文档**: `02-requirements/requirements-analysis.md`
2. **确认项目范围**: 与 Product Manager AI 确认需求
3. **任务分解**: 查看 `02-requirements/task-breakdown.md`

### 第四阶段：架构设计
1. **系统架构**: 查看 `03-architecture/system-architecture.md`
2. **技术选型**: 确认技术栈和工具
3. **数据库设计**: 确认数据模型

### 第五阶段：开发实现
1. **环境搭建**: 按照 `01-project-setup/environment-config.md` 配置
2. **并行开发**: 
   - Backend Developer: 开发 API
   - Frontend Developer: 开发界面
   - DevOps Engineer: 搭建基础设施
3. **代码审查**: 通过 GitHub PR 进行代码审查

### 第六阶段：测试部署
1. **自动化测试**: 运行测试套件
2. **部署配置**: 按照 `05-deployment/deployment-guide.md` 部署
3. **监控配置**: 设置监控和告警

## AI 角色协作

### AI 工具使用策略
- **优先级**: 优先使用 Gemini CLI，然后可以与其他工具互换
- **工具互换**: 所有 AI 角色都可以使用 Gemini CLI、Claude Code、Rovo Dev CLI
- **未来扩展**: 计划接入其他 LLM API，如 OpenRouter 等
- **配置要求**: Rovo Dev CLI 需要手动初始化配置

### Product Manager
- **职责**: 需求分析、任务分解、进度追踪
- **工具**: Gemini CLI, Claude Code, Rovo Dev CLI
- **工作流程**: 通过 GitHub Issues 管理任务

### Backend Developer
- **职责**: API 开发、数据库设计、业务逻辑
- **工具**: Gemini CLI, Claude Code, Rovo Dev CLI, Cursor
- **工作流程**: 开发 API，创建 PR

### Frontend Developer
- **职责**: 界面开发、用户体验、响应式设计
- **工具**: Gemini CLI, Claude Code, Rovo Dev CLI, Cursor, Warp
- **工作流程**: 开发界面，创建 PR

### DevOps Engineer
- **职责**: 部署、监控、运维、安全
- **工具**: Gemini CLI, Claude Code, Rovo Dev CLI, GitHub Actions, Docker, Prometheus, Grafana
- **工作流程**: 自动化部署，监控系统

## 数据管理

### 数据策略
- **存储**: PostgreSQL (主数据库) + Redis (缓存)
- **备份**: 自动备份策略
- **安全**: 数据加密、访问控制
- **隐私**: GDPR 合规

### 数据流程
1. **数据收集**: 用户输入、系统生成
2. **数据处理**: 验证、转换、存储
3. **数据使用**: 业务逻辑、统计分析
4. **数据保护**: 加密、备份、清理

## 质量保证

### 代码质量
- **测试覆盖率**: > 80%
- **代码审查**: 所有代码必须通过 PR 审查
- **自动化检查**: ESLint, TypeScript, 安全扫描

### 性能标准
- **API 响应时间**: < 200ms
- **页面加载时间**: < 3s
- **系统可用性**: > 99.9%

### 安全标准
- **输入验证**: 100% 覆盖
- **数据加密**: 敏感数据加密
- **访问控制**: 基于角色的权限控制

## 监控运维

### 系统监控
- **应用监控**: Prometheus + Grafana
- **日志管理**: ELK Stack
- **告警机制**: 自动告警通知

### 故障处理
- **问题检测**: 自动检测系统问题
- **故障恢复**: 自动恢复流程
- **数据备份**: 定期备份和恢复测试

## 最佳实践

### 开发实践
1. **代码规范**: 遵循编码规范
2. **版本控制**: 使用 Git Flow
3. **持续集成**: 自动化构建和测试
4. **文档更新**: 及时更新文档

### 协作实践
1. **沟通机制**: 通过 GitHub Issues 和 Comments
2. **进度同步**: 定期同步开发进度
3. **知识分享**: 分享技术经验和最佳实践

### 安全实践
1. **安全开发**: 安全编码实践
2. **漏洞扫描**: 定期安全扫描
3. **权限管理**: 最小权限原则

## 常见问题

### 环境问题
**Q: 容器启动失败怎么办？**
A: 检查 Docker 服务状态，查看容器日志，确认环境变量配置

**Q: GitHub API 连接失败怎么办？**
A: 检查 GitHub Token 配置，确认网络连接，验证权限设置

**Q: Rovo Dev CLI 初始化失败怎么办？**
A: 检查邮箱和 token 是否正确，重新运行 `rovo init`，验证网络连接

### 开发问题
**Q: 如何添加新功能？**
A: 创建 GitHub Issue，分配给相应 AI 角色，按照开发流程进行

**Q: 如何处理代码冲突？**
A: 通过 GitHub PR 解决冲突，确保代码质量

### 部署问题
**Q: 部署失败怎么办？**
A: 检查部署日志，确认环境配置，验证服务依赖

**Q: 如何回滚部署？**
A: 使用 Docker 镜像回滚，恢复数据库备份

## 扩展开发

### 添加新功能
1. **需求分析**: 更新需求文档
2. **任务分解**: 添加新的开发任务
3. **架构设计**: 更新系统架构
4. **开发实现**: 按照开发流程实现

### 性能优化
1. **性能分析**: 识别性能瓶颈
2. **优化方案**: 制定优化策略
3. **实施优化**: 实施优化措施
4. **效果验证**: 验证优化效果

### 安全加固
1. **安全评估**: 评估安全风险
2. **加固方案**: 制定加固方案
3. **实施加固**: 实施安全措施
4. **安全测试**: 进行安全测试

## 下一步

1. **开始开发**: 按照文档开始项目开发
2. **持续改进**: 根据实际情况调整流程
3. **知识积累**: 积累开发经验和最佳实践
4. **团队扩展**: 根据需要扩展 AI 角色

---

*本指南帮助你快速上手 Bee Swarm 系统，开始教育游戏项目的开发。* 