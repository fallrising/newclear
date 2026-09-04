# novnc_llm_cli - AI Tools Integrated VNC Environment

A comprehensive VNC desktop environment with integrated AI CLI tools, web terminal, and enhanced monitoring capabilities.

## Overview

This container extends the basic VNC environment with powerful AI development tools and enhanced features:

- **AI CLI Tools**: Google Gemini CLI, Anthropic Claude Code, Atlassian CLI
- **Web Terminal**: ttyd-based terminal access through browser
- **Remote Access**: Cloudflare Tunnel support for secure remote access
- **Enhanced Monitoring**: Comprehensive logging and debugging capabilities
- **Firefox Persistence**: Browser profile persistence across container restarts

## Features

### AI Development Tools
- **Google Gemini CLI** (`@google/gemini-cli`): AI-powered code assistance
- **Anthropic Claude Code** (`@anthropic-ai/claude-code`): Advanced code analysis
- **Atlassian CLI** (`acli`): Atlassian platform integration

### Remote Access & Security
- **Web VNC**: Browser-based desktop access
- **Web Terminal**: Browser-based terminal access with authentication
- **Cloudflare Tunnel**: Secure remote access without port forwarding
- **Password Protection**: Configurable VNC and terminal passwords

### Enhanced Monitoring
- **Service Monitoring**: Automatic restart of failed services
- **Debug Scripts**: Comprehensive debugging tools
- **Log Management**: Centralized logging for all services
- **Health Checks**: Continuous monitoring of critical services

## Quick Start

### Build the Image

```bash
docker build -t vnc-llm-cli .
```

### Basic Run (Development)

```bash
docker run -d \
  --name vnc-llm \
  -p 6080:6080 \
  -p 7681:7681 \
  -v firefox-profile:/home/firefox-profile \
  vnc-llm-cli
```

### Secure Run (Production)

```bash
docker run -d \
  --name vnc-llm \
  -p 127.0.0.1:6080:6080 \
  -p 127.0.0.1:7681:7681 \
  -v firefox-profile:/home/firefox-profile \
  -e VNC_PASSWORD="your_secure_vnc_password" \
  -e TTYD_PASSWORD="your_secure_terminal_password" \
  --restart unless-stopped \
  vnc-llm-cli
```

### With Cloudflare Tunnel

```bash
docker run -d \
  --name vnc-llm \
  -p 127.0.0.1:6080:6080 \
  -p 127.0.0.1:7681:7681 \
  -v firefox-profile:/home/firefox-profile \
  -e VNC_PASSWORD="your_vnc_password" \
  -e TTYD_PASSWORD="your_terminal_password" \
  -e TUNNEL_TOKEN="your_cloudflared_token" \
  vnc-llm-cli
```

## Access Points

| Service | URL | Credentials |
|---------|-----|-------------|
| **Desktop** | `http://localhost:6080` | VNC password (if set) |
| **Web Terminal** | `http://localhost:7681` | `admin:TTYD_PASSWORD` |

## Environment Variables

| Variable | Description | Default Value |
|----------|-------------|---------------|
| `VNC_PASSWORD` | VNC connection password | `vnc123` |
| `TTYD_PASSWORD` | Web terminal password | `MyTerminalPassword123` |
| `TUNNEL_TOKEN` | Cloudflare Tunnel token | None (optional) |

## Advanced Usage

### Production-Ready Configuration

```bash
docker run -d \
  --name production-vnc \
  -p 127.0.0.1:6080:6080 \
  -p 127.0.0.1:7681:7681 \
  -v firefox-profile:/home/firefox-profile \
  -v $(pwd)/workspace:/workspace \
  -e VNC_PASSWORD="$(openssl rand -base64 32)" \
  -e TTYD_PASSWORD="$(openssl rand -base64 32)" \
  --memory="4g" \
  --cpus="2.0" \
  --restart unless-stopped \
  --security-opt no-new-privileges:true \
  --read-only \
  --tmpfs /tmp:size=1g \
  --tmpfs /var/log:size=100m \
  vnc-llm-cli
```

### Development Environment

```bash
docker run -d \
  --name dev-vnc \
  -p 6080:6080 \
  -p 7681:7681 \
  -v firefox-profile:/home/firefox-profile \
  -v $(pwd)/code:/workspace \
  -v $(pwd)/downloads:/home/downloads \
  --memory="2g" \
  --cpus="1.5" \
  vnc-llm-cli
```

### Using Environment File

Create `.env` file:
```bash
VNC_PASSWORD=MySecureVNC2025!
TTYD_PASSWORD=MySecureTTYD2025!
TUNNEL_TOKEN=your_cloudflared_token_here
```

Run with env file:
```bash
docker run -d \
  --name vnc-llm \
  -p 127.0.0.1:6080:6080 \
  -p 127.0.0.1:7681:7681 \
  -v firefox-profile:/home/firefox-profile \
  --env-file .env \
  vnc-llm-cli
```

## AI Tools Usage

### Google Gemini CLI

```bash
# Initialize Gemini CLI
gemini init

# Ask questions
gemini "How do I implement a binary search in Python?"

# Code review
gemini review myfile.py
```

### Anthropic Claude Code

```bash
# Initialize Claude Code
claude-code init

# Code analysis
claude-code analyze myproject/

# Code generation
claude-code generate "Create a REST API in Python"
```

### Atlassian CLI

