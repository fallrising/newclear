# novnc_cursor - Cursor IDE with VNC Access

基于 `novnc_base` 镜像的 Cursor IDE 远程开发环境，支持通过 noVNC 在浏览器中使用 Cursor IDE。

## 概述

这个容器提供了完整的 Cursor IDE 远程开发环境，包括：

- **Cursor IDE**: 基于 AI 的现代代码编辑器
- **noVNC**: 基于 Web 的 VNC 客户端访问
- **X11 环境**: 完整的图形界面支持
- **GPU 加速**: 支持 NVIDIA GPU 加速（可选）
- **安全配置**: 本地绑定和用户隔离
- **持久化存储**: 配置和项目文件持久化

## 特性

### 🚀 核心功能
- **Web 访问**: 通过浏览器访问 Cursor IDE
- **AI 编程助手**: 完整的 Cursor AI 功能支持
- **多语言支持**: 支持所有 Cursor 支持的语言和框架
- **扩展支持**: 完整的 Cursor 扩展生态系统

### 🔧 技术特性
- **双版本支持**: CPU 版本和 GPU 加速版本
- **资源管理**: 可配置的内存和 CPU 限制
- **网络隔离**: VNC 仅绑定到 localhost
- **用户隔离**: 专用用户运行 Cursor IDE
- **进程管理**: Supervisor 确保服务稳定运行

### 🛡️ 安全特性
- **本地访问**: VNC 默认仅绑定到 127.0.0.1
- **用户权限**: 非 root 用户运行 Cursor IDE
- **文件权限**: 适当的文件系统权限设置
- **网络隔离**: 容器网络隔离

## 快速开始

### 前置要求

1. **Docker**: 安装 Docker 20.10+
2. **基础镜像**: 需要先构建 `novnc_base` 镜像
3. **GPU 支持** (可选): AMD GPU + Mesa 驱动

### 构建镜像

#### CPU 版本
```bash
# 构建基础版本
./build.sh

# 构建指定标签
./build.sh -t v1.0.0
```

#### GPU 版本 (AMD)
```bash
# 构建 AMD GPU 版本
./build.sh --gpu

# 构建 AMD GPU 版本指定标签
./build.sh --gpu -t amd-gpu-v1.0.0
```

### 运行容器

#### 基础运行
```bash
# 运行 CPU 版本
./run.sh

# 运行 GPU 版本
./run.sh --gpu
```

#### 高级配置
```bash
# 后台运行
./run.sh -d

# 自定义端口
./run.sh -p 9000 -P 5901

# 挂载项目目录
./run.sh -v /path/to/projects:/home/cursor/workspace

# 资源限制
./run.sh -m 4g --cpus 2.0

# AMD GPU 版本带资源限制
./run.sh --gpu -m 8g --cpus 4.0
```

### 访问 Cursor IDE

1. **Web 浏览器**: 打开 `http://localhost:6080`
2. **直接 VNC**: 使用 VNC 客户端连接 `localhost:5900`

## 详细配置

### 端口配置

| 端口 | 服务 | 描述 | 默认 |
|------|------|------|-------|
| 6080 | noVNC | Web VNC 客户端 | ✅ |
| 5900 | x11vnc | 直接 VNC 服务 | ✅ |

### 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `DISPLAY` | X11 显示 | `:0` |
| `HOME` | 用户主目录 | `/home/cursor` |
| `MESA_GL_VERSION_OVERRIDE` | OpenGL 版本覆盖 | `4.5` (GPU 版本) |

### 卷挂载

| 路径 | 描述 | 用途 |
|------|------|------|
| `/home/cursor/.config/Cursor` | Cursor 配置 | 持久化设置 |
| `/home/cursor/workspace` | 工作目录 | 项目文件 |

## 安全配置

### 网络安全

#### 本地访问（推荐）
```bash
# 默认配置 - 仅本地访问
./run.sh
```

#### 外部访问（需要额外安全措施）
```bash
# 使用反向代理
./run.sh -p 0.0.0.0:6080

# 使用 SSH 隧道
ssh -L 6080:localhost:6080 user@server
```

