# 开发流程文档

## 概述

本文档详细描述使用 Bee Swarm 系统进行教育游戏开发的完整流程，包括 AI 角色协作、代码管理、质量保证等各个环节。

## 开发流程概览

```
需求分析 → 任务分解 → 并行开发 → 代码审查 → 集成测试 → 部署上线 → 监控反馈
    ↓         ↓         ↓         ↓         ↓         ↓         ↓
Product    Product   Backend/   All AI    DevOps    DevOps    All AI
Manager    Manager   Frontend   Roles     Engineer  Engineer  Roles
```

## 第一阶段：项目启动

### 1. 环境准备 (DevOps Engineer)

#### 任务：DO-001 数据库设计和部署
```bash
# 1. 创建数据库容器
docker-compose up -d postgres redis

# 2. 运行数据库迁移
cd backend
npm run migrate

# 3. 初始化基础数据
npm run seed

# 4. 验证数据库连接
npm run test:db
```

#### 任务：DO-002 CI/CD 流水线搭建
```yaml
# .github/workflows/ci.yml
name: Continuous Integration

on:
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: |
          cd backend && npm ci
          cd frontend && npm ci
      
      - name: Run tests
        run: |
          cd backend && npm test
          cd frontend && npm test
      
      - name: Run linting
        run: |
          cd backend && npm run lint
          cd frontend && npm run lint
```

### 2. 需求确认 (Product Manager)

#### 任务：需求分析和任务分解
```markdown
# GitHub Issue: 项目需求确认
## 描述
确认教育游戏项目的核心需求和功能范围

## 验收标准
- [ ] 用户注册登录功能
- [ ] 角色创建和养成系统
- [ ] 基础学习功能
- [ ] 数据统计和报告

## 分配给
- Backend Developer: API 开发
- Frontend Developer: 界面开发
- DevOps Engineer: 环境搭建
```

## 第二阶段：并行开发

### 1. 后端开发 (Backend Developer)

#### 任务：BE-001 用户注册登录 API
```typescript
// src/controllers/auth.controller.ts
export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { email, password, name } = req.body;
      
      // 验证输入
      const validation = registerSchema.validate({ email, password, name });
      if (validation.error) {
        return res.status(400).json({ error: validation.error.message });
      }
      
      // 检查用户是否已存在
      const existingUser = await UserService.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({ error: 'User already exists' });
      }
      
      // 创建用户
      const user = await UserService.create({ email, password, name });
      
      // 生成 JWT token
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
      
      res.status(201).json({ user, token });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
```

#### 任务：BE-003 角色创建和管理 API
```typescript
// src/controllers/character.controller.ts
export class CharacterController {
  async create(req: Request, res: Response) {
    try {
      const { name, gender, age, personality } = req.body;
      const userId = req.user.id; // 从 JWT 获取
      
      // 创建角色
      const character = await CharacterService.create({
        userId,
        name,
        gender,
        age,
        personality,
        attributes: this.initializeAttributes(age)
      });
      
      res.status(201).json(character);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  private initializeAttributes(age: number) {
    return {
      intelligence: 50 + Math.floor(Math.random() * 20),
      creativity: 50 + Math.floor(Math.random() * 20),
      social: 50 + Math.floor(Math.random() * 20),
      physical: 50 + Math.floor(Math.random() * 20),
      emotional: 50 + Math.floor(Math.random() * 20)
    };
  }
}
```

### 2. 前端开发 (Frontend Developer)

#### 任务：FE-001 项目脚手架搭建
```bash
# 创建 React 项目
npm create vite@latest frontend -- --template react-ts
cd frontend

# 安装依赖
npm install @tanstack/react-query
npm install react-router-dom
npm install react-hook-form @hookform/resolvers zod
npm install tailwindcss @tailwindcss/forms
npm install framer-motion
npm install axios

# 配置 Tailwind CSS
npx tailwindcss init -p
```

#### 任务：FE-002 用户注册登录界面
```typescript
// src/pages/auth/LoginPage.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '../../schemas/auth';

export const LoginPage = () => {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(loginSchema)
  });
  
  const onSubmit = async (data: LoginFormData) => {
    try {
      const response = await authService.login(data);
      // 保存 token 并跳转
      localStorage.setItem('token', response.token);
      navigate('/game');
    } catch (error) {
      // 显示错误信息
    }
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-md">
        <input
          {...register('email')}
          type="email"
          placeholder="邮箱"
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
        {errors.email && <span className="text-red-500">{errors.email.message}</span>}
        
        <input
          {...register('password')}
          type="password"
          placeholder="密码"
          className="w-full px-3 py-2 border border-gray-300 rounded-md mt-4"
        />
        {errors.password && <span className="text-red-500">{errors.password.message}</span>}
        
        <button
          type="submit"
          className="w-full mt-6 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700"
        >
          登录
        </button>
      </form>
    </div>
  );
};
```

## 第三阶段：代码审查和集成

### 1. Pull Request 流程

#### 后端 PR 示例
```markdown
# Pull Request: 用户认证 API 实现

## 描述
实现了用户注册、登录、JWT 认证功能

## 变更内容
- 添加用户注册 API
- 添加用户登录 API
- 添加 JWT 中间件
- 添加密码加密功能
- 添加输入验证

## 测试
- [x] 单元测试通过
- [x] 集成测试通过
- [x] API 文档更新

## 相关 Issue
Closes #BE-001
```

