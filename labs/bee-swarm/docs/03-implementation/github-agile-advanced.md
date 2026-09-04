# GitHub 全功能敏捷開發工作流擴展

> **前置閱讀**：建議先閱讀 [GitHub 敏捷開發工作流指南](./github-agile-methodology.md) 了解基礎概念

## 📚 GitHub Wiki 集成

### **文檔分層架構**
```
Home (首頁)
├── Product Documentation
│   ├── Epic-Requirements (Epic需求文檔)
│   ├── User-Stories (用戶故事集)
│   └── Acceptance-Criteria (驗收標準)
├── Technical Documentation  
│   ├── Architecture-Overview (架構概覽)
│   ├── API-Documentation (API文檔)
│   ├── Database-Schema (數據庫設計)
│   └── Development-Guidelines (開發規範)
├── Process Documentation
│   ├── Definition-of-Done (完成定義)
│   ├── Coding-Standards (編碼標準)
│   └── Review-Process (審查流程)
└── Sprint Documentation
    ├── Sprint-Planning-Notes (Sprint規劃)
    ├── Retrospective-Actions (回顧行動)
    └── Release-Notes (發布說明)
```

### **Wiki 自動化更新**
```yaml
# .github/workflows/wiki-sync.yml
name: Sync Wiki with Issues
on:
  issues:
    types: [opened, edited, closed]
  
jobs:
  update-wiki:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Wiki
        uses: actions/checkout@v3
        with:
          repository: ${{ github.repository }}.wiki
          token: ${{ secrets.GITHUB_TOKEN }}
          
      - name: Update Epic Documentation
        run: |
          # 當 Epic Issue 更新時自動同步到 Wiki
          if [[ "${{ github.event.issue.labels }}" == *"epic"* ]]; then
            echo "# ${{ github.event.issue.title }}" > "Epic-${{ github.event.issue.number }}.md"
            echo "${{ github.event.issue.body }}" >> "Epic-${{ github.event.issue.number }}.md"
          fi
          
      - name: Commit Changes
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add .
          git commit -m "Auto-update from Issue #${{ github.event.issue.number }}" || exit 0
          git push
```

## ⚙️ GitHub Actions 自動化工作流

### **1. Issue 生命週期管理**
```yaml
# .github/workflows/issue-management.yml
name: Issue Lifecycle Management
on:
  issues:
    types: [opened, edited, closed, labeled]
  issue_comment:
    types: [created]

jobs:
  epic-management:
    if: contains(github.event.issue.labels.*.name, 'epic')
    runs-on: ubuntu-latest
    steps:
      - name: Create Epic Template
        uses: actions/github-script@v6
        with:
          script: |
            // 當創建 Epic 時自動生成模板結構
            const epicTemplate = `
            ## 產品目標
            [描述這個 Epic 要解決的業務問題]
            
            ## 成功指標
            - [ ] 指標1
            - [ ] 指標2
            
            ## 相關 Issues
            - [ ] #xxx 功能A
            - [ ] #xxx 功能B
            
            ## 技術考量
            [架構、性能、安全等技術要求]
            `;
            
            if (!context.payload.issue.body.includes('## 產品目標')) {
              await github.rest.issues.update({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.payload.issue.number,
                body: context.payload.issue.body + epicTemplate
              });
            }

  story-points-automation:
    runs-on: ubuntu-latest
    steps:
      - name: Auto-assign Story Points
        uses: actions/github-script@v6
        with:
          script: |
            // 根據 Issue 複雜度自動估算故事點
            const body = context.payload.issue.body || '';
            const title = context.payload.issue.title || '';
            
            let points = 1;
            if (body.length > 500) points += 2;
            if (title.includes('API')) points += 1;
            if (title.includes('Database')) points += 2;
            if (body.includes('integration')) points += 3;
            
            await github.rest.issues.addLabels({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.issue.number,
              labels: [`story-points/${points}`]
            });
```

