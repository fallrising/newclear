# API Reference

## Chapter Overview

This chapter provides reference for the main APIs involved in the Bee Swarm project, including GitHub API, simulator API, and custom API interfaces.

- **Chapter Objective**: Provide complete API reference documentation
- **Main Content**: GitHub API, simulator API, extension interfaces
- **Reading Benefits**: Master all available API interfaces and usage methods

## 🌐 GitHub API Reference

### Authentication Methods

#### Personal Access Token
```bash
# Set environment variable
export GITHUB_TOKEN="your_personal_access_token"

# Use in requests
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
        'exp': int(time.time()) + (10 * 60),  # 10 minutes
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

#### Get Issues List
```http
GET /repos/{owner}/{repo}/issues

Parameters:
- state: open, closed, all (default: open)
- labels: Label filter (comma-separated)
- assignee: Assignee filter
- creator: Creator filter
- since: ISO 8601 timestamp
- per_page: Items per page (default: 30, max: 100)
- page: Page number (default: 1)
```

**Example Request:**
```bash
curl -H "Authorization: token $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     "https://api.github.com/repos/owner/repo/issues?state=open&labels=bug,enhancement"
```

**Response Format:**
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

#### Create Issue
```http
POST /repos/{owner}/{repo}/issues

Content-Type: application/json
```

**Request Body:**
```json
{
  "title": "Found a bug",
  "body": "I'm having a problem with this.",
  "assignees": ["octocat"],
  "milestone": 1,
  "labels": ["bug"]
}
```

**Python Example:**
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

#### Update Issue
```http
PATCH /repos/{owner}/{repo}/issues/{issue_number}
```

**Request Body:**
```json
{
  "title": "Found a bug",
  "body": "I'm having a problem with this.",
  "state": "closed",
  "labels": ["bug", "resolved"]
}
```

### Pull Requests API

#### Get PR List
```http
GET /repos/{owner}/{repo}/pulls

Parameters:
- state: open, closed, all (default: open)
- head: Head branch filter
- base: Base branch filter (default: default branch)
- sort: created, updated, popularity (default: created)
- direction: asc, desc (default: desc)
```

#### Create Pull Request
```http
POST /repos/{owner}/{repo}/pulls
```

**Request Body:**
```json
{
  "title": "Amazing new feature",
  "body": "Please pull these awesome changes",
  "head": "octocat:new-feature",
  "base": "master"
}
```

**Python Example:**
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

#### Get Projects List
```http
GET /repos/{owner}/{repo}/projects
```

#### Create Project
```http
POST /repos/{owner}/{repo}/projects
```

**Request Body:**
```json
{
  "name": "My Projects",
  "body": "A board to manage my project."
}
```

### Actions API

#### Get Workflows List
```http
GET /repos/{owner}/{repo}/actions/workflows
```

#### Trigger Workflow
```http
POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
```

**Request Body:**
```json
{
  "ref": "main",
  "inputs": {
    "environment": "production"
  }
}
```

## 🎯 Bee Swarm Simulator API

### Core Classes and Methods

#### BeeSwarmSimulator Class
```python
class BeeSwarmSimulator:
    """Bee Swarm main simulator class"""
    
    def __init__(self, config: SimulationConfig):
        """
        Initialize simulator
        
        Args:
            config: Simulation configuration object
        """
        pass
    
    def add_role(self, role_type: str, role_class: Type) -> None:
        """
        Add role type
        
        Args:
            role_type: Role type name
            role_class: Role class
        """
        pass
    
    def run(self, duration: int) -> SimulationResult:
        """
        Run simulation
        
        Args:
            duration: Simulation duration (time units)
            
        Returns:
            Simulation result object
        """
        pass
```

#### Configuration Classes
```python
@dataclass
class SimulationConfig:
    """Simulation configuration"""
    
    # Basic configuration
    duration: int = 100
    random_seed: Optional[int] = None
    log_level: str = "INFO"
    
    # Team configuration
    team_size: int = 4
    roles: List[str] = field(default_factory=lambda: ["PM", "Backend", "Frontend", "DevOps"])
    
    # Workload configuration
    task_arrival_rate: float = 0.125  # Tasks per hour
    task_complexity_distribution: str = "normal"
    task_complexity_params: Dict = field(default_factory=lambda: {"mean": 5, "std": 2})
    
    # Quality configuration
    defect_rate: float = 0.1
    rework_probability: float = 0.2
    review_probability: float = 0.8
    
    # Performance configuration
    automation_level: float = 0.5
    communication_overhead: float = 0.1
    context_switch_cost: float = 0.1

