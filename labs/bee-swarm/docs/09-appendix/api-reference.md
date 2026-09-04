# API 參考

## 本章概要

本章提供 Bee Swarm 項目中涉及的主要 API 參考，包括 GitHub API、模擬器 API 和自定義 API 接口。

- **章節目標**：提供完整的 API 參考文檔
- **主要內容**：GitHub API、模擬器 API、擴展接口
- **閱讀收穫**：掌握所有可用的 API 接口和使用方法

## 🌐 GitHub API 參考

### 認證方式

#### Personal Access Token
```bash
# 設置環境變量
export GITHUB_TOKEN="your_personal_access_token"

# 在請求中使用
curl -H "Authorization: token $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/user
```

#### GitHub Apps
```python
import jwt
import time
import requests

def generate_jwt_token(app_id, private_key):
    payload = {
        'iat': int(time.time()),
        'exp': int(time.time()) + (10 * 60),  # 10分鐘
        'iss': app_id
    }
    return jwt.encode(payload, private_key, algorithm='RS256')

def get_installation_token(app_id, installation_id, private_key):
    jwt_token = generate_jwt_token(app_id, private_key)
    
    headers = {
        'Authorization': f'Bearer {jwt_token}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    response = requests.post(
        f'https://api.github.com/app/installations/{installation_id}/access_tokens',
        headers=headers
    )
    
    return response.json()['token']
```

### Issues API

#### 獲取 Issues 列表
```http
GET /repos/{owner}/{repo}/issues

Parameters:
- state: open, closed, all (default: open)
- labels: 標籤篩選 (comma-separated)
- assignee: 分配者篩選
- creator: 創建者篩選
- since: ISO 8601 時間戳
- per_page: 每頁數量 (default: 30, max: 100)
- page: 頁碼 (default: 1)
```

**示例請求：**
```bash
curl -H "Authorization: token $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     "https://api.github.com/repos/owner/repo/issues?state=open&labels=bug,enhancement"
```

**響應格式：**
```json
[
  {
    "id": 1,
    "number": 347,
    "title": "Found a bug",
    "user": {
      "login": "octocat",
      "id": 1
    },
    "labels": [
      {
        "id": 208045946,
        "name": "bug",
        "color": "d73a4a"
      }
    ],
    "state": "open",
    "assignee": null,
    "assignees": [],
    "milestone": null,
    "comments": 0,
    "created_at": "2011-04-22T13:33:48Z",
    "updated_at": "2011-04-22T13:33:48Z",
    "closed_at": null,
    "body": "I'm having a problem with this."
  }
]
```

#### 創建 Issue
```http
POST /repos/{owner}/{repo}/issues

Content-Type: application/json
```

**請求體：**
```json
{
  "title": "Found a bug",
  "body": "I'm having a problem with this.",
  "assignees": ["octocat"],
  "milestone": 1,
  "labels": ["bug"]
}
```

**Python 示例：**
```python
import requests

def create_issue(owner, repo, title, body, labels=None, assignees=None):
    url = f"https://api.github.com/repos/{owner}/{repo}/issues"
    
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    data = {
        'title': title,
        'body': body
    }
    
    if labels:
        data['labels'] = labels
    if assignees:
        data['assignees'] = assignees
    
    response = requests.post(url, headers=headers, json=data)
    return response.json()
```

#### 更新 Issue
```http
PATCH /repos/{owner}/{repo}/issues/{issue_number}
```

**請求體：**
```json
{
  "title": "Found a bug",
  "body": "I'm having a problem with this.",
  "state": "closed",
  "labels": ["bug", "resolved"]
}
```

### Pull Requests API

#### 獲取 PR 列表
```http
GET /repos/{owner}/{repo}/pulls

Parameters:
- state: open, closed, all (default: open)
- head: 頭分支篩選
- base: 基分支篩選 (default: default branch)
- sort: created, updated, popularity (default: created)
- direction: asc, desc (default: desc)
```

#### 創建 Pull Request
```http
POST /repos/{owner}/{repo}/pulls
```

**請求體：**
```json
{
  "title": "Amazing new feature",
  "body": "Please pull these awesome changes",
  "head": "octocat:new-feature",
  "base": "master"
}
```

**Python 示例：**
```python
def create_pull_request(owner, repo, title, body, head, base):
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
    
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    data = {
        'title': title,
        'body': body,
        'head': head,
        'base': base
    }
    
    response = requests.post(url, headers=headers, json=data)
    return response.json()
```

### Projects API

#### 獲取項目列表
```http
GET /repos/{owner}/{repo}/projects
```

#### 創建項目
```http
POST /repos/{owner}/{repo}/projects
```