### 认证配置

#### VNC 密码保护
```bash
# 在容器内设置 VNC 密码
docker exec -it container_name bash
x11vnc -storepasswd /path/to/passwd
```

#### 反向代理认证
```nginx
# Nginx 配置示例
location /vnc/ {
    auth_basic "Restricted Access";
    auth_basic_user_file /path/to/.htpasswd;
    proxy_pass http://localhost:6080/;
}
```

### 资源限制

#### CPU 和内存限制
```bash
# 限制资源使用
./run.sh -m 4g --cpus 2.0

# AMD GPU 支持
./run.sh --gpu
```

#### 磁盘空间限制
```bash
# 使用 Docker 存储驱动限制
docker run --storage-opt size=10G ...
```

## 性能优化

### CPU 版本优化

#### 内存优化
```bash
# 为 Cursor IDE 分配足够内存
./run.sh -m 4g

# 调整 JVM 堆大小（如果需要）
docker exec -it container_name bash
export CURSOR_JVM_ARGS="-Xmx2g -Xms1g"
```

#### 显示优化
```bash
# 使用更高的显示分辨率
docker exec -it container_name bash
# 修改 /opt/scripts/start.sh 中的 Xvfb 分辨率
```

### AMD GPU 版本优化

#### GPU 配置
```bash
# 检查 GPU 状态
lspci | grep -i amd | grep -i vga

# 检查 OpenGL 支持
glxinfo | grep -i "OpenGL vendor\|OpenGL renderer"

# 检查 Mesa 驱动
glxinfo | grep -i "Mesa"
```

#### 图形性能优化
```bash
# 启用硬件加速
docker run --device=/dev/dri:/dev/dri --group-add video ...

# 设置 OpenGL 环境变量
export MESA_GL_VERSION_OVERRIDE=4.5
export MESA_GLSL_VERSION_OVERRIDE=450
```

## 故障排除

### 常见问题

#### 1. Cursor IDE 无法启动
```bash
# 检查日志
docker logs container_name

# 检查 Cursor 进程
docker exec -it container_name ps aux | grep cursor

# 检查显示设置
docker exec -it container_name echo $DISPLAY
```

#### 2. VNC 连接问题
```bash
# 检查端口绑定
docker exec -it container_name netstat -ln

# 检查 VNC 服务状态
docker exec -it container_name supervisorctl status

# 重启 VNC 服务
docker exec -it container_name supervisorctl restart x11vnc
```

#### 3. AMD GPU 相关问题
```bash
# 检查 GPU 可用性
lspci | grep -i amd | grep -i vga

# 检查容器内 GPU
docker exec -it container_name lspci | grep -i amd

# 检查 OpenGL 支持
docker exec -it container_name glxinfo | grep -i "OpenGL vendor"
```

#### 4. 性能问题
```bash
# 检查资源使用
docker stats container_name

# 检查内存使用
docker exec -it container_name free -h

# 检查 CPU 使用
docker exec -it container_name top
```

### 调试命令

```bash
# 进入容器调试
docker exec -it container_name bash

# 查看服务状态
supervisorctl status

# 查看日志
tail -f /var/log/cursor.log
tail -f /var/log/cursor_error.log

# 检查 X11 环境
xdpyinfo
xrandr

# 检查网络连接
netstat -ln
ss -tlnp
```

## 高级用法

### 自定义配置

#### 修改 Cursor 启动参数
```bash
# 编辑 Dockerfile 中的启动命令
# 在 /app/conf.d/cursor.conf 中修改 command 行
```

#### 添加自定义扩展
```dockerfile
# 在 Dockerfile 中添加
RUN su - cursor -c "cursor --install-extension extension-id"
```

#### 配置代理
```bash
# 设置代理环境变量
docker run -e HTTP_PROXY=http://proxy:port \
           -e HTTPS_PROXY=http://proxy:port \
           ...
```

### 集群部署

