# 📚 Bee Swarm 專案文檔索引

## 📋 文檔信息
- **目標讀者**：所有用戶（新手、開發者、管理者、研究者）
- **最後更新**：2025年7月
- **文檔版本**：2.0 (重組後)
- **導航作用**：專案中央導航頁，提供不同角色的閱讀路徑

## 🚀 快速開始

### ⚡ 5分鐘快速了解
1. 閱讀 [核心理念](CONTEXT.md) - 了解 Bee Swarm 是什麼
2. 查看 [快速開始](QUICK_START.md) - 選擇適合的體驗路徑
3. 根據您的角色，選擇下方對應的學習路徑

### 🎯 角色導向的學習路徑

| 角色 | 適合人群 | 學習時間 | 入門指南 | 深入學習 |
|------|----------|----------|----------|----------|
| 🆕 **新手用戶** | 第一次接觸項目，想了解基本概念 | 15 分鐘 | [新手指南](docs/01-getting-started/for-beginners.md) | [核心理念](CONTEXT.md) |
| 🛠️ **開發者** | 想要實施和部署系統的技術人員 | 30 分鐘 | [開發者指南](docs/01-getting-started/for-developers.md) | [架構設計](docs/02-architecture/) |
| 🔬 **研究者** | 對 AI 協作理論感興趣的學者 | 45 分鐘 | [研究者指南](docs/01-getting-started/for-researchers.md) | [模擬分析](docs/05-simulation/) |
| 📊 **管理者** | 負責項目管理和決策的管理人員 | 20 分鐘 | [管理者指南](docs/01-getting-started/for-managers.md) | [應用案例](docs/04-use-cases/) |

## 📖 完整文檔結構

### 🎯 核心文檔
| 文檔 | 說明 | 目標讀者 | 重要性 |
|------|------|----------|--------|
| **[CONTEXT.md](CONTEXT.md)** | 專案核心理念與約束 | 所有用戶 | ⭐⭐⭐ |
| **[QUICK_START.md](QUICK_START.md)** | 快速開始指南（多路徑） | 所有用戶 | ⭐⭐⭐ |
| **[CHANGELOG.md](CHANGELOG.md)** | 專案變更歷史 | 所有用戶 | ⭐⭐ |

### 📚 入門指南 (`docs/01-getting-started/`)
- **[for-beginners.md](docs/01-getting-started/for-beginners.md)** - 完全新手的15分鐘入門
- **[for-developers.md](docs/01-getting-started/for-developers.md)** - 開發者技術實施指南  
- **[for-managers.md](docs/01-getting-started/for-managers.md)** - 管理者項目評估指南
- **[for-researchers.md](docs/01-getting-started/for-researchers.md)** - 研究者學術分析指南

### 🏗️ 架構設計 (`docs/02-architecture/`)
- **[hybrid-architecture.md](docs/02-architecture/hybrid-architecture.md)** - 混合架構設計說明
- **[role-design.md](docs/02-architecture/role-design.md)** - AI 角色抽象設計
- **[communication-patterns.md](docs/02-architecture/communication-patterns.md)** - 通信協調模式

### 🔧 實施指南 (`docs/03-implementation/`)
- **[configuration-guide.md](docs/03-implementation/configuration-guide.md)** - 環境配置指南
- **[deployment-guide.md](docs/03-implementation/deployment-guide.md)** - 部署運維指南
- **[gemini-cli-best-practices.md](docs/03-implementation/gemini-cli-best-practices.md)** - Gemini CLI 最佳實踐

### 💼 應用案例 (`docs/04-use-cases/`)
- **[education-game-project.md](docs/04-use-cases/education-game-project.md)** - 教育遊戲項目完整案例分析

### 🔬 模擬驗證 (`docs/05-simulation/`)
- **[simulator-guide.md](docs/05-simulation/simulator-guide.md)** - SimPy 模擬器使用指南
- **[analysis-guide.md](docs/05-simulation/analysis-guide.md)** - 協作效果分析方法
- **[scripts/](docs/05-simulation/scripts/)** - 模擬腳本和工具

## 🛣️ 推薦學習路線

### 路線一：概念理解 (所有角色適用)
```
CONTEXT.md (5分鐘) 
    ↓
對應角色入門指南 (15-45分鐘)
    ↓
QUICK_START.md 體驗 (10分鐘)
```

### 路線二：技術實施 (開發者)
```
for-developers.md (30分鐘)
    ↓
docs/02-architecture/ (60分鐘)
    ↓
docs/03-implementation/ (90分鐘)
    ↓
實際部署體驗
```

### 路線三：學術研究 (研究者)
```
for-researchers.md (45分鐘)
    ↓
docs/02-architecture/ (60分鐘)
    ↓
docs/05-simulation/ (120分鐘)
    ↓
docs/04-use-cases/ (60分鐘)
```

### 路線四：項目評估 (管理者)
```
for-managers.md (20分鐘)
    ↓
docs/04-use-cases/ (30分鐘)
    ↓
QUICK_START.md 概念路徑 (5分鐘)
    ↓
部署成本評估
```