@dataclass 
class SimulationResult:
    """Simulation results"""
    
    # Basic statistics
    duration: int
    tasks_created: int
    tasks_completed: int
    completion_rate: float
    
    # Performance metrics
    throughput: float
    average_cycle_time: float
    average_wait_time: float
    
    # Quality metrics
    defect_count: int
    rework_count: int
    first_pass_yield: float
    
    # Resource utilization
    role_utilization: Dict[str, float]
    
    # Detailed data
    task_history: List[Dict]
    event_log: List[Dict]
    metrics_timeline: Dict[str, List]
```

#### Role Base Class
```python
class Role:
    """Role base class"""
    
    def __init__(self, env: simpy.Environment, name: str, skills: Dict[str, float]):
        """
        Initialize role
        
        Args:
            env: SimPy environment
            name: Role name
            skills: Skills dictionary {task_type: skill_level}
        """
        pass
    
    def work(self) -> Generator:
        """Main work loop"""
        pass
    
    def estimate_time(self, task: Task) -> float:
        """Estimate task time"""
        pass
    
    def can_handle(self, task: Task) -> bool:
        """Check if can handle task"""
        pass
```

### Utility Functions

#### Data Analysis Functions
```python
def calculate_metrics(simulation_result: SimulationResult) -> Dict[str, Any]:
    """
    Calculate extended metrics
    
    Args:
        simulation_result: Simulation result
        
    Returns:
        Extended metrics dictionary
    """
    pass

def compare_scenarios(results: List[SimulationResult]) -> pd.DataFrame:
    """
    Compare multiple scenarios
    
    Args:
        results: List of simulation results
        
    Returns:
        Comparison results DataFrame
    """
    pass

def plot_metrics(result: SimulationResult, metrics: List[str]) -> None:
    """
    Plot metrics charts
    
    Args:
        result: Simulation result
        metrics: List of metrics to plot
    """
    pass
```

#### Configuration Generation Functions
```python
def create_agile_config(**kwargs) -> SimulationConfig:
    """Create agile development configuration"""
    pass

def create_waterfall_config(**kwargs) -> SimulationConfig:
    """Create waterfall development configuration"""
    pass

def create_devops_config(**kwargs) -> SimulationConfig:
    """Create DevOps configuration"""
    pass
```

### Extension Interfaces

#### Custom Role Interface
```python
class CustomRole(Role):
    """Custom role example"""
    
    def __init__(self, env, name, skills, custom_params=None):
        super().__init__(env, name, skills)
        self.custom_params = custom_params or {}
    
    def work(self):
        while True:
            # Custom work logic
            task = yield self.task_queue.get()
            
            # Process task
            processing_time = self.estimate_time(task)
            yield self.env.timeout(processing_time)
            
            # Complete task
            self.complete_task(task)
    
    def estimate_time(self, task):
        # Custom time estimation logic
        base_time = task.complexity * 2
        skill_factor = self.skills.get(task.type, 1.0)
        custom_factor = self.custom_params.get('efficiency', 1.0)
        
        return base_time / skill_factor * custom_factor
```

#### Custom Event Interface
```python
class Event:
    """Event base class"""
    
    def __init__(self, timestamp: float, event_type: str, data: Dict):
        self.timestamp = timestamp
        self.event_type = event_type
        self.data = data
    
    def apply(self, simulator: BeeSwarmSimulator) -> None:
        """Apply event to simulator"""
        pass

class TaskArrivalEvent(Event):
    """Task arrival event"""
    
    def apply(self, simulator):
        task = Task(**self.data)
        simulator.add_task(task)

class RoleUnavailableEvent(Event):
    """Role unavailable event"""
    
    def apply(self, simulator):
        role_name = self.data['role_name']
        duration = self.data['duration']
        simulator.set_role_unavailable(role_name, duration)
```

## 🔧 Custom API Extensions

### REST API Interface

#### Simulation Management API
```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/v1/simulations', methods=['POST'])
def create_simulation():
    """Create new simulation"""
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
    """Start simulation"""
    try:
        simulation_manager.start_simulation(simulation_id)
        return jsonify({'status': 'started'})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/v1/simulations/<simulation_id>/status', methods=['GET'])
