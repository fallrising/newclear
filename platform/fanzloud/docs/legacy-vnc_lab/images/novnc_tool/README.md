# novnc_tool - Enhanced Tools VNC Environment

A VNC desktop environment based on theasp/novnc with integrated development tools, Node.js support, and multi-service management capabilities.

## Overview

This container extends the theasp/novnc base image with additional development tools and services:

- **Base**: Built on theasp/novnc for proven VNC functionality
- **Node.js Environment**: Full Node.js and npm support
- **AI Tools**: Google Gemini CLI and Anthropic Claude Code integration
- **Web Terminal**: ttyd-based terminal access
- **Remote Access**: Cloudflare Tunnel support
- **Multi-Service Management**: Supervisor-based service orchestration

## Features

### Development Tools
- **Node.js 20.x**: Latest LTS version with npm
- **Google Gemini CLI**: AI-powered code assistance
- **Anthropic Claude Code**: Advanced code analysis
- **Atlassian CLI**: Atlassian platform integration
- **Development Tools**: vim, htop, curl, wget

### Remote Access & Services
- **Web VNC**: Browser-based desktop access
- **Web Terminal**: Browser-based terminal with authentication
- **Cloudflare Tunnel**: Secure remote access
- **Firefox Browser**: Pre-installed with profile persistence

### Service Management
- **Supervisor**: Multi-service process management
- **Log Management**: Centralized logging for all services
- **Auto-restart**: Automatic service recovery
- **Health Monitoring**: Service status monitoring

## Quick Start

### Build the Image

```bash
docker build -t vnc-tool .
```

### Basic Run

```bash
docker run -d \
  --name vnc-tool \
  -p 6080:6080 \
  -p 7681:7681 \
  -v firefox-profile:/home/firefox-profile \
  vnc-tool
```

### Secure Run

```bash
docker run -d \
  --name vnc-tool \
  -p 127.0.0.1:6080:6080 \
  -p 127.0.0.1:7681:7681 \
  -v firefox-profile:/home/firefox-profile \
  -e TUNNEL_TOKEN="your_cloudflared_token" \
  vnc-tool
```

## Access Points

| Service | URL | Description |
|---------|-----|-------------|
| **Desktop** | `http://localhost:6080` | Web VNC desktop |
| **Web Terminal** | `http://localhost:7681` | Browser terminal |

## Environment Variables

| Variable | Description | Default Value |
|----------|-------------|---------------|
| `TUNNEL_TOKEN` | Cloudflare Tunnel token | None (optional) |

## Advanced Usage

### Development Environment

```bash
docker run -d \
  --name dev-tool \
  -p 6080:6080 \
  -p 7681:7681 \
  -v firefox-profile:/home/firefox-profile \
  -v $(pwd)/code:/workspace \
  -v $(pwd)/node_modules:/workspace/node_modules \
  --memory="2g" \
  --cpus="1.5" \
  vnc-tool
```

### Production Configuration

```bash
docker run -d \
  --name production-tool \
  -p 127.0.0.1:6080:6080 \
  -p 127.0.0.1:7681:7681 \
  -v firefox-profile:/home/firefox-profile \
  -v $(pwd)/workspace:/workspace \
  -e TUNNEL_TOKEN="your_cloudflared_token" \
  --memory="4g" \
  --cpus="2.0" \
  --restart unless-stopped \
  --security-opt no-new-privileges:true \
  vnc-tool
```

### With Custom Ports

```bash
docker run -d \
  --name vnc-tool \
  -p 9000:6080 \
  -p 9001:7681 \
  -v firefox-profile:/home/firefox-profile \
  vnc-tool
```

## Development Tools Usage

### Node.js Development

```bash
# Check Node.js version
node --version
npm --version

# Create new project
mkdir myproject && cd myproject
npm init -y

# Install dependencies
npm install express lodash

# Run development server
npm run dev
```

### AI Tools

#### Google Gemini CLI

```bash
# Initialize Gemini CLI
gemini init

# Code assistance
gemini "Write a React component for a todo list"

# Code review
gemini review app.js
```

#### Anthropic Claude Code

```bash
# Initialize Claude Code
claude-code init

# Code analysis
claude-code analyze src/

# Generate code
claude-code generate "Create a REST API with Express"
```

#### Atlassian CLI

```bash
# Authenticate
acli auth

# Jira operations
acli jira issue create --project PROJ --type "Task" --summary "New task"

# Confluence operations
acli confluence page create --space SPACE --title "New Page"
```

## Container Architecture

### Services

The container runs the following services managed by Supervisor:

1. **noVNC**: Web VNC proxy (port 8080)
2. **Firefox**: Web browser with persistent profile
3. **ttyd**: Web terminal server (port 7681)
4. **cloudflared**: Tunnel service (optional)

### File Structure

```
/app/                    # Application directory
/app/conf.d/            # Supervisor configuration files
/home/firefox-profile/  # Firefox profile (persistent)
/usr/local/bin/         # Installed binaries (ttyd, cloudflared)
/var/log/               # Service logs
```

### Ports

| Port | Service | Description |
|------|---------|-------------|
| 6080 | noVNC | Web VNC client |
| 7681 | ttyd | Web terminal |