#### 前端 PR 示例
```markdown
# Pull Request: 用户认证界面实现

## 描述
实现了用户注册、登录界面

## 变更内容
- 添加登录页面组件
- 添加注册页面组件
- 添加表单验证
- 添加错误处理
- 添加路由配置

## 测试
- [x] 组件测试通过
- [x] E2E 测试通过
- [x] 响应式设计验证

## 相关 Issue
Closes #FE-002
```

### 2. 代码审查流程

#### 自动化检查
```yaml
# .github/workflows/pr-check.yml
name: PR Check

on:
  pull_request:
    branches: [main]

jobs:
  code-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run ESLint
        run: |
          cd backend && npm run lint
          cd frontend && npm run lint
      
      - name: Run TypeScript check
        run: |
          cd backend && npm run type-check
          cd frontend && npm run type-check
      
      - name: Run tests
        run: |
          cd backend && npm test
          cd frontend && npm test
```

#### AI 代码审查
```typescript
// AI 代码审查提示
const codeReviewPrompt = `
请审查以下代码：

1. 代码质量和最佳实践
2. 安全性问题
3. 性能优化建议
4. 测试覆盖率
5. 文档完整性

代码：
${code}
`;
```

## 第四阶段：测试和部署

### 1. 自动化测试 (DevOps Engineer)

#### 单元测试
```typescript
// backend/tests/auth.test.ts
describe('Auth Controller', () => {
  describe('POST /api/auth/register', () => {
    it('should create a new user', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User'
      };
      
      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);
      
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body).toHaveProperty('token');
    });
  });
});
```

#### 集成测试
```typescript
// frontend/tests/LoginPage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from '../pages/auth/LoginPage';

describe('LoginPage', () => {
  it('should handle login form submission', async () => {
    render(<LoginPage />);
    
    fireEvent.change(screen.getByPlaceholderText('邮箱'), {
      target: { value: 'test@example.com' }
    });
    
    fireEvent.change(screen.getByPlaceholderText('密码'), {
      target: { value: 'password123' }
    });
    
    fireEvent.click(screen.getByText('登录'));
    
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/game');
    });
  });
});
```

### 2. 部署流程 (DevOps Engineer)

#### 生产环境部署
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Docker images
        run: |
          docker build -t education-game-frontend ./frontend
          docker build -t education-game-backend ./backend
      
      - name: Deploy to server
        run: |
          # 部署脚本
          ssh user@server "cd /app && docker-compose pull && docker-compose up -d"
      
      - name: Run health check
        run: |
          # 健康检查
          curl -f http://server/health || exit 1
```

## 第五阶段：监控和优化

### 1. 系统监控 (DevOps Engineer)

#### 应用监控
```typescript
// backend/src/middleware/monitoring.ts
import prometheus from 'prom-client';

const httpRequestDuration = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code']
});

export const monitoringMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration.observe(
      {
        method: req.method,
        route: req.route?.path || 'unknown',
        status_code: res.statusCode
      },
      duration
    );
  });
  
  next();
};
```

#### 日志管理
```typescript
// backend/src/utils/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

### 2. 性能优化

#### 前端优化
```typescript
// 代码分割
const GamePage = lazy(() => import('../pages/game/GamePage'));
const LearningPage = lazy(() => import('../pages/learning/LearningPage'));

// 缓存策略
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5分钟
      cacheTime: 10 * 60 * 1000, // 10分钟
    },
  },
});
```

#### 后端优化
```typescript
// Redis 缓存
export class CacheService {
  async get<T>(key: string): Promise<T | null> {
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }
  
  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    await redis.setex(key, ttl, JSON.stringify(value));
  }
}

// 数据库连接池
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

## 协作沟通机制

### 1. GitHub Issues 管理
```markdown
# Issue 模板
## 任务类型
- [ ] 功能开发
- [ ] Bug 修复
- [ ] 性能优化
- [ ] 文档更新

## 描述
详细描述任务内容

## 验收标准
- [ ] 标准1
- [ ] 标准2

## 分配给
@backend-ai-001 @frontend-ai-001 @devops-ai-001

## 标签
backend, api, high-priority
```

### 2. 进度同步
```markdown
# 每日同步模板
## 今日完成
- 任务1: 完成状态
- 任务2: 完成状态

## 明日计划
- 任务1: 计划内容
- 任务2: 计划内容

## 阻塞问题
- 问题1: 描述和解决方案
- 问题2: 描述和解决方案
```

## 质量保证

### 1. 代码质量标准
- **测试覆盖率**: > 80%
- **代码复杂度**: 圈复杂度 < 10
- **重复代码**: < 3%
- **安全漏洞**: 0 个高危漏洞

### 2. 性能标准
- **API 响应时间**: < 200ms
- **页面加载时间**: < 3s
- **并发用户数**: > 1000
- **系统可用性**: > 99.9%

### 3. 安全标准
- **输入验证**: 100% 覆盖
- **SQL 注入**: 0 个漏洞
- **XSS 攻击**: 0 个漏洞
- **CSRF 保护**: 100% 覆盖

## 下一步行动

1. **环境搭建**: DevOps 完成基础环境搭建
2. **API 开发**: Backend 开始核心 API 开发
3. **界面开发**: Frontend 开始用户界面开发
4. **集成测试**: 开始端到端集成测试
5. **部署上线**: 完成生产环境部署

---

*本文档描述了完整的 AI 团队协作开发流程，确保项目高质量交付。* 