### **2. PR 自動化工作流**
```yaml
# .github/workflows/pr-automation.yml
name: PR Automation
on:
  pull_request:
    types: [opened, synchronize, closed]

jobs:
  pr-validation:
    runs-on: ubuntu-latest
    steps:
      - name: Check PR Requirements
        uses: actions/github-script@v6
        with:
          script: |
            const pr = context.payload.pull_request;
            
            // 檢查 PR 是否連結到 Issue
            if (!pr.body.includes('Closes #') && !pr.body.includes('Fixes #')) {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: pr.number,
                body: '⚠️ 此 PR 未連結到任何 Issue，請使用 "Closes #xxx" 格式連結相關 Issue。'
              });
            }
            
            // 自動分配審查者
            const files = await github.rest.pulls.listFiles({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: pr.number
            });
            
            const reviewers = [];
            const frontendFiles = files.data.some(f => f.filename.includes('frontend/'));
            const backendFiles = files.data.some(f => f.filename.includes('backend/'));
            
            if (frontendFiles) reviewers.push('frontend-lead');
            if (backendFiles) reviewers.push('backend-lead');
            
            if (reviewers.length > 0) {
              await github.rest.pulls.requestReviewers({
                owner: context.repo.owner,
                repo: context.repo.repo,
                pull_number: pr.number,
                reviewers: reviewers
              });
            }

  auto-merge:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - name: Update Related Issues
        uses: actions/github-script@v6
        with:
          script: |
            // PR 合併後自動更新相關 Issue 狀態
            const pr = context.payload.pull_request;
            const body = pr.body || '';
            
            // 提取連結的 Issue 編號
            const issueMatches = body.match(/(?:Closes|Fixes)\s+#(\d+)/gi);
            
            if (issueMatches) {
              for (const match of issueMatches) {
                const issueNumber = match.match(/\d+/)[0];
                
                await github.rest.issues.createComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: parseInt(issueNumber),
                  body: `✅ PR #${pr.number} 已合併，此功能開發完成。`
                });
                
                // 自動移動到測試階段
                await github.rest.issues.addLabels({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: parseInt(issueNumber),
                  labels: ['ready-for-test']
                });
              }
            }
```

### **3. 自動化測試和部署**
```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run Tests
        run: |
          npm test
          npm run test:e2e
          
      - name: Update Test Results
        if: failure()
        uses: actions/github-script@v6
        with:
          script: |
            // 測試失敗時自動創建 Bug Issue
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `🐛 測試失敗 - ${context.sha.substring(0, 7)}`,
              body: `自動化測試在提交 ${context.sha} 時失敗。\n\n請檢查測試結果：${context.payload.repository.html_url}/actions/runs/${context.runId}`,
              labels: ['bug', 'automated', 'priority-high']
            });

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Staging
        run: |
          # 部署到測試環境
          echo "Deploying to staging..."
          
      - name: Create Deployment Issue
        uses: actions/github-script@v6
        with:
          script: |
            // 部署完成後自動創建部署通知
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `🚀 Staging 部署完成 - ${new Date().toISOString().split('T')[0]}`,
              body: `新版本已部署到測試環境\n\n**變更內容:**\n${context.payload.head_commit.message}\n\n**測試環境:** https://staging.example.com\n\n請相關人員進行測試驗收。`,
              labels: ['deployment', 'staging'],
              assignees: ['product-manager', 'qa-lead']
            });
```

## 🔍 GitHub Advanced Security 集成

### **代碼安全掃描**
```yaml
# .github/workflows/security.yml
name: Security Scan
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run CodeQL Analysis
        uses: github/codeql-action/init@v2
        with:
          languages: javascript, python
          
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v2
        
      - name: Create Security Issue
        if: failure()
        uses: actions/github-script@v6
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `🔒 安全掃描發現問題 - ${context.sha.substring(0, 7)}`,
              body: `代碼安全掃描發現潛在安全問題。\n\n請查看詳細報告：${context.payload.repository.html_url}/security`,
              labels: ['security', 'priority-urgent'],
              assignees: ['security-lead']
            });