**請求體：**
```json
{
  "name": "My Projects",
  "body": "A board to manage my project."
}
```

### Actions API

#### 獲取工作流程列表
```http
GET /repos/{owner}/{repo}/actions/workflows
```

#### 觸發工作流程
```http
POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
```

**請求體：**
```json
{
  "ref": "main",
  "inputs": {
    "environment": "production"
  }
}
```

## 🎯 Bee Swarm 模擬器 API

### 核心類和方法

#### BeeSwarmSimulator 類
```python
class BeeSwarmSimulator:
    """Bee Swarm 主模擬器類"""
    
    def __init__(self, config: SimulationConfig):
        """
        初始化模擬器
        
        Args:
            config: 模擬配置對象
        """
        pass
    
    def add_role(self, role_type: str, role_class: Type) -> None:
        """
        添加角色類型
        
        Args:
            role_type: 角色類型名稱
            role_class: 角色類
        """
        pass
    
    def run(self, duration: int) -> SimulationResult:
        """
        運行模擬
        
        Args:
            duration: 模擬持續時間（時間單位）
            
        Returns:
            模擬結果對象
        """
        pass
```

#### 配置類
```python
@dataclass
class SimulationConfig:
    """模擬配置"""
    
    # 基本配置
    duration: int = 100
    random_seed: Optional[int] = None
    log_level: str = "INFO"
    
    # 團隊配置
    team_size: int = 4
    roles: List[str] = field(default_factory=lambda: ["PM", "Backend", "Frontend", "DevOps"])
    
    # 工作負載配置
    task_arrival_rate: float = 0.125  # 每小時任務數
    task_complexity_distribution: str = "normal"
    task_complexity_params: Dict = field(default_factory=lambda: {"mean": 5, "std": 2})
    
    # 質量配置
    defect_rate: float = 0.1
    rework_probability: float = 0.2
    review_probability: float = 0.8
    
    # 性能配置
    automation_level: float = 0.5
    communication_overhead: float = 0.1
    context_switch_cost: float = 0.1

@dataclass 
class SimulationResult:
    """模擬結果"""
    
    # 基本統計
    duration: int
    tasks_created: int
    tasks_completed: int
    completion_rate: float
    
    # 性能指標
    throughput: float
    average_cycle_time: float
    average_wait_time: float
    
    # 質量指標
    defect_count: int
    rework_count: int
    first_pass_yield: float
    
    # 資源利用率
    role_utilization: Dict[str, float]
    
    # 詳細數據
    task_history: List[Dict]
    event_log: List[Dict]
    metrics_timeline: Dict[str, List]
```

#### 角色基類
```python
class Role:
    """角色基類"""
    
    def __init__(self, env: simpy.Environment, name: str, skills: Dict[str, float]):
        """
        初始化角色
        
        Args:
            env: SimPy 環境
            name: 角色名稱
            skills: 技能字典 {task_type: skill_level}
        """
        pass
    
    def work(self) -> Generator:
        """主要工作循環"""
        pass
    
    def estimate_time(self, task: Task) -> float:
        """估算任務時間"""
        pass
    
    def can_handle(self, task: Task) -> bool:
        """判斷是否能處理任務"""
        pass
```

### 工具函數

#### 數據分析函數
```python
def calculate_metrics(simulation_result: SimulationResult) -> Dict[str, Any]:
    """
    計算擴展指標
    
    Args:
        simulation_result: 模擬結果
        
    Returns:
        擴展指標字典
    """
    pass

def compare_scenarios(results: List[SimulationResult]) -> pd.DataFrame:
    """
    比較多個場景
    
    Args:
        results: 模擬結果列表
        
    Returns:
        比較結果 DataFrame
    """
    pass

def plot_metrics(result: SimulationResult, metrics: List[str]) -> None:
    """
    繪製指標圖表
    
    Args:
        result: 模擬結果
        metrics: 要繪製的指標列表
    """
    pass
```

#### 配置生成函數
```python
def create_agile_config(**kwargs) -> SimulationConfig:
    """創建敏捷開發配置"""
    pass

def create_waterfall_config(**kwargs) -> SimulationConfig:
    """創建瀑布開發配置"""
    pass

def create_devops_config(**kwargs) -> SimulationConfig:
    """創建 DevOps 配置"""
    pass
```

### 擴展接口

#### 自定義角色接口
```python
class CustomRole(Role):
    """自定義角色示例"""
    
    def __init__(self, env, name, skills, custom_params=None):
        super().__init__(env, name, skills)
        self.custom_params = custom_params or {}
    
    def work(self):
        while True:
            # 自定義工作邏輯
            task = yield self.task_queue.get()
            
            # 處理任務
            processing_time = self.estimate_time(task)
            yield self.env.timeout(processing_time)
            
            # 完成任務
            self.complete_task(task)
    
    def estimate_time(self, task):
        # 自定義時間估算邏輯
        base_time = task.complexity * 2
        skill_factor = self.skills.get(task.type, 1.0)
        custom_factor = self.custom_params.get('efficiency', 1.0)
        
        return base_time / skill_factor * custom_factor
```

