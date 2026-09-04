# 系统架构设计文档

## 概述

本文档由 Backend Developer 和 DevOps Engineer AI 角色协作生成，详细设计教育游戏系统的技术架构。

## 架构设计原则

### 设计原则
- **微服务架构**: 模块化设计，便于扩展和维护
- **高可用性**: 99.9% 系统可用性
- **可扩展性**: 支持水平扩展
- **安全性**: 数据加密，权限控制
- **性能优化**: 响应时间 < 200ms

### 技术选型
- **前端**: React 18 + TypeScript + Vite
- **后端**: Node.js + Express + TypeScript
- **数据库**: PostgreSQL (主数据库) + Redis (缓存)
- **部署**: Docker + Docker Compose + GitHub Actions
- **监控**: Prometheus + Grafana + ELK Stack

## 系统架构图

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend API   │    │   Database      │
│   (React)       │◄──►│   (Node.js)     │◄──►│   (PostgreSQL)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CDN           │    │   Redis Cache   │    │   File Storage  │
│   (Cloudflare)  │    │   (Session)     │    │   (AWS S3)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Load Balancer │    │   Monitoring    │    │   CI/CD         │
│   (Nginx)       │    │   (Prometheus)  │    │   (GitHub)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 前端架构

### 技术栈
- **框架**: React 18 + TypeScript
- **构建工具**: Vite
- **样式**: Tailwind CSS + Framer Motion
- **状态管理**: React Query + Zustand
- **路由**: React Router v6
- **表单**: React Hook Form + Zod

### 项目结构
```
frontend/
├── src/
│   ├── components/          # 可复用组件
│   │   ├── ui/             # 基础 UI 组件
│   │   ├── forms/          # 表单组件
│   │   └── game/           # 游戏相关组件
│   ├── pages/              # 页面组件
│   │   ├── auth/           # 认证页面
│   │   ├── game/           # 游戏页面
│   │   └── dashboard/      # 仪表板页面
│   ├── hooks/              # 自定义 Hooks
│   ├── services/           # API 服务
│   ├── stores/             # 状态管理
│   ├── types/              # TypeScript 类型
│   ├── utils/              # 工具函数
│   └── assets/             # 静态资源
├── public/                 # 公共资源
├── tests/                  # 测试文件
└── package.json
```

### 组件设计
```typescript
// 基础组件示例
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'danger';
  size: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

// 游戏组件示例
interface CharacterProps {
  character: Character;
  onUpdate: (updates: Partial<Character>) => void;
}
```

## 后端架构

### 技术栈
- **运行时**: Node.js 18+
- **框架**: Express.js + TypeScript
- **数据库**: PostgreSQL 14+
- **缓存**: Redis 6+
- **认证**: JWT + bcrypt
- **文件上传**: Multer + AWS S3
- **验证**: Joi + Zod
- **测试**: Jest + Supertest

### 项目结构
```
backend/
├── src/
│   ├── controllers/        # 控制器层
│   │   ├── auth.ts        # 认证控制器
│   │   ├── user.ts        # 用户控制器
│   │   ├── character.ts   # 角色控制器
│   │   └── learning.ts    # 学习控制器
│   ├── services/          # 业务逻辑层
│   │   ├── auth.service.ts
│   │   ├── user.service.ts
│   │   ├── character.service.ts
│   │   └── learning.service.ts
│   ├── models/            # 数据模型层
│   │   ├── user.model.ts
│   │   ├── character.model.ts
│   │   └── learning.model.ts
│   ├── middleware/        # 中间件
│   │   ├── auth.middleware.ts
│   │   ├── validation.middleware.ts
│   │   └── error.middleware.ts
│   ├── routes/            # 路由定义
│   │   ├── auth.routes.ts
│   │   ├── user.routes.ts
│   │   ├── character.routes.ts
│   │   └── learning.routes.ts
│   ├── utils/             # 工具函数
│   ├── types/             # TypeScript 类型
│   └── config/            # 配置文件
├── tests/                 # 测试文件
├── migrations/            # 数据库迁移
└── package.json
```

### API 设计

#### 认证 API
```typescript
// POST /api/auth/register
interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

// POST /api/auth/login
interface LoginRequest {
  email: string;
  password: string;
}

// POST /api/auth/refresh
interface RefreshRequest {
  refreshToken: string;
}
```

#### 用户 API
```typescript
// GET /api/users/profile
// PUT /api/users/profile
interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

// POST /api/users/avatar
// 文件上传接口
```