## 🎯 快速導航

### 💡 我想要...

#### 🔍 快速了解項目價值
- **時間**：5 分鐘
- **路徑**：[CONTEXT.md](CONTEXT.md) → [核心理念部分](CONTEXT.md#核心理念)
- **目標**：理解項目解決的問題和核心價值

#### 🛠️ 立即動手實踐
- **時間**：10 分鐘  
- **路徑**：[QUICK_START.md](QUICK_START.md) → [容器完整部署](QUICK_START.md#-路徑三容器完整部署)
- **目標**：在本地運行完整的 Bee Swarm 系統

#### 📚 深入技術架構
- **時間**：2 小時
- **路徑**：[開發者指南](docs/01-getting-started/for-developers.md) → [架構設計](docs/02-architecture/) → [實施指南](docs/03-implementation/)
- **目標**：掌握完整的技術實施方案

#### 🔬 學術研究分析
- **時間**：3 小時
- **路徑**：[研究者指南](docs/01-getting-started/for-researchers.md) → [模擬分析](docs/05-simulation/) → [案例研究](docs/04-use-cases/)
- **目標**：理解 AI 協作的科學原理和驗證方法

#### 📊 項目管理評估
- **時間**：1 小時
- **路徑**：[管理者指南](docs/01-getting-started/for-managers.md) → [應用案例](docs/04-use-cases/) → [部署成本](docs/03-implementation/deployment-guide.md)
- **目標**：評估項目的商業價值和實施成本

## 🔧 實際配置

### AI 角色配置
- **[roles/](roles/)** - AI 角色容器配置
  - `product_manager/` - 產品經理角色（Claude Code）
  - `backend_developer/` - 後端開發者（Gemini CLI）
  - `frontend_developer/` - 前端開發者（Gemini CLI）
  - `devops_engineer/` - DevOps 工程師（Gemini CLI）

### 腳本工具
- **[scripts/](scripts/)** - 部署和管理腳本
  - `role-management.sh` - 角色管理腳本

## 🆘 需要幫助？

### 🔍 常見情況
| 情況 | 建議資源 | 預計解決時間 |
|------|----------|-------------|
| **完全新手，不知道從哪開始** | [新手指南](docs/01-getting-started/for-beginners.md) | 15分鐘 |
| **想快速體驗系統** | [QUICK_START.md](QUICK_START.md) | 5-10分鐘 |
| **技術實施遇到問題** | [故障排除](docs/03-implementation/deployment-guide.md#故障排除) | varies |
| **想了解學術背景** | [研究者指南](docs/01-getting-started/for-researchers.md) | 45分鐘 |
| **評估商業價值** | [管理者指南](docs/01-getting-started/for-managers.md) + [案例分析](docs/04-use-cases/) | 1小時 |

### 📞 獲取支持
- **快速問題**：查看對應文檔的FAQ部分
- **技術問題**：查看 [deployment-guide.md](docs/03-implementation/deployment-guide.md) 故障排除
- **深入討論**：創建 [GitHub Issue](../../issues)

### 🎯 選擇困難症？
如果您不確定從哪裡開始，請根據您的主要目標選擇：

1. **我是產品經理/項目負責人** → [管理者指南](docs/01-getting-started/for-managers.md)
2. **我要實際部署這個系統** → [開發者指南](docs/01-getting-started/for-developers.md)  
3. **我在做相關學術研究** → [研究者指南](docs/01-getting-started/for-researchers.md)
4. **我只是想快速了解一下** → [新手指南](docs/01-getting-started/for-beginners.md)

## 📈 文檔使用統計

### 熱門文檔排行
1. [QUICK_START.md](QUICK_START.md) - 快速開始
2. [CONTEXT.md](CONTEXT.md) - 核心理念  
3. [for-developers.md](docs/01-getting-started/for-developers.md) - 開發者指南
4. [hybrid-architecture.md](docs/02-architecture/hybrid-architecture.md) - 架構設計
5. [education-game-project.md](docs/04-use-cases/education-game-project.md) - 案例分析

### 建議閱讀順序
對於大多數用戶，我們建議按以下順序閱讀：
1. 先閱讀您角色對應的入門指南
2. 如果感興趣，深入相關的專門文檔
3. 查看實際案例來理解具體應用
4. 必要時參考技術實施文檔

---

## 🎉 開始您的 Bee Swarm 探索之旅！

選擇上方任意入口開始，我們為每種不同的需求和背景都準備了對應的學習路徑。

**第一次使用？** 推薦從您的角色對應指南開始：[新手](docs/01-getting-started/for-beginners.md) | [開發者](docs/01-getting-started/for-developers.md) | [管理者](docs/01-getting-started/for-managers.md) | [研究者](docs/01-getting-started/for-researchers.md)

---

*最後更新：2025年7月 | 專案導航總時間：2-5分鐘 | 文檔總覆蓋：100%專案內容* 