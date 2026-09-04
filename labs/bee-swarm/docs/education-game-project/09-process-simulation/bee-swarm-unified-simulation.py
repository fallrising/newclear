"""
Bee Swarm 真实事件驱动仿真
基于项目实际架构和约束的完整模拟
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

# 配置参数
SETUP_TIME = 8  # 前期配置时间（小时）
SIMULATION_TIME = 100  # 项目运行时间（小时）
RANDOM_SEED = 42

class EventType(Enum):
    """事件类型枚举"""
    # 前期配置阶段
    VPS_PREPARATION = "VPS准备"
    ACCOUNT_SETUP = "账号配置"
    TOKEN_GENERATION = "Token生成"
    CONTAINER_DEPLOYMENT = "容器部署"
    CLOUDFLARE_TUNNEL_SETUP = "Cloudflare Tunnel配置"
    WEBHOOK_REGISTRATION = "Webhook注册"
    GITHUB_ACTION_SETUP = "GitHub Action配置"
    AI_ROLE_ACTIVATION = "AI角色激活"
    
    # 重要事件节点 (高亮显示)
    HUMAN_ISSUE_CREATED = "🎯 人类创建Issue"
    PM_PRD_CREATED = "📋 产品经理创建PRD"
    TASK_ASSIGNMENT = "🎯 任务分配"
    DEVELOPER_QUESTION = "❓ 开发者提出疑问"
    PM_ANSWER = "💡 产品经理解答"
    PR_CREATED = "🔀 PR创建"
    CODE_REVIEW_COMPLETE = "✅ 代码审查完成"
    PROJECT_RELEASE = "🚀 项目发布"
    
    # 常规事件
    GITHUB_ACTION_TRIGGER = "GitHub Action触发"
    WEBHOOK_RECEIVED = "Webhook接收"
    AI_AGENT_WAKEUP = "AI Agent唤醒"
    TASK_PROCESSING = "任务处理"
    AI_TOOL_USED = "AI工具使用"
    DEFAULT_TASK_EXECUTED = "默认任务执行"

@dataclass
class VPSInstance:
    """VPS实例"""
    id: str
    provider: str
    region: str
    cost_per_hour: float

@dataclass
class Container:
    """容器实例"""
    id: str
    role_id: str
    vps_id: str
    webhook_url: str
    status: str
    ai_tool: str  # Claude Code 或 Gemini CLI

@dataclass
class Role:
    """AI 角色"""
    name: str
    container_id: str
    ai_tool: str
    prompt_template: str
    default_tasks: List[str] = field(default_factory=list)
    completed_tasks: int = 0
    total_work_time: float = 0.0
    webhook_calls: int = 0
    is_active: bool = False
    is_pm: bool = False  # 是否为产品经理

@dataclass
class Task:
    """开发任务"""
    id: str
    title: str
    assigned_role: str
    status: str
    created_time: float
    issue_id: str

@dataclass
class GitHubIssue:
    """GitHub Issue"""
    id: str
    title: str
    description: str
    created_by: str
    created_time: float
    status: str
    assigned_to: Optional[str] = None
    comments: List[Dict] = field(default_factory=list)

class BeeSwarmRealisticSimulation:
    """Bee Swarm 真实事件驱动仿真"""
    
    def __init__(self):
        self.env = simpy.Environment()
        self.random = random.Random(RANDOM_SEED)
        
        # 创建资源
        self.vps_preparation = simpy.Resource(self.env, capacity=2)
        self.container_deployment = simpy.Resource(self.env, capacity=3)
        self.github_api = simpy.Resource(self.env, capacity=3)
        self.ai_tools = simpy.Resource(self.env, capacity=2)
        
        # 基础设施
        self.vps_instances = []
        self.containers = []
        
        # 创建 AI 角色 (产品经理优先)
        self.roles = {
            'pm-01': Role(
                name='Product Manager AI',
                container_id='pm-01',
                ai_tool='Claude Code',
                prompt_template="你是一个产品经理AI，负责需求分析、任务分配和项目协调。使用Claude Code进行PRD编写和任务分解。",
                default_tasks=['需求分析', '竞品调研', '用户反馈分析'],
                is_pm=True
            ),
            'be-01': Role(
                name='Backend Developer AI',
                container_id='be-01',
                ai_tool='Gemini CLI',
                prompt_template="你是一个后端开发AI，负责API设计、数据库设计和系统架构。使用Gemini CLI进行代码开发。",
                default_tasks=['API性能优化', '数据库维护', '系统监控']
            ),
            'fe-01': Role(
                name='Frontend Developer AI',
                container_id='fe-01',
                ai_tool='Gemini CLI',
                prompt_template="你是一个前端开发AI，负责用户界面设计和前端功能实现。使用Gemini CLI进行代码开发。",
                default_tasks=['UI组件库维护', '性能优化', '用户体验分析']
            ),
            'de-01': Role(
                name='DevOps Engineer AI',
                container_id='de-01',
                ai_tool='Gemini CLI',
                prompt_template="你是一个DevOps工程师AI，负责部署、监控和系统运维。使用Gemini CLI进行自动化脚本编写。",
                default_tasks=['系统监控', '安全扫描', '性能分析']
            )
        }
        
        # 数据存储
        self.tasks = []
        self.github_issues = []
        self.event_log = []
        
        # 项目状态
        self.project_status = {
            'setup_completed': False,
            'total_tasks': 0,
            'completed_tasks': 0,
            'total_events': 0,
            'webhook_calls': 0,
            'setup_cost': 0.0,
            'pm_activated': False
        }
        
        # 控制标志
        self.setup_phase_completed = False
        self.issue_processed = False
        
    def log_event(self, event_type: EventType, role_id: str, description: str, 
                  duration: Optional[float] = None, is_important: bool = False):
        """记录事件，重要事件使用高亮显示"""
        self.project_status['total_events'] += 1
        
        time_str = f"[{self.env.now:6.1f}h]"
        role_str = f"{self.roles[role_id].name}" if role_id in self.roles else "System"
        event_str = f"{event_type.value}"
        desc_str = f"{description}"
        
        # 重要事件使用高亮显示
        if is_important or event_type.value.startswith(('🎯', '📋', '❓', '💡', '🔀', '✅', '🚀')):
            print(f"{Fore.YELLOW}{time_str}{Style.RESET_ALL} {Fore.CYAN}{role_str}{Style.RESET_ALL}: {Fore.GREEN}{event_str}{Style.RESET_ALL} - {Fore.WHITE}{desc_str}{Style.RESET_ALL}")
        else:
            if duration:
                print(f"{time_str} {role_str}: {event_str} - {desc_str} (耗时: {duration:.1f}h)")
            else:
                print(f"{time_str} {role_str}: {event_str} - {desc_str}")
    
    def setup_phase(self):
        """前期配置阶段"""
        print(f"\n{Fore.BLUE}🔧 开始前期配置阶段...{Style.RESET_ALL}")
        
        # 1. VPS准备 (非大厂)
        yield from self.prepare_vps_instances()
        
        # 2. 容器部署 (产品经理优先)
        yield from self.deploy_containers()
        
        # 3. Cloudflare Tunnel配置
        yield from self.setup_cloudflare_tunnels()
        
        # 4. Webhook注册
        yield from self.register_webhooks()
        
        # 5. GitHub Action配置
        yield from self.setup_github_actions()
        
        # 6. AI角色激活 (产品经理优先)
        yield from self.activate_ai_roles()
        
        self.project_status['setup_completed'] = True
        self.setup_phase_completed = True
        print(f"\n{Fore.GREEN}✅ 前期配置完成！总耗时: {self.env.now:.1f}小时，总成本: ${self.project_status['setup_cost']:.2f}{Style.RESET_ALL}")
    
    def prepare_vps_instances(self):
        """准备VPS实例 (非大厂)"""
        vps_configs = [
            {'provider': 'Vultr', 'region': 'Tokyo', 'cost': 0.018},
            {'provider': 'Linode', 'region': 'Singapore', 'cost': 0.015},
            {'provider': 'DigitalOcean', 'region': 'NYC1', 'cost': 0.02}
        ]
        
        for i, config in enumerate(vps_configs):
            with self.vps_preparation.request() as request:
                yield request
                
                setup_time = self.random.uniform(0.5, 1.5)
                yield self.env.timeout(setup_time)
                
                vps = VPSInstance(
                    id=f"vps-{i+1:02d}",
                    provider=config['provider'],
                    region=config['region'],
                    cost_per_hour=config['cost']
                )
                self.vps_instances.append(vps)
                self.project_status['setup_cost'] += setup_time * config['cost']
                
                self.log_event(EventType.VPS_PREPARATION, 'system', 
                              f"准备VPS: {vps.provider} {vps.region}", setup_time)
    
    def deploy_containers(self):
        """部署容器 (产品经理优先)"""
        # 产品经理优先部署
        role_order = ['pm-01', 'be-01', 'fe-01', 'de-01']
        
        for i, role_id in enumerate(role_order):
            with self.container_deployment.request() as request:
                yield request
                
                vps = self.vps_instances[i % len(self.vps_instances)]
                deployment_time = self.random.uniform(1, 3)
                yield self.env.timeout(deployment_time)
                
                role = self.roles[role_id]
                container = Container(
                    id=f"container-{role_id}",
                    role_id=role_id,
                    vps_id=vps.id,
                    webhook_url=f"https://webhook.{role_id}.bee-swarm.com",
                    status='running',
                    ai_tool=role.ai_tool
                )
                self.containers.append(container)
                
                self.log_event(EventType.CONTAINER_DEPLOYMENT, 'system', 
                              f"部署容器: {role_id} ({role.ai_tool}) 到 {vps.provider}", deployment_time)
    
    def setup_cloudflare_tunnels(self):
        """配置Cloudflare Tunnel"""
        for container in self.containers:
            setup_time = self.random.uniform(0.3, 0.8)
            yield self.env.timeout(setup_time)
            
            self.log_event(EventType.CLOUDFLARE_TUNNEL_SETUP, 'system', 
                          f"配置Tunnel: {container.webhook_url}", setup_time)
    
    def register_webhooks(self):
        """注册Webhook"""
        for container in self.containers:
            registration_time = self.random.uniform(0.1, 0.4)
            yield self.env.timeout(registration_time)
            
            self.log_event(EventType.WEBHOOK_REGISTRATION, 'system', 
                          f"注册Webhook: {container.webhook_url}", registration_time)
    
    def setup_github_actions(self):
        """配置GitHub Actions"""
        setup_time = self.random.uniform(0.5, 1.0)
        yield self.env.timeout(setup_time)
        
        self.log_event(EventType.GITHUB_ACTION_SETUP, 'system', 
                      "配置GitHub Actions定时触发器 (每30分钟)", setup_time)
    
    def activate_ai_roles(self):
        """激活AI角色 (产品经理优先)"""
        # 产品经理优先激活
        role_order = ['pm-01', 'be-01', 'fe-01', 'de-01']
        
        for role_id in role_order:
            activation_time = self.random.uniform(0.2, 0.6)
            yield self.env.timeout(activation_time)
            
            role = self.roles[role_id]
            role.is_active = True
            
            if role.is_pm:
                self.project_status['pm_activated'] = True
            
            self.log_event(EventType.AI_ROLE_ACTIVATION, role_id, 
                          f"激活AI角色: {role.name} ({role.ai_tool})", activation_time)
    
    def github_action_trigger(self):
        """GitHub Actions定时触发"""
        while True:
            if self.setup_phase_completed:
                # 每30分钟触发一次
                yield self.env.timeout(0.5)  # 30分钟 = 0.5小时
                
                self.project_status['webhook_calls'] += 1
                self.log_event(EventType.GITHUB_ACTION_TRIGGER, 'system', 
                              f"GitHub Action触发 #{self.project_status['webhook_calls']}")
                
                # 优先选择产品经理，然后轮询其他角色
                if self.project_status['pm_activated']:
                    # 产品经理优先处理
                    yield from self.process_webhook('pm-01')
                else:
                    # 轮询其他角色
                    active_roles = [role_id for role_id, role in self.roles.items() 
                                   if role.is_active and not role.is_pm]
                    if active_roles:
                        selected_role = active_roles[self.project_status['webhook_calls'] % len(active_roles)]
                        yield from self.process_webhook(selected_role)
            else:
                yield self.env.timeout(0.1)
    
    def process_webhook(self, role_id):
        """处理Webhook"""
        role = self.roles[role_id]
        
        # 检查是否有未完成的任务
        pending_tasks = [task for task in self.tasks 
                        if task.assigned_role == role_id and task.status == 'pending']
        
        if pending_tasks:
            # 有任务需要处理
            self.log_event(EventType.WEBHOOK_RECEIVED, role_id, 
                          f"Webhook触发任务处理")
            
            # 唤醒AI Agent
            yield from self.wakeup_ai_agent(role_id)
            
            # 处理任务
            task = pending_tasks[0]
            yield from self.process_task(role_id, task)
        else:
            # 执行默认任务
            self.log_event(EventType.WEBHOOK_RECEIVED, role_id, 
                          f"Webhook触发默认任务")
            
            yield from self.wakeup_ai_agent(role_id)
            yield from self.execute_default_task(role_id)
        
        role.webhook_calls += 1
    
    def wakeup_ai_agent(self, role_id):
        """唤醒AI Agent"""
        role = self.roles[role_id]
        
        wakeup_time = self.random.uniform(0.1, 0.3)
        yield self.env.timeout(wakeup_time)
        
        self.log_event(EventType.AI_AGENT_WAKEUP, role_id, 
                      f"AI Agent唤醒，加载Prompt: {role.prompt_template[:50]}...", wakeup_time)
    
    def process_task(self, role_id, task):
        """处理分配的任务"""
        role = self.roles[role_id]
        
        task.status = 'in_progress'
        
        self.log_event(EventType.TASK_PROCESSING, role_id, 
                      f"开始任务: {task.title}")
        
        # 使用AI工具进行开发
        with self.ai_tools.request() as request:
            yield request
            ai_time = self.random.uniform(2, 4)
            yield self.env.timeout(ai_time)
            role.total_work_time += ai_time
            
            self.log_event(EventType.AI_TOOL_USED, role_id, 
                          f"使用{role.ai_tool}执行任务", ai_time)
        
        # 开发时间
        development_time = self.random.uniform(8, 16)
        yield self.env.timeout(development_time)
        role.total_work_time += development_time
        
        # 如果是产品经理，创建PRD
        if role.is_pm:
            self.log_event(EventType.PM_PRD_CREATED, role_id, 
                          f"创建PRD: {task.title}", is_important=True)
        
        # 创建Pull Request
        with self.github_api.request() as request:
            yield request
            pr_time = self.random.uniform(0.2, 0.5)
            yield self.env.timeout(pr_time)
            role.total_work_time += pr_time
            
            self.log_event(EventType.PR_CREATED, role_id, 
                          f"创建PR: 实现 {task.title}", pr_time, is_important=True)
        
        task.status = 'completed'
        role.completed_tasks += 1
        self.project_status['completed_tasks'] += 1
    
    def execute_default_task(self, role_id):
        """执行默认任务"""
        role = self.roles[role_id]
        default_task = self.random.choice(role.default_tasks)
        default_time = self.random.uniform(1, 3)
        yield self.env.timeout(default_time)
        role.total_work_time += default_time
        
        self.log_event(EventType.DEFAULT_TASK_EXECUTED, role_id, 
                      f"执行默认任务: {default_task}", default_time)
    
    def human_po_process(self):
        """人类PO发布任务流程"""
        while True:
            if self.setup_phase_completed and self.env.now < SETUP_TIME + 15 and not self.issue_processed:
                # 创建GitHub Issue
                issue = GitHubIssue(
                    id=f"ISSUE-{len(self.github_issues)+1:03d}",
                    title="开发教育游戏用户注册功能",
                    description="需要实现用户注册、登录、密码重置功能，包括前端界面和后端API",
                    created_by="human_po",
                    created_time=self.env.now,
                    status="open"
                )
                self.github_issues.append(issue)
                
                # 重要事件：人类创建Issue
                self.log_event(EventType.HUMAN_ISSUE_CREATED, 'pm-01', 
                              f"人类PO发布任务: {issue.title}", is_important=True)
                
                # 产品经理创建PRD
                yield from self.pm_create_prd(issue)
                
                # 创建开发任务
                yield from self.create_development_tasks(issue)
                
                self.issue_processed = True
                break  # 只创建一次任务
            
            yield self.env.timeout(self.random.uniform(1, 2))
    
    def pm_create_prd(self, issue: GitHubIssue):
        """产品经理创建PRD"""
        role = self.roles['pm-01']
        
        # 使用Claude Code创建PRD
        with self.ai_tools.request() as request:
            yield request
            prd_time = self.random.uniform(3, 5)
            yield self.env.timeout(prd_time)
            role.total_work_time += prd_time
            
            self.log_event(EventType.PM_PRD_CREATED, 'pm-01', 
                          f"使用Claude Code创建PRD: {issue.title}", prd_time, is_important=True)
    
    def create_development_tasks(self, issue: GitHubIssue):
        """创建开发任务"""
        task_templates = [
            {'title': '后端API设计', 'assigned_role': 'be-01'},
            {'title': '数据库设计', 'assigned_role': 'be-01'},
            {'title': '前端注册界面', 'assigned_role': 'fe-01'},
            {'title': '前端登录界面', 'assigned_role': 'fe-01'},
            {'title': '部署配置', 'assigned_role': 'de-01'}
        ]
        
        for template in task_templates:
            task = Task(
                id=f"TASK-{len(self.tasks)+1:03d}",
                title=template['title'],
                assigned_role=template['assigned_role'],
                status='pending',
                created_time=self.env.now,
                issue_id=issue.id
            )
            self.tasks.append(task)
            self.project_status['total_tasks'] += 1
            
            # 重要事件：任务分配
            self.log_event(EventType.TASK_ASSIGNMENT, 'pm-01', 
                          f"分配任务: {template['title']} -> {self.roles[template['assigned_role']].name}", 
                          is_important=True)
            
            # 添加一个小延迟
            yield self.env.timeout(0.1)
    
    def developer_question_process(self):
        """开发者提问流程"""
        while True:
            if self.setup_phase_completed and self.tasks:
                # 模拟开发者提出疑问
                if self.random.random() < 0.3:  # 30%概率提问
                    pending_tasks = [t for t in self.tasks if t.status == 'pending']
                    if pending_tasks:
                        task = self.random.choice(pending_tasks)
                        role_id = task.assigned_role
                        
                        # 重要事件：开发者提出疑问
                        self.log_event(EventType.DEVELOPER_QUESTION, role_id, 
                                      f"在任务 '{task.title}' 中提出疑问", is_important=True)
                        
                        # 产品经理解答
                        yield self.env.timeout(self.random.uniform(1, 3))
                        self.log_event(EventType.PM_ANSWER, 'pm-01', 
                                      f"解答 {self.roles[role_id].name} 的疑问", is_important=True)
            
            yield self.env.timeout(self.random.uniform(10, 20))
    
    def code_review_process(self):
        """代码审查流程"""
        while True:
            if self.setup_phase_completed:
                # 模拟代码审查完成
                completed_tasks = [t for t in self.tasks if t.status == 'completed']
                for task in completed_tasks:
                    if not hasattr(task, 'reviewed'):
                        review_time = self.random.uniform(1, 3)
                        yield self.env.timeout(review_time)
                        
                        # 重要事件：代码审查完成
                        self.log_event(EventType.CODE_REVIEW_COMPLETE, 'pm-01', 
                                      f"任务 '{task.title}' 代码审查通过", is_important=True)
                        task.reviewed = True
            
            yield self.env.timeout(self.random.uniform(5, 10))
    
    def project_release_process(self):
        """项目发布流程"""
        while True:
            if self.setup_phase_completed:
                # 检查是否所有任务都完成
                all_tasks_completed = all(task.status == 'completed' for task in self.tasks)
                if all_tasks_completed and self.tasks and not hasattr(self, 'released'):
                    release_time = self.random.uniform(2, 4)
                    yield self.env.timeout(release_time)
                    
                    # 重要事件：项目发布
                    self.log_event(EventType.PROJECT_RELEASE, 'de-01', 
                                  f"教育游戏用户注册功能正式发布！", is_important=True)
                    self.released = True
            
            yield self.env.timeout(self.random.uniform(20, 30))
    
    def run_simulation(self):
        """运行仿真"""
        print(f"{Fore.BLUE}{'='*80}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}🐝 Bee Swarm 真实事件驱动仿真{Style.RESET_ALL}")
        print(f"{Fore.BLUE}{'='*80}{Style.RESET_ALL}")
        print(f"配置时间: {SETUP_TIME} 小时")
        print(f"项目时间: {SIMULATION_TIME} 小时")
        print(f"AI 角色容器: {len(self.roles)} 个")
        print(f"产品经理工具: Claude Code")
        print(f"其他角色工具: Gemini CLI")
        print(f"{Fore.BLUE}{'='*80}{Style.RESET_ALL}")
        
        # 启动各个流程
        self.env.process(self.setup_phase())
        self.env.process(self.github_action_trigger())
        self.env.process(self.human_po_process())
        self.env.process(self.developer_question_process())
        self.env.process(self.code_review_process())
        self.env.process(self.project_release_process())
        
        # 运行仿真
        start_time = time.time()
        self.env.run(until=SETUP_TIME + SIMULATION_TIME)
        end_time = time.time()
        
        # 输出结果
        self.print_detailed_results(end_time - start_time)
    
    def print_detailed_results(self, real_time):
        """输出详细仿真结果"""
        print(f"\n{Fore.BLUE}{'='*80}{Style.RESET_ALL}")
        print(f"{Fore.CYAN}📊 真实仿真详细结果{Style.RESET_ALL}")
        print(f"{Fore.BLUE}{'='*80}{Style.RESET_ALL}")
        
        print(f"配置时间: {SETUP_TIME} 小时")
        print(f"项目时间: {SIMULATION_TIME} 小时")
        print(f"实际运行时间: {real_time:.2f} 秒")
        
        print(f"\n{Fore.YELLOW}💰 基础设施成本:{Style.RESET_ALL}")
        print(f"  配置成本: ${self.project_status['setup_cost']:.2f}")
        total_vps_cost = sum(vps.cost_per_hour * SIMULATION_TIME for vps in self.vps_instances)
        print(f"  运行成本: ${total_vps_cost:.2f}")
        print(f"  总成本: ${self.project_status['setup_cost'] + total_vps_cost:.2f}")
        
        print(f"\n{Fore.GREEN}📈 项目活动统计:{Style.RESET_ALL}")
        print(f"  总事件数: {self.project_status['total_events']}")
        print(f"  总任务数: {self.project_status['total_tasks']}")
        print(f"  完成任务数: {self.project_status['completed_tasks']}")
        print(f"  完成率: {self.project_status['completed_tasks']/self.project_status['total_tasks']*100:.1f}%" if self.project_status['total_tasks'] > 0 else "0%")
        print(f"  Webhook调用: {self.project_status['webhook_calls']}")
        
        print(f"\n{Fore.CYAN}👥 角色工作量统计:{Style.RESET_ALL}")
        for role_id, role in self.roles.items():
            utilization = role.total_work_time / SIMULATION_TIME * 100
            print(f"  {role.name} ({role.ai_tool}):")
            print(f"    完成任务: {role.completed_tasks} 个")
            print(f"    总工作时间: {role.total_work_time:.1f} 小时")
            print(f"    利用率: {utilization:.1f}%")
            print(f"    Webhook调用: {role.webhook_calls} 次")
        
        print(f"\n{Fore.MAGENTA}🎯 重要事件节点:{Style.RESET_ALL}")
        important_events = [event for event in self.event_log 
                           if event.event_type.value.startswith(('🎯', '📋', '❓', '💡', '🔀', '✅', '🚀'))]
        for event in important_events:
            print(f"  {event.event_type.value}: {event.description}")
        
        print(f"\n{Fore.BLUE}⚡ 基础设施统计:{Style.RESET_ALL}")
        print(f"  VPS 实例: {len(self.vps_instances)} 个")
        print(f"  容器实例: {len(self.containers)} 个")
        print(f"  活跃AI角色: {sum(1 for role in self.roles.values() if role.is_active)} 个")

def main():
    """主函数"""
    print(f"{Fore.CYAN}🚀 启动 Bee Swarm 真实事件驱动仿真...{Style.RESET_ALL}")
    
    # 创建仿真实例
    simulation = BeeSwarmRealisticSimulation()
    
    # 运行仿真
    simulation.run_simulation()

if __name__ == "__main__":
    main() 