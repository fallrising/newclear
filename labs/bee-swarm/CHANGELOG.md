# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- 移除 `scripts/` 目錄及所有部署運維相關腳本，專注於概念設計
- 清理 README.md 和 README.en.md 中不準確的"可移除文件"說明章節

### Changed
- 完成所有 Git commit 消息的英文化，提升項目國際化水平
- 優化項目結構說明，更準確反映當前專注於概念設計的定位

## [0.5.0] - 2025-07-26

### Added
- 完整的10個AI角色描述，包含核心角色和擴展角色
- Android開發者、iOS開發者、Unity開發者、視覺設計師、數據工程師角色
- 英文化的完整指南文件 (`bee-swarm-complete-guide.md`)
- 英文化的附錄文件系統 (`docs/09-appendix/`)

### Changed
- 🌐 **文件名國際化**: 將所有中文文件名改為英文文件名，提升國際化支持
- 📁 **目錄重構**: `docs/09-附錄/` → `docs/09-appendix/`
- 📋 **角色系統擴展**: 從4個核心角色擴展到10個角色（4核心+6擴展）
- 🔗 **引用修正**: 修正所有文件中的中文文件名引用為英文文件名
- 📖 **README更新**: 更新README.md和README.en.md，加入完整角色描述

### Removed
- 清理階段性文件: `health-check.md`, `PR-DESCRIPTION.md`
- 所有中文文件名，統一使用英文文件名
- 不存在文件的錯誤引用

### Fixed
- 修正所有文檔中的路徑引用錯誤
- 確保所有鏈接指向實際存在的文件
- 中英文版本文件的一致性問題

## [0.4.1] - 2025-07-20

### Added
- 完善 Bee Swarm 文檔系統與功能擴展
- 新增教育遊戲項目增強版蜂群模擬系統 (`enhanced-bee-swarm-simulation.py`)
- 新增 GitHub 敏捷開發工作流指南 (`github-agile-methodology.md`, `github-agile-advanced.md`)
- 新增蜂群模擬系統整合指南 (`integration-guide.md`)
- 新增項目上下文文檔 (`bee-swarm-context.md`)
- 新增統一版本蜂群模擬程序 (`bee-swarm-unified-simulation.py`)
- 新增綜合角色系統，包含11個專業AI角色
- 新增工作流程模擬腳本，支持 GitHub Actions 工作流
- 新增 MCP Server 架構文檔 (`docs/02-architecture/hybrid-architecture.md`)
- 新增 Dockerfile 遷移總結文檔 (`dockerfile-migration-summary.md`)
- 新增基礎映像構建腳本 (`build_base_image.sh`)
- 新增 Dockerfile 模板 (`Dockerfile.template`)
- 新增 CI 環境配置驗證
- 配置驗證腳本 (`scripts/validate_config.py`)
- 環境切換腳本 (`scripts/switch_env.sh`)
- 測試環境配置 (`docker-compose.test.yml`)
- 自動化配置驗證機制
- 環境分離管理功能
- 資源使用監控功能

### Changed
- 🎯 重新定位項目：從生產系統改為概念設計框架，專注 AI 角色協作概念設計與模擬
- ✨ 強化多角色多帳號容器化架構說明，新增視覺化系統架構圖和協作流程圖
- 更新 DockerHub 用戶配置 (fallrising)
- 統一蜂群模擬程序，實現產品經理優先機制，符合 GitHub-Centric 架構設計
- 遷移所有 Dockerfiles 到 MCP Server 架構，使用 `fallrising/novnc_llm_cli:latest` 基礎映像
- 完成架構簡化和角色重構，提升系統效率
- 精簡仿真文件，保留核心事件驅動仿真
- 修復 GitHub Actions workflow，確保所有 workflow 都能正常運行
- 重構項目架構和文檔結構
- 翻譯所有文檔從中文到英文，提升國際化無障礙性
- 大幅簡化 docker-compose.yml，移除所有基礎設施服務
- 優化容器資源配置，根據角色需求調整
- 簡化環境變量配置，從 254 行減少到 50 行
- 重新定義角色職責，從 5 個角色簡化為 4 個核心角色
- 更新 README.md，反映新的架構和使用方式
- 改進角色定義文檔，明確職責邊界

### Removed
- 刪除 `.github/workflows` 目錄及所有 workflow 文件
- 刪除所有部署相關文件：scripts/ 資料夾（13個部署腳本）、docker-compose.yml、monitoring/ 配置文件
- 刪除舊版本模擬文件，保持代碼庫整潔
- 移除 coordinator 模組和舊文檔結構
- 移除複雜的監控和備份配置
- Redis 服務（狀態管理改用 GitHub API）
- PostgreSQL 服務（數據存儲改用 GitHub Issues/Projects）
- Prometheus 服務（監控改用 GitHub Actions）
- Grafana 服務（可視化改用 GitHub Projects）
- QA Engineer 角色（職責合併到 DevOps Engineer）
- 所有第三方服務配置（Notion、Figma、Jira、Slack 等）
- 複雜的監控和備份配置