#### 角色 API
```typescript
// POST /api/characters
interface CreateCharacterRequest {
  name: string;
  gender: 'male' | 'female';
  age: number;
  personality: string[];
}

// GET /api/characters/:id
interface Character {
  id: string;
  userId: string;
  name: string;
  gender: 'male' | 'female';
  age: number;
  personality: string[];
  attributes: CharacterAttributes;
  createdAt: Date;
  updatedAt: Date;
}
```

#### 学习 API
```typescript
// GET /api/learning/subjects
interface Subject {
  id: string;
  name: string;
  description: string;
  icon: string;
  courses: Course[];
}

// GET /api/learning/progress/:characterId
interface LearningProgress {
  characterId: string;
  subjects: SubjectProgress[];
  totalProgress: number;
}
```

## 数据库设计

### 用户表 (users)
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  avatar_url VARCHAR(500),
  email_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 角色表 (characters)
```sql
CREATE TABLE characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  gender VARCHAR(10) NOT NULL,
  age INTEGER NOT NULL,
  personality JSONB NOT NULL,
  attributes JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 学科表 (subjects)
```sql
CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(100),
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 课程表 (courses)
```sql
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  content JSONB NOT NULL,
  difficulty_level INTEGER DEFAULT 1,
  estimated_duration INTEGER, -- 分钟
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 学习进度表 (learning_progress)
```sql
CREATE TABLE learning_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  progress_percentage DECIMAL(5,2) DEFAULT 0,
  completed_at TIMESTAMP,
  score INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(character_id, course_id)
);
```

## 部署架构

### 容器化部署
```yaml
# docker-compose.yml
version: '3.8'

services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - REACT_APP_API_URL=http://localhost:8000
    depends_on:
      - backend

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://user:pass@postgres:5432/education_game
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:14
    environment:
      - POSTGRES_DB=education_game
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:6-alpine
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - frontend
      - backend

volumes:
  postgres_data:
  redis_data:
```

### CI/CD 流水线
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: |
          cd backend && npm test
          cd frontend && npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker images
        run: |
          docker build -t education-game-frontend ./frontend
          docker build -t education-game-backend ./backend

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to server
        run: |
          # 部署脚本
```

## 监控架构

### 应用监控
- **Prometheus**: 指标收集
- **Grafana**: 监控面板
- **AlertManager**: 告警管理

### 日志管理
- **ELK Stack**: 日志收集和分析
- **Filebeat**: 日志传输
- **Kibana**: 日志可视化

### 性能监控
```typescript
// 性能监控中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // 记录到 Prometheus
    httpRequestDuration.observe(
      { method: req.method, route: req.route?.path, status: res.statusCode },
      duration
    );
  });
  next();
});
```

## 安全架构

### 认证授权
- **JWT Token**: 无状态认证
- **Refresh Token**: 安全刷新机制
- **Role-based Access Control**: 基于角色的权限控制

### 数据安全
- **密码加密**: bcrypt 哈希
- **数据加密**: AES-256 加密敏感数据
- **HTTPS**: 强制 HTTPS 传输

### API 安全
- **Rate Limiting**: 请求频率限制
- **Input Validation**: 输入验证和清理
- **CORS**: 跨域资源共享配置

## 性能优化

### 前端优化
- **代码分割**: 按路由分割代码
- **懒加载**: 组件和图片懒加载
- **缓存策略**: 静态资源缓存

### 后端优化
- **数据库索引**: 优化查询性能
- **Redis 缓存**: 热点数据缓存
- **连接池**: 数据库连接池管理

### 部署优化
- **CDN**: 静态资源加速
- **负载均衡**: 多实例负载均衡
- **自动扩缩容**: 根据负载自动调整

## 扩展性设计

### 水平扩展
- **无状态设计**: 支持多实例部署
- **数据库分片**: 支持数据分片
- **微服务拆分**: 按业务模块拆分

### 垂直扩展
- **资源监控**: 实时监控资源使用
- **性能调优**: 持续性能优化
- **容量规划**: 提前容量规划

## 下一步行动

1. **环境搭建**: DevOps 搭建开发环境
2. **数据库初始化**: 创建数据库表结构
3. **API 开发**: Backend 开始 API 开发
4. **前端开发**: Frontend 开始界面开发
5. **集成测试**: 端到端集成测试

---

*本文档由 Backend Developer 和 DevOps Engineer AI 协作生成。* 