"""
Bee Swarm 增強版事件驅動仿真
融合基礎設施真實性和完整軟體開發生命週期
"""

import simpy
import random
import time
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from enum import Enum
import colorama
from colorama import Fore, Back, Style

# 初始化颜色支持
colorama.init()

class EventType(Enum):
    """完整的事件類型枚舉 - 融合基礎設施和開發流程"""
    
    # 基礎設施階段 (保持 Bee Swarm 的真實性)
    VPS_PREPARATION = "🖥️ VPS準備"
    CONTAINER_DEPLOYMENT = "🐳 容器部署"
    CLOUDFLARE_TUNNEL_SETUP = "☁️ Cloudflare Tunnel配置"
    GITHUB_ACTION_SETUP = "⚙️ GitHub Action配置"
    AI_ROLE_ACTIVATION = "🤖 AI角色激活"
    
    # 需求階段事件
    EPIC_CREATED = "📚 Epic創建"
    USER_STORY_CREATED = "📝 用戶故事創建"
    ACCEPTANCE_CRITERIA_DEFINED = "✅ 驗收標準定義"
    PRD_CREATED = "📋 PRD創建"
    TASK_ASSIGNMENT = "🎯 任務分配"
    REQUIREMENT_CLARIFICATION = "❓ 需求澄清"
    
    # 設計階段事件
    TECHNICAL_DESIGN_STARTED = "🎨 技術設計開始"
    API_DESIGN_CREATED = "🔌 API設計創建"
    DATABASE_SCHEMA_DESIGNED = "🗄️ 數據庫模式設計"
    UI_MOCKUP_CREATED = "🖼️ UI原型創建"
    ARCHITECTURE_REVIEW = "🏗️ 架構評審"
    API_ALIGNMENT_REQUEST = "🤝 API對齊請求"
    API_ALIGNMENT_COMPLETE = "✅ API對齊完成"
    
    # 開發階段事件
    FEATURE_BRANCH_CREATED = "🌿 功能分支創建"
    CODING_STARTED = "⌨️ 編碼開始"
    COMMIT_PUSHED = "📤 代碼提交推送"
    REFACTORING_STARTED = "♻️ 重構開始"
    BUG_FIX_STARTED = "🐛 Bug修復開始"
    UI_COMPONENT_CREATED = "🎨 UI組件創建"
    API_ENDPOINT_IMPLEMENTED = "🔌 API端點實現"
    
    # 測試階段事件
    UNIT_TEST_WRITTEN = "🧪 單元測試編寫"
    INTEGRATION_TEST_WRITTEN = "🔗 集成測試編寫"
    E2E_TEST_WRITTEN = "🎯 端到端測試編寫"
    TEST_PASSED = "✅ 測試通過"
    TEST_FAILED = "❌ 測試失敗"
    UAT_STARTED = "🧪 UAT開始"
    UAT_COMPLETED = "✅ UAT完成"
    
    # 代碼審查事件
    PR_CREATED = "🔀 PR創建"
    CODE_REVIEW_REQUESTED = "👀 代碼審查請求"
    CODE_REVIEW_APPROVED = "✅ 代碼審查通過"
    REVIEW_FEEDBACK_ADDRESSED = "🔧 審查反饋處理"
    
    # CI/CD 和 DevOps 事件
    BUILD_TRIGGERED = "🔨 構建觸發"
    BUILD_COMPLETED = "✅ 構建完成"
    BUILD_FAILED = "❌ 構建失敗"
    DEPLOYMENT_STARTED = "🚀 部署開始"
    DEPLOYMENT_COMPLETED = "✅ 部署完成"
    DEPLOYMENT_ROLLBACK = "⏪ 部署回滾"
    
    # 溝通協作事件
    DEVELOPER_QUESTION = "❓ 開發者提出疑問"
    PM_ANSWER = "💡 產品經理解答"
    TECHNICAL_DISCUSSION_STARTED = "💭 技術討論開始"
    BLOCKERS_IDENTIFIED = "🚧 阻礙識別"
    BLOCKERS_RESOLVED = "✅ 阻礙解決"
    
    # 項目管理事件
    MILESTONE_REACHED = "🎯 里程碑達成"
    PROJECT_STATUS_UPDATED = "📈 項目狀態更新"
    PROJECT_RELEASE = "🚀 項目發布"
    
    # 系統事件
    GITHUB_ACTION_TRIGGER = "⚙️ GitHub Action觸發"
    WEBHOOK_RECEIVED = "📥 Webhook接收"
    AI_AGENT_WAKEUP = "🤖 AI Agent唤醒"