#### 自定義事件接口
```python
class Event:
    """事件基類"""
    
    def __init__(self, timestamp: float, event_type: str, data: Dict):
        self.timestamp = timestamp
        self.event_type = event_type
        self.data = data
    
    def apply(self, simulator: BeeSwarmSimulator) -> None:
        """應用事件到模擬器"""
        pass

class TaskArrivalEvent(Event):
    """任務到達事件"""
    
    def apply(self, simulator):
        task = Task(**self.data)
        simulator.add_task(task)

class RoleUnavailableEvent(Event):
    """角色不可用事件"""
    
    def apply(self, simulator):
        role_name = self.data['role_name']
        duration = self.data['duration']
        simulator.set_role_unavailable(role_name, duration)
```

## 🔧 自定義 API 擴展

### REST API 接口

#### 模擬管理 API
```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/v1/simulations', methods=['POST'])
def create_simulation():
    """創建新的模擬"""
    config_data = request.json
    
    try:
        config = SimulationConfig(**config_data)
        simulation_id = simulation_manager.create_simulation(config)
        
        return jsonify({
            'simulation_id': simulation_id,
            'status': 'created'
        }), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/v1/simulations/<simulation_id>/start', methods=['POST'])
def start_simulation(simulation_id):
    """啟動模擬"""
    try:
        simulation_manager.start_simulation(simulation_id)
        return jsonify({'status': 'started'})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/v1/simulations/<simulation_id>/status', methods=['GET'])
def get_simulation_status(simulation_id):
    """獲取模擬狀態"""
    try:
        status = simulation_manager.get_status(simulation_id)
        return jsonify(status)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/api/v1/simulations/<simulation_id>/results', methods=['GET'])
def get_simulation_results(simulation_id):
    """獲取模擬結果"""
    try:
        results = simulation_manager.get_results(simulation_id)
        return jsonify(results.to_dict())
        
    except Exception as e:
        return jsonify({'error': str(e)}), 404
```

#### 配置管理 API
```python
@app.route('/api/v1/configs', methods=['GET'])
def list_configs():
    """獲取配置列表"""
    configs = config_manager.list_configs()
    return jsonify(configs)

@app.route('/api/v1/configs', methods=['POST'])
def create_config():
    """創建新配置"""
    config_data = request.json
    config_id = config_manager.save_config(config_data)
    
    return jsonify({
        'config_id': config_id,
        'status': 'created'
    }), 201

@app.route('/api/v1/configs/<config_id>', methods=['GET'])
def get_config(config_id):
    """獲取指定配置"""
    config = config_manager.get_config(config_id)
    if config:
        return jsonify(config)
    else:
        return jsonify({'error': 'Config not found'}), 404
```

### WebSocket API

#### 實時監控接口
```python
from flask_socketio import SocketIO, emit

socketio = SocketIO(app)

@socketio.on('subscribe_simulation')
def handle_subscription(data):
    """訂閱模擬更新"""
    simulation_id = data['simulation_id']
    join_room(simulation_id)
    emit('subscribed', {'simulation_id': simulation_id})

def broadcast_simulation_update(simulation_id, update_data):
    """廣播模擬更新"""
    socketio.emit('simulation_update', update_data, room=simulation_id)

def broadcast_metrics_update(simulation_id, metrics):
    """廣播指標更新"""
    socketio.emit('metrics_update', metrics, room=simulation_id)
```

### GraphQL API

#### Schema 定義
```graphql
type Query {
  simulation(id: ID!): Simulation
  simulations(status: SimulationStatus): [Simulation!]!
  config(id: ID!): SimulationConfig
  configs: [SimulationConfig!]!
}

type Mutation {
  createSimulation(input: CreateSimulationInput!): Simulation!
  startSimulation(id: ID!): Simulation!
  stopSimulation(id: ID!): Simulation!
  createConfig(input: CreateConfigInput!): SimulationConfig!
}

type Subscription {
  simulationUpdates(id: ID!): SimulationUpdate!
  metricsUpdates(id: ID!): MetricsUpdate!
}

type Simulation {
  id: ID!
  status: SimulationStatus!
  config: SimulationConfig!
  results: SimulationResult
  createdAt: DateTime!
  startedAt: DateTime
  completedAt: DateTime
}

enum SimulationStatus {
  CREATED
  RUNNING
  COMPLETED
  FAILED
}
```

