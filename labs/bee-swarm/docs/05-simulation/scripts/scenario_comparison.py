#!/usr/bin/env python3
"""
Bee Swarm 場景比較腳本
用於比較不同協作模式的效果
"""

import simpy
import random
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum
import json

class WorkflowType(Enum):
    WATERFALL = "waterfall"
    AGILE = "agile"
    CONTINUOUS = "continuous"

@dataclass
class ScenarioConfig:
    """場景配置"""
    name: str
    workflow_type: WorkflowType
    team_size: int
    sprint_length: int = 14  # 天
    automation_level: float = 0.5
    documentation_overhead: float = 0.2
    meeting_overhead: float = 0.1
    defect_rate: float = 0.1
    rework_multiplier: float = 1.5

@dataclass
class SimulationResult:
    """模擬結果"""
    scenario_name: str
    duration: int
    tasks_created: int
    tasks_completed: int
    completion_rate: float
    average_cycle_time: float
    throughput: float  # 每天完成的任務數
    defect_count: int
    rework_count: int
    team_utilization: float
    metrics: Dict[str, Any] = field(default_factory=dict)

class EnhancedTeamSimulator:
    """增強的團隊模擬器"""
    
    def __init__(self, env: simpy.Environment, config: ScenarioConfig):
        self.env = env
        self.config = config
        self.tasks = []
        self.completed_tasks = []
        self.metrics = {
            'daily_completion': [],
            'queue_lengths': [],
            'cycle_times': [],
            'defects': [],
            'rework_events': []
        }
        
        # 根據工作流程類型創建不同的處理邏輯
        self.task_queue = simpy.Store(env)
        self.review_queue = simpy.Store(env)
        
    def generate_tasks(self):
        """任務生成器"""
        task_id = 0
        while True:
            # 根據工作流程類型調整任務生成頻率
            if self.config.workflow_type == WorkflowType.WATERFALL:
                # 瀑布模式：批量生成任務
                yield self.env.timeout(random.expovariate(1/48))  # 每48小時一批
                batch_size = random.randint(5, 15)
                for _ in range(batch_size):
                    task = self._create_task(task_id)
                    self.tasks.append(task)
                    yield self.task_queue.put(task)
                    task_id += 1
            else:
                # 敏捷/持續模式：持續生成任務
                yield self.env.timeout(random.expovariate(1/8))
                task = self._create_task(task_id)
                self.tasks.append(task)
                yield self.task_queue.put(task)
                task_id += 1
    
    def _create_task(self, task_id: int) -> Dict[str, Any]:
        """創建任務"""
        complexity = max(1, min(10, random.normalvariate(5, 2)))
        return {
            'id': task_id,
            'created_at': self.env.now,
            'complexity': complexity,
            'status': 'created',
            'has_defect': random.random() < self.config.defect_rate,
            'rework_count': 0,
            'completed_at': None
        }
    
    def developer_work(self, developer_id: int):
        """開發者工作流程"""
        while True:
            # 獲取任務
            task = yield self.task_queue.get()
            task['status'] = 'in_progress'
            task['assigned_to'] = developer_id
            task['started_at'] = self.env.now
            
            # 計算工作時間
            base_time = task['complexity'] * 2
            
            # 根據工作流程類型調整
            if self.config.workflow_type == WorkflowType.WATERFALL:
                # 瀑布模式：更多文檔時間
                work_time = base_time * (1 + self.config.documentation_overhead)
            elif self.config.workflow_type == WorkflowType.AGILE:
                # 敏捷模式：會議開銷
                work_time = base_time * (1 + self.config.meeting_overhead)
            else:  # CONTINUOUS
                # 持續模式：自動化減少工作量
                work_time = base_time * (1 - self.config.automation_level * 0.3)
            
            # 加入隨機變化
            work_time *= random.uniform(0.8, 1.2)
            
            yield self.env.timeout(work_time)
            
            # 檢查是否有缺陷
            if task['has_defect'] and random.random() < 0.8:  # 80%概率發現缺陷
                # 需要返工
                task['rework_count'] += 1
                task['has_defect'] = random.random() < (self.config.defect_rate * 0.5)  # 返工後缺陷率降低
                yield self.task_queue.put(task)  # 重新排隊
                continue
            
            # 根據工作流程決定是否需要審查
            if (self.config.workflow_type in [WorkflowType.AGILE, WorkflowType.CONTINUOUS] 
                and random.random() < 0.9):  # 90%的任務需要審查
                yield self.review_queue.put(task)
            else:
                # 直接完成
                self._complete_task(task)
    
    def reviewer_work(self):
        """審查者工作流程"""
        while True:
            task = yield self.review_queue.get()
            task['status'] = 'in_review'
            
            # 審查時間
            review_time = task['complexity'] * 0.5 * random.uniform(0.5, 1.5)
            yield self.env.timeout(review_time)
            
            # 審查結果
            if random.random() < 0.2:  # 20%概率需要修改
                task['rework_count'] += 1
                yield self.task_queue.put(task)
            else:
                self._complete_task(task)
    
    def _complete_task(self, task: Dict[str, Any]):
        """完成任務"""
        task['completed_at'] = self.env.now
        task['status'] = 'completed'
        task['cycle_time'] = task['completed_at'] - task['created_at']
        self.completed_tasks.append(task)
        
        # 記錄指標
        self.metrics['cycle_times'].append(task['cycle_time'])
        if task['has_defect']:
            self.metrics['defects'].append(task)
        if task['rework_count'] > 0:
            self.metrics['rework_events'].append(task)
    
    def metrics_collector(self):
        """指標收集器"""
        while True:
            yield self.env.timeout(24)  # 每天收集一次
            
            # 收集每日完成數
            daily_completed = len([t for t in self.completed_tasks 
                                 if t['completed_at'] > self.env.now - 24])
            self.metrics['daily_completion'].append(daily_completed)
            
            # 收集隊列長度
            queue_length = len(self.task_queue.items) + len(self.review_queue.items)
            self.metrics['queue_lengths'].append(queue_length)