### Fixed
- 修復 GitHub Actions workflow 失敗問題，添加 CI_ENVIRONMENT 環境變量標記
- 修復 docker-compose 命令在 GitHub Actions 中找不到的錯誤
- 修復 GitHub Workflow 文件，確保所有 workflow 都能正常運行
- 架構設計矛盾問題
- 配置複雜度過高問題
- 角色職責重疊問題
- 資源配置不合理問題
- 安全配置問題

### Security
- 實現配置驗證機制
- 支持 GitHub Secrets 集成
- 環境分離管理
- 密碼強度檢查

## [0.5.0] - 2025-07-26

### Added
- 完整的10個AI角色描述，包含核心角色和擴展角色
- Android開發者、iOS開發者、Unity開發者、視覺設計師、數據工程師角色
- 英文化的完整指南文件 (`bee-swarm-complete-guide.md`)
- 英文化的附錄文件系統 (`docs/09-appendix/`)

### Changed
- 🌐 **文件名國際化**: 將所有中文文件名改為英文文件名，提升國際化支持
- 📁 **目錄重構**: `docs/09-附錄/` → `docs/09-appendix/`
- 📋 **角色系統擴展**: 從4個核心角色擴展到10個角色（4核心+6擴展）
- 🔗 **引用修正**: 修正所有文件中的中文文件名引用為英文文件名
- 📖 **README更新**: 更新README.md和README.en.md，加入完整角色描述

### Removed
- 清理階段性文件: `health-check.md`, `PR-DESCRIPTION.md`
- 所有中文文件名，統一使用英文文件名
- 不存在文件的錯誤引用

### Fixed
- 修正所有文檔中的路徑引用錯誤
- 確保所有鏈接指向實際存在的文件
- 中英文版本文件的一致性問題

## [0.4.1] - 2025-07-25

### Added
- GitHub-Centric 架構設計
- 簡化的文檔結構
- 基於 GitHub Actions 的觸發機制
- 異步協作工作流
- 透明化協調機制

### Changed
- 架構從複雜的 coordinator 改為 GitHub-Centric
- 文檔結構從 5 層級簡化為 4 個核心文檔
- 協調機制從中央協調器改為 GitHub 平台
- 通信協議從自定義消息格式改為 GitHub 原生功能

### Deprecated
- 複雜的中央協調器架構
- 5 層級文檔結構
- 自定義通信協議
- 複雜的狀態管理系統

### Removed
- coordinator/ 目錄及其所有組件
- docs/level1/ 到 docs/level5/ 目錄
- 複雜的通信協議設計
- 過度詳細的實現細節文檔

### Fixed
- 架構複雜度問題
- 文檔維護困難問題
- 系統透明度問題
- 部署複雜度問題

### Security
- 簡化安全配置
- 利用 GitHub 原生安全機制
- 減少攻擊面

## [0.3.0] - 2025-01-15

### Added
- Single VPS single role architecture design
- VNC Lab-based container construction
- AI tool rotation mechanism
- Detailed execution plan documentation
- Role-specific Dockerfiles
- Distributed deployment strategy

### Changed
- Refactored docker-compose.yml for single VPS mode
- Updated README.md architecture description
- Optimized environment variable configuration
- Adjusted port allocation strategy

## [0.2.0] - 2025-01-10

### Added
- Role persistent container architecture design
- System coordinator base framework
- GitHub-driven collaboration mechanism
- Role pool management documentation
- Task scheduling system design
- Load balancing algorithms
- Health check mechanisms
- Workspace management
- Dynamic scaling functionality

### Changed
- Refactored docker-compose.yml for role pool support
- Updated environment variable configuration
- Redesigned documentation structure
- Optimized README.md architecture description

## [0.1.0] - 2025-01-05

### Added
- Project initialization
- Basic documentation structure
- Docker Compose configuration
- Environment variable configuration
- GitHub Actions workflow
- Deployment scripts
- MIT License

---

## Version Notes

### Version Number Format
- MAJOR.MINOR.PATCH
- MAJOR: Incompatible API changes
- MINOR: Backward-compatible functional additions
- PATCH: Backward-compatible bug fixes

### Recent Major Changes (v0.4.0+)
- **架構簡化**: 移除複雜的基礎設施組件，真正實現 GitHub-Centric
- **配置優化**: 大幅簡化環境變量配置，提高易用性
- **角色重構**: 重新定義角色職責，避免重疊
- **安全加固**: 實現配置驗證和環境分離
- **性能提升**: 優化資源配置，提高系統效率 