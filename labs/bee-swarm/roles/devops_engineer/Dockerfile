# 基於VNC Lab的DevOps工程師角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建DevOps工程師工作目錄結構
RUN mkdir -p /app/devops_engineer \
    /app/projects \
    /app/infrastructure \
    /app/ci_cd \
    /app/monitoring \
    /app/security \
    /app/docs

# 複製DevOps工程師腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建DevOps工程師用戶
RUN useradd -m -s /bin/bash devops_engineer \
    && chown -R devops_engineer:devops_engineer /app

# 切換到DevOps工程師用戶
USER devops_engineer

# 設置環境變量
ENV ROLE_NAME=devops_engineer
ENV ROLE_TYPE=devops_engineer
ENV WORKSPACE=/app/projects
ENV INFRASTRUCTURE_WORKSPACE=/app/infrastructure
ENV CI_CD_WORKSPACE=/app/ci_cd
ENV MONITORING_WORKSPACE=/app/monitoring
ENV SECURITY_WORKSPACE=/app/security

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 