@dataclass
class Task:
    """增強的任務數據類"""
    id: str
    title: str
    type: str
    priority: str
    assignee: str
    status: str = "待處理"
    created_time: float = 0
    completed_time: Optional[float] = None
    dependencies: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class VPSInstance:
    """VPS實例 (保持真實性)"""
    id: str
    provider: str
    region: str
    cost_per_hour: float

@dataclass
class Container:
    """容器實例"""
    id: str
    role_id: str
    vps_id: str
    webhook_url: str
    status: str
    ai_tool: str

@dataclass
class GitHubRepository:
    """GitHub 倉庫抽象模型"""
    def __init__(self):
        self.epics: Dict[str, Task] = {}
        self.issues: Dict[str, Task] = {}
        self.pull_requests: Dict[str, Task] = {}
        self.api_docs: Dict[str, Dict] = {}
        self.events: List[Dict] = []
    
    def create_epic(self, epic: Task) -> None:
        self.epics[epic.id] = epic
    
    def create_issue(self, issue: Task) -> None:
        self.issues[issue.id] = issue
    
    def create_pr(self, pr: Task) -> None:
        self.pull_requests[pr.id] = pr

class EnhancedBeeSwarmSimulation:
    """增強版 Bee Swarm 仿真 - 融合基礎設施和完整開發流程"""
    
    def __init__(self):
        self.env = simpy.Environment()
        self.random = random.Random(42)
        
        # 基礎設施資源 (保持原有)
        self.vps_preparation = simpy.Resource(self.env, capacity=2)
        self.container_deployment = simpy.Resource(self.env, capacity=3)
        self.github_api = simpy.Resource(self.env, capacity=3)
        self.ai_tools = simpy.Resource(self.env, capacity=2)
        
        # VPS 和容器
        self.vps_instances = []
        self.containers = []
        
        # GitHub 倉庫模型
        self.repo = GitHubRepository()
        
        # AI 角色 (增強協作能力)
        self.roles = {
            'pm-01': {
                'name': 'Product Manager AI',
                'ai_tool': 'Claude Code',
                'capabilities': ['prd_creation', 'task_assignment', 'uat_conduct', 'question_answering'],
                'active': False,
                'current_task': None
            },
            'be-01': {
                'name': 'Backend Developer AI',
                'ai_tool': 'Gemini CLI',
                'capabilities': ['api_design', 'database_design', 'backend_coding', 'api_alignment'],
                'active': False,
                'current_task': None
            },
            'fe-01': {
                'name': 'Frontend Developer AI',
                'ai_tool': 'Gemini CLI',
                'capabilities': ['ui_design', 'frontend_coding', 'component_creation', 'api_integration'],
                'active': False,
                'current_task': None
            },
            'de-01': {
                'name': 'DevOps Engineer AI',
                'ai_tool': 'Gemini CLI',
                'capabilities': ['deployment', 'ci_cd', 'monitoring', 'infrastructure'],
                'active': False,
                'current_task': None
            }
        }
        
        # 項目狀態追蹤
        self.project_status = {
            'phase': 'setup',  # setup -> requirements -> design -> development -> testing -> deployment
            'setup_completed': False,
            'total_tasks': 0,
            'completed_tasks': 0,
            'api_alignments': 0,
            'uat_sessions': 0,
            'deployments': 0
        }
        
    def log_event(self, event_type: EventType, actor: str, description: str, 
                  duration: Optional[float] = None, metadata: Dict = None):
        """增強的事件記錄"""
        time_str = f"[{self.env.now:6.1f}h]"
        
        # 根據事件類型使用不同的顯示樣式
        if event_type.value.startswith(('📚', '📋', '🎯', '❓', '💡', '🔀', '✅', '🚀')):
            # 重要業務事件
            print(f"{Fore.YELLOW}{time_str}{Style.RESET_ALL} {Fore.CYAN}{actor}{Style.RESET_ALL}: {Fore.GREEN}{event_type.value}{Style.RESET_ALL} - {Fore.WHITE}{description}{Style.RESET_ALL}")
        elif event_type.value.startswith(('🖥️', '🐳', '☁️', '⚙️', '🤖')):
            # 基礎設施事件
            print(f"{time_str} {actor}: {Fore.BLUE}{event_type.value}{Style.RESET_ALL} - {description}")
        else:
            # 一般開發事件
            print(f"{time_str} {actor}: {event_type.value} - {description}")
        
        # 記錄到倉庫
        self.repo.events.append({
            'timestamp': self.env.now,
            'event_type': event_type.value,
            'actor': actor,
            'description': description,
            'metadata': metadata or {}
        })
    
    def setup_infrastructure(self):
        """基礎設施設置階段 (保持原有邏輯)"""
        print(f"\n{Fore.BLUE}🔧 Phase 1: 基礎設施設置{Style.RESET_ALL}")
        
        # VPS 準備
        with self.vps_preparation.request() as req:
            yield req
            setup_time = self.random.uniform(1.0, 2.0)
            yield self.env.timeout(setup_time)
            
            vps = VPSInstance("vps-001", "Vultr", "Tokyo", 0.024)
            self.vps_instances.append(vps)
            self.log_event(EventType.VPS_PREPARATION, "System", 
                          f"準備VPS: {vps.provider} {vps.region}", setup_time)
        
        # 容器部署 (優先部署產品經理)
        pm_container = Container("pm-01", "pm-01", "vps-001", 
                                "https://pm.example.com/webhook", "running", "Claude Code")
        self.containers.append(pm_container)
        self.log_event(EventType.CONTAINER_DEPLOYMENT, "System", 
                      "部署產品經理容器 (Claude Code)")
        
        # GitHub Actions 設置
        yield self.env.timeout(0.5)
        self.log_event(EventType.GITHUB_ACTION_SETUP, "System", 
                      "配置30分鐘循環觸發")
        
        # 激活產品經理 AI
        self.roles['pm-01']['active'] = True
        self.log_event(EventType.AI_ROLE_ACTIVATION, "Product Manager AI", 
                      "產品經理 AI 激活，開始監聽任務")
        
        self.project_status['setup_completed'] = True
        self.project_status['phase'] = 'requirements'
    
    def requirements_phase(self):
        """需求分析階段"""
        while not self.project_status['setup_completed']:
            yield self.env.timeout(1)
        
        print(f"\n{Fore.GREEN}📋 Phase 2: 需求分析階段{Style.RESET_ALL}")
        
        # 人類創建 Epic
        epic = Task(
            id="EPIC-001",
            title="教育遊戲用戶註冊系統",
            type="epic",
            priority="HIGH",
            assignee="pm-01"
        )
        self.repo.create_epic(epic)
        self.log_event(EventType.EPIC_CREATED, "Human", f"創建Epic: {epic.title}")
        
        # 產品經理處理Epic
        yield self.env.timeout(self.random.uniform(1, 2))
        
        # 創建PRD
        self.log_event(EventType.PRD_CREATED, "Product Manager AI", 
                      "基於Epic創建詳細PRD")
        
        # 分解用戶故事
        user_stories = [
            Task("US-001", "用戶註冊頁面UI", "user_story", "HIGH", "fe-01"),
            Task("US-002", "用戶註冊API", "user_story", "HIGH", "be-01"),
            Task("US-003", "用戶數據庫設計", "user_story", "MEDIUM", "be-01")
        ]
        
        for story in user_stories:
            self.repo.create_issue(story)
            self.log_event(EventType.USER_STORY_CREATED, "Product Manager AI", 
                          f"創建用戶故事: {story.title}")
        
        # 任務分配
        yield self.env.timeout(0.5)
        for story in user_stories:
            self.log_event(EventType.TASK_ASSIGNMENT, "Product Manager AI", 
                          f"分配任務 '{story.title}' 給 {self.roles[story.assignee]['name']}")
        
        self.project_status['phase'] = 'design'
    
    def development_collaboration(self):
        """開發協作流程"""
        while self.project_status['phase'] not in ['design', 'development']:
            yield self.env.timeout(1)
        
        print(f"\n{Fore.CYAN}💻 Phase 3: 開發協作階段{Style.RESET_ALL}")
        
        # 前端開始開發
        yield self.env.timeout(1)
        self.log_event(EventType.FEATURE_BRANCH_CREATED, "Frontend Developer AI", 
                      "feature/user-registration-ui")
        self.log_event(EventType.CODING_STARTED, "Frontend Developer AI", 
                      "開始實現用戶註冊UI")
        
        # 後端API設計
        yield self.env.timeout(0.5)
        self.log_event(EventType.API_DESIGN_CREATED, "Backend Developer AI", 
                      "設計用戶註冊API端點")
        
        # API對齊請求
        yield self.env.timeout(2)
        self.log_event(EventType.API_ALIGNMENT_REQUEST, "Frontend Developer AI", 
                      "請求與後端進行API對齊")
        
        # 產品經理介入解答
        yield self.env.timeout(0.5)
        self.log_event(EventType.DEVELOPER_QUESTION, "Frontend Developer AI", 
                      "關於用戶註冊流程的產品邏輯疑問")
        
        yield self.env.timeout(1)
        self.log_event(EventType.PM_ANSWER, "Product Manager AI", 
                      "澄清用戶註冊流程和驗證邏輯")
        
        # API對齊完成
        yield self.env.timeout(1.5)
        self.log_event(EventType.API_ALIGNMENT_COMPLETE, "Backend Developer AI", 
                      "與前端完成API接口對齊")
        
        self.project_status['api_alignments'] += 1
        self.project_status['phase'] = 'testing'
    
    def testing_and_deployment(self):
        """測試和部署階段"""
        while self.project_status['phase'] != 'testing':
            yield self.env.timeout(1)
        
        print(f"\n{Fore.MAGENTA}🧪 Phase 4: 測試和部署階段{Style.RESET_ALL}")
        
        # 創建PR
        yield self.env.timeout(2)
        self.log_event(EventType.PR_CREATED, "Frontend Developer AI", 
                      "PR: 用戶註冊UI實現")
        self.log_event(EventType.PR_CREATED, "Backend Developer AI", 
                      "PR: 用戶註冊API實現")
        
        # 代碼審查
        yield self.env.timeout(1.5)
        self.log_event(EventType.CODE_REVIEW_APPROVED, "Product Manager AI", 
                      "前端註冊UI代碼審查通過")
        
        # 單元測試
        yield self.env.timeout(1)
        self.log_event(EventType.UNIT_TEST_WRITTEN, "Backend Developer AI", 
                      "編寫用戶註冊API單元測試")
        self.log_event(EventType.TEST_PASSED, "Backend Developer AI", 
                      "API單元測試全部通過")
        
        # UAT階段
        yield self.env.timeout(2)
        self.log_event(EventType.UAT_STARTED, "Product Manager AI", 
                      "開始用戶註冊功能UAT")
        
        yield self.env.timeout(3)
        self.log_event(EventType.UAT_COMPLETED, "Product Manager AI", 
                      "UAT通過，功能符合預期")
        
        self.project_status['uat_sessions'] += 1
        
        # 部署
        yield self.env.timeout(1)
        self.log_event(EventType.DEPLOYMENT_STARTED, "DevOps Engineer AI", 
                      "開始部署用戶註冊功能到生產環境")
        
        yield self.env.timeout(2)
        self.log_event(EventType.DEPLOYMENT_COMPLETED, "DevOps Engineer AI", 
                      "部署成功，功能已上線")
        
        # 項目發布
        yield self.env.timeout(0.5)
        self.log_event(EventType.PROJECT_RELEASE, "Product Manager AI", 
                      "🎉 教育遊戲用戶註冊系統正式發布！")
        
        self.project_status['deployments'] += 1
    
    def github_action_cycle(self):
        """GitHub Action 30分鐘循環 (保持原有機制)"""
        while True:
            if self.project_status['setup_completed']:
                self.log_event(EventType.GITHUB_ACTION_TRIGGER, "GitHub Actions", 
                              "30分鐘定時觸發")
                
                # 檢查是否有待處理任務
                pending_issues = [issue for issue in self.repo.issues.values() 
                                if issue.status == "待處理"]
                if pending_issues:
                    self.log_event(EventType.AI_AGENT_WAKEUP, "System", 
                                  f"發現 {len(pending_issues)} 個待處理任務，喚醒相關AI")
            
            yield self.env.timeout(30)  # 30分鐘
    
    def run_simulation(self, duration_hours=120):
        """運行增強版仿真"""
        print(f"{Fore.BLUE}{'='*80}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}🐝 Bee Swarm 增強版事件驅動仿真{Style.RESET_ALL}")
        print(f"{Fore.BLUE}{'='*80}{Style.RESET_ALL}")
        print(f"融合特性:")
        print(f"  ✅ 真實基礎設施模擬 (VPS + 容器)")
        print(f"  ✅ 完整軟體開發生命週期")
        print(f"  ✅ 增強角色協作模型")
        print(f"  ✅ GitHub-Centric 架構")
        print(f"{Fore.BLUE}{'='*80}{Style.RESET_ALL}")
        
        # 啟動所有流程
        self.env.process(self.setup_infrastructure())
        self.env.process(self.requirements_phase())
        self.env.process(self.development_collaboration())
        self.env.process(self.testing_and_deployment())
        self.env.process(self.github_action_cycle())
        
        # 運行仿真
        start_time = time.time()
        self.env.run(until=duration_hours)
        end_time = time.time()
        
        # 輸出結果
        self.print_enhanced_results(end_time - start_time)
    
    def print_enhanced_results(self, real_time):
        """輸出增強版結果"""
        print(f"\n{Fore.BLUE}{'='*80}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}📊 增強版仿真結果{Style.RESET_ALL}")
        print(f"{Fore.BLUE}{'='*80}{Style.RESET_ALL}")
        
        print(f"\n🏗️ 基礎設施統計:")
        print(f"  VPS實例: {len(self.vps_instances)}")
        print(f"  容器部署: {len(self.containers)}")
        print(f"  AI角色激活: {sum(1 for role in self.roles.values() if role['active'])}")
        
        print(f"\n📋 項目管理統計:")
        print(f"  Epic數量: {len(self.repo.epics)}")
        print(f"  用戶故事: {len(self.repo.issues)}")
        print(f"  Pull Request: {len(self.repo.pull_requests)}")
        print(f"  API對齊次數: {self.project_status['api_alignments']}")
        print(f"  UAT會話: {self.project_status['uat_sessions']}")
        print(f"  部署次數: {self.project_status['deployments']}")
        
        print(f"\n📈 事件統計:")
        event_counts = {}
        for event in self.repo.events:
            event_type = event['event_type']
            event_counts[event_type] = event_counts.get(event_type, 0) + 1
        
        print(f"  總事件數: {len(self.repo.events)}")
        print(f"  事件類型數: {len(event_counts)}")
        
        print(f"\n⏱️ 執行統計:")
        print(f"  模擬時間: {self.env.now:.1f} 小時")
        print(f"  實際執行時間: {real_time:.2f} 秒")
        print(f"  當前階段: {self.project_status['phase']}")

if __name__ == "__main__":
    print("啟動增強版 Bee Swarm 仿真...")
    sim = EnhancedBeeSwarmSimulation()
    sim.run_simulation(duration_hours=24) 