#### Docker Compose 配置
```yaml
version: '3.8'
services:
  cursor-vnc:
    build: .
    ports:
      - "6080:6080"
      - "5900:5900"
    volumes:
      - ./projects:/home/cursor/workspace
      - cursor-config:/home/cursor/.config/Cursor
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '2.0'
    restart: unless-stopped

volumes:
  cursor-config:
```

#### Kubernetes 部署
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cursor-vnc
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cursor-vnc
  template:
    metadata:
      labels:
        app: cursor-vnc
    spec:
      containers:
      - name: cursor-vnc
        image: vnc-cursor:latest
        ports:
        - containerPort: 6080
        - containerPort: 5900
        resources:
          limits:
            memory: "4Gi"
            cpu: "2"
            nvidia.com/gpu: 1
        volumeMounts:
        - name: workspace
          mountPath: /home/cursor/workspace
        - name: config
          mountPath: /home/cursor/.config/Cursor
      volumes:
      - name: workspace
        persistentVolumeClaim:
          claimName: workspace-pvc
      - name: config
        persistentVolumeClaim:
          claimName: config-pvc
```

## 维护和更新

### 镜像管理

#### 清理资源
```bash
# 清理容器和镜像
./clean.sh

# 清理特定版本
./clean.sh --gpu -i

# 强制清理
./clean.sh -a -f
```

#### 导出和导入
```bash
# 导出镜像
./export.sh --all --compress

# 导入镜像
./import.sh -f export.tar.gz

# 导入配置
./import.sh --config -f config.tar.gz
```

#### 推送到 Registry
```bash
# 推送到 Docker Hub
./push.sh -r docker.io/myusername

# 推送 AMD GPU 版本
./push.sh --gpu -r myregistry.com

# 推送带版本标签
./push.sh --version v1.0.0 -r myregistry.com
```

### 监控和日志

#### 日志管理
```bash
# 查看容器日志
docker logs -f container_name

# 查看特定服务日志
docker exec -it container_name tail -f /var/log/cursor.log

# 查看 Supervisor 日志
docker exec -it container_name supervisorctl tail -f cursor
```

#### 性能监控
```bash
# 实时资源监控
docker stats container_name

# 系统资源使用
docker exec -it container_name htop

# GPU 使用情况（AMD GPU 版本）
docker exec -it container_name glxinfo | grep -i "OpenGL vendor"
```

## 最佳实践

### 安全最佳实践

1. **网络隔离**: 始终使用本地绑定，通过反向代理或 VPN 提供外部访问
2. **用户权限**: 使用非 root 用户运行应用程序
3. **资源限制**: 设置适当的内存和 CPU 限制
4. **定期更新**: 定期更新基础镜像和安全补丁
5. **日志监控**: 监控容器日志以检测异常活动

### 性能最佳实践

1. **资源分配**: 为 Cursor IDE 分配足够的内存（至少 4GB）
2. **GPU 使用**: 在支持 AMD GPU 的环境中优先使用 GPU 版本
3. **存储优化**: 使用 SSD 存储以提高 I/O 性能
4. **网络优化**: 使用本地网络或高速网络连接
5. **缓存配置**: 合理配置 Cursor IDE 的缓存设置

### 开发最佳实践

1. **项目组织**: 使用 volume 挂载来管理项目文件
2. **配置管理**: 使用配置文件来管理 Cursor IDE 设置
3. **版本控制**: 将项目代码放在版本控制系统中
4. **备份策略**: 定期备份重要的配置和项目文件
5. **测试环境**: 在测试环境中验证配置更改

## 相关项目

- [novnc_base](../novnc_base/): 基础 VNC 环境
- [novnc_llm_cli](../novnc_llm_cli/): LLM 命令行工具环境
- [novnc_tool](../novnc_tool/): 通用工具环境

## 许可证

本项目遵循 MIT 许可证。详见 [LICENSE](../../LICENSE) 文件。

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。

## 更新日志

### v1.0.0
- 初始版本发布
- 支持 Cursor IDE 基础功能
- 提供 CPU 和 GPU 两个版本
- 完整的安全配置和脚本支持 