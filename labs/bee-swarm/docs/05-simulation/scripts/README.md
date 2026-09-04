# Bee Swarm 模擬腳本

這個目錄包含了 Bee Swarm 項目的各種模擬腳本，用於演示和驗證 AI 角色協作的效果。

## 📁 腳本概覽

### 基礎模擬腳本
- **`basic_simulation.py`** - 基本的四角色協作模擬
- **`scenario_comparison.py`** - 不同開發模式的比較分析

### 配置文件
- **`config/`** - 模擬參數配置文件
- **`requirements.txt`** - Python 依賴清單

## 🚀 快速開始

### 安裝依賴
```bash
pip install -r requirements.txt
```

### 運行基本模擬
```bash
python basic_simulation.py
```

### 運行場景比較
```bash
python scenario_comparison.py
```

## 📊 輸出結果

模擬腳本會產生以下輸出：

1. **控制台報告** - 實時進度和最終摘要
2. **可視化圖表** - 性能指標的圖形化展示
3. **JSON 數據文件** - 詳細的模擬數據，可用於進一步分析

## 🔧 自定義配置

### 修改模擬參數
編輯腳本中的配置參數：

```python
# 模擬持續時間（小時）
SIMULATION_DURATION = 200

# 團隊配置
TEAM_SIZE = 4

# 任務生成頻率
TASK_CREATION_RATE = 8  # 平均小時數
```

### 添加新場景
在 `scenario_comparison.py` 中添加新的場景配置：

```python
new_scenario = ScenarioConfig(
    name="Custom Scenario",
    workflow_type=WorkflowType.AGILE,
    team_size=6,
    automation_level=0.7,
    defect_rate=0.06
)
```

## 📈 理解結果

### 關鍵指標說明

1. **完成率 (Completion Rate)** - 已完成任務 / 總創建任務
2. **平均週期時間 (Average Cycle Time)** - 從任務創建到完成的平均時間
3. **吞吐量 (Throughput)** - 每天完成的任務數量
4. **團隊利用率 (Team Utilization)** - 團隊實際工作時間佔比

### 性能分析
- **高吞吐量 + 低週期時間** = 高效團隊
- **高完成率 + 低缺陷率** = 高質量輸出
- **均衡的角色工作分配** = 良好的協作

## 🛠️ 故障排除

### 常見問題

1. **ImportError: No module named 'simpy'**
   ```bash
   pip install simpy
   ```

2. **圖表無法顯示**
   ```bash
   pip install matplotlib seaborn
   ```

3. **模擬運行時間過長**
   - 減少 `SIMULATION_DURATION` 參數
   - 降低任務創建頻率

### 性能優化
- 對於大規模模擬，考慮使用並行處理
- 調整日誌輸出級別以提高運行速度
- 使用更高效的數據結構存儲指標

## 📚 擴展腳本

### 添加新的角色類型
```python
class QAEngineer(Developer):
    def __init__(self, env, task_queue):
        skills = {
            TaskType.BUG_FIX: 1.3,
            TaskType.FEATURE: 0.7,
            TaskType.TECHNICAL_DEBT: 0.9
        }
        super().__init__(env, "QA Engineer", task_queue, skills=skills)
```

### 創建自定義分析器
```python
class CustomAnalyzer:
    def __init__(self, simulation_data):
        self.data = simulation_data
    
    def calculate_custom_metric(self):
        # 實現自定義分析邏輯
        pass
```

## 🔗 相關文檔

- [SimPy 模擬器](../simulator-guide.md) - 了解模擬器架構
- [模擬場景](../simulator-guide.md) - 詳細的場景配置說明
- [效果分析](../analysis-guide.md) - 深入的結果分析方法

## 📝 貢獻指南

歡迎貢獻新的模擬腳本或改進現有腳本：

1. Fork 項目
2. 創建功能分支
3. 添加適當的測試
4. 更新文檔
5. 提交 Pull Request

## 📄 許可證

本項目採用 MIT 許可證 - 詳見 [LICENSE](../../../LICENSE) 文件。 