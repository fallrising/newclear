#!/usr/bin/env python3
"""
Bee Swarm 基本模擬腳本
用於演示如何使用 SimPy 進行簡單的協作模擬
"""

import simpy
import random
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from dataclasses import dataclass
from typing import List, Dict, Any
from enum import Enum

class TaskType(Enum):
    FEATURE = "feature"
    BUG_FIX = "bug_fix"
    TECHNICAL_DEBT = "technical_debt"

class TaskPriority(Enum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4

@dataclass
class Task:
    """任務數據類"""
    id: int
    task_type: TaskType
    priority: TaskPriority
    complexity: float
    created_at: float
    completed_at: float = None
    assigned_role: str = None
    status: str = "created"

class ProductManager:
    """產品經理模擬器"""
    
    def __init__(self, env: simpy.Environment, task_queue: simpy.Store):
        self.env = env
        self.task_queue = task_queue
        self.task_counter = 0
        self.created_tasks = []
        
    def create_tasks(self):
        """持續創建任務的流程"""
        while True:
            # 等待下一個任務創建時間（指數分布）
            yield self.env.timeout(random.expovariate(1/8))  # 平均8小時創建一個任務
            
            # 創建新任務
            task = self._generate_task()
            self.created_tasks.append(task)
            yield self.task_queue.put(task)
            
            print(f"Time {self.env.now:.1f}: PM created {task.task_type.value} task #{task.id}")
    
    def _generate_task(self) -> Task:
        """生成隨機任務"""
        self.task_counter += 1
        
        # 任務類型分布
        task_type = random.choices(
            list(TaskType),
            weights=[0.6, 0.3, 0.1]  # Feature:Bug:TechnicalDebt = 6:3:1
        )[0]
        
        # 優先級分布
        priority = random.choices(
            list(TaskPriority),
            weights=[0.4, 0.4, 0.15, 0.05]  # Low:Medium:High:Critical = 40:40:15:5
        )[0]
        
        # 複雜度（1-10，正態分布）
        complexity = max(1, min(10, random.normalvariate(5, 2)))
        
        return Task(
            id=self.task_counter,
            task_type=task_type,
            priority=priority,
            complexity=complexity,
            created_at=self.env.now
        )

class Developer:
    """開發者基類"""
    
    def __init__(self, env: simpy.Environment, name: str, task_queue: simpy.Store, 
                 capacity: float = 1.0, skills: Dict[TaskType, float] = None):
        self.env = env
        self.name = name
        self.task_queue = task_queue
        self.capacity = capacity
        self.skills = skills or {task_type: 1.0 for task_type in TaskType}
        self.completed_tasks = []
        self.current_task = None
        
    def work(self):
        """主要工作循環"""
        while True:
            # 從任務隊列獲取任務
            task = yield self.task_queue.get()
            self.current_task = task
            task.assigned_role = self.name
            task.status = "in_progress"
            
            print(f"Time {self.env.now:.1f}: {self.name} started task #{task.id}")
            
            # 計算工作時間
            work_time = self._calculate_work_time(task)
            
            # 執行任務
            yield self.env.timeout(work_time)
            
            # 完成任務
            task.completed_at = self.env.now
            task.status = "completed"
            self.completed_tasks.append(task)
            self.current_task = None
            
            print(f"Time {self.env.now:.1f}: {self.name} completed task #{task.id}")
    
    def _calculate_work_time(self, task: Task) -> float:
        """計算任務執行時間"""
        base_time = task.complexity * 2  # 基礎時間：複雜度 * 2小時
        skill_multiplier = self.skills.get(task.task_type, 1.0)
        
        # 技能影響工作時間（技能越高，時間越短）
        actual_time = base_time / skill_multiplier
        
        # 加入隨機變化（±20%）
        variation = random.uniform(0.8, 1.2)
        
        return actual_time * variation

class BackendDeveloper(Developer):
    """後端開發者"""
    
    def __init__(self, env: simpy.Environment, task_queue: simpy.Store):
        skills = {
            TaskType.FEATURE: 1.0,
            TaskType.BUG_FIX: 1.2,  # 後端對bug修復更熟練
            TaskType.TECHNICAL_DEBT: 1.1
        }
        super().__init__(env, "Backend Developer", task_queue, skills=skills)

class FrontendDeveloper(Developer):
    """前端開發者"""
    
    def __init__(self, env: simpy.Environment, task_queue: simpy.Store):
        skills = {
            TaskType.FEATURE: 1.1,  # 前端對功能開發更熟練
            TaskType.BUG_FIX: 0.9,
            TaskType.TECHNICAL_DEBT: 0.8
        }
        super().__init__(env, "Frontend Developer", task_queue, skills=skills)

class DevOpsEngineer(Developer):
    """DevOps 工程師"""
    
    def __init__(self, env: simpy.Environment, task_queue: simpy.Store):
        skills = {
            TaskType.FEATURE: 0.8,
            TaskType.BUG_FIX: 1.0,
            TaskType.TECHNICAL_DEBT: 1.3  # DevOps 對技術債務處理更熟練
        }
        super().__init__(env, "DevOps Engineer", task_queue, skills=skills)

class SimulationMetrics:
    """模擬指標收集器"""
    
    def __init__(self):
        self.tasks_created = []
        self.tasks_completed = []
        self.role_utilization = {}
        
    def collect_data(self, pm: ProductManager, developers: List[Developer]) -> Dict[str, Any]:
        """收集模擬數據"""
        all_tasks = pm.created_tasks
        completed_tasks = []
        
        # 收集所有已完成的任務
        for dev in developers:
            completed_tasks.extend(dev.completed_tasks)
        
        # 計算指標
        total_tasks = len(all_tasks)
        completed_count = len(completed_tasks)
        completion_rate = completed_count / total_tasks if total_tasks > 0 else 0
        
        # 計算平均週期時間
        cycle_times = []
        for task in completed_tasks:
            if task.completed_at and task.created_at:
                cycle_times.append(task.completed_at - task.created_at)
        
        avg_cycle_time = np.mean(cycle_times) if cycle_times else 0
        
        # 計算每個角色的工作量
        role_workload = {}
        for dev in developers:
            role_workload[dev.name] = len(dev.completed_tasks)
        
        return {
            'total_tasks_created': total_tasks,
            'tasks_completed': completed_count,
            'completion_rate': completion_rate,
            'average_cycle_time': avg_cycle_time,
            'role_workload': role_workload,
            'completed_tasks': completed_tasks
        }

def run_basic_simulation(duration: int = 200, verbose: bool = True) -> Dict[str, Any]:
    """
    運行基本模擬
    
    Args:
        duration: 模擬持續時間（小時）
        verbose: 是否輸出詳細日誌
        
    Returns:
        模擬結果數據
    """
    # 創建模擬環境
    env = simpy.Environment()
    
    # 創建任務隊列
    task_queue = simpy.Store(env)
    
    # 創建角色
    pm = ProductManager(env, task_queue)
    backend_dev = BackendDeveloper(env, task_queue)
    frontend_dev = FrontendDeveloper(env, task_queue)
    devops_engineer = DevOpsEngineer(env, task_queue)
    
    developers = [backend_dev, frontend_dev, devops_engineer]
    
    # 啟動進程
    env.process(pm.create_tasks())
    for dev in developers:
        env.process(dev.work())
    
    # 運行模擬
    if verbose:
        print(f"Starting simulation for {duration} hours...")
        print("=" * 50)
    
    env.run(until=duration)
    
    if verbose:
        print("=" * 50)
        print("Simulation completed!")
    
    # 收集指標
    metrics = SimulationMetrics()
    results = metrics.collect_data(pm, developers)
    
    return results

def create_visualization(results: Dict[str, Any]):
    """創建可視化圖表"""
    fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(15, 10))
    
    # 1. 任務完成情況
    labels = ['Completed', 'Pending']
    sizes = [results['tasks_completed'], 
             results['total_tasks_created'] - results['tasks_completed']]
    colors = ['#90EE90', '#FFB6C1']
    
    ax1.pie(sizes, labels=labels, colors=colors, autopct='%1.1f%%', startangle=90)
    ax1.set_title('Task Completion Status')
    
    # 2. 角色工作量分布
    roles = list(results['role_workload'].keys())
    workloads = list(results['role_workload'].values())
    
    ax2.bar(roles, workloads, color=['#FF6B6B', '#4ECDC4', '#45B7D1'])
    ax2.set_title('Tasks Completed by Role')
    ax2.set_ylabel('Number of Tasks')
    ax2.tick_params(axis='x', rotation=45)
    
    # 3. 任務類型分布
    if results['completed_tasks']:
        task_types = {}
        for task in results['completed_tasks']:
            task_type = task.task_type.value
            task_types[task_type] = task_types.get(task_type, 0) + 1
        
        ax3.bar(task_types.keys(), task_types.values(), 
                color=['#96CEB4', '#FECA57', '#FF9FF3'])
        ax3.set_title('Completed Tasks by Type')
        ax3.set_ylabel('Number of Tasks')
    
    # 4. 週期時間分布
    if results['completed_tasks']:
        cycle_times = []
        for task in results['completed_tasks']:
            if task.completed_at and task.created_at:
                cycle_times.append(task.completed_at - task.created_at)
        
        if cycle_times:
            ax4.hist(cycle_times, bins=10, color='#DDA0DD', alpha=0.7, edgecolor='black')
            ax4.set_title('Cycle Time Distribution')
            ax4.set_xlabel('Hours')
            ax4.set_ylabel('Frequency')
    
    plt.tight_layout()
    plt.show()