```

## 📊 GitHub Insights 和 Reporting

### **自動化報告生成**
```yaml
# .github/workflows/weekly-report.yml
name: Weekly Sprint Report
on:
  schedule:
    - cron: '0 9 * * MON'  # 每週一上午9點

jobs:
  generate-report:
    runs-on: ubuntu-latest
    steps:
      - name: Generate Sprint Report
        uses: actions/github-script@v6
        with:
          script: |
            // 生成週報
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
            
            const issues = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'closed',
              since: oneWeekAgo.toISOString()
            });
            
            const prs = await github.rest.pulls.list({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'closed',
              base: 'main'
            });
            
            const reportBody = `
            # 週報 ${new Date().toISOString().split('T')[0]}
            
            ## ✅ 本週完成
            - 已關閉 Issues: ${issues.data.length}
            - 已合併 PRs: ${prs.data.filter(pr => pr.merged_at).length}
            
            ## 📊 統計數據
            - Epic 進度: [自動計算]
            - 燃盡圖: [連結到 Projects]
            
            ## 🎯 下週重點
            [自動生成下週計劃]
            `;
            
            // 創建週報 Issue
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `📊 週報 - ${new Date().toISOString().split('T')[0]}`,
              body: reportBody,
              labels: ['report', 'weekly']
            });
```

## 🤖 AI 輔助功能

### **自動化程式碼審查**
```yaml
# .github/workflows/ai-review.yml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
          
      - name: AI Code Review
        uses: openai/gpt-code-review-action@v1
        with:
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          
      - name: Generate Review Checklist
        uses: actions/github-script@v6
        with:
          script: |
            const checklist = `
            ## 🤖 AI 審查清單
            
            - [ ] 代碼風格符合規範
            - [ ] 沒有明顯的安全漏洞  
            - [ ] 性能考量已處理
            - [ ] 錯誤處理完整
            - [ ] 測試覆蓋率足夠
            - [ ] 文檔已更新
            
            ## 🧠 AI 建議
            [AI 生成的改進建議]
            `;
            
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.pull_request.number,
              body: checklist
            });
```

## 📱 GitHub Mobile 和通知優化

### **智能通知配置**
```yaml
# .github/workflows/smart-notifications.yml
name: Smart Notifications
on:
  issues:
    types: [opened, closed]
  pull_request:
    types: [opened, review_requested, closed]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Smart Notification
        uses: actions/github-script@v6
        with:
          script: |
            // 根據優先級和角色發送不同通知
            const priority = context.payload.issue?.labels?.find(l => l.name.includes('priority'));
            const isEpic = context.payload.issue?.labels?.some(l => l.name === 'epic');
            
            if (priority?.name === 'priority-urgent' || isEpic) {
              // 發送即時通知到 Slack
              // 發送郵件給相關人員
              // 創建移動端推播通知
            }
```

## 🚀 進階專案管理功能

### **自動化 Milestone 管理**
```yaml
# .github/workflows/milestone-automation.yml
name: Milestone Management
on:
  schedule:
    - cron: '0 10 * * *'  # 每天上午10點檢查

jobs:
  milestone-check:
    runs-on: ubuntu-latest
    steps:
      - name: Auto-create Sprint Milestones
        uses: actions/github-script@v6
        with:
          script: |
            // 自動創建下個 Sprint 的 Milestone
            const now = new Date();
            const nextSprint = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 2週後
            
            const milestones = await github.rest.issues.listMilestones({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'open'
            });
            
            const nextSprintName = `Sprint ${Math.ceil(now.getTime() / (14 * 24 * 60 * 60 * 1000))}`;
            
            if (!milestones.data.find(m => m.title === nextSprintName)) {
              await github.rest.issues.createMilestone({
                owner: context.repo.owner,
                repo: context.repo.repo,
                title: nextSprintName,
                description: `Sprint 從 ${now.toISOString().split('T')[0]} 到 ${nextSprint.toISOString().split('T')[0]}`,
                due_on: nextSprint.toISOString()
              });
            }