## Monitoring and Debugging

### Check Container Status

```bash
# View container logs
docker logs vnc-tool

# Check service status
docker exec vnc-tool supervisorctl status

# Monitor resource usage
docker stats vnc-tool
```

### Debug Commands

```bash
# Access container shell
docker exec -it vnc-tool bash

# Check service logs
docker exec vnc-tool tail -f /var/log/firefox.log
docker exec vnc-tool tail -f /var/log/ttyd.log
docker exec vnc-tool tail -f /var/log/cloudflared.log

# Check process status
docker exec vnc-tool ps aux | grep -E "(firefox|ttyd|cloudflared)"
```

### Service Management

```bash
# Check supervisor status
docker exec vnc-tool supervisorctl status

# Restart specific service
docker exec vnc-tool supervisorctl restart firefox
docker exec vnc-tool supervisorctl restart ttyd

# View all logs
docker exec vnc-tool ls -la /var/log/
```

## Troubleshooting

### Common Issues

1. **Container Won't Start**
   ```bash
   # Check detailed logs
   docker logs vnc-tool
   
   # Verify image exists
   docker images | grep vnc-tool
   
   # Check port conflicts
   lsof -i :8080
   lsof -i :7681
   ```

2. **VNC Connection Issues**
   ```bash
   # Check if noVNC is running
   docker exec vnc-tool ps aux | grep novnc
   
   # Verify port binding
   docker exec vnc-tool netstat -ln | grep 8080
   
   # Check noVNC logs
   docker exec vnc-tool tail -20 /var/log/novnc.log
   ```

3. **Web Terminal Not Accessible**
   ```bash
   # Check ttyd status
   docker exec vnc-tool ps aux | grep ttyd
   
   # Verify port binding
   docker exec vnc-tool netstat -ln | grep 7681
   
   # Check ttyd logs
   docker exec vnc-tool tail -20 /var/log/ttyd.log
   ```

4. **Node.js Issues**
   ```bash
   # Check Node.js installation
   docker exec vnc-tool node --version
   docker exec vnc-tool npm --version
   
   # Check global packages
   docker exec vnc-tool npm list -g
   
   # Verify PATH
   docker exec vnc-tool which node
   docker exec vnc-tool which npm
   ```

5. **AI Tools Not Working**
   ```bash
   # Check if tools are installed
   docker exec vnc-tool which gemini
   docker exec vnc-tool which claude-code
   docker exec vnc-tool which acli
   
   # Check npm global packages
   docker exec vnc-tool npm list -g --depth=0
   ```

### Performance Optimization

1. **Memory Management**
   ```bash
   # Monitor memory usage
   docker stats vnc-tool
   
   # Increase memory limit if needed
   docker run -d --memory="4g" --name vnc-tool vnc-tool
   ```

2. **CPU Optimization**
   ```bash
   # Limit CPU usage
   docker run -d --cpus="2.0" --name vnc-tool vnc-tool
   
   # Monitor CPU usage
   docker exec vnc-tool htop
   ```

## Development

### Customizing the Image

1. **Add More Node.js Packages**
   ```dockerfile
   RUN npm install -g your-package-name
   ```

2. **Add System Packages**
   ```dockerfile
   RUN apt-get update && apt-get install -y \
       your-package-name \
       && rm -rf /var/lib/apt/lists/*
   ```

3. **Modify Supervisor Configuration**
   Edit the supervisor configuration files in `/app/conf.d/` to customize service behavior.

### Building Variants

```bash
# Build with custom tag
docker build -t my-vnc-tool .

# Build with different Node.js version
# Edit Node.js installation in Dockerfile
```

## Security Considerations

1. **Network Security**
   - Default binding to localhost for security
   - Use Cloudflare Tunnel for remote access
   - Avoid direct port exposure to public networks

2. **Container Security**
   - Use `--security-opt no-new-privileges`
   - Set appropriate resource limits
   - Keep base image updated

3. **Development Security**
   - Be cautious with npm packages
   - Review code before execution
   - Use secure environment variables

## Use Cases

- **Node.js Development**: Full Node.js development environment
- **Web Development**: Browser testing and development
- **AI-Assisted Coding**: Integrated AI tools for development
- **Remote Development**: Accessible development environment
- **Tool Integration**: Testing and using various development tools

## Comparison with Other Containers

| Feature | novnc_base | novnc_llm_cli | novnc_tool |
|---------|------------|---------------|------------|
| **Base Image** | Debian Bullseye | Debian Bullseye | theasp/novnc |
| **AI Tools** | ❌ | ✅ | ✅ |
| **Node.js** | ❌ | ✅ | ✅ |
| **Web Terminal** | ❌ | ✅ | ✅ |
| **Cloudflare Tunnel** | ❌ | ✅ | ✅ |
| **Firefox Persistence** | ❌ | ✅ | ✅ |
| **Service Management** | Basic | Advanced | Supervisor |

## Related Projects

- [novnc_base](../novnc_base/): Basic VNC environment
- [novnc_llm_cli](../novnc_llm_cli/): AI tools integrated environment

## License

This project is part of the VNC Lab and follows the same MIT license. 