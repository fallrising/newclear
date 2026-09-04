# 数据管理策略

## 概述

本文档详细说明教育游戏项目的数据管理策略，包括数据存储、备份、安全、隐私保护等方面。

## 数据分类

### 用户数据
- **个人信息**: 姓名、邮箱、头像
- **认证信息**: 密码哈希、JWT token
- **偏好设置**: 主题、语言、通知设置

### 游戏数据
- **角色信息**: 角色属性、成长记录
- **学习数据**: 课程进度、成绩记录
- **行为数据**: 学习时长、操作记录

### 系统数据
- **配置数据**: 系统配置、功能开关
- **日志数据**: 访问日志、错误日志
- **统计数据**: 用户统计、性能指标

## 数据存储策略

### 数据库设计
```sql
-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  avatar_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 角色表
CREATE TABLE characters (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  attributes JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 学习进度表
CREATE TABLE learning_progress (
  id UUID PRIMARY KEY,
  character_id UUID REFERENCES characters(id),
  course_id UUID REFERENCES courses(id),
  progress_percentage DECIMAL(5,2) DEFAULT 0,
  score INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 缓存策略
```typescript
// Redis 缓存配置
const cacheConfig = {
  // 用户会话缓存 (30分钟)
  session: { ttl: 1800 },
  
  // 角色数据缓存 (1小时)
  character: { ttl: 3600 },
  
  // 学习进度缓存 (30分钟)
  progress: { ttl: 1800 },
  
  // 统计数据缓存 (1小时)
  statistics: { ttl: 3600 }
};
```

## 数据安全

### 加密策略
```typescript
// 密码加密
import bcrypt from 'bcrypt';

export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
};

// 敏感数据加密
import crypto from 'crypto';

export const encryptData = (data: string, key: string): string => {
  const cipher = crypto.createCipher('aes-256-cbc', key);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};
```

### 访问控制
```typescript
// 基于角色的权限控制
export const checkPermission = (user: User, resource: string, action: string): boolean => {
  const permissions = {
    admin: ['read', 'write', 'delete'],
    user: ['read', 'write'],
    guest: ['read']
  };
  
  return permissions[user.role]?.includes(action) || false;
};
```

## 隐私保护

### GDPR 合规
```typescript
// 数据删除
export const deleteUserData = async (userId: string): Promise<void> => {
  // 删除用户数据
  await User.deleteOne({ id: userId });
  await Character.deleteMany({ userId });
  await LearningProgress.deleteMany({ userId });
  
  // 删除缓存
  await redis.del(`user:${userId}`);
  await redis.del(`character:${userId}`);
};
```

### 数据匿名化
```typescript
// 数据匿名化
export const anonymizeData = (data: any): any => {
  return {
    ...data,
    email: `user_${data.id}@anonymous.com`,
    name: 'Anonymous User',
    avatar_url: null
  };
};
```

## 备份策略

### 自动备份
```bash
#!/bin/bash
# 数据库备份脚本

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/database"

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份 PostgreSQL
docker-compose exec postgres pg_dump -U user education_game > $BACKUP_DIR/backup_$DATE.sql

# 压缩备份文件
gzip $BACKUP_DIR/backup_$DATE.sql

# 删除7天前的备份
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
```

### 备份验证
```bash
# 备份恢复测试
docker-compose exec postgres psql -U user education_game < backup_20231201_120000.sql
```

## 数据迁移

### 版本控制
```sql
-- 数据库迁移文件
-- 001_create_users_table.sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 002_add_avatar_to_users.sql
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500);
```

### 迁移工具
```typescript
// 数据迁移工具
export class MigrationTool {
  async runMigrations(): Promise<void> {
    const migrations = await this.getPendingMigrations();
    
    for (const migration of migrations) {
      await this.runMigration(migration);
      await this.markMigrationComplete(migration);
    }
  }
}
```

## 数据监控

### 性能监控
```typescript
// 数据库性能监控
export const monitorDatabasePerformance = async () => {
  const metrics = {
    queryCount: await getQueryCount(),
    averageResponseTime: await getAverageResponseTime(),
    slowQueries: await getSlowQueries(),
    connectionCount: await getConnectionCount()
  };
  
  // 发送到监控系统
  await sendMetrics(metrics);
};
```

### 数据质量监控
```typescript
// 数据质量检查
export const checkDataQuality = async () => {
  const checks = [
    checkDuplicateEmails(),
    checkInvalidProgressValues(),
    checkOrphanedRecords(),
    checkDataConsistency()
  ];
  
  const results = await Promise.all(checks);
  return results.filter(result => !result.isValid);
};
```

## 数据恢复

### 灾难恢复
```bash
#!/bin/bash
# 灾难恢复脚本

# 停止应用
docker-compose down

# 恢复数据库
docker-compose up -d postgres
sleep 10
docker-compose exec postgres psql -U user education_game < latest_backup.sql

# 恢复缓存
docker-compose up -d redis
# 重新加载缓存数据

# 启动应用
docker-compose up -d
```

### 数据验证
```typescript
// 数据完整性验证
export const validateDataIntegrity = async (): Promise<ValidationResult[]> => {
  const validations = [
    validateUserCharacterRelations(),
    validateLearningProgress(),
    validateDataConsistency()
  ];
  
  return Promise.all(validations);
};
```

## 数据生命周期

### 数据保留策略
```typescript
// 数据保留策略
const retentionPolicy = {
  userData: '7年', // 用户数据保留7年
  gameData: '3年', // 游戏数据保留3年
  logData: '1年',  // 日志数据保留1年
  tempData: '30天' // 临时数据保留30天
};
```

### 数据清理
```typescript
// 自动数据清理
export const cleanupExpiredData = async (): Promise<void> => {
  // 清理过期日志
  await cleanupExpiredLogs();
  
  // 清理临时文件
  await cleanupTempFiles();
  
  // 清理无效会话
  await cleanupExpiredSessions();
};
```

## 下一步

1. 实施数据加密
2. 配置自动备份
3. 设置数据监控
4. 建立数据恢复流程

---

*本文档定义了完整的数据管理策略，确保数据安全、隐私保护和业务连续性。* 