def print_summary_report(results: Dict[str, Any]):
    """打印摘要報告"""
    print("\n" + "=" * 60)
    print("SIMULATION SUMMARY REPORT")
    print("=" * 60)
    
    print(f"📊 Overall Performance:")
    print(f"   • Total tasks created: {results['total_tasks_created']}")
    print(f"   • Tasks completed: {results['tasks_completed']}")
    print(f"   • Completion rate: {results['completion_rate']:.1%}")
    print(f"   • Average cycle time: {results['average_cycle_time']:.1f} hours")
    
    print(f"\n👥 Role Performance:")
    for role, count in results['role_workload'].items():
        percentage = count / results['tasks_completed'] * 100 if results['tasks_completed'] > 0 else 0
        print(f"   • {role}: {count} tasks ({percentage:.1f}%)")
    
    # 任務類型統計
    if results['completed_tasks']:
        task_type_stats = {}
        for task in results['completed_tasks']:
            task_type = task.task_type.value
            task_type_stats[task_type] = task_type_stats.get(task_type, 0) + 1
        
        print(f"\n📋 Task Type Distribution:")
        for task_type, count in task_type_stats.items():
            percentage = count / len(results['completed_tasks']) * 100
            print(f"   • {task_type.replace('_', ' ').title()}: {count} ({percentage:.1f}%)")
    
    print("=" * 60)

if __name__ == "__main__":
    # 運行基本模擬
    print("🐝 Bee Swarm Basic Simulation")
    print("Starting basic team collaboration simulation...")
    
    # 執行模擬
    simulation_results = run_basic_simulation(duration=200, verbose=True)
    
    # 顯示結果
    print_summary_report(simulation_results)
    
    # 創建可視化（如果有 matplotlib）
    try:
        create_visualization(simulation_results)
    except ImportError:
        print("\nNote: Install matplotlib to see visualization charts")
        print("pip install matplotlib") 