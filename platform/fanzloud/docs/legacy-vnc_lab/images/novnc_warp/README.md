# VNC Lab - novnc_warp

基于 noVNC 的 Warp 终端容器化环境，支持 AMD GPU 加速和 AI 功能。

## 📋 概述

本项目提供了一个完整的 Docker 容器化环境，让你可以通过浏览器访问 Warp 终端。Warp 是一个现代化的终端应用，集成了 AI 功能，可以帮助开发者提高工作效率。

### ✨ 主要特性

- **🖥️ 图形界面访问**: 通过 noVNC 在浏览器中访问 Warp 终端
- **🚀 AMD GPU 支持**: 支持 AMD 显卡加速，提升图形性能
- **🤖 AI 功能**: 完整的 Warp AI 功能支持
- **🔒 安全设计**: 本地绑定端口，支持反向代理
- **📦 容器化**: 完整的 Docker 管理脚本
- **🔄 持久化**: 配置和工作目录持久化存储

## 🛠️ 系统要求

### 基础要求
- Docker 20.10+
- 至少 2GB 可用内存
- 至少 5GB 可用磁盘空间

### AMD GPU 支持（可选）
- AMD 显卡（集成显卡或独立显卡）
- Mesa 驱动支持
- Vulkan 支持（推荐）

## 🚀 快速开始

### 1. 构建基础镜像

首先确保你已经构建了基础镜像：

```bash
cd ../novnc_base
./build.sh
```

### 2. 构建 Warp 镜像

#### CPU 版本
```bash
./build.sh
```

#### AMD GPU 版本
```bash
./build.sh --gpu
```

### 3. 运行容器

#### CPU 版本
```bash
./run.sh
```

#### AMD GPU 版本
```bash
./run.sh --gpu
```

### 4. 访问 Warp

打开浏览器访问：`http://localhost:6080`

## 📖 详细使用指南

### 构建脚本 (`build.sh`)

构建 Docker 镜像，支持多种选项：

```bash
# 基础构建
./build.sh

# GPU 版本构建
./build.sh --gpu

# 指定标签
./build.sh -t v1.0.0

# 强制重新构建（不使用缓存）
./build.sh --no-cache

# 查看帮助
./build.sh -h
```

### 运行脚本 (`run.sh`)

启动 Warp 容器，支持丰富的配置选项：

```bash
# 基础运行
./run.sh

# GPU 版本
./run.sh --gpu

# 后台运行
./run.sh -d

# 自定义端口
./run.sh -p 9000 -P 5901

# 挂载工作目录
./run.sh -v /path/to/workspace:/workspace

# 资源限制
./run.sh -m 4g --cpus 2.0

# 查看帮助
./run.sh -h
```

### 清理脚本 (`clean.sh`)

清理容器、镜像和卷：

```bash
# 交互式清理
./clean.sh

# 强制清理所有
./clean.sh -a -f

# 只清理容器
./clean.sh -c

# 只清理镜像
./clean.sh -i

# 清理 GPU 版本
./clean.sh --gpu
```

### 导出脚本 (`export.sh`)

导出镜像和配置：

```bash
# 导出 CPU 版本
./export.sh

# 导出 GPU 版本
./export.sh --gpu

# 导出所有版本
./export.sh --all

# 压缩导出
./export.sh --compress

# 包含配置文件
./export.sh --include-config
```

### 导入脚本 (`import.sh`)

导入镜像和配置：

```bash
# 导入特定文件
./import.sh -f export.tar

# 从目录导入所有
./import.sh -d /backup --all

# 导入 GPU 版本
./import.sh --gpu -f gpu.tar

# 导入配置
./import.sh --config -d /config
```

### 推送脚本 (`push.sh`)

推送镜像到 Docker 仓库：

```bash
# 推送到仓库
./push.sh -r docker.io/myuser

# 推送 GPU 版本
./push.sh --gpu -r myregistry

# 推送所有版本
./push.sh --all -r myregistry

# 同时推送 latest 标签
./push.sh --latest -r myregistry
```

### 测试脚本 (`test_warp.sh`)

测试 Warp 功能和 GPU 支持：

```bash
# 基础功能测试
./test_warp.sh

# GPU 版本测试
./test_warp.sh --gpu

# 测试运行中的容器
./test_warp.sh --container

# 测试主机系统
./test_warp.sh --host

# 全面测试
./test_warp.sh --all
```

## 🔧 配置说明

### 环境变量

容器支持以下环境变量：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `DISPLAY` | `:0` | X11 显示 |
| `HOME` | `/home/warp` | 用户主目录 |
| `MESA_GL_VERSION_OVERRIDE` | `4.5` | OpenGL 版本覆盖 |
| `MESA_GLSL_VERSION_OVERRIDE` | `450` | GLSL 版本覆盖 |