#### Resolver 實現
```python
import graphene
from graphene import ObjectType, String, Int, Float, List, Field

class SimulationType(ObjectType):
    id = String()
    status = String()
    config = Field('SimulationConfigType')
    results = Field('SimulationResultType')

class Query(ObjectType):
    simulation = Field(SimulationType, id=String(required=True))
    simulations = List(SimulationType, status=String())
    
    def resolve_simulation(self, info, id):
        return simulation_manager.get_simulation(id)
    
    def resolve_simulations(self, info, status=None):
        return simulation_manager.list_simulations(status=status)

class CreateSimulation(graphene.Mutation):
    class Arguments:
        config_data = String(required=True)
    
    simulation = Field(SimulationType)
    
    def mutate(self, info, config_data):
        config = SimulationConfig.from_json(config_data)
        simulation = simulation_manager.create_simulation(config)
        return CreateSimulation(simulation=simulation)

schema = graphene.Schema(query=Query, mutation=Mutation)
```

## 📚 SDK 和客戶端庫

### Python SDK
```python
class BeeSwarmClient:
    """Bee Swarm Python 客戶端"""
    
    def __init__(self, base_url: str, api_key: str = None):
        self.base_url = base_url
        self.api_key = api_key
        self.session = requests.Session()
        
        if api_key:
            self.session.headers.update({
                'Authorization': f'Bearer {api_key}'
            })
    
    def create_simulation(self, config: SimulationConfig) -> str:
        """創建模擬"""
        response = self.session.post(
            f'{self.base_url}/api/v1/simulations',
            json=config.to_dict()
        )
        response.raise_for_status()
        return response.json()['simulation_id']
    
    def start_simulation(self, simulation_id: str) -> None:
        """啟動模擬"""
        response = self.session.post(
            f'{self.base_url}/api/v1/simulations/{simulation_id}/start'
        )
        response.raise_for_status()
    
    def get_results(self, simulation_id: str) -> SimulationResult:
        """獲取結果"""
        response = self.session.get(
            f'{self.base_url}/api/v1/simulations/{simulation_id}/results'
        )
        response.raise_for_status()
        return SimulationResult.from_dict(response.json())
```

### JavaScript SDK
```javascript
class BeeSwarmClient {
    constructor(baseUrl, apiKey = null) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    
    async createSimulation(config) {
        const response = await fetch(`${this.baseUrl}/api/v1/simulations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
            },
            body: JSON.stringify(config)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data.simulation_id;
    }
    
    async getResults(simulationId) {
        const response = await fetch(
            `${this.baseUrl}/api/v1/simulations/${simulationId}/results`,
            {
                headers: {
                    ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
                }
            }
        );
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
    }
}
```

## 📋 錯誤處理

### 錯誤代碼
```python
class APIErrorCode:
    # 通用錯誤
    INVALID_REQUEST = 400
    UNAUTHORIZED = 401
    FORBIDDEN = 403
    NOT_FOUND = 404
    METHOD_NOT_ALLOWED = 405
    CONFLICT = 409
    INTERNAL_ERROR = 500
    
    # 業務錯誤
    SIMULATION_NOT_FOUND = 4001
    SIMULATION_ALREADY_RUNNING = 4002
    INVALID_CONFIG = 4003
    SIMULATION_FAILED = 4004
    QUOTA_EXCEEDED = 4005

class APIError(Exception):
    def __init__(self, code: int, message: str, details: Dict = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(message)
```

### 錯誤響應格式
```json
{
  "error": {
    "code": 4001,
    "message": "Simulation not found",
    "details": {
      "simulation_id": "sim_123",
      "timestamp": "2023-01-01T00:00:00Z"
    }
  }
}
```

## 本章小結

### 關鍵要點
- **完整的 API 覆蓋** 支持所有核心功能
- **一致的接口設計** 遵循 REST 和 GraphQL 標準
- **豐富的客戶端支持** 提供多語言 SDK
- **完善的錯誤處理** 提供清晰的錯誤信息

### 與其他章節的關聯
- 第2章：系統架構決定 API 設計
- 第5章：模擬器提供核心 API 功能
- 第7章：部署運維影響 API 可用性

### 下一步建議
1. 根據需要選擇合適的 API 接口
2. 使用提供的 SDK 快速開發
3. 參考錯誤處理最佳實踐
4. 關注 API 版本更新

## 參考資料

- [GitHub API 文檔](https://docs.github.com/en/rest)
- [REST API 設計指南](https://restfulapi.net/)
- [GraphQL 規範](https://graphql.org/learn/)
- [OpenAPI 規範](https://swagger.io/specification/) 