```bash
# Configure Atlassian CLI
acli auth

# Jira operations
acli jira issue list

# Confluence operations
acli confluence page list
```

## Monitoring and Debugging

### Check Container Status

```bash
# View container logs
docker logs vnc-llm

# Check service status
docker exec vnc-llm /opt/scripts/debug.sh

# Monitor resource usage
docker stats vnc-llm
```

### Debug Commands

```bash
# Access container shell
docker exec -it vnc-llm bash

# Check service logs
docker exec vnc-llm tail -f /var/log/services/x11vnc.log
docker exec vnc-llm tail -f /var/log/services/novnc.log
docker exec vnc-llm tail -f /var/log/services/ttyd.log

# Check process status
docker exec vnc-llm ps aux | grep -E "(Xvfb|x11vnc|novnc|firefox|ttyd)"
```

### Service Management

```bash
# Check supervisor status
docker exec vnc-llm supervisorctl status

# Restart specific service
docker exec vnc-llm supervisorctl restart services

# View all logs
docker exec vnc-llm ls -la /var/log/services/
```

## Container Architecture

### Services

1. **Xvfb** (`:1`): Virtual framebuffer
2. **Openbox**: Window manager
3. **x11vnc**: VNC server with authentication
4. **noVNC**: Web VNC proxy
5. **ttyd**: Web terminal server
6. **cloudflared**: Tunnel service (optional)
7. **Firefox**: Web browser with persistent profile

### File Structure

```
/opt/novnc/              # noVNC installation
/opt/scripts/            # Startup and debug scripts
/home/firefox-profile/   # Firefox profile (persistent)
/var/log/services/       # Service logs
/etc/supervisor/         # Supervisor configuration
```

### Ports

| Port | Service | Description |
|------|---------|-------------|
| 6080 | noVNC | Web VNC client |
| 5900 | x11vnc | Traditional VNC |
| 7681 | ttyd | Web terminal |

## Troubleshooting

### Common Issues

1. **Container Won't Start**
   ```bash
   # Check detailed logs
   docker logs vnc-llm
   
   # Check system resources
   docker stats vnc-llm
   
   # Verify image exists
   docker images | grep vnc-llm-cli
   ```

2. **VNC Connection Fails**
   ```bash
   # Check if VNC is listening
   docker exec vnc-llm netstat -ln | grep 5900
   
   # Verify password file
   docker exec vnc-llm ls -la /root/.vnc/
   
   # Check VNC logs
   docker exec vnc-llm tail -20 /var/log/services/x11vnc.log
   ```

3. **Web Terminal Not Accessible**
   ```bash
   # Check ttyd status
   docker exec vnc-llm ps aux | grep ttyd
   
   # Verify port binding
   docker exec vnc-llm netstat -ln | grep 7681
   
   # Check ttyd logs
   docker exec vnc-llm tail -20 /var/log/services/ttyd.log
   ```

4. **AI Tools Not Working**
   ```bash
   # Check Node.js installation
   docker exec vnc-llm node --version
   docker exec vnc-llm npm --version
   
   # Verify global packages
   docker exec vnc-llm npm list -g
   
   # Check PATH
   docker exec vnc-llm which gemini
   docker exec vnc-llm which claude-code
   ```

### Performance Optimization

1. **Memory Issues**
   ```bash
   # Increase memory limit
   docker run -d --memory="4g" --name vnc-llm vnc-llm-cli
   
   # Monitor memory usage
   docker stats vnc-llm
   ```

2. **CPU Issues**
   ```bash
   # Limit CPU usage
   docker run -d --cpus="2.0" --name vnc-llm vnc-llm-cli
   
   # Check CPU usage
   docker exec vnc-llm htop
   ```

## Security Best Practices

1. **Strong Passwords**
   - Use complex passwords for VNC and terminal access
   - Generate random passwords for production
   - Never use default passwords

2. **Network Security**
   - Bind to localhost only (`127.0.0.1`)
   - Use Cloudflare Tunnel for remote access
   - Avoid direct port exposure

3. **Container Security**
   - Use `--security-opt no-new-privileges`
   - Set resource limits
   - Use read-only filesystem where possible

4. **Regular Updates**
   - Keep base image updated
   - Update AI tools regularly
   - Monitor for security patches

## Development

### Customizing the Image

1. **Add More AI Tools**
   ```dockerfile
   RUN npm install -g your-ai-tool
   ```

2. **Modify Startup Script**
   Edit `/opt/scripts/start.sh` to customize service startup.

3. **Add Custom Software**
   ```dockerfile
   RUN apt-get update && apt-get install -y \
       your-software \
       && rm -rf /var/lib/apt/lists/*
   ```

### Building Variants

```bash
# Build with validation features
docker build -f Dockerfile.add_validation -t vnc-llm-cli-validated .

# Build with custom Node.js version
# Edit Node.js installation in Dockerfile
```

## Use Cases

- **AI Development**: Integrated AI tools for code assistance
- **Remote Development**: Full development environment accessible anywhere
- **Code Review**: AI-powered code analysis and review
- **Learning**: Educational environment with AI assistance
- **Testing**: Browser and application testing with AI tools

## Related Projects

- [novnc_base](../novnc_base/): Basic VNC environment
- [novnc_tool](../novnc_tool/): Tool-focused environment

## License

This project is part of the VNC Lab and follows the same MIT license.