def run_scenario_simulation(config: ScenarioConfig, duration: int = 240) -> SimulationResult:
    """運行場景模擬"""
    env = simpy.Environment()
    simulator = EnhancedTeamSimulator(env, config)
    
    # 啟動進程
    env.process(simulator.generate_tasks())
    env.process(simulator.metrics_collector())
    
    # 創建開發者
    for i in range(config.team_size):
        env.process(simulator.developer_work(i))
    
    # 創建審查者（如果需要）
    if config.workflow_type in [WorkflowType.AGILE, WorkflowType.CONTINUOUS]:
        env.process(simulator.reviewer_work())
    
    # 運行模擬
    env.run(until=duration)
    
    # 計算結果
    completed_count = len(simulator.completed_tasks)
    total_created = len(simulator.tasks)
    
    cycle_times = simulator.metrics['cycle_times']
    avg_cycle_time = np.mean(cycle_times) if cycle_times else 0
    
    throughput = completed_count / (duration / 24) if duration > 0 else 0
    
    defect_count = len(simulator.metrics['defects'])
    rework_count = len(simulator.metrics['rework_events'])
    
    # 簡化的利用率計算
    team_utilization = min(1.0, completed_count / (config.team_size * duration / 8))
    
    return SimulationResult(
        scenario_name=config.name,
        duration=duration,
        tasks_created=total_created,
        tasks_completed=completed_count,
        completion_rate=completed_count / total_created if total_created > 0 else 0,
        average_cycle_time=avg_cycle_time,
        throughput=throughput,
        defect_count=defect_count,
        rework_count=rework_count,
        team_utilization=team_utilization,
        metrics=simulator.metrics
    )

def compare_scenarios(scenarios: List[ScenarioConfig], duration: int = 240) -> List[SimulationResult]:
    """比較多個場景"""
    results = []
    
    print("🔄 Running scenario comparisons...")
    for i, config in enumerate(scenarios, 1):
        print(f"   ({i}/{len(scenarios)}) Simulating {config.name}...")
        result = run_scenario_simulation(config, duration)
        results.append(result)
    
    print("✅ All scenarios completed!")
    return results

def create_comparison_charts(results: List[SimulationResult]):
    """創建比較圖表"""
    # 準備數據
    scenario_names = [r.scenario_name for r in results]
    
    fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(16, 12))
    
    # 1. 吞吐量比較
    throughputs = [r.throughput for r in results]
    bars1 = ax1.bar(scenario_names, throughputs, color=['#FF6B6B', '#4ECDC4', '#45B7D1'])
    ax1.set_title('Daily Throughput Comparison', fontsize=14, fontweight='bold')
    ax1.set_ylabel('Tasks per Day')
    ax1.tick_params(axis='x', rotation=45)
    
    # 添加數值標籤
    for bar, value in zip(bars1, throughputs):
        height = bar.get_height()
        ax1.text(bar.get_x() + bar.get_width()/2., height + 0.01,
                f'{value:.2f}', ha='center', va='bottom')
    
    # 2. 平均週期時間比較
    cycle_times = [r.average_cycle_time for r in results]
    bars2 = ax2.bar(scenario_names, cycle_times, color=['#FFD93D', '#6BCF7F', '#FF8ED4'])
    ax2.set_title('Average Cycle Time Comparison', fontsize=14, fontweight='bold')
    ax2.set_ylabel('Hours')
    ax2.tick_params(axis='x', rotation=45)
    
    for bar, value in zip(bars2, cycle_times):
        height = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width()/2., height + 0.5,
                f'{value:.1f}h', ha='center', va='bottom')
    
    # 3. 質量指標比較
    completion_rates = [r.completion_rate * 100 for r in results]
    defect_rates = [(r.defect_count / r.tasks_completed * 100) if r.tasks_completed > 0 else 0 for r in results]
    
    x = np.arange(len(scenario_names))
    width = 0.35
    
    bars3_1 = ax3.bar(x - width/2, completion_rates, width, label='Completion Rate (%)', color='#90EE90')
    bars3_2 = ax3.bar(x + width/2, defect_rates, width, label='Defect Rate (%)', color='#FFB6C1')
    
    ax3.set_title('Quality Metrics Comparison', fontsize=14, fontweight='bold')
    ax3.set_ylabel('Percentage')
    ax3.set_xticks(x)
    ax3.set_xticklabels(scenario_names, rotation=45)
    ax3.legend()
    
    # 4. 團隊利用率比較
    utilizations = [r.team_utilization * 100 for r in results]
    bars4 = ax4.bar(scenario_names, utilizations, color=['#DDA0DD', '#98FB98', '#F0E68C'])
    ax4.set_title('Team Utilization Comparison', fontsize=14, fontweight='bold')
    ax4.set_ylabel('Utilization (%)')
    ax4.tick_params(axis='x', rotation=45)
    ax4.set_ylim(0, 100)
    
    for bar, value in zip(bars4, utilizations):
        height = bar.get_height()
        ax4.text(bar.get_x() + bar.get_width()/2., height + 1,
                f'{value:.1f}%', ha='center', va='bottom')
    
    plt.tight_layout()
    plt.show()