```

### **自動化依賴追蹤**
```yaml
# .github/workflows/dependency-tracking.yml
name: Dependency Tracking
on:
  issues:
    types: [opened, edited, closed]

jobs:
  track-dependencies:
    runs-on: ubuntu-latest
    steps:
      - name: Parse Dependencies
        uses: actions/github-script@v6
        with:
          script: |
            const issue = context.payload.issue;
            const body = issue.body || '';
            
            // 解析依賴關係 (格式: Depends on #123)
            const dependsOnMatches = body.match(/Depends on #(\d+)/gi);
            const blockedByMatches = body.match(/Blocked by #(\d+)/gi);
            
            if (dependsOnMatches || blockedByMatches) {
              let comment = '## 📋 依賴關係追蹤\n\n';
              
              if (dependsOnMatches) {
                comment += '**依賴於:**\n';
                for (const match of dependsOnMatches) {
                  const depIssue = match.match(/\d+/)[0];
                  comment += `- [ ] #${depIssue}\n`;
                }
              }
              
              if (blockedByMatches) {
                comment += '**被阻塞:**\n';
                for (const match of blockedByMatches) {
                  const blockIssue = match.match(/\d+/)[0];
                  comment += `- [ ] #${blockIssue}\n`;
                }
              }
              
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: issue.number,
                body: comment
              });
            }
```

## 📈 效能監控和分析

### **開發效率分析**
```yaml
# .github/workflows/metrics-analysis.yml
name: Development Metrics
on:
  schedule:
    - cron: '0 18 * * FRI'  # 每週五下午6點

jobs:
  analyze-metrics:
    runs-on: ubuntu-latest
    steps:
      - name: Calculate Team Velocity
        uses: actions/github-script@v6
        with:
          script: |
            // 計算團隊速度和效率指標
            const lastMonth = new Date();
            lastMonth.setMonth(lastMonth.getMonth() - 1);
            
            const closedIssues = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'closed',
              since: lastMonth.toISOString()
            });
            
            // 計算平均處理時間
            let totalDays = 0;
            for (const issue of closedIssues.data) {
              const created = new Date(issue.created_at);
              const closed = new Date(issue.closed_at);
              const daysDiff = (closed - created) / (1000 * 60 * 60 * 24);
              totalDays += daysDiff;
            }
            
            const avgDays = totalDays / closedIssues.data.length;
            
            const metricsReport = `
            # 📊 開發效率報告
            
            ## 本月統計
            - 完成 Issues: ${closedIssues.data.length}
            - 平均處理時間: ${avgDays.toFixed(1)} 天
            - 團隊效率趨勢: [圖表連結]
            
            ## 改進建議
            [基於數據的改進建議]
            `;
            
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `📈 月度效率報告 - ${new Date().toISOString().split('T')[0]}`,
              body: metricsReport,
              labels: ['metrics', 'report']
            });
```

---

## 🎯 與 Bee Swarm 專案的整合應用

### **MCP 角色系統整合**

這個進階工作流程特別適合 Bee Swarm 專案的 MCP (Model Context Protocol) 角色系統：

1. **角色專屬自動化**
   - Product Manager: 自動生成 Epic 模板和需求分析
   - Backend Developer: 自動化 API 測試和代碼審查
   - Frontend Developer: 自動化 UI 測試和組件文檔
   - DevOps Engineer: 自動化部署和監控報告

2. **跨角色協作自動化**
   - 自動分配任務給合適的角色容器
   - 智能通知相關角色的工作進度
   - 自動化依賴關係管理

3. **與教育遊戲項目的結合**
   - 自動化模擬數據收集和分析
   - 遊戲功能的 A/B 測試自動化
   - 教育效果評估報告生成

### **部署建議**

1. **階段性實施**: 先從基礎 Issue 管理開始，逐步加入 AI 和高級自動化功能
2. **權限配置**: 設置適當的 GitHub Secrets 和權限
3. **監控和調優**: 定期檢查自動化流程的效果並調整參數

這個進階工作流程將 GitHub 平台的潛力發揮到極致，創造出一個智能化、自動化的敏捷開發環境。 