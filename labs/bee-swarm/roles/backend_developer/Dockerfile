# 基於VNC Lab的後端開發者角色容器 - MCP Server架構
FROM fallrising/novnc_llm_cli:latest

# 設置工作目錄
WORKDIR /app

# 創建後端開發工作目錄結構
RUN mkdir -p /app/backend_developer \
    /app/projects \
    /app/apis \
    /app/databases \
    /app/tests \
    /app/docs

# 複製後端開發腳本和配置
COPY scripts/ /app/scripts/
COPY config/ /app/config/

# 設置權限
RUN chmod +x /app/scripts/*.sh

# 創建後端開發用戶
RUN useradd -m -s /bin/bash backend_developer \
    && chown -R backend_developer:backend_developer /app

# 切換到後端開發用戶
USER backend_developer

# 設置環境變量
ENV ROLE_NAME=backend_developer
ENV ROLE_TYPE=backend_developer
ENV WORKSPACE=/app/projects
ENV API_WORKSPACE=/app/apis
ENV DB_WORKSPACE=/app/databases
ENV TEST_WORKSPACE=/app/tests

# 暴露端口
EXPOSE 6080 7681

# 啟動命令
CMD ["/app/scripts/start.sh"] 