def create_detailed_comparison_table(results: List[SimulationResult]) -> pd.DataFrame:
    """創建詳細比較表"""
    data = []
    for result in results:
        data.append({
            'Scenario': result.scenario_name,
            'Tasks Created': result.tasks_created,
            'Tasks Completed': result.tasks_completed,
            'Completion Rate (%)': f"{result.completion_rate * 100:.1f}%",
            'Avg Cycle Time (h)': f"{result.average_cycle_time:.1f}",
            'Daily Throughput': f"{result.throughput:.2f}",
            'Defect Count': result.defect_count,
            'Rework Count': result.rework_count,
            'Team Utilization (%)': f"{result.team_utilization * 100:.1f}%"
        })
    
    return pd.DataFrame(data)

def print_comparison_summary(results: List[SimulationResult]):
    """打印比較摘要"""
    print("\n" + "=" * 80)
    print("SCENARIO COMPARISON SUMMARY")
    print("=" * 80)
    
    # 找出最佳表現者
    best_throughput = max(results, key=lambda x: x.throughput)
    best_cycle_time = min(results, key=lambda x: x.average_cycle_time)
    best_completion = max(results, key=lambda x: x.completion_rate)
    best_utilization = max(results, key=lambda x: x.team_utilization)
    
    print(f"🏆 Best Performers:")
    print(f"   • Highest Throughput: {best_throughput.scenario_name} ({best_throughput.throughput:.2f} tasks/day)")
    print(f"   • Fastest Cycle Time: {best_cycle_time.scenario_name} ({best_cycle_time.average_cycle_time:.1f} hours)")
    print(f"   • Best Completion Rate: {best_completion.scenario_name} ({best_completion.completion_rate:.1%})")
    print(f"   • Best Utilization: {best_utilization.scenario_name} ({best_utilization.team_utilization:.1%})")
    
    print(f"\n📊 Detailed Comparison:")
    df = create_detailed_comparison_table(results)
    print(df.to_string(index=False))
    
    print("=" * 80)

def main():
    """主函數"""
    print("🐝 Bee Swarm Scenario Comparison Tool")
    print("Comparing different workflow methodologies...\n")
    
    # 定義比較場景
    scenarios = [
        ScenarioConfig(
            name="Waterfall",
            workflow_type=WorkflowType.WATERFALL,
            team_size=4,
            automation_level=0.2,
            documentation_overhead=0.4,
            meeting_overhead=0.05,
            defect_rate=0.15
        ),
        ScenarioConfig(
            name="Agile",
            workflow_type=WorkflowType.AGILE,
            team_size=4,
            sprint_length=14,
            automation_level=0.5,
            documentation_overhead=0.15,
            meeting_overhead=0.15,
            defect_rate=0.08
        ),
        ScenarioConfig(
            name="Continuous",
            workflow_type=WorkflowType.CONTINUOUS,
            team_size=4,
            automation_level=0.8,
            documentation_overhead=0.1,
            meeting_overhead=0.05,
            defect_rate=0.05
        )
    ]
    
    # 運行比較
    results = compare_scenarios(scenarios, duration=240)  # 10天模擬
    
    # 顯示結果
    print_comparison_summary(results)
    
    # 創建可視化
    try:
        create_comparison_charts(results)
    except ImportError:
        print("\nNote: Install matplotlib and seaborn for visualization")
        print("pip install matplotlib seaborn")
    
    # 保存結果為JSON
    results_data = []
    for result in results:
        results_data.append({
            'scenario_name': result.scenario_name,
            'tasks_created': result.tasks_created,
            'tasks_completed': result.tasks_completed,
            'completion_rate': result.completion_rate,
            'average_cycle_time': result.average_cycle_time,
            'throughput': result.throughput,
            'defect_count': result.defect_count,
            'rework_count': result.rework_count,
            'team_utilization': result.team_utilization
        })
    
    with open('scenario_comparison_results.json', 'w') as f:
        json.dump(results_data, f, indent=2)
    
    print(f"\n💾 Results saved to 'scenario_comparison_results.json'")

if __name__ == "__main__":
    main() 