### 端口配置

| 端口 | 协议 | 说明 |
|------|------|------|
| 6080 | HTTP | noVNC Web 界面 |
| 5900 | VNC | 直接 VNC 连接 |

### 卷挂载

| 容器路径 | 说明 |
|----------|------|
| `/home/warp/.config/warp` | Warp 配置文件 |
| `/home/warp/workspace` | 工作目录 |

## 🎮 Warp AI 功能使用

### AI 命令面板
- 快捷键：`Cmd+K` (macOS) / `Ctrl+K` (Linux)
- 功能：快速执行 AI 命令

### AI 聊天
- 快捷键：`Cmd+L` (macOS) / `Ctrl+L` (Linux)
- 功能：与 AI 助手对话

### 命令历史
- 使用 AI 搜索和重用历史命令
- 智能命令建议

### 代码补全
- 基于上下文的智能代码补全
- 支持多种编程语言

## 🔒 安全考虑

### 网络安全
- VNC 端口默认绑定到 `127.0.0.1`
- 建议使用反向代理进行外部访问
- 考虑使用 VPN 或 SSH 隧道

### 容器安全
- 使用非 root 用户运行
- 最小权限原则
- 定期更新基础镜像

### 数据安全
- 重要数据使用卷挂载
- 定期备份配置文件
- 使用加密传输

## 🐛 故障排除

### 常见问题

#### 1. 容器启动失败
```bash
# 检查 Docker 状态
docker info

# 查看容器日志
docker logs vnc-warp-container

# 检查端口占用
netstat -tlnp | grep :6080
```

#### 2. AMD GPU 不工作
```bash
# 检查主机 GPU
lspci | grep -i amd

# 检查 OpenGL
glxinfo | grep -i "OpenGL vendor"

# 测试容器内 GPU
./test_warp.sh --gpu
```

#### 3. Warp 无法启动
```bash
# 检查 Warp 安装
docker exec vnc-warp-container which warp

# 查看 Warp 日志
docker exec vnc-warp-container cat /var/log/warp.log

# 检查用户权限
docker exec vnc-warp-container ls -la /home/warp
```

#### 4. AI 功能无法使用
```bash
# 检查网络连接
docker exec vnc-warp-container ping -c 1 8.8.8.8

# 检查 API 访问
docker exec vnc-warp-container curl -s https://api.openai.com

# 检查 Warp 配置
docker exec vnc-warp-container ls -la /home/warp/.config/warp
```

### 性能优化

#### 1. 内存优化
```bash
# 限制内存使用
./run.sh -m 2g

# 监控内存使用
docker stats vnc-warp-container
```

#### 2. GPU 优化
```bash
# 确保 GPU 设备可用
ls -la /dev/dri

# 检查 GPU 驱动
glxinfo | grep -i "OpenGL renderer"
```

#### 3. 网络优化
```bash
# 使用本地镜像源
# 在 Dockerfile 中添加镜像源配置

# 优化 DNS 设置
./run.sh --env-file dns.conf
```

## 📚 高级配置

### 自定义 Warp 配置

创建自定义配置文件：

```bash
# 创建配置目录
mkdir -p ~/warp-config

# 挂载自定义配置
./run.sh -v ~/warp-config:/home/warp/.config/warp
```

### 集成开发环境

挂载项目目录：

```bash
# 挂载项目目录
./run.sh -v /path/to/project:/home/warp/workspace/project

# 多项目支持
./run.sh -v /path/to/project1:/home/warp/workspace/project1 \
         -v /path/to/project2:/home/warp/workspace/project2
```

### 反向代理配置

Nginx 配置示例：

```nginx
server {
    listen 80;
    server_name warp.example.com;
    
    location / {
        proxy_pass http://127.0.0.1:6080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 🤝 贡献指南

### 开发环境设置

1. 克隆项目
2. 构建基础镜像
3. 修改 Dockerfile
4. 测试修改
5. 提交 Pull Request

### 代码规范

- 使用 ShellCheck 检查脚本
- 遵循现有的代码风格
- 添加适当的注释
- 更新文档

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [Warp](https://warp.dev/) - 现代化的终端应用
- [noVNC](https://novnc.com/) - VNC Web 客户端
- [Docker](https://docker.com/) - 容器化平台
- [Mesa](https://mesa3d.org/) - 开源图形驱动

## 📞 支持

如果你遇到问题或有建议，请：

1. 查看 [故障排除](#故障排除) 部分
2. 运行测试脚本：`./test_warp.sh --all`
3. 提交 Issue 或 Pull Request

---

**注意**: 本项目仅供学习和研究使用。在生产环境中使用前，请确保了解相关的安全风险。 