def get_simulation_status(simulation_id):
    """Get simulation status"""
    try:
        status = simulation_manager.get_status(simulation_id)
        return jsonify(status)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/api/v1/simulations/<simulation_id>/results', methods=['GET'])
def get_simulation_results(simulation_id):
    """Get simulation results"""
    try:
        results = simulation_manager.get_results(simulation_id)
        return jsonify(results.to_dict())
        
    except Exception as e:
        return jsonify({'error': str(e)}), 404
```

#### Configuration Management API
```python
@app.route('/api/v1/configs', methods=['GET'])
def list_configs():
    """Get configuration list"""
    configs = config_manager.list_configs()
    return jsonify(configs)

@app.route('/api/v1/configs', methods=['POST'])
def create_config():
    """Create new configuration"""
    config_data = request.json
    config_id = config_manager.save_config(config_data)
    
    return jsonify({
        'config_id': config_id,
        'status': 'created'
    }), 201

@app.route('/api/v1/configs/<config_id>', methods=['GET'])
def get_config(config_id):
    """Get specified configuration"""
    config = config_manager.get_config(config_id)
    if config:
        return jsonify(config)
    else:
        return jsonify({'error': 'Config not found'}), 404
```

### WebSocket API

#### Real-time Monitoring Interface
```python
from flask_socketio import SocketIO, emit

socketio = SocketIO(app)

@socketio.on('subscribe_simulation')
def handle_subscription(data):
    """Subscribe to simulation updates"""
    simulation_id = data['simulation_id']
    join_room(simulation_id)
    emit('subscribed', {'simulation_id': simulation_id})

def broadcast_simulation_update(simulation_id, update_data):
    """Broadcast simulation update"""
    socketio.emit('simulation_update', update_data, room=simulation_id)

def broadcast_metrics_update(simulation_id, metrics):
    """Broadcast metrics update"""
    socketio.emit('metrics_update', metrics, room=simulation_id)
```

### GraphQL API

#### Schema Definition
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

#### Resolver Implementation
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

## 📚 SDKs and Client Libraries

### Python SDK
```python
class BeeSwarmClient:
    """Bee Swarm Python client"""
    
    def __init__(self, base_url: str, api_key: str = None):
        self.base_url = base_url
        self.api_key = api_key
        self.session = requests.Session()
        
        if api_key:
            self.session.headers.update({
                'Authorization': f'Bearer {api_key}'
            })
    
    def create_simulation(self, config: SimulationConfig) -> str:
        """Create simulation"""
        response = self.session.post(
            f'{self.base_url}/api/v1/simulations',
            json=config.to_dict()
        )
        response.raise_for_status()
        return response.json()['simulation_id']
    
    def start_simulation(self, simulation_id: str) -> None:
        """Start simulation"""
        response = self.session.post(
            f'{self.base_url}/api/v1/simulations/{simulation_id}/start'
        )
        response.raise_for_status()
    
    def get_results(self, simulation_id: str) -> SimulationResult:
        """Get results"""
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

## 📋 Error Handling

### Error Codes
```python
class APIErrorCode:
    # General errors
    INVALID_REQUEST = 400
    UNAUTHORIZED = 401
    FORBIDDEN = 403
    NOT_FOUND = 404
    METHOD_NOT_ALLOWED = 405
    CONFLICT = 409
    INTERNAL_ERROR = 500
    
    # Business errors
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

### Error Response Format
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

## Chapter Summary

### Key Points
- **Complete API coverage** supports all core functions
- **Consistent interface design** follows REST and GraphQL standards
- **Rich client support** provides multi-language SDKs
- **Comprehensive error handling** provides clear error information

### Connections to Other Chapters
- Chapter 2: System architecture determines API design
- Chapter 5: Simulator provides core API functionality
- Chapter 7: Deployment operations affect API availability

### Next Steps
1. Choose appropriate API interfaces based on needs
2. Use provided SDKs for rapid development
3. Refer to error handling best practices
4. Pay attention to API version updates

## References

- [GitHub API Documentation](https://docs.github.com/en/rest)
- [REST API Design Guide](https://restfulapi.net/)
- [GraphQL Specification](https://graphql.org/learn/)
- [OpenAPI Specification](https://swagger